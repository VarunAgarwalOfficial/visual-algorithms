#!/usr/bin/env bash
# Makes the home page thumbnails: public/thumbs/<demo>-light.webp and -dark.webp.
# Each demo is loaded, moved to an interesting moment (60% through a recorded
# trace, or a few seconds into a simulation) and its canvas is photographed.
# Needs the `agent-browser` CLI and ImageMagick.
#
#   npm run dev &
#   scripts/thumbnails.sh http://localhost:5173 [demo-id ...]
set -euo pipefail

base="${1:-http://localhost:5173}"
shift || true
out="$(dirname "$0")/../public/thumbs"
tmp="$(mktemp -d)"
export AGENT_BROWSER_SESSION="${AGENT_BROWSER_SESSION:-visual-algorithms-thumbs}"
trap 'agent-browser close >/dev/null 2>&1 || true; rm -rf "$tmp"' EXIT

mkdir -p "$out"
agent-browser open "$base/#/" >/dev/null
agent-browser set viewport 1100 900 >/dev/null
agent-browser wait ".card" >/dev/null
ids="$*"
if [ -z "$ids" ]; then
  ids=$(agent-browser eval "[...document.querySelectorAll('a.card')].map(a => a.getAttribute('href').slice(2)).join(' ')" | tr -d '"')
fi

# Moves a trace player's step slider to 60% of its range; simulations have none and are started with Play.
seek="(() => {
  const field = [...document.querySelectorAll('.field')].find((f) => /^Steps? /.test(f.querySelector('label')?.textContent ?? '') && f.querySelector('input[type=range]'));
  const input = field?.querySelector('input[type=range]');
  if (!input || Number(input.max) <= 1) {
    [...document.querySelectorAll('main button.primary')].find((b) => b.textContent === 'Play')?.click();
    return 'running';
  }
  input.value = String(Math.round(Number(input.max) * 0.6));
  input.dispatchEvent(new Event('input', { bubbles: true }));
  return 'seeked';
})()"

for theme in light dark; do
  agent-browser set media "$theme" >/dev/null
  for id in $ids; do
    agent-browser open "about:blank" >/dev/null
    agent-browser open "$base/#/$id" >/dev/null
    agent-browser wait ".stage canvas" >/dev/null
    agent-browser wait 400 >/dev/null
    state=$(agent-browser eval "$seek")
    case "$state" in *running*) agent-browser wait 3500 >/dev/null ;; *) agent-browser wait 300 >/dev/null ;; esac
    agent-browser screenshot ".stage canvas" "$tmp/$id.png" >/dev/null
    magick "$tmp/$id.png" -resize 400x300^ -gravity center -extent 400x300 -quality 82 "$out/$id-$theme.webp"
    echo "$theme $id"
  done
done
