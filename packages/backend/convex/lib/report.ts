import type { DeviceEventDoc } from "../validators";
import { TELEGRAM_TEXT_LIMIT, truncate } from "./format";

// The weekly report: a short plain-text summary of one device's week, built
// from its events. Pure functions, so tests can feed them events directly.

export const DEFAULT_REPORT_TIMEZONE = "America/New_York";
export const WEEK_MS = 7 * 24 * 60 * 60_000;
// Report on Sunday at 18:00 local time.
export const REPORT_WEEKDAY = 0;
export const REPORT_HOUR = 18;

const LONG_SILENCE_MS = 24 * 60 * 60_000;
const LOW_BATTERY = 10;
const WEAK_SIGNAL = 30;
const MANY_BOOTS = 7;

export function reportTimeZone(env: string | undefined = process.env.REPORT_TIMEZONE): string {
  const tz = env?.trim() || DEFAULT_REPORT_TIMEZONE;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return tz;
  } catch {
    console.error(`REPORT_TIMEZONE "${tz}" isn't a time zone; using ${DEFAULT_REPORT_TIMEZONE}.`);
    return DEFAULT_REPORT_TIMEZONE;
  }
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export type LocalParts = { date: string; weekday: number; hour: number; minute: number };

export function localParts(at: number, tz: string): LocalParts {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(at));
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return {
    date: `${get("year")}-${get("month")}-${get("day")}`,
    weekday: WEEKDAYS.indexOf(get("weekday")),
    hour: Number(get("hour")) % 24,
    minute: Number(get("minute")),
  };
}

export function isReportTime(now: number, tz: string): boolean {
  const p = localParts(now, tz);
  return p.weekday === REPORT_WEEKDAY && p.hour === REPORT_HOUR;
}

function fmt(at: number, tz: string, opts: Intl.DateTimeFormatOptions): string {
  return new Intl.DateTimeFormat("en-US", { timeZone: tz, ...opts }).format(new Date(at));
}
const shortDate = (at: number, tz: string) => fmt(at, tz, { month: "short", day: "numeric" });
const dayAndTime = (at: number, tz: string) => fmt(at, tz, { weekday: "short", hour: "numeric", minute: "2-digit" });

export function duration(ms: number): string {
  const minutes = Math.round(ms / 60_000);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours < 24) return rest ? `${hours} h ${rest} min` : `${hours} h`;
  const days = Math.floor(hours / 24);
  const h = hours % 24;
  return `${days} day${days > 1 ? "s" : ""}${h ? ` ${h} h` : ""}`;
}

const times = (n: number) => (n === 1 ? "once" : n === 2 ? "twice" : `${n} times`);

export type ReportInput = {
  person: string;
  from: number;
  to: number;
  tz: string;
  // Events with from <= at < to, any order.
  events: DeviceEventDoc[];
  // Whether the internet worked at `from`, from the last network event before it.
  onlineAtStart: boolean | null;
  // Silences recorded by the server (deviceGaps) that overlap the week.
  gaps: { from: number; to: number }[];
  lastSeenAt: number | null;
  helpRequests: number;
  // Tile id to label, so "youtube" reads "YouTube".
  tileLabels: Record<string, string>;
};

export function buildReport(r: ReportInput): string {
  const events = [...r.events].filter((e) => e.at >= r.from && e.at < r.to).sort((a, b) => a.at - b.at);
  const lines: string[] = [];
  const unusual: string[] = [];

  // Days she used it: any app opened, help pressed or reminder answered.
  const days = new Map<string, number>();
  for (const e of events) {
    const used =
      (e.type === "app" && e.app !== null) || (e.type === "help" && e.stage === "pressed") || (e.type === "reminder" && e.stage === "ok");
    if (used) {
      const p = localParts(e.at, r.tz);
      days.set(p.date, p.weekday);
    }
  }
  const dayNames = [...days.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, wd]) => WEEKDAYS[wd]);
  lines.push(days.size === 0 ? `${r.person} didn't use the laptop this week.` : `Used it on ${days.size} day${days.size > 1 ? "s" : ""}: ${dayNames.join(", ")}.`);

  // Most-used tiles, by how often each came to the front.
  const opens = new Map<string, number>();
  for (const e of events) if (e.type === "app" && e.app) opens.set(e.app, (opens.get(e.app) ?? 0) + 1);
  const top = [...opens.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 3);
  if (top.length) {
    lines.push(`Most used: ${top.map(([app, n], i) => `${r.tileLabels[app] ?? app} (${i === 0 ? times(n) : n})`).join(", ")}.`);
  }

  const pressed = events.filter((e) => e.type === "help" && e.stage === "pressed").length;
  const helpCount = Math.max(pressed, r.helpRequests);
  lines.push(helpCount ? `Help button: pressed ${times(helpCount)}.` : "Help button: not pressed.");
  const helpFailed = events.filter((e) => e.type === "help" && e.stage === "failed").length;
  if (helpFailed) unusual.push(`Help didn't reach you ${times(helpFailed)} (offline or failed), so ${r.person} saw your phone number.`);

  const shown = events.filter((e) => e.type === "reminder" && e.stage === "shown").length;
  const ok = events.filter((e) => e.type === "reminder" && e.stage === "ok").length;
  if (shown) lines.push(`Reminders: ${shown} shown, ${ok} answered with OK.`);

  // Internet outages, from the laptop's own network events.
  let online = r.onlineAtStart;
  let downSince: number | null = online === false ? r.from : null;
  let downMs = 0;
  let outages = online === false ? 1 : 0;
  let weak = 0;
  for (const e of events) {
    if (e.type !== "network") continue;
    if (e.signal !== null && e.signal < WEAK_SIGNAL) weak++;
    if (e.online === online) continue;
    if (!e.online) {
      downSince = e.at;
      outages++;
    } else if (downSince !== null) {
      downMs += e.at - downSince;
      downSince = null;
    }
    online = e.online;
  }
  // Still down at the end: count up to when the laptop was last heard from.
  if (downSince !== null) downMs += Math.max(0, Math.min(r.to, r.lastSeenAt ?? r.to) - downSince);
  if (outages) lines.push(`Internet: down ${times(outages)}, ${duration(downMs)} in all.`);
  if (weak) lines.push(`Wi-Fi: weak signal ${times(weak)}.`);

  // Silences: the laptop asleep, off or unreachable.
  const silences = r.gaps
    .map((g) => ({ from: Math.max(g.from, r.from), to: Math.min(g.to, r.to), since: g.from, current: false }))
    .filter((g) => g.to > g.from);
  if (r.lastSeenAt !== null && r.to - r.lastSeenAt > 15 * 60_000) {
    silences.push({ from: Math.max(r.lastSeenAt, r.from), to: r.to, since: r.lastSeenAt, current: true });
  }
  const silentMs = silences.reduce((sum, g) => sum + (g.to - g.from), 0);
  if (silentMs > 0) lines.push(`Not heard from: ${duration(silentMs)} in all (asleep, off or offline).`);
  for (const g of silences) {
    if (g.to - g.from < LONG_SILENCE_MS) continue;
    unusual.push(
      g.current
        ? `No word from the laptop since ${dayAndTime(g.since, r.tz)}.`
        : `No word from the laptop for ${duration(g.to - g.from)}, ${dayAndTime(g.from, r.tz)} to ${dayAndTime(g.to, r.tz)}.`,
    );
  }
  if (r.lastSeenAt === null) unusual.push("The laptop has never checked in.");

  // Battery: each drop to 10% or below while not charging.
  let low = 0;
  let wasLow = false;
  for (const e of events) {
    if (e.type !== "power") continue;
    const isLow = e.percent <= LOW_BATTERY && !e.charging;
    if (isLow && !wasLow) low++;
    wasLow = isLow;
  }
  if (low) lines.push(`Battery: got down to ${LOW_BATTERY}% or less ${times(low)}.`);

  const locks = events.filter((e) => e.type === "lock" && e.locked).length;
  if (locks) lines.push(`Screen locked: ${times(locks)}.`);

  const boots = events.filter((e) => e.type === "boot").length;
  if (boots > MANY_BOOTS) unusual.push(`Started up ${boots} times.`);

  const head = `Weekly report for ${r.person}, ${shortDate(r.from, r.tz)} to ${shortDate(r.to - 1, r.tz)}`;
  const tail = unusual.length ? ["", "Worth a look:", ...unusual.map((u) => `- ${u}`)] : ["", "Nothing unusual."];
  return truncate([head, "", ...lines, ...tail].join("\n"), TELEGRAM_TEXT_LIMIT);
}
