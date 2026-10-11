# Fitness Trainer Starter

An **agent-run personal trainer**. You talk to an AI agent about your
workouts — in a chat on your phone or in a terminal — and it keeps the
records, tracks progress, and writes your next session with real weights.
A small server holds the data as JSON files in git; a dashboard shows it.

Extracted from a setup that has run daily since mid-2026, with the
owner-specific parts (homelab wiring, iOS app, personal data) removed. Linux
and Android friendly; nothing here needs a Mac.

```
 phone: Claude app ──MCP──┐                         ┌── dashboard (PWA)
 terminal: any agent ─fit─┼──► server/fitness_server.py ──► data/<athlete>/*.json ──► git
 phone notes ──report─────┘     validates · summarizes · commits
```

## Take it — it's yours

**Public domain ([Unlicense](LICENSE)).** Copy this repo wholesale, rename
it, rip things out, never mention where it came from. No fork, no
attribution, no pull requests expected. The fastest way:

```bash
git clone https://github.com/Noah-Airmet/fitness-trainer-starter my-trainer
cd my-trainer && rm -rf .git && git init    # fresh history, entirely yours
```

(or click **Use this template** on GitHub). The only strings attached are
the MIT notice on the muscle-map SVG data, which lives in
`data/muscles/README.md` — just leave that file in place.

## What you get

- **`server/fitness_server.py`** — one stdlib Python file. JSON API + static
  dashboard. Every write is validated (exercise IDs, dates, effort ranges),
  then it updates pointers, regenerates the training summary (PRs, e1RM,
  plateaus, neglected muscles, weekly sets per muscle), applies soreness
  with time decay, and git-commits.
- **`scripts/fit`** — the agent CLI over that API.
- **`server/trainer_mcp.py`** + **`server/persona.md`** — a remote MCP
  connector. Add it to the Claude app and a normal chat becomes your trainer:
  the first tool call hands the model its role and your full history.
- **`AGENTS.md`** — the trainer protocol: log and queue the next session in
  one turn, concrete weights from history, balance over chasing one lift,
  goal hierarchy (north star → pillars → strength targets → today), display
  copy budgets, date discipline. Works with Claude Code, Codex, Gemini CLI.
- **Dashboard** (`index.html`, `assets/v2/`) — no build step, no framework.
  Today / Record / Index / Notes, light and dark themes, installable on
  Android's home screen.
- **Exercise bank** — 79 exercises with muscles, cues, mistakes,
  substitutions, ratings; SVG body map; muscle glossary.
- **`data/demo/`** — a synthetic athlete so everything renders on first run.

## Quickstart (5 minutes, Linux)

Requirements: Python 3.9+ (3.10+ for the MCP connector), git.

```bash
git clone https://github.com/Noah-Airmet/fitness-trainer-starter ~/fitness-trainer && cd ~/fitness-trainer
python3 server/fitness_server.py            # http://127.0.0.1:8766
```

Open http://127.0.0.1:8766 — that's the demo athlete. Now make yours:

```bash
scripts/new-athlete alex --display-name "Alex"
export FITNESS_USER=alex
scripts/smoke-test                          # optional: end-to-end check
```

Then open an agent in the repo (`claude`, `codex`, …) and say *"hey trainer,
let's get started."* It reads `AGENTS.md`, sees a blank profile, asks a few
questions, and writes your goals, a week outline, and your first workout.
After the gym, tell it how it went in plain words; it logs the session and
queues the next one.

## On the phone

See **[docs/PHONE.md](docs/PHONE.md)**: the Claude Android app with the MCP
connector (public HTTPS through Tailscale Funnel or Cloudflare Tunnel,
gated by a secret URL), and the dashboard installed as a home-screen app over
Tailscale.

## Run it for real

**[docs/DEPLOY.md](docs/DEPLOY.md)** — systemd user units, git sync to a
private remote, and the optional headless report worker.

## Build on it

- **[docs/API.md](docs/API.md)** — every endpoint and data shape.
- **[docs/ANDROID.md](docs/ANDROID.md)** — brief for a native Compose app
  with Health Connect.
- **[ROADMAP.md](ROADMAP.md)** — suggested next builds (kg support, Health
  Connect import, a file-report button, weekly reviews).
- **[FORM_CHECK.md](FORM_CHECK.md)** — video form review with ffmpeg and a
  vision model.

## Privacy

Training and health data lives in `data/<athlete>/` and is committed to git.
Keep the repo private if it has a remote. The API has no auth by design;
keep it on localhost or your tailnet. Only the MCP endpoint goes public, and
only behind its secret path.

## License and credits

Unlicense (public domain) — see [LICENSE](LICENSE).

Muscle map paths adapted from
[react-muscle-highlighter](https://github.com/soroojshehryar/react-muscle-highlighter)
(MIT, see `data/muscles/README.md`). Exercise stills link to
[free-exercise-db](https://github.com/yuhonas/free-exercise-db) (Unlicense).
