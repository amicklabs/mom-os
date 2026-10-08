# `momctl` reference

`momctl` is the command-line tool on the laptop. It's everything an agent, or you, can do to her session. Every command prints one line of JSON and exits 0 on success:

```json
{"ok":true,"data":{...}}
{"ok":false,"error":"..."}
```

It runs as her, in her session. From your machine, `mom <command>` runs it for you over SSH with the right environment, so you rarely call it directly. `mom press-help` is `momctl help`, renamed so `mom help` can print usage.

## Help output

This is `momctl --help`, word for word, taken from the `usage` field of its JSON:

```
momctl 0.1.0: control MomOS on this laptop. Every command prints JSON.

  status                          state.json, open windows and momd health
  open <tileId>                   launch or focus a tile's app
  reload <tileId>                 reload a web app or Browser tile's page: bring it
                                  forward and press F5, or open it if it isn't open.
                                  The screen says so briefly (through momd)
  home                            go to the home screen
  lock | unlock                   lock or unlock the screen
  lock-state locked|unlocked      tell momd the shell locked or unlocked (the shell calls this)
  screensaver on|off              start or stop the shell's screensaver
  screen on|off                   screen power; "on" does nothing while the lid is closed
  volume up|down|mute
  screenshot [--out FILE]         turn the screen on if it's off, then take one; prints
                                  the path. Nothing shows on the screen
  apps                            open app windows
  say "<text>" [--seconds N]      show a banner (needs momd)
  help [--text T] [--screenshot] [--call-me] [--voice] [--voice-file F]
                                  send a help request like the Help pop-up (needs momd):
                                  written words, a picture of the screen, a request to call,
                                  the voice note just recorded, or an Ogg Opus file
  voice start|stop|cancel         record a voice note for help --voice (needs momd)
  reminder-ok <key>               answer a reminder on screen (needs momd)
  click <x> <y> [right]           click at screen pixels, left unless "right" (ydotool)
  type "<text>"                   type text (ydotool)
  key <combo>                     press keys, e.g. enter, ctrl+l (ydotool)
  wifi                            network status
  wifi scan [--fresh]             nearby networks, known ones first
  wifi connect <name> [--password-stdin] [--hidden] [--save-only]
                                  join a network, or only save it; the password comes on stdin
  wifi forget <name> [--force]    delete a saved network (--force if it's in use)
  wifi portal [open]              check for a sign-in page, or open it in the browser
  speaker                         Bluetooth, saved speakers and where the sound goes
  speaker scan [--seconds N]      look for speakers nearby (10 s), saved ones first
  speaker connect <address>       pair if needed, connect, and play the sound on it
  speaker output computer|<address>  play the sound there; nothing disconnects
  speaker disconnect <address>    disconnect it; the sound goes back to the laptop
  speaker forget <address>        unpair it
  speaker reconnect               connect a saved speaker once, if none is connected
  logs [--unit momd|shell|wayvnc] [--lines N]
  restart shell|momd|wayvnc
  power off|restart               turn the computer off or restart it
  health                          battery, disk, drivers, versions
```

## Which commands need momd

Most commands work with momd down, which is the point: if momd crashes, you can still open tiles, go home, lock and unlock, take screenshots and read logs. These need momd running:

- `say`, which shows a banner;
- `help`, which sends a help request;
- `reminder-ok`, which answers a reminder;
- `lock-state`, which the shell calls to tell momd it locked or unlocked.

When momd is down, they fail with `"momd": false` in the JSON.

`screenshot` doesn't need momd.

`status` works either way and reports whether momd answered.

## Details

- `open <tileId>` launches the tile's app, or focuses it if it's already running, on the tile's own workspace. It refuses `page` tiles, which the shell handles. A second `open` of a tile whose app is still starting doesn't start it again: it waits for the first window and says `"action": "waited"`. If no window shows up in 20 seconds, it goes back to `home`.
- `reload <tileId>` works on web app tiles and the Browser. It asks momd, which refuses while the screen is locked and shows "Sam refreshed <tile>." for 6 seconds unless another banner is up. momctl then opens the tile the way `open` does. An open window gets F5 through ydotool once Hyprland says it has focus, and answers `"action": "reloaded"`. A closed one is launched instead and answers `"action": "opened"`. With momd down it does the same by itself, without the lock check or the note. [contracts.md](../contracts.md#reload) has the details.
- `home` switches to the empty `home` workspace, so the home screen shows. Apps keep running.
- `lock` and `unlock` call the shell over Quickshell IPC: `qs -c momos ipc call shell lock`.
- `screen on` does nothing while momd says the lid is closed.
- `screenshot` takes the picture with `grim` straight away. Nothing shows on her screen. Screenshots are silent. If the screen is off it turns it on first and says `"screenWoken": true`; the idle timer turns it off again later. With the lid closed it refuses. The `recent-screens` action still shows its own banner.
- `click <x> <y>` takes an optional third word, `right`, for a right click.
- `wifi` on its own prints NetworkManager's connectivity, the Wi-Fi network in use and the devices, as it always has. `wifi scan`, `connect`, `forget` and `portal` are what her Internet connection page runs. `connect` reads the password from stdin with `--password-stdin` and never takes it as an argument. It does nothing for the network she's already on, and `forget` refuses that one without `--force`, since either would drop the connection you reach her over. A failed `connect` or `forget` adds a `reason` to the JSON: `password`, `short`, `not-found`, `unsupported`, `in-use`, `unknown-network`, `no-wifi`, `not-allowed`, `timeout` or `failed`. [contracts.md](../contracts.md#wi-fi) has the details.
- `speaker ...` is what her Speaker page runs, through BlueZ and PipeWire. `connect` pairs a new speaker, trusts it, connects it and makes it the sound output; `disconnect` untrusts it so it doesn't come back by itself. A failure adds a `reason`: `no-bluetooth`, `off`, `not-found`, `pair`, `connect`, `unknown-speaker`, `timeout` or `failed`. [contracts.md](../contracts.md#speaker) has the details, and [speaker.md](speaker.md) the how-to.
- `logs` reads `journalctl --user` for `momd.service`, `momos-shell.service` or `momos-wayvnc.service`. Default 100 lines of momd.
- `restart` runs `systemctl --user restart` on one of those three units.
- `power off` and `power restart` run `systemctl poweroff` and `systemctl reboot`, as her. Her Turn off and Restart pages under More use them. `mom` doesn't pass them through, so to restart her laptop remotely use the Restart action in the admin app or Telegram, or `mom ssh sudo systemctl reboot`.
- `health` reports battery health, disk space, whether the DKMS modules in the config's `local.hardware.dkmsModules` are built for the running kernel (an empty list when there are none), and versions. momd also records it once a day as a `health` event.

[contracts.md](../contracts.md#momctl-commands) is the reference that the code follows.
