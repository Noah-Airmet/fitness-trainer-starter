# Roadmap — good next builds

Ordered roughly by value per effort. Each is self-contained enough to hand
to an agent with "read AGENTS.md, then do item N".

1. **Onboard the real athlete.** `scripts/new-athlete <name>`, open a trainer
   chat, let it fill goals and cadence. Delete `data/demo/` once the dashboard
   has real data (or keep it as a test fixture — the dashboard prefers a
   non-demo athlete automatically).

2. **Kilograms.** Everything is pounds today. Add `weight_kg` /
   `weight_kg_each` as accepted set keys in the server (`set_load`,
   `strength_load`, `best_weight`), a `units` preference in `metrics.json`,
   and unit-aware formatting in `assets/v2/views.js`. Store what the athlete
   said; convert only for display and summaries.

3. **Health Connect import.** The server already passes through
   `data/<user>/health/apple-health-summary.json` as `state.health` (the
   name is historical — keep the shape: `days[] { date, sleep.total_sleep_hours,
   recovery.resting_heart_rate_bpm, recovery.hrv_sdnn_ms, activity.steps,
   activity.exercise_minutes, workouts[].type }`). Write a small importer
   for a Health Connect export (or have the Android app POST a daily
   summary to a new `/api/<user>/health` endpoint). Recovery data is context
   for planning; it never overrides what the athlete reports.

4. **Native Android app.** See `docs/ANDROID.md`.

5. **File-report button on the web dashboard.** The Notes tab has Copy;
   add "File report" that POSTs the draft to `/api/<user>/report`, and turn
   on the worker (`docs/DEPLOY.md`). Then logging works without opening a
   chat at all — the reply arrives as the next plan's Coach's note.

6. **Weekly review routine.** A scheduled headless agent run on Sundays:
   read state + coaching notes, append a dated review to
   `coaching-notes.md`, write next week's outline. Same pattern as
   `server/process-reports.sh`.

7. **Exercise bank growth.** Add the athlete's gym's machines as they come
   up. Follow the existing entry shape and `scripts/enrich-exercises.mjs`
   for ratings; attach media license metadata.

8. **Port to MCP SDK v2** when it's stable (`FastMCP` → `MCPServer`; the
   decorator API carries over). Until then `server/requirements.txt` pins
   `<2`.

Things deliberately not on this list: calorie tracking, a login system,
a frontend framework, a database. The JSON-files-in-git design is the
feature — every change is diffable and revertible.
