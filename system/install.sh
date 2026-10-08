#!/bin/bash
# MomOS system installer. Run as root on the laptop.
#
#   install.sh [options] STEP...
#
# Every step is idempotent. See system/README.md for what each step does,
# which are safe to rerun remotely, and how to revert them.
set -euo pipefail

SYSTEM_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
REPO_ROOT=$(dirname "$SYSTEM_DIR")
FILES="$SYSTEM_DIR/files"

CONFIG=/etc/momos/config.json
DRY_RUN=0
FORCE=0
PASSWORD_STDIN=0
ADMIN_USER=${MOMOS_ADMIN_USER:-}

# Steps run by "all": the ones that are safe on every deploy. The others need
# the helper present, a secret, or Tailscale up, so they only run by name.
ALL_STEPS=(packages chromium user session shell binaries wayvnc sudoers machine-notes splash)

PACMAN_PACKAGES=(
  wayvnc ydotool wtype playerctl tailscale telegram-desktop grim jq
  quickshell chromium brightnessctl wireplumber openssh cryptsetup rsync
  hypridle
  # pw-record (pipewire) and ffmpeg record and encode her Help voice notes.
  pipewire ffmpeg
  # The Speaker page: BlueZ, bluetoothctl, and PipeWire's Bluetooth audio.
  bluez bluez-utils pipewire-audio
)
# Built from the AUR when local.hardware.dkmsModules lists facetimehd.
FACETIMEHD_PACKAGES=(facetimehd-dkms facetimehd-firmware facetimehd-data)
HW_DKMS=()
HW_LID=normal

# XDG autostart entries hidden in the person's session: update notices,
# printer applets and input-method popups she can't act on.
HIDDEN_AUTOSTART=(
  limine-restore-notify
  limine-snapper-notify
  org.fcitx.Fcitx5
  print-applet
  org.gnome.SettingsDaemon.DiskUtilityNotify
  localsearch-3
)

LUKS_KEY=/etc/cryptsetup-keys.d/momos-root.key
MKINITCPIO_DROPIN=/etc/mkinitcpio.conf.d/90-momos-keyfile.conf
LIMINE_DROPIN=/etc/limine-entry-tool.d/90-momos-keyfile.conf
SPLASH_DIR=/usr/share/plymouth/themes/momos
SPLASH_HOOK=/etc/pacman.d/hooks/95-momos-splash.hook
SPLASH_KEEP=/usr/local/lib/momos/momos-splash-keep
SDDM_AUTOLOGIN=/etc/sddm.conf.d/autologin.conf
SDDM_SESSION=omarchy.desktop
CURSOR_SIZE=40
NOTES_BEGIN='<!-- momos:begin (written by system/install.sh machine-notes; edit the repo copy) -->'
NOTES_END='<!-- momos:end -->'

usage() {
  cat <<EOF
Usage: install.sh [options] STEP...

Steps are separate arguments or one comma-separated list ("shell,binaries").

Options:
  --config PATH      MomOS config file (JSON or JSONC). Default: $CONFIG
  --admin USER       Admin account. Default: \$MOMOS_ADMIN_USER, then "admin.user"
                     in the config, then \$SUDO_USER.
  --dry-run          Print what would change, change nothing.
  --password-stdin   (user) Read the person's password from stdin.
  --force            (firewall) Skip the check for an SSH session over Tailscale.
  -h, --help         Show this help.

Safe steps (run by "all"):
  packages        pacman and AUR packages
  chromium        managed Chromium policy
  user            the person's account, uinput group, udev rule and
                  trackpad hwdb entry
  session         her Hyprland config, systemd user units, Chromium flags
  shell           copy shell/ from the repo to /usr/local/share/momos/shell,
                  and the lock screen's PAM service; restart her shell if
                  its files changed
  binaries        install momd and momctl from bin/ (built by mom deploy)
                  to /usr/local/bin, and restart her momd if it changed
  wayvnc          her wayvnc config and password (password printed once)
  sudoers         keep the admin's passwordless sudo, check she has none
  machine-notes   update the MomOS section of the admin's MACHINE-NOTES.md
  splash          the MomOS boot splash ("MOM OS"); rebuilds the boot image
                  only when something changed
  splash-omarchy  revert: Omarchy's boot splash
  check           health checks only, changes nothing

Steps that need the helper (never run by "all"):
  autologin        SDDM logs straight into the person's account
  autologin-admin  revert: SDDM logs into the admin account
  keyfile          unlock the disk at boot with a keyfile in the initramfs
  keyfile-remove   revert: require the disk passphrase at startup
  tailscale        join the tailnet as tag:momos (needs MOMOS_TAILSCALE_AUTHKEY)
  firewall         SSH and VNC on tailscale0 only; drop LAN SSH and LocalSend
  firewall-lan     revert: allow SSH from the LAN again (rate limited)
  web-screen       screen sharing in the admin app: Tailscale Serve passes
                   https://<laptop>.ts.net/ to momd's 127.0.0.1:5901
  web-screen-off   revert: stop serving https://<laptop>.ts.net/

Environment:
  MOMOS_PERSON_PASSWORD    (user) the person's password
  MOMOS_LUKS_PASSPHRASE    (keyfile, keyfile-remove) an existing disk passphrase;
                           prompted for when unset
  MOMOS_TAILSCALE_AUTHKEY  (tailscale) a tagged auth key
EOF
}

# ---------------------------------------------------------------------------
# Helpers

log() { printf '==> %s\n' "$*"; }
note() { printf '    %s\n' "$*"; }
warn() { printf 'WARNING: %s\n' "$*" >&2; }
die() {
  printf 'ERROR: %s\n' "$*" >&2
  exit 1
}

run() {
  if ((DRY_RUN)); then
    printf '    would run: %s\n' "$*"
  else
    "$@"
  fi
}

# put_file DEST MODE OWNER < content
# Writes stdin to DEST if it differs. OWNER is user:group.
put_file() {
  local dest=$1 mode=$2 owner=$3 tmp
  tmp=$(mktemp)
  cat >"$tmp"
  if [[ -f $dest ]] && cmp -s "$tmp" "$dest" &&
    [[ $(stat -c '%a %U:%G' "$dest") == "$mode $owner" ]]; then
    note "unchanged: $dest"
    rm -f "$tmp"
    return 0
  fi
  if ((DRY_RUN)); then
    if [[ -f $dest ]]; then
      note "would update: $dest"
      diff -u "$dest" "$tmp" | sed 's/^/      /' || true
    else
      note "would create: $dest"
    fi
    rm -f "$tmp"
    return 0
  fi
  install -D -m "$mode" -o "${owner%%:*}" -g "${owner##*:}" "$tmp" "$dest"
  rm -f "$tmp"
  note "wrote: $dest"
  PUT_CHANGED=1
}

# Set to 1 by put_file when it writes. Callers reset it first. It doesn't
# survive a pipe into put_file, which runs in a subshell.
PUT_CHANGED=0

# restart_person_unit UNIT LABEL
# Restarts one of her systemd user units, but only if her session is running
# it; otherwise it starts with the new files at her next login.
restart_person_unit() {
  local unit=$1 label=$2
  ((DRY_RUN)) && return 0
  getent passwd "$PERSON_USER" >/dev/null || return 0
  if systemctl --user -M "$PERSON_USER@" is-active --quiet "$unit" 2>/dev/null; then
    systemctl --user -M "$PERSON_USER@" restart "$unit" && note "restarted her $label"
  fi
  return 0
}

# put_dir DIR MODE OWNER
put_dir() {
  local dir=$1 mode=$2 owner=$3
  if [[ -d $dir ]]; then
    return 0
  fi
  run install -d -m "$mode" -o "${owner%%:*}" -g "${owner##*:}" "$dir"
}

# remove_file PATH
remove_file() {
  if [[ -e $1 ]]; then
    run rm -f "$1"
    ((DRY_RUN)) || note "removed: $1"
  fi
}

render() {
  sed \
    -e "s|@PERSON_NAME@|$PERSON_NAME|g" \
    -e "s|@PERSON_USER@|$PERSON_USER|g" \
    -e "s|@ADMIN_USER@|$ADMIN_USER|g" \
    -e "s|@CURSOR_SIZE@|$CURSOR_SIZE|g" \
    -e "s|@TELEGRAM_TILE@|$TELEGRAM_TILE|g" \
    "$1"
}

# Config files may be JSONC. Only whole-line // comments are supported, which
# is all config/example.jsonc uses.
config_json() {
  sed -E 's#^[[:space:]]*//.*$##' "$CONFIG"
}

load_config() {
  [[ -r $CONFIG ]] || die "config file not found: $CONFIG (use --config)"
  config_json | jq -e . >/dev/null || die "$CONFIG is not valid JSON"

  PERSON_USER=$(config_json | jq -r '.person.user // empty')
  PERSON_NAME=$(config_json | jq -r '.person.name // empty')
  [[ $PERSON_USER =~ ^[a-z_][a-z0-9_-]{0,31}$ ]] || die "person.user is missing or invalid in $CONFIG"
  [[ -n $PERSON_NAME && $PERSON_NAME != *'|'* ]] || die "person.name is missing or invalid in $CONFIG"

  if [[ -z $ADMIN_USER ]]; then
    ADMIN_USER=$(config_json | jq -r '.admin.user // empty')
  fi
  ADMIN_USER=${ADMIN_USER:-${SUDO_USER:-}}
  [[ -n $ADMIN_USER ]] || die "admin user unknown: pass --admin USER"
  getent passwd "$ADMIN_USER" >/dev/null || die "admin user $ADMIN_USER does not exist"
  [[ $PERSON_USER != "$ADMIN_USER" && $PERSON_USER != root ]] ||
    die "person.user must not be root or the admin account"

  # Workspace name for the Telegram tile, used by the window rules.
  TELEGRAM_TILE=$(config_json | jq -r 'first(.tiles[]? | select(.type == "app" and .app == "telegram") | .id) // "telegram"')
  [[ $TELEGRAM_TILE =~ ^[a-z0-9][a-z0-9-]{0,39}$ ]] || die "bad telegram tile id"

  ADMIN_HOME=$(getent passwd "$ADMIN_USER" | cut -d: -f6)

  # local.hardware: DKMS modules to expect and how the lid is handled. No
  # block means no DKMS modules and a normal lid.
  local m
  mapfile -t HW_DKMS < <(config_json | jq -r '(.local.hardware.dkmsModules // [])[]')
  for m in "${HW_DKMS[@]}"; do
    [[ $m =~ ^[A-Za-z0-9_-]{1,40}$ ]] || die "bad module name in local.hardware.dkmsModules: $m"
  done
  HW_LID=$(config_json | jq -r '.local.hardware.lid // "normal"')
  case $HW_LID in
    normal | flaky-macbook | ignore) ;;
    *) die "local.hardware.lid must be normal, flaky-macbook or ignore, not $HW_LID" ;;
  esac
}

has_dkms_module() {
  local m
  for m in "${HW_DKMS[@]}"; do [[ $m == "$1" ]] && return 0; done
  return 1
}

# AUR packages for this laptop's hardware: the facetimehd camera driver only
# where local.hardware lists it.
aur_packages() {
  if has_dkms_module facetimehd; then printf '%s\n' "${FACETIMEHD_PACKAGES[@]}"; fi
}

person_home() {
  getent passwd "$PERSON_USER" | cut -d: -f6
}

require_person() {
  getent passwd "$PERSON_USER" >/dev/null || die "user $PERSON_USER does not exist; run the user step first"
  PERSON_HOME=$(person_home)
  PERSON_GROUP=$(id -gn "$PERSON_USER")
}

luks_device() {
  local spec
  spec=$(tr ' ' '\n' </proc/cmdline | sed -n 's/^cryptdevice=//p' | head -n1)
  spec=${spec%%:*}
  [[ -n $spec ]] || die "no cryptdevice= on the kernel command line"
  case $spec in
    PARTUUID=*) printf '/dev/disk/by-partuuid/%s\n' "${spec#PARTUUID=}" ;;
    UUID=*) printf '/dev/disk/by-uuid/%s\n' "${spec#UUID=}" ;;
    *) printf '%s\n' "$spec" ;;
  esac
}

# Runs cryptsetup with an existing passphrase from MOMOS_LUKS_PASSPHRASE, or
# lets cryptsetup prompt on the terminal.
with_passphrase() {
  if [[ -n ${MOMOS_LUKS_PASSPHRASE:-} ]]; then
    printf '%s' "$MOMOS_LUKS_PASSPHRASE" | "$@" --key-file=-
  else
    [[ -t 0 ]] || die "set MOMOS_LUKS_PASSPHRASE or run from a terminal"
    "$@"
  fi
}

tailscale_ipv4() {
  { ip -4 -o addr show dev tailscale0 2>/dev/null || true; } | awk '{print $4}' | cut -d/ -f1 | head -n1
}

# ---------------------------------------------------------------------------
# Steps

step_packages() {
  log "packages"
  local missing
  missing=$(pacman -T "${PACMAN_PACKAGES[@]}" || true)
  if [[ -n $missing ]]; then
    # shellcheck disable=SC2086 # one package per word
    run pacman -S --needed --noconfirm $missing
  else
    note "pacman packages present"
  fi
  if systemctl is-enabled --quiet bluetooth.service; then
    note "bluetooth.service enabled"
  else
    run systemctl enable --now bluetooth.service
  fi

  local aur=()
  mapfile -t aur < <(aur_packages)
  missing=""
  if ((${#aur[@]})); then missing=$(pacman -T "${aur[@]}" || true); fi
  if ((${#aur[@]} == 0)); then
    note "no AUR packages for this hardware"
  elif [[ -n $missing ]]; then
    command -v yay >/dev/null || die "yay is missing; install the AUR packages by hand: $missing"
    # yay refuses to run as root, so build as the admin (passwordless sudo).
    # shellcheck disable=SC2086
    run runuser -u "$ADMIN_USER" -- yay -S --needed --noconfirm \
      --answerclean None --answerdiff None $missing
  else
    note "AUR packages present"
  fi
}

step_chromium() {
  log "chromium policy"
  jq -e . "$FILES/chromium/momos.json" >/dev/null || die "momos.json is not valid JSON"
  put_dir /etc/chromium/policies/managed 755 root:root
  put_file /etc/chromium/policies/managed/momos.json 644 root:root <"$FILES/chromium/momos.json"
}

step_user() {
  log "user $PERSON_USER"
  if ! getent group uinput >/dev/null; then
    run groupadd --system uinput
  fi
  put_file /etc/udev/rules.d/90-momos-uinput.rules 644 root:root <"$FILES/udev/90-momos-uinput.rules"
  if ((!DRY_RUN)); then
    udevadm control --reload
    udevadm trigger --subsystem-match=misc --sysname-match=uinput || true
  fi
  PUT_CHANGED=0
  put_file /etc/udev/hwdb.d/70-momos-touchpad.hwdb 644 root:root <"$FILES/udev/70-momos-touchpad.hwdb"
  if ((PUT_CHANGED && !DRY_RUN)); then
    systemd-hwdb update
    note "trackpad marked internal; takes effect at the next boot"
  fi

  if getent passwd "$PERSON_USER" >/dev/null; then
    note "user exists"
    run usermod -a -G video,uinput "$PERSON_USER"
  else
    run useradd --create-home --user-group --shell /bin/bash \
      --comment "$PERSON_NAME" --groups video,uinput "$PERSON_USER"
  fi

  # No admin rights, ever.
  local group
  for group in wheel sudo adm; do
    if id -nG "$PERSON_USER" 2>/dev/null | tr ' ' '\n' | grep -qx "$group"; then
      run gpasswd -d "$PERSON_USER" "$group"
    fi
  done
  if ((!DRY_RUN)); then
    chmod 700 "$(person_home)"
  fi

  # She may restart and turn off the computer without a password: the
  # helper's Restart action, and Restart and Turn off under More.
  render "$FILES/polkit/50-momos-reboot.rules" |
    put_file /etc/polkit-1/rules.d/50-momos-reboot.rules 644 root:root
  # She may join and save Wi-Fi networks without a password prompt, from the
  # Internet connection page under More.
  render "$FILES/polkit/50-momos-wifi.rules" |
    put_file /etc/polkit-1/rules.d/50-momos-wifi.rules 644 root:root

  local password=${MOMOS_PERSON_PASSWORD:-}
  if ((PASSWORD_STDIN)); then
    IFS= read -r password || true
  fi
  if [[ -n $password ]]; then
    if ((DRY_RUN)); then
      note "would set the password for $PERSON_USER"
    else
      printf '%s:%s\n' "$PERSON_USER" "$password" | chpasswd
      note "password set"
    fi
  elif [[ $(passwd -S "$PERSON_USER" 2>/dev/null | awk '{print $2}') == P ]]; then
    note "password already set; left alone"
  elif [[ -t 0 ]] && ((!DRY_RUN)); then
    passwd "$PERSON_USER"
  else
    warn "no password for $PERSON_USER. Set MOMOS_PERSON_PASSWORD, use --password-stdin, or run: passwd $PERSON_USER"
  fi
}

# sync_hardware FILE OWNER
# momd owns her config.json, but local.hardware comes from the deploy config:
# copy it in (or drop it) when it differs. Written to a temp file and renamed,
# since momd and the shell read the file at any moment.
sync_hardware() {
  local file=$1 owner=$2 want have tmp
  want=$(config_json | jq -c '.local.hardware // null')
  have=$(jq -c '.local.hardware // null' "$file" 2>/dev/null) || {
    warn "$file is not valid JSON; leaving it alone"
    return 0
  }
  if [[ $want == "$have" ]]; then
    note "unchanged: $file (momd owns it; local.hardware matches)"
    return 0
  fi
  if ((DRY_RUN)); then
    note "would set local.hardware in $file to $want"
    return 0
  fi
  tmp="$file.tmp"
  if [[ $want == null ]]; then
    jq 'if .local then .local |= del(.hardware) else . end' "$file" >"$tmp"
  else
    jq --argjson hw "$want" '.local = ((.local // {}) + {hardware: $hw})' "$file" >"$tmp"
  fi
  chown "$owner" "$tmp"
  chmod 600 "$tmp"
  mv -f "$tmp" "$file"
  note "wrote: local.hardware in $file"
}

step_session() {
  log "session for $PERSON_USER"
  require_person
  local owner="$PERSON_USER:$PERSON_GROUP" f name

  # System-wide pieces.
  put_dir /usr/local/lib/momos 755 root:root
  local idle_changed=0
  for f in momos-session-start momos-wayvnc momos-fallback-browser momos-idle; do
    PUT_CHANGED=0
    put_file "/usr/local/lib/momos/$f" 755 root:root <"$FILES/bin/$f"
    if [[ $f == momos-idle ]] && ((PUT_CHANGED)); then idle_changed=1; fi
  done
  for f in "$FILES"/systemd/*; do
    name=$(basename "$f")
    PUT_CHANGED=0
    put_file "/etc/systemd/user/$name" 644 root:root <"$FILES/systemd/$name"
    if [[ $name == momos-idle.service ]] && ((PUT_CHANGED)); then idle_changed=1; fi
  done
  put_dir /usr/local/share/momos/shell 755 root:root

  # Her files.
  put_dir "$PERSON_HOME/.config" 755 "$owner"
  put_dir "$PERSON_HOME/.config/hypr" 755 "$owner"
  render "$FILES/hypr/hyprland.lua" | put_file "$PERSON_HOME/.config/hypr/hyprland.lua" 644 "$owner"
  PUT_CHANGED=0
  put_file "$PERSON_HOME/.config/hypr/hypridle.conf" 644 "$owner" <"$FILES/hypr/hypridle.conf"
  if ((PUT_CHANGED)); then idle_changed=1; fi
  put_file "$PERSON_HOME/.config/chromium-flags.conf" 644 "$owner" <"$FILES/chromium-flags.conf"

  put_dir "$PERSON_HOME/.config/environment.d" 755 "$owner"
  printf 'YDOTOOL_SOCKET=/run/user/%s/.ydotool_socket\n' "$(id -u "$PERSON_USER")" |
    put_file "$PERSON_HOME/.config/environment.d/50-momos.conf" 644 "$owner"

  put_dir "$PERSON_HOME/.config/autostart" 755 "$owner"
  for name in "${HIDDEN_AUTOSTART[@]}"; do
    printf '[Desktop Entry]\nType=Application\nName=%s\nHidden=true\n' "$name" |
      put_file "$PERSON_HOME/.config/autostart/$name.desktop" 644 "$owner"
  done

  # Seed config.json once. After that momd owns it (docs/contracts.md).
  put_dir "$PERSON_HOME/.config/momos" 700 "$owner"
  put_dir "$PERSON_HOME/.config/momos/photos" 700 "$owner"
  if [[ -f $PERSON_HOME/.config/momos/config.json ]]; then
    sync_hardware "$PERSON_HOME/.config/momos/config.json" "$owner"
  else
    config_json | jq . | put_file "$PERSON_HOME/.config/momos/config.json" 600 "$owner"
  fi

  if ((!DRY_RUN)); then
    verify_hyprland_config
    systemctl --user -M "$PERSON_USER@" daemon-reload 2>/dev/null || true
  fi
  # hypridle reads its config only when it starts.
  if ((idle_changed)); then
    restart_person_unit momos-idle.service "idle rules (hypridle)"
  fi
}

hyprland_config_ok() {
  local runtime status=0 out
  runtime=$(mktemp -d)
  chown "$PERSON_USER" "$runtime"
  chmod 700 "$runtime"
  out=$(runuser -u "$PERSON_USER" -- env -i HOME="$PERSON_HOME" USER="$PERSON_USER" \
    PATH=/usr/local/bin:/usr/bin XDG_RUNTIME_DIR="$runtime" \
    Hyprland --verify-config -c "$PERSON_HOME/.config/hypr/hyprland.lua" 2>&1) || status=$?
  rm -rf "$runtime"
  # --verify-config exits 0 even for some Lua errors, so check the output too.
  if ((status != 0)) || grep -qiE 'error|fail' <<<"$out"; then
    printf '%s\n' "$out"
    return 1
  fi
}

verify_hyprland_config() {
  local out
  if out=$(hyprland_config_ok); then
    note "Hyprland --verify-config: ok"
  else
    printf '%s\n' "$out" | sed 's/^/      /' >&2
    die "Hyprland rejected $PERSON_HOME/.config/hypr/hyprland.lua"
  fi
}

# True if the person can run anything through sudo. Deny-only entries such as
# Omarchy's "ALL ALL=(ALL) !/usr/bin/asdcontrol" don't count.
person_has_sudo() {
  id -nG "$PERSON_USER" | tr ' ' '\n' | grep -qxE 'wheel|sudo' && return 0
  sudo -l -U "$PERSON_USER" 2>/dev/null |
    sed -n '/may run the following/,$p' | tail -n +2 |
    grep -vE '^[[:space:]]*$' | grep -qvE '^[[:space:]]*\([^)]*\)[[:space:]]*!'
}

step_shell() {
  log "shell files"
  put_dir /usr/local/share/momos 755 root:root
  put_dir /usr/local/share/momos/shell 755 root:root
  # `qs -c momos` looks in $XDG_CONFIG_DIRS/quickshell/momos.
  put_dir /etc/xdg/quickshell 755 root:root
  if [[ $(readlink /etc/xdg/quickshell/momos 2>/dev/null) != /usr/local/share/momos/shell ]]; then
    run ln -sfn /usr/local/share/momos/shell /etc/xdg/quickshell/momos
  fi
  if [[ -d $REPO_ROOT/shell ]]; then
    # --checksum, so a checkout with newer mtimes but the same files changes
    # nothing. Only created, updated or deleted entries count as changes, not
    # directory timestamps.
    local synced rsync_args=(-a --checksum --delete --itemize-changes --chown=root:root
      "--chmod=D755,F644" "$REPO_ROOT/shell/" /usr/local/share/momos/shell/)
    if ((DRY_RUN)); then
      synced=$(rsync --dry-run "${rsync_args[@]}")
      synced=$(grep -E '^([<>ch]|\*deleting)' <<<"$synced" || true)
      if [[ -n $synced ]]; then
        note "would sync shell files and restart her shell:"
        local lines
        mapfile -t lines <<<"$synced"
        printf '      %s\n' "${lines[@]}"
      fi
    else
      synced=$(rsync "${rsync_args[@]}")
      synced=$(grep -E '^([<>ch]|\*deleting)' <<<"$synced" || true)
      if [[ -n $synced ]]; then
        note "synced shell files ($(wc -l <<<"$synced") changed)"
        # A running Quickshell keeps the old QML (a new IPC function answers
        # "Function not found.") until it restarts.
        restart_person_unit momos-shell.service shell
      else
        note "unchanged: /usr/local/share/momos/shell"
      fi
    fi
    # The lock screen checks her PIN through this PAM service. Without it PAM
    # falls back to "other", which denies everything.
    put_file /etc/pam.d/momos-lock 644 root:root <"$REPO_ROOT/shell/pam/momos-lock"
  else
    note "no shell/ in $REPO_ROOT yet; skipped"
  fi
}

# momd and momctl, built by `mom deploy` (bun build --compile) into
# $REPO_ROOT/bin. Each binary is swapped in with a rename, so a running momd
# keeps its old file until it restarts.
step_binaries() {
  log "binaries"
  local f src dest changed=()
  for f in momd momctl; do
    src="$REPO_ROOT/bin/$f"
    dest="/usr/local/bin/$f"
    if [[ ! -f $src ]]; then
      warn "$src is missing; mom deploy builds it"
      continue
    fi
    if [[ -f $dest ]] && cmp -s "$src" "$dest"; then
      note "unchanged: $dest"
      continue
    fi
    if ((DRY_RUN)); then
      note "would install: $dest"
      continue
    fi
    install -m 755 -o root -g root "$src" "/usr/local/bin/.$f.new"
    mv -f "/usr/local/bin/.$f.new" "$dest"
    note "wrote: $dest"
    changed+=("$f")
  done
  if [[ " ${changed[*]} " == *" momd "* ]]; then
    restart_person_unit momd.service momd
  fi
}

step_wayvnc() {
  log "wayvnc for $PERSON_USER"
  require_person
  local owner="$PERSON_USER:$PERSON_GROUP"
  local dir="$PERSON_HOME/.config/wayvnc" config key password raw
  config="$dir/config"
  key="$dir/rsa_key.pem"

  put_dir "$dir" 700 "$owner"

  if [[ ! -f $key ]]; then
    if ((DRY_RUN)); then
      note "would create: $key"
    else
      runuser -u "$PERSON_USER" -- ssh-keygen -q -m pem -t rsa -b 3072 -N "" -C momos-wayvnc -f "$key"
      rm -f "$key.pub"
      chmod 600 "$key"
      note "wrote: $key"
    fi
  fi

  local new_password=0
  if [[ -f $config ]] && grep -q '^password=.' "$config"; then
    password=$(sed -n 's/^password=//p' "$config" | head -n1)
    note "keeping the existing password (in $config)"
  else
    new_password=1
    raw=$(head -c 512 /dev/urandom | LC_ALL=C tr -dc 'A-HJ-NP-Za-km-z2-9')
    password=${raw:0:16}
    ((${#password} == 16)) || die "could not generate a password"
  fi

  if ((DRY_RUN)); then
    note "would write: $config (password not shown in a dry run)"
    return 0
  fi

  # The address here is only a fallback. momos-wayvnc passes the Tailscale
  # address, or 127.0.0.1, on the command line. Never 0.0.0.0.
  #
  # RSA-AES only (TigerVNC 1.13+ and other RA2 viewers). relax_encryption
  # stays off: it adds Apple DH for macOS Screen Sharing, and in neatvnc 1.0.1
  # an Apple DH client crashed wayvnc (SIGABRT, divide by zero in GMP), even
  # with the right password.
  put_file "$config" 600 "$owner" <<EOF
use_relative_paths=true
address=127.0.0.1
port=5900
enable_auth=true
username=${ADMIN_USER}
password=${password}
rsa_private_key_file=rsa_key.pem
EOF

  if ((new_password && !DRY_RUN)); then
    printf '\n    VNC password for %s: %s\n    Shown once. It is stored in %s (mode 600).\n\n' \
      "$PERSON_USER" "$password" "$config"
  fi
}

step_autologin() {
  log "autologin -> $PERSON_USER"
  require_person
  [[ -f $PERSON_HOME/.config/hypr/hyprland.lua ]] || die "run the session step first"
  ((DRY_RUN)) || verify_hyprland_config
  [[ -f /usr/local/share/wayland-sessions/$SDDM_SESSION || -f /usr/share/wayland-sessions/$SDDM_SESSION ]] ||
    die "SDDM session $SDDM_SESSION not found"
  write_autologin "$PERSON_USER"
  note "takes effect at the next boot or logout; SDDM is not restarted"
}

step_autologin_admin() {
  log "autologin -> $ADMIN_USER"
  write_autologin "$ADMIN_USER"
  note "takes effect at the next boot or logout; SDDM is not restarted"
}

write_autologin() {
  put_file "$SDDM_AUTOLOGIN" 644 root:root <<EOF
[Autologin]
User=$1
Session=$SDDM_SESSION
EOF
}

step_keyfile() {
  log "LUKS keyfile unlock"
  local dev
  dev=$(luks_device)
  cryptsetup isLuks "$dev" || die "$dev is not a LUKS device"
  note "device: $dev ($(readlink -f "$dev"))"
  grep -qw encrypt < <(bash -c 'source /etc/mkinitcpio.conf; for f in /etc/mkinitcpio.conf.d/*.conf; do source "$f"; done; echo "${HOOKS[*]}"' 2>/dev/null) ||
    die "the initramfs does not use the busybox encrypt hook; this step only supports that"

  put_dir /etc/cryptsetup-keys.d 700 root:root
  if [[ ! -f $LUKS_KEY ]]; then
    if ((DRY_RUN)); then
      note "would create a 2048-byte random key: $LUKS_KEY"
    else
      (umask 077 && head -c 2048 /dev/urandom >"$LUKS_KEY")
      chmod 400 "$LUKS_KEY"
      note "wrote: $LUKS_KEY"
    fi
  fi

  if [[ -f $LUKS_KEY ]] && cryptsetup open --test-passphrase --key-file "$LUKS_KEY" "$dev" 2>/dev/null; then
    note "the keyfile already unlocks $dev"
  elif ((DRY_RUN)); then
    note "would add the keyfile to a LUKS key slot (asks for the current passphrase)"
  else
    log "adding the keyfile to a key slot; enter the current disk passphrase if asked"
    with_passphrase cryptsetup luksAddKey --pbkdf pbkdf2 --pbkdf-force-iterations 1000 "$dev" "$LUKS_KEY"
    cryptsetup open --test-passphrase --key-file "$LUKS_KEY" "$dev" ||
      die "the new keyfile does not unlock $dev"
    note "keyfile added and tested"
  fi

  put_file "$MKINITCPIO_DROPIN" 644 root:root <<EOF
# MomOS: embed the disk keyfile so the encrypt hook unlocks root without a
# passphrase. Remove with: install.sh keyfile-remove
FILES+=($LUKS_KEY)
EOF
  put_file "$LIMINE_DROPIN" 644 root:root <<EOF
# MomOS: tell the encrypt hook where the embedded keyfile is.
# Remove with: install.sh keyfile-remove
KERNEL_CMDLINE[default]+=" cryptkey=rootfs:$LUKS_KEY"
EOF

  rebuild_boot
  check_keyfile_boot
  note "the next boot and hibernation resume unlock without a passphrase"
  note "if the key is ever missing, the encrypt hook falls back to asking for the passphrase"
}

step_keyfile_remove() {
  log "require the disk passphrase at startup"
  local dev slots
  dev=$(luks_device)
  cryptsetup isLuks "$dev" || die "$dev is not a LUKS device"

  if [[ -f $LUKS_KEY ]] && cryptsetup open --test-passphrase --key-file "$LUKS_KEY" "$dev" 2>/dev/null; then
    slots=$(cryptsetup luksDump "$dev" | awk '/^Keyslots:/{k=1;next} /^[A-Za-z]/{k=0} k && /^[[:space:]]+[0-9]+: luks2/{n++} END{print n+0}')
    ((slots >= 2)) || die "the keyfile is the only key slot; refusing to remove it"
    if ((DRY_RUN)); then
      note "would check the disk passphrase, then remove the keyfile's key slot"
    else
      # Prove a passphrase still opens the disk before taking the keyfile away.
      log "enter the disk passphrase to confirm it still works"
      with_passphrase cryptsetup open --test-passphrase "$dev" ||
        die "that passphrase does not unlock $dev; nothing changed"
      cryptsetup luksRemoveKey "$dev" "$LUKS_KEY"
      note "key slot removed; copies of the keyfile left in old boot images no longer work"
    fi
  else
    note "the keyfile is not in a key slot"
  fi

  if [[ -e $MKINITCPIO_DROPIN || -e $LIMINE_DROPIN ]]; then
    remove_file "$MKINITCPIO_DROPIN"
    remove_file "$LIMINE_DROPIN"
    rebuild_boot
  else
    note "no keyfile drop-ins; boot images left alone"
  fi
  if [[ -f $LUKS_KEY ]]; then
    run shred -u "$LUKS_KEY"
  fi
  note "the next boot asks for the disk passphrase"
}

rebuild_boot() {
  command -v limine-mkinitcpio >/dev/null || die "limine-mkinitcpio is missing"
  log "rebuilding the initramfs and boot entries"
  run limine-mkinitcpio
}

# After a rebuild with the keyfile on, the boot entries must still pass
# cryptkey=, or the next boot stops at the passphrase prompt.
check_keyfile_boot() {
  ((DRY_RUN)) && return 0
  [[ -f $MKINITCPIO_DROPIN ]] || return 0
  if grep -rqa "cryptkey=rootfs:$LUKS_KEY" /boot 2>/dev/null; then
    note "boot entries carry cryptkey="
  else
    warn "cryptkey= not found under /boot; check /boot/limine.conf before rebooting"
  fi
}

# The boot splash says "MOM OS": a Plymouth theme of our own in its own
# directory, based on Omarchy's. omarchy-settings resets plymouthd.conf on
# every upgrade, so a pacman hook sets it back.
step_splash() {
  log "boot splash"
  command -v plymouth-set-default-theme >/dev/null || die "plymouth is not installed"
  local src name rebuild=0
  put_dir "$SPLASH_DIR" 755 root:root
  for src in "$FILES"/plymouth/momos/*; do
    name=$(basename "$src")
    PUT_CHANGED=0
    put_file "$SPLASH_DIR/$name" 644 root:root <"$src"
    if ((PUT_CHANGED)); then rebuild=1; fi
  done
  put_dir /usr/local/lib/momos 755 root:root
  put_file "$SPLASH_KEEP" 755 root:root <"$FILES/bin/momos-splash-keep"
  put_dir /etc/pacman.d/hooks 755 root:root
  put_file "$SPLASH_HOOK" 644 root:root <"$FILES/pacman/95-momos-splash.hook"

  if [[ $(plymouth-set-default-theme) == momos ]]; then
    note "unchanged: the default Plymouth theme is momos"
  else
    run plymouth-set-default-theme momos
    rebuild=1
  fi
  # The initramfs carries the theme, so a new theme or new files need a
  # rebuild. Nothing rebuild, nothing rebuilt.
  if ((rebuild)); then
    rebuild_boot
    check_keyfile_boot
  else
    note "boot image left alone"
  fi
}

step_splash_omarchy() {
  log "boot splash -> Omarchy's"
  command -v plymouth-set-default-theme >/dev/null || die "plymouth is not installed"
  remove_file "$SPLASH_HOOK"
  remove_file "$SPLASH_KEEP"
  local rebuild=0
  if [[ $(plymouth-set-default-theme) != omarchy ]]; then
    run plymouth-set-default-theme omarchy
    rebuild=1
  else
    note "unchanged: the default Plymouth theme is omarchy"
  fi
  if [[ -d $SPLASH_DIR ]]; then
    run rm -rf "$SPLASH_DIR"
    ((DRY_RUN)) || note "removed: $SPLASH_DIR"
  fi
  if ((rebuild)); then
    rebuild_boot
    check_keyfile_boot
  fi
}

step_tailscale() {
  log "tailscale"
  run systemctl enable --now tailscaled.service
  if ((!DRY_RUN)) && tailscale status --json 2>/dev/null |
    jq -e '.BackendState == "Running" and ((.Self.Tags // []) | index("tag:momos"))' >/dev/null; then
    note "already on the tailnet as tag:momos ($(tailscale ip -4 | head -n1))"
    return 0
  fi
  [[ -n ${MOMOS_TAILSCALE_AUTHKEY:-} ]] || die "set MOMOS_TAILSCALE_AUTHKEY to a tagged (tag:momos) auth key"
  if ((DRY_RUN)); then
    note "would run: tailscale up --auth-key=file:... --advertise-tags=tag:momos --ssh=false"
    return 0
  fi
  local keyfile
  keyfile=$(mktemp /run/momos-tailscale.XXXXXX)
  chmod 600 "$keyfile"
  printf '%s' "$MOMOS_TAILSCALE_AUTHKEY" >"$keyfile"
  if ! tailscale up --auth-key="file:$keyfile" --advertise-tags=tag:momos --ssh=false \
    --hostname="$(hostname)"; then
    rm -f "$keyfile"
    die "tailscale up failed"
  fi
  rm -f "$keyfile"
  note "joined: $(tailscale ip -4 | head -n1)"
  note "turn off key expiry for this node in the Tailscale admin console"
  note "restart wayvnc in her session so it moves to the Tailscale address (it also does this by itself within 30 s)"
}

step_firewall() {
  log "firewall: SSH and VNC on tailscale0 only"
  local ts_ip
  ts_ip=$(tailscale_ipv4)
  [[ -n $ts_ip ]] || die "tailscale0 has no address. Run the tailscale step first; refusing so SSH isn't cut off"
  tailscale status >/dev/null 2>&1 || die "tailscale is not running; refusing"
  if ((!FORCE)) && ! ss -Htn state established "( sport = :22 )" | awk '{print $3}' | grep -q "^$ts_ip:22$"; then
    die "no SSH session over Tailscale ($ts_ip:22) right now. Connect over Tailscale first, or pass --force"
  fi

  local status
  status=$(ufw status verbose)
  grep -qE '^22/tcp on tailscale0 +ALLOW IN' <<<"$status" ||
    run ufw allow in on tailscale0 to any port 22 proto tcp comment 'momos-ssh-tailscale'
  grep -qE '^5900/tcp on tailscale0 +ALLOW IN' <<<"$status" ||
    run ufw allow in on tailscale0 to any port 5900 proto tcp comment 'momos-vnc-tailscale'

  grep -qE '^22/tcp +LIMIT IN +Anywhere' <<<"$status" && run ufw delete limit 22/tcp
  grep -qE '^53317/tcp +ALLOW IN +Anywhere' <<<"$status" && run ufw delete allow 53317/tcp
  grep -qE '^53317/udp +ALLOW IN +Anywhere' <<<"$status" && run ufw delete allow 53317/udp
  ((DRY_RUN)) || ufw status numbered
}

step_firewall_lan() {
  log "firewall: allow SSH from the LAN again"
  if ufw status verbose | grep -qE '^22/tcp +LIMIT IN +Anywhere'; then
    note "LAN SSH rule already present"
  else
    run ufw limit 22/tcp comment 'omarchy-sshd'
  fi
}

# Screen sharing in a browser (docs/contracts.md, "Screen sharing in a
# browser"). Tailscale Serve answers https://<laptop>.ts.net/ on port 443 with
# a Let's Encrypt certificate for the node's name, to tailnet devices the
# policy lets reach tcp:443 only, and passes the requests to 127.0.0.1:5901.
# Nothing listens there until the helper starts a session in the admin app.
# tailscaled answers port 443 itself, so ufw needs no rule for it.
web_screen_dns() {
  tailscale status --json 2>/dev/null | jq -r '.Self.DNSName // empty' | sed 's/\.$//'
}

web_screen_served() {
  tailscale serve status --json 2>/dev/null |
    jq -e --arg h "$1:443" '.Web[$h].Handlers["/"].Proxy == "http://127.0.0.1:5901"' >/dev/null
}

step_web_screen() {
  log "screen sharing in a browser: Tailscale Serve on port 443"
  tailscale status >/dev/null 2>&1 || die "tailscale is not running. Run the tailscale step first"
  local dns
  dns=$(web_screen_dns)
  [[ -n $dns ]] || die "no MagicDNS name for this node. Turn on MagicDNS in the Tailscale admin console"
  if web_screen_served "$dns"; then
    note "already serving https://$dns/"
    return 0
  fi
  if tailscale serve status --json 2>/dev/null | jq -e --arg h "$dns:443" '.Web[$h] != null' >/dev/null; then
    die "https://$dns/ already serves something else; see tailscale serve status"
  fi
  # Tailscale asks for HTTPS certificates to be turned on for the tailnet
  # first, and prints a link to do it.
  run tailscale serve --bg --https=443 http://127.0.0.1:5901
  note "serving https://$dns/ to your tailnet only (never Funnel)"
  note "the tailnet policy must allow tcp:443 to tag:momos; see system/tailscale-policy.hujson"
}

step_web_screen_off() {
  log "screen sharing in a browser: off"
  local dns
  dns=$(web_screen_dns)
  if [[ -n $dns ]] && web_screen_served "$dns"; then
    run tailscale serve --https=443 off
  else
    note "not served"
  fi
}

step_sudoers() {
  log "sudoers"
  local file="/etc/sudoers.d/$ADMIN_USER" tmp
  tmp=$(mktemp)
  printf '%s ALL=(ALL) NOPASSWD: ALL\n' "$ADMIN_USER" >"$tmp"
  visudo -cqf "$tmp" || die "generated sudoers line is invalid"
  put_file "$file" 440 root:root <"$tmp"
  rm -f "$tmp"
  if getent passwd "$PERSON_USER" >/dev/null; then
    if person_has_sudo; then
      die "$PERSON_USER has sudo rights; remove them"
    fi
    note "$PERSON_USER has no sudo"
  fi
}

step_machine_notes() {
  log "MACHINE-NOTES.md"
  local notes="$ADMIN_HOME/MACHINE-NOTES.md" section tmp
  section=$(
    printf '%s\n' "$NOTES_BEGIN"
    render "$SYSTEM_DIR/machine-notes.md"
    printf '%s\n' "$NOTES_END"
  )
  tmp=$(mktemp)
  if [[ -f $notes ]] && grep -qF "$NOTES_BEGIN" "$notes"; then
    # ENVIRON, not -v, so awk doesn't interpret backslashes in the text.
    SECTION=$section BEGIN_MARK=$NOTES_BEGIN END_MARK=$NOTES_END awk '
      $0 == ENVIRON["BEGIN_MARK"] { print ENVIRON["SECTION"]; skip = 1; next }
      $0 == ENVIRON["END_MARK"] { skip = 0; next }
      !skip { print }
    ' "$notes" >"$tmp"
  else
    if [[ -f $notes ]]; then
      cat "$notes" >"$tmp"
      printf '\n' >>"$tmp"
    fi
    printf '%s\n' "$section" >>"$tmp"
  fi
  put_file "$notes" 644 "$ADMIN_USER:$(id -gn "$ADMIN_USER")" <"$tmp"
  rm -f "$tmp"
}

step_check() {
  log "health checks (read only)"
  local ok=0 missing
  check() {
    if eval "$2" >/dev/null 2>&1; then
      printf '    ok    %s\n' "$1"
    else
      printf '    FAIL  %s\n' "$1"
      ok=1
    fi
  }
  local aur=()
  mapfile -t aur < <(aur_packages)
  missing=$(pacman -T "${PACMAN_PACKAGES[@]}" "${aur[@]}" || true)
  check "packages installed${missing:+ (missing: $missing)}" "[[ -z '$missing' ]]"
  check "bluetooth.service enabled" "systemctl is-enabled --quiet bluetooth.service"
  check "chromium policy is valid JSON" "jq -e . /etc/chromium/policies/managed/momos.json"
  check "user $PERSON_USER exists" "getent passwd $PERSON_USER"
  check "$PERSON_USER has no sudo" "! person_has_sudo"
  check "$PERSON_USER is in uinput" "id -nG $PERSON_USER | grep -qw uinput"
  check "/dev/uinput group is uinput" "[[ \$(stat -c %G /dev/uinput) == uinput ]]"
  if getent passwd "$PERSON_USER" >/dev/null; then
    require_person
    check "her hyprland.lua passes --verify-config" "hyprland_config_ok"
    check "her wayvnc config exists (mode 600)" "[[ \$(stat -c %a $PERSON_HOME/.config/wayvnc/config) == 600 ]]"
  fi
  check "momd and momctl in /usr/local/bin" "[[ -x /usr/local/bin/momd && -x /usr/local/bin/momctl ]]"
  check "lock screen PAM service" "[[ -f /etc/pam.d/momos-lock ]]"
  check "$PERSON_USER may join Wi-Fi networks (polkit)" "[[ -f /etc/polkit-1/rules.d/50-momos-wifi.rules ]]"
  check "admin $ADMIN_USER keeps passwordless sudo" "sudo -l -U $ADMIN_USER | grep -q NOPASSWD"
  # The MacBook Air's lid workarounds, only where the config says it has
  # that lid.
  if [[ $HW_LID == flaky-macbook ]]; then
    check "lid switch ignored by logind (MACHINE-NOTES)" \
      "busctl get-property org.freedesktop.login1 /org/freedesktop/login1 org.freedesktop.login1.Manager HandleLidSwitch | grep -q ignore"
    check "LID0 wake disabled (MACHINE-NOTES)" "grep LID0 /proc/acpi/wakeup | grep -q disabled"
  fi
  printf '    info  SDDM autologin user: %s\n' "$(sed -n 's/^User=//p' "$SDDM_AUTOLOGIN" 2>/dev/null)"
  printf '    info  disk keyfile: %s\n' "$([[ -f $MKINITCPIO_DROPIN ]] && echo on || echo off)"
  printf '    info  boot splash: %s\n' "$(plymouth-set-default-theme 2>/dev/null || true)"
  printf '    info  tailscale: %s\n' "$(tailscale_ipv4 || true)"
  local dns
  dns=$(web_screen_dns || true)
  if [[ -n $dns ]] && web_screen_served "$dns"; then
    printf '    info  screen sharing in a browser: https://%s/\n' "$dns"
  else
    printf '    info  screen sharing in a browser: off (install.sh web-screen)\n'
  fi
  return "$ok"
}

# ---------------------------------------------------------------------------
# Main

main() {
  local steps=()
  while (($#)); do
    case $1 in
      --config)
        CONFIG=${2:?--config needs a path}
        shift 2
        ;;
      --config=*)
        CONFIG=${1#--config=}
        shift
        ;;
      --admin)
        ADMIN_USER=${2:?--admin needs a user}
        shift 2
        ;;
      --dry-run)
        DRY_RUN=1
        shift
        ;;
      --force)
        FORCE=1
        shift
        ;;
      --password-stdin)
        PASSWORD_STDIN=1
        shift
        ;;
      -h | --help)
        usage
        exit 0
        ;;
      all)
        steps+=("${ALL_STEPS[@]}")
        shift
        ;;
      -*) die "unknown option: $1" ;;
      *,*)
        local part parts
        IFS=, read -ra parts <<<"$1"
        for part in "${parts[@]}"; do
          [[ -z $part ]] && continue
          if [[ $part == all ]]; then steps+=("${ALL_STEPS[@]}"); else steps+=("$part"); fi
        done
        shift
        ;;
      *)
        steps+=("$1")
        shift
        ;;
    esac
  done

  ((${#steps[@]})) || {
    usage
    exit 1
  }
  [[ $EUID -eq 0 ]] || die "run as root"
  load_config
  ((DRY_RUN)) && log "dry run: nothing will change"
  note "config: $CONFIG, person: $PERSON_USER, admin: $ADMIN_USER"

  local step
  for step in "${steps[@]}"; do
    case $step in
      packages) step_packages ;;
      chromium) step_chromium ;;
      user) step_user ;;
      session) step_session ;;
      shell) step_shell ;;
      binaries) step_binaries ;;
      wayvnc) step_wayvnc ;;
      sudoers) step_sudoers ;;
      machine-notes) step_machine_notes ;;
      splash) step_splash ;;
      splash-omarchy) step_splash_omarchy ;;
      check) step_check ;;
      autologin) step_autologin ;;
      autologin-admin) step_autologin_admin ;;
      keyfile) step_keyfile ;;
      keyfile-remove) step_keyfile_remove ;;
      tailscale) step_tailscale ;;
      firewall) step_firewall ;;
      firewall-lan) step_firewall_lan ;;
      web-screen) step_web_screen ;;
      web-screen-off) step_web_screen_off ;;
      *) die "unknown step: $step (see --help)" ;;
    esac
  done
}

main "$@"
