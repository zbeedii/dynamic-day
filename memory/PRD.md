# Dynamic Day — PRD

## Original problem statement
A personal, single-user time management website (English UI) that organises the day intelligently
beyond a to-do list. The day is a sequence of time blocks and the time inside each block is
continuously redistributed as reality shifts.

Approved plan (June 2026):
- **Auth**: email + password only (JWT). Single user, private data. No social login.
- **Day model**: time blocks; any block splittable into finer sub-blocks; every split separated by a
  mandatory, protected **5-minute transition buffer**; day templates assignable to a date and then
  adjustable for that day only.
- **Task types**: recurring (% of the block's time), one-off (checkmark), fixed (locked clock time,
  cannot move, highest priority). Tasks carry free-text notes and an optional sub-checklist.
- **Protection**: minimum duration floor — if it can't be honoured the system stops and asks;
  "must be done today" — missed time is deducted from later blocks the same day, never tomorrow,
  and the user is warned before the day runs out.
- **Adaptation**: late / early / mid-day edits recalculate immediately; finishing early pulls time
  forward from future blocks and a task at 100% disappears; **conscious friction** above a
  user-adjustable threshold (default 30% of the block) halts silent adaptation and asks;
  every automatic change is announced with a **5-second undo**.
- **Three spaces**: Planning, Quick view (current + next block only, default landing), Execution mode
  (distraction free, one task, live countdown, calm tone, sub-checklist).
- **Motivation**: ~35% chance of a small visual reward on completing a part of a task, never the same
  one twice in a row. No streaks, no scores.
- **Reminders**: in-app reminder the moment a block's time arrives; browser notification if permitted.
- **Not included**: AI, analytics/reports, shared template library, multi-user, calendar sync.

## Architecture
- **Backend** `FastAPI + MongoDB (motor)`
  - `/app/backend/server.py` — all `/api` routes (auth, settings, templates, day, decisions, undo).
    Every `day`/`undo` route takes a required `now_min` query param (minutes since local midnight),
    so the client's local clock is the single source of truth for "now".
  - `/app/backend/engine.py` — the time engine: `compute_day` / `compute_block` (allocation maths,
    protected minimums, pending decisions), `settle_past_blocks` + `inject_carries`
    (must-today carry-over inside the same day), `pull_forward` (early completion),
    `task_key` (same recurring title across blocks = one logical task for the day).
  - `/app/backend/auth.py` — bcrypt hashing, JWT access/refresh, httpOnly cookies + Bearer fallback,
    brute-force lockout (5 failures / 15 min).
  - Collections: `users`, `settings`, `templates`, `days`, `undo_snapshots` (TTL 1h), `login_attempts`.
- **Frontend** `React + Tailwind + shadcn/ui`
  - `context/AuthContext.jsx`, `context/DayContext.jsx` (all day actions, 20s polling, undo, reward,
    block-start reminder).
  - `pages/QuickView.jsx` (`/`), `pages/Planning.jsx` (`/plan`), `pages/Execution.jsx` (`/focus`),
    `pages/Login.jsx`.
  - `components/`: `AppShell`, `BlockEditor`, `TaskDialog`, `DecisionDialog`, `UndoBar`, `Reward`.
  - Design: "Organic & Tactical Sanctuary" — dark surfaces, sage primary, amber accent,
    Outfit / Plus Jakarta Sans / JetBrains Mono (see `/app/design_guidelines.json`).

## Implemented — 2026-06 (session 2)
- Email/password auth with seeded admin, brute-force lockout, cookie + Bearer sessions.
- Templates CRUD incl. block create/patch/delete, block **split with enforced 5-minute buffer**,
  task CRUD with validation (recurring shares ≤ 100%, fixed tasks must fit their block).
- Day materialisation from a template, per-day editing that never touches the template.
- Allocation engine: fixed minutes removed from the pool, recurring shares distributed, slack
  reported, allocations shrinking proportionally as time is consumed.
- Protected minimum (`min_protection` decision) — held at the floor until the user answers.
- Must-today carry-over into later blocks + quota shortfall banner in Quick view.
- Early completion (`complete`, `finish-day`) with time pulled forward and freed.
- Conscious friction: `late_start` and `overrun` blocking decision dialog, threshold adjustable.
- 5-second undo bar backed by server-side day snapshots.
- Execution mode: single task, ring countdown, sub-checklist, +5/+10, pause/start/done.
- Unpredictable rewards (5 variants, never repeating the previous one), configurable chance.
- In-app + browser block-start reminders; settings popover (threshold, reward chance,
  notifications, calm backdrop).
- Tested: 19 backend pytest cases pass (`/app/backend/tests/backend_test.py`), frontend smoke +
  Playwright happy paths pass (`/app/test_reports/iteration_1.json`).

## Implemented — 2026-06 (session 3)
- **Week planning**: `GET /api/week`, `POST /api/week/assign` + `WeekStrip` in Planning — Mon–Sun
  strip with week navigation, per-day markers, "Fill Mon–Fri" / "Fill whole week".
  Days that already have a plan are **skipped, never overwritten** (user's choice).
- **Task moving**: drag a task row onto another block card, or use its move button
  (`POST /api/day/{date}/tasks/{id}/move`, `POST /api/templates/{tid}/tasks/{id}/move`).
  A recurring task's share **auto-shrinks to the destination's slack** (user's choice), merges with a
  matching task already in that block, re-anchors a fixed task that no longer fits, and is rejected
  with a clear message only when there is no slack at all. Every move gets an undo entry.
- **Day closing**: `compute_day` now returns `day_over`, `done_count`, `spent_total_min` and a
  `leftovers` list deduplicated per logical task. `DayWrapUp` appears on its own in Quick view when
  the day is over; each leftover can be **dropped for the rest of the day**
  (`skip?whole_day=true`) or **sent to tomorrow** (`/tasks/{id}/defer`), one by one — creating the
  target day from today's template when that date has no plan yet.
- Viewing another date now sends the right clock: today = real time, past = end of day, future = not
  started (`nowMinFor` in `frontend/src/api.js`).
- Tested: 28 backend pytest cases pass, frontend flows for all three features pass
  (`/app/test_reports/iteration_2.json`).

## Implemented — 2026-09 (session 4, bug review)
Five bugs identified via code review, all fixed and covered by new pytest cases (35 total pass):
- **#1 (critical) Undo of a carry lost the mandatory quota.** `settle_past_blocks` now snapshots the
  day *before* setting `block["settled"] = True`, so pressing Undo on a carry-over notification
  reverts the injection and re-settling can re-run.
- **#2 Patch endpoints skipped validation.** Added `validate_task_patch` to `patch_template_task`
  and `patch_day_task`: enforces share_pct total ≤ 100%, fixed_start inside its block, and
  min_minutes within the block's usable pool.
- **#3 Silent 401 after 24h.** Added an axios response interceptor in `frontend/src/api.js` that
  hits `/auth/refresh` once on a 401 and replays the original request — no more forced re-login
  after the access token expires.
- **#4 Move dropped carry_min when merging.** Widened the twin-merge in `move_task_between` so a
  recurring task moving into a block that already holds a same-tkey carry (or vice-versa) merges
  them, preserving both `share_pct` and `carry_min`.
- **#5 Reminders were localStorage-only.** New `POST /api/day/{date}/blocks/{bid}/remind` persists
  a `reminded_at` timestamp on the block; `DayContext` uses it so the same block doesn't re-notify
  on a second device.

## Backlog
- **P1** Let a leftover be sent to any date, not only tomorrow (small day picker in the wrap-up).
- **P1** Edit sub-checklists while planning (today they are only editable in Execution mode).
- **P2** Split `server.py` into routers (auth / templates / day / week) — now ~990 lines.
- **P2** Keyboard shortcuts for Execution mode (space = start/pause, enter = done).
- **P2** Per-day notes.
- **P2** Assign different templates to different weekdays in one pass (e.g. Mon/Wed = university,
  Tue/Thu = work).
