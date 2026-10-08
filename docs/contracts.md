# Contracts between MomOS parts

Each part of MomOS is built separately. This file pins down how the parts talk, so they fit when they meet. Types live in `packages/shared` (`@momos/shared`). When code and this file disagree, fix one of them in the same change.

## Rule one: every part degrades on its own

She must be able to use the laptop when any part is missing.

| If this is down | What still works |
|---|---|
| wayvnc | Everything. The helper falls back to screenshots over SSH. |
| Tailscale Serve, or Tailscale on the helper's phone | Everything. The admin app's Screen page can't connect and says why; `mom vnc` still works from a computer. |
| Convex or the internet | Tiles, Home, Lock, sound, banners from momd. Help keeps her request in momd's outbox, sends it when the internet is back, and shows the helper's phone number. momd queues events. |
| momd | Tiles, Home, Lock, sound. The shell reads `config.json` directly. The Help pop-up shows the phone number. |
| the MomOS shell | Hyprland restarts it. If it keeps crashing, Hyprland starts Chromium full screen as a last resort. |
| Tailscale | She notices nothing. The helper can't reach the laptop until it's back. |

## Files on her laptop

| Path | Owner | Read by |
|---|---|---|
| `~/.config/momos/config.json` | install script, then momd when Convex settings change. `local.hardware` stays the install script's. | shell, momctl, momd |
| `~/.config/momos/photos/` | momd (downloads from Convex) or install | shell |
| `~/.config/momos/icons/<name>.svg` | the helper, by hand; nothing installs or syncs it | shell |
| `~/.config/momos/appearance.json` | the shell, when she picks colors, icons or text size under More | shell |
| `~/.config/momos/device-token` | install, mode 0600 | momd only |
| `$XDG_RUNTIME_DIR/momos/state.json` | momd | shell, momctl |
| `$XDG_RUNTIME_DIR/momos/momd.sock` | momd | momctl |
| `~/.local/share/momos/momd.sqlite` | momd: the event queue and the help outbox | momd |
| `~/.local/share/momos/help-outbox/` | momd: screenshots and voice notes of help requests waiting to go | momd |
| `~/.local/share/momos/screenshots/` | momd, last 10 only; leave the laptop only through the `recent-screens` action | momd |
| `~/.config/momos/reminders.json` | momd, from `device.content` (a `Reminder[]`) | momd |
| `~/.local/share/momos/slideshow/*.jpg` | momd, kept matching `device.content` | shell (screensaver) |
| `$XDG_RUNTIME_DIR/momos/screen/` | momd, only while a browser screen-sharing session runs: wayvnc's empty config, its socket and control socket | momd, wayvnc |
| `~/.local/state/momos/updating.json` | `mom deploy`, `mom update`, `mom restart shell` and `mom updating`, over SSH as her | shell, `momos-idle` |

momd schedules reminders from `reminders.json` in the laptop's time zone, so they work offline. The shell gets them through `state.json` only.

All writes to `config.json` and `state.json` are atomic: write `*.tmp`, then rename.

### Appearance

`appearance.json` holds her look, apart from `config.json` so momd's rewrites from Convex never touch it:

```
{ "version": 2, "theme": "morning", "textSize": "large", "icons": "simple" }
```

- `version`: `2`. Write it; without it the file is read as version 1 (below).
- `theme`: `morning`, `linen`, `rose`, `evening`, `garden` or `slate`, the ids in `shell/Common/themes.js`. Missing or unknown means `morning`.
- `textSize`: `regular`, `large` or `xlarge` (Regular, Large and X-Large on screen). Anything else means `large`. Large is the base size; Regular scales text by 0.8 and X-Large by 1.25, and no text goes below 20 px. In the bar only the date, the name of what she's on and the warnings scale, up to 30 px for the date and warnings and 34 px for the name.
- `icons`: `simple` or `colorful`. Missing or anything else means `simple`. Simple draws tile icons as line icons in the theme's color. Colorful draws the apps' own marks (the red YouTube play button, the Gmail M) from `shell/icons/`, on a neutral well.

A tile's `icon` names one of the shell's built-in icons, the `tileNames` in `shell/Ui/icons.js`. Any other name that fits the tile id pattern is looked up as `icons/<name>.svg` in the folder that holds `config.json` (so it follows `MOMOS_CONFIG`). The shell draws that SVG as it is in both styles. A built-in name always wins, and a missing or unreadable file draws as `app`. Every tile icon goes through `shell/Ui/TileIcon.qml`: tiles, the bar, the Icons page and the Colors previews.

Version 1 files have no `version` and two sizes, `regular` and `larger`, which are today's `large` and `xlarge`. The shell reads them that way (anything else means `large`) and rewrites the file as version 2 straight away, so her text doesn't change size.

The shell writes it atomically when she taps a choice on the Colors, Text size or Icons page under More, and watches it, so a change from anywhere shows within a second with a half-second fade. The file doesn't exist until she first picks something. It sits next to `config.json`, or at `MOMOS_APPEARANCE`. To set her look remotely later, momd can write the same file the same way (temp file, then rename); nothing in Convex does that yet.

### Hardware

`local.hardware` in `config.json` describes the laptop. It never comes from Convex, and momd keeps the whole `local` block when it rewrites the file. The `session` install step copies it from the deploy config on every deploy.

```
"hardware": { "dkmsModules": ["wl", "facetimehd"], "lid": "flaky-macbook" }
```

- `dkmsModules`: kernel modules built by DKMS. `mom update` won't reboot unless they exist for the next kernel, `momctl health` reports them, and `facetimehd` makes the `packages` step build the facetimehd AUR packages. Default: none.
- `lid`: `normal` (default) leaves the lid to logind and momd does nothing. `flaky-macbook` runs momd's averaging lid detector and makes `install.sh check` look for the MACHINE-NOTES lid workarounds. `ignore` means nothing in MomOS handles the lid. momd's lid task notices a change within 30 s and starts over.

Installed layout: binaries in `/usr/local/bin/` (`momd`, `momctl`; `mom deploy` builds them into `/usr/local/src/momos/bin/` and `install.sh binaries` copies them), the shell in `/usr/local/share/momos/shell/`, units and the Hyprland config under `system/` copied into place by `system/install.sh`.

## momctl commands

JSON on stdout for every command, exit code 0 on success. Commands marked **standalone** work without momd.

```
momctl status                     full state: state.json + hyprland clients + momd health
momctl open <tileId>              launch or focus a tile's app            standalone
momctl reload <tileId>            F5 on a web page tile, or open it      through momd, standalone without it
momctl home                       go to the home workspace                standalone
momctl lock | unlock              lock screen through the shell's IPC     standalone
momctl lock-state locked|unlocked tell momd the shell locked or unlocked  needs momd
momctl screensaver on|off         the shell's screensaver through IPC     standalone
momctl screen on|off              dpms; "on" is a no-op while the lid is closed  standalone
momctl volume up|down|mute        wpctl                                   standalone
momctl screenshot [--out FILE]    banner through momd, then grim; prints path  standalone
momctl apps                       open app windows                        standalone
momctl say "<text>" [--seconds N] show a banner                            needs momd
momctl help [--text T] [--screenshot] [--call-me] [--voice] [--voice-file F]
                                  send a help request, as the Help pop-up does  needs momd
momctl voice start|stop|cancel    record a voice note for help --voice    needs momd
momctl reminder-ok <key>          she pressed OK on a due reminder        needs momd
momctl click <x> <y> [right]      ydotool; left click unless "right"      standalone
momctl type "<text>"              ydotool                                 standalone
momctl key <combo>                ydotool                                 standalone
momctl wifi                       nmcli status                            standalone
momctl wifi scan [--fresh]        nearby networks, known ones first       standalone
momctl wifi connect <name> [--password-stdin] [--hidden] [--save-only]
                                  join a network and save it              standalone
momctl wifi forget <name> [--force]  delete a saved network               standalone
momctl wifi portal [open]         sign-in page check, or open it          standalone
momctl speaker                    Bluetooth, saved speakers, sound output standalone
momctl speaker scan [--seconds N] speakers nearby, saved ones first       standalone
momctl speaker connect <address>  pair, trust, connect, play sound on it  standalone
momctl speaker output computer|<address>  where the sound comes out     standalone
momctl speaker disconnect <address>  disconnect; sound back on the laptop standalone
momctl speaker forget <address>   unpair                                  standalone
momctl speaker reconnect          connect a saved speaker once            standalone
momctl logs [--unit momd|shell|wayvnc] [--lines N]  journalctl --user     standalone
momctl restart shell|momd|wayvnc  systemctl --user restart                standalone
momctl power off|restart          systemctl poweroff|reboot               standalone
momctl health                     battery, disk, dkms, versions           standalone
```

Screenshots are silent. `momctl screenshot` and the `screenshot` action show nothing on her screen and call grim straight away, unless the screen is dark (below); she asked for that on September 28, 2026. momctl doesn't need momd for it. Screen sharing still always tells her ([below](#screen-sharing-in-a-browser)), and so does the `recent-screens` action.

grim hangs until its 15 s timeout while every monitor is off (`dpmsStatus` false in `hyprctl -j monitors`), so nothing takes a picture of a dark screen:

- `momctl screenshot` and the `screenshot` action turn a dark screen on, wait 1.5 s, then take the picture. They leave it on for the idle timer to turn off. momctl's JSON adds `screenWoken: true|false`, and the action's result says so. With the lid closed they refuse instead.
- The ring buffer skips, without logging, while every monitor is off.
- A help request with `--screenshot` always goes out. With the screen off or the lid closed, or if grim fails, it goes without a picture and with a `note` saying why, such as `"screen was off"`. If the screen came on in the last 10 s (momd checks every 5 s), it waits 1.5 s before the picture. momd sends the note as `device.createHelpRequest`'s optional `note`, cut to 200 characters (`HELP_NOTE_MAX` in `@momos/shared`). The server stores it on the help request and adds a line to the Telegram message, "Note: the screen was off, so there's no fresh picture." for `"screen was off"`, and the admin app's help inbox shows it.

### Reload

`momctl reload <tileId>` and the `reload` action reload one of her pages (`apps/momctl/src/lib/reload.ts`):

- Only a tile in her config that is a web page: a `webapp` tile or the `app` tile for `chromium` (`isReloadable` in `@momos/shared`). Anything else is an error.
- It refuses while the screen is locked, since the key would go to the lock screen, and when ydotool can't send keys, before anything moves.
- It runs `momctl open`'s code. If the tile's window was open, it's now in front: momctl ends the screensaver, which would swallow the key, waits until Hyprland's active window is that window (refocusing up to four times, 150 ms apart), then presses F5 with ydotool. If focus never comes, no key is sent and it fails. If the tile wasn't open, the launch loads the page fresh and no key is sent.
- It answers `{ tileId, label, workspace, action, window }`, with `action` `reloaded` or `opened`. The action's result is `reloaded <label>` or `<label> wasn't open, so it was opened`.
- momd shows "<helper> refreshed <label>." as an `info` banner for 6 seconds (`RELOAD_NOTICE_SECONDS`), unless another banner is up, such as a message from the helper; then it shows nothing. The page blinks and she may be taken to it, so a short note keeps that from looking like a fault. Screenshots stay silent because nothing on her screen changes.
- `momctl reload` goes through momd's `reload` socket command, which knows the lock state and shows the note. With no momd socket, or a momd that doesn't know `reload`, momctl reloads by itself, without the lock check or the note.
- momd refuses a `reload` action that waited more than 10 minutes in Convex (`RELOAD_MAX_AGE_MS`), so a laptop that was offline doesn't take her to a page long after the helper asked.

All of her Chromium windows, web app tiles and the Browser alike, run in one Chromium profile: the default user data directory `~/.config/chromium`, profile `Default` (the `-Default` at the end of web app window classes). A sign-in in one window sets cookies for all of them. A page that was already open still shows what it loaded before, such as a sign-in form, until it reloads.

### Help

The bar's Help button opens the Help pop-up (`shell/Windows/HelpCard.qml`), a card over whatever she's doing. Each way of asking runs `momctl help`:

| Button | momctl |
|---|---|
| Send to <helper> (needs text) | `help --text T` |
| Show <helper> my screen | `help [--text T] --screenshot` |
| Ask <helper> to call me | `help [--text T] --call-me` |
| Say it out loud, then Stop and send | `voice start`, then `help [--text T] --voice` |

- `--text` is her words, trimmed and cut to 1000 characters (`HELP_TEXT_MAX`). The kinds a request carries (`HelpKind` in `@momos/shared`) follow from the flags: `message` when there's text, `screenshot`, `call-me`, `voice`. A bare `momctl help` is a plain press with no kinds.
- For `--screenshot` the shell hides the pop-up, shade included, waits 400 ms, then runs momctl. momd takes the picture before anything else and only then sets `state.help.status` to `sending`, which is when the shell shows the card again. If nothing comes in 15 s the card comes back anyway.
- `momctl voice start` starts `pw-record --rate 48000 --channels 1 --format s16` into `$XDG_RUNTIME_DIR/momos/help/voice-<ms>.wav`. `stop` stops it with SIGINT and encodes it with `ffmpeg -c:a libopus -b:a 32k -application voip` to Ogg Opus next to it, deleting the WAV. It stops by itself after 60 s (`VOICE_MAX_SECONDS`), keeping the note for `help --voice`. `help --voice` stops a running recording first and sends the note; with nothing recorded the request goes without it and with a note saying so. `cancel` throws it away. A recording under a second, or an Ogg over 2 MB (`VOICE_MAX_BYTES`), isn't a voice note. The shell sends by itself at 60 s.
- `--voice-file F` sends an existing Ogg Opus file instead, for testing. momd copies it; F stays.
- Every request goes into momd's outbox first: a `help_outbox` table in `momd.sqlite`, with its files in `~/.local/share/momos/help-outbox/`. It's sent straight away when Convex is connected and the internet works. Otherwise it waits, and momd tries again every 5 s while anything waits, at once when the internet comes back, with a backoff from 15 s to 10 min after a failure. A request that went late shows her "<helper> has your message now." for two minutes and sends `askedAt`, the time she pressed. Requests older than 3 days, or beyond 20 waiting, are dropped with their files.
- The `help` socket command answers `{ status, kinds, freshScreenshot, voiceSeconds, note, queued }`. `status` is `sent`, `offline` (waiting for the internet) or `failed` (waiting; Convex refused or timed out). `queued` counts requests in the outbox. The pop-up words its answer from `status`: "<helper> has your message." for `sent`, then "<helper> will call you soon." after call-me, "<helper> can see what was on your screen." after a screenshot, else "<helper> will get back to you soon.", never anything about agents; "The internet isn't working, so this can't reach <helper> right now. It will send by itself when the internet is back." and the phone number for `offline`; the phone number for `failed` and when momctl fails (momd down).
- `state.help` is `{ status, at, queued }`. `queued` is optional in the schema, so older files parse.
- `helper.telegram` in the settings (optional, a Telegram username) adds "Message <helper> on Telegram" to the pop-up, which opens `tg://resolve?domain=<username>` like a family face.
- `person.phone`, `person.telegram` and `helper.autoInvestigate` (all optional) are for the helper's side: Call <person> under a help request on Telegram, and whether an agent starts on its own. The shell and momd ignore them.

`momctl health` checks the DKMS modules listed in `local.hardware.dkmsModules`, and none when the list is missing.

`momctl power off|restart` is for her Restart and Turn off pages under More. The shell runs it after she confirms, once "Turning off…" or "Restarting…" has been on screen for 1.5 s. `system/files/polkit/50-momos-reboot.rules` lets her user, and no other, run logind's `reboot*` and `power-off*` actions without a password, even while the admin is logged in over SSH. `mom` has no command for it, so neither the helper's tools nor the dispatcher's agents can turn the laptop off; the helper's Restart action is momd's `restart`.

### Wi-Fi

The shell's Internet connection page and `mom wifi ...` use these. All of them wrap `nmcli` (`apps/momctl/src/lib/wifi.ts`) and run as her.

- `momctl wifi` prints `{ connectivity, wifi: { ssid, signal, device } | null, devices }`, as it always has. momd reads the same data. `connectivity` is NetworkManager's: `full`, `limited`, `portal`, `none` or `unknown`.
- `momctl wifi scan [--fresh]` prints `{ connectivity, portal, radio, device, current: { name, signal, strength } | null, networks }`. Each network is `{ name, signal, strength, kind, secure, known, inUse }`, one per name, with the strongest access point's signal. `strength` is `strong` (70 and up), `good` (40 to 69) or `weak`. `kind` is `open`, `password`, `enterprise` (needs a username) or `old` (WEP). The last two can't be joined from the page. Hidden networks and printers' `DIRECT-` networks are left out. Order: the one in use, then known ones, then by signal. It turns the Wi-Fi radio on if it's off. `--fresh` waits for a new scan; without it NetworkManager rescans only if its last scan is old.
- `momctl wifi connect <name>` joins a network. For the network already in use it does nothing and answers `already: true`, since rejoining would drop the connection for a few seconds. A known network without a password is brought up from its saved profile. Otherwise it makes a new system-wide profile with the password, joins it, and on success deletes older profiles for the same name and turns on autoconnect. On failure it deletes the new profile, so a mistyped password is never kept. `--password-stdin` reads the password from stdin; it's never an argument, and it reaches NetworkManager as commands on `nmcli connection edit`'s stdin, or through `passwd-file /dev/stdin` for a password with spaces at either end. `--hidden` is for a network that doesn't announce its name. `--save-only` saves the profile with autoconnect on and doesn't join, for a network that isn't in range. It answers `{ connected, name, saved, connectivity, portal }`, and `already` when it did nothing.
- `momctl wifi forget <name> [--force]` deletes every profile for that name. It refuses the network in use unless `--force`.
- `momctl wifi portal` asks NetworkManager to check connectivity again and answers `{ connectivity, portal }`. `momctl wifi portal open` opens `http://neverssl.com/` in the Browser tile's Chromium window (the `app` tile for `chromium`), which a hotel or cafe's sign-in page takes over, and answers `{ url, workspace }`.

A failed `connect` or `forget` adds `reason` to the error JSON: `password`, `short` (not 8 to 63 characters), `not-found`, `unsupported`, `in-use`, `unknown-network`, `no-wifi`, `not-allowed`, `timeout` or `failed`. The shell words its message from `reason`, never from `error`.

Her account has no sudo, so `system/files/polkit/50-momos-wifi.rules` lets her user, and no other, run NetworkManager's `network-control`, `settings.modify.own`, `settings.modify.system`, `wifi.scan` and `enable-disable-wifi` actions without a password. It isn't limited to her local session, so the same commands work over SSH through `mom`. The dispatcher's agents may run `mom wifi` and `mom wifi scan` but never `connect`, `forget` or `portal open`.

### Speaker

The shell's Speaker page and `mom speaker ...` use these (`apps/momctl/src/lib/speaker.ts`). They run as her. BlueZ's D-Bus policy lets any local user call it, so no polkit rule is needed. They read BlueZ with `busctl --json=short call org.bluez / org.freedesktop.DBus.ObjectManager GetManagedObjects`, use `bluetoothctl` where BlueZ needs a client that stays connected (discovery and pairing), and read and set the sound output with `pw-dump` and `wpctl`.

- A speaker is `{ address, name, kind, saved, paired, connected, output, nearby, signal }`. `paired` means BlueZ's `Bonded`: paired with a stored key. A pairing without a key (BlueZ's `Paired` true, `Bonded` false) ends when the link drops, so it counts as not paired. Only devices that announce a name and play sound are listed: BlueZ's `audio-*` icon, the Audio/Video device class (not microphones or video gear), or the A2DP sink profile. `kind` is `headphones` for headsets and headphones, else `speaker`. `saved` is bonded and trusted. `output` means PipeWire's default sink is this speaker's. `nearby` and `signal` (RSSI) come from the last scan; saved speakers usually aren't nearby, since a speaker answers scans only in pairing mode. Order: connected, saved, paired, then nearby by signal.
- `momctl speaker` prints `{ adapter, output, speakers }` with paired speakers only, without scanning. `adapter` is `on`, `off`, `blocked` (rfkill) or `none`. `output` is `{ name, bluetooth, address } | null`, PipeWire's default sink.
- `momctl speaker scan [--seconds N]` turns the adapter on if it's off, runs `bluetoothctl --timeout N scan on` (10 s by default, 3 to 30), reads the objects a second before it ends while RSSI is still there, and prints the same shape with nearby speakers too.
- `momctl speaker connect <address>` takes an address like `11:22:33:44:55:66` (dashes work too). If BlueZ doesn't know it, it scans once more. A speaker without a stored key is paired with `bluetoothctl --agent NoInputNoOutput pair <address>`, so nothing asks her for a code. BlueZ leaves the adapter non-bondable unless `Pairable` is set, and a pairing then stores no key, so `connect` sets `Adapter1.Pairable` true for the pairing and back to false after it. Then it sets `Trusted` and always calls `Device1.Connect`, even when BlueZ already says Connected, since after pairing that's only the pairing's own link. `AlreadyConnected` counts as success. It waits up to 20 s for the speaker's PipeWire sink. If PipeWire made the card but left its profile off or hands-free, it switches it to `a2dp-sink` with `wpctl set-profile`. Then it makes the sink the default with `wpctl set-default`. WirePlumber keeps that choice by node name, so the sound goes back to the speaker whenever it reconnects and to the laptop while it's away. It answers `{ address, name, connected, paired, output }`, with `paired` true when it paired just now and `output` false if no sink appeared. With `output` false it adds `detail`, a line naming the speaker's PipeWire card, its profile and profiles, and the sinks there were, which the shell logs.
- `momctl speaker output computer|<address>` sets where the sound comes out and prints the same shape as `momctl speaker`. `computer` makes the first sink that isn't Bluetooth the default. Nothing disconnects, so the speaker stays connected and switching back is instant. An address makes that speaker's sink the default, connecting it first (as `connect`) if it isn't connected, and fails with `no-sound` if no sink appears.
- `momctl speaker disconnect <address>` clears `Trusted` and disconnects. The pairing stays. With trusted off the speaker can't connect by itself and momd doesn't try, until she picks it again.
- `momctl speaker forget <address>` removes the device from BlueZ, which unpairs it.
- `momctl speaker reconnect` does nothing if the adapter is off, no speaker is saved, or one is connected. It also does nothing when she chose the computer: WirePlumber's `default.configured.audio.sink` names a sink that isn't `bluez_output.*`. Then it answers `skipped: "computer"`. Otherwise it calls `Connect` on each saved speaker in turn and stops at the first that answers, making it the output. It answers `{ tried, connected }`. momd runs it (the `speaker` task, `apps/momd/src/speaker.ts`) 20 s after it starts and 20 s after each wake from sleep, which it notices as a gap of over a minute between its 15-second checks. Never on a timer, so the laptop doesn't keep pulling a shared speaker away from a phone.

A failed command adds `reason` to the error JSON: `no-bluetooth`, `off`, `not-found` (not in range, or not in pairing mode), `pair` (refused), `connect` (paired but didn't answer: off, or busy with a phone), `no-sound` (connected, but PipeWire has no sink for it), `unknown-speaker`, `timeout` or `failed`. The shell words its message from `reason`.

`install.sh packages` installs `bluez`, `bluez-utils` and `pipewire-audio` (PipeWire's BlueZ plugin) and enables `bluetooth.service`; `install.sh check` checks the service. There's no Convex action for speakers. The helper pairs one remotely with `mom speaker` over SSH, and the dispatcher's agents can't run it.

`mom <cmd>` on the helper's machines runs `momctl <cmd>` over SSH as the person's user and passes JSON through.

## Tiles and windows

- Each tile gets its own Hyprland workspace named `tile-<id>`. Home is the workspace named `home`, which has no windows, so the shell's home screen shows.
- `webapp` tiles run `chromium --app=<url>`. Chromium sets the window class to `chrome-<host>__<path>-Default` form; momctl matches on the host.
- `app` tiles use `NATIVE_APPS` in `packages/shared/src/config.ts`.
- `telegram-chat` tiles open `tg://resolve?domain=<username>` with Telegram.
- `page` tiles are handled inside the shell. momctl rejects them.
- One thing on screen at a time. Her Hyprland config uses the `monocle` layout, so every tiled window fills the area under the bar and only the focused one shows, however many a workspace holds. Nothing is maximized or fullscreen, and apps' requests for either are ignored. Dialogs Hyprland floats itself are centered. Portal file pickers (`xdg-desktop-portal-gtk`) float centered at 85% by 75% of the screen.
- `momctl open` launches a tile's app at most once at a time. It takes a lock file, `$XDG_RUNTIME_DIR/momos/launch-<tileId>.json` (`{ tileId, workspace, pid, at }`), before it launches and removes it when the window shows up or after its 20 s wait. A second `open` of the same tile meanwhile doesn't launch; it waits for the first launch's window and reports `action: "waited"`. A lock older than 25 s is stale. Telegram chat tiles take no lock, since they hand Telegram a link each time. If no window appears, momctl leaves the empty workspace for `home`.
- New windows open on the workspace she's looking at, on top, except Telegram's, which the config sends to Telegram's tile workspace without switching. A plain browser window opened from a link covers what she was looking at; closing it brings that back. momd (`apps/momd/src/windows.ts`) then corrects three cases from Hyprland's events: a web app window that opens on a workspace other than its tile's moves there without taking her along; a second window of the same web app within 10 s of the first is a double launch, and momd closes it; a plain browser window that opens on `home` moves to the Browser tile's workspace, and she goes with it.
- When a window closes and the workspace she's on is left empty, momd switches to `home` within a quarter second. If windows remain there and none has focus, it focuses the one she used last on that workspace, never one on another workspace. After any switch to an empty workspace other than `home`, momd waits 1.5 s and sends her home, unless a launch lock names that workspace. It also checks every 10 s.
- Chromium never restores a previous session (`RestoreOnStartup: 5` in the policy, `--hide-crash-restore-bubble` in her flags). A restored session put old web app windows on whatever workspace was open.
- Hyprland 0.56 uses a Lua config. `hyprctl dispatch` takes Lua, not the old `exec foo` syntax. Read `/usr/share/omarchy/default/hypr/*.lua` on the laptop for working examples before writing dispatch calls.

## The bar

The bar names what she's on, next to the clock, with the app's own colored mark (from `shell/icons/`) whatever icon style her tiles use. The shell works it out itself from Hyprland (Quickshell's `Hyprland.focusedWorkspace` and `Hyprland.activeToplevel`), so it needs no field in `state.json` and works with momd down. `shell/Common/foreground.js` decides, in this order:

- A page the shell has open (Family, Internet connection, Speaker, Colors, Text size, Icons, Restart, Turn off) wins, with its line icon. The More panel and the Help pop-up sit over whatever she's on and change nothing.
- On the `home` workspace, nothing shows. A second "Home" next to the Home button would only be something else to press.
- The active window, if it's on the workspace she's looking at, matches a tile by class the way momctl does (web apps first, then native apps). It shows the tile's label and icon. Telegram windows, call windows included, are the Telegram tile, or "Telegram" without one. A `chromium` window is the Browser tile, or "Browser" without one, and always shows Chrome's mark (`chrome`), since that's the logo she knows.
- A window no tile claims, such as a file picker, or no window at all while an app starts, takes the tile of its `tile-<id>` workspace. On any other workspace nothing shows.

A long name wraps to two lines at a smaller size, down to 26 px, before it's cut short. It never breaks inside a word. When the bar is crowded (X-Large text, both warnings and the eye), a name that won't fit beside its icon shows without the icon, and a word that still won't fit gets smaller, down to 18 px.

On the right, a status button shows a Wi-Fi icon and a battery icon on a light pill. Tapping it opens a card under it with both in words: "The internet is working" and the network's name, or "The internet isn't working" with Connect to a network; "Battery: 64%" and whether it's charging. The card opens below any banner, closes on a tap outside, Close or after 30 s, and closes when a page, More, Help or the lock opens. Two problems stay on the bar in words without a tap, bold in the alert color left of the button: "No internet" when `online` is false, and "Battery low" under 20% and not charging. The icons turn the alert color too.

While someone is looking at her screen, an eye on a pill in the viewer color sits between the warnings and the status button, with a mouse pointer beside it while they can use her mouse. Tapping it shows the viewer banner again for 10 seconds. See [Screen sharing in a browser](#screen-sharing-in-a-browser), "Her banner".

## The updating notice

While the helper deploys or updates her laptop, her screen says "<helper> is updating your computer. It will be back in a minute.", so a blink or a restart doesn't surprise her. `mom` writes a marker file on the laptop over SSH, as her, and the shell shows the notice while the marker is fresh. Nothing goes through momd or Convex, so it works on a first deploy and while momd restarts.

```
~/.local/state/momos/updating.json
{ "version": 1, "state": "updating", "at": 1790000000000, "expiresAt": 1790000900000 }
```

- `state` is `updating` or `done`. `done` shows "Done. Your computer is up to date." `at` and `expiresAt` are milliseconds since the epoch, from the laptop's own clock (`date +%s%3N` in the script `mom` runs), so a helper machine with the wrong time can't skew them. The file is written as a temp file, then renamed.
- It lives under `~/.local/state`, not the runtime directory, so it outlives the reboot in `mom update`.
- **Who writes it.** `mom deploy` and `mom update` write `updating` for 15 minutes before they start (`NOTICE_MINUTES` in `apps/mom/src/notice.ts`) and rewrite it every 4 minutes while they run. On success they write `done` for 8 seconds. On failure, an exception, Ctrl-C, SIGTERM or a closed terminal they delete it. `mom restart shell` shows it 3 seconds before the restart and deletes it 5 seconds after, without "Done". `--no-notice` skips it for all three. `mom updating on [--minutes N] | done | off` sets it by hand, for work over `mom ssh`. If `mom` can't reach the laptop or her account doesn't exist yet, it warns and carries on.
- **What the shell shows.** Nothing unless `expiresAt` is in the future. A marker that claims to last more than 20 minutes (1 minute for `done`), or whose `at` is more than a minute in the future, counts as nothing, which covers a clock that jumped. So a lost connection leaves the notice up for 15 minutes at most. `shell/Common/updating.js` decides this, and `node shell/dev/updating-test.js` tests it. The shell reads the file when it starts, watches it and polls it every 3 seconds.
- **Where.** A banner at the top with the other banners (`Windows/Banners.qml`), over the home screen and apps; a card on the lock screen; a card on the screensaver, under the viewer notice when both show. It can't be dismissed and doesn't take input, so she can keep using the computer.
- **Idle.** `momos-idle suspend` doesn't suspend while a fresh `updating` marker exists (same 20-minute rule), so a laptop on battery doesn't sleep mid-deploy. The screensaver and screen-off still happen. If hypridle's 30-minute suspend fell during the update, the next one comes after her next input and another 30 idle minutes.

## Shell IPC

The shell runs as Quickshell config `momos` (`qs -c momos`, or `qs -p <path>` in development) and exposes an `IpcHandler` with target `shell`:

```
qs -c momos ipc call shell lock
qs -c momos ipc call shell unlock
qs -c momos ipc call shell home        # show home, for momctl home
qs -c momos ipc call shell page <id>   # open a page tile like Family, or wifi, speaker, colors, text-size, icons, restart, turn-off
qs -c momos ipc call shell screensaver on|off   # hypridle, through momctl
```

`screensaver on` shows the photo screensaver full screen, over the bar: the `.jpg` files in the slideshow folder one at a time with a slow crossfade and a big clock in a corner, or a clock alone when there are none. It answers `on` or `off`, the state it ended in. It stays off while the screen is locked or a reminder is due. Any input ends it: pointer movement past a few pixels, a click, the wheel or a key. The window takes the pointer and keyboard while it's up, and clicks and keys end it on release, so neither half of the press reaches the app below. A due reminder or a new banner ends it too. While someone is viewing the screen it shows the viewer notice in words on one line at the top for as long as they're connected, since the banners and the bar are hidden under it.

qs 0.3 prints `Function not found.` and exits 0 when the shell lacks a function; momctl turns that into an error.

The shell reports its own lock changes with `momctl lock-state locked|unlocked`, which momd takes on its socket as `lock-state { locked }`.

momd's socket commands: `ping`, `status`, `say`, `help` (`HelpArgs` in `@momos/shared`: `{ text?, screenshot?, callMe?, voice?, voiceFile? }`), `voice` (`{ action: "start" | "stop" | "cancel" }`), `banner-dismiss`, `lock-state`, `home`, `open`, `reload` (`{ tileId }`), `lock` and `reminder-ok`.

momd writes banner text in full, including the `<helper> says: ` prefix on messages. The shell shows `banner.text` as is.

The shell watches `config.json` and `state.json` with `FileView` and re-reads on change.

### Reminders on screen

momd writes `state.reminders` as `{ today: ReminderItem[], due: ReminderItem[] }`, each item `{ key, id, at, label, text }` with `label` like `"2:00 PM"` and `key` as `<id>@<at>`. `today` holds the rest of today's reminders that are past their lead time; the home screen lists them in a one-line card under the greeting. `due` holds reminders whose time has come and that she hasn't answered, for up to 3 hours. The shell shows the oldest in a large card in the middle of the screen with an OK button, which runs `momctl reminder-ok <key>`. momd records a `reminder` event with `stage: "shown"` when one comes due and `"ok"` when she answers it, once each, across restarts. With momd down the shell shows no reminders.

### Notifications

The shell is her notification server (`shell/Windows/Notifications.qml`, the queue in `shell/Common/notify.js`). `momos-shell.service` sets `MOMOS_NOTIFICATIONS=1`, so it always claims `org.freedesktop.Notifications`; with the variable unset it serves only when no other server is running, and `0` never.

- Each notification is a card with Open and Close near the bottom of the screen, one at a time, newest first.
- A message is a notification whose app name or desktop entry contains "telegram", whose `category` hint starts with `im` or `email`, or whose urgency is critical. A message card stays until she presses Open or Close, or until the sender closes every notification on it (`CloseNotification`), as Telegram does once the chat is read, here or on another device. Messages from the same app and sender share one card, "3 new messages from Lucy", showing the newest words.
- Any other card closes after 20 s on screen. The clock runs only while it's the card showing, the shell isn't locked, the screensaver is off and a monitor is lit (`dpmsStatus` in `hyprctl -j monitors`, checked every 5 s).
- At most 20 cards wait. Past that the oldest non-message card goes, even the one just added, and a message goes only when all 20 are messages. The shell logs a warning each time.
- Open invokes the notification's `default` action, or its first action, and runs `momctl open telegram` for Telegram's. Close dismisses it.
- A new message ends the screensaver. If every monitor is off it runs `momctl screen on`, which refuses while the lid is closed. If nothing is pressed or moved for the next 10 minutes (Quickshell's `IdleMonitor`), it runs `momctl screen off`. Input before then leaves the screen to hypridle as usual. On battery, hypridle's 30-minute suspend still counts from her last input.
- Wayland's session lock covers the cards. While locked, the lock screen says "New message from Lucy. Unlock to read it." or "3 new messages. Unlock to read them.", and the cards wait for her to unlock.

### Telegram's unread count

momd writes `state.telegram` as `{ unread }` once it knows the count, and leaves it out before that. The shell shows it as a badge and "3 new messages" on the `app` tile for `telegram`, and nothing while momd is down. momd reads it from two places (`apps/momd/src/telegram.ts`), the latest wins:

- Telegram Desktop's `com.canonical.Unity.LauncherEntry.Update` signal on her session bus, which it sends through Qt even while hidden. momd runs `busctl --user monitor --json=short` for it. `count-visible` false means 0; otherwise `count`.
- The title of a Telegram window, "Telegram (3)" or "Telegram". A hidden Telegram has no window, so this only helps once she's opened it.

`momos-telegram.service` starts after the shell, `pipewire-pulse` and `wireplumber`, and waits up to 30 s for `org.freedesktop.Notifications` to have an owner before starting Telegram. It starts Telegram anyway after that.

## Screen sharing in a browser

The admin app's Screen page shows her screen with noVNC, on a phone or a computer, with nothing to install but Tailscale. Only the helper starts it. Nothing listens for it until he does.

```
browser (admin app, Screen page)
  -- wss://<laptop>.ts.net/, over the tailnet only -->
tailscaled on the laptop (Tailscale Serve, port 443, Let's Encrypt certificate)
  -- http://127.0.0.1:5901 -->
momd (checks the session token, copies bytes)
  -- Unix socket $XDG_RUNTIME_DIR/momos/screen/vnc.sock -->
a second wayvnc, started for the session, input off unless control is on
```

- **Setup, once.** `install.sh web-screen` runs `tailscale serve --bg --https=443 http://127.0.0.1:5901` as root. Serve's config lives in tailscaled and survives reboots; `web-screen-off` removes it. The tailnet policy grants `tcp:443` on `tag:momos` to the helper's devices. tailscaled answers 443 itself, so ufw needs no rule. Never Funnel.
- **Starting.** The Screen page queues `screen-share { op: "start", control: false, minutes: 15 }`. Only `admin.queueAction` may queue it; `queueAction` refuses it from Telegram, the dispatcher or anything else. momd refuses a start that waited more than 2 minutes (`SCREEN_SHARE_MAX_AGE_MS`), so an old click can't open it later. `minutes` is 1 to 60, 15 by default.
- **On the laptop.** momd makes `$XDG_RUNTIME_DIR/momos/screen/` (mode 700) and starts `wayvnc --config=<empty file> --render-cursor --max-fps=15 --socket=<dir>/wayvncctl.sock --unix-socket [--disable-input] <dir>/vnc.sock`. The empty config means no VNC password: only her own processes can open the socket. Its own control socket keeps it apart from `momos-wayvnc.service`, which stays on port 5900 for `mom vnc`. momd then listens on `127.0.0.1:5901` (`SCREEN_SHARE_PORT`) and turns a dark screen on unless the lid is closed.
- **The token.** momd makes a random 32-byte token (64 hex characters) for each session and reports `{ url, token, control, startedAt, expiresAt, served }` (`ScreenShareSession` in `@momos/shared`) with `device.reportScreenShare`. `url` is `wss://<MagicDNS name>/` from `tailscale status --json`. `served` says whether `tailscale serve status --json` passes `<name>:443` `/` to `127.0.0.1:5901`. The admin app reads it with `admin.screenShare`. The long-lived VNC password in `~/.config/wayvnc/config` never leaves the laptop.
- **Connecting.** The browser opens a WebSocket to `url` offering the subprotocols `binary` and `momos.<token>`, never the token in the URL. momd accepts it only with the session's token (compared in constant time), Tailscale Serve's `Tailscale-User-Login` header, fewer than 2 viewers already, and wayvnc running. It answers with subprotocol `binary` and copies bytes both ways between the WebSocket and wayvnc's socket. Anything else gets a 401, 403, 429 or 503 and a log line. A plain GET of `/ping` answers `ok` with `Access-Control-Allow-Origin: *`, so the page can tell "this device can't reach the laptop" from "the laptop refused".
- **View-only.** Without control, wayvnc runs with `--disable-input` and has no virtual pointer or keyboard, so a viewer's input goes nowhere whatever the browser sends. noVNC's `viewOnly` is set too, but the laptop doesn't depend on it.
- **Control.** A `start` while a session runs keeps the token and sets `control` and the end time. When `control` changes, momd stops wayvnc, closes the WebSockets with code 4001, and starts wayvnc again with or without `--disable-input`. The page reconnects by itself.
- **Ending.** At `expiresAt`, on `screen-share { op: "stop" }`, or when momd stops, momd closes the WebSockets and the listener, stops wayvnc, deletes the directory and reports `session: null`. Revoking the device clears the stored session too. If wayvnc exits by itself, momd starts it again up to 3 times, then ends the session.
- **Her banner.** momd counts the WebSockets it holds. While any is open, `state.viewer` is `{ connected: true, control }`, and `control` is true whenever a viewer can use her mouse and keyboard: a browser session with control on, or anyone on port 5900, since VNC there always has control. Each change is a `viewer` event with `via` (`vnc` or `web`) and `control`, and the heartbeat carries `viewerControl`. The shell tells her in three ways:
  - When a session starts, a banner says "<helper> is looking at your screen", or "<helper> is looking at your screen and can move your mouse" if it starts with control, as on port 5900. It has an OK button and goes after 10 seconds. When control turns on later in the session, the banner comes back with "<helper> can move your mouse", or the full sentence if the first banner hasn't gone yet. Control turning off shows nothing new. The 10 seconds only count while she can see the banner, so a session that starts under the screensaver or the lock screen shows it when she comes back.
  - For the whole session, an eye stays on the bar next to the status button, with a mouse pointer beside it while `control` is true. It covers nothing. Tapping it shows the banner again with the current sentence.
  - The lock screen and the screensaver, which cover the bar, show the current sentence for the whole session and can't be dismissed.

  The shell treats `connected` going false for up to 15 seconds as the same session, since browsers reconnect when control changes. After that the eye goes, and the next connection is a new session with a new banner.
- **Sound.** Not built. Designed as a later option, off by default: a `sound: true` field on `start` would make momd capture her output with `pw-record` from the default sink's monitor, encode Opus, and send it on a second WebSocket through the same listener and token, for the page to play with WebCodecs. Her banner would add "and hear your computer".

## Convex API

The backend lives in `packages/backend/convex`. Three kinds of caller, each with its own auth.

### Device functions (`device.ts`)

Called by momd. Every function takes `deviceToken: string`. The server hashes it with SHA-256 and looks up `devices.by_tokenHash`. A revoked or unknown token throws.

| Function | Kind | Args | Returns |
|---|---|---|---|
| `device.heartbeat` | mutation | `{ deviceToken, status: DeviceStatus }` | `{ serverTime }` |
| `device.ingestEvents` | mutation | `{ deviceToken, events: DeviceEvent[] }` (max 100) | `{ accepted }`; duplicate `id`s are ignored |
| `device.settings` | query | `{ deviceToken }` | `Settings` plus `photos: { id, fileName, url }[]` (`id` is the family member id) and `updatedAt`, or `null` before the first save |
| `device.content` | query | `{ deviceToken }` | `DeviceContent`: `{ reminders: Reminder[], slideshow: { id, fileName, url }[] }`, kept apart from settings |
| `device.pendingActions` | query | `{ deviceToken }` | `{ _id, action: Action, createdAt }[]` |
| `device.completeAction` | mutation | `{ deviceToken, actionId, ok, result? }` | `null` |
| `device.generateUploadUrl` | mutation | `{ deviceToken }` | `string` |
| `device.createHelpRequest` | mutation | `{ deviceToken, screenshots: Id<"_storage">[], context: DeviceStatus, note?, kinds?: HelpKind[], text?, voice?: Id<"_storage">, voiceSeconds?, askedAt? }` | `{ helpRequestId }`; schedules the Telegram message. No agent starts unless the device's settings have `helper.autoInvestigate: true`; then, with `text` or `voice`, it also creates a read-only `investigate` job (source `device`) and stores it as `autoJobId`. `askedAt` is kept only if it's between 1 minute and 7 days ago. A voice note over 2 MB is refused. |
| `device.attachScreenshot` | mutation | `{ deviceToken, actionId, storageId }` | `null`; for the `screenshot` action |
| `device.attachScreens` | mutation | `{ deviceToken, actionId, screens: { storageId, takenAt }[] }` (max 10) | `null`; for the `recent-screens` action |
| `device.reportScreenShare` | mutation | `{ deviceToken, session: ScreenShareSession \| null }` | `null`; the browser screen-sharing session, or null once it ended. One row per device in `screenShares`. |

### Admin functions (`admin.ts`)

Called by the admin app. Auth is Clerk. The signed-in email must be in the `ADMIN_EMAILS` environment variable.

`admin.overview`, `admin.device`, `admin.events`, `admin.helpRequests`, `admin.jobs`, `admin.settings`, `admin.updateSettings`, `admin.queueAction`, `admin.createDevice` (returns the plaintext token once), `admin.revokeDevice`, `admin.createJob`, `admin.approveJob`, `admin.replyToHelp` (queues a `say` action), `admin.markHelpSeen` (Got it: queues `help-seen`, once), `admin.investigateHelp` (`{ helpRequestId, instructions? }`; Send an agent: a read-only job, with the helper's note when `instructions` is given; without one, not while another is running for it), `admin.screenShare` (`{ deviceId }`; the running browser screen-sharing session with its token, or null). Also `admin.whoami`, `admin.cancelJob`, `admin.closeHelpRequest` (Done: sets `status` to `closed`), and for family photos `admin.generateUploadUrl`, `admin.setFamilyPhoto`, `admin.removeFamilyPhoto`.

Same auth, in their own modules:

- `reminders.list`, `reminders.save` (`{ deviceId, reminderId?, reminder }`, checked against the shared `Reminder` schema), `reminders.remove`. At most 50 per device.
- `slideshow.list`, `slideshow.add` (`{ deviceId, storageId }` after an upload through `admin.generateUploadUrl`; returns `{ ok, photoId }` or `{ ok: false, error }` and deletes a refused upload), `slideshow.remove`. The admin app shrinks photos to 1600 px on the long edge and uploads JPEG. At most 300 per device, 3 MB each.
- `reports.list`, `reports.preview` (the last 7 days as the report would read now).

The allowlisted actions are `say`, `home`, `open`, `reload`, `lock`, `screenshot`, `restart`, `recent-screens`, `help-seen` and `screen-share`. `reload { tileId }` is accepted only for a tile in the device's settings that is a web page; `queueAction` refuses any other tile, and every tile on a device with no settings yet. See [Reload](#reload). `screen-share` is only accepted from the admin app; see [Screen sharing in a browser](#screen-sharing-in-a-browser). `recent-screens` shows "<helper> is looking at your last few minutes" for 15 s, waits 1.5 s, then uploads the ring buffer's pictures (up to 10, oldest first) with `device.attachScreens`. It's the only way they leave the laptop. With none it completes with a result saying so. `help-seen` shows "<helper> saw your message." for 30 minutes or until she presses OK. `restart` shows "<helper> is restarting the computer. It will be back in a minute." and reboots about 10 seconds later with `systemctl reboot`, which polkit allows for her user (`system/files/polkit/50-momos-reboot.rules`). momd refuses a restart queued more than 10 minutes before it arrives, and remembers the action id so a lost acknowledgement can't reboot it twice.

### Weekly report (`reports.ts`)

An hourly cron runs `reports.generateDue`. It does nothing except on Sunday between 18:00 and 18:59 in `REPORT_TIMEZONE` (default `America/New_York`), so daylight saving time needs no special handling. Then it stores one report per device per week in `reports` and sends it to every `TELEGRAM_ADMIN_IDS` chat. Without Telegram the report is only in the admin app's Reports page. The report comes from the week's events: days she used it, most-used tiles, help presses, reminders, internet outages, weak Wi-Fi, time not heard from, low battery and locks, with a "Worth a look" list for silences over 24 hours, failed help and many restarts. The server records silences over 15 minutes in `deviceGaps` whenever a device comes back.

### Dispatcher functions (`dispatcher.ts`)

Called by the dispatcher. Every function takes `dispatcherToken: string`, compared in constant time with the `DISPATCHER_TOKEN` environment variable.

| Function | Kind | Args | Returns |
|---|---|---|---|
| `dispatcher.pendingJobs` | query | `{ dispatcherToken }` | jobs with status `queued` or `approved`, each with `deviceName`, `personName`, `helperName`, `resumeSessionId` and `parentJobId` for a follow-up, and its `helpRequest` if any: `{ createdAt, askedAt, context, replies, kinds, text, hasVoice, voiceSeconds, note, screenshotUrls }` |
| `dispatcher.claimJob` | mutation | `{ dispatcherToken, jobId, workerId, leaseMs }` | `boolean` |
| `dispatcher.updateJob` | mutation | `{ dispatcherToken, jobId, workerId, status, report?, sessionId?, suggestedMessage? }` | `null`; `awaiting_approval`, `done` and `failed` reports go to Telegram. `suggestedMessage` (cut to 260 characters) is a message for her screen the helper can send with a button. |
| `dispatcher.overview` | query | `{ dispatcherToken }` | devices with status, open help requests, recent jobs; for the bar plugin |
| `dispatcher.createJob` | mutation | `{ dispatcherToken, deviceId, kind, prompt, helpRequestId? }` | `jobId`; for jobs started from the bar plugin |
| `dispatcher.approveJob` | mutation | `{ dispatcherToken, jobId }` | `null` |

Job lifecycle: `queued` → `investigating` → `awaiting_approval` → `approved` → `fixing` → `done`, or `failed` / `cancelled` from any state. A job whose investigation report ends `FIX NEEDED: no` goes `investigating` → `done`. A job with `resumeSessionId` is investigated by resuming that Claude session (Investigate more). Both job kinds, `investigate` and `fix`, start with an investigation; the kind is a label. `claimJob` moves `queued` to `investigating` and `approved` to `fixing`. Calling `updateJob` with the same status renews the lease. A cron runs every minute and returns jobs with an expired lease to `queued` or `approved`, so they show up in `pendingJobs` again. It counts each one in `lostLeases`, and the third time a job loses its lease it goes to `failed` instead, with the reason in its report.

### Telegram (`http.ts`, `telegram.ts`)

`POST /telegram/webhook`. Rejects any request without the `X-Telegram-Bot-Api-Secret-Token` header matching `TELEGRAM_WEBHOOK_SECRET`, and ignores (with a 200) any message or button tap (`callback_query`) whose `from.id` isn't in `TELEGRAM_ADMIN_IDS`.

Incoming updates are decided in the internal mutations `telegram.route` (messages) and `telegram.callback` (taps), which return a plan: a short notice for the tap (`answerCallbackQuery`), messages to send, and whether to take the buttons off the tapped message. The webhook sends it and records each bot message in `telegramMessages` (`kind` `help`, `job`, `restart`, `reload` or `ask`), so a later reply or tap finds what it's about.

**Help messages.** A help request never starts an agent by itself (unless `helper.autoInvestigate` is on, see `device.createHelpRequest`); it reaches the helper, who decides. A headline from the kinds: "<person> asked you to call" (call-me), "<person> sent a voice note" (voice), else "<person> needs help". Then her words in quotes, lines for what else she asked for, the note, "<person> asked N min ago, while the laptop was offline." for a request that waited, one context line ("Using youtube · Internet working (home, 70%) · Battery 54%"), and "An agent is looking into it." only when one started on its own. Her screenshot follows as a photo and her voice note as a Telegram voice message (`sendVoice`), both replying to the text. The text has these buttons, with `person.name` from her settings for <person>; each button's `callback_data` is `<verb>:<id>`:

| Button | Data | Does |
|---|---|---|
| Send an agent | `agent:<helpRequestId>` | replies "Anything to tell the agent? Reply to this message with a note, or tap Send without a note." with one button, Send without a note (`agt:<helpRequestId>`), recorded as an `ask` link with `ask: "investigate"`. A reply to it is the helper's note: a read-only job whose prompt says what she asked for, then "<helper>'s note for you:" and the note in triple quotes. The tap makes the same job with no note, unless one is already running for the request, and takes the button off. Inline buttons and ForceReply can't share a message, so this question has no ForceReply. |
| Message <person>'s screen | `say:<helpRequestId>` | asks with ForceReply; the reply is a `say` on her screen, "<helper> says: ..." |
| Screenshot | `shot:<helpRequestId>` | queues `screenshot`; the picture comes back to the chat. Nothing shows on her screen. |
| Last 10 minutes | `last:<helpRequestId>` | queues `recent-screens`; the pictures come back as an album |
| Reload a page | `rldm:<helpRequestId>` | the `/reload` menu of her web pages, replying to the help message |
| Watch <person>'s screen | a URL button | opens `<ADMIN_APP_URL>/screen`. Left out when `ADMIN_APP_URL` isn't set or isn't https. |
| Call <person> | `call:<helpRequestId>` | replies with `person.phone` from her settings as plain text, which Telegram makes tappable, and an "Open <person>'s Telegram chat" URL button to `https://t.me/<person.telegram>` when that's set. Telegram buttons can't dial. Without either, it says to add her number in Settings. |
| Got it | `got:<helpRequestId>` | queues `help-seen` once and sets `seenAt` |
| Restart <person>'s laptop | `rst:<helpRequestId>` | asks "Restart ...?" with Yes, restart (`rsty:<deviceId>`) and No (`rstn:<deviceId>`); Yes within 5 minutes queues `restart` |
| Done | `done:<helpRequestId>` | sets the request's `status` to `closed` and takes the buttons off. Replies to the message still reach her screen. |

Help messages sent before this layout carry Investigate (`inv:`), Investigate with instructions (`invi:`, asks with ForceReply; the reply is the note) and Send her a message (`say:`). Those taps still work.

**Job reports** reply to her help message, or to the message that started the job. The report ends with "Suggested message for <person>: ..." when the agent wrote one. Buttons: Approve fix (`apv:<jobId>`, only while `awaiting_approval`), Investigate more (`more:<jobId>`, asks with ForceReply; the reply creates a job with `parentJobId` and `resumeSessionId` set to this job's session, and cancels this job if it was waiting for approval), Send this to <person> (`send:<jobId>`, queues the suggestion as a `say`), Dismiss (`dis:<jobId>`, cancels a job that hasn't finished and takes the buttons off).

**Action results.** An action queued from Telegram carries `telegram: { chatId, replyTo }`. When momd completes it, `telegram.sendActionResult` sends the screenshot, the album, "<person>'s laptop is restarting", "Reloaded YouTube on <person>'s laptop.", or for any failure "<Action> didn't happen on <person>'s laptop: <momd's reason>", such as a refused restart. If it's still pending after 90 s (`ACTION_WAIT_MS`), `telegram.checkAction` says it hasn't reached the laptop yet and when the laptop was last heard from.

**Messages and commands.**

- A plain reply to a help message (text, photo or voice) queues a `say` action with the text.
- `look` or `/look` as a reply to a help message creates an investigate job with no note, the same as Send without a note. `/look <instructions>` or `/run <instructions>` as a reply to a help message creates one with those instructions; as a reply to a job report it's Investigate more.
- `/run <instructions>` or `/look <instructions>` on their own start a read-only job on the device with the helper's instructions and no help request. With several devices, start with a name: `/run air: check the sound`.
- `/screenshot` (or `/screenshot <name>`) queues a `screenshot` action; the picture comes back.
- A reply to one of the bot's ForceReply questions answers it.
- `go`, `fix` or `/fix` as a reply to a job report approves the job.
- `/status` answers with every device's status.
- `/reload` answers with a menu of her web pages, one button each (`rld:<tileId>`, recorded as a `reload` link so a tap finds the device). A tap queues `reload` and the result comes back to the chat. `/reload <page>` reloads one straight away, matching the tile's id or label. With several devices, put the device or person name first: `/reload air youtube`. An unknown page gets the menu.
- `/restart` (or `/restart <device or person name>` when there are several devices) asks for confirmation with the same buttons as above. Replying `yes` to that question within 5 minutes also works. Anything else, or a late yes, does nothing.

Outgoing messages use `TELEGRAM_BOT_TOKEN` and go to `TELEGRAM_ADMIN_IDS`.

### Provisioning (`provision.ts`)

Internal functions, run with `npx convex run` from `packages/backend` by someone with deploy access. `mom devices create <name>` wraps them, for use before the admin app can sign in. It adds `--prod` to reach the production deployment when given `--prod`.

| Function | Kind | Args | Returns |
|---|---|---|---|
| `provision.createDevice` | action | `{ name, settings? }` (a config file; its `local` block is dropped) | `{ deviceId, token }`, the token in plaintext, once |
| `provision.saveSettings` | mutation | `{ deviceId, settings }` | `null` |
| `provision.listDevices` | query | `{}` | `{ _id, name, createdAt, revoked, lastSeenAt }[]` |

### Environment variables

`ADMIN_EMAILS`, `CLERK_JWT_ISSUER_DOMAIN`, `DISPATCHER_TOKEN`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`, `TELEGRAM_ADMIN_IDS`, `REPORT_TIMEZONE` (optional), `ADMIN_APP_URL` (optional, the admin app's https address, for Watch <person>'s screen). Missing Telegram variables disable Telegram without breaking anything else.

## The dispatcher

- Runs as a systemd user service on the dispatcher machine, a computer of the helper's that stays on.
- Subscribes to `dispatcher.pendingJobs` with the Convex client.
- Runs `claude -p` with the MomOS agent prompt, the repo's `AGENTS.md`, and only the `mom` CLI allowed for investigate jobs. The investigate prompt carries her words from the help request, marked as her description and not instructions, with a line that she sometimes uses Help to talk to the helper about things that aren't the computer, what she asked for, and her help screenshot, saved to the screenshot cache where the agent may read it. A report line `MESSAGE FOR <person>: ...` becomes `suggestedMessage`. The prompts get the person's and helper's names from the job, and the helper's from `mom.json` when the job has none.
- Reads its token from `~/.config/momos/dispatcher-token`. `dispatcherTokenFile` in `mom.json` or `MOMOS_DISPATCHER_TOKEN_FILE` overrides it, except that a `dispatcherTokenFile` naming the old default, `~/.config/momos-dev/dispatcher-token`, counts as unset.
- Serves a local socket at `$XDG_RUNTIME_DIR/momos-dispatcher.sock` (same JSON-lines protocol as momd) for the bar plugin: `ping`, `overview`, `jobs`, `investigate`, `approve`, `say`, `vnc`, `screenshot`.
