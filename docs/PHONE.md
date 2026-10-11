# Phone access (Android)

Two separate things reach the phone. Set up either or both.

| | What it is | Exposure |
| --- | --- | --- |
| **A. Trainer chat** | The Claude Android app with this repo's MCP server added as a custom connector. You talk; it logs and plans. | MCP endpoint is public HTTPS behind a secret URL path |
| **B. Dashboard** | The web dashboard installed to the home screen as an app (PWA). Shows today's plan, the record, the exercise index, and the copy-first notes pad. | Private: tailnet only |

Both rely on the server running on an always-on Linux box (a home server, a
VPS, or a laptop that stays on). See `docs/DEPLOY.md` for systemd.

Install Tailscale on the Linux box and the phone first — it's the simplest
way to reach a home machine from anywhere, and Funnel gives the MCP endpoint
a public HTTPS URL without a domain or router changes.

## A. Trainer chat through the Claude app

1. **Make a secret** and an env file (never commit it):

   ```bash
   mkdir -p ~/.config/fitness-trainer
   printf 'TRAINER_MCP_SECRET=%s\nFITNESS_USER=%s\n' "$(openssl rand -hex 24)" "<athlete>" \
     > ~/.config/fitness-trainer/mcp.env
   chmod 600 ~/.config/fitness-trainer/mcp.env
   ```

2. **Install and run the MCP shim** (Python ≥ 3.10):

   ```bash
   python3 -m venv .venv && .venv/bin/pip install -r server/requirements.txt
   systemctl --user enable --now trainer-mcp     # after docs/DEPLOY.md
   ```

   It listens on `127.0.0.1:8787` at `/<secret>/mcp`.

3. **Expose it publicly** — pick one:

   - **Tailscale Funnel** (no domain needed):
     ```bash
     sudo tailscale funnel --bg 8787
     ```
     URL: `https://<machine>.<tailnet>.ts.net/<secret>/mcp`. Funnel must be
     enabled for the tailnet in the Tailscale admin console the first time.
   - **Cloudflare Tunnel** (if you own a domain on Cloudflare): add a public
     hostname (e.g. `trainer.example.com`) → `http://127.0.0.1:8787`. URL:
     `https://trainer.example.com/<secret>/mcp`.

   A request to the bare host or `/mcp` should 404. Only the secret path works.

4. **Add the connector**: on claude.ai → Settings → Connectors → *Add custom
   connector*, paste the full URL including the secret. It then shows up in
   the Claude Android app. Turn it on in a chat and say "hey trainer, what's
   today?" — the first tool call (`get_training_state`) hands the model its
   trainer persona plus your full state, so no project or custom instructions
   are needed.

5. **Rotate the secret**: edit `mcp.env`, `systemctl --user restart
   trainer-mcp`, re-paste the new URL into the connector.

Tradeoff, stated plainly: anyone with the full URL can read and write the
training data. That's the same model as an unlisted link — fine for gym logs,
and the data is in git, so any bad write can be reverted. If you want more,
put Cloudflare Access or a reverse proxy with auth in front.

Tools exposed: `get_training_state`, `find_exercises`, `log_workout`,
`push_plan`, `log_daily`, `set_soreness`, `push_week_outline`,
`update_goals`. The persona lives in `server/persona.md` — edit it to change
how the trainer behaves (restart the service after).

## B. Dashboard as a home-screen app

Keep the dashboard private on the tailnet, with HTTPS so Chrome will install
it:

```bash
sudo tailscale serve --bg --https=8443 http://127.0.0.1:8766
```

On the phone (Tailscale connected), open
`https://<machine>.<tailnet>.ts.net:8443/?user=<athlete>` in Chrome →
menu → *Add to Home screen* / *Install app*. The `?user=` choice is
remembered after the first load.

If you run both A and B through Tailscale on one machine, Funnel takes port
443 and Serve takes 8443, so they don't collide. If your Tailscale version's
flags differ, check `tailscale serve --help` / `tailscale funnel --help`.

The dashboard polls for changes every 30 s, so a plan the trainer pushes
from the chat shows up on the home-screen app without a refresh.

## C. Optional: agent sessions from the phone

If you'd rather talk to a full coding agent (Claude Code, Codex, …) running
in this repo on the Linux box — so it can also do builder work — any remote
session approach works: Claude Code's remote/mobile session support, or SSH
from Termux. The trainer protocol is the same; it just uses `scripts/fit`
instead of MCP tools.
