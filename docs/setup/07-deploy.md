# 7. Deploy and create the device

`mom deploy` builds `momd` and `momctl` on your machine, copies them and the parts of the repo the laptop needs to `/usr/local/src/momos` on the laptop, sends her config file to `/etc/momos/config.json`, and runs `system/install.sh` there. Then you create the device in Convex and give the laptop its token.

Do this step from your machine, over the LAN. Keep the laptop plugged in.

## Check the prerequisites

```sh
mom doctor
```

The first deploy needs SSH from your machine to the laptop with your key, `rsync` on both ends, passwordless sudo for your admin account on the laptop, and the config file from step 6. `mom doctor` checks each one with a single SSH connection and prints the fix for anything missing, like:

```
ok    rsync on this machine
ok    personal config file: ~/.config/momos/mom-laptop.jsonc
ok    SSH to admin@mom-laptop.local
FAIL  rsync on the laptop
      fix: mom ssh sudo pacman -S --needed rsync
FAIL  passwordless sudo for admin
      fix: On the laptop, as admin: echo 'admin ALL=(ALL) NOPASSWD: ALL' | sudo tee /etc/sudoers.d/admin && sudo chmod 440 /etc/sudoers.d/admin
2 problems to fix before `mom deploy`.
```

Run it again until it says "Ready for `mom deploy`." It exits 1 while anything fails.

## See what it will do

```sh
mom deploy --dry-run
```

This prints the build, rsync and install commands without running them. It reads the config file from `configFile` in `mom.json`, or from `--config FILE`.

## Deploy

```sh
mom deploy
```

The first run takes a while. By default it runs the install steps that only add packages and write files:

| Step | What it does |
|---|---|
| `packages` | installs Quickshell, wayvnc, ydotool, hypridle, Telegram, Chromium, Tailscale and a few tools with pacman, and, when `local.hardware.dkmsModules` lists `facetimehd`, builds the camera driver from the AUR if it's missing |
| `chromium` | a managed Chromium policy: uBlock Origin Lite forced on, other extensions blocked, no site notifications, no developer tools |
| `user` | creates her account, with no sudo, and lets it restart and turn off the laptop through polkit, for your Restart button and hers under More |
| `session` | her Hyprland config, the systemd user units for her session, her Chromium flags and idle rules, and her first `~/.config/momos/config.json`. Later runs only update `local.hardware` in it. |
| `shell` | the home screen, bar and lock screen, in `/usr/local/share/momos/shell` |
| `binaries` | `momd` and `momctl` in `/usr/local/bin` |
| `wayvnc` | screen-sharing config with a random password |
| `sudoers` | keeps your admin account's passwordless sudo and checks she has none |
| `machine-notes` | writes the MomOS section of your `~/MACHINE-NOTES.md` |
| `splash` | the boot splash says "MOM OS" instead of Omarchy's logo; rebuilds the boot image when it changes |

`system/README.md` describes every step in detail, with how to revert it.

Watch for two things in the output:

- **Her password.** The `user` step sets it from `MOMOS_PERSON_PASSWORD`, or asks. If it prints "no password for mom", set one with `mom ssh sudo passwd mom`. This is what she types to unlock the screen after locking it herself. A short PIN she already knows is fine.
- **The VNC password.** The `wayvnc` step prints it once, when it first makes it. Save it in your password manager. If you lose it, `mom ssh sudo grep ^password= /home/mom/.config/wayvnc/config` shows it again.

Every step can run again safely. A rerun with nothing to change prints `unchanged` for each file. Later, after you change code, deploy only what changed:

```sh
mom deploy --steps shell,binaries
```

`--no-build` skips building and sends the binaries from the last build.

## What she sees

While `mom deploy` runs, her screen says "Sam is updating your computer. It will be back in a minute." in a green banner at the top, on the lock screen and over the screensaver. The `shell` step restarts her shell, which blanks the screen for a second, and the notice comes back with it. When the deploy succeeds she sees "Done. Your computer is up to date." for 8 seconds. When it fails, or you press Ctrl-C, the notice goes away. If the connection drops and `mom` can't take it down, it goes by itself within 15 minutes. While the notice is up and she's on battery, the laptop doesn't go to sleep from idle.

`mom` writes a small file on the laptop for this, `~/.local/state/momos/updating.json` in her home ([contracts.md](../contracts.md#the-updating-notice)). On the very first deploy her account doesn't exist yet, so `mom` says it couldn't show the notice and carries on.

For a deploy that doesn't touch her session, like `--steps machine-notes` or `sudoers`, add `--no-notice` so she isn't told about something she'd never notice.

## Create the device

The device is the laptop's identity in Convex. Its token lets momd write the laptop's own events and read its own settings, and nothing else.

```sh
mom devices create mom-laptop --settings ~/.config/momos/mom-laptop.jsonc --install
```

- `mom-laptop` is the device's name in Convex. Use the same name as in `mom.json`.
- `--settings` seeds its settings in Convex from your config file, so the admin app and the bot know her name and tiles from the start.
- `--install` writes the token to `~/.config/momos/device-token` in her home on the laptop, mode 600, without printing it. Her account has to exist, which is why this comes after the deploy.

Without `--install`, the token is printed once. Use `--token-out FILE` to save it to a file instead. If you lose a token, revoke the device in the admin app and create a new one.

`mom devices create` runs `npx convex run provision:createDevice` in `packages/backend`, so it works before the admin app exists. It needs `packages/backend/.env.local` from step 3 and a logged-in Convex CLI. It uses the deployment in `.env.local`. If you set up a separate production deployment in step 3, add `--prod`. You can also create devices in the admin app's Devices page, which shows the token once for you to copy.

momd checks for its token every minute, so there's nothing to restart.

## Check

```sh
mom ssh sudo /usr/local/src/momos/system/install.sh check
```

This runs read-only checks: packages, the Chromium policy, her account and groups, her Hyprland config and your sudo. Everything should say ok. With `"lid": "flaky-macbook"` in the config, two more checks look for the MacBook Air's lid workarounds from `MACHINE-NOTES.md`: logind ignoring the lid switch and `LID0` wake turned off.

Her session doesn't run yet. SDDM still logs into your admin account at boot. Step 9 switches that. Until then, `mom status` and the other screen commands fail because there's no session of hers to talk to.

Next: [Tailscale and the firewall](08-tailscale-and-firewall.md).
