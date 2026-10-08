# system/

The install script for her laptop and the files it installs. Run it as root on
the laptop:

    sudo /usr/local/src/momos/system/install.sh [--config PATH] [--dry-run] STEP...

`mom deploy` builds `momd` and `momctl` on the helper's machine (`bun build
--compile`), rsyncs them to `/usr/local/src/momos/bin/` along with `system/`
and `shell/`, sends the personal config to `/etc/momos/config.json` (mode
600), and runs `install.sh --config /etc/momos/config.json STEP...`. Its
`--steps` takes a comma-separated list (`--steps shell,binaries`), default
`all`; install.sh accepts steps as separate arguments or as one
comma-separated list. Every step can be rerun, and a rerun with nothing to do prints `unchanged` for
each file. `--dry-run` prints what would change and changes nothing.

Settings come from the config file, `/etc/momos/config.json` by default (JSON,
or JSONC with whole-line `//` comments). The script reads `person.user`,
`person.name` and the tile ids of the `telegram` and `chromium` apps. The admin
account comes from `--admin`, then `$MOMOS_ADMIN_USER`, then `admin.user` in
the config, then `$SUDO_USER`.

No secret lives in the repo. Her password, the disk passphrase and the
Tailscale auth key come from environment variables or a prompt. The VNC
password is generated on the laptop.

## Steps

`all` runs the steps marked safe. They only add packages and write files, so
they can run remotely at any time. The rest change how the laptop boots or
who can reach it, so they only run by name, and only with the helper ready to fix
things.

| Step | Safe? | What it does | Revert |
|---|---|---|---|
| `packages` | yes | Installs hypridle, wayvnc, ydotool, wtype, playerctl, tailscale, telegram-desktop, grim, jq, quickshell, chromium, BlueZ and PipeWire's Bluetooth audio for the Speaker page, and a few tools with pacman (`--needed`, no `-y`), and enables `bluetooth.service`. When the config's `local.hardware.dkmsModules` lists `facetimehd`, builds the facetimehd AUR packages with yay as the admin, only if one is missing. | `pacman -R` what you don't want; `systemctl disable --now bluetooth.service`. |
| `chromium` | yes | Writes `/etc/chromium/policies/managed/momos.json`: uBlock Origin Lite forced on, every other extension blocked, no site notifications, no dev tools, Safe Browsing on, password manager on, sign-in allowed, no guest or new profiles, no default-browser prompt, and a new tab instead of the last session at startup. It applies to every account, the admin's too. | Delete the file. |
| `user` | yes | Creates the `uinput` group and `/etc/udev/rules.d/90-momos-uinput.rules`. Writes `/etc/udev/hwdb.d/70-momos-touchpad.hwdb`, which marks the MacBook Air's built-in trackpad as internal so libinput turns on disable-while-typing and palm detection for it, and runs `systemd-hwdb update`. It takes effect at the next boot. Creates her account in groups `video` and `uinput`, takes it out of `wheel`, `sudo` and `adm`, and sets her password from `MOMOS_PERSON_PASSWORD`, `--password-stdin`, or a prompt. With none of those it leaves an existing password alone. Writes `/etc/polkit-1/rules.d/50-momos-reboot.rules`, which lets her account (and no other) run the `org.freedesktop.login1.reboot*` and `power-off*` actions without a password, even with other sessions open, so momd can carry out the helper's Restart action and she can restart or turn off the computer from More. Writes `/etc/polkit-1/rules.d/50-momos-wifi.rules`, which lets her account (and no other) scan, join, save and forget Wi-Fi networks and turn Wi-Fi on without a password: NetworkManager's `network-control`, `settings.modify.own`, `settings.modify.system`, `wifi.scan` and `enable-disable-wifi` actions. It isn't limited to her local session, so `mom wifi connect` works over SSH. | `userdel -r <user>`, delete the three rule files and the group. Delete the hwdb file and run `systemd-hwdb update`. |
| `session` | yes | Writes her `~/.config/hypr/hyprland.lua` from `files/hypr/hyprland.lua` and checks it with `Hyprland --verify-config`. Installs the systemd user units to `/etc/systemd/user/` and the helper scripts to `/usr/local/lib/momos/`. Writes her `chromium-flags.conf` (125% scale, `--password-store=basic`, no "Restore pages?" prompt), `hypridle.conf`, `environment.d/50-momos.conf` (`YDOTOOL_SOCKET`), and hides some XDG autostart entries. Seeds `~/.config/momos/config.json` from the config file only if it doesn't exist yet, since momd owns it after that. On later runs it only copies `local.hardware` from the config file into it, written to a temp file and renamed. | Delete her files. The units only start from her Hyprland config. |
| `shell` | yes | Copies the repo's `shell/` to `/usr/local/share/momos/shell` and links `/etc/xdg/quickshell/momos` to it. Installs `/etc/pam.d/momos-lock`, which her lock screen uses to check her PIN. | Delete all three. |
| `binaries` | yes | Installs `bin/momd` and `bin/momctl` from `/usr/local/src/momos` (built and synced by `mom deploy`) to `/usr/local/bin`, replacing each with a rename. Restarts her `momd.service` if momd changed and her session is running. | Delete both binaries. |
| `wayvnc` | yes | Writes her `~/.config/wayvnc/config` (mode 600) and an RSA key, with a random 16-character password. It prints the password once, when it generates one. Later runs keep it. | Delete `~/.config/wayvnc/`. The service won't start without it. |
| `sudoers` | yes | Makes sure `/etc/sudoers.d/<admin>` still gives the admin passwordless sudo, checked with `visudo`, and fails if she has any sudo rights. | Delete the file, but agents and `mom deploy` need it. |
| `machine-notes` | yes | Rewrites the MomOS section of the admin's `~/MACHINE-NOTES.md` from `machine-notes.md`, between `<!-- momos:begin ... -->` and `<!-- momos:end -->`. The rest of the file stays as it is. | Delete the section. |
| `splash` | yes | The boot splash says "MOM OS" instead of Omarchy's logo. Copies `files/plymouth/momos/` to `/usr/share/plymouth/themes/momos` (a directory MomOS owns; Omarchy's theme is left alone), runs `plymouth-set-default-theme momos` and rebuilds the boot image with `limine-mkinitcpio`, the way `omarchy-plymouth-set` does. It rebuilds only when a file or the theme changed, and afterwards checks the boot entries still carry the keyfile's `cryptkey=`. It also installs `/etc/pacman.d/hooks/95-momos-splash.hook` and `/usr/local/lib/momos/momos-splash-keep`, which put the theme back after an Omarchy update (see below). | `splash-omarchy` |
| `splash-omarchy` | yes | Puts Omarchy's splash back: removes the hook and its script, runs `plymouth-set-default-theme omarchy`, deletes `/usr/share/plymouth/themes/momos` and rebuilds. | `splash` |
| `check` | yes | Read-only health checks: packages, `bluetooth.service`, policy, her account and sudo, `/dev/uinput`, her Hyprland config, the admin's sudo, and, with `"lid": "flaky-macbook"` in the config, the lid fixes from MACHINE-NOTES. | |
| `autologin` | **no** | Points SDDM autologin (`/etc/sddm.conf.d/autologin.conf`) at her account with the `omarchy.desktop` (uwsm) session. It checks her Hyprland config first. It doesn't restart SDDM, so it takes effect at the next boot or logout. | `autologin-admin` |
| `autologin-admin` | yes | Points SDDM autologin back at the admin. | |
| `keyfile` | **no** | Makes a random keyfile, `/etc/cryptsetup-keys.d/momos-root.key`, and adds it to a LUKS key slot. That asks for the current passphrase, or reads `MOMOS_LUKS_PASSPHRASE`. Then it tests the key, writes `FILES+=` to `/etc/mkinitcpio.conf.d/90-momos-keyfile.conf` and `cryptkey=rootfs:...` to `/etc/limine-entry-tool.d/90-momos-keyfile.conf`, and runs `limine-mkinitcpio`. Try `--dry-run` first. | `keyfile-remove` |
| `keyfile-remove` | **no** | "Require password at startup." It proves a passphrase still opens the disk, removes the keyfile's key slot, deletes both drop-ins, rebuilds, and shreds the key. It refuses if the keyfile is the only key slot. | `keyfile` |
| `tailscale` | **no** | Enables `tailscaled` and runs `tailscale up --advertise-tags=tag:momos --ssh=false` with `MOMOS_TAILSCALE_AUTHKEY`. It passes the key through a mode 600 file in `/run`, never on the command line. | `tailscale logout`, `systemctl disable --now tailscaled`, and delete the node in the admin console. |
| `firewall` | **no** | Allows 22 and 5900 on `tailscale0` only, then deletes the LAN `22/tcp LIMIT` rule and LocalSend's 53317 rules. It refuses unless `tailscale0` has an address and there's an SSH session over Tailscale right now (`--force` skips that second check). | `firewall-lan` |
| `firewall-lan` | yes | Puts back `ufw limit 22/tcp`. | |
| `web-screen` | **no** | Screen sharing in the admin app. Runs `tailscale serve --bg --https=443 http://127.0.0.1:5901`, so tailnet devices reach momd's screen-sharing listener at `https://<laptop>.<your-tailnet>.ts.net/`. Nothing listens there until a session starts. Refuses if 443 already serves something else. Tailscale asks you to turn on HTTPS certificates for the tailnet the first time. | `web-screen-off` |
| `web-screen-off` | yes | `tailscale serve --https=443 off`. The Screen page then can't connect; `mom vnc` still works. | `web-screen` |

### Why the risky steps can't lock anyone out

- `keyfile` adds a key slot and never removes one. If the initramfs can't find
  the key, the `encrypt` hook asks for the passphrase as it does today.
  Snapshot boot entries made before the change still ask for the passphrase.
- `keyfile-remove` removes the key slot only after a passphrase has opened the
  disk.
- `firewall` adds the Tailscale rules before it deletes the LAN rule, and runs
  only while an SSH session over Tailscale is up.
- `autologin` never restarts SDDM. If her session is broken, the admin can
  still SSH in and run `autologin-admin`.

## What her session runs

Her Hyprland config loads nothing from Omarchy. There are no keybindings
except volume, screen and keyboard brightness, and the power button
(`systemctl suspend-then-hibernate`, same as the admin session). The lid
switch isn't bound, since the sensor is broken and momd will handle it. Every
workspace uses the monocle layout, so each window fills the area under the
shell's bar and only one shows at a time. Apps' own fullscreen and maximize
requests (YouTube, F11) are ignored. Dialogs float centered. Workspace `home`
stays empty for the home screen, and each tile gets `tile-<id>`. momd sends
her home when the workspace she's on empties; see "Tiles and windows" in
`docs/contracts.md`.

On start it runs `/usr/local/lib/momos/momos-session-start`, which hands the
Wayland variables to systemd and starts `momos-session.target`:

| Unit | Runs | Restarts |
|---|---|---|
| `momos-shell.service` | `qs -c momos`, with `MOMOS_NOTIFICATIONS=1` so it's always her notification server | always. After 5 failures in 2 minutes it gives up and `momos-fallback.service` opens Chromium full screen. |
| `momd.service` | `/usr/local/bin/momd` | always, once the binary exists |
| `momos-wayvnc.service` | `momos-wayvnc` | always. Listens on the Tailscale IPv4 address, or on 127.0.0.1 until Tailscale comes up. It checks every 30 seconds and moves over by itself. |
| `momos-ydotoold.service` | `ydotoold` on `$XDG_RUNTIME_DIR/.ydotool_socket` | always |
| `momos-telegram.service` | `Telegram -startintray`, after the shell and the sound services, once the shell owns `org.freedesktop.Notifications` (it waits up to 30 seconds, then starts anyway) | always. Her session has no tray, so closing the window quits Telegram; it comes back hidden. |
| `momos-idle.service` | `hypridle` with her `~/.config/hypr/hypridle.conf` | always |

Idle, from `files/hypr/hypridle.conf`: after 3 minutes the screensaver
(`momctl screensaver on`, off again on any input), after 15 the screen goes
off, after 30 the laptop suspends if it's on battery. On AC power it stays
awake with the screen off, so the helper can always reach it while it's
plugged in. hypridle honors idle inhibitors, so video
and calls hold all of it off. The actions run `/usr/local/lib/momos/momos-idle`,
which leaves the screen off and skips the suspend while momd reports the lid
closed. It also skips the suspend while the helper's updating marker
(`~/.local/state/momos/updating.json`, written by `mom deploy` and `mom
update`) is fresh. momd owns the lid: screen off when it closes, suspend
after 30 minutes closed.

A new Telegram message turns the screen on (`momctl screen on`, which does
nothing while the lid is closed) and ends the screensaver, so she sees the
card. If nobody touches the laptop, the shell turns the screen off again
after 10 minutes.

When Telegram opens a new window whose title isn't "Telegram" or
"Media viewer" (a call window is titled with the caller's name), momd moves
it onto the workspace on screen and focuses it. That rule comes from Telegram
Desktop's source and hasn't met a real call yet.

The shell runs as `-c momos`, not `-p <path>`. Quickshell matches IPC clients
by the path it was launched with, and a symlinked path doesn't match the real
one, so `qs -c momos ipc call shell ...` only finds a shell launched with
`-c momos`. That form is what `docs/contracts.md` uses.

Logs, as her: `journalctl --user -u 'momos-*' -u momd`.

## Screen sharing notes

wayvnc 0.10.1 captures Hyprland 0.56 through `ext-image-copy-capture`. The test
on September 25 ran in the admin session on 127.0.0.1, and the captured frames
matched a `grim` screenshot. `wayvncctl` works on the default socket
(`$XDG_RUNTIME_DIR/wayvncctl`), and `wayvncctl event-receive` reports
`client-connected` and `client-disconnected`, which momd needs for the
"Sam is looking" banner.

Auth is RSA-AES only. Use TigerVNC 1.13 or later, or another viewer with
RSA-AES. `relax_encryption` is off because it enables Apple DH, which macOS
Screen Sharing needs, and an Apple DH handshake crashed wayvnc (SIGABRT from a
divide by zero in GMP inside neatvnc 1.0.1) even with the right password.

## Boot splash

The `momos` theme is Omarchy's script with MomOS's colors: "MOM OS" in
Newsreader, in the paper color of her Morning theme, on a warm near-black.
Omarchy shows its progress bar only after the disk passphrase. With the
keyfile there's no passphrase, so this theme shows the bar from the start of
boot. Shutdown and restart show the wordmark alone. The passphrase prompt is
Omarchy's, recolored, for snapshot boot entries that still ask.
`files/plymouth/render.sh` renders the PNGs; rerun it after changing a color
and commit the results.

Omarchy updates would put its own splash back. The `omarchy-settings`
package's install script copies Omarchy's `plymouthd.conf` (`Theme=omarchy`)
over `/etc/plymouth/plymouthd.conf` on every install and upgrade, so the next
boot image rebuild, usually a kernel update, would bake the Omarchy theme in
again. The pacman hook runs after any transaction that installs or upgrades
`omarchy-settings`, and if the theme isn't `momos` it sets it back and runs
`limine-mkinitcpio`. Nothing else in Omarchy touches the theme on its own:
`omarchy-plymouth-set`, `omarchy-refresh-plymouth`, `omarchy-plymouth-reset`
and `omarchy-reinstall-configs` do, but only when someone runs them. Rerun
`install.sh splash` after any of those.

SDDM's Omarchy theme also shows the Omarchy logo, on its login screen. With
autologin into her account she never sees it at boot. She would only see it
if her session ended, for example if Hyprland crashed, since SDDM doesn't log
back in on its own. MomOS leaves SDDM's theme alone.

## Other files

- `tailscale-policy.hujson`: grants for the Tailscale admin console. The helper's
  devices reach `tag:momos` on 22, 5900 and 443, and nothing lets `tag:momos`
  reach anything. Remove the default allow-all grant when you paste it in.
- `machine-notes.md`: the MomOS section for `~<admin>/MACHINE-NOTES.md`.
