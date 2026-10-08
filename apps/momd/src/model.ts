import type { Banner, DeviceEvent, DeviceStatus, ReminderItem, State } from "@momos/shared";

// Everything momd knows about the laptop, and a pure reducer over it. The
// reducer also says which events to log, so logging follows state changes and
// can't drift from them.

export type HelpStatus = State["help"]["status"];
export type ConvexStatus = State["convex"];

export interface Model {
  online: boolean | null;
  dns: boolean | null;
  wifi: { ssid: string | null; signal: number | null } | null;
  battery: { percent: number; charging: boolean } | null;
  // Battery percent at the last power event, to log only real changes.
  loggedPercent: number | null;
  // Anyone looking, over VNC or in a browser. `control`: one of them can use
  // her mouse and keyboard.
  viewer: { connected: boolean; since: number | null; control: boolean };
  // Each way of looking. A VNC viewer always has control; a browser viewer
  // only when the session allows it.
  viewers: { vnc: boolean; web: boolean; webControl: boolean };
  // `queued`: help requests waiting in the outbox.
  help: { status: HelpStatus; at: number | null; queued: number };
  banner: Banner | null;
  lidClosed: boolean;
  // Locked by the MomOS shell, or by another locker (hyprlock).
  locks: { shell: boolean; other: boolean };
  app: string | null;
  convex: ConvexStatus;
  // Computed by Reminders from reminders.json every few seconds.
  reminders: { today: ReminderItem[]; due: ReminderItem[] };
  // Unread messages in Telegram Desktop, or null until Telegram says
  // (telegram.ts).
  telegramUnread: number | null;
}

export const initialModel = (): Model => ({
  online: null,
  dns: null,
  wifi: null,
  battery: null,
  loggedPercent: null,
  viewer: { connected: false, since: null, control: false },
  viewers: { vnc: false, web: false, webControl: false },
  help: { status: "idle", at: null, queued: 0 },
  banner: null,
  lidClosed: false,
  locks: { shell: false, other: false },
  app: null,
  convex: "disabled",
  reminders: { today: [], due: [] },
  telegramUnread: null,
});

export type Msg =
  | { type: "network"; online: boolean | null; dns: boolean | null; wifi: Model["wifi"] }
  | { type: "battery"; battery: Model["battery"] }
  // `via` defaults to "vnc". `control` is for "web" only.
  | { type: "viewer"; connected: boolean; via?: "vnc" | "web"; control?: boolean }
  | { type: "help"; status: HelpStatus }
  | { type: "help-queue"; queued: number }
  | { type: "banner"; banner: Banner }
  | { type: "banner-dismiss"; id?: string }
  | { type: "lid"; closed: boolean }
  | { type: "lock"; source: "shell" | "other"; locked: boolean }
  | { type: "app"; app: string | null }
  | { type: "convex"; convex: ConvexStatus }
  | { type: "reminders"; today: ReminderItem[]; due: ReminderItem[] }
  | { type: "telegram"; unread: number }
  | { type: "tick" };

// An event without its id and time; the caller stamps those.
export type NewEvent = DeviceEvent extends infer E ? (E extends DeviceEvent ? Omit<E, "id" | "at"> : never) : never;

export interface Reduced {
  model: Model;
  events: NewEvent[];
  changed: boolean;
}

export const isLocked = (m: Model) => m.locks.shell || m.locks.other;

// Power events: on plugging in or out, and every 5 points of charge.
const POWER_STEP = 5;
// How long a sent, offline or failed help status lasts before it goes back to
// idle. The shell's pop-up stays up as long as she leaves it.
export const HELP_RESET_MS = 5 * 60_000;

export function reduce(m: Model, msg: Msg, now: number): Reduced {
  const events: NewEvent[] = [];
  let next: Model = m;
  switch (msg.type) {
    case "network": {
      next = { ...m, online: msg.online, dns: msg.dns, wifi: msg.wifi };
      if (m.online !== msg.online || m.wifi?.ssid !== msg.wifi?.ssid || m.dns !== msg.dns) {
        if (msg.online !== null) {
          events.push({ type: "network", online: msg.online, ssid: msg.wifi?.ssid ?? null, signal: msg.wifi?.signal ?? null, dns: msg.dns });
        }
      }
      break;
    }
    case "battery": {
      next = { ...m, battery: msg.battery };
      const b = msg.battery;
      if (b) {
        const moved = m.loggedPercent === null || Math.abs(b.percent - m.loggedPercent) >= POWER_STEP;
        if (moved || m.battery?.charging !== b.charging) {
          events.push({ type: "power", percent: b.percent, charging: b.charging });
          next.loggedPercent = b.percent;
        }
      }
      break;
    }
    case "viewer": {
      const via = msg.via ?? "vnc";
      const viewers =
        via === "vnc"
          ? { ...m.viewers, vnc: msg.connected }
          : { ...m.viewers, web: msg.connected, webControl: msg.connected && msg.control === true };
      const connected = viewers.vnc || viewers.web;
      const control = viewers.vnc || viewers.webControl;
      if (JSON.stringify(viewers) === JSON.stringify(m.viewers)) break;
      next = {
        ...m,
        viewers,
        viewer: { connected, since: connected ? (m.viewer.connected ? m.viewer.since : now) : null, control },
      };
      if (m.viewers[via] !== viewers[via] || (via === "web" && m.viewers.webControl !== viewers.webControl)) {
        events.push({ type: "viewer", connected: viewers[via], control: via === "vnc" ? viewers.vnc : viewers.webControl, via });
      }
      break;
    }
    case "help":
      next = { ...m, help: { ...m.help, status: msg.status, at: now } };
      if (msg.status === "sent" || msg.status === "failed" || msg.status === "offline") {
        events.push({ type: "help", stage: msg.status === "sent" ? "sent" : "failed" });
      }
      break;
    case "help-queue":
      if (m.help.queued !== msg.queued) next = { ...m, help: { ...m.help, queued: msg.queued } };
      break;
    case "banner":
      next = { ...m, banner: msg.banner };
      break;
    case "banner-dismiss":
      if (m.banner && (!msg.id || msg.id === m.banner.id)) next = { ...m, banner: null };
      break;
    case "lid":
      if (m.lidClosed !== msg.closed) {
        next = { ...m, lidClosed: msg.closed };
        events.push({ type: "lid", closed: msg.closed });
      }
      break;
    case "lock": {
      const locks = { ...m.locks, [msg.source]: msg.locked };
      next = { ...m, locks };
      const was = isLocked(m);
      const is = locks.shell || locks.other;
      if (was !== is) events.push({ type: "lock", locked: is });
      break;
    }
    case "app":
      if (m.app !== msg.app) {
        next = { ...m, app: msg.app };
        events.push({ type: "app", app: msg.app });
      }
      break;
    case "convex":
      if (m.convex !== msg.convex) next = { ...m, convex: msg.convex };
      break;
    case "reminders":
      next = { ...m, reminders: { today: msg.today, due: msg.due } };
      break;
    case "telegram": {
      const unread = Number.isFinite(msg.unread) && msg.unread > 0 ? Math.floor(msg.unread) : 0;
      if (m.telegramUnread !== unread) next = { ...m, telegramUnread: unread };
      break;
    }
    case "tick":
      if (m.banner?.until != null && m.banner.until <= now) next = { ...next, banner: null };
      if (m.help.status !== "idle" && m.help.status !== "sending" && m.help.at !== null && now - m.help.at >= HELP_RESET_MS) {
        next = { ...next, help: { ...m.help, status: "idle", at: now } };
      }
      break;
  }
  return { model: next, events, changed: next !== m && !shallowEqual(next, m) };
}

function shallowEqual(a: Model, b: Model): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export function toState(m: Model, now: number): State {
  return {
    version: 1,
    updatedAt: now,
    online: m.online,
    wifi: m.wifi,
    battery: m.battery,
    viewer: m.viewer,
    help: m.help,
    banner: m.banner,
    lid: { closed: m.lidClosed },
    convex: m.convex,
    reminders: m.reminders,
    ...(m.telegramUnread !== null ? { telegram: { unread: m.telegramUnread } } : {}),
  };
}

export function toStatus(m: Model, now: number, version: string): DeviceStatus {
  return {
    at: now,
    app: m.app,
    online: m.online === true,
    wifi: m.wifi,
    battery: m.battery,
    viewer: m.viewer.connected,
    viewerControl: m.viewer.control,
    locked: isLocked(m),
    lidClosed: m.lidClosed,
    version,
  };
}

// What counts as a change worth an immediate heartbeat. Signal strength and
// small battery moves wait for the regular one.
export function heartbeatKey(m: Model): string {
  return JSON.stringify([
    m.app,
    m.online,
    m.wifi?.ssid ?? null,
    m.battery?.charging ?? null,
    m.loggedPercent,
    m.viewer.connected,
    m.viewer.control,
    isLocked(m),
    m.lidClosed,
  ]);
}
