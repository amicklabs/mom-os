# `mom` reference

`mom` runs on your own machines. It reaches the laptop over SSH, as your admin account, and runs `momctl` there as her. It also deploys, updates, opens screen sharing and creates devices. [Setup step 5](../setup/05-mom.md) covers installing it and `mom.json`.

## Help output

This is `mom --help`, word for word. `mom help <command>` or `mom <command> --help` prints one entry.

```
mom: see and fix a MomOS laptop from your own machine.

Usage: mom [--device NAME] [--json] <command> [args]

The laptop's screen and apps (momctl on the laptop as the person, over SSH):
  status                      Full state: momd, apps, network, battery
  screenshot [--out FILE]     Take a screenshot and copy it here; prints the path.
                              Nothing shows on the laptop.
  apps                        Open app windows
  open <tile>                 Launch or focus a tile's app
  reload <tile>               Reload a web app or Browser tile's page (F5), or
                              open it if it isn't open. The screen says
                              "<helper> refreshed <tile>." for a few seconds
  home                        Show the home screen
  say "<text>" [--seconds N]  Show a message on the laptop's screen
  lock | unlock               Lock or unlock the screen
  volume up|down|mute         Change the volume
  click <x> <y> [right]       Click at a screen position (left button unless
                              "right")
  type "<text>"               Type text
  key <combo>                 Press a key combination
  press-help [--text T] [--screenshot] [--call-me] [--voice-file F]
                              Send a help request as the Help pop-up does
                              (momctl help). F is an Ogg Opus file on the laptop
  screensaver on|off          Start or stop the screensaver
  screen on|off               Turn the screen on or off (on does nothing while
                              the lid is closed)
  wifi                        Wi-Fi status
  wifi scan [--fresh]         Networks in range, known ones first
  wifi connect <name> [--password-stdin] [--hidden] [--save-only]
                              Join a network and save it, or with --save-only
                              only save it for later. The password is
                              typed at a prompt or piped in, never an argument.
  wifi forget <name> [--force]
                              Delete a saved network (--force if it's in use)
  wifi portal [open]          Check for a hotel-style sign-in page, or open it
  speaker                     Bluetooth, saved speakers and where the sound goes
  speaker scan [--seconds N]  Speakers nearby (10 s). One in pairing mode
                              shows up by name
  speaker connect <address>   Pair if needed, connect, and play the sound on it
  speaker output computer|<address>
                              Play the sound on the laptop or on a speaker,
                              without disconnecting anything
  speaker disconnect <address>
                              Disconnect it; the sound goes back to the laptop
  speaker forget <address>    Unpair it
  logs [--unit momd|shell|wayvnc] [--lines N]
                              Recent logs from the person's session
  restart shell|momd|wayvnc [--no-notice]
                              Restart part of the person's session. For the
                              shell, the updating notice shows (see deploy)
  health                      Battery, disk, DKMS modules, versions

Remote access:
  ssh [command...]            Shell (or one command) as the admin user
  vnc                         Open the laptop's screen in a local VNC viewer

Maintenance:
  deploy [--steps LIST] [--config FILE] [--no-build] [--dry-run]
         [--no-notice]
                              Build momctl and momd, sync the repo to
                              /usr/local/src/momos and run system/install.sh.
                              The screen says "<helper> is updating your
                              computer" meanwhile, unless --no-notice
  doctor [--config FILE]      Check what the first deploy needs: SSH, rsync
                              on both ends, the admin's passwordless sudo and
                              the config file. Prints a fix for each problem.
  update [--yes] [--no-reboot] [--no-notice]
                              Update the system, check the DKMS drivers listed
                              in local.hardware were built, reboot only if
                              they were, then confirm everything came back.
                              Shows the updating notice, as deploy does
  updating on [--minutes N] | done | off
                              Show or clear the updating notice by hand, e.g.
                              around work over `mom ssh`. on lasts N minutes
                              (15, at most 20); done says "Done" for a few
                              seconds

Convex (needs convexUrl and the dispatcher token):
  help-requests               Recent help requests
  jobs                        Recent agent jobs

Setup:
  init [--device NAME] [--host HOST] [--user USER] [--admin USER]
       [--helper NAME] [--convex-url URL] [--force]
                              Write a starter ~/.config/momos/mom.json
  devices                     List configured devices
  devices create <name> [--settings FILE] [--install] [--token-out FILE]
                 [--prod]
                              Create a device and its token in Convex (npx
                              convex run, no admin app needed). --settings
                              seeds its settings from a config file.
                              --install writes the token to the person's
                              ~/.config/momos/device-token on the laptop.
                              Otherwise the token is printed once. --prod
                              uses the production deployment instead of the
                              one in packages/backend/.env.local.

Options:
  -d, --device NAME   Which laptop (default: $MOM_DEVICE, defaultDevice, or the only one)
      --json          JSON output (momctl's JSON is passed through as is)
  -h, --help          This help
  -v, --version       Print the version
```

## Picking a laptop

With one laptop in `mom.json`, every command uses it. With several, `mom` picks the first of `--device NAME`, `$MOM_DEVICE`, `defaultDevice` in `mom.json`, or the only device.

`$MOM_CONFIG` points `mom` at a different config file.

## Output

Screen commands print what `momctl` returns, as YAML-like text. Add `--json` to get `momctl`'s JSON exactly, which is what agents use:

```sh
mom status --json | jq '.data.momd'
```

The exit code is `momctl`'s: 0 on success. An SSH failure exits 255 with a message naming the host.

## Notes on some commands

**`status`** is the first thing to run. It shows her `state.json` from momd and how old it is, her open windows, and whether momd answers. A `file.stale` of `true` means momd hasn't written state for a while, so it's probably down.

**`screenshot`** copies a PNG to `~/.cache/momos/screenshots/<device>-<time>.png`, also updates `<device>-latest.png`, keeps the newest 50 and prints the path. `--out FILE` saves it somewhere else. Nothing shows on her screen and there's no wait. If the screen was off, momctl turns it on first: `mom` prints "(woke the screen)" on stderr, and `--json` output has `"screenWoken": true` (`null` from a momctl too old to say). See [security.md](../security.md#privacy).

**`say`** shows "Sam says: ..." on her screen. Keep it to one short sentence. `--seconds N` sets how long it stays, from 5 to 3600.

**`click`**, **`type`** and **`key`** send input through `ydotool`. Coordinates are screen pixels, as in a screenshot. `click <x> <y> right` right-clicks; without `right` it's a left click. `key` takes combos like `enter`, `escape` or `ctrl+l`.

**`wifi`** shows the network she's on. `wifi scan` lists the networks in range. `wifi connect "<name>" --password-stdin` adds one for her and saves it, so the laptop joins it by itself when it's in range: `mom` asks for the password with echo off, or reads it from a pipe, and sends it over SSH's stdin, never on a command line. To load a network before she travels, like a relative's home network, add `--save-only`: the laptop saves it and joins it by itself when it's in range, without trying it now. Without `--save-only`, `connect` joins straight away, which drops the network she's on, and you with it if the new one doesn't work out. See [When she's away from home](troubleshooting.md#when-shes-away-from-home).

**`speaker`** lists her saved Bluetooth speakers and says where her sound plays. `speaker scan` looks for 10 seconds; a speaker in pairing mode shows up by name with its address, and `speaker connect <address>` pairs it, connects it and sends her sound to it. See [Her Bluetooth speaker](speaker.md#doing-the-first-pairing-yourself).

**`press-help`** sends a help request the way her Help pop-up does, including the Telegram message, and an agent when there's `--text` or a voice note. `--text`, `--screenshot`, `--call-me` and `--voice-file` match the pop-up's buttons. Useful for testing; see [When she asks for help](help.md#testing-it).

**`restart`** restarts one part of her session: `shell`, `momd` or `wayvnc`. Restarting the shell blanks her screen for a second, so `mom restart shell` first puts up "Sam is updating your computer. It will be back in a minute." for 3 seconds, and takes it down 5 seconds after the restart. `--no-notice` skips that. It doesn't reboot the laptop. For that, use the admin app, the bot's `/restart`, or `mom ssh sudo systemctl reboot`.

**`ssh`** with no arguments opens a shell as your admin account. With arguments it runs them there, joined into one command line: `mom ssh sudo journalctl -b -p err`.

**`vnc`** opens a VNC viewer on her screen. On Linux it looks for TigerVNC's `vncviewer`, Remmina, wlvncc, KRDC and Vinagre, in that order. On macOS it only uses TigerVNC, because Screen Sharing can't connect to wayvnc: it looks for `vncviewer` on your `PATH`, in `/opt/homebrew/bin` and `/usr/local/bin`, then for a TigerVNC app in `/Applications` or `~/Applications`. If there's none, it says to run `brew install --cask tigervnc-viewer`. The viewer asks for the VNC password from setup step 7.

**`deploy`** and **`doctor`** are covered in [setup step 7](../setup/07-deploy.md). `doctor` checks what the first deploy needs and prints a fix for anything missing. **`update`** is covered in [updating her laptop](updates.md). Both `deploy` and `update` show her the updating notice while they run and "Done. Your computer is up to date." for 8 seconds when they succeed.

**`updating`** puts the same notice up by hand, for work that isn't a deploy, like running an `install.sh` step over `mom ssh`. `mom updating on` shows it for 15 minutes (`--minutes N`, up to 20; run it again for longer), `mom updating done` says "Done" for 8 seconds, and `mom updating off` takes it down. [contracts.md](../contracts.md#the-updating-notice) has the details.

**`help-requests`** and **`jobs`** read Convex with the dispatcher token, so they need `convexUrl` in `mom.json` and the token file. They list what's open and recent.

**`devices create`** is covered in [setup step 7](../setup/07-deploy.md#create-the-device). It uses the Convex deployment in `packages/backend/.env.local`. Add `--prod` to create the device in the project's production deployment instead.

## What `mom` doesn't do

`mom` doesn't edit settings, reminders or screensaver photos. Those live in Convex, and the admin app edits them.
