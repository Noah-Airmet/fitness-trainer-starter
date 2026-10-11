# API and data contracts

Everything a client (dashboard, Android app, MCP shim, agent CLI) needs.
Source of truth for behavior is `server/fitness_server.py`; when this doc and
the code disagree, the code wins — fix the doc.

Units are pounds throughout (`weight_lb`, `weight_lb_each`). Dates are
`YYYY-MM-DD`; timestamps are ISO-8601 with offset.

## Endpoints

| Method | Path | Body | Effect |
| --- | --- | --- | --- |
| GET | `/api/users` | — | `{"users":[{"id","display_name"}]}` — athletes on disk |
| GET | `/api/<user>/state` | — | Full state bundle (below) |
| GET | `/api/<user>/state/version` | — | `{"version": "<token>"}` — cheap change poll |
| POST | `/api/<user>/workout` | workout doc | Writes `workouts/<date>-<session_type>.json`, boosts soreness, regenerates summary, updates pointers |
| POST | `/api/<user>/plan` | plan doc | Writes `plans/<date>-<session_type>.json`, sets `next_plan` |
| POST | `/api/<user>/daily` | `{date, field, value}` | Merges one field into `daily/<date>.json` |
| POST | `/api/<user>/goals` | goals doc | Replaces `goals.json` (exercise IDs validated) |
| POST | `/api/<user>/soreness` | soreness doc | Replaces `soreness.json` |
| POST | `/api/<user>/week-outline` | outline doc | Replaces `plans/week-outline.json` |
| POST | `/api/<user>/report` | `{"text": "<markdown>"}` | Queues raw notes at `queue/<user>/` for the optional worker |
| GET | `/data/...`, `/`, `/assets/...` | — | Static files (dashboard, exercise bank, history) |

Every response is JSON. Success: `{"ok": true, ...}`. Failure:
`{"ok": false, "error": "<human-readable reason>"}` with 400/404/413/500.
Validation errors are written for agents to self-correct from — surface them
verbatim.

Polling pattern for clients: fetch `/state` once, then poll
`/state/version` (the dashboard does every 30 s; a phone app should poll on
foreground) and refetch `/state` when the token changes.

No auth on the API itself — keep it on localhost or a private network
(Tailscale). Only the MCP shim is meant to be public, behind its secret path.

## State bundle (`GET /api/<user>/state`)

```json
{
  "user": "demo",
  "version": "1791747673",
  "current": { "display_name": "...", "next_plan": "data/demo/plans/...json",
               "latest_workout": "...", "workout_history": ["..."],
               "daily_history": ["..."], "...": "pointers" },
  "goals": { "...": "see goals.json" },
  "plan": { "...": "the next_plan document, or null" },
  "latest_workout": { "...": "workout doc or null" },
  "training_summary": { "...": "see below, or null before the first workout" },
  "soreness": { "updated_at": "...", "muscles": { "<token>": {"level": 0.62, "updated_at": "...", "notes": "..."} } },
  "week_outline": { "...": "outline doc or null" },
  "metrics": { "...": "metrics.json or null" },
  "health": null,
  "dailies": [ { "date": "...", "...": "daily docs from daily_history" } ]
}
```

Soreness in the bundle is already time-decayed. Full workout history is not
in the bundle; fetch each path in `current.workout_history` from `/data/...`
(they are immutable once written — cache them).

## Workout (`POST /workout`)

```json
{
  "date": "2026-10-09",
  "reported_day": "Friday",
  "session_type": "legs",
  "status": "completed",
  "exercises": [
    {
      "exercise_id": "leg_press",
      "name": "Leg Press",
      "effort": "solid",
      "actual": [
        {"set": 1, "reps": 10, "weight_lb": 270, "rir": 2},
        {"set": 2, "reps": 10, "weight_lb": 270}
      ],
      "notes": "≤160 chars"
    },
    {
      "exercise_id": "dumbbell_curl",
      "actual": [{"set": 1, "reps": 10, "weight_lb_each": 30}]
    },
    {
      "exercise_id": "plank",
      "actual": [{"set": 1, "duration_seconds": 60}]
    }
  ],
  "session_notes": "≤280 chars",
  "updated_by": "<model or client name>"
}
```

Rules: `session_type` matches `^[a-z0-9_]{1,40}$`; `exercises` non-empty;
every `exercise_id` in the bank; `effort` ∈ easy/solid/hard/max; `rir` 0–10.
Load keys per set, first match wins: `weight_lb`, `weight_lb_each`
(per-hand; volume doubles it, e1RM doesn't), `plate_load_lb`,
`added_weight_lb`, `load`. An exercise with empty `actual` counts as skipped.
Same date + session_type overwrites (that is how corrections work).

## Plan (`POST /plan`)

```json
{
  "date": "2026-10-12",
  "session_type": "push",
  "status": "planned",
  "intensity": "hard",
  "pillars": ["upper"],
  "safety_note": "≤200 chars — the Coach's note",
  "progression_target": "≤120 chars",
  "warmup": [{"activity": "dynamic_arm_swings", "duration_minutes": 5, "notes": "..."}],
  "exercises": [
    {"exercise_id": "barbell_bench_press", "name": "Barbell Bench Press",
     "target": {"sets": 3, "reps": 8, "weight_lb": 135}, "notes": "≤90 chars"}
  ],
  "session_notes": "...",
  "updated_by": "<model name>"
}
```

Retired exercises are rejected. `target` may use `weight_lb_each`,
`duration_seconds`, or `reps` as a range string ("8-10") where needed.

## Daily (`POST /daily`)

`{"date": "2026-10-09", "field": "<field>", "value": <any>}`

| field | stored at | typical values |
| --- | --- | --- |
| `sleep_hours` | `sleep.duration_hours` | 7.5 |
| `sleep_quality` | `sleep.quality` | good / ok / poor |
| `energy` | `energy` | short text |
| `protein` | `nutrition.protein` | good / close / low / missed |
| `creatine` | `nutrition.creatine` | taken / missed |
| `body_weight_lb` | `body_weight_lb` | 172.4 |
| `notes` | `notes` | short text |

## Week outline (`POST /week-outline`)

```json
{
  "week_of": "2026-10-12",
  "status": "planned",
  "notes": "≤200 chars",
  "structure": {"gym_days_per_week": 4, "hard_day_cap": 3, "hard_days_planned": 3},
  "priority_muscles": ["pectoralis_major — why"],
  "days": [
    {"date": "2026-10-12", "day": "Monday", "type": "push", "intensity": "hard", "notes": "≤100 chars"}
  ],
  "updated_by": "<model name>"
}
```

`type` is a session family (push, pull, legs, upper, lower, full_body, easy,
cardio, core, rest — anything matching the session_type pattern).

## Goals, soreness, metrics

See `templates/athlete/goals.json` (blank) and `data/demo/goals.json`
(filled) for the full shape. Soreness: `{"updated_at", "muscles": {token:
{"level": 0..1, "updated_at", "notes"}}}`. Metrics: optional body
measurements and preferences.

## Training summary (server-generated, read-only)

`data/<user>/training-summary.json`, rebuilt on every workout write:

- `total_workouts`, `first_workout`, `latest_workout`
- `exercises.<id>`: `last_trained`, `best_weight_lb`(+`_date`), `best_e1rm`
  (+`_date`, Epley capped at 12 reps), `times_trained`, `last_effort`,
  `plateau` (no e1RM gain >2% over the prior best in the last 4 sessions),
  `history` (last 10: date, best weight, sets, reps, est_1rm, rep_pr)
- `muscles.<token>`: `last_trained`, `total_sessions`
- `weekly_volume` (last 12 weeks, Monday keys, lb·reps)
- `weekly_muscle_sets` (last 8 weeks; secondaries count half)
- `effort_calibration`: share of "easy" ratings in the last 14 days — a high
  share means loads are too light

## Exercise bank (`data/exercises/exercises.json`)

`{"exercises": [{ "id", "name", "category", "equipment", "movement_pattern",
"primary_muscles", "secondary_muscles", "setup_cues", "common_mistakes",
"progression", "regression", "substitutions", "media", "expert_rating",
"plain_summary", "retired"?, "retired_reason"? }]}`. Muscle tokens here are
the vocabulary for pillars and soreness. `data/muscles/body-map.json` maps
tokens to SVG body regions; `muscle-glossary.json` has plain-language copy.
