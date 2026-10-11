# Brief: native Android companion

A build brief for an agent. The web dashboard already works on Android as an
installed PWA (see `docs/PHONE.md`), so a native app is an upgrade, not a
requirement. It's worth building for: real system UI, Health Connect
readiness data, background "your plan is ready" notifications, and a share
sheet straight into the Claude app.

The original project has a native iOS companion built on exactly this
contract; this brief is that design translated to Android.

## Non-negotiables (from AGENTS.md invariants)

- **Read-only client.** The app reads `GET /api/<user>/state` and static
  `/data/...` files. It never writes athlete data files. The only writes it
  may make are `POST /api/<user>/daily` (quick readiness taps) and
  `POST /api/<user>/report` (raw notes for the optional worker).
- **Copy-first logging.** The Notes screen drafts markdown seeded from
  today's plan (same template as the dashboard's Notes tab:
  `generateTemplateText` in `assets/v2/views.js`), autosaves on-device, and
  offers Copy / Share (to the Claude app) / File report. The trainer agent
  interprets it — the app does not parse workouts.
- **Tolerant models.** Agent-written JSON drifts: a field that was a number
  becomes a string ("8-10"), an optional block disappears. Decode leniently
  (kotlinx.serialization with `ignoreUnknownKeys`, `isLenient`, nullable
  fields, a number-or-string wrapper type for loose scalars). Never crash on
  a shape you didn't expect.

## Stack

Kotlin, Jetpack Compose + Material 3, kotlinx.serialization, Ktor or
OkHttp, DataStore for settings, WorkManager for background polling,
Health Connect client for readiness. Single-activity, no DI framework needed
at this size. Min SDK high enough for Health Connect (26+; Android 14+ has
it built in).

Sideloading is free and permanent on Android (no 7-day re-signing like iOS
free accounts): `./gradlew assembleDebug && adb install -r app/build/outputs/apk/debug/app-debug.apk`.

## Screens

1. **Today** — date line; session masthead (type, intensity, pillars); the
   Coach's note (`plan.safety_note`); exercise rows with target sets × reps
   @ weight; tap an exercise → detail sheet. Week strip from
   `week_outline.days` (rest days marked). Readiness tiles: sleep, energy,
   protein, creatine from the latest daily, plus Health Connect measured
   values beside them. Soreness meters (decayed values arrive from the
   server).
2. **Record** — sessions logged / this week / weekly load; strength goals
   with progress toward target; e1RM chart per exercise (from
   `training_summary.exercises[id].history`); sets per muscle group this week
   vs last (`weekly_muscle_sets`); month calendar of trained days; logbook
   list of workouts (fetch each `current.workout_history` path once, cache
   forever — they're immutable).
3. **Index** — searchable exercise bank (`/data/exercises/exercises.json`),
   sorted/filterable by category, muscle, tier. Detail: summary, setup
   cues, common mistakes, substitutions, rating, your history for it.
4. **Notes** — the copy-first markdown pad described above.
5. **Settings** — server base URL (default to the tailnet HTTPS URL), athlete
   id (from `GET /api/users`), notification toggle.

Session families each get one consistent color + icon everywhere (push,
pull, legs, easy, cardio, core). Choose a palette that stays distinguishable
for color-blind users, and always pair color with a label or icon.

## Data flow

- On launch/foreground: `GET /state/version`; if changed, `GET /state`;
  cache the last bundle to disk for offline display.
- WorkManager periodic job (15 min minimum): poll `/state/version`; if
  `current.next_plan` changed, post a local notification ("Tonight: Pull —
  5 exercises queued"). No FCM needed.
- Health Connect: read-only sleep sessions, resting heart rate, HRV, steps
  for the last 14 days. Display only; nothing leaves the phone unless you
  later add an explicit, opt-in upload endpoint (see ROADMAP).
- Network: the server is plain HTTP on localhost behind `tailscale serve`
  HTTPS, so the app talks HTTPS to `https://<machine>.<tailnet>.ts.net:8443`
  and needs no cleartext exception.

## Verification lane for agents

- **Contract test** (JVM unit test, no emulator): decode every JSON file
  under `data/` with the app's models and assert the spot checks (plan has
  exercises, summary entries have history). Run it whenever agent JSON grows
  a new shape. The iOS version of this caught real drift.
- **Screenshot walk**: run the server locally
  (`python3 server/fitness_server.py 0.0.0.0 8766`), point the emulator at
  `http://10.0.2.2:8766` (debug build may allow cleartext for that host
  only), and either drive it with an instrumented test that screenshots each
  screen, or use `adb exec-out screencap -p > shot.png`. Roborazzi/Paparazzi
  are fine for Compose screenshot tests if you want them in CI.
- Use `data/demo/` as the fixture athlete.

## Later

Wear OS tile with tonight's plan; a "File report" flow that also attaches a
short voice memo transcribed on-device; Health Connect write of completed
workouts (exercise sessions) after the trainer logs them.
