#!/usr/bin/env bash
# Runs the shell against test files in $MOMOS_DEV_DIR (default /tmp/momos-dev)
# with the stub momctl. Notifications stay off so a desktop's own
# notification server keeps working. Extra arguments go to qs.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
shell_dir="$(dirname "$here")"
dir="${MOMOS_DEV_DIR:-/tmp/momos-dev}"
mkdir -p "$dir/photos"

[[ -f "$dir/config.json" ]] || cp "$here/config.json" "$dir/config.json"
[[ -f "$dir/state.json" ]] || "$here/state.sh" normal

# Placeholder photos, so the Family page has something to show.
if command -v magick >/dev/null; then
  [[ -f "$dir/photos/grace.jpg" ]] || magick -size 400x400 gradient:'#E8A87C-#85566B' "$dir/photos/grace.jpg"
  [[ -f "$dir/photos/leo.jpg" ]] || magick -size 400x400 gradient:'#7CB8E8-#3E5C85' "$dir/photos/leo.jpg"
fi

export MOMOS_DEV_DIR="$dir"
export MOMOS_CONFIG="$dir/config.json"
export MOMOS_STATE="$dir/state.json"
export MOMOS_PHOTOS="$dir/photos"
export MOMOS_UPDATING="$dir/updating.json"
export MOMOS_MOMCTL="$here/momctl"
export MOMOS_NOTIFICATIONS="${MOMOS_NOTIFICATIONS:-0}"

# Keep state.json fresh, like momd's heartbeat.
( while sleep 10; do "$here/state.sh" "$(cat "$dir/scenario" 2>/dev/null || echo normal)"; done ) &
keeper=$!
trap 'kill $keeper 2>/dev/null' EXIT

qs -p "$shell_dir" "$@"
