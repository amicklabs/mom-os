#!/usr/bin/env bash
# Install the MomOS bar widget into the Omarchy shell on the helper's desktop.
#
#   helper/omarchy-plugin/install.sh             copy, enable, place in the bar
#   helper/omarchy-plugin/install.sh --uninstall remove it from the bar and disk
#
# Only the widget's own entry in ~/.config/omarchy/shell.json changes, and a
# backup is taken first. If `omarchy bar put` is unavailable, add this entry
# to bar.layout.right in shell.json by hand (it hot-reloads):
#
#   { "id": "momos.status" }
set -euo pipefail

id="momos.status"
here=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
config="${XDG_CONFIG_HOME:-$HOME/.config}/omarchy"
dest="$config/plugins/$id"
shell_json="$config/shell.json"

backup() {
  if [[ -f $shell_json ]]; then
    local b
    b="$shell_json.bak.momos.$(date +%Y%m%d-%H%M%S)"
    cp -p "$shell_json" "$b"
    echo "Backed up shell.json to $b"
  fi
}

in_bar() {
  [[ -f $shell_json ]] && grep -q "\"$id\"" "$shell_json"
}

if [[ ${1:-} == "--uninstall" ]]; then
  backup
  omarchy plugin disable "$id" || true
  rm -rf "$dest"
  omarchy-shell shell rescanPlugins >/dev/null 2>&1 || true
  echo "Removed $id."
  exit 0
fi

mkdir -p "$dest"
# Copy only the plugin's files; install.sh stays in the repo.
install -m 644 "$here/manifest.json" "$here"/*.qml "$dest/"
omarchy plugin validate "$dest"

omarchy-shell shell rescanPlugins >/dev/null 2>&1 || echo "Omarchy shell isn't running; the widget loads when it starts."

if in_bar; then
  echo "$id is already in the bar. Files updated; the shell reloads them on its own."
else
  backup
  # Next to the other status icons if Tailscale is there, else at the end
  # of the right section.
  if grep -q '"omarchy.tailscale"' "$shell_json" 2>/dev/null; then
    omarchy bar put "$id" --before omarchy.tailscale
  else
    omarchy plugin enable "$id"
  fi
  if in_bar; then
    echo "Added $id to the bar."
  else
    echo "Couldn't add $id automatically. Add { \"id\": \"$id\" } to bar.layout.right in $shell_json." >&2
    exit 1
  fi
fi
