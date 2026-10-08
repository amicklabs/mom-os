#!/usr/bin/env bash
# Runs the person's whole MomOS session in a window: a nested Hyprland at
# 1366x768 (the laptop's screen) with her Hyprland config from system/ and the
# repo's shell/. See dev/README.md.
#
#   dev/session.sh [start]           start it; stays in the foreground
#   dev/session.sh stop              close it
#   dev/session.sh screenshot [FILE] screenshot of the nested screen
#   dev/session.sh env               print exports for talking to it
#   dev/session.sh shell             run and restart the shell; the nested
#                                    Hyprland runs this at startup, not you
#
# Files live in $MOMOS_DEV_DIR (default $XDG_RUNTIME_DIR/momos-session).
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo="$(dirname "$here")"
dir="${MOMOS_DEV_DIR:-${XDG_RUNTIME_DIR:-/tmp}/momos-session}"

die() {
  echo "session.sh: $*" >&2
  exit 1
}

# Signature and Wayland socket of the running nested Hyprland, from the file
# `start` writes.
load_instance() {
  [[ -r "$dir/instance" ]] || die "no dev session is running (no $dir/instance)"
  # shellcheck source=/dev/null
  source "$dir/instance"
  kill -0 "$HYPR_PID" 2>/dev/null || die "the dev session (pid $HYPR_PID) isn't running"
}

momctl_path() {
  if [[ -x "$repo/apps/momctl/dist/momctl" ]]; then
    echo "$repo/apps/momctl/dist/momctl"
  else
    echo "$here/momctl-stub"
  fi
}

# Her hyprland.lua, rendered the way system/install.sh renders it, with three
# changes for a nested session:
#   - one 1366x768 output, the size of the laptop's screen
#   - no power-button binding, so a stray key can't suspend this machine
#   - on start it runs the shell from this repo instead of the systemd units
render_config() {
  local src="$repo/system/files/hypr/hyprland.lua" out="$dir/hyprland.lua"
  local config="$dir/config.json" person telegram

  person=$(jq -r '.person.name // "Mom"' "$config")
  telegram=$(jq -r 'first(.tiles[]? | select(.type == "app" and .app == "telegram") | .id) // "telegram"' "$config")

  sed \
    -e "s|@PERSON_NAME@|$person|g" \
    -e "s|@PERSON_USER@|$USER|g" \
    -e "s|@ADMIN_USER@|$USER|g" \
    -e "s|@CURSOR_SIZE@|40|g" \
    -e "s|@TELEGRAM_TILE@|$telegram|g" \
    -e 's|^hl\.monitor(.*$|hl.monitor({ output = "", mode = "1366x768@60", position = "0x0", scale = 1 })|' \
    -e '/^hl\.bind("XF86PowerOff"/d' \
    -e "s|hl\.exec_cmd(\"/usr/local/lib/momos/momos-session-start\")|hl.exec_cmd(\"$here/session.sh shell\")|" \
    "$src" >"$out.tmp"

  # Fail loudly if system/'s config changed shape and a rewrite missed.
  grep -q 'mode = "1366x768@60"' "$out.tmp" || die "couldn't set the monitor in $out.tmp"
  grep -q "session.sh shell" "$out.tmp" || die "couldn't replace the session start command in $out.tmp"
  ! grep -qE 'XF86PowerOff|/usr/local/lib/momos|@(PERSON_[A-Z]+|ADMIN_USER|CURSOR_SIZE|[A-Z]+_TILE)@' "$out.tmp" ||
    die "$out.tmp still has laptop-only lines"
  mv "$out.tmp" "$out"
}

# Placeholder family photos, so the Family page has faces.
make_photos() {
  mkdir -p "$dir/photos"
  command -v magick >/dev/null || return 0
  local id i=0 colors=('#E8A87C-#85566B' '#7CB8E8-#3E5C85' '#9CCB8A-#4E7A3E' '#E8D27C-#8A6D2E')
  for id in $(jq -r '.family[]?.photo // empty' "$dir/config.json"); do
    [[ -f "$dir/photos/$id" ]] || magick -size 400x400 "gradient:${colors[i % 4]}" "$dir/photos/$id"
    i=$((i + 1))
  done
}

# Keeps state.json fresh, like momd's heartbeat: bumps updatedAt every 10
# seconds and leaves the rest alone, so shell/dev/state.sh can set a scenario.
# The "stale" scenario is left stale.
keep_state_fresh() {
  while sleep 10; do
    [[ "$(cat "$dir/scenario" 2>/dev/null)" == stale ]] && continue
    [[ -f "$dir/state.json" ]] || continue
    jq --argjson now "$(($(date +%s) * 1000))" '.updatedAt = $now' "$dir/state.json" >"$dir/state.json.tmp" &&
      mv "$dir/state.json.tmp" "$dir/state.json"
  done
}

# The host Hyprland tiles the session's window like any other. Float it at
# 1366x768 in the middle of the screen instead, so it matches the laptop and
# leaves the tiled windows alone. Only the window of this Hyprland's pid is
# touched.
fit_window() {
  [[ -n "${HYPRLAND_INSTANCE_SIGNATURE:-}" ]] || return 0
  local address="" i
  for ((i = 0; i < 50; i++)); do
    address=$(hyprctl clients -j 2>/dev/null |
      jq -r --argjson pid "$1" 'first(.[] | select(.pid == $pid) | .address) // empty')
    [[ -n "$address" ]] && break
    sleep 0.1
  done
  if [[ -z "$address" ]]; then
    echo "session.sh: couldn't find the session's window to resize it" >&2
    return 0
  fi
  local target="window = \"address:$address\""
  hyprctl dispatch "hl.dsp.window.float({ action = \"enable\", $target })" >/dev/null
  hyprctl dispatch "hl.dsp.window.resize({ x = 1366, y = 768, $target })" >/dev/null
  hyprctl dispatch "hl.dsp.window.center({ $target })" >/dev/null
}

cmd_start() {
  command -v Hyprland >/dev/null || die "Hyprland isn't installed"
  command -v qs >/dev/null || die "quickshell (qs) isn't installed"
  command -v jq >/dev/null || die "jq isn't installed"
  [[ -n "${WAYLAND_DISPLAY:-}" ]] || die "run this from a Wayland session"
  if [[ -r "$dir/instance" ]]; then
    # shellcheck source=/dev/null
    (source "$dir/instance" && ! kill -0 "$HYPR_PID" 2>/dev/null) ||
      die "a dev session is already running; use '$0 stop' first"
  fi

  mkdir -p "$dir"
  [[ -f "$dir/config.json" ]] || cp "$here/fixtures/config.json" "$dir/config.json"
  if [[ ! -f "$dir/state.json" ]]; then
    jq --argjson now "$(($(date +%s) * 1000))" '.updatedAt = $now' "$here/fixtures/state.json" >"$dir/state.json"
  fi
  make_photos
  render_config
  Hyprland --verify-config -c "$dir/hyprland.lua" >"$dir/verify.log" 2>&1 ||
    die "Hyprland rejected $dir/hyprland.lua; see $dir/verify.log"

  export MOMOS_DEV_DIR="$dir"
  export MOMOS_CONFIG="$dir/config.json"
  export MOMOS_STATE="$dir/state.json"
  export MOMOS_PHOTOS="$dir/photos"
  export MOMOS_SLIDESHOW="$dir/slideshow"
  export MOMOS_UPDATING="$dir/updating.json"
  export MOMOS_MOMCTL="${MOMOS_MOMCTL:-$(momctl_path)}"
  # Off by default so this machine's own notification daemon keeps working.
  export MOMOS_NOTIFICATIONS="${MOMOS_NOTIFICATIONS:-0}"
  export QS_NO_RELOAD_POPUP=1

  # Globals, not locals: the EXIT trap runs after this function returns.
  keep_state_fresh &
  keeper=$!

  # The nested Hyprland makes its own instance signature and socket.
  env -u HYPRLAND_INSTANCE_SIGNATURE -u HYPRLAND_CMD \
    Hyprland -c "$dir/hyprland.lua" >"$dir/hyprland.log" 2>&1 &
  pid=$!
  trap 'kill "$keeper" 2>/dev/null || true; kill -TERM "$pid" 2>/dev/null || true; rm -f "$dir/instance"' EXIT
  trap 'exit 130' INT TERM

  local sig="" sock="" i
  for ((i = 0; i < 100; i++)); do
    kill -0 "$pid" 2>/dev/null || die "Hyprland exited; see $dir/hyprland.log"
    read -r sig sock < <(hyprctl instances -j 2>/dev/null |
      jq -r --argjson pid "$pid" '.[] | select(.pid == $pid) | "\(.instance) \(.wl_socket)"') || true
    [[ -n "$sig" ]] && break
    sleep 0.1
  done
  [[ -n "$sig" ]] || die "the nested Hyprland didn't show up in 'hyprctl instances'"

  printf 'HYPR_PID=%s\nHYPR_SIG=%s\nHYPR_SOCKET=%s\n' "$pid" "$sig" "$sock" >"$dir/instance"
  fit_window "$pid"
  echo "MomOS dev session running (pid $pid, $sock). Files and logs in $dir."
  echo "momctl: $MOMOS_MOMCTL"
  echo "Stop it with '$0 stop' or Ctrl+C."

  wait "$pid" || true
}

# Run by the nested Hyprland on start (see render_config). Restarts the shell
# when it exits, like momos-shell.service, until the compositor goes away or
# it fails 5 times within 2 minutes.
cmd_shell() {
  local log="$dir/shell.log" fails=() now
  while hyprctl version >/dev/null 2>&1; do
    echo "--- $(date +%T) starting qs -p $repo/shell" >>"$log"
    qs -p "$repo/shell" >>"$log" 2>&1 || true
    now=$(date +%s)
    fails+=("$now")
    while ((${#fails[@]} && now - fails[0] > 120)); do fails=("${fails[@]:1}"); done
    if ((${#fails[@]} >= 5)); then
      echo "--- $(date +%T) the shell exited 5 times in 2 minutes; giving up" >>"$log"
      exit 1
    fi
    sleep 2
  done
}

cmd_stop() {
  load_instance
  kill -TERM "$HYPR_PID"
  for ((i = 0; i < 50; i++)); do
    kill -0 "$HYPR_PID" 2>/dev/null || { echo "stopped"; return 0; }
    sleep 0.1
  done
  die "Hyprland (pid $HYPR_PID) is still running"
}

cmd_screenshot() {
  load_instance
  local out="${1:-$dir/screenshot-$(date +%H%M%S).png}"
  # The nested Hyprland draws only when the host asks it for a frame. While
  # the host's screen is asleep or the window is on a hidden workspace, grim
  # waits forever, hence the timeout.
  local rc=0
  WAYLAND_DISPLAY="$HYPR_SOCKET" timeout 10 grim -o WAYLAND-1 "$out" || rc=$?
  ((rc != 124)) || die "grim timed out: the window isn't being drawn (screen asleep or window hidden)"
  ((rc == 0)) || die "grim failed"
  echo "$out"
}

cmd_env() {
  load_instance
  cat <<EOF
export HYPRLAND_INSTANCE_SIGNATURE=$HYPR_SIG
export WAYLAND_DISPLAY=$HYPR_SOCKET
export MOMOS_DEV_DIR=$dir
export MOMOS_CONFIG=$dir/config.json
export MOMOS_STATE=$dir/state.json
export MOMOS_PHOTOS=$dir/photos
export MOMOS_SLIDESHOW=$dir/slideshow
export MOMOS_UPDATING=$dir/updating.json
export MOMOS_MOMCTL=$(momctl_path)
EOF
}

case "${1:-start}" in
  start) cmd_start ;;
  stop) cmd_stop ;;
  screenshot) shift; cmd_screenshot "$@" ;;
  env) cmd_env ;;
  shell) cmd_shell ;;
  *) die "usage: $0 [start|stop|screenshot [FILE]|env|shell]" ;;
esac
