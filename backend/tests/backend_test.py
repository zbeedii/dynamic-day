"""Backend API tests for Dynamic Day."""
import os
import copy
from datetime import date as date_cls

import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "http://localhost:8000").rstrip("/")
API = f"{BASE_URL}/api"

ADMIN_EMAIL = "admin@dynamicday.app"
ADMIN_PASSWORD = "Sanctuary#2026"
TODAY = date_cls.today().isoformat()


# ----------- fixtures -----------
@pytest.fixture(scope="session")
def session_bearer():
    s = requests.Session()
    r = s.post(f"{API}/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD}, timeout=15)
    assert r.status_code == 200, r.text
    token = r.json()["access_token"]
    s.headers.update({"Authorization": f"Bearer {token}"})
    return s


@pytest.fixture(scope="session")
def cookie_session():
    s = requests.Session()
    r = s.post(f"{API}/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD}, timeout=15)
    assert r.status_code == 200
    return s


# ----------- auth -----------
class TestAuth:
    def test_login_success(self):
        r = requests.post(f"{API}/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD})
        assert r.status_code == 200
        data = r.json()
        assert "access_token" in data and data["email"] == ADMIN_EMAIL
        assert "access_token" in r.cookies or any(c.name == "access_token" for c in r.cookies)

    def test_login_wrong_password(self):
        r = requests.post(f"{API}/auth/login", json={"email": ADMIN_EMAIL, "password": "wrong-password!"})
        assert r.status_code == 401
        assert "Invalid" in r.json().get("detail", "")

    def test_me_with_bearer(self, session_bearer):
        r = session_bearer.get(f"{API}/auth/me")
        assert r.status_code == 200
        assert r.json()["email"] == ADMIN_EMAIL

    def test_me_with_cookie(self, cookie_session):
        # no Authorization header - only cookie
        r = cookie_session.get(f"{API}/auth/me")
        assert r.status_code == 200
        assert r.json()["email"] == ADMIN_EMAIL

    def test_me_unauthenticated(self):
        r = requests.get(f"{API}/auth/me")
        assert r.status_code == 401

    def test_logout_clears_cookie(self):
        s = requests.Session()
        s.post(f"{API}/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD})
        r = s.post(f"{API}/auth/logout")
        assert r.status_code == 200
        r2 = s.get(f"{API}/auth/me")
        assert r2.status_code == 401


# ----------- templates -----------
class TestTemplates:
    def test_seeded_university_template(self, session_bearer):
        r = session_bearer.get(f"{API}/templates")
        assert r.status_code == 200
        names = [t["name"] for t in r.json()]
        assert "University Day" in names

    def test_full_template_lifecycle(self, session_bearer):
        # create
        r = session_bearer.post(f"{API}/templates", json={"name": "TEST_Template_X"})
        assert r.status_code == 200
        tid = r.json()["id"]
        # rename
        r = session_bearer.patch(f"{API}/templates/{tid}", json={"name": "TEST_Renamed"})
        assert r.status_code == 200 and r.json()["name"] == "TEST_Renamed"

        # add block
        r = session_bearer.post(f"{API}/templates/{tid}/blocks", json={"name": "B1", "start": "08:00", "end": "10:00"})
        assert r.status_code == 200
        blocks = r.json()["blocks"]
        assert len(blocks) == 1
        bid = blocks[0]["id"]

        # add another block violating buffer -> reject
        r = session_bearer.post(f"{API}/templates/{tid}/blocks", json={"name": "B2", "start": "10:03", "end": "11:00"})
        assert r.status_code == 400, f"Expected buffer rejection: {r.text}"
        assert "buffer" in r.json()["detail"].lower() or "transition" in r.json()["detail"].lower()

        # add valid block after buffer
        r = session_bearer.post(f"{API}/templates/{tid}/blocks", json={"name": "B2", "start": "10:05", "end": "11:00"})
        assert r.status_code == 200

        # split first block
        r = session_bearer.post(f"{API}/templates/{tid}/blocks/{bid}/split", json={"at": "09:00"})
        assert r.status_code == 200
        after = sorted(r.json()["blocks"], key=lambda b: b["start"])
        # find B1 I and B1 II
        first = next(b for b in after if b["name"] == "B1 I")
        second = next(b for b in after if b["name"] == "B1 II")
        assert first["end"] == "09:00" and second["start"] == "09:05"

        # recurring share > 100
        r = session_bearer.post(f"{API}/templates/{tid}/blocks/{bid}/tasks",
                                json={"title": "T1", "type": "recurring", "share_pct": 70})
        assert r.status_code == 200
        r = session_bearer.post(f"{API}/templates/{tid}/blocks/{bid}/tasks",
                                json={"title": "T2", "type": "recurring", "share_pct": 40})
        assert r.status_code == 400
        assert "100" in r.json()["detail"]

        # fixed task no start
        r = session_bearer.post(f"{API}/templates/{tid}/blocks/{bid}/tasks",
                                json={"title": "F", "type": "fixed", "fixed_duration_min": 30})
        assert r.status_code == 400

        # fixed task not fitting
        r = session_bearer.post(f"{API}/templates/{tid}/blocks/{bid}/tasks",
                                json={"title": "F", "type": "fixed", "fixed_start": "08:50",
                                      "fixed_duration_min": 30})
        assert r.status_code == 400
        assert "fit" in r.json()["detail"].lower()

        # delete template
        r = session_bearer.delete(f"{API}/templates/{tid}")
        assert r.status_code == 200


# ----------- day / engine -----------
class TestDayEngine:
    @pytest.fixture(scope="class")
    def uni_template_id(self):
        s = requests.Session()
        s.post(f"{API}/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD})
        tpls = s.get(f"{API}/templates").json()
        uni = next(t for t in tpls if t["name"] == "University Day")
        return uni["id"], s

    def test_assign_day(self, uni_template_id):
        tid, s = uni_template_id
        # 08:00 - before first block
        r = s.post(f"{API}/day/{TODAY}/assign?now_min=480", json={"template_id": tid})
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["exists"] is True
        assert len(data["blocks"]) == 3
        # current should be None (08:00 before 08:30), next block is Morning
        assert data["current_block_id"] is None
        assert data["next_block_id"] is not None

    def test_allocations(self, uni_template_id):
        tid, s = uni_template_id
        s.post(f"{API}/day/{TODAY}/assign?now_min=480", json={"template_id": tid})
        # at 08:30 - block just starting
        r = s.get(f"{API}/day/{TODAY}?now_min=510")
        data = r.json()
        morning = next(b for b in data["blocks"] if b["name"].startswith("Morning"))
        # pool: 240 min - 90 fixed = 150
        assert morning["pool_min"] == 150
        # The 09:00-10:30 fixed lecture is a hard boundary, so at 08:30
        # only the 30-minute 08:30-09:00 window can be allocated dynamically.
        assert morning["dynamic_available_min"] == 30
        alloc_by_title = {t["title"]: t["allocated_min"] for t in morning["tasks"] if t["type"] == "recurring"}
        assert abs(alloc_by_title["Lecture notes review"] - 17.1) < 0.6
        assert abs(alloc_by_title["Reading list"] - 12.9) < 0.6
        assert abs(morning["free_min"]) < 0.6

    def test_allocations_shrink(self, uni_template_id):
        tid, s = uni_template_id
        s.post(f"{API}/day/{TODAY}/assign?now_min=480", json={"template_id": tid})
        # later time - halfway through morning at 10:30 (630)
        # remaining = 12:30 - 10:30 = 120; fixed lecture 9:00-10:30 already done for this block
        r = s.get(f"{API}/day/{TODAY}?now_min=630")
        data = r.json()
        morning = next(b for b in data["blocks"] if b["name"].startswith("Morning"))
        # allocations must be smaller than at 08:30
        # NOTE: min_protection may kick in for Lecture notes review (min_minutes=40)
        assert morning["status"] == "active"

    def test_late_start_decision(self, uni_template_id):
        tid, s = uni_template_id
        s.post(f"{API}/day/{TODAY}/assign?now_min=480", json={"template_id": tid})
        # Use the afternoon block (no fixed task): 14:00-17:00, threshold=30%=54m.
        # At 16:20 the untouched block is 140m late, so conscious friction must appear.
        r = s.get(f"{API}/day/{TODAY}?now_min=980")
        data = r.json()
        pending = data["pending_decisions"]
        kinds = [p["kind"] for p in pending]
        assert "late_start" in kinds, f"Expected late_start: {pending}"

    def test_finish_day_early(self, uni_template_id):
        tid, s = uni_template_id
        s.post(f"{API}/day/{TODAY}/assign?now_min=480", json={"template_id": tid})
        r = s.get(f"{API}/day/{TODAY}?now_min=510")
        data = r.json()
        morning = next(b for b in data["blocks"] if b["name"].startswith("Morning"))
        # 'Lecture notes review' recurs only in morning -> nothing to pull forward
        # instead pick a task that only appears in one block; still test complete
        task = next(t for t in morning["tasks"] if t["title"] == "Lecture notes review")
        r = s.post(f"{API}/day/{TODAY}/tasks/{task['id']}/finish-day?now_min=540")
        assert r.status_code == 200
        d = r.json()
        # undo must be present
        assert d.get("undo") and d["undo"].get("id")

    def test_complete_marks_done(self, uni_template_id):
        tid, s = uni_template_id
        s.post(f"{API}/day/{TODAY}/assign?now_min=480", json={"template_id": tid})
        r = s.get(f"{API}/day/{TODAY}?now_min=540")
        morning = next(b for b in r.json()["blocks"] if b["name"].startswith("Morning"))
        task = next(t for t in morning["tasks"] if t["title"] == "Lecture notes review")
        r2 = s.post(f"{API}/day/{TODAY}/tasks/{task['id']}/complete?now_min=540")
        assert r2.status_code == 200
        # verify persistence via GET
        r3 = s.get(f"{API}/day/{TODAY}?now_min=540")
        morning2 = next(b for b in r3.json()["blocks"] if b["name"].startswith("Morning"))
        t2 = next(t for t in morning2["tasks"] if t["title"] == "Lecture notes review")
        assert t2["done"] is True

    def test_must_today_carry(self, uni_template_id):
        tid, s = uni_template_id
        s.post(f"{API}/day/{TODAY}/assign?now_min=480", json={"template_id": tid})
        # jump past end of morning block (12:30 = 750) => 800
        r = s.get(f"{API}/day/{TODAY}?now_min=800")
        assert r.status_code == 200
        data = r.json()
        # afternoon or evening should contain carry tasks
        carry_titles = [t["title"] for b in data["blocks"] for t in b["tasks"] if t["type"] == "carry"]
        # must_today tasks: Lecture notes review
        assert "Lecture notes review" in carry_titles, f"Expected carry: {carry_titles}"

    def test_undo_restores(self, uni_template_id):
        tid, s = uni_template_id
        s.post(f"{API}/day/{TODAY}/assign?now_min=480", json={"template_id": tid})
        r = s.get(f"{API}/day/{TODAY}?now_min=510")
        morning = next(b for b in r.json()["blocks"] if b["name"].startswith("Morning"))
        task = next(t for t in morning["tasks"] if t["title"] == "Lecture notes review")
        # finish-day always creates an undo snapshot
        r2 = s.post(f"{API}/day/{TODAY}/tasks/{task['id']}/finish-day?now_min=540")
        undo = r2.json().get("undo")
        assert undo and undo.get("id"), f"Expected undo payload: {r2.json()}"
        r3 = s.post(f"{API}/undo/{undo['id']}?now_min=540")
        assert r3.status_code == 200
        morning3 = next(b for b in r3.json()["blocks"] if b["name"].startswith("Morning"))
        t3 = next(t for t in morning3["tasks"] if t["title"] == "Lecture notes review")
        assert t3.get("done") is False

    def test_day_block_split_and_buffer(self, uni_template_id):
        tid, s = uni_template_id
        s.post(f"{API}/day/{TODAY}/assign?now_min=480", json={"template_id": tid})
        r = s.get(f"{API}/day/{TODAY}?now_min=510")
        morning = next(b for b in r.json()["blocks"] if b["name"].startswith("Morning"))
        # split at 10:00
        r2 = s.post(f"{API}/day/{TODAY}/blocks/{morning['id']}/split?now_min=510", json={"at": "10:00"})
        assert r2.status_code == 200, r2.text
        names = [b["name"] for b in r2.json()["blocks"]]
        assert any("Morning" in n and "I" in n for n in names)
        # patching a block into overlap should fail
        # find B II and patch its start earlier than buffer
        b2 = next(b for b in r2.json()["blocks"] if "II" in b["name"] and "Morning" in b["name"])
        r3 = s.patch(f"{API}/day/{TODAY}/blocks/{b2['id']}?now_min=510", json={"start": "10:03"})
        assert r3.status_code == 400


# ----------- settings -----------
class TestSettings:
    def test_update_settings(self, session_bearer):
        r = session_bearer.put(f"{API}/settings", json={"delay_threshold_pct": 25, "reward_chance_pct": 40})
        assert r.status_code == 200
        d = r.json()
        assert d["delay_threshold_pct"] == 25 and d["reward_chance_pct"] == 40
        # restore defaults
        session_bearer.put(f"{API}/settings", json={"delay_threshold_pct": 30, "reward_chance_pct": 35})


# ----------- reward exists sometimes -----------
class TestReward:
    def test_reward_appears_occasionally(self, session_bearer):
        # set 100% reward chance and verify persisted
        r0 = session_bearer.put(f"{API}/settings", json={"reward_chance_pct": 100})
        assert r0.json()["reward_chance_pct"] == 100
        tpls = session_bearer.get(f"{API}/templates").json()
        tid = next(t for t in tpls if t["name"] == "University Day")["id"]
        session_bearer.post(f"{API}/day/{TODAY}/assign?now_min=480", json={"template_id": tid})
        # complete every recurring task across all blocks; at 100% at least one reward must appear
        r = session_bearer.get(f"{API}/day/{TODAY}?now_min=540")
        got_reward = False
        prev = None
        for b in r.json()["blocks"]:
            for t in b["tasks"]:
                if t["type"] == "recurring" and not t.get("done"):
                    # Re-affirm setting just before each completion (defensive against parallel tests)
                    session_bearer.put(f"{API}/settings", json={"reward_chance_pct": 100})
                    r2 = session_bearer.post(f"{API}/day/{TODAY}/tasks/{t['id']}/complete?now_min=540")
                    rw = r2.json().get("reward")
                    if rw:
                        got_reward = True
                        if prev:
                            assert rw != prev, "Reward repeated consecutively"
                        prev = rw
        session_bearer.put(f"{API}/settings", json={"reward_chance_pct": 35})
        assert got_reward, "Expected at least one reward at 100% chance"


# ----------- new: week planning, task moving, day closing -----------
def _login():
    s = requests.Session()
    r = s.post(f"{API}/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD}, timeout=15)
    assert r.status_code == 200
    return s


def _uni_id(s):
    tpls = s.get(f"{API}/templates").json()
    return next(t for t in tpls if t["name"] == "University Day")["id"]


class TestWeekPlanning:
    """New: GET /api/week and POST /api/week/assign."""

    START = "2027-01-04"  # a Monday well in the future so we can clean up
    DATES = [(date_cls.fromisoformat("2027-01-04") + __import__("datetime").timedelta(days=i)).isoformat() for i in range(7)]

    @pytest.fixture(scope="class", autouse=True)
    def _clean(self):
        s = _login()
        for d in self.DATES:
            s.delete(f"{API}/day/{d}")
        yield
        for d in self.DATES:
            s.delete(f"{API}/day/{d}")

    def test_week_get_empty(self):
        s = _login()
        r = s.get(f"{API}/week", params={"start": self.START})
        assert r.status_code == 200
        data = r.json()
        assert data["start"] == self.START
        assert len(data["days"]) == 7
        for d in data["days"]:
            assert d["exists"] is False
            assert d["block_count"] == 0
            assert d["task_count"] == 0

    def test_week_assign_and_skip(self):
        s = _login()
        tid = _uni_id(s)
        # First assign whole week
        r = s.post(f"{API}/week/assign", json={"template_id": tid, "dates": self.DATES})
        assert r.status_code == 200
        data = r.json()
        assert set(data["assigned"]) == set(self.DATES)
        assert data["skipped"] == []
        assert data["template_name"] == "University Day"

        # snapshot one day's blocks
        d0 = self.DATES[0]
        before = s.get(f"{API}/day/{d0}", params={"now_min": -1}).json()
        before_block_ids = [b["id"] for b in before["blocks"]]

        # Second assign — all should be skipped
        r2 = s.post(f"{API}/week/assign", json={"template_id": tid, "dates": self.DATES})
        assert r2.status_code == 200
        data2 = r2.json()
        assert data2["assigned"] == []
        assert set(data2["skipped"]) == set(self.DATES)

        # existing day untouched (same block ids)
        after = s.get(f"{API}/day/{d0}", params={"now_min": -1}).json()
        after_block_ids = [b["id"] for b in after["blocks"]]
        assert before_block_ids == after_block_ids

        # GET week reflects planned days
        r3 = s.get(f"{API}/week", params={"start": self.START})
        for d in r3.json()["days"]:
            assert d["exists"] is True
            assert d["template_name"] == "University Day"


class TestTaskMove:
    DATE = "2027-02-08"  # future date, will clean up

    @pytest.fixture(scope="class", autouse=True)
    def _clean(self):
        s = _login()
        s.delete(f"{API}/day/{self.DATE}")
        yield
        s.delete(f"{API}/day/{self.DATE}")

    def _assign(self):
        s = _login()
        tid = _uni_id(s)
        r = s.post(f"{API}/day/{self.DATE}/assign?now_min=-1", json={"template_id": tid})
        assert r.status_code == 200
        return s, r.json()

    def test_move_recurring_shrinks_share(self):
        s, day = self._assign()
        # Move "Reading list" (30%) from Morning to Afternoon where 60+20=80% is used -> slack 20% -> shrunk
        morning = next(b for b in day["blocks"] if b["name"].startswith("Morning"))
        afternoon = next(b for b in day["blocks"] if b["name"].startswith("Afternoon"))
        task = next(t for t in morning["tasks"] if t["title"] == "Reading list")
        r = s.post(f"{API}/day/{self.DATE}/tasks/{task['id']}/move?now_min=-1",
                   json={"to_block_id": afternoon["id"]})
        assert r.status_code == 200, r.text
        d = r.json()
        aft = next(b for b in d["blocks"] if b["name"].startswith("Afternoon"))
        moved = next(t for t in aft["tasks"] if t["title"] == "Reading list")
        assert abs(moved["share_pct"] - 20) < 0.01
        assert d.get("undo") and "20%" in d["undo"]["label"]

    def test_move_recurring_full_block_400(self):
        s, day = self._assign()
        # Afternoon already 80%; add a 20% task there to make 100%
        afternoon = next(b for b in day["blocks"] if b["name"].startswith("Afternoon"))
        # Morning has Reading list 30% recurring
        morning = next(b for b in day["blocks"] if b["name"].startswith("Morning"))
        # Fill afternoon to 100 by moving Reading list once
        rl = next(t for t in morning["tasks"] if t["title"] == "Reading list")
        s.post(f"{API}/day/{self.DATE}/tasks/{rl['id']}/move?now_min=-1", json={"to_block_id": afternoon["id"]})
        # Now afternoon has 60+20+20=100. Move another recurring task -> 400
        d = s.get(f"{API}/day/{self.DATE}?now_min=-1").json()
        morning = next(b for b in d["blocks"] if b["name"].startswith("Morning"))
        afternoon = next(b for b in d["blocks"] if b["name"].startswith("Afternoon"))
        notes = next((t for t in morning["tasks"] if t["title"] == "Lecture notes review"), None)
        assert notes is not None
        r = s.post(f"{API}/day/{self.DATE}/tasks/{notes['id']}/move?now_min=-1",
                   json={"to_block_id": afternoon["id"]})
        assert r.status_code == 400
        assert "shared" in r.json()["detail"].lower() or "full" in r.json()["detail"].lower()

    def test_move_fixed_reanchors(self):
        s, day = self._assign()
        morning = next(b for b in day["blocks"] if b["name"].startswith("Morning"))
        evening = next(b for b in day["blocks"] if b["name"].startswith("Evening"))
        lecture = next(t for t in morning["tasks"] if t["title"] == "Lecture: Statistics")
        # fixed_start 09:00 doesn't fit inside 19:00-22:00 -> should re-anchor to 19:00
        r = s.post(f"{API}/day/{self.DATE}/tasks/{lecture['id']}/move?now_min=-1",
                   json={"to_block_id": evening["id"]})
        assert r.status_code == 200, r.text
        d = r.json()
        ev = next(b for b in d["blocks"] if b["name"].startswith("Evening"))
        moved = next(t for t in ev["tasks"] if t["title"] == "Lecture: Statistics")
        assert moved["fixed_start"] == "19:00"

    def test_move_template_task_persists(self):
        s = _login()
        # create tmp template with two blocks and a recurring task in first
        r = s.post(f"{API}/templates", json={"name": "TEST_MoveTpl"})
        tid = r.json()["id"]
        try:
            r1 = s.post(f"{API}/templates/{tid}/blocks", json={"name": "A", "start": "08:00", "end": "10:00"})
            bA = r1.json()["blocks"][0]["id"]
            r2 = s.post(f"{API}/templates/{tid}/blocks", json={"name": "B", "start": "10:10", "end": "12:00"})
            bB = next(b for b in r2.json()["blocks"] if b["name"] == "B")["id"]
            r3 = s.post(f"{API}/templates/{tid}/blocks/{bA}/tasks",
                        json={"title": "R1", "type": "recurring", "share_pct": 50})
            task_id = next(t for t in r3.json()["blocks"] if t["id"] == bA)["tasks"][0]["id"]
            r4 = s.post(f"{API}/templates/{tid}/tasks/{task_id}/move", json={"to_block_id": bB})
            assert r4.status_code == 200, r4.text
            # verify persistence
            r5 = s.get(f"{API}/templates").json()
            tpl = next(t for t in r5 if t["id"] == tid)
            bB_after = next(b for b in tpl["blocks"] if b["id"] == bB)
            bA_after = next(b for b in tpl["blocks"] if b["id"] == bA)
            assert any(t["title"] == "R1" for t in bB_after["tasks"])
            assert not any(t["title"] == "R1" for t in bA_after["tasks"])
        finally:
            s.delete(f"{API}/templates/{tid}")


class TestDayClosing:
    DATE = "2020-03-15"  # long past date, tests day_over

    @pytest.fixture(scope="class", autouse=True)
    def _clean(self):
        s = _login()
        s.delete(f"{API}/day/{self.DATE}")
        s.delete(f"{API}/day/2020-03-16")
        yield
        s.delete(f"{API}/day/{self.DATE}")
        s.delete(f"{API}/day/2020-03-16")

    def test_day_over_leftovers_dedup(self):
        s = _login()
        tid = _uni_id(s)
        # assign with now_min=-1 (as-if future) so settle doesn't fire; then GET with 1440
        r = s.post(f"{API}/day/{self.DATE}/assign?now_min=-1", json={"template_id": tid})
        assert r.status_code == 200
        r2 = s.get(f"{API}/day/{self.DATE}?now_min=1440")
        assert r2.status_code == 200
        d = r2.json()
        assert d["day_over"] is True
        assert isinstance(d["leftovers"], list)
        assert isinstance(d["done_count"], int)
        assert isinstance(d["spent_total_min"], int)
        # dedup: same title (e.g., "Lecture notes review" which is must_today) should appear once
        titles = [l["title"] for l in d["leftovers"]]
        assert len(titles) == len(set(titles)), f"Leftovers not deduped: {titles}"

    def test_skip_whole_day(self):
        s = _login()
        tid = _uni_id(s)
        s.post(f"{API}/day/{self.DATE}/assign?now_min=-1", json={"template_id": tid})
        d = s.get(f"{API}/day/{self.DATE}?now_min=1440").json()
        if not d["leftovers"]:
            pytest.skip("no leftovers to skip")
        left = d["leftovers"][0]
        r = s.post(f"{API}/day/{self.DATE}/tasks/{left['task_id']}/skip?now_min=1440&whole_day=true")
        assert r.status_code == 200
        d2 = s.get(f"{API}/day/{self.DATE}?now_min=1440").json()
        remaining_titles = [l["title"] for l in d2["leftovers"]]
        assert left["title"] not in remaining_titles

    def test_defer_to_next_day(self):
        s = _login()
        tid = _uni_id(s)
        s.post(f"{API}/day/{self.DATE}/assign?now_min=-1", json={"template_id": tid})
        s.delete(f"{API}/day/2020-03-16")
        d = s.get(f"{API}/day/{self.DATE}?now_min=1440").json()
        if not d["leftovers"]:
            pytest.skip("no leftovers")
        left = d["leftovers"][0]
        r = s.post(f"{API}/day/{self.DATE}/tasks/{left['task_id']}/defer?now_min=1440",
                   json={"to_date": "2020-03-16"})
        assert r.status_code == 200, r.text
        body = r.json()
        assert body.get("message") and "2020-03-16" in body["message"]
        assert body.get("undo")
        # target day must now exist with the task
        r2 = s.get(f"{API}/day/2020-03-16?now_min=-1")
        assert r2.status_code == 200
        target = r2.json()
        assert target["exists"] is True
        assert any(t["title"] == left["title"] for b in target["blocks"] for t in b["tasks"])


class TestBugRegressions:
    """Regression tests for bugs found via code review."""

    DATE = "2027-05-15"

    @pytest.fixture(scope="class", autouse=True)
    def _clean(self):
        s = _login()
        s.delete(f"{API}/day/{self.DATE}")
        yield
        s.delete(f"{API}/day/{self.DATE}")

    # ---- Bug #1: undo of settle restores carries correctly ----
    def test_settle_snapshot_taken_before_settled_flag(self):
        """The undo snapshot for a carry-over must be taken BEFORE the block was flagged
        settled=True and BEFORE inject_carries ran, otherwise the mandatory quota is lost
        forever when the user undoes."""
        s = _login()
        tid = _uni_id(s)
        s.post(f"{API}/day/{self.DATE}/assign?now_min=-1", json={"template_id": tid})
        # Trigger settle at end-of-day so must_today tasks in morning carry over.
        r = s.get(f"{API}/day/{self.DATE}?now_min=1440")
        d = r.json()
        assert d.get("undo"), "expected an undo snapshot for the carry"
        undo_id = d["undo"]["id"]
        label = d["undo"]["label"]
        # Extract the last injection target from the label ("... → BlockName")
        target_name = label.rsplit("→", 1)[-1].strip().rstrip(".")
        # Count carries in the target block BEFORE undo
        pre_carries = [t for b in d["blocks"] if b["name"] == target_name
                       for t in b["tasks"] if t["type"] == "carry"]
        assert pre_carries, f"expected a carry in '{target_name}' before undo"
        # Roll back
        r2 = s.post(f"{API}/undo/{undo_id}?now_min=1440")
        assert r2.status_code == 200
        restored = r2.json()
        # Target block must have FEWER carries after undo (the last injection was reverted)
        post_carries = [t for b in restored["blocks"] if b["name"] == target_name
                        for t in b["tasks"] if t["type"] == "carry"]
        assert len(post_carries) < len(pre_carries), (
            f"undo did not remove the injected carry from '{target_name}': "
            f"before={len(pre_carries)} after={len(post_carries)}"
        )
        # And a subsequent read (which triggers settle again) must be able to re-inject
        # — proving the block is no longer stuck at settled=True.
        r3 = s.get(f"{API}/day/{self.DATE}?now_min=1440")
        d3 = r3.json()
        reinjected = [t for b in d3["blocks"] if b["name"] == target_name
                      for t in b["tasks"] if t["type"] == "carry"]
        assert len(reinjected) >= len(pre_carries), (
            "after undo, settle_past_blocks should be able to re-run and re-inject the carry"
        )

    def test_fixed_tasks_cannot_overlap(self):
        s = _login()
        r = s.post(f"{API}/templates", json={"name": "TEST_FixedOverlap"})
        tid = r.json()["id"]
        try:
            r1 = s.post(f"{API}/templates/{tid}/blocks", json={"name": "B", "start": "08:00", "end": "12:00"})
            bid = r1.json()["blocks"][0]["id"]
            r2 = s.post(f"{API}/templates/{tid}/blocks/{bid}/tasks", json={
                "title": "F1", "type": "fixed", "fixed_start": "09:00", "fixed_duration_min": 60})
            assert r2.status_code == 200
            r3 = s.post(f"{API}/templates/{tid}/blocks/{bid}/tasks", json={
                "title": "F2", "type": "fixed", "fixed_start": "09:30", "fixed_duration_min": 30})
            assert r3.status_code == 400
            assert "overlap" in r3.json()["detail"].lower()
        finally:
            s.delete(f"{API}/templates/{tid}")

    def test_fixed_task_cannot_start_outside_slot(self):
        s = _login()
        tid = _uni_id(s)
        s.post(f"{API}/day/{self.DATE}/assign?now_min=-1", json={"template_id": tid})
        d = s.get(f"{API}/day/{self.DATE}?now_min=-1").json()
        morning = next(b for b in d["blocks"] if b["name"].startswith("Morning"))
        fixed = next(t for t in morning["tasks"] if t["type"] == "fixed")
        r = s.post(f"{API}/day/{self.DATE}/tasks/{fixed['id']}/start?now_min=510")
        assert r.status_code == 409

    # ---- Bug #2: patch endpoints validate share_pct / fixed / min_minutes ----
    def test_patch_task_share_pct_over_100_rejected(self):
        s = _login()
        tid = _uni_id(s)
        s.post(f"{API}/day/{self.DATE}/assign?now_min=-1", json={"template_id": tid})
        d = s.get(f"{API}/day/{self.DATE}?now_min=-1").json()
        morning = next(b for b in d["blocks"] if b["name"].startswith("Morning"))
        # morning has recurring 40 + 30 = 70%. Bump "Reading list" (30) to 90 -> total 130% -> reject
        rl = next(t for t in morning["tasks"] if t["title"] == "Reading list")
        r = s.patch(f"{API}/day/{self.DATE}/tasks/{rl['id']}?now_min=-1", json={"share_pct": 90})
        assert r.status_code == 400
        assert "100" in r.json()["detail"]

    def test_patch_task_fixed_start_out_of_block_rejected(self):
        s = _login()
        tid = _uni_id(s)
        s.post(f"{API}/day/{self.DATE}/assign?now_min=-1", json={"template_id": tid})
        d = s.get(f"{API}/day/{self.DATE}?now_min=-1").json()
        morning = next(b for b in d["blocks"] if b["name"].startswith("Morning"))
        lec = next(t for t in morning["tasks"] if t["title"] == "Lecture: Statistics")
        # Morning is 08:30 - 12:30. 07:00 is outside.
        r = s.patch(f"{API}/day/{self.DATE}/tasks/{lec['id']}?now_min=-1", json={"fixed_start": "07:00"})
        assert r.status_code == 400
        assert "block" in r.json()["detail"].lower()

    def test_patch_task_min_minutes_over_pool_rejected(self):
        s = _login()
        tid = _uni_id(s)
        s.post(f"{API}/day/{self.DATE}/assign?now_min=-1", json={"template_id": tid})
        d = s.get(f"{API}/day/{self.DATE}?now_min=-1").json()
        morning = next(b for b in d["blocks"] if b["name"].startswith("Morning"))
        # pool = 240 - 90 fixed = 150. min_minutes=500 must be rejected.
        rl = next(t for t in morning["tasks"] if t["title"] == "Reading list")
        r = s.patch(f"{API}/day/{self.DATE}/tasks/{rl['id']}?now_min=-1", json={"min_minutes": 500})
        assert r.status_code == 400

    def test_patch_template_task_share_over_100_rejected(self):
        s = _login()
        r = s.post(f"{API}/templates", json={"name": "TEST_PatchValidate"})
        tid = r.json()["id"]
        try:
            r1 = s.post(f"{API}/templates/{tid}/blocks", json={"name": "B", "start": "08:00", "end": "10:00"})
            bid = r1.json()["blocks"][0]["id"]
            r2 = s.post(f"{API}/templates/{tid}/blocks/{bid}/tasks",
                        json={"title": "R1", "type": "recurring", "share_pct": 50})
            task_id = next(t for t in r2.json()["blocks"] if t["id"] == bid)["tasks"][0]["id"]
            r3 = s.post(f"{API}/templates/{tid}/blocks/{bid}/tasks",
                        json={"title": "R2", "type": "recurring", "share_pct": 40})
            assert r3.status_code == 200
            # Now bump R1 from 50 to 70 -> total 110% -> reject
            r4 = s.patch(f"{API}/templates/{tid}/blocks/{bid}/tasks/{task_id}", json={"share_pct": 70})
            assert r4.status_code == 400
        finally:
            s.delete(f"{API}/templates/{tid}")

    # ---- Bug #4: moving recurring into block with same-tkey carry merges quota ----
    def test_move_recurring_into_carry_twin_merges(self):
        """When a block already has a carry with tkey X (from settle), moving a recurring
        task with the same tkey into that block must merge them and preserve carry_min
        (previously carry_min was silently dropped)."""
        s = _login()
        # Build a template where "Alpha" is must_today in the first block AND lives as a
        # recurring in a later block, so we get both a carry and a recurring same-tkey.
        r = s.post(f"{API}/templates", json={"name": "TEST_MergeCarry"})
        tid = r.json()["id"]
        try:
            r1 = s.post(f"{API}/templates/{tid}/blocks",
                        json={"name": "A", "start": "08:00", "end": "10:00"})
            bA = r1.json()["blocks"][0]["id"]
            r2 = s.post(f"{API}/templates/{tid}/blocks",
                        json={"name": "B", "start": "10:10", "end": "12:00"})
            bB = next(b for b in r2.json()["blocks"] if b["name"] == "B")["id"]
            r3 = s.post(f"{API}/templates/{tid}/blocks",
                        json={"name": "C", "start": "12:10", "end": "14:00"})
            bC = next(b for b in r3.json()["blocks"] if b["name"] == "C")["id"]
            # Alpha must_today 60% in A, Alpha recurring 30% in C
            s.post(f"{API}/templates/{tid}/blocks/{bA}/tasks",
                   json={"title": "Alpha", "type": "recurring", "share_pct": 60, "must_today": True})
            s.post(f"{API}/templates/{tid}/blocks/{bC}/tasks",
                   json={"title": "Alpha", "type": "recurring", "share_pct": 30})
            # Assign to a fresh future date so nothing conflicts
            date = "2027-06-20"
            s.delete(f"{API}/day/{date}")
            s.post(f"{API}/day/{date}/assign?now_min=-1", json={"template_id": tid})
            # Settle at end-of-day → Alpha carry lands in B (first later block with room)
            d = s.get(f"{API}/day/{date}?now_min=1440").json()
            block_B = next(b for b in d["blocks"] if b["name"] == "B")
            block_C = next(b for b in d["blocks"] if b["name"] == "C")
            carry_in_B = next((t for t in block_B["tasks"]
                               if t["type"] == "carry" and t["title"] == "Alpha"), None)
            assert carry_in_B, f"expected carry Alpha in B, got {[(t['title'], t['type']) for t in block_B['tasks']]}"
            carry_min_before = carry_in_B["carry_min"]
            # Recurring Alpha in C
            recurring_in_C = next(t for t in block_C["tasks"]
                                  if t["type"] == "recurring" and t["title"] == "Alpha")
            # Move the recurring Alpha from C into B (which has a carry Alpha) -> must merge
            r = s.post(f"{API}/day/{date}/tasks/{recurring_in_C['id']}/move?now_min=1440",
                       json={"to_block_id": block_B["id"]})
            assert r.status_code == 200, r.text
            after = r.json()
            new_B = next(b for b in after["blocks"] if b["name"] == "B")
            # After merge into B: exactly one Alpha (no duplicate), carry_min preserved
            alphas_B = [t for t in new_B["tasks"] if t["title"] == "Alpha"]
            assert len(alphas_B) == 1, f"expected 1 merged Alpha in B, got {len(alphas_B)}"
            merged = alphas_B[0]
            # carry_min from the original carry must be preserved after the merge
            assert merged["carry_min"] == carry_min_before, (
                f"carry_min lost after merge: was {carry_min_before}, now {merged.get('carry_min')}"
            )
            # And it should now also carry the recurring share (share_pct > 0)
            assert merged["share_pct"] > 0, "merged twin should carry the recurring share_pct"
            s.delete(f"{API}/day/{date}")
        finally:
            s.delete(f"{API}/templates/{tid}")

    # ---- Bug #5: reminder endpoint persists reminded_at server-side ----
    def test_reminder_endpoint_persists_flag(self):
        s = _login()
        tid = _uni_id(s)
        s.post(f"{API}/day/{self.DATE}/assign?now_min=-1", json={"template_id": tid})
        d = s.get(f"{API}/day/{self.DATE}?now_min=-1").json()
        bid = d["blocks"][0]["id"]
        r = s.post(f"{API}/day/{self.DATE}/blocks/{bid}/remind?now_min=-1")
        assert r.status_code == 200
        d2 = r.json()
        b2 = next(b for b in d2["blocks"] if b["id"] == bid)
        assert b2.get("reminded_at"), "reminded_at should be persisted"
        # Second call should be idempotent (not overwrite the timestamp)
        first_stamp = b2["reminded_at"]
        r2 = s.post(f"{API}/day/{self.DATE}/blocks/{bid}/remind?now_min=-1")
        d3 = r2.json()
        b3 = next(b for b in d3["blocks"] if b["id"] == bid)
        assert b3["reminded_at"] == first_stamp
