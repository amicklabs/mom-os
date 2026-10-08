# dev/

`session.sh` runs the person's whole session in a window on a Hyprland desktop, so
you can work on it without the laptop. It starts a nested Hyprland with her
config from `system/files/hypr/hyprland.lua` and runs the repo's `shell/` in
it. The host Hyprland floats the window at 1366x768, the laptop's screen size.

    dev/session.sh              # start; stays in the foreground, Ctrl+C stops it
    dev/session.sh stop         # from another terminal
    dev/session.sh screenshot [FILE]
    eval "$(dev/session.sh env)"
    dev/session.sh shell        # internal: the nested Hyprland runs this

After the `eval`, `hyprctl`, `grim` and `qs -p shell ipc call shell ...` talk
to the nested session instead of yours.

## What differs from the laptop

- Her config is rendered the way `system/install.sh` does it, with three
  changes. The output is 1366x768, the power-button binding is gone so a stray
  key can't suspend your machine, and the session runs `dev/session.sh shell`
  instead of the systemd units. That starts `qs -p shell/` directly and
  restarts it when it exits, giving up after 5 exits in 2 minutes. Its output
  goes to `shell.log`. You don't run it yourself.
- momd doesn't run. `session.sh` copies `fixtures/state.json` and bumps its
  `updatedAt` every 10 seconds. To try a scenario, run
  `MOMOS_DEV_DIR=$XDG_RUNTIME_DIR/momos-session shell/dev/state.sh viewer`
  (or `offline`, `low`, `trouble`, `message`, `stale`, and the others listed there).
- momctl is `apps/momctl/dist/momctl` if it's built. Otherwise it's
  `momctl-stub`, which logs each call to `momctl.log` and does nothing,
  except `momctl wifi ...` and `momctl speaker ...`, which answer with made-up
  networks and speakers (below),
  and `momctl help` and `momctl voice start`, which answer like momd (below).
- The shell doesn't take over notifications, so your own notification daemon
  keeps working. Set `MOMOS_NOTIFICATIONS=1` to test them, or use
  `qs -p shell ipc call momos-dev message "Grace" "Hello"` (a message card),
  `notify` (a card that closes by itself) and `close` (press Close).
  `shell/dev/state.sh unread` puts 3 on the Telegram tile's badge.
- The stub's `momctl screen on|off` turns the nested session's screen on or
  off, so a message waking a dark screen can be tried. grim can't take a
  picture while it's off.
- Telegram, wayvnc and ydotoold don't run.

## Files

Everything lives in `$MOMOS_DEV_DIR`, `$XDG_RUNTIME_DIR/momos-session` by
default: `config.json` (copied from `fixtures/` on first start, then yours to
edit; the shell reloads it on change), `state.json`, placeholder `photos/`,
the rendered `hyprland.lua`, and the logs `hyprland.log`, `shell.log` and
`momctl.log`. Delete the folder to start fresh.

## Screenshots

The nested Hyprland draws only when your Hyprland asks it for a frame. If your
screen is asleep or the window sits on a hidden workspace, `screenshot` times
out after 10 seconds and says so.

When your monitor is asleep, give the session a screen of its own. Make a
virtual output, then move the session's window to that output's workspace
(`hyprctl monitors all` shows which one):

    hyprctl output create headless MOMOS-VIRT
    hyprctl dispatch 'hl.dsp.window.move({ workspace = "4", follow = false, window = "address:0x..." })'

The headless output always draws, so `screenshot` works. Remove it afterwards
with `hyprctl output remove MOMOS-VIRT`.

To keep the window off your screen from the start, launch the session with a
silent workspace rule for a workspace on that output (3 here), instead of
moving it afterwards:

    hyprctl dispatch 'hl.dsp.exec_cmd("dev/session.sh start", { workspace = "3 silent" })'


## Screensaver and reminders

The screensaver reads `.jpg` files from `$MOMOS_DEV_DIR/slideshow/`; with none
it shows the clock alone. Turn it on with
`qs -p shell ipc call shell screensaver on` after the `eval` above. A key
press or click ends it. `shell/dev/state.sh today` puts two reminders on the
home screen card, and `reminder` adds one that's due now.

## Updating notice

`MOMOS_DEV_DIR=$XDG_RUNTIME_DIR/momos-session shell/dev/updating.sh on` puts
up "Sam is updating your computer", `done` switches it to "Done. Your
computer is up to date." for 8 seconds, and `off` takes it down. `on 5`
makes it expire after 5 seconds. It writes `$MOMOS_DEV_DIR/updating.json` the
way `mom` writes the real one.

## Internet connection page

With the stub, the page shows made-up networks from `shell/dev/wifi-fake.sh`,
so nothing touches your own Wi-Fi. Write `home` (the default), `away` or
`portal` to `$MOMOS_DEV_DIR/wifi-scenario` to switch; pair `away` and
`portal` with `state.sh offline` for the banner. A password with "wrong"
in it fails like a wrong password. `qs -p shell ipc call shell page wifi`
opens the page, and `qs -p shell ipc call momos-dev-ui wifiPick "<name>"`
presses a network's row (`""` for "My network isn't listed",
`"forget:<name>"` for its Forget button). `wtype` types into the password
field.

## Speaker page

With the stub, the page shows made-up speakers from
`shell/dev/speaker-fake.sh`, so nothing touches your own Bluetooth. Write
`none` (the default: nothing saved, three nearby), `saved`, `playing`,
`computer` (Kitchen Speaker connected, sound on the computer), `silent` or
`off` to `$MOMOS_DEV_DIR/speaker-scenario` to switch. Connecting takes two
seconds and moves to `playing`. Porch Speaker never answers, and Carol's
Soundbar connects without sound. `qs -p shell ipc call shell page speaker`
opens the page, and `qs -p shell ipc call momos-dev-ui speakerPick "<name>"`
presses a speaker's row. `"forget:<name>"` and `"disconnect:<name>"` press its
small buttons, and `"output:computer"` or `"output:<name>"` press a choice
under "Where does the sound come out?". More's Speaker item reads your own
desktop's PipeWire, so it says "Playing on ..." only if your sound is on a
Bluetooth speaker.

## Help pop-up

`qs -p shell ipc call momos-dev-ui helpCard` opens it. `helpShow <stage>
"<words>" <kinds>` shows a stage (`compose`, `recording`, `sending`, `sent`,
`offline`, `failed`, `unreachable`) with her words and kinds like
`message,call-me`, for screenshots. `helpPress send|screen|call|voice|stop|cancel|close`
presses a button. With the stub, `momctl help` answers after a second with the
status in `$MOMOS_DEV_DIR/help-status` (`sent`, `offline` or `failed`; `sent`
when the file is missing), and `momctl voice start` says it's recording. `wtype`
types into the box, and `wtype -k Escape` closes the card.

## The bar

The bar names the app in front from the nested Hyprland's focused window, so
any window with the right class shows it: `chromium --user-data-dir=/tmp/x
--app=https://www.youtube.com` for a web app tile, plain `chromium` for the
Browser tile. An empty `tile-<id>` workspace shows that tile's name too,
since momd isn't there to send you home. `qs -p shell ipc call momos-dev-ui
status` opens the status card, and `shell/dev/state.sh low`, `offline` or
`trouble` (both) put the warnings on the bar. `state.sh viewer` starts a
viewing session (banner, then the eye), and `control` after it turns control
on. `qs -p shell ipc call momos-dev-ui eye` taps the eye. Run `state.sh normal`
and wait 15 seconds to end the session.
