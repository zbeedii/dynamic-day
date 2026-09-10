# Dynamic Day — Plan

A personal, single-user time management site that plans and re-plans the day in real time. Not a to-do list: the day is a sequence of time blocks, and time inside each block is continuously redistributed as reality shifts.

## Sign-in
Email and password only. Single user, private data. No Google or social login.

## The day model
- The day is made of **time blocks** (e.g. "Morning – University", "Evening – Study").
- Any block can be **split into finer sub-blocks**.
- Every split is separated by a mandatory **5-minute transition buffer**. Buffers are real time, protected, and never consumed by tasks.
- **Day templates**: a ready-made day (e.g. "University Day") can be assigned to a date, then adjusted for that day only without changing the template.

## Task types
1. **Recurring** — takes a percentage of its block's time (e.g. reading = 30% of the evening block).
2. **One-off** — a simple checkmark, no percentage.
3. **Fixed** — locked to a set clock time, cannot be moved or postponed, highest priority. Everything else plans around it.

Each task can carry **free-text notes** and an optional **instant sub-checklist** used during execution.

## Protection rules
- **Minimum duration**: a deep-focus task can declare a floor (e.g. "never less than 40 minutes"). If the day cannot honour it, the system **stops and asks** what to drop or shorten. It never quietly shrinks the task.
- **Must be done today**: a task can be marked non-negotiable. Time missed in one block is **deducted from later blocks the same day**. Nothing carries to tomorrow — if the day runs out, the user is told before the day ends, not after.

## How adaptation behaves
- Running late, finishing early, or editing the day mid-flight triggers an immediate recalculation of the remaining day.
- **Finishing early** pulls time forward from future blocks; a task at 100% disappears from the day and its time is freed.
- **Conscious friction**: when a delay crosses a threshold — user-adjustable, **default 30% of the block's total duration** — silent adaptation stops. The user is presented with a clear choice (shorten something, drop something, or push the block) and nothing changes until they pick.
- Below the threshold, adaptation is silent but **every change is still briefly announced with an undo option** — nothing changes on the schedule without at least a passing, dismissible notice.
- **5-second undo** on every automatic change the system makes on the user's behalf.

## The three spaces
1. **Planning** — build and edit the day: blocks, splits, tasks, templates, percentages, minimums.
2. **Quick view** — the default landing screen. Shows only the current block and the next one. Nothing else.
3. **Execution mode** — distraction-free. One task on screen, live countdown, calm visual tone, optional sub-checklist. No lists, no navigation noise.

## Motivation
On completing a part of a task there is roughly a **35% chance** of a small visual reward — deliberately unpredictable, never the same one twice in a row, always brief and never blocking. No streaks, no scores.

## Reminders
An in-app reminder fires the moment each block's time arrives. Browser notifications are offered if the user grants permission; if not, the in-app reminder still appears. Reminders are in-app/browser only — no email or SMS.

## Look and feel
Calm, tactile, focused — dark-leaning surfaces with a single warm accent, generous spacing, motion used to show time moving rather than to decorate. Execution mode is visually quieter than the rest of the app by design.

## Not included
AI assistance, analytics or reports, a shared library of saved templates, multi-user or team features, calendar sync.
