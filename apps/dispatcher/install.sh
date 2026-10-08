#!/usr/bin/env bash
# Build and install the MomOS dispatcher on the dispatcher machine as a systemd
# user service.
# Also installs `mom`, which the dispatcher and its agents use.
#
#   apps/dispatcher/install.sh            build, install, enable, (re)start
#   apps/dispatcher/install.sh --no-start install and enable only
set -euo pipefail

here=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
repo=$(cd "$here/../.." && pwd)
bin_dir="$HOME/.local/bin"
unit_dir="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"
start=1
[[ ${1:-} == "--no-start" ]] && start=0

command -v bun >/dev/null || { echo "bun is required to build" >&2; exit 1; }

echo "Building mom and momos-dispatcher"
(cd "$repo" && pnpm install --frozen-lockfile >/dev/null)
mkdir -p "$bin_dir" "$unit_dir"
# Build to a temp name, then rename, so a running binary is never half-written.
bun build --compile --minify "$repo/apps/mom/src/main.ts" --outfile "$bin_dir/.mom.new"
mv -f "$bin_dir/.mom.new" "$bin_dir/mom"
bun build --compile --minify "$here/src/main.ts" --outfile "$bin_dir/.momos-dispatcher.new"
mv -f "$bin_dir/.momos-dispatcher.new" "$bin_dir/momos-dispatcher"

install -m 644 "$here/systemd/momos-dispatcher.service" "$unit_dir/momos-dispatcher.service"
systemctl --user daemon-reload
systemctl --user enable momos-dispatcher.service >/dev/null

if [[ ! -f "${XDG_CONFIG_HOME:-$HOME/.config}/momos/mom.json" ]]; then
  echo "No ~/.config/momos/mom.json yet. Run: mom init --device NAME --host HOST --user USER --admin USER"
fi
if [[ ! -f $HOME/.config/momos/dispatcher-token ]]; then
  echo "No dispatcher token yet. The dispatcher runs anyway and picks the token up within a minute of it appearing."
fi

if (( start )); then
  systemctl --user restart momos-dispatcher.service
  sleep 1
  systemctl --user --no-pager --lines=5 status momos-dispatcher.service || true
fi
echo "Installed $bin_dir/mom and $bin_dir/momos-dispatcher. Logs: journalctl --user -u momos-dispatcher -f"
