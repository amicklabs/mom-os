#!/usr/bin/env bun
import { existsSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { paths, State, STATE_STALE_MS } from "@momos/shared";
import { apps } from "./lib/apps";
import { momdRequest, MomdUnavailable } from "./lib/client";
import { loadConfig, tryLoadConfig } from "./lib/config";
import { ensureSessionEnv } from "./lib/env";
import { health } from "./lib/health";
import * as input from "./lib/input";
import { dpms } from "./lib/hypr";
import { findTile, openTile } from "./lib/launch";
import { reloadTile } from "./lib/reload";
import * as shell from "./lib/shell";
import * as speaker from "./lib/speaker";
import * as sys from "./lib/system";
import { VERSION } from "./lib/version";
import * as wifi from "./lib/wifi";

const USAGE = `momctl ${VERSION}: control MomOS on this laptop. Every command prints JSON.

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
  version`;

class UsageError extends Error {}

function flag(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  if (i < 0) return undefined;
  const v = args[i + 1];
  if (v === undefined) throw new UsageError(`${name} needs a value`);
  args.splice(i, 2);
  return v;
}

function num(s: string | undefined, what: string): number {
  const n = Number(s);
  if (s === undefined || s === "" || !Number.isFinite(n)) throw new UsageError(`${what} must be a number`);
  return n;
}

async function viaMomd(cmd: string, args: Record<string, unknown>, timeoutMs = 5000): Promise<unknown> {
  const res = await momdRequest(cmd, args, { timeoutMs });
  if (!res.ok) throw new Error(res.error);
  return res.data;
}

// Tell momd about a lock change so it can log it. Harmless if momd is down.
async function tellMomd(cmd: string, args: Record<string, unknown>): Promise<void> {
  try {
    await momdRequest(cmd, args, { timeoutMs: 1000 });
  } catch {
    // momd is optional here
  }
}

// momd's lid state from state.json. False if momd isn't running or the file is stale.
function lidClosed(): boolean {
  const s = readState();
  return !s.stale && (s.state as { lid?: { closed?: boolean } } | null)?.lid?.closed === true;
}

function readState() {
  try {
    const path = paths.state();
    const raw = JSON.parse(readFileSync(path, "utf8"));
    const parsed = State.safeParse(raw);
    const ageMs = Date.now() - statSync(path).mtimeMs;
    return { state: parsed.success ? parsed.data : raw, valid: parsed.success, ageMs: Math.round(ageMs), stale: ageMs > STATE_STALE_MS };
  } catch (e) {
    return { state: null, valid: false, error: (e as Error).message };
  }
}

// Through momd, which knows whether the screen is locked and puts the short
// note on her screen. Without momd, or with a momd from before reload, it
// reloads here, without the note.
async function reload(tileId: string): Promise<unknown> {
  let res;
  try {
    res = await momdRequest("reload", { tileId }, { timeoutMs: 30_000 });
  } catch (e) {
    // Only when momd isn't there at all: after a timeout it may be reloading.
    if (!(e instanceof MomdUnavailable) || existsSync(paths.socket())) throw e;
    return reloadTile(findTile(loadConfig(), tileId));
  }
  if (res.ok) return res.data;
  if (/unknown command/.test(res.error)) return reloadTile(findTile(loadConfig(), tileId));
  throw new Error(res.error);
}

async function status() {
  const config = tryLoadConfig();
  const [windows, momd] = await Promise.all([
    apps(config).catch((e: Error) => ({ error: e.message })),
    momdRequest("status", {}, { timeoutMs: 3000 })
      .then((r) => (r.ok ? { running: true, ...(r.data as object) } : { running: true, error: r.error }))
      .catch((e: Error) => ({ running: false, error: e.message })),
  ]);
  return { version: VERSION, file: readState(), windows, momd };
}

async function main(argv: string[]): Promise<unknown> {
  const args = [...argv];
  const cmd = args.shift();
  switch (cmd) {
    case undefined:
    case "--help":
    case "-h":
      return { usage: USAGE };
    case "version":
    case "--version":
      return { version: VERSION };
    case "status":
      return status();
    case "open": {
      const id = args[0];
      if (!id) throw new UsageError("open needs a tile id");
      return openTile(findTile(loadConfig(), id));
    }
    case "reload": {
      const id = args[0];
      if (!id) throw new UsageError("reload needs a tile id");
      return reload(id);
    }
    case "home":
      return shell.home();
    case "lock": {
      const r = await shell.lock();
      await tellMomd("lock-state", { locked: true });
      return r;
    }
    case "unlock": {
      const r = await shell.unlock();
      await tellMomd("lock-state", { locked: false });
      return r;
    }
    case "lock-state": {
      const v = args[0];
      if (v !== "locked" && v !== "unlocked") throw new UsageError("lock-state takes locked or unlocked");
      return viaMomd("lock-state", { locked: v === "locked" }, 2000);
    }
    case "screensaver": {
      const v = args[0];
      if (v !== "on" && v !== "off") throw new UsageError("screensaver takes on or off");
      return shell.screensaver(v);
    }
    case "screen": {
      const v = args[0];
      if (v !== "on" && v !== "off") throw new UsageError("screen takes on or off");
      if (v === "on" && lidClosed()) return { screen: "off", reason: "the lid is closed" };
      await dpms(v === "on");
      return { screen: v };
    }
    case "volume": {
      const dir = args[0];
      if (dir !== "up" && dir !== "down" && dir !== "mute") throw new UsageError("volume takes up, down or mute");
      return sys.volume(dir);
    }
    case "screenshot":
      return sys.wakeAndScreenshot(flag(args, "--out"), { lidClosed: lidClosed() });
    case "apps":
      return apps(tryLoadConfig());
    case "say": {
      const secondsArg = flag(args, "--seconds");
      const text = args.join(" ").trim();
      if (!text) throw new UsageError('say needs text: momctl say "Hello"');
      const seconds = secondsArg === undefined ? undefined : num(secondsArg, "--seconds");
      return viaMomd("say", { text, seconds });
    }
    case "help": {
      // What the Help pop-up sends. A bare `momctl help` is a plain press.
      const text = flag(args, "--text");
      const voiceFile = flag(args, "--voice-file");
      const on = (name: string) => {
        const i = args.indexOf(name);
        if (i >= 0) args.splice(i, 1);
        return i >= 0;
      };
      const screenshot = on("--screenshot");
      const callMe = on("--call-me");
      const voice = on("--voice");
      if (args.length) throw new UsageError(`help doesn't take ${args.join(" ")}`);
      return viaMomd(
        "help",
        {
          ...(text !== undefined ? { text } : {}),
          ...(screenshot ? { screenshot } : {}),
          ...(callMe ? { callMe } : {}),
          ...(voice ? { voice } : {}),
          ...(voiceFile !== undefined ? { voiceFile: resolve(voiceFile) } : {}),
        },
        90_000,
      );
    }
    case "voice": {
      const action = args[0];
      if (action !== "start" && action !== "stop" && action !== "cancel") throw new UsageError("voice takes start, stop or cancel");
      return viaMomd("voice", { action }, 30_000);
    }
    case "reminder-ok": {
      if (!args[0]) throw new UsageError("reminder-ok needs the reminder's key");
      return viaMomd("reminder-ok", { key: args[0] });
    }
    case "click":
      return input.click(num(args[0], "x"), num(args[1], "y"), args[2] === "right" ? "right" : "left");
    case "type": {
      const text = args.join(" ");
      if (!text) throw new UsageError("type needs text");
      return input.type(text);
    }
    case "key": {
      if (!args[0]) throw new UsageError("key needs a combo like enter or ctrl+l");
      return input.key(args[0]);
    }
    case "wifi":
      if (args.length === 0) return sys.wifi();
      return wifi.command(args, { config: tryLoadConfig, readStdin: () => Bun.stdin.text() });
    case "speaker":
      return speaker.command(args);
    case "logs": {
      const unit = flag(args, "--unit") ?? "momd";
      const lines = num(flag(args, "--lines") ?? "100", "--lines");
      if (!sys.isUnitName(unit)) throw new UsageError("--unit is momd, shell or wayvnc");
      return sys.logs(unit, lines);
    }
    case "restart": {
      const unit = args[0];
      if (!sys.isUnitName(unit)) throw new UsageError("restart takes shell, momd or wayvnc");
      return sys.restart(unit);
    }
    case "power": {
      const action = args[0];
      if (!sys.isPowerAction(action)) throw new UsageError("power takes off or restart");
      return sys.power(action);
    }
    case "health":
      return health();
    default:
      throw new UsageError(`unknown command "${cmd}". Run momctl --help.`);
  }
}

ensureSessionEnv();
try {
  const data = await main(process.argv.slice(2));
  process.stdout.write(JSON.stringify({ ok: true, data }) + "\n");
  process.exit(0);
} catch (e) {
  const err = e as Error;
  const out: Record<string, unknown> = { ok: false, error: err.message };
  if (err instanceof UsageError) out.usage = USAGE;
  if (err instanceof MomdUnavailable) out.momd = false;
  if (err instanceof wifi.WifiError) out.reason = err.reason;
  if (err instanceof speaker.SpeakerError) out.reason = err.reason;
  process.stdout.write(JSON.stringify(out) + "\n");
  process.exit(1);
}
