#!/usr/bin/env python3
"""Fitness trainer server — static files + JSON API + optional git mirror.

Single source of truth for fitness data. Python 3 stdlib only, no installs.

Responsibilities on every write:
  1. validate the payload (users, dates, exercise IDs against the bank)
  2. write the JSON file(s) under data/
  3. update data/<user>/current.json pointers (never nulls next_plan)
  4. regenerate data/<user>/training-summary.json
  5. apply soreness boosts (workouts) — decay is computed at read time
  6. git commit the changed paths (and push to origin if one exists), so
     every clone can pull the data back. Git failure logs, never 500s.

Athletes are discovered from disk: any data/<name>/current.json (name is
lowercase a-z) is a valid user. Create one with `scripts/new-athlete <name>`.

API:
  GET  /api/users                  athletes on disk [{id, display_name}]
  GET  /api/<user>/state           full state bundle for agents + dashboard
  GET  /api/<user>/state/version   cheap change token for live-refresh polling
  POST /api/<user>/workout         completed workout document
  POST /api/<user>/daily           {date, field, value} merge into daily log
  POST /api/<user>/plan            plan document (sets next_plan)
  POST /api/<user>/goals           full goals document
  POST /api/<user>/soreness        full soreness document
  POST /api/<user>/week-outline    full week outline document

Run:  python3 server/fitness_server.py [BIND] [PORT] [--root DIR]
      defaults: 127.0.0.1 8766, root = this repo.

Env:  FITNESS_GIT=0       don't commit data writes
      FITNESS_GIT_PUSH=0  commit, but never push
"""

import json
import os
import re
import subprocess
import sys
import threading
from datetime import datetime, timedelta, timezone
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

USER_RE = re.compile(r"^[a-z]{1,32}$")
DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
SESSION_TYPE_RE = re.compile(r"^[a-z0-9_]{1,40}$")
EFFORT_VALUES = {"easy", "solid", "hard", "max"}

DAILY_FIELDS = {
    "sleep_hours": ("sleep", "duration_hours"),
    "sleep_quality": ("sleep", "quality"),
    "energy": ("energy",),
    "protein": ("nutrition", "protein"),
    "creatine": ("nutrition", "creatine"),
    "body_weight_lb": ("body_weight_lb",),
    "notes": ("notes",),
}

# Soreness rules from AGENTS.md: primaries set to >=0.8, secondaries >=0.4,
# decay 0.01/hour applied from each muscle's updated_at at read time.
SORENESS_PRIMARY = 0.8
SORENESS_SECONDARY = 0.4
SORENESS_DECAY_PER_HOUR = 0.01

ROOT = Path(os.environ.get("FITNESS_ROOT") or Path(__file__).resolve().parent.parent)
GIT_LOCK = threading.Lock()


class ApiError(Exception):
    def __init__(self, status, message):
        super().__init__(message)
        self.status = status
        self.message = message


def now_iso():
    return datetime.now().astimezone().isoformat(timespec="seconds")


def read_json(path):
    with open(path) as f:
        return json.load(f)


def write_json(path, doc):
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w") as f:
        json.dump(doc, f, indent=2, ensure_ascii=False)
        f.write("\n")


def exercise_bank():
    bank = read_json(ROOT / "data/exercises/exercises.json")
    return {ex["id"]: ex for ex in bank.get("exercises", [])}


# ---------------------------------------------------------------- validation

def list_users():
    data = ROOT / "data"
    return sorted(p.name for p in data.iterdir()
                  if USER_RE.match(p.name) and (p / "current.json").is_file())


def validate_user(user):
    if not USER_RE.match(user or "") or not (ROOT / f"data/{user}/current.json").is_file():
        raise ApiError(400, f"Unknown user: {user!r} (known: {list_users()}). "
                            "Create one with scripts/new-athlete <name>.")


def validate_date(date):
    if not isinstance(date, str) or not DATE_RE.match(date):
        raise ApiError(400, f"Bad date: {date!r} (want YYYY-MM-DD)")


def validate_exercise_ids(doc, bank, *, where):
    """Reject documents referencing exercise IDs missing from the bank —
    broken IDs silently lose pillar matching, science cards, and summaries."""
    bad = []
    for ex in doc.get("exercises", []) or []:
        ex_id = ex.get("exercise_id")
        if ex_id and ex_id not in bank:
            bad.append(ex_id)
    for goal in doc.get("strength_goals", []) or []:
        ex_id = goal.get("exercise_id")
        if ex_id and ex_id not in bank:
            bad.append(ex_id)
    if bad:
        raise ApiError(
            400,
            f"Unknown exercise_id(s) in {where}: {sorted(set(bad))}. "
            "Add them to data/exercises/exercises.json first or fix the id.",
        )


def validate_workout(doc, bank):
    validate_date(doc.get("date"))
    session = doc.get("session_type", "")
    if not SESSION_TYPE_RE.match(session or ""):
        raise ApiError(400, f"Bad session_type: {session!r}")
    if not isinstance(doc.get("exercises"), list) or not doc["exercises"]:
        raise ApiError(400, "Workout needs a non-empty exercises array")
    validate_exercise_ids(doc, bank, where="workout")
    for ex in doc.get("exercises", []) or []:
        effort = ex.get("effort")
        if effort is not None and effort not in EFFORT_VALUES:
            allowed = ", ".join(sorted(EFFORT_VALUES))
            raise ApiError(400, f"Bad effort: {effort!r} (allowed: {allowed})")
        for set_doc in ex.get("actual") or []:
            rir = set_doc.get("rir")
            if rir is not None and (
                not isinstance(rir, (int, float)) or isinstance(rir, bool) or rir < 0 or rir > 10
            ):
                raise ApiError(400, "Bad rir: expected number from 0 to 10")


def validate_plan(doc, bank):
    validate_date(doc.get("date"))
    session = doc.get("session_type", "")
    if not SESSION_TYPE_RE.match(session or ""):
        raise ApiError(400, f"Bad session_type: {session!r}")
    if not isinstance(doc.get("exercises"), list):
        raise ApiError(400, "Plan needs an exercises array")
    validate_exercise_ids(doc, bank, where="plan")
    # Retired exercises ("retired": true + "retired_reason" in the bank) stay
    # so history resolves, but they can never be programmed again.
    retired = [ex["exercise_id"] for ex in doc.get("exercises", [])
               if bank.get(ex.get("exercise_id"), {}).get("retired")]
    if retired:
        raise ApiError(
            400,
            f"Retired exercise(s) in plan: {sorted(set(retired))}. "
            "Check retired_reason in the bank and program the replacement.",
        )


# ------------------------------------------------------------------ soreness

def parse_iso(ts):
    try:
        return datetime.fromisoformat(ts)
    except (TypeError, ValueError):
        return None


def decayed_soreness(soreness):
    """Return a copy with time-decay applied; does not mutate the file."""
    out = {"updated_at": soreness.get("updated_at"), "muscles": {}}
    now = datetime.now(timezone.utc)
    for muscle, data in (soreness.get("muscles") or {}).items():
        level = data.get("level") or 0
        updated = parse_iso(data.get("updated_at"))
        if updated:
            hours = max(0, (now - updated.astimezone(timezone.utc)).total_seconds() / 3600)
            level = max(0, round(level - hours * SORENESS_DECAY_PER_HOUR, 3))
        if level > 0:
            out["muscles"][muscle] = {**data, "level": level}
    return out


def boost_soreness(user, workout, bank):
    """Decay existing soreness, then boost muscles trained by this workout."""
    path = ROOT / f"data/{user}/soreness.json"
    soreness = decayed_soreness(read_json(path) if path.exists() else {})
    muscles = soreness["muscles"]
    ts = now_iso()
    primaries, secondaries = set(), set()
    for ex in workout.get("exercises", []):
        info = bank.get(ex.get("exercise_id"), {})
        primaries.update(info.get("primary_muscles", []))
        secondaries.update(info.get("secondary_muscles", []))
    secondaries -= primaries
    for muscle, floor, bump in [(m, SORENESS_PRIMARY, 0.7) for m in primaries] + [
        (m, SORENESS_SECONDARY, 0.3) for m in secondaries
    ]:
        prev = (muscles.get(muscle) or {}).get("level", 0)
        muscles[muscle] = {
            "level": round(min(1.0, max(floor, prev + bump)), 3),
            "updated_at": ts,
            "notes": f"Trained in {workout['date']} {workout.get('session_type', '')} session.",
        }
    soreness["updated_at"] = ts
    write_json(path, soreness)
    return path


# ---------------------------------------------------- training summary (port)

def set_load(s):
    """Volume load for one set — doubles per-hand dumbbell loads to match
    the dashboard and scripts/training-summary.mjs."""
    if s.get("weight_lb_each") is not None:
        return float(s["weight_lb_each"]) * 2
    for key in ("weight_lb", "plate_load_lb", "added_weight_lb", "load"):
        if s.get(key) is not None:
            return float(s[key])
    return 0.0


def strength_load(s):
    """Strength load for one set. Per-hand dumbbell weight stays per-hand for
    e1RM; volume doubles it, but strength tracks the selected per-hand number."""
    for key in ("weight_lb", "weight_lb_each", "plate_load_lb", "added_weight_lb", "load"):
        if s.get(key) is not None:
            return float(s[key])
    return 0.0


def best_weight(sets):
    best = 0
    for s in sets:
        for key in ("weight_lb", "weight_lb_each", "plate_load_lb", "added_weight_lb"):
            if s.get(key) is not None:
                best = max(best, float(s[key]))
                break
    return best


def est_one_rep_max(s):
    reps = float(s.get("reps") or 0)
    load = strength_load(s)
    if reps < 1 or load <= 0:
        return 0
    return load * (1 + min(reps, 12) / 30)


def is_rep_working_set(s):
    return (s.get("reps") or 0) >= 1


def is_duration_working_set(s):
    return (s.get("duration_seconds") or 0) > 0 and not is_rep_working_set(s)


def round1(value):
    return round(value * 10) / 10


def round2(value):
    return round(value * 100) / 100


def monday_of(date_str):
    d = datetime.strptime(date_str, "%Y-%m-%d")
    return (d.date() - timedelta(days=d.weekday())).isoformat()


def days_between(a, b):
    a_date = datetime.strptime(a, "%Y-%m-%d")
    b_date = datetime.strptime(b, "%Y-%m-%d")
    return abs((b_date - a_date).days)


def previous_best_reps_at_or_above(records, weight):
    best = 0
    for rec in records:
        if (rec.get("weight") or 0) >= weight:
            best = max(best, rec.get("reps") or 0)
    return best


def has_plateau(history):
    e1rms = [h.get("est_1rm") or 0 for h in history if (h.get("est_1rm") or 0) > 0]
    if len(e1rms) < 5:
        return False
    recent = e1rms[-4:]
    prior = e1rms[:-4]
    return max(recent) < max(prior) * 1.02


def generate_training_summary(user, bank):
    """Python port of scripts/training-summary.mjs (same algorithm + fixes)."""
    user_dir = ROOT / f"data/{user}"
    workout_dir = ROOT / f"data/{user}/workouts"
    if not user_dir.is_dir():
        return None
    files = sorted(p for p in workout_dir.iterdir() if p.suffix == ".json") if workout_dir.is_dir() else []
    exercises, muscles, weekly = {}, {}, {}
    weekly_muscle_sets, effort_ratings = {}, []
    first = last = None
    for path in files:
        workout = read_json(path)
        date = workout.get("date")
        if not date:
            continue
        first = first or date
        last = date
        week_key = monday_of(date)
        session_muscles = set()
        for ex in workout.get("exercises", []):
            ex_id = ex.get("exercise_id") or ex.get("id")
            if not ex_id:
                continue
            actual = ex.get("actual") or []
            # Empty actual = the exercise was skipped that day: no history row,
            # and its muscles don't count as trained.
            if not actual:
                continue
            working_sets = [a for a in actual if is_rep_working_set(a)]
            duration_sets = [a for a in actual if is_duration_working_set(a)]
            best = best_weight(actual)
            session_best_e1rm = max([0] + [est_one_rep_max(a) for a in working_sets])
            volume = sum((a.get("reps") or 0) * set_load(a) for a in actual)
            if ex_id not in exercises:
                exercises[ex_id] = {
                    "last_trained": date,
                    "best_weight_lb": 0,
                    "best_weight_date": None,
                    "best_e1rm": round1(session_best_e1rm) if session_best_e1rm > 0 else 0,
                    "best_e1rm_date": date if session_best_e1rm > 0 else None,
                    "times_trained": 0,
                    "history": [],
                    "_rep_records": [],
                }
            entry = exercises[ex_id]
            previous_best_weight = entry["best_weight_lb"]
            entry["last_trained"] = date
            entry["times_trained"] += 1
            if best > entry["best_weight_lb"]:
                entry["best_weight_lb"] = best
                entry["best_weight_date"] = date
            if session_best_e1rm > entry["best_e1rm"]:
                entry["best_e1rm"] = round1(session_best_e1rm)
                entry["best_e1rm_date"] = date
            previous_best_reps = previous_best_reps_at_or_above(
                entry["_rep_records"], previous_best_weight
            )
            rep_pr = any(
                previous_best_weight > 0
                and best_weight([a]) >= previous_best_weight
                and (a.get("reps") or 0) > previous_best_reps
                for a in working_sets
            )
            effort = ex.get("effort")
            if effort:
                entry["last_effort"] = effort
                effort_ratings.append({"date": date, "effort": effort})
            hist = {
                "date": date, "best_weight_lb": best,
                "sets": len(actual),
                "reps": sum(a.get("reps") or 0 for a in actual),
            }
            duration_s = sum(a.get("duration_seconds") or 0 for a in actual)
            if duration_s > 0:
                hist["duration_s"] = duration_s
            if session_best_e1rm > 0:
                hist["est_1rm"] = round1(session_best_e1rm)
            if rep_pr:
                hist["rep_pr"] = True
            entry["history"].append(hist)
            for a in working_sets:
                entry["_rep_records"].append({"weight": best_weight([a]), "reps": a.get("reps") or 0})
            info = bank.get(ex_id, {})
            session_muscles.update(info.get("primary_muscles", []))
            session_muscles.update(info.get("secondary_muscles", []))
            counted_sets = len(working_sets) + len(duration_sets)
            if counted_sets:
                week_sets = weekly_muscle_sets.setdefault(week_key, {})
                for m in info.get("primary_muscles", []):
                    week_sets[m] = week_sets.get(m, 0) + counted_sets
                for m in info.get("secondary_muscles", []):
                    week_sets[m] = week_sets.get(m, 0) + counted_sets * 0.5
            weekly[week_key] = weekly.get(week_key, 0) + volume
        for m in session_muscles:
            rec = muscles.setdefault(m, {"last_trained": date, "total_sessions": 0})
            rec["last_trained"] = date
            rec["total_sessions"] += 1
    for entry in exercises.values():
        entry["plateau"] = has_plateau(entry["history"])
        entry["history"] = entry["history"][-10:]
        del entry["_rep_records"]
    weekly = {k: round(weekly[k]) for k in sorted(weekly)[-12:]}
    weekly_muscle_sets = {
        k: {m: round1(weekly_muscle_sets[k][m]) for m in sorted(weekly_muscle_sets[k])}
        for k in sorted(weekly_muscle_sets)[-8:]
    }
    recent_efforts = [r for r in effort_ratings if last and days_between(r["date"], last) <= 14]
    easy_efforts = len([r for r in recent_efforts if r["effort"] == "easy"])
    summary = {
        "total_workouts": len(files),
        "first_workout": first,
        "latest_workout": last,
        "muscles": muscles,
        "exercises": exercises,
        "weekly_volume": weekly,
        "weekly_muscle_sets": weekly_muscle_sets,
        "effort_calibration": {
            "rated_exercises": len(recent_efforts),
            "easy_share": round2(easy_efforts / len(recent_efforts)) if recent_efforts else 0,
        },
    }
    out = ROOT / f"data/{user}/training-summary.json"
    write_json(out, summary)
    return out


# ----------------------------------------------------------------- git mirror

def git(*args, check=True):
    return subprocess.run(
        ["git", "-C", str(ROOT), *args],
        capture_output=True, text=True, check=check,
    )


def git_commit_and_push(paths, message):
    """Commit changed paths and push to origin. Never raises — data is already
    safely on disk; the mirror is best-effort and logged.

    Commits ONLY the given paths (`git commit -- paths`), so an agent's
    unrelated staged work in the same clone never rides along."""
    if os.environ.get("FITNESS_GIT") == "0" or not (ROOT / ".git").exists():
        return
    with GIT_LOCK:
        try:
            rels = [str(p.relative_to(ROOT)) for p in paths]
            git("add", "--", *rels)
            staged = git("diff", "--cached", "--quiet", "--", *rels, check=False)
            if staged.returncode == 0:
                return  # nothing actually changed
            git("commit", "-m", message, "--", *rels)
        except subprocess.CalledProcessError as e:
            print(f"[git] commit FAILED: {e.stderr.strip()}", file=sys.stderr)
            return
        if os.environ.get("FITNESS_GIT_PUSH") == "0":
            return
        if git("remote", "get-url", "origin", check=False).returncode != 0:
            return  # no remote configured — local history only
        try:
            branch = git("rev-parse", "--abbrev-ref", "HEAD").stdout.strip()
            git("push", "origin", branch)
        except subprocess.CalledProcessError as e:
            print(f"[git] push failed (will ride along with the next push): "
                  f"{e.stderr.strip()}", file=sys.stderr)


# ------------------------------------------------------------- current.json

def update_current(user, **updates):
    path = ROOT / f"data/{user}/current.json"
    current = read_json(path)
    history_appends = updates.pop("_append_history", {})
    for key, rel in history_appends.items():
        lst = current.setdefault(key, [])
        if rel not in lst:
            lst.append(rel)
            lst.sort()
    for key, value in updates.items():
        if key == "next_plan" and not value:
            continue  # never null next_plan — dashboard fallback depends on it
        current[key] = value
    current["updated_at"] = now_iso()
    write_json(path, current)
    return path


# ------------------------------------------------------------------ handlers

def handle_get_state(user):
    validate_user(user)
    base = ROOT / f"data/{user}"
    current = read_json(base / "current.json")

    def opt(rel):
        if not rel:
            return None
        p = ROOT / rel
        return read_json(p) if p.exists() else None

    dailies = [opt(rel) for rel in current.get("daily_history", [])]
    soreness = opt(current.get("soreness"))
    return {
        "user": user,
        "version": state_version(user),
        "current": current,
        "goals": opt(current.get("goals")),
        "plan": opt(current.get("next_plan")),
        "latest_workout": opt(current.get("latest_workout")),
        "training_summary": opt(current.get("training_summary")
                                or f"data/{user}/training-summary.json"),
        "soreness": decayed_soreness(soreness) if soreness else None,
        "week_outline": opt(current.get("week_outline")
                            or f"data/{user}/plans/week-outline.json"),
        "metrics": opt(current.get("metrics")),
        "health": recent_health_summary(user),
        "dailies": [d for d in dailies if d],
    }


def recent_health_summary(user):
    path = ROOT / f"data/{user}/health/apple-health-summary.json"
    if not path.exists():
        return None
    try:
        doc = read_json(path)
    except (OSError, json.JSONDecodeError):
        return None
    if isinstance(doc, list):
        days = doc
    else:
        days = doc.get("days") or doc.get("daily") or []
    if not days:
        return None
    trimmed = []
    for day in sorted(days, key=lambda d: d.get("date") or "")[-14:]:
        sleep = day.get("sleep") or {}
        recovery = day.get("recovery") or {}
        activity = day.get("activity") or {}
        trimmed.append({
            "date": day.get("date"),
            "sleep_hours": sleep.get("total_sleep_hours"),
            "resting_heart_rate_bpm": recovery.get("resting_heart_rate_bpm"),
            "hrv_sdnn_ms": recovery.get("hrv_sdnn_ms"),
            "steps": activity.get("steps"),
            "exercise_minutes": activity.get("exercise_minutes"),
            "workout_types": [
                w.get("type")
                for w in (day.get("workouts") or [])
                if isinstance(w, dict) and w.get("type")
            ],
        })
    return trimmed


def state_version(user):
    """Cheap change token: newest mtime under the user's data + shared bank."""
    newest = 0.0
    health_daily = ROOT / f"data/{user}/health/daily"
    for folder in (ROOT / f"data/{user}", ROOT / "data/exercises"):
        if folder.is_dir():
            for p in folder.rglob("*.json"):
                if health_daily in p.parents:
                    continue
                newest = max(newest, p.stat().st_mtime)
    return f"{newest:.0f}"


def handle_post_workout(user, doc):
    validate_user(user)
    bank = exercise_bank()
    validate_workout(doc, bank)
    doc.setdefault("status", "completed")
    doc.setdefault("logged_at", now_iso())
    rel = f"data/{user}/workouts/{doc['date']}-{doc['session_type']}.json"
    path = ROOT / rel
    write_json(path, doc)
    soreness_path = boost_soreness(user, doc, bank)
    summary_path = generate_training_summary(user, bank)
    current_path = update_current(
        user,
        latest_workout=rel,
        _append_history={"workout_history": rel},
    )
    git_commit_and_push(
        [path, soreness_path, summary_path, current_path],
        f"fitness-server: {user} {doc['session_type']} workout {doc['date']}",
    )
    return {"ok": True, "written": rel}


def handle_post_daily(user, body):
    validate_user(user)
    date = body.get("date")
    validate_date(date)
    field = body.get("field")
    if field not in DAILY_FIELDS:
        raise ApiError(400, f"Unknown daily field: {field!r} "
                            f"(allowed: {sorted(DAILY_FIELDS)})")
    rel = f"data/{user}/daily/{date}.json"
    path = ROOT / rel
    daily = read_json(path) if path.exists() else {"date": date}
    keys = DAILY_FIELDS[field]
    if len(keys) == 1:
        daily[keys[0]] = body.get("value")
    else:
        daily.setdefault(keys[0], {})[keys[1]] = body.get("value")
    write_json(path, daily)
    current_path = update_current(
        user, latest_daily=rel, _append_history={"daily_history": rel}
    )
    git_commit_and_push([path, current_path],
                        f"fitness-server: {user} daily {date} {field}")
    return {"ok": True, "daily": daily}


def handle_post_plan(user, doc):
    validate_user(user)
    bank = exercise_bank()
    validate_plan(doc, bank)
    doc.setdefault("status", "planned")
    doc.setdefault("updated_by", "fitness-server")
    doc["updated_at"] = now_iso()
    rel = f"data/{user}/plans/{doc['date']}-{doc['session_type']}.json"
    path = ROOT / rel
    write_json(path, doc)
    current_path = update_current(user, next_plan=rel)
    git_commit_and_push([path, current_path],
                        f"fitness-server: {user} plan {doc['date']} {doc['session_type']}")
    return {"ok": True, "written": rel}


def handle_post_document(user, doc, *, rel, what, validate=None):
    validate_user(user)
    if not isinstance(doc, dict) or not doc:
        raise ApiError(400, f"{what} must be a non-empty JSON object")
    if validate:
        validate(doc)
    doc["updated_at"] = now_iso()
    path = ROOT / rel.format(user=user)
    write_json(path, doc)
    git_commit_and_push([path], f"fitness-server: {user} {what} update")
    return {"ok": True, "written": str(path.relative_to(ROOT))}


def handle_post_report(user, body):
    """Queue a raw field-notes report for the trainer worker (see
    server/process-reports.sh). Transport only: no parsing here — the worker
    agent interprets the markdown and performs the normal validated writes.
    Queue files live under queue/ (gitignored, never deployed as data)."""
    validate_user(user)
    text = body.get("text") if isinstance(body, dict) else None
    if not isinstance(text, str) or not text.strip():
        raise ApiError(400, "report needs a non-empty 'text' field")
    if len(text) > 20_000:
        raise ApiError(400, "report too large (20k char cap)")
    stamp = now_iso().replace(":", "-")
    rel = f"queue/{user}/{stamp}-report.md"
    path = ROOT / rel
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")
    return {"ok": True, "queued": rel,
            "note": "trainer will reply via the next plan's coach note"}


POST_ROUTES = {
    "workout": handle_post_workout,
    "report": handle_post_report,
    "daily": handle_post_daily,
    "plan": handle_post_plan,
    "goals": lambda user, doc: handle_post_document(
        user, doc, rel="data/{user}/goals.json", what="goals",
        validate=lambda d: validate_exercise_ids(d, exercise_bank(), where="goals"),
    ),
    "soreness": lambda user, doc: handle_post_document(
        user, doc, rel="data/{user}/soreness.json", what="soreness"),
    "week-outline": lambda user, doc: handle_post_document(
        user, doc, rel="data/{user}/plans/week-outline.json", what="week outline"),
}

API_RE = re.compile(r"^/api/([a-z]+)/([a-z-]+)(/version)?$")


class Handler(SimpleHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def log_message(self, fmt, *args):
        sys.stderr.write("%s - %s\n" % (self.address_string(), fmt % args))

    def send_json(self, status, doc):
        payload = json.dumps(doc).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(payload)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(payload)

    def end_headers(self):
        # Nothing here is worth a stale render: data and HTML feed the change
        # poll, and /assets/ modules (imported without ?v= stamps) went
        # heuristically stale in browsers after deploys. Personal-scale
        # traffic makes re-fetching everything cheap.
        if self.command == "GET" and (self.path.startswith("/data/")
                                      or self.path.startswith("/assets/")
                                      or self.path.endswith((".html", "/"))
                                      or self.path.startswith("/api/")):
            self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def do_GET(self):
        if self.path.split("?")[0] == "/api/users":
            users = []
            for u in list_users():
                try:
                    name = read_json(ROOT / f"data/{u}/current.json").get("display_name")
                except (OSError, json.JSONDecodeError):
                    name = None
                users.append({"id": u, "display_name": name or u.title()})
            return self.send_json(200, {"users": users})
        m = API_RE.match(self.path.split("?")[0])
        if not m:
            return super().do_GET()
        user, resource, version = m.groups()
        try:
            if resource != "state":
                raise ApiError(404, f"Unknown resource: {resource}")
            validate_user(user)
            if version:
                self.send_json(200, {"version": state_version(user)})
            else:
                self.send_json(200, handle_get_state(user))
        except ApiError as e:
            self.send_json(e.status, {"ok": False, "error": e.message})
        except Exception as e:  # noqa: BLE001 — must never kill the thread
            self.send_json(500, {"ok": False, "error": f"{type(e).__name__}: {e}"})

    def do_POST(self):
        m = API_RE.match(self.path.split("?")[0])
        try:
            if not m or m.group(3):
                raise ApiError(404, "POST endpoints: /api/<user>/<resource>")
            user, resource, _ = m.groups()
            handler = POST_ROUTES.get(resource)
            if not handler:
                raise ApiError(404, f"Unknown resource: {resource} "
                                    f"(allowed: {sorted(POST_ROUTES)})")
            length = int(self.headers.get("Content-Length") or 0)
            if length > 2_000_000:
                raise ApiError(413, "Payload too large")
            try:
                body = json.loads(self.rfile.read(length) or b"{}")
            except json.JSONDecodeError as e:
                raise ApiError(400, f"Invalid JSON: {e}")
            self.send_json(200, handler(user, body))
        except ApiError as e:
            self.send_json(e.status, {"ok": False, "error": e.message})
        except Exception as e:  # noqa: BLE001
            self.send_json(500, {"ok": False, "error": f"{type(e).__name__}: {e}"})


def main():
    global ROOT
    args = [a for a in sys.argv[1:]]
    if "--root" in args:
        i = args.index("--root")
        ROOT = Path(args[i + 1]).resolve()
        del args[i:i + 2]
    bind = args[0] if len(args) > 0 else "127.0.0.1"
    port = int(args[1]) if len(args) > 1 else 8766
    if not (ROOT / "data").is_dir():
        sys.exit(f"Data dir not found under {ROOT} — wrong --root?")
    server = ThreadingHTTPServer((bind, port), Handler)
    print(f"fitness-server serving {ROOT} on {bind}:{port}")
    server.serve_forever()


if __name__ == "__main__":
    main()
