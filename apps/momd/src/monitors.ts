import { Resolver } from "node:dns/promises";
import { hyprSocketDir } from "@momos/momctl/env";
import { activeWindow, clients } from "@momos/momctl/hypr";
import { run, which } from "@momos/momctl/run";
import { processRunning } from "@momos/momctl/shell";
import { battery, wifi } from "@momos/momctl/system";
import { tileIdForClass } from "@momos/momctl/tiles";
import { bringForward, CallWatcher, parseWindowEvent } from "./calls";
import { type Core, every, log, sleep } from "./core";
import type { TelegramUnread } from "./telegram";
import type { WindowKeeper } from "./windows";

// ---- network --------------------------------------------------------------

const NET_POLL_ONLINE_MS = 15_000;
const NET_POLL_OFFLINE_MS = 10_000;
const DNS_EVERY_MS = 60_000;

async function dnsWorks(host: string): Promise<boolean> {
  const r = new Resolver({ timeout: 3000, tries: 2 });
  try {
    const addrs = await r.resolve4(host);
    return addrs.length > 0;
  } catch {
    return false;
  }
}

// NetworkManager's own connectivity check decides online; it already probes a
// URL on its own schedule, so momd adds no traffic of its own except one DNS
// lookup a minute.
export async function networkMonitor(core: Core): Promise<void> {
  let dns: boolean | null = null;
  let lastDns = 0;
  let lastConn = "";
  await every(
    () => (core.model.online ? NET_POLL_ONLINE_MS : NET_POLL_OFFLINE_MS),
    async () => {
      const info = await wifi();
      const connected = info.devices.some((d) => d.state === "connected");
      const now = Date.now();
      if (!connected) dns = null;
      else if (now - lastDns > DNS_EVERY_MS || info.connectivity !== lastConn) {
        const url = core.config()?.local?.convexUrl;
        dns = await dnsWorks(url ? new URL(url).hostname : "www.google.com");
        lastDns = now;
      }
      lastConn = info.connectivity;
      const online =
        info.connectivity === "full" ? true : info.connectivity === "unknown" ? (connected ? dns : false) : false;
      core.dispatch({
        type: "network",
        online,
        dns,
        wifi: info.wifi ? { ssid: info.wifi.ssid, signal: info.wifi.signal } : null,
      });
    },
  );
}

// ---- battery --------------------------------------------------------------

export async function batteryMonitor(core: Core): Promise<void> {
  await every(30_000, () => {
    const b = battery();
    core.dispatch({ type: "battery", battery: b ? { percent: b.percent, charging: b.charging } : null });
  });
}

// ---- focused app ----------------------------------------------------------

// The tile id for a window class, or the class itself. Never the window title.
export function appFor(core: Core, windowClass: string | null | undefined): string | null {
  if (!windowClass) return null;
  return tileIdForClass(core.config()?.tiles ?? [], windowClass) ?? windowClass;
}

// Follows Hyprland's event socket for focus changes, new windows for incoming
// Telegram calls (calls.ts), and window opens, closes and workspace changes
// for the one-thing-at-a-time rules (windows.ts), and Telegram's window title
// for its unread count (telegram.ts).
export async function focusMonitor(core: Core, windows: WindowKeeper, telegram?: TelegramUnread): Promise<void> {
  const dir = hyprSocketDir();
  if (!dir) throw new Error("Hyprland isn't running");
  const w = await activeWindow().catch(() => null);
  core.dispatch({ type: "app", app: appFor(core, w?.class) });
  if (telegram) {
    for (const c of await clients().catch(() => [])) telegram.known(c.address, c.class, c.title);
  }

  const calls = new CallWatcher((address) => bringForward(address));

  await new Promise<never>((_resolve, reject) => {
    let buf = "";
    Bun.connect({
      unix: `${dir}/.socket2.sock`,
      socket: {
        data(_s, chunk) {
          buf += chunk.toString();
          let nl: number;
          while ((nl = buf.indexOf("\n")) >= 0) {
            const line = buf.slice(0, nl);
            buf = buf.slice(nl + 1);
            if (line.startsWith("activewindow>>")) {
              const cls = line.slice("activewindow>>".length).split(",")[0];
              core.dispatch({ type: "app", app: appFor(core, cls) });
            }
            const ev = parseWindowEvent(line);
            if (ev) {
              calls.handle(ev).catch((e) => {
                log("calls", "can't bring the call window forward:", e);
                core.error("calls", e);
              });
              windows.handle(ev).catch((e) => log("windows", "can't place a window:", e));
              telegram?.window(ev);
            }
          }
        },
        close() {
          reject(new Error("Hyprland event socket closed"));
        },
        error(_s, err) {
          reject(err);
        },
      },
    }).catch(reject);
  });
}

// ---- viewer (wayvnc) ------------------------------------------------------

// Pull a connection count out of one wayvncctl event, or null if it isn't a
// client event.
export function viewerCountFrom(ev: unknown): number | null {
  if (!ev || typeof ev !== "object") return null;
  const e = ev as { method?: string; params?: { connection_count?: number } };
  if (e.method === "client-connected" || e.method === "client-disconnected") {
    if (typeof e.params?.connection_count === "number") return e.params.connection_count;
    return e.method === "client-connected" ? 1 : 0;
  }
  if (e.method === "wayvnc-shutdown") return 0;
  return null;
}

let viewerDownLogged = false;

export const VIEWER_RETRY_MS = 60_000;

// Follows wayvnc for as long as momd runs. wayvnc restarting (a deploy, or
// Tailscale coming up so it binds a new address) is normal: its control socket
// refuses connections for a moment, event-receive ends, and this waits a
// minute and connects again. It loops here rather than returning, so the
// supervisor's growing backoff doesn't stretch the minute out.
export async function viewerMonitor(core: Core, wait: (ms: number) => Promise<void> = sleep): Promise<void> {
  for (;;) {
    if (!which("wayvncctl")) {
      core.dispatch({ type: "viewer", connected: false });
      await wait(5 * 60_000);
      continue;
    }
    if (!(await followWayvnc(core))) await wait(VIEWER_RETRY_MS);
    else await wait(5000); // wayvnc went away; let it come back up
  }
}

// One connection to wayvnc. False if it didn't answer, true once it answered
// and then its event stream ended.
async function followWayvnc(core: Core): Promise<boolean> {
  const list = await run(["wayvncctl", "--json", "client-list"], { timeoutMs: 5000 }).catch(() => null);
  if (!list || list.code !== 0) {
    // wayvnc not running is normal (not set up yet, or restarting): nobody can
    // be watching. Log it once, not as an error.
    core.dispatch({ type: "viewer", connected: false });
    const why = (list?.stderr || list?.stdout || "").trim().split("\n")[0] || "no output";
    if (!viewerDownLogged) log("viewer", `wayvnc isn't answering (${why}); checking again every minute`);
    viewerDownLogged = true;
    return false;
  }
  if (viewerDownLogged) log("viewer", "wayvnc is answering");
  viewerDownLogged = false;
  try {
    const clients = JSON.parse(list.stdout);
    core.dispatch({ type: "viewer", connected: Array.isArray(clients) && clients.length > 0 });
  } catch {
    // unknown format; wait for events
  }

  const proc = Bun.spawn([which("wayvncctl")!, "--json", "event-receive"], { stdout: "pipe", stderr: "ignore", stdin: Bun.file("/dev/null") });
  let pending = "";
  const decoder = new TextDecoder();
  try {
    for await (const chunk of proc.stdout) {
      for (const line of decoder.decode(chunk, { stream: true }).split("\n")) {
        pending += line;
        let ev: unknown;
        try {
          ev = JSON.parse(pending);
        } catch {
          continue; // an object spread over several lines
        }
        pending = "";
        const n = viewerCountFrom(ev);
        if (n !== null) core.dispatch({ type: "viewer", connected: n > 0 });
      }
    }
  } finally {
    proc.kill();
    core.dispatch({ type: "viewer", connected: false });
  }
  log("viewer", `wayvnc event stream ended (exit ${await proc.exited}); reconnecting`);
  return true;
}

// ---- lock -----------------------------------------------------------------

// The shell tells momd about its own lock (socket "lock-state"). Other lockers
// are spotted by process name.
export async function lockMonitor(core: Core): Promise<void> {
  await every(5000, () => {
    const other = processRunning("hyprlock");
    if (other !== core.model.locks.other) core.dispatch({ type: "lock", source: "other", locked: other });
  });
}
