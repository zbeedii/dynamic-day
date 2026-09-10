from dotenv import load_dotenv
from pathlib import Path

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / ".env")

import copy  # noqa: E402
import logging  # noqa: E402
import os  # noqa: E402
import random  # noqa: E402
from datetime import date as date_cls, datetime, timedelta, timezone  # noqa: E402
from typing import List, Optional  # noqa: E402

from fastapi import APIRouter, Depends, FastAPI, HTTPException, Request, Response  # noqa: E402
from motor.motor_asyncio import AsyncIOMotorClient  # noqa: E402
from pydantic import BaseModel, EmailStr, Field  # noqa: E402
from starlette.middleware.cors import CORSMiddleware
try:
    from pywebpush import webpush, WebPushException
except ImportError:  # Optional locally; installed in requirements for deployed push support.
    webpush = None
    WebPushException = Exception  # noqa: E402

import auth as A  # noqa: E402
import engine as E  # noqa: E402

client = AsyncIOMotorClient(os.environ["MONGO_URL"])
db = client[os.environ["DB_NAME"]]

app = FastAPI()
api = APIRouter(prefix="/api")
logger = logging.getLogger("dynamicday")
logging.basicConfig(level=logging.INFO)

DEFAULT_SETTINGS = {
    "delay_threshold_pct": 30,
    "buffer_min": 5,
    "reward_chance_pct": 35,
    "notifications_enabled": True,
    "calm_background": True,
}

REWARDS = ["confetti", "aura", "ripple", "bloom", "spark"]


# ---------- helpers ----------
async def current_user(request: Request) -> dict:
    return await A.resolve_user(request, db)


async def get_settings(user_id: str) -> dict:
    doc = await db.settings.find_one({"user_id": user_id}, {"_id": 0})
    return {**DEFAULT_SETTINGS, **(doc or {})}


async def save_day(day: dict):
    await db.days.update_one({"user_id": day["user_id"], "date": day["date"]}, {"$set": day}, upsert=True)


async def load_day(user_id: str, date: str) -> Optional[dict]:
    return await db.days.find_one({"user_id": user_id, "date": date}, {"_id": 0})


async def load_day_or_404(user_id: str, date: str) -> dict:
    day = await load_day(user_id, date)
    if not day:
        raise HTTPException(404, "No day planned for this date")
    return day


async def push_undo(day_before: dict, label: str) -> str:
    res = await db.undo_snapshots.insert_one({
        "user_id": day_before["user_id"], "date": day_before["date"], "label": label,
        "day": copy.deepcopy(day_before), "created_at": datetime.now(timezone.utc).isoformat(),
    })
    return str(res.inserted_id)


async def maybe_reward(user_id: str, settings: dict) -> Optional[str]:
    if random.random() * 100 >= settings.get("reward_chance_pct", 35):
        return None
    last = (await db.settings.find_one({"user_id": user_id}, {"_id": 0, "last_reward": 1}) or {}).get("last_reward")
    pool = [r for r in REWARDS if r != last] or REWARDS
    reward = random.choice(pool)
    await db.settings.update_one({"user_id": user_id}, {"$set": {"last_reward": reward}}, upsert=True)
    return reward


def find_task(day: dict, task_id: str):
    for b in day["blocks"]:
        for t in b["tasks"]:
            if t["id"] == task_id:
                return b, t
    raise HTTPException(404, "Task not found")


def find_block(container: dict, block_id: str):
    for b in container["blocks"]:
        if b["id"] == block_id:
            return b
    raise HTTPException(404, "Block not found")


def validate_blocks(blocks: List[dict], buffer_min: int):
    ordered = sorted(blocks, key=lambda b: E.t2m(b["start"]))
    for b in ordered:
        if E.t2m(b["end"]) <= E.t2m(b["start"]):
            raise HTTPException(400, f"Block '{b['name']}' must end after it starts")
    for a, b in zip(ordered, ordered[1:]):
        gap = E.t2m(b["start"]) - E.t2m(a["end"])
        if gap < buffer_min:
            raise HTTPException(400, f"'{a['name']}' and '{b['name']}' need at least a {buffer_min}-minute transition buffer")


def normalize_buffers(blocks: List[dict], buffer_min: int):
    ordered = sorted(blocks, key=lambda b: E.t2m(b["start"]))
    for i, b in enumerate(ordered):
        b["buffer_after_min"] = (E.t2m(ordered[i + 1]["start"]) - E.t2m(b["end"])) if i + 1 < len(ordered) else 0


# ---------- models ----------
class Credentials(BaseModel):
    email: EmailStr
    password: str = Field(min_length=6)


class BlockIn(BaseModel):
    name: str
    start: str
    end: str


class BlockPatch(BaseModel):
    name: Optional[str] = None
    start: Optional[str] = None
    end: Optional[str] = None


class TaskIn(BaseModel):
    title: str
    type: str
    share_pct: float = 0
    min_minutes: int = 0
    must_today: bool = False
    fixed_start: Optional[str] = None
    fixed_duration_min: int = 0
    notes: str = ""
    subtasks: List[dict] = []


class TaskPatch(BaseModel):
    title: Optional[str] = None
    share_pct: Optional[float] = None
    min_minutes: Optional[int] = None
    must_today: Optional[bool] = None
    fixed_start: Optional[str] = None
    fixed_duration_min: Optional[int] = None
    notes: Optional[str] = None


class NameIn(BaseModel):
    name: str


class SplitIn(BaseModel):
    at: str


class SubtaskIn(BaseModel):
    title: str


class ExtendIn(BaseModel):
    minutes: int


class PullForwardIn(BaseModel):
    minutes: int = Field(ge=1, le=1440)


class PushSubscriptionIn(BaseModel):
    endpoint: str
    keys: dict = Field(default_factory=dict)
    timezone: Optional[str] = "UTC"


class DecisionIn(BaseModel):
    kind: str
    block_id: str
    task_id: Optional[str] = None
    action: str
    minutes: int = 0


class SettingsIn(BaseModel):
    delay_threshold_pct: Optional[int] = None
    reward_chance_pct: Optional[int] = None
    notifications_enabled: Optional[bool] = None
    calm_background: Optional[bool] = None


# ---------- auth ----------
@api.post("/auth/register")
async def register(body: Credentials, response: Response):
    email = body.email.lower()
    if await db.users.find_one({"email": email}):
        raise HTTPException(400, "An account with this email already exists")
    doc = {"email": email, "password_hash": A.hash_password(body.password), "name": email.split("@")[0],
           "role": "user", "created_at": datetime.now(timezone.utc).isoformat()}
    res = await db.users.insert_one(doc)
    uid = str(res.inserted_id)
    await seed_starter_template(uid)
    at, rt = A.create_access_token(uid, email), A.create_refresh_token(uid)
    A.set_auth_cookies(response, at, rt)
    return {"id": uid, "email": email, "name": doc["name"], "access_token": at}


@api.post("/auth/login")
async def login(body: Credentials, request: Request, response: Response):
    email = body.email.lower()
    ident = f"{request.client.host if request.client else 'unknown'}:{email}"
    await A.check_lockout(db, ident)
    user = await db.users.find_one({"email": email})
    if not user or not A.verify_password(body.password, user["password_hash"]):
        await A.record_failure(db, ident)
        raise HTTPException(401, "Invalid email or password")
    await A.clear_failures(db, ident)
    uid = str(user["_id"])
    at, rt = A.create_access_token(uid, email), A.create_refresh_token(uid)
    A.set_auth_cookies(response, at, rt)
    return {"id": uid, "email": email, "name": user.get("name", email), "access_token": at}


@api.post("/auth/logout")
async def logout(response: Response):
    A.clear_auth_cookies(response)
    return {"ok": True}


@api.get("/auth/me")
async def me(user: dict = Depends(current_user)):
    return {"id": user["_id"], "email": user["email"], "name": user.get("name", user["email"])}


@api.post("/auth/refresh")
async def refresh(request: Request, response: Response):
    import jwt as _jwt
    token = request.cookies.get("refresh_token")
    if not token:
        raise HTTPException(401, "No refresh token")
    try:
        payload = _jwt.decode(token, A.get_jwt_secret(), algorithms=[A.JWT_ALGORITHM])
    except _jwt.InvalidTokenError:
        raise HTTPException(401, "Invalid refresh token")
    if payload.get("type") != "refresh":
        raise HTTPException(401, "Invalid token type")
    from bson import ObjectId
    user = await db.users.find_one({"_id": ObjectId(payload["sub"])})
    if not user:
        raise HTTPException(401, "User not found")
    at = A.create_access_token(str(user["_id"]), user["email"])
    A.set_auth_cookies(response, at, token)
    return {"access_token": at}


# ---------- settings ----------
@api.get("/settings")
async def read_settings(user: dict = Depends(current_user)):
    return await get_settings(user["_id"])


@api.put("/settings")
async def update_settings(body: SettingsIn, user: dict = Depends(current_user)):
    patch = {k: v for k, v in body.model_dump().items() if v is not None}
    await db.settings.update_one({"user_id": user["_id"]}, {"$set": patch}, upsert=True)
    return await get_settings(user["_id"])


# ---------- templates ----------
@api.get("/templates")
async def list_templates(user: dict = Depends(current_user)):
    return await db.templates.find({"user_id": user["_id"]}, {"_id": 0}).to_list(200)


@api.post("/templates")
async def create_template(body: NameIn, user: dict = Depends(current_user)):
    tpl = {"id": E.new_id(), "user_id": user["_id"], "name": body.name, "blocks": [],
           "created_at": datetime.now(timezone.utc).isoformat()}
    await db.templates.insert_one(dict(tpl))
    return {k: v for k, v in tpl.items() if k != "_id"}


async def get_template(user_id: str, tid: str) -> dict:
    tpl = await db.templates.find_one({"user_id": user_id, "id": tid}, {"_id": 0})
    if not tpl:
        raise HTTPException(404, "Template not found")
    return tpl


async def save_template(tpl: dict):
    settings = await get_settings(tpl["user_id"])
    validate_blocks(tpl["blocks"], settings["buffer_min"])
    normalize_buffers(tpl["blocks"], settings["buffer_min"])
    tpl["blocks"] = sorted(tpl["blocks"], key=lambda b: E.t2m(b["start"]))
    await db.templates.update_one({"user_id": tpl["user_id"], "id": tpl["id"]}, {"$set": {"blocks": tpl["blocks"], "name": tpl["name"]}})
    return tpl


@api.patch("/templates/{tid}")
async def rename_template(tid: str, body: NameIn, user: dict = Depends(current_user)):
    tpl = await get_template(user["_id"], tid)
    tpl["name"] = body.name
    return await save_template(tpl)


@api.delete("/templates/{tid}")
async def delete_template(tid: str, user: dict = Depends(current_user)):
    await db.templates.delete_one({"user_id": user["_id"], "id": tid})
    return {"ok": True}


@api.post("/templates/{tid}/blocks")
async def add_template_block(tid: str, body: BlockIn, user: dict = Depends(current_user)):
    tpl = await get_template(user["_id"], tid)
    tpl["blocks"].append({"id": E.new_id(), "name": body.name, "start": body.start, "end": body.end,
                          "buffer_after_min": 0, "tasks": []})
    return await save_template(tpl)


@api.patch("/templates/{tid}/blocks/{bid}")
async def patch_template_block(tid: str, bid: str, body: BlockPatch, user: dict = Depends(current_user)):
    tpl = await get_template(user["_id"], tid)
    block = find_block(tpl, bid)
    block.update({k: v for k, v in body.model_dump().items() if v is not None})
    return await save_template(tpl)


@api.delete("/templates/{tid}/blocks/{bid}")
async def delete_template_block(tid: str, bid: str, user: dict = Depends(current_user)):
    tpl = await get_template(user["_id"], tid)
    tpl["blocks"] = [b for b in tpl["blocks"] if b["id"] != bid]
    return await save_template(tpl)


def split_block(container: dict, block_id: str, at: str, buffer_min: int, day_mode: bool):
    block = find_block(container, block_id)
    at_m, s, e = E.t2m(at), E.t2m(block["start"]), E.t2m(block["end"])
    if not (s + 10 <= at_m <= e - 10 - buffer_min):
        raise HTTPException(400, f"Split point must leave at least 10 minutes on each side plus the {buffer_min}-minute buffer")
    second = {"id": E.new_id(), "name": f"{block['name']} II", "start": E.m2t(at_m + buffer_min),
              "end": block["end"], "buffer_after_min": block.get("buffer_after_min", 0), "tasks": []}
    first_tasks, second_tasks = [], []
    for t in block["tasks"]:
        if t["type"] == "fixed" and t.get("fixed_start") and E.t2m(t["fixed_start"]) >= at_m + buffer_min:
            second_tasks.append(t)
        elif t["type"] == "recurring":
            first_tasks.append(t)
            clone = copy.deepcopy(t)
            clone["id"] = E.new_id()
            if day_mode:
                clone.update({"spent_min": 0, "extra_min": 0, "pulled_out_min": 0, "done": False,
                              "skipped": False, "active_since": None, "protection_decision": None,
                              "overrun_acknowledged": False})
            second_tasks.append(clone)
        else:
            first_tasks.append(t)
    block["name"] = f"{block['name']} I"
    block["end"] = E.m2t(at_m)
    block["buffer_after_min"] = buffer_min
    block["tasks"] = first_tasks
    second["tasks"] = second_tasks
    container["blocks"].append(second)


@api.post("/templates/{tid}/blocks/{bid}/split")
async def split_template_block(tid: str, bid: str, body: SplitIn, user: dict = Depends(current_user)):
    tpl = await get_template(user["_id"], tid)
    settings = await get_settings(user["_id"])
    split_block(tpl, bid, body.at, settings["buffer_min"], day_mode=False)
    return await save_template(tpl)


def validate_task(body: TaskIn, block: dict):
    if body.type not in ("recurring", "one_off", "fixed"):
        raise HTTPException(400, "Unknown task type")
    if body.type == "recurring":
        if not 1 <= body.share_pct <= 100:
            raise HTTPException(400, "Share must be between 1 and 100 percent")
        others = sum(t.get("share_pct", 0) for t in block["tasks"] if t["type"] == "recurring")
        if others + body.share_pct > 100:
            raise HTTPException(400, f"Recurring shares in this block would exceed 100% (currently {others:.0f}%)")
    if body.type == "fixed":
        if not body.fixed_start or body.fixed_duration_min <= 0:
            raise HTTPException(400, "A fixed task needs a start time and a duration")
        fs = E.t2m(body.fixed_start)
        if fs < E.t2m(block["start"]) or fs + body.fixed_duration_min > E.t2m(block["end"]):
            raise HTTPException(400, "A fixed task must fit inside its block")


def validate_task_patch(patch: dict, task: dict, block: dict):
    """Validate a partial update against block limits (share totals, fixed bounds, min_minutes)."""
    ttype = task["type"]
    dur = E.t2m(block["end"]) - E.t2m(block["start"])

    if ttype == "recurring" and "share_pct" in patch:
        share = patch["share_pct"]
        if not 1 <= share <= 100:
            raise HTTPException(400, "Share must be between 1 and 100 percent")
        others = sum(t.get("share_pct", 0) for t in block["tasks"]
                     if t["type"] == "recurring" and t["id"] != task["id"])
        if others + share > 100:
            raise HTTPException(400, f"Recurring shares in this block would exceed 100% (currently {others:.0f}%)")

    if ttype == "fixed":
        fs_new = patch.get("fixed_start", task.get("fixed_start"))
        dmin_new = patch.get("fixed_duration_min", task.get("fixed_duration_min", 0))
        if "fixed_start" in patch or "fixed_duration_min" in patch:
            if not fs_new or dmin_new <= 0:
                raise HTTPException(400, "A fixed task needs a start time and a duration")
            fs = E.t2m(fs_new)
            if fs < E.t2m(block["start"]) or fs + dmin_new > E.t2m(block["end"]):
                raise HTTPException(400, "A fixed task must fit inside its block")

    if "min_minutes" in patch:
        mm = patch["min_minutes"]
        if mm < 0:
            raise HTTPException(400, "Minimum minutes cannot be negative")
        # min_minutes must fit within the pool (block duration minus fixed reservations)
        fixed_res = sum(t.get("fixed_duration_min", 0) for t in block["tasks"]
                        if t["type"] == "fixed" and t["id"] != task["id"])
        pool = max(0, dur - fixed_res)
        if mm > pool:
            raise HTTPException(400, f"Minimum ({mm}m) can't exceed this block's usable time ({pool}m)")


@api.post("/templates/{tid}/blocks/{bid}/tasks")
async def add_template_task(tid: str, bid: str, body: TaskIn, user: dict = Depends(current_user)):
    tpl = await get_template(user["_id"], tid)
    block = find_block(tpl, bid)
    validate_task(body, block)
    task = body.model_dump()
    task["id"] = E.new_id()
    block["tasks"].append(task)
    return await save_template(tpl)


@api.patch("/templates/{tid}/blocks/{bid}/tasks/{taskid}")
async def patch_template_task(tid: str, bid: str, taskid: str, body: TaskPatch, user: dict = Depends(current_user)):
    tpl = await get_template(user["_id"], tid)
    block = find_block(tpl, bid)
    task = next((t for t in block["tasks"] if t["id"] == taskid), None)
    if not task:
        raise HTTPException(404, "Task not found")
    patch = {k: v for k, v in body.model_dump().items() if v is not None}
    validate_task_patch(patch, task, block)
    task.update(patch)
    return await save_template(tpl)


@api.delete("/templates/{tid}/blocks/{bid}/tasks/{taskid}")
async def delete_template_task(tid: str, bid: str, taskid: str, user: dict = Depends(current_user)):
    tpl = await get_template(user["_id"], tid)
    block = find_block(tpl, bid)
    block["tasks"] = [t for t in block["tasks"] if t["id"] != taskid]
    return await save_template(tpl)


# ---------- day ----------
async def computed_response(day: dict, now_min: int, settings: dict, undo=None, reward=None):
    payload = E.compute_day(day, now_min, settings)
    payload["settings"] = settings
    payload["undo"] = undo
    payload["reward"] = reward
    return payload


@api.get("/day/{date}")
async def read_day(date: str, now_min: int, user: dict = Depends(current_user)):
    settings = await get_settings(user["_id"])
    day = await load_day(user["_id"], date)
    if not day:
        return {"exists": False, "settings": settings, "date": date}
    now_dt = E.now_utc()
    pre = E.compute_day(day, now_min, settings)
    has_min_decision = any(p.get("kind") == "min_protection" for p in pre.get("pending_decisions", []))
    changes = [] if has_min_decision else E.settle_past_blocks(day, now_min, now_dt)
    undo = None
    if changes:
        label, snapshot = changes[-1]
        snapshot["user_id"], snapshot["date"] = user["_id"], date
        undo = {"id": await push_undo(snapshot, label), "label": label}
        await save_day(day)
    out = await computed_response(day, now_min, settings, undo=undo)
    out["exists"] = True
    return out


class AssignIn(BaseModel):
    template_id: str


@api.post("/day/{date}/assign")
async def assign_day(date: str, body: AssignIn, now_min: int, user: dict = Depends(current_user)):
    tpl = await get_template(user["_id"], body.template_id)
    if not tpl["blocks"]:
        raise HTTPException(400, "This template has no blocks yet")
    day = E.materialize_day(tpl, date, user["_id"])
    await db.days.delete_one({"user_id": user["_id"], "date": date})
    await save_day(day)
    settings = await get_settings(user["_id"])
    out = await computed_response(day, now_min, settings)
    out["exists"] = True
    return out


@api.delete("/day/{date}")
async def clear_day(date: str, user: dict = Depends(current_user)):
    await db.days.delete_one({"user_id": user["_id"], "date": date})
    return {"ok": True}


async def save_day_validated(day: dict, settings: dict):
    validate_blocks(day["blocks"], settings["buffer_min"])
    normalize_buffers(day["blocks"], settings["buffer_min"])
    day["blocks"] = sorted(day["blocks"], key=lambda b: E.t2m(b["start"]))
    await save_day(day)


@api.post("/day/{date}/blocks")
async def add_day_block(date: str, body: BlockIn, now_min: int, user: dict = Depends(current_user)):
    day = await load_day(user["_id"], date)
    settings = await get_settings(user["_id"])
    if not day:
        day = {"user_id": user["_id"], "date": date, "template_id": None, "template_name": "Custom day",
               "blocks": [], "created_at": E.now_utc().isoformat()}
    day["blocks"].append({"id": E.new_id(), "name": body.name, "start": body.start, "end": body.end,
                          "buffer_after_min": 0, "tasks": [], "settled": False, "delay_acknowledged": False})
    await save_day_validated(day, settings)
    out = await computed_response(day, now_min, settings)
    out["exists"] = True
    return out


@api.patch("/day/{date}/blocks/{bid}")
async def patch_day_block(date: str, bid: str, body: BlockPatch, now_min: int, user: dict = Depends(current_user)):
    day = await load_day_or_404(user["_id"], date)
    settings = await get_settings(user["_id"])
    block = find_block(day, bid)
    block.update({k: v for k, v in body.model_dump().items() if v is not None})
    await save_day_validated(day, settings)
    return await computed_response(day, now_min, settings)


@api.delete("/day/{date}/blocks/{bid}")
async def delete_day_block(date: str, bid: str, now_min: int, user: dict = Depends(current_user)):
    day = await load_day_or_404(user["_id"], date)
    settings = await get_settings(user["_id"])
    day["blocks"] = [b for b in day["blocks"] if b["id"] != bid]
    await save_day_validated(day, settings)
    return await computed_response(day, now_min, settings)


@api.post("/day/{date}/blocks/{bid}/split")
async def split_day_block(date: str, bid: str, body: SplitIn, now_min: int, user: dict = Depends(current_user)):
    day = await load_day_or_404(user["_id"], date)
    settings = await get_settings(user["_id"])
    split_block(day, bid, body.at, settings["buffer_min"], day_mode=True)
    await save_day_validated(day, settings)
    return await computed_response(day, now_min, settings)


@api.post("/day/{date}/blocks/{bid}/remind")
async def mark_block_reminded(date: str, bid: str, now_min: int, user: dict = Depends(current_user)):
    """Persist that the block-start reminder has been shown so other devices don't repeat it."""
    day = await load_day_or_404(user["_id"], date)
    settings = await get_settings(user["_id"])
    block = find_block(day, bid)
    if not block.get("reminded_at"):
        block["reminded_at"] = datetime.now(timezone.utc).isoformat()
        await save_day(day)
    return await computed_response(day, now_min, settings)


@api.post("/day/{date}/blocks/{bid}/tasks")
async def add_day_task(date: str, bid: str, body: TaskIn, now_min: int, user: dict = Depends(current_user)):
    day = await load_day_or_404(user["_id"], date)
    settings = await get_settings(user["_id"])
    block = find_block(day, bid)
    validate_task(body, block)
    block["tasks"].append(E.new_day_task(body.model_dump()))
    await save_day(day)
    return await computed_response(day, now_min, settings)


@api.patch("/day/{date}/tasks/{taskid}")
async def patch_day_task(date: str, taskid: str, body: TaskPatch, now_min: int, user: dict = Depends(current_user)):
    day = await load_day_or_404(user["_id"], date)
    settings = await get_settings(user["_id"])
    block, task = find_task(day, taskid)
    patch = {k: v for k, v in body.model_dump().items() if v is not None}
    validate_task_patch(patch, task, block)
    task.update(patch)
    await save_day(day)
    return await computed_response(day, now_min, settings)


@api.delete("/day/{date}/tasks/{taskid}")
async def delete_day_task(date: str, taskid: str, now_min: int, user: dict = Depends(current_user)):
    day = await load_day_or_404(user["_id"], date)
    settings = await get_settings(user["_id"])
    block, task = find_task(day, taskid)
    block["tasks"] = [t for t in block["tasks"] if t["id"] != taskid]
    await save_day(day)
    return await computed_response(day, now_min, settings)


@api.post("/day/{date}/tasks/{taskid}/start")
async def start_task(date: str, taskid: str, now_min: int, user: dict = Depends(current_user)):
    day = await load_day_or_404(user["_id"], date)
    settings = await get_settings(user["_id"])
    now_dt = E.now_utc()
    for b in day["blocks"]:
        for t in b["tasks"]:
            E.pause_task(t, now_dt)
    _, task = find_task(day, taskid)
    task["active_since"] = now_dt.isoformat()
    task["overrun_acknowledged"] = False
    await save_day(day)
    return await computed_response(day, now_min, settings)


@api.post("/day/{date}/tasks/{taskid}/pause")
async def pause_task_ep(date: str, taskid: str, now_min: int, user: dict = Depends(current_user)):
    day = await load_day_or_404(user["_id"], date)
    settings = await get_settings(user["_id"])
    _, task = find_task(day, taskid)
    E.pause_task(task, E.now_utc())
    await save_day(day)
    return await computed_response(day, now_min, settings)


@api.post("/day/{date}/tasks/{taskid}/complete")
async def complete_task(date: str, taskid: str, now_min: int, user: dict = Depends(current_user)):
    day = await load_day_or_404(user["_id"], date)
    settings = await get_settings(user["_id"])
    now_dt = E.now_utc()
    before = copy.deepcopy(day)
    block, task = find_task(day, taskid)
    E.pause_task(task, now_dt)
    task["done"] = True
    task["active_since"] = None
    freed = E.remaining_future_min(day, block["id"], task.get("tkey"), now_dt)
    undo = None
    if freed >= 1:
        undo = {"id": await push_undo(before, f"'{task['title']}' marked done — {round(freed)}m still planned later today"),
                "label": f"'{task['title']}' marked done — {round(freed)}m still planned later today",
                "freed_later_min": freed}
    await save_day(day)
    reward = await maybe_reward(user["_id"], settings)
    return await computed_response(day, now_min, settings, undo=undo, reward=reward)


@api.post("/day/{date}/tasks/{taskid}/pull-forward")
async def pull_forward_task(date: str, taskid: str, body: PullForwardIn, now_min: int, user: dict = Depends(current_user)):
    """Pull a user-selected amount from future same-day recurring/carry allocations into the current task."""
    day = await load_day_or_404(user["_id"], date)
    settings = await get_settings(user["_id"])
    now_dt = E.now_utc()
    before = copy.deepcopy(day)
    block, task = find_task(day, taskid)
    if task.get("type") not in ("recurring", "carry"):
        raise HTTPException(400, "Only recurring or carried tasks can pull future time forward")
    E.pause_task(task, now_dt)
    pulled = E.pull_forward(day, block["id"], taskid, body.minutes, now_dt)
    if pulled < 0.5:
        raise HTTPException(400, "No future time remains to pull forward for this task today")
    label = f"'{task['title']}' pulled {round(pulled)}m forward"
    undo = {"id": await push_undo(before, label), "label": label}
    await save_day(day)
    reward = await maybe_reward(user["_id"], settings)
    return await computed_response(day, now_min, settings, undo=undo, reward=reward)


@api.post("/day/{date}/tasks/{taskid}/finish-day")
async def finish_task_for_day(date: str, taskid: str, now_min: int, user: dict = Depends(current_user)):
    """Task is 100% done for the whole day: pull remaining future time forward and free it."""
    day = await load_day_or_404(user["_id"], date)
    settings = await get_settings(user["_id"])
    now_dt = E.now_utc()
    before = copy.deepcopy(day)
    block, task = find_task(day, taskid)
    E.pause_task(task, now_dt)
    pulled = E.pull_forward(day, block["id"], taskid, 10 ** 6, now_dt)
    task["done"] = True
    task["completed_early"] = True
    task["active_since"] = None
    label = f"'{task['title']}' finished for the whole day — {round(pulled)}m freed from later blocks"
    undo = {"id": await push_undo(before, label), "label": label, "freed_later_min": pulled}
    await save_day(day)
    reward = await maybe_reward(user["_id"], settings)
    return await computed_response(day, now_min, settings, undo=undo, reward=reward)


@api.post("/day/{date}/tasks/{taskid}/skip")
async def skip_task(date: str, taskid: str, now_min: int, whole_day: bool = False, user: dict = Depends(current_user)):
    day = await load_day_or_404(user["_id"], date)
    settings = await get_settings(user["_id"])
    before = copy.deepcopy(day)
    _, task = find_task(day, taskid)
    targets = [task]
    if whole_day and task.get("tkey"):
        targets = [t for b in day["blocks"] for t in b["tasks"]
                   if t.get("tkey") == task["tkey"] and not t.get("done")]
    for t in targets:
        E.pause_task(t, E.now_utc())
        t["skipped"] = True
        t["active_since"] = None
    label = (f"'{task['title']}' dropped for the rest of the day"
             if whole_day else f"'{task['title']}' dropped — its time went back to the block")
    undo = {"id": await push_undo(before, label), "label": label}
    await save_day(day)
    return await computed_response(day, now_min, settings, undo=undo)


@api.post("/day/{date}/tasks/{taskid}/extend")
async def extend_task(date: str, taskid: str, body: ExtendIn, now_min: int, user: dict = Depends(current_user)):
    day = await load_day_or_404(user["_id"], date)
    settings = await get_settings(user["_id"])
    before = copy.deepcopy(day)
    _, task = find_task(day, taskid)
    task["extra_min"] = round(task.get("extra_min", 0) + body.minutes, 2)
    task["overrun_acknowledged"] = True
    label = f"'{task['title']}' extended by {body.minutes}m — other tasks in this block were rebalanced"
    undo = {"id": await push_undo(before, label), "label": label}
    await save_day(day)
    return await computed_response(day, now_min, settings, undo=undo)


@api.post("/day/{date}/tasks/{taskid}/subtasks")
async def add_subtask(date: str, taskid: str, body: SubtaskIn, now_min: int, user: dict = Depends(current_user)):
    day = await load_day_or_404(user["_id"], date)
    settings = await get_settings(user["_id"])
    _, task = find_task(day, taskid)
    task.setdefault("subtasks", []).append({"id": E.new_id(), "title": body.title, "done": False})
    await save_day(day)
    return await computed_response(day, now_min, settings)


@api.post("/day/{date}/tasks/{taskid}/subtasks/{sid}/toggle")
async def toggle_subtask(date: str, taskid: str, sid: str, now_min: int, user: dict = Depends(current_user)):
    day = await load_day_or_404(user["_id"], date)
    settings = await get_settings(user["_id"])
    _, task = find_task(day, taskid)
    sub = next((s for s in task.get("subtasks", []) if s["id"] == sid), None)
    if not sub:
        raise HTTPException(404, "Sub-item not found")
    sub["done"] = not sub["done"]
    await save_day(day)
    reward = await maybe_reward(user["_id"], settings) if sub["done"] else None
    return await computed_response(day, now_min, settings, reward=reward)


@api.delete("/day/{date}/tasks/{taskid}/subtasks/{sid}")
async def delete_subtask(date: str, taskid: str, sid: str, now_min: int, user: dict = Depends(current_user)):
    day = await load_day_or_404(user["_id"], date)
    settings = await get_settings(user["_id"])
    _, task = find_task(day, taskid)
    task["subtasks"] = [s for s in task.get("subtasks", []) if s["id"] != sid]
    await save_day(day)
    return await computed_response(day, now_min, settings)


@api.post("/day/{date}/decisions")
async def resolve_decision(date: str, body: DecisionIn, now_min: int, user: dict = Depends(current_user)):
    day = await load_day_or_404(user["_id"], date)
    settings = await get_settings(user["_id"])
    before = copy.deepcopy(day)
    block = find_block(day, body.block_id)
    label = None

    if body.action == "protect":
        _, task = find_task(day, body.task_id)
        task["protection_decision"] = "protect"
        label = f"'{task['title']}' keeps its minimum — other tasks in this block were trimmed"
    elif body.action == "accept_shorter":
        _, task = find_task(day, body.task_id)
        task["protection_decision"] = "accept"
        label = f"'{task['title']}' will run shorter than its minimum today"
    elif body.action == "drop_task":
        _, task = find_task(day, body.task_id)
        task["skipped"] = True
        task["active_since"] = None
        label = f"'{task['title']}' dropped from today"
    elif body.action == "push_block":
        minutes = max(5, body.minutes or 15)
        ordered = sorted(day["blocks"], key=lambda b: E.t2m(b["start"]))
        idx = next(i for i, b in enumerate(ordered) if b["id"] == block["id"])
        room = (E.t2m(ordered[idx + 1]["start"]) - settings["buffer_min"] - E.t2m(block["end"])) if idx + 1 < len(ordered) else (24 * 60 - E.t2m(block["end"]))
        gained = min(minutes, max(0, room))
        if gained < 1:
            raise HTTPException(400, "There is no room to push this block — the next block starts right after it")
        block["end"] = E.m2t(E.t2m(block["end"]) + gained)
        block["delay_acknowledged"] = True
        normalize_buffers(day["blocks"], settings["buffer_min"])
        label = f"'{block['name']}' extended by {round(gained)}m"
    elif body.action == "absorb":
        block["delay_acknowledged"] = True
        label = f"Delay absorbed — '{block['name']}' rebalanced around the time left"
    elif body.action == "acknowledge_overrun":
        _, task = find_task(day, body.task_id)
        task["overrun_acknowledged"] = True
        label = f"Overrun on '{task['title']}' accepted"
    else:
        raise HTTPException(400, "Unknown decision action")

    await save_day(day)
    undo = {"id": await push_undo(before, label), "label": label}
    return await computed_response(day, now_min, settings, undo=undo)


class MoveIn(BaseModel):
    to_block_id: str


class DeferIn(BaseModel):
    to_date: str


class WeekAssignIn(BaseModel):
    template_id: str
    dates: List[str]


def move_task_between(container: dict, task_id: str, to_block_id: str) -> str:
    src, task = None, None
    for b in container["blocks"]:
        for t in b["tasks"]:
            if t["id"] == task_id:
                src, task = b, t
    if not task:
        raise HTTPException(404, "Task not found")
    dst = find_block(container, to_block_id)
    if dst["id"] == src["id"]:
        return ""
    note = ""
    if task["type"] == "fixed":
        dur = task.get("fixed_duration_min", 0)
        if E.t2m(dst["end"]) - E.t2m(dst["start"]) < dur:
            raise HTTPException(400, f"'{dst['name']}' is shorter than the {dur}-minute fixed slot")
        fs = E.t2m(task.get("fixed_start") or dst["start"])
        if fs < E.t2m(dst["start"]) or fs + dur > E.t2m(dst["end"]):
            task["fixed_start"] = dst["start"]
            note = f" Its fixed time moved to {dst['start']} to fit the block."
    if task["type"] in ("recurring", "carry"):
        twin = next((t for t in dst["tasks"]
                     if t.get("tkey") == task.get("tkey") and t["type"] in ("recurring", "carry")), None)
        used = sum(t.get("share_pct", 0) for t in dst["tasks"]
                   if t["type"] == "recurring" and t is not twin)
        slack = 100 - used
        if slack < 1 and not (twin and twin["type"] == "carry"):
            raise HTTPException(400, f"'{dst['name']}' is already fully shared — free up some percentage there first")
        wanted = task.get("share_pct", 0) + (twin.get("share_pct", 0) if twin else 0)
        final = min(wanted, slack)
        if twin:
            # Merge into the existing twin, preserving both share_pct (recurring) and carry_min (carry).
            twin["share_pct"] = max(twin.get("share_pct", 0), final)
            twin["carry_min"] = round(twin.get("carry_min", 0) + task.get("carry_min", 0), 2)
            twin["spent_min"] = round(twin.get("spent_min", 0) + task.get("spent_min", 0), 2)
            twin["must_today"] = twin.get("must_today", False) or task.get("must_today", False)
            src["tasks"] = [t for t in src["tasks"] if t["id"] != task_id]
            kind = "carry" if twin["type"] == "carry" else "block"
            return (f"'{task['title']}' merged into the existing {kind} slot in {dst['name']}.")
        if final < task.get("share_pct", 0):
            note = f" Its share shrank to {final:.0f}% to fit the slack there."
        task["share_pct"] = final
    src["tasks"] = [t for t in src["tasks"] if t["id"] != task_id]
    dst["tasks"].append(task)
    return f"'{task['title']}' moved to {dst['name']}.{note}"


@api.post("/templates/{tid}/tasks/{taskid}/move")
async def move_template_task(tid: str, taskid: str, body: MoveIn, user: dict = Depends(current_user)):
    tpl = await get_template(user["_id"], tid)
    move_task_between(tpl, taskid, body.to_block_id)
    return await save_template(tpl)


@api.post("/day/{date}/tasks/{taskid}/move")
async def move_day_task(date: str, taskid: str, body: MoveIn, now_min: int, user: dict = Depends(current_user)):
    day = await load_day_or_404(user["_id"], date)
    settings = await get_settings(user["_id"])
    before = copy.deepcopy(day)
    label = move_task_between(day, taskid, body.to_block_id)
    await save_day(day)
    undo = {"id": await push_undo(before, label), "label": label} if label else None
    return await computed_response(day, now_min, settings, undo=undo)


@api.post("/day/{date}/tasks/{taskid}/defer")
async def defer_task(date: str, taskid: str, body: DeferIn, now_min: int, user: dict = Depends(current_user)):
    day = await load_day_or_404(user["_id"], date)
    settings = await get_settings(user["_id"])
    before = copy.deepcopy(day)
    _, task = find_task(day, taskid)

    target = await load_day(user["_id"], body.to_date)
    if not target:
        if not day.get("template_id"):
            raise HTTPException(400, f"{body.to_date} has no plan yet — assign a template to that day first")
        tpl = await get_template(user["_id"], day["template_id"])
        target = E.materialize_day(tpl, body.to_date, user["_id"])
    if not target["blocks"]:
        raise HTTPException(400, f"{body.to_date} has no blocks to put this in")

    fresh = E.new_day_task({
        "title": task["title"], "type": "recurring" if task["type"] == "carry" else task["type"],
        "share_pct": task.get("share_pct", 0) or 20, "min_minutes": task.get("min_minutes", 0),
        "must_today": task.get("must_today", False), "fixed_start": task.get("fixed_start"),
        "fixed_duration_min": task.get("fixed_duration_min", 0), "notes": task.get("notes", ""),
        "subtasks": [{"title": s["title"]} for s in task.get("subtasks", []) if not s.get("done")],
    })

    blocks = sorted(target["blocks"], key=lambda b: E.t2m(b["start"]))
    placed = None
    for b in blocks:
        if fresh["type"] == "recurring":
            slack = 100 - sum(t.get("share_pct", 0) for t in b["tasks"] if t["type"] == "recurring")
            if slack < 1:
                continue
            fresh["share_pct"] = min(fresh["share_pct"], slack)
        elif fresh["type"] == "fixed":
            dur = fresh.get("fixed_duration_min", 0)
            if E.t2m(b["end"]) - E.t2m(b["start"]) < dur:
                continue
            fs = E.t2m(fresh.get("fixed_start") or b["start"])
            if fs < E.t2m(b["start"]) or fs + dur > E.t2m(b["end"]):
                fresh["fixed_start"] = b["start"]
        b["tasks"].append(fresh)
        placed = b
        break
    if not placed:
        raise HTTPException(400, f"No block on {body.to_date} has room for '{task['title']}'")

    await save_day(target)
    for t in [x for b in day["blocks"] for x in b["tasks"]
              if x.get("tkey") == task.get("tkey") and not x.get("done")] or [task]:
        t["skipped"] = True
        t["active_since"] = None
        t["deferred_to"] = body.to_date
    label = f"'{task['title']}' moved to {placed['name']} on {body.to_date}"
    await save_day(day)
    undo = {"id": await push_undo(before, label), "label": label}
    out = await computed_response(day, now_min, settings, undo=undo)
    out["message"] = label
    return out


@api.get("/week")
async def read_week(start: str, user: dict = Depends(current_user)):
    first = date_cls.fromisoformat(start)
    dates = [(first + timedelta(days=i)).isoformat() for i in range(7)]
    docs = await db.days.find({"user_id": user["_id"], "date": {"$in": dates}}, {"_id": 0}).to_list(7)
    by_date = {d["date"]: d for d in docs}
    out = []
    for d in dates:
        doc = by_date.get(d)
        out.append({
            "date": d,
            "exists": bool(doc),
            "template_name": doc.get("template_name") if doc else None,
            "block_count": len(doc["blocks"]) if doc else 0,
            "task_count": sum(len(b["tasks"]) for b in doc["blocks"]) if doc else 0,
        })
    return {"start": start, "days": out}


@api.post("/week/assign")
async def assign_week(body: WeekAssignIn, user: dict = Depends(current_user)):
    tpl = await get_template(user["_id"], body.template_id)
    if not tpl["blocks"]:
        raise HTTPException(400, "This template has no blocks yet")
    assigned, skipped = [], []
    for d in body.dates:
        if await load_day(user["_id"], d):
            skipped.append(d)
            continue
        await save_day(E.materialize_day(tpl, d, user["_id"]))
        assigned.append(d)
    return {"assigned": assigned, "skipped": skipped, "template_name": tpl["name"]}


@api.post("/undo/{snap_id}")
async def undo(snap_id: str, now_min: int, user: dict = Depends(current_user)):
    from bson import ObjectId
    snap = await db.undo_snapshots.find_one({"_id": ObjectId(snap_id), "user_id": user["_id"]})
    if not snap:
        raise HTTPException(404, "Nothing to undo")
    day = snap["day"]
    day.pop("_id", None)
    await db.days.replace_one({"user_id": user["_id"], "date": snap["date"]}, day, upsert=True)
    await db.undo_snapshots.delete_one({"_id": ObjectId(snap_id)})
    settings = await get_settings(user["_id"])
    out = await computed_response(day, now_min, settings)
    out["exists"] = True
    return out


# ---------- startup ----------
STARTER = {
    "name": "University Day",
    "blocks": [
        {"name": "Morning – University", "start": "08:30", "end": "12:30", "tasks": [
            {"title": "Lecture: Statistics", "type": "fixed", "fixed_start": "09:00", "fixed_duration_min": 90, "notes": ""},
            {"title": "Lecture notes review", "type": "recurring", "share_pct": 40, "min_minutes": 40, "must_today": True, "notes": "Rewrite the messy parts while they are still fresh."},
            {"title": "Reading list", "type": "recurring", "share_pct": 30, "min_minutes": 0},
        ]},
        {"name": "Afternoon – Deep work", "start": "14:00", "end": "17:00", "tasks": [
            {"title": "Thesis writing", "type": "recurring", "share_pct": 60, "min_minutes": 60, "must_today": True,
             "subtasks": [{"title": "Re-read yesterday's page"}, {"title": "Write 300 words"}, {"title": "Fix one citation"}]},
            {"title": "Email & admin", "type": "recurring", "share_pct": 20},
            {"title": "Renew library books", "type": "one_off"},
        ]},
        {"name": "Evening – Personal", "start": "19:00", "end": "22:00", "tasks": [
            {"title": "Reading", "type": "recurring", "share_pct": 30, "min_minutes": 30},
            {"title": "Language practice", "type": "recurring", "share_pct": 25},
            {"title": "Plan tomorrow", "type": "one_off"},
        ]},
    ],
}


async def seed_starter_template(user_id: str):
    if await db.templates.find_one({"user_id": user_id}):
        return
    blocks = []
    for b in STARTER["blocks"]:
        tasks = []
        for t in b["tasks"]:
            tasks.append({"id": E.new_id(), "title": t["title"], "type": t["type"],
                          "share_pct": t.get("share_pct", 0), "min_minutes": t.get("min_minutes", 0),
                          "must_today": t.get("must_today", False), "fixed_start": t.get("fixed_start"),
                          "fixed_duration_min": t.get("fixed_duration_min", 0), "notes": t.get("notes", ""),
                          "subtasks": t.get("subtasks", [])})
        blocks.append({"id": E.new_id(), "name": b["name"], "start": b["start"], "end": b["end"],
                       "buffer_after_min": 5, "tasks": tasks})
    await db.templates.insert_one({"id": E.new_id(), "user_id": user_id, "name": STARTER["name"],
                                   "blocks": blocks, "created_at": datetime.now(timezone.utc).isoformat()})


@app.on_event("startup")
async def startup():
    await db.users.create_index("email", unique=True)
    await db.login_attempts.create_index("identifier")
    await db.days.create_index([("user_id", 1), ("date", 1)])
    await db.undo_snapshots.create_index("created_at", expireAfterSeconds=3600)
    admin_email = os.environ.get("ADMIN_EMAIL", "").strip().lower()
    admin_password = os.environ.get("ADMIN_PASSWORD", "")
    if admin_email and admin_password:
        existing = await db.users.find_one({"email": admin_email})
        if existing is None:
            res = await db.users.insert_one({"email": admin_email, "password_hash": A.hash_password(admin_password),
                                             "name": "Admin", "role": "admin",
                                             "created_at": datetime.now(timezone.utc).isoformat()})
            await seed_starter_template(str(res.inserted_id))
        else:
            if not A.verify_password(admin_password, existing["password_hash"]):
                await db.users.update_one({"_id": existing["_id"]}, {"$set": {"password_hash": A.hash_password(admin_password)}})
            await seed_starter_template(str(existing["_id"]))


@api.get("/push/config")
async def push_config():
    return {"enabled": bool(os.environ.get("VAPID_PUBLIC_KEY")), "public_key": os.environ.get("VAPID_PUBLIC_KEY", "")}


@api.post("/push/subscribe")
async def push_subscribe(body: PushSubscriptionIn, user: dict = Depends(current_user)):
    doc = {"endpoint": body.endpoint, "keys": body.keys, "timezone": body.timezone or "UTC", "created_at": datetime.now(timezone.utc).isoformat()}
    await db.push_subscriptions.update_one({"user_id": user["_id"], "endpoint": body.endpoint}, {"$set": doc, "$setOnInsert": {"user_id": user["_id"]}}, upsert=True)
    return {"ok": True}


@api.delete("/push/subscribe")
async def push_unsubscribe(endpoint: str, user: dict = Depends(current_user)):
    await db.push_subscriptions.delete_one({"user_id": user["_id"], "endpoint": endpoint})
    return {"ok": True}


@api.post("/push/dispatch-due")
async def push_dispatch_due(request: Request):
    secret = os.environ.get("PUSH_CRON_SECRET", "")
    if not secret or request.headers.get("X-Push-Cron-Secret") != secret:
        raise HTTPException(401, "Unauthorized")
    if not webpush or not os.environ.get("VAPID_PRIVATE_KEY") or not os.environ.get("VAPID_CLAIMS_EMAIL"):
        return {"sent": 0, "enabled": False}
    now_utc = datetime.now(timezone.utc)
    sent = 0
    users = await db.users.find({}, {"_id": 1, "email": 1}).to_list(1000)
    from zoneinfo import ZoneInfo
    for u in users:
        settings = await get_settings(str(u["_id"]))
        if not settings.get("notifications_enabled", True):
            continue
        subs = await db.push_subscriptions.find({"user_id": str(u["_id"])}).to_list(50)
        for sub in subs:
            tzname = sub.get("timezone") or "UTC"
            try:
                local = now_utc.astimezone(ZoneInfo(tzname))
            except Exception:
                local = now_utc
            day = await load_day(str(u["_id"]), local.date().isoformat())
            if not day:
                continue
            current_hm = local.hour * 60 + local.minute
            for b in day.get("blocks", []):
                if E.t2m(b["start"]) != current_hm or b.get("reminded_at"):
                    continue
                payload = {"title": f"{b['name']} starts now", "body": f"{b['start']} – {b['end']}", "url": "/"}
                delivered = False
                for candidate in subs:
                    try:
                        webpush(subscription_info={"endpoint": candidate["endpoint"], "keys": candidate["keys"]}, data=__import__('json').dumps(payload), vapid_private_key=os.environ["VAPID_PRIVATE_KEY"], vapid_claims={"sub": os.environ["VAPID_CLAIMS_EMAIL"]}, ttl=300)
                        sent += 1; delivered = True
                    except Exception:
                        await db.push_subscriptions.delete_one({"_id": candidate["_id"]})
                if delivered:
                    b["reminded_at"] = now_utc.isoformat()
            await save_day(day)
    return {"sent": sent, "enabled": True}


@api.get("/")
async def root():
    return {"service": "dynamic-day", "ok": True}


app.include_router(api)
cors_origins = [x.strip() for x in os.environ.get("CORS_ORIGINS", "http://localhost:3000").split(",") if x.strip()]
app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
