# Running it as a service (Linux, systemd user units)

The units in `deploy/systemd/` assume the repo is cloned at `~/fitness-trainer`.
If it lives elsewhere, edit `WorkingDirectory`/`ExecStart` (and the path in
`fitness-reports.path`).

```bash
git clone https://github.com/Noah-Airmet/fitness-trainer-starter ~/fitness-trainer && cd ~/fitness-trainer
mkdir -p ~/.config/systemd/user
cp deploy/systemd/fitness.service ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now fitness
loginctl enable-linger "$USER"     # keep user services running when logged out
curl -s localhost:8766/api/users
```

Add the MCP connector (see `docs/PHONE.md` for the env file and venv first):

```bash
cp deploy/systemd/trainer-mcp.service ~/.config/systemd/user/
systemctl --user daemon-reload && systemctl --user enable --now trainer-mcp
journalctl --user -u trainer-mcp -f
```

Code changes: `git pull` in `~/fitness-trainer`. The fitness server serves
assets live (no restart needed for dashboard changes); restart it after
editing `server/fitness_server.py`, and restart `trainer-mcp` after editing
`server/trainer_mcp.py` or `server/persona.md`.

## Data and git

The server commits every data write in the clone it runs from (only the
files it changed), and pushes if the clone has an `origin` remote. So:

- **Back up / sync**: give the clone a *private* remote (a private GitHub
  repo, or a bare repo on another machine) and data flows there
  automatically. Agents on other machines `git pull` to see it.
- **Keep it local only**: no remote, or `FITNESS_GIT_PUSH=0`.
- **No git at all**: `FITNESS_GIT=0`.

Health and training data is personal. Don't push it to a public repo. If you
want to share code improvements publicly, keep a separate code-only remote,
or put `data/<athlete>/` in `.gitignore` there.

Agents doing builder work in the same clone are fine: the server commits
with `git commit -- <paths>`, so their staged changes never ride along.
Pull before you push.

## Optional: headless report worker

If a phone client POSTs raw workout notes to `/api/<user>/report`, this
drains the queue through a headless Claude Code run that logs the session
and queues the next plan; the plan's `safety_note` doubles as the reply.

```bash
# needs the `claude` CLI installed and logged in for this user
sed -i "s/<athlete>/$ATHLETE/" deploy/systemd/fitness-reports.path
cp deploy/systemd/fitness-reports.{path,service} ~/.config/systemd/user/
systemctl --user daemon-reload && systemctl --user enable --now fitness-reports.path
```

Receipts land in `queue/done/*.reply.md`, failures in `queue/failed/`,
the log in `queue/worker.log`. A report whose first line contains `TEST` is
a dry run that writes no data.

## Without systemd

```bash
python3 server/fitness_server.py 127.0.0.1 8766 &
TRAINER_MCP_SECRET=... FITNESS_USER=... .venv/bin/python server/trainer_mcp.py &
```

Or wrap the same two commands in whatever supervisor you prefer (Docker,
s6, tmux). The server is one stdlib Python file; there's nothing to build.
