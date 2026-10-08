import { which } from "@momos/momctl/run";
import { isTelegramClass, type WindowEvent } from "./calls";
import type { Core } from "./core";

// Unread messages in Telegram Desktop, for the badge on her Telegram tile.
//
// Two sources, whichever spoke last wins:
//
// - The Unity launcher signal. Telegram Desktop sets its badge through Qt,
//   which sends com.canonical.Unity.LauncherEntry.Update on the session bus
//   with "count" and "count-visible", even while Telegram runs hidden
//   (-startintray) and has no window. momd follows it with `busctl monitor`.
// - The main window's title, "Telegram (3)" or "Telegram". Only there once
//   she has opened Telegram, since a hidden Telegram has no window.

// "Telegram (3)" is 3, "Telegram" is 0, anything else (a call, the media
// viewer, a title not set yet) says nothing.
export function unreadFromTitle(title: string): number | null {
  const m = /^telegram(?: \((\d+)\))?$/i.exec(title.trim());
  if (!m) return null;
  return m[1] ? Number(m[1]) : 0;
}

export interface LauncherUpdate {
  count?: number;
  visible?: boolean;
}

// One line of `busctl monitor --json=short`. Only Telegram's Update signals
// count; other apps use the same interface for their own badges.
export function launcherUpdateFrom(line: string): LauncherUpdate | null {
  let msg: unknown;
  try {
    msg = JSON.parse(line);
  } catch {
    return null;
  }
  if (!msg || typeof msg !== "object") return null;
  const m = msg as { type?: string; member?: string; interface?: string; payload?: { data?: unknown } };
  if (m.type !== "signal" || m.member !== "Update" || m.interface !== "com.canonical.Unity.LauncherEntry") return null;
  const data = m.payload?.data;
  if (!Array.isArray(data) || typeof data[0] !== "string" || !/telegram/i.test(data[0])) return null;
  const props = data[1] as Record<string, { data?: unknown }> | undefined;
  if (!props || typeof props !== "object") return null;
  const out: LauncherUpdate = {};
  const count = props.count?.data;
  if (typeof count === "number" && Number.isFinite(count)) out.count = Math.max(0, Math.floor(count));
  else if (typeof count === "string" && /^\d+$/.test(count)) out.count = Number(count);
  const visible = props["count-visible"]?.data;
  if (typeof visible === "boolean") out.visible = visible;
  return out.count === undefined && out.visible === undefined ? null : out;
}

export class TelegramUnread {
  private count = 0;
  private visible: boolean | null = null;
  // Telegram windows seen opening, so their title changes can be read.
  private windows = new Set<string>();

  constructor(private readonly report: (unread: number) => void) {}

  launcher(u: LauncherUpdate): void {
    if (u.count !== undefined) this.count = u.count;
    if (u.visible !== undefined) this.visible = u.visible;
    // A count without count-visible is taken as shown.
    this.report(this.visible === false ? 0 : this.count);
  }

  title(title: string): void {
    const n = unreadFromTitle(title);
    if (n === null) return;
    this.count = n;
    this.visible = n > 0;
    this.report(n);
  }

  // Hyprland's window events, from the focus monitor.
  window(ev: WindowEvent): void {
    if (ev.kind === "open") {
      if (!isTelegramClass(ev.cls)) return;
      this.windows.add(ev.address);
      this.title(ev.title);
    } else if (ev.kind === "title") {
      if (this.windows.has(ev.address)) this.title(ev.title);
    } else if (ev.kind === "close") {
      this.windows.delete(ev.address);
    }
  }

  // Windows already open when momd starts.
  known(address: string, cls: string, title: string): void {
    if (!isTelegramClass(cls)) return;
    this.windows.add(address);
    this.title(title);
  }
}

export const telegramUnread = (core: Core) => new TelegramUnread((unread) => core.dispatch({ type: "telegram", unread }));

// Follows Telegram's launcher signal for as long as busctl runs. The
// supervisor starts it again when it ends.
export async function launcherMonitor(tracker: TelegramUnread): Promise<void> {
  const busctl = which("busctl");
  if (!busctl) throw new Error("busctl isn't installed");
  const proc = Bun.spawn(
    [
      busctl,
      "--user",
      "monitor",
      "--json=short",
      "--match",
      "type=signal,interface=com.canonical.Unity.LauncherEntry,member=Update",
    ],
    { stdout: "pipe", stderr: "ignore", stdin: Bun.file("/dev/null") },
  );
  const decoder = new TextDecoder();
  let buf = "";
  try {
    for await (const chunk of proc.stdout) {
      buf += decoder.decode(chunk, { stream: true });
      let nl: number;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl);
        buf = buf.slice(nl + 1);
        const u = launcherUpdateFrom(line);
        if (u) tracker.launcher(u);
      }
    }
  } finally {
    proc.kill();
  }
  throw new Error(`busctl monitor ended (exit ${await proc.exited})`);
}
