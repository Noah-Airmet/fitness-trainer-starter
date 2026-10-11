#!/usr/bin/env python3
"""Trainer MCP — a remote-MCP shim over the fitness REST API.

This is what turns a *normal* Claude chat (e.g. the Claude Android app, with
this server added as a custom connector) into the athlete's personal trainer
with no per-session setup:

  - `get_training_state` returns the trainer PERSONA (server/persona.md) plus
    the full current state bundle, so a cold "hey trainer, what's tonight?"
    bootstraps the role inside that one conversation — no global custom
    instructions, nothing that bleeds into unrelated chats.
  - the write tools push workouts / dailies / plans / soreness / outlines /
    goals back through the exact same validated API the `fit` CLI uses (the
    server still does pointer updates, summary regen, soreness boosts, and
    the git commit).

Transport: streamable-HTTP bound to 127.0.0.1. Expose it with a tunnel
(Tailscale Funnel or cloudflared — see docs/PHONE.md). Access is gated by a
secret path segment (`TRAINER_MCP_SECRET`): the connector URL is
`https://<host>/<secret>/mcp`, and a bare hostname probe reaches nothing.
"""
import json
import os
import urllib.error
import urllib.request
from datetime import datetime
from pathlib import Path

from mcp.server.fastmcp import FastMCP
from mcp.server.transport_security import TransportSecuritySettings

API_BASE = os.environ.get("FITNESS_API", "http://127.0.0.1:8766").rstrip("/")
SECRET = os.environ.get("TRAINER_MCP_SECRET", "").strip()
HOST = os.environ.get("TRAINER_MCP_HOST", "127.0.0.1")
PORT = int(os.environ.get("TRAINER_MCP_PORT", "8787"))
DEFAULT_USER = os.environ.get("FITNESS_USER", "").strip()
PERSONA_PATH = Path(__file__).with_name("persona.md")

# Mount under /<secret>/mcp so a bare hostname probe reaches nothing routable.
MOUNT = f"/{SECRET}/mcp" if SECRET else "/mcp"

# Config notes for the hosted Claude connector (learned the hard way):
#  - stateless_http + json_response: plain request/response (no SSE stream to
#    keep open, no mcp-session-id to retain across calls). The default
#    stateful+SSE mode left Claude's remote connector stuck after initialize.
#  - transport_security off: DNS-rebinding protection (default-on) returns 421
#    for the tunnel's public Host header. The tunnel + secret path gate access.
mcp = FastMCP("Personal Trainer", host=HOST, port=PORT,
              streamable_http_path=MOUNT,
              stateless_http=True,
              json_response=True,
              transport_security=TransportSecuritySettings(
                  enable_dns_rebinding_protection=False))


def _api(method, path, body=None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(
        f"{API_BASE}{path}", data=data, method=method,
        headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=25) as r:
            return json.load(r)
    except urllib.error.HTTPError as e:
        try:
            payload = json.load(e)
            return {"ok": False, "status": e.code,
                    "error": payload.get("error", payload)}
        except Exception:
            return {"ok": False, "status": e.code, "error": f"HTTP {e.code}"}
    except urllib.error.URLError as e:
        return {"ok": False, "error": f"cannot reach fitness API at "
                f"{API_BASE}: {e.reason}"}


def _user(user):
    """Explicit user > $FITNESS_USER > the only non-demo athlete on disk."""
    if user:
        return user
    if DEFAULT_USER:
        return DEFAULT_USER
    users = [u["id"] for u in (_api("GET", "/api/users").get("users") or [])]
    real = [u for u in users if u != "demo"] or users
    return real[0] if real else "demo"


def _dump(result):
    return json.dumps(result, ensure_ascii=False, indent=2)


@mcp.tool()
def get_training_state(user: str = "") -> str:
    """Call this FIRST whenever the user mentions a workout, the gym, training,
    a lift, tonight's or today's plan, soreness, pain, or logging a session.
    Returns your full operating instructions AS their personal trainer PLUS
    their current training state: goals and pillars, cadence, the active plan
    (next_plan), the latest completed workout, the training summary
    (per-exercise PRs and recency, neglected muscles, weekly volume), current
    soreness, the week outline, and recent daily readiness logs. Leave `user`
    empty unless several athletes share the server."""
    user = _user(user)
    state = _api("GET", f"/api/{user}/state")
    name = ((state.get("current") or {}).get("display_name")) or user.title()
    persona = PERSONA_PATH.read_text(encoding="utf-8").replace("{athlete}", name)
    now = datetime.now().astimezone()
    header = {"today": now.strftime("%A, %Y-%m-%d"), "time": now.strftime("%H:%M"),
              "user": user}
    return (persona
            + "\n\n=== NOW ===\n" + json.dumps(header, ensure_ascii=False)
            + "\n\n=== CURRENT STATE ===\n" + _dump(state))


@mcp.tool()
def find_exercises(query: str = "", category: str = "", muscle: str = "") -> str:
    """Search the shared exercise bank for valid `exercise_id`s before writing
    a plan or workout. All filters are optional, case-insensitive substrings:
    `query` matches id or name, `category` is push|pull|legs|core|cardio|
    warmup|stretch|recovery, `muscle` matches primary/secondary muscle tokens
    (e.g. "biceps", "hamstrings"). Returns compact rows; retired exercises are
    marked and must not be programmed."""
    bank = _api("GET", "/data/exercises/exercises.json")
    rows = []
    q, c, m = query.lower(), category.lower(), muscle.lower()
    for ex in bank.get("exercises", []):
        muscles = ex.get("primary_muscles", []) + ex.get("secondary_muscles", [])
        if q and q not in ex["id"] and q not in ex.get("name", "").lower():
            continue
        if c and c != ex.get("category", ""):
            continue
        if m and not any(m in tok for tok in muscles):
            continue
        row = {"id": ex["id"], "name": ex.get("name"), "category": ex.get("category"),
               "equipment": ex.get("equipment"), "primary": ex.get("primary_muscles")}
        if ex.get("retired"):
            row["retired"] = True
        rows.append(row)
    return _dump({"count": len(rows), "exercises": rows})


@mcp.tool()
def log_workout(workout: dict, user: str = "") -> str:
    """Log a COMPLETED workout. `workout` is the full workout document:
    {"date":"YYYY-MM-DD","reported_day":"Wednesday","session_type":"pull",
     "status":"completed","exercises":[{"exercise_id":"dumbbell_curl",
     "name":"Standing Dumbbell Curl","effort":"hard","actual":[{"set":1,
     "reps":10,"weight_lb":30}, ...],"notes":"..."}, ...],
     "session_notes":"...","updated_by":"<your model name>"}. The server
     validates exercise IDs against the bank, updates pointers, regenerates the
     training summary, boosts soreness, and commits. AFTER a successful log,
     also push_plan for the next session in the same turn."""
    return _dump(_api("POST", f"/api/{_user(user)}/workout", workout))


@mcp.tool()
def push_plan(plan: dict, user: str = "") -> str:
    """Create/replace the NEXT planned workout (sets next_plan). `plan` is a plan
    document: {"date":"YYYY-MM-DD","session_type":"legs","status":"planned",
    "intensity":"hard|moderate|easy","pillars":["<pillar id>"],
    "safety_note":"...","progression_target":"...","warmup":[...],
    "exercises":[{"exercise_id":"...","name":"...","target":{"sets":3,
    "reps":10,"weight_lb":160},"notes":"..."}],"updated_by":"<your model>"}.
    Always include concrete weights in target blocks."""
    return _dump(_api("POST", f"/api/{_user(user)}/plan", plan))


@mcp.tool()
def log_daily(date: str, field: str, value, user: str = "") -> str:
    """Merge ONE readiness field into a day's log. `date` is "YYYY-MM-DD".
    Fields: "protein" (good|close|low|missed), "creatine" (taken|missed),
    "sleep_quality" (good|ok|poor), "sleep_hours" (number), "energy" (short
    text), "body_weight_lb" (number), "notes" (short text). Call once per
    field. Ride these along with workout logging via ONE compact question."""
    return _dump(_api("POST", f"/api/{_user(user)}/daily",
                      {"date": date, "field": field, "value": value}))


@mcp.tool()
def set_soreness(soreness: dict, user: str = "") -> str:
    """Full-document replace of soreness.json — use ONLY when the user REPORTS
    soreness/pain conversationally (routine training soreness is handled
    automatically by log_workout). Take current values from
    get_training_state, set the reported muscle(s) to 0.9-1.0 with a fresh
    ISO-8601 `updated_at`, and push the whole document back."""
    return _dump(_api("POST", f"/api/{_user(user)}/soreness", soreness))


@mcp.tool()
def push_week_outline(outline: dict, user: str = "") -> str:
    """Full-document replace of the week outline (plans/week-outline.json).
    Shape: {"week_of":"YYYY-MM-DD (Monday)","status":"planned","notes":"...",
    "priority_muscles":["..."],"days":[{"date":"YYYY-MM-DD","day":"Monday",
    "type":"push|pull|legs|easy|rest|...","intensity":"hard|easy|rest",
    "notes":"..."}],"updated_by":"<your model>"}. `day` must be the real
    weekday for `date` — take it from the `today` field, never compute it."""
    return _dump(_api("POST", f"/api/{_user(user)}/week-outline", outline))


@mcp.tool()
def update_goals(goals: dict, user: str = "") -> str:
    """Full-document replace of goals.json (north star, pillars, cadence,
    strength_goals, habit_goals, nutrition_targets). Fetch the current document
    via get_training_state, change only what the conversation decided, bump
    `updated_at`, and push the WHOLE document back."""
    return _dump(_api("POST", f"/api/{_user(user)}/goals", goals))


if __name__ == "__main__":
    mcp.run(transport="streamable-http")
