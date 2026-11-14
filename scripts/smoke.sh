#!/usr/bin/env bash
# Smoke check: loads every demo in a headless browser, works the playback keys,
# and fails if any page logs an error. Needs the `agent-browser` CLI.
#
#   npm run build && npm run preview &      (or: npm run dev)
#   scripts/smoke.sh http://localhost:4173 [screenshot-dir]
set -euo pipefail

base="${1:-http://localhost:4173}"
shots="${2:-}"
export AGENT_BROWSER_SESSION="${AGENT_BROWSER_SESSION:-visual-algorithms-smoke}"

agent-browser open "$base/#/" >/dev/null
agent-browser set viewport 1280 900 >/dev/null
agent-browser wait ".card" >/dev/null
ids=$(agent-browser eval "[...document.querySelectorAll('a.card')].map(a => a.getAttribute('href').slice(2)).join(' ')" | tr -d '"')

failed=0
count=0
for id in $ids; do
  count=$((count + 1))
  agent-browser errors --clear >/dev/null
  # A fresh document per demo, so nothing leaks from the one before.
  agent-browser open "about:blank" >/dev/null
  agent-browser open "$base/#/$id" >/dev/null
  if ! agent-browser wait "canvas" >/dev/null 2>&1; then
    echo "FAIL $id: no canvas appeared"
    failed=$((failed + 1))
    continue
  fi
  for key in k ArrowRight ArrowRight ArrowLeft k r; do
    agent-browser press "$key" >/dev/null
  done
  agent-browser wait 400 >/dev/null
  if [ -n "$shots" ]; then
    mkdir -p "$shots"
    agent-browser screenshot "$shots/$id.png" >/dev/null
  fi
  errors=$(agent-browser errors)
  if [ -n "$errors" ]; then
    echo "FAIL $id: $errors"
    failed=$((failed + 1))
  else
    echo "ok   $id"
  fi
done

agent-browser close >/dev/null
echo "$count demos, $failed failed"
[ "$failed" -eq 0 ]
