# momd

The daemon on her laptop. It runs as a systemd user service, `momd.service`, in her session.

It:

- watches the network, battery, focused window, lid, screen lock and VNC viewers;
- writes `$XDG_RUNTIME_DIR/momos/state.json` for the shell every 10 seconds and on every change;
- queues events in `~/.local/share/momos/momd.sqlite` and uploads them to Convex, so nothing is lost while she's offline;
- sends heartbeats and applies settings, reminders, family photos and screensaver photos from Convex, checking each against the schemas in `packages/shared`;
- carries out the allowlisted actions from Convex and refuses anything else;
- handles the Get help button and keeps the last ten screenshots, one a minute, on the laptop only;
- schedules reminders itself, so they come up offline;
- on the 2013 MacBook Air, decides whether the lid is closed from the flaky switch and the light sensor;
- brings an incoming Telegram call window to the front;
- reconnects her saved Bluetooth speaker once after it starts and once after each wake from sleep;
- records a daily health report.

`momctl` talks to it over `$XDG_RUNTIME_DIR/momos/momd.sock`, one JSON object per line.

Without `local.convexUrl` in her config or a device token, momd runs without Convex and checks again every minute.

## Source

| File | What |
|---|---|
| `src/main.ts` | starts every task under a supervisor that restarts them |
| `src/core.ts`, `src/model.ts` | state, and how events change it |
| `src/convex.ts` | the Convex link: heartbeats, uploads, settings, content, actions |
| `src/queue.ts` | the SQLite event queue |
| `src/actions.ts`, `src/runner.ts` | checking and carrying out actions |
| `src/help.ts` | the help button and the screenshot ring buffer |
| `src/monitors.ts` | network, battery, focus, viewers, lock |
| `src/screen.ts` | whether the screen is on, and when it just came on |
| `src/lid.ts`, `src/lidmon.ts` | lid detection |
| `src/calls.ts` | bringing Telegram calls forward |
| `src/reminders.ts`, `src/schedule.ts` | reminders |
| `src/slideshow.ts` | screensaver photo sync |
| `src/speaker.ts` | reconnecting her Bluetooth speaker after login and sleep |
| `src/socket.ts` | the socket `momctl` uses |

## Develop

```sh
pnpm --filter @momos/momd test
pnpm --filter @momos/momd typecheck
pnpm --filter @momos/momd build     # dist/momd
```

`mom deploy` builds it for the laptop and installs it to `/usr/local/bin/momd`. Logs on the laptop: `mom logs --unit momd`.

See [docs/contracts.md](../../docs/contracts.md) for the files it owns and the socket commands.
