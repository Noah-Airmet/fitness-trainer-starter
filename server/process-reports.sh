#!/usr/bin/env bash
# Drain the field-notes report queue through the trainer agent.
# Triggered by deploy/systemd/fitness-reports.path whenever queue/<user>/*.md
# appears. Uses the Claude Code CLI headless; swap CLAUDE_BIN/flags for another
# agent CLI if you prefer.
# Layout: queue/<user>/<ts>-report.md → queue/done/ (+ .reply.md receipt)
#         failures → queue/failed/ for inspection.
set -uo pipefail

ROOT="${FITNESS_ROOT:-$(cd "$(dirname "$0")/.." && pwd)}"
CLAUDE_BIN="${CLAUDE_BIN:-claude}"
MODEL="${FITNESS_TRAINER_MODEL:-opus}"
LOG="$ROOT/queue/worker.log"

cd "$ROOT"
mkdir -p queue/done queue/failed

shopt -s nullglob
for report in queue/*/*-report.md; do
  case "$report" in queue/done/*|queue/failed/*) continue ;; esac
  user="$(basename "$(dirname "$report")")"
  name="$(basename "$report")"
  reply="queue/done/${name%.md}.reply.md"

  echo "[$(date -Is)] processing $report (user=$user)" >>"$LOG"
  prompt="$(cat server/report-prompt.md)

USER: $user
REPORT_PATH: $report
REPLY_PATH: $reply

The report text follows between the markers.
-----BEGIN REPORT-----
$(cat "$report")
-----END REPORT-----"

  # Explicit tool allowlist: works headless and grants only what the trainer
  # needs — fit CLI via Bash, context reads, the reply file write.
  if printf '%s' "$prompt" | "$CLAUDE_BIN" -p --model "$MODEL" \
      --allowedTools "Bash,Read,Write,Edit,Glob,Grep" >>"$LOG" 2>&1; then
    mv "$report" "queue/done/$name"
    echo "[$(date -Is)] done $name" >>"$LOG"
  else
    mv "$report" "queue/failed/$name"
    echo "[$(date -Is)] FAILED $name (moved to queue/failed)" >>"$LOG"
  fi
done
