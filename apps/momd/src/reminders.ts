import { readFileSync, statSync } from "node:fs";
import { z } from "zod";
import { paths, Reminder } from "@momos/shared";
import { type Core, every, log } from "./core";
import { localTimeZone, plan } from "./schedule";

// Brings reminders up on her screen. The list comes from reminders.json, which
// ConvexSync writes from `device.content`, so they keep working offline and
// across restarts. Which ones she has answered and which have been shown are
// kept in the queue's meta table, so a restart doesn't show one twice.

const TICK_MS = 5000;
const KEEP_MS = 2 * 24 * 60 * 60_000;
const ANSWERED = "reminders.answered";
const SHOWN = "reminders.shown";

export const RemindersFile = z.array(Reminder);

export function parseKey(key: string): { id: string; at: number } | null {
  const m = /^([A-Za-z0-9_-]{1,64})@(\d{1,16})$/.exec(key);
  return m ? { id: m[1]!, at: Number(m[2]) } : null;
}

export class Reminders {
  private list: Reminder[] = [];
  private mtime = -2;

  constructor(
    private readonly core: Core,
    private readonly tz: () => string = localTimeZone,
    private readonly file: () => string = paths.reminders,
  ) {}

  // The list from reminders.json, re-read when the file changes. A bad file
  // keeps the last good list.
  reminders(): Reminder[] {
    let mtime = -1;
    try {
      mtime = statSync(this.file()).mtimeMs;
    } catch {
      // no file: no reminders
    }
    if (mtime === this.mtime) return this.list;
    this.mtime = mtime;
    if (mtime < 0) return (this.list = []);
    try {
      const parsed = RemindersFile.safeParse(JSON.parse(readFileSync(this.file(), "utf8")));
      if (parsed.success) this.list = parsed.data;
      else log("reminders", "reminders.json is invalid; keeping the last good list");
    } catch (e) {
      log("reminders", "can't read reminders.json:", e);
    }
    return this.list;
  }

  private keys(name: string, now: number): Set<string> {
    let raw: unknown = [];
    try {
      raw = JSON.parse(this.core.queue.getMeta(name) ?? "[]");
    } catch {
      // start over
    }
    const keys = Array.isArray(raw) ? raw.filter((k): k is string => typeof k === "string") : [];
    return new Set(keys.filter((k) => (parseKey(k)?.at ?? 0) > now - KEEP_MS));
  }

  private save(name: string, keys: Set<string>): void {
    this.core.queue.setMeta(name, JSON.stringify([...keys]));
  }

  tick(now = Date.now()): void {
    const answered = this.keys(ANSWERED, now);
    const p = plan(this.reminders(), now, this.tz(), answered);
    const shown = this.keys(SHOWN, now);
    let changed = false;
    for (const r of p.due) {
      if (shown.has(r.key)) continue;
      shown.add(r.key);
      changed = true;
      this.core.record({ type: "reminder", reminderId: r.id, due: r.at, stage: "shown" }, now);
    }
    if (changed) this.save(SHOWN, shown);
    this.core.dispatch({ type: "reminders", today: p.today, due: p.due });
  }

  // She pressed OK. Unknown keys are ignored, so a stale press does no harm.
  ok(key: string, now = Date.now()): boolean {
    const k = parseKey(key);
    if (!k) throw new Error("reminder-ok needs a key like id@time");
    const answered = this.keys(ANSWERED, now);
    const known = this.core.model.reminders.due.some((r) => r.key === key);
    if (answered.has(key) || !known) return false;
    answered.add(key);
    this.save(ANSWERED, answered);
    this.core.record({ type: "reminder", reminderId: k.id, due: k.at, stage: "ok" }, now);
    this.tick(now);
    return true;
  }

  run(): Promise<void> {
    return every(TICK_MS, () => this.tick());
  }
}
