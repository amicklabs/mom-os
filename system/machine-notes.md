## MomOS

MomOS turns this laptop into an easy-mode computer for @PERSON_NAME@. The repo
is `amicklabs/mom-os`; the copy on this machine lives in `/usr/local/src/momos`.
`system/install.sh` there installs everything below, one step at a time, and
`system/README.md` explains each step and its revert. This section is rewritten
by `install.sh machine-notes`, so edit `system/machine-notes.md` in the repo
instead of here.

### Accounts

- `@PERSON_USER@` is her account. No sudo, not in `wheel`. Groups: `video`
  (backlight) and `uinput` (see Input below).
- `@ADMIN_USER@` keeps passwordless sudo in `/etc/sudoers.d/@ADMIN_USER@`.
  MomOS depends on it: `mom deploy` and remote agents run `install.sh` and fix
  things through it. This replaces the older advice above to delete it before
  handing the laptop over. SSH takes keys only, and once the firewall step has
  run, only over Tailscale.

### Her session

- SDDM autologin picks the account: `/etc/sddm.conf.d/autologin.conf`.
  `install.sh autologin` switches it to `@PERSON_USER@`,
  `install.sh autologin-admin` switches it back to `@ADMIN_USER@`. Both take
  effect at the next boot or logout.
- Her Hyprland config is `~@PERSON_USER@/.config/hypr/hyprland.lua`, written
  from scratch. It does not load Omarchy's defaults, so Omarchy updates can't
  change it, and none of the lid or power fixes in `~@ADMIN_USER@/.config/hypr/`
  apply to her session. It repeats the ones that matter:
  - The lid switch is not bound at all. No lock, no display change.
  - `XF86PowerOff` runs `systemctl suspend-then-hibernate`, same as here.
    To turn the computer off or restart it, she uses More, then "Turn off
    the computer" or "Restart the computer". Each asks first, then runs
    `momctl power off|restart` (`systemctl poweroff|reboot`).
    `/etc/polkit-1/rules.d/50-momos-reboot.rules` lets her account do both
    without a password.
  - Natural scrolling on, tap-to-click off (only a real press clicks),
    pointer speed -0.2, disable-while-typing on, no animations, cursor size
    @CURSOR_SIZE@.
  - No keybindings except volume, screen brightness and keyboard brightness.
  - Monocle layout: every window fills the area under the bar, one at a
    time, and fullscreen or maximize requests from apps are ignored.
    Workspace `home` stays empty so her home screen shows; each tile gets a
    workspace named `tile-<id>`. momd sends her home when a workspace empties.
- logind, sleep, hibernate and the `LID0` wake rule above are system-wide and
  cover her session too. MomOS doesn't change them.
- **Her session does sleep on its own**, unlike this one:
  - Lid: momd (`/usr/local/bin/momd`) samples the switch and the light sensor
    four times a second and averages them. Lid closed: screen off, media
    paused, the machine stays awake. Closed for 30 minutes: `systemctl
    suspend`. Its lid state is in `$XDG_RUNTIME_DIR/momos/state.json`
    (`.lid.closed`) as her.
  - Idle: `momos-idle.service` runs hypridle with
    `~@PERSON_USER@/.config/hypr/hypridle.conf`. 3 minutes idle: screensaver
    (`momctl screensaver on`). 15 minutes: screen off. 30 minutes:
    `systemctl suspend`, but only on battery. On AC power (a `Mains` supply
    in `/sys/class/power_supply/` with `online` = 1) it stays awake with the
    screen off, so it stays reachable over SSH while plugged in.
    `/usr/local/lib/momos/momos-idle on-ac` exits 0 on AC. Video and calls
    hold idle inhibitors, which stop all three. It also doesn't suspend
    while `mom deploy` or `mom update` runs: they write
    `~@PERSON_USER@/.local/state/momos/updating.json`, and a fresh
    `"state": "updating"` there (expiring within 20 minutes) holds the
    suspend off. Nothing retries the skipped suspend; the next one comes
    after her next input and 30 more idle minutes.
  - The two don't fight: hypridle's actions go through
    `/usr/local/lib/momos/momos-idle`, which won't turn the screen on or
    suspend while momd says the lid is closed.
  - New Telegram messages: the shell turns the screen on (`momctl screen
    on`, a no-op while momd says the lid is closed) and ends the
    screensaver, so she sees the card. With no input in the next 10 minutes
    it runs `momctl screen off`. Input before then leaves it to hypridle.
  - Waking from sleep still needs a key press, a trackpad click or the
    power button.
- Her session starts `momos-session.target`, a set of systemd user units in
  `/etc/systemd/user/`:
  - `momos-shell.service`: the MomOS shell, `qs -c momos`. The files are in
    `/usr/local/share/momos/shell`, linked from `/etc/xdg/quickshell/momos`.
    Restarts on every exit. After 5 failures in 2 minutes systemd gives up and
    `momos-fallback.service` opens Chromium full screen instead.
  - `momd.service`: the MomOS daemon, `/usr/local/bin/momd`. It and
    `/usr/local/bin/momctl` are single binaries built on the helper's machine
    by `mom deploy` and installed by `install.sh binaries`.
  - `momos-wayvnc.service`: screen sharing. See Remote access below.
  - `momos-ydotoold.service`: input injection for `momctl click/type`.
  - `momos-telegram.service`: Telegram, started hidden, restarted if she
    closes it (there is no tray to keep it in). momd brings a
    call window forward onto whatever she's looking at.
  - `momos-idle.service`: hypridle, see below.
  Logs: `journalctl --user -u 'momos-*' -u momd` as `@PERSON_USER@`.
- Chromium for her: `~@PERSON_USER@/.config/chromium-flags.conf` sets 125%
  scale (`--force-device-scale-factor=1.25`) and `--password-store=basic`,
  because autologin never unlocks the GNOME keyring and Chromium would
  otherwise ask for a keyring password.
- Chromium policy for every account on the machine, including this one:
  `/etc/chromium/policies/managed/momos.json`. uBlock Origin Lite is forced on,
  other extensions are blocked, dev tools are off, sites can't ask to send
  notifications. Delete the file to lift all of it.
- Some XDG autostart entries (snapshot notices, printer applet, Fcitx5) are
  hidden in her session by `~@PERSON_USER@/.config/autostart/*.desktop` files
  with `Hidden=true`.

### Input

- Her lock screen checks her PIN with PAM service `/etc/pam.d/momos-lock`
  (`pam_unix` only, no faillock). `momctl unlock` as her, or `mom unlock`,
  releases it remotely.
- `/etc/udev/rules.d/90-momos-uinput.rules` gives the `uinput` group
  read-write on `/dev/uinput`, so `ydotoold` runs as her instead of as root.
  Revert: delete the rule and `sudo udevadm trigger`.
- Trackpad. The kernel driver is `bcm5974`, USB `05ac:0290`. The USB port
  it hangs off reads as removable, so udev tagged it external, and libinput
  skips disable-while-typing and all palm detection on external touchpads.
  Her palms moved the pointer and clicked while she typed.
  `/etc/udev/hwdb.d/70-momos-touchpad.hwdb` marks it internal.
  Check: `udevadm info /dev/input/event8 | grep TOUCHPAD_INTEGRATION` prints
  `internal`, and `sudo libinput list-devices` shows `Disable-w-typing:
  enabled` for bcm5974 (`n/a` means it's still external).
- Palm rejection by touch size then comes from libinput's own
  `50-system-apple.quirks` (`AttrPalmSizeThreshold=1600`,
  `AttrTouchSizeRange=150:130`). There is no
  `/etc/libinput/local-overrides.quirks`. The pad reports no pressure, so
  `AttrPalmPressureThreshold` does nothing, and libinput skips edge palm
  detection on Apple pads. Before lowering the palm threshold, measure her
  fingers in person: a normal finger can read 850 to 950 on these pads.
  `sudo libinput measure touch-size --touch-threshold 150:130
  --palm-threshold 1600 /dev/input/event8` (from `libinput-tools`).
- Her Hyprland config turns tap-to-click off, so only a real press clicks,
  and sets pointer speed to -0.2. Disable-while-typing ignores new touches
  for 0.2 to 0.5 seconds after a key. libinput hardcodes those times.
- Revert: delete the hwdb file, `sudo systemd-hwdb update`, reboot. Set
  `tap_to_click = true` and `sensitivity = 0` in
  `system/files/hypr/hyprland.lua` and rerun `install.sh session`.

### Remote access

- wayvnc runs in her session only, never here. It listens on her Tailscale
  address, or on `127.0.0.1` while Tailscale is down, port 5900. Never on the
  LAN. Password auth over RSA-AES; the password is in
  `~@PERSON_USER@/.config/wayvnc/config` (mode 600). Use a viewer with RSA-AES
  support, such as TigerVNC 1.13 or later. macOS Screen Sharing needs Apple DH
  (`relax_encryption=true`), which is off: in wayvnc 0.10.1 / neatvnc 1.0.1 an
  Apple DH client crashed wayvnc during the handshake.
- Screen capture works on Hyprland 0.56: wayvnc 0.10.1 uses
  `ext-image-copy-capture`. Tested September 25 in the admin session on
  127.0.0.1; the frames matched a `grim` screenshot.
- Screen sharing in the admin app runs a second wayvnc, started by momd only
  while the helper has a session open, on a Unix socket under
  `/run/user/<uid>/momos/screen/`, with input off unless he turned control on.
  Tailscale Serve (`install.sh web-screen`) passes
  `https://<laptop>.ts.net/` to momd on `127.0.0.1:5901`. `tailscale serve
  status` shows it; `install.sh web-screen-off` removes it.
- Tailscale (`install.sh tailscale`) joins the tailnet as `tag:momos`. The
  policy to paste into the admin console is `system/tailscale-policy.hujson`.
- `install.sh firewall` allows 22 and 5900 on `tailscale0` only and removes
  the LAN SSH rule and LocalSend's 53317 rules. It refuses to run unless
  Tailscale is up and you're connected over it. `install.sh firewall-lan`
  puts LAN SSH back.

### Disk unlock

- `install.sh keyfile` adds a random keyfile,
  `/etc/cryptsetup-keys.d/momos-root.key`, to a LUKS key slot and embeds it in
  the initramfs (`/etc/mkinitcpio.conf.d/90-momos-keyfile.conf`, and
  `cryptkey=rootfs:...` from `/etc/limine-entry-tool.d/90-momos-keyfile.conf`).
  Boot and hibernation resume then skip the passphrase. The disk passphrase
  still works.
- `install.sh keyfile-remove` ("require password at startup") checks the
  passphrase, removes the keyfile's key slot, removes both drop-ins and
  rebuilds with `limine-mkinitcpio`.
- Check: `sudo ls /etc/mkinitcpio.conf.d/90-momos-keyfile.conf` exists only
  while the keyfile is on.

### Boot splash

- The boot and shutdown splash says "MOM OS": Plymouth theme `momos` in
  `/usr/share/plymouth/themes/momos`, installed by `install.sh splash`. It's
  a copy of Omarchy's theme with new colors and wordmark. Omarchy's own
  theme in `/usr/share/plymouth/themes/omarchy` is untouched.
  `install.sh splash-omarchy` puts Omarchy's back.
- Every `omarchy-settings` upgrade overwrites `/etc/plymouth/plymouthd.conf`
  with `Theme=omarchy`. `/etc/pacman.d/hooks/95-momos-splash.hook` runs
  `/usr/local/lib/momos/momos-splash-keep` afterwards, which sets `momos`
  again and rebuilds with `limine-mkinitcpio`. Running
  `omarchy-plymouth-set`, `omarchy-refresh-plymouth` or
  `omarchy-reinstall-configs` by hand also switches it back to Omarchy's;
  rerun `install.sh splash` after them.
- The theme lives in the initramfs, so a change needs a rebuild. With the
  keyfile on, check the rebuilt image still has it before rebooting:
  `grep -c cryptkey= /boot/limine.conf`.
- Check: `plymouth-set-default-theme` prints `momos`.

### MomOS health check

    sudo /usr/local/src/momos/system/install.sh check   # read only; includes her Hyprland config
    id @PERSON_USER@                        # groups video, uinput; no wheel
    sudo -l -U @PERSON_USER@                # only Omarchy's "!/usr/bin/asdcontrol" deny line
    grep User= /etc/sddm.conf.d/autologin.conf   # who logs in at boot
    sudo ufw status numbered                # after firewall: 22 and 5900 on tailscale0 only
