#!/usr/bin/env bash
# Writes or removes the helper's updating marker the way `mom` does
# (apps/mom/src/notice.ts), so the notice can be tried without a laptop.
#
#   shell/dev/updating.sh on [SECONDS]   "Sam is updating your computer", 900 s
#   shell/dev/updating.sh done           "Done. Your computer is up to date.", 8 s
#   shell/dev/updating.sh off
set -euo pipefail

dir="${MOMOS_DEV_DIR:-/tmp/momos-dev}"
file="$dir/updating.json"
mkdir -p "$dir"

write() {
  local now
  now=$(($(date +%s) * 1000))
  printf '{"version":1,"state":"%s","at":%s,"expiresAt":%s}\n' "$1" "$now" "$((now + $2 * 1000))" >"$file.tmp"
  mv -f "$file.tmp" "$file"
}

case "${1:-}" in
  on) write updating "${2:-900}" ;;
  done) write "done" 8 ;;
  off) rm -f "$file" ;;
  *)
    echo "usage: $0 on [SECONDS]|done|off" >&2
    exit 2
    ;;
esac
