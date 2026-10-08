import type { Reminder, ReminderItem } from "@momos/shared";

// When reminders come up. Pure functions over a time zone, so tests can pin
// the zone and the clock. Reminder times are wall-clock times in the laptop's
// zone; a daily 08:00 stays at 08:00 across daylight saving changes.

// A reminder stays on screen until she presses OK, or until this long after
// its time. A laptop that was asleep at the time shows it on waking, within
// the same window.
export const DUE_WINDOW_MS = 3 * 60 * 60_000;

const DAY_MS = 24 * 60 * 60_000;

export function localTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}

type Wall = { y: number; m: number; d: number; hh: number; mm: number; weekday: number };

const formatters = new Map<string, Intl.DateTimeFormat>();
function formatter(tz: string): Intl.DateTimeFormat {
  let f = formatters.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      year: "numeric",
      month: "numeric",
      day: "numeric",
      weekday: "short",
      hour: "numeric",
      minute: "numeric",
      hourCycle: "h23",
    });
    formatters.set(tz, f);
  }
  return f;
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function wallTime(at: number, tz: string): Wall {
  const parts = formatter(tz).formatToParts(new Date(at));
  const n = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  return {
    y: n("year"),
    m: n("month"),
    d: n("day"),
    hh: n("hour") % 24,
    mm: n("minute"),
    weekday: WEEKDAYS.indexOf(parts.find((p) => p.type === "weekday")?.value ?? ""),
  };
}

// Offset of the zone from UTC at `at`, in ms (EDT is -4 h).
function offsetAt(at: number, tz: string): number {
  const w = wallTime(at, tz);
  const asUtc = Date.UTC(w.y, w.m - 1, w.d, w.hh, w.mm);
  return asUtc - (at - (at % 60_000));
}

// The instant a wall-clock time happens in the zone. A time skipped by a
// spring-forward change comes out an hour later; a time that happens twice in
// the fall comes out the first time.
export function fromWallTime(y: number, m: number, d: number, hh: number, mm: number, tz: string): number {
  const guess = Date.UTC(y, m - 1, d, hh, mm);
  const first = guess - offsetAt(guess, tz);
  const second = guess - offsetAt(first, tz);
  // Two candidates when the offset changes near the time; take the earlier
  // one that really shows that wall time.
  const candidates = [first, second].sort((a, b) => a - b);
  for (const c of candidates) {
    const w = wallTime(c, tz);
    if (w.y === y && w.m === m && w.d === d && w.hh === hh && w.mm === mm) return c;
  }
  return Math.max(first, second);
}

const pad = (n: number) => String(n).padStart(2, "0");
const dateKey = (w: { y: number; m: number; d: number }) => `${w.y}-${pad(w.m)}-${pad(w.d)}`;

function happensOn(r: Reminder, day: Wall): boolean {
  switch (r.repeat) {
    case "none":
      return r.date === dateKey(day);
    case "daily":
      return true;
    case "weekly":
      return r.days.includes(day.weekday);
  }
}

// Every time `r` happens with from <= at < to.
export function occurrences(r: Reminder, from: number, to: number, tz: string): number[] {
  const [hh, mm] = r.time.split(":").map(Number) as [number, number];
  const out: number[] = [];
  // Walk local calendar days, starting the day before to be safe at the edges.
  let day = wallTime(from - DAY_MS, tz);
  for (let i = 0; i < 400; i++) {
    const noon = fromWallTime(day.y, day.m, day.d, 12, 0, tz);
    if (noon - DAY_MS > to) break;
    if (happensOn(r, day)) {
      const at = fromWallTime(day.y, day.m, day.d, hh, mm, tz);
      if (at >= from && at < to) out.push(at);
    }
    day = wallTime(noon + DAY_MS, tz);
  }
  return out;
}

export function startOfDay(at: number, tz: string): number {
  const w = wallTime(at, tz);
  return fromWallTime(w.y, w.m, w.d, 0, 0, tz);
}

export function endOfDay(at: number, tz: string): number {
  const w = wallTime(at, tz);
  const next = wallTime(fromWallTime(w.y, w.m, w.d, 12, 0, tz) + DAY_MS, tz);
  return fromWallTime(next.y, next.m, next.d, 0, 0, tz);
}

export function clockLabel(at: number, tz: string): string {
  return new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit" }).format(new Date(at));
}

export const occurrenceKey = (id: string, at: number) => `${id}@${at}`;

function item(r: Reminder, at: number, tz: string): ReminderItem {
  return { key: occurrenceKey(r.id, at), id: r.id, at, label: clockLabel(at, tz), text: r.text };
}

export interface Plan {
  // Still to come today and past the lead time, soonest first.
  today: ReminderItem[];
  // Time has come, not answered, within DUE_WINDOW_MS; oldest first.
  due: ReminderItem[];
}

export function plan(reminders: Reminder[], now: number, tz: string, answered: ReadonlySet<string>): Plan {
  const dayEnd = endOfDay(now, tz);
  const today: ReminderItem[] = [];
  const due: ReminderItem[] = [];
  for (const r of reminders) {
    for (const at of occurrences(r, now - DUE_WINDOW_MS, dayEnd, tz)) {
      if (at <= now) {
        if (!answered.has(occurrenceKey(r.id, at))) due.push(item(r, at, tz));
      } else if (at < dayEnd && at >= startOfDay(now, tz)) {
        if (r.leadMinutes === null || now >= at - r.leadMinutes * 60_000) today.push(item(r, at, tz));
      }
    }
  }
  const byTime = (a: ReminderItem, b: ReminderItem) => a.at - b.at || a.text.localeCompare(b.text);
  return { today: today.sort(byTime), due: due.sort(byTime) };
}
