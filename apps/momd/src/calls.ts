import { NATIVE_APPS } from "@momos/shared";
import * as hypr from "@momos/momctl/hypr";
import { log } from "./core";

// Incoming Telegram calls come to the front. Her Hyprland config sends every
// Telegram window to the Telegram tile's workspace silently, so a call window
// would ring out of sight. Telegram Desktop opens each call in its own
// top-level window, same class as the main window, titled with the caller's
// name (calls_panel.cpp: window()->setTitle(_user->name()); group calls use
// the chat's name). The main window is titled "Telegram" or "Telegram (3)",
// and the photo viewer "Media viewer". So a new Telegram window with any
// other title is taken for a call and moved onto whatever workspace she's
// looking at, and focused.
//
// Not yet checked against a real incoming call; see PLAN.md, Handover.

const TELEGRAM_CLASS = NATIVE_APPS.telegram.windowClass.toLowerCase();
const TELEGRAM_CLASSES = new Set([TELEGRAM_CLASS, "org.telegram.desktop", "telegram-desktop", "telegramdesktop"]);
// Qt windows often map before they get a title. Watch a new window's title
// changes for this long.
export const WATCH_MS = 15_000;

export const isTelegramClass = (cls: string) => TELEGRAM_CLASSES.has(cls.toLowerCase());

// Titles that are not a call. An empty title means "not known yet".
export function isCallTitle(title: string): boolean {
  const t = title.trim();
  if (!t) return false;
  if (/^telegram( \(\d+\))?$/i.test(t)) return false;
  if (/^(media viewer|picture[- ]in[- ]picture)$/i.test(t)) return false;
  return true;
}

// Parse one line from Hyprland's event socket (.socket2.sock).
export type WindowEvent =
  | { kind: "open"; address: string; workspace: string; cls: string; title: string }
  | { kind: "title"; address: string; title: string }
  | { kind: "close"; address: string }
  | { kind: "move"; address: string; workspace: string }
  | { kind: "workspace"; workspace: string };

export function parseWindowEvent(line: string): WindowEvent | null {
  const i = line.indexOf(">>");
  if (i < 0) return null;
  const name = line.slice(0, i);
  const data = line.slice(i + 2);
  if (name === "openwindow") {
    // ADDRESS,WORKSPACE,CLASS,TITLE; the title may itself contain commas.
    const [address, workspace, cls, ...rest] = data.split(",");
    if (!address || cls === undefined) return null;
    return { kind: "open", address: norm(address), workspace: workspace ?? "", cls, title: rest.join(",") };
  }
  if (name === "windowtitlev2") {
    const j = data.indexOf(",");
    if (j < 0) return null;
    return { kind: "title", address: norm(data.slice(0, j)), title: data.slice(j + 1) };
  }
  if (name === "closewindow") return { kind: "close", address: norm(data) };
  if (name === "movewindowv2") {
    // ADDRESS,WORKSPACEID,WORKSPACENAME
    const [address, , ...ws] = data.split(",");
    if (!address || !ws.length) return null;
    return { kind: "move", address: norm(address), workspace: ws.join(",") };
  }
  if (name === "workspacev2") {
    // WORKSPACEID,WORKSPACENAME
    const j = data.indexOf(",");
    if (j < 0) return null;
    return { kind: "workspace", workspace: data.slice(j + 1) };
  }
  return null;
}

const norm = (a: string) => (a.startsWith("0x") ? a : `0x${a}`);

export class CallWatcher {
  // New Telegram windows whose title isn't known to be a call yet.
  private watching = new Map<string, number>();
  private raised = new Set<string>();

  constructor(
    private readonly bringForward: (address: string, title: string) => Promise<void>,
    private readonly now: () => number = Date.now,
  ) {}

  // Returns true if this event made it bring a window forward.
  async handle(ev: WindowEvent): Promise<boolean> {
    const t = this.now();
    for (const [addr, since] of this.watching) if (t - since > WATCH_MS) this.watching.delete(addr);
    if (ev.kind === "close") {
      this.watching.delete(ev.address);
      this.raised.delete(ev.address);
      return false;
    }
    if (ev.kind === "open") {
      if (!isTelegramClass(ev.cls)) return false;
      this.watching.set(ev.address, t);
      return await this.check(ev.address, ev.title);
    }
    if (ev.kind !== "title" || !this.watching.has(ev.address)) return false;
    return await this.check(ev.address, ev.title);
  }

  private async check(address: string, title: string): Promise<boolean> {
    if (!isCallTitle(title) || this.raised.has(address)) return false;
    this.watching.delete(address);
    this.raised.add(address);
    await this.bringForward(address, title);
    return true;
  }
}

// Move the window to the workspace on screen and focus it.
export async function bringForward(address: string): Promise<void> {
  const ws = await hypr.activeWorkspace();
  const target = ws.name && !ws.name.startsWith("special") ? ws.name.replace(/^name:/, "") : null;
  if (target) await hypr.moveWindow(address, target, false);
  await hypr.focusWindow(address);
  log("calls", `brought Telegram window ${address} forward${target ? ` onto ${target}` : ""}`);
}
