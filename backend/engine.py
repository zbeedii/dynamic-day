import copy
import uuid
from datetime import datetime, timezone, timedelta


def t2m(s):
    h, m = s.split(":")
    return int(h) * 60 + int(m)


def m2t(m):
    m = int(round(m)) % (24 * 60)
    return f"{m // 60:02d}:{m % 60:02d}"


def new_id():
    return uuid.uuid4().hex[:10]


def now_utc():
    return datetime.now(timezone.utc)


def running_min(task, now_dt):
    if not task.get("active_since"):
        return 0.0
    st = datetime.fromisoformat(task["active_since"])
    if st.tzinfo is None:
        st = st.replace(tzinfo=timezone.utc)
    return max(0.0, (now_dt - st).total_seconds() / 60)


def eff_spent(task, now_dt):
    return task.get("spent_min", 0) + running_min(task, now_dt)


def block_pool(block):
    dur = t2m(block["end"]) - t2m(block["start"])
    fixed = sum(t.get("fixed_duration_min", 0) for t in block["tasks"] if t["type"] == "fixed")
    return max(0, dur - fixed)


def task_planned(task, pool):
    if task["type"] == "recurring":
        return pool * task.get("share_pct", 0) / 100
    if task["type"] == "carry":
        return task.get("carry_min", 0)
    return 0


def task_total_plan(task, pool):
    return task_planned(task, pool) + task.get("extra_min", 0) - task.get("pulled_out_min", 0)


def task_need(task, pool, now_dt):
    if task.get("done") or task.get("skipped") or task["type"] not in ("recurring", "carry"):
        return 0
    return max(0.0, task_total_plan(task, pool) - eff_spent(task, now_dt))


def pause_task(task, now_dt):
    if task.get("active_since"):
        task["spent_min"] = round(eff_spent(task, now_dt), 2)
        task["active_since"] = None


def materialize_day(template, date, user_id):
    blocks = []
    for b in template.get("blocks", []):
        tasks = []
        for t in b.get("tasks", []):
            tasks.append(new_day_task(t))
        blocks.append({
            "id": new_id(), "tpl_block_id": b["id"], "name": b["name"],
            "start": b["start"], "end": b["end"], "buffer_after_min": b.get("buffer_after_min", 0),
            "tasks": tasks, "settled": False, "delay_acknowledged": False,
        })
    return {"user_id": user_id, "date": date, "template_id": template.get("id"),
            "template_name": template.get("name"), "blocks": blocks,
            "created_at": now_utc().isoformat()}


def task_key(title, type_):
    """Same recurring title in different blocks is one logical task across the day."""
    if type_ in ("recurring", "carry"):
        return "k:" + " ".join(title.lower().split())
    return new_id()


def new_day_task(t, tkey=None):
    return {
        "id": new_id(), "tkey": tkey or task_key(t["title"], t["type"]), "title": t["title"], "type": t["type"],
        "share_pct": t.get("share_pct", 0), "min_minutes": t.get("min_minutes", 0),
        "must_today": t.get("must_today", False), "fixed_start": t.get("fixed_start"),
        "fixed_duration_min": t.get("fixed_duration_min", 0), "notes": t.get("notes", ""),
        "subtasks": [{"id": new_id(), "title": s["title"], "done": False} for s in t.get("subtasks", [])],
        "spent_min": 0, "extra_min": 0, "pulled_out_min": 0, "carry_min": 0,
        "done": False, "skipped": False, "completed_early": False, "active_since": None,
        "protection_decision": None, "overrun_acknowledged": False,
    }


def compute_block(block, now_min, now_dt, settings, all_blocks):
    start, end = t2m(block["start"]), t2m(block["end"])
    if now_min < start:
        status = "upcoming"
    elif now_min >= end:
        status = "past"
    else:
        status = "active"
    remaining = max(0, end - max(now_min, start))
    pool = block_pool(block)
    tasks = block["tasks"]
    threshold = max(1.0, (end - start) * settings.get("delay_threshold_pct", 30) / 100.0)

    fixed_remaining = 0
    for t in tasks:
        if t["type"] == "fixed" and not t.get("done") and t.get("fixed_start"):
            fs = t2m(t["fixed_start"])
            fe = fs + t.get("fixed_duration_min", 0)
            fixed_remaining += max(0, min(fe, end) - max(fs, max(now_min, start)))
    A = max(0.0, remaining - fixed_remaining)

    needs = {t["id"]: task_need(t, pool, now_dt) for t in tasks}
    carry_tasks = [t for t in tasks if t["type"] == "carry" and needs[t["id"]] > 0]
    carry_need = sum(needs[t["id"]] for t in carry_tasks)
    A_carry = min(A, carry_need)
    A_share = A - A_carry
    share_tasks = [t for t in tasks if t["type"] == "recurring" and needs[t["id"]] > 0]
    sum_share = sum(needs[t["id"]] for t in share_tasks)
    share_factor = min(1.0, A_share / sum_share) if sum_share > 0 else 0.0
    prov = {t["id"]: needs[t["id"]] * share_factor for t in share_tasks}

    def floor_left(t):
        mm = t.get("min_minutes", 0)
        return max(0.0, mm - eff_spent(t, now_dt)) if mm > 0 else 0.0

    pending = []
    protected = set()
    for t in share_tasks:
        fl = floor_left(t)
        if fl > 0 and prov[t["id"]] < fl - 0.01:
            dec = t.get("protection_decision")
            if dec == "accept":
                continue
            protected.add(t["id"])
            if dec != "protect" and status == "active":
                pending.append({"kind": "min_protection", "block_id": block["id"], "task_id": t["id"],
                                "title": t["title"], "allocated_min": round(prov[t["id"]], 1),
                                "min_minutes": t.get("min_minutes", 0)})
            elif dec == "protect" and status == "active" and A_share < fl - 0.01:
                pending.append({"kind": "min_protection", "block_id": block["id"], "task_id": t["id"],
                                "title": t["title"], "allocated_min": round(prov[t["id"]], 1),
                                "min_minutes": t.get("min_minutes", 0),
                                "protected_shortage_min": round(fl - A_share, 1),
                                "requires_capacity": True})

    alloc = {}
    prot_targets = {t["id"]: floor_left(t) for t in share_tasks if t["id"] in protected}
    prot_total = sum(prot_targets.values())
    # A protection decision never silently opts into a reduced floor. When the current block
    # cannot physically fit the requested floor, allocate what physically fits and keep the
    # shortage explicit so the UI can surface it instead of silently treating it as satisfied.
    prot_factor = min(1.0, A_share / prot_total) if prot_total > 0 else 1.0
    for tid, target in prot_targets.items():
        alloc[tid] = target * prot_factor
    rest = max(0.0, A_share - sum(alloc.values()))
    others = [t for t in share_tasks if t["id"] not in protected]
    sum_others = sum(needs[t["id"]] for t in others)
    factor = min(1.0, rest / sum_others) if sum_others > 0 else 0.0
    for t in others:
        alloc[t["id"]] = needs[t["id"]] * factor
    carry_factor = min(1.0, A_carry / carry_need) if carry_need > 0 else 0.0
    for t in carry_tasks:
        alloc[t["id"]] = needs[t["id"]] * carry_factor

    if status == "active" and not block.get("delay_acknowledged"):
        started = any(t.get("spent_min", 0) > 0 or t.get("active_since") or t.get("done") for t in tasks)
        delay = now_min - start
        if not started and delay > threshold and any(v > 0 for v in needs.values()):
            pending.insert(0, {"kind": "late_start", "block_id": block["id"], "delay_min": round(delay)})

    for t in tasks:
        if t.get("active_since") and t["type"] in ("recurring", "carry") and not t.get("overrun_acknowledged"):
            over = eff_spent(t, now_dt) - task_total_plan(t, pool)
            if over > threshold:
                pending.append({"kind": "overrun", "block_id": block["id"], "task_id": t["id"],
                                "title": t["title"], "over_min": round(over)})

    due_fixed = None
    for t in tasks:
        if t["type"] == "fixed" and not t.get("done") and t.get("fixed_start"):
            fs = t2m(t["fixed_start"])
            if fs <= now_min < fs + t.get("fixed_duration_min", 0):
                due_fixed = t["id"]
                break

    out_tasks = []
    for t in tasks:
        eff = eff_spent(t, now_dt)
        total_plan = task_total_plan(t, pool)
        a = alloc.get(t["id"], 0)
        ot = dict(t)
        ot.update({
            "planned_min": round(task_planned(t, pool), 1),
            "total_plan_min": round(total_plan, 1),
            "need_min": round(needs[t["id"]], 1),
            "allocated_min": round(a, 1),
            "spent_effective_min": round(eff, 1),
            "over_min": round(max(0.0, eff - total_plan), 1) if t["type"] in ("recurring", "carry") else 0,
            "is_protected": t["id"] in protected,
            "ends_at": (now_dt + timedelta(minutes=a)).isoformat() if t.get("active_since") else None,
            "day_progress_pct": day_progress(t, all_blocks, now_dt),
            "block_progress_pct": round(min(100.0, eff / total_plan * 100), 1) if total_plan > 0 else (100 if t.get("done") else 0),
        })
        out_tasks.append(ot)

    return {
        **{k: v for k, v in block.items() if k != "tasks"},
        "status": status, "remaining_min": round(remaining, 1), "pool_min": pool,
        "duration_min": end - start, "free_min": round(A - sum(alloc.values()), 1),
        "tasks": out_tasks, "pending_decisions": pending, "due_fixed_task_id": due_fixed,
    }


def day_progress(task, all_blocks, now_dt):
    if task["type"] not in ("recurring", "carry"):
        return 100 if task.get("done") else 0
    tot = 0.0
    spent = 0.0
    for b in all_blocks:
        pool = block_pool(b)
        for t in b["tasks"]:
            if t.get("tkey") == task.get("tkey") and t["type"] in ("recurring", "carry"):
                plan = task_total_plan(t, pool)
                if t.get("done") or t.get("skipped"):
                    spent += plan
                else:
                    spent += min(plan, eff_spent(t, now_dt))
                tot += plan
    return round(min(100.0, spent / tot * 100), 1) if tot > 0 else 0


def inject_carries(day, from_block, deficits):
    later = sorted([b for b in day["blocks"] if t2m(b["start"]) >= t2m(from_block["end"]) and b["id"] != from_block["id"]],
                   key=lambda b: t2m(b["start"]))
    injected = []
    for t, need in deficits:
        rem = need
        for b in later:
            cap = block_pool(b) - sum(x.get("carry_min", 0) for x in b["tasks"] if x["type"] == "carry")
            take = min(rem, max(0, cap))
            if take >= 1:
                ct = new_day_task({"title": t["title"], "type": "carry", "notes": t.get("notes", ""), "must_today": True}, tkey=t["tkey"])
                ct["carry_min"] = round(take)
                ct["carry_from"] = from_block["name"]
                b["tasks"].append(ct)
                injected.append((b["name"], t["title"], round(take)))
                rem -= take
            if rem < 1:
                break
    return injected


def settle_past_blocks(day, now_min, now_dt):
    changes = []
    for block in sorted(day["blocks"], key=lambda b: t2m(b["start"])):
        if block.get("settled") or t2m(block["end"]) > now_min:
            continue
        pool = block_pool(block)
        for t in block["tasks"]:
            pause_task(t, now_dt)
        deficits = [(t, task_need(t, pool, now_dt)) for t in block["tasks"]
                    if t["type"] in ("recurring", "carry") and t.get("must_today") and not t.get("done") and not t.get("skipped")]
        deficits = [(t, n) for t, n in deficits if n >= 1]
        snapshot = copy.deepcopy(day)
        block["settled"] = True
        if deficits:
            injected = inject_carries(day, block, deficits)
            if injected:
                label = "Carried " + ", ".join(f"{m}m of '{title}' → {bn}" for bn, title, m in injected)
                changes.append((label, snapshot))
    return changes


def compute_day(day, now_min, settings):
    now_dt = now_utc()
    blocks = sorted(day["blocks"], key=lambda b: t2m(b["start"]))
    computed = [compute_block(b, now_min, now_dt, settings, blocks) for b in blocks]
    current = next((b["id"] for b in computed if b["status"] == "active"), None)
    nxt = next((b["id"] for b in computed if b["status"] == "upcoming"), None)
    in_buffer = None
    if current is None:
        for i, b in enumerate(computed[:-1]):
            e = t2m(b["end"])
            if b.get("buffer_after_min", 0) > 0 and e <= now_min < e + b["buffer_after_min"]:
                in_buffer = {"after": b["name"], "until": m2t(e + b["buffer_after_min"])}
    pending = [p for b in computed for p in b["pending_decisions"]]
    day_over = bool(computed) and all(b["status"] == "past" for b in computed)
    leftovers = []
    done_count = 0
    spent_total = 0.0
    for b in computed:
        for t in b["tasks"]:
            spent_total += t.get("spent_effective_min", 0) or 0
            if t.get("done"):
                if not t.get("completed_early") or t["type"] not in ("recurring", "carry"):
                    done_count += 1
                continue
            if t.get("skipped") or b["status"] != "past":
                continue
            if t["type"] in ("recurring", "carry") and t["need_min"] < 1:
                continue
            key = t.get("tkey") or t["id"]
            prev = next((x for x in leftovers if x["tkey"] == key), None)
            if prev:
                prev["need_min"] = round(prev["need_min"] + t["need_min"], 1)
                continue
            leftovers.append({"tkey": key, "task_id": t["id"], "title": t["title"], "type": t["type"],
                              "need_min": t["need_min"], "block_name": b["name"],
                              "notes": t.get("notes", "")})
    return {
        "date": day["date"], "template_id": day.get("template_id"), "template_name": day.get("template_name"),
        "blocks": computed, "current_block_id": current, "next_block_id": nxt,
        "in_buffer": in_buffer, "pending_decisions": pending, "now_min": now_min,
        "day_over": day_over, "leftovers": leftovers, "done_count": done_count,
        "spent_total_min": round(spent_total),
    }


def pull_forward(day, block_id, task_id, minutes, now_dt):
    block = next(b for b in day["blocks"] if b["id"] == block_id)
    task = next(t for t in block["tasks"] if t["id"] == task_id)
    later = sorted([b for b in day["blocks"] if t2m(b["start"]) > t2m(block["start"])], key=lambda b: t2m(b["start"]))
    left = minutes
    taken = 0.0
    for b in later:
        pool = block_pool(b)
        for t in b["tasks"]:
            if t.get("tkey") != task["tkey"] or t["type"] not in ("recurring", "carry") or t.get("done") or t.get("skipped"):
                continue
            avail = task_need(t, pool, now_dt)
            take = min(left, avail)
            if take <= 0:
                continue
            t["pulled_out_min"] = round(t.get("pulled_out_min", 0) + take, 2)
            if task_need(t, pool, now_dt) < 0.5:
                t["done"] = True
                t["completed_early"] = True
            left -= take
            taken += take
            if left <= 0:
                break
        if left <= 0:
            break
    if taken > 0:
        task["extra_min"] = round(task.get("extra_min", 0) + taken, 2)
        task["done"] = False
        task["completed_early"] = False
    return round(taken, 1)


def task_is_100(day, tkey):
    inst = [t for b in day["blocks"] for t in b["tasks"] if t.get("tkey") == tkey and t["type"] in ("recurring", "carry")]
    return bool(inst) and all(t.get("done") or t.get("skipped") for t in inst)


def remaining_future_min(day, block_id, tkey, now_dt):
    block = next(b for b in day["blocks"] if b["id"] == block_id)
    total = 0.0
    for b in day["blocks"]:
        if t2m(b["start"]) <= t2m(block["start"]):
            continue
        pool = block_pool(b)
        for t in b["tasks"]:
            if t.get("tkey") == tkey and t["type"] in ("recurring", "carry"):
                total += task_need(t, pool, now_dt)
    return round(total, 1)
