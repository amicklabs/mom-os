import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { Reminder, State } from "@momos/shared";
import { Core } from "../src/core";
import { toState } from "../src/model";
import { EventQueue } from "../src/queue";
import { Reminders } from "../src/reminders";
import { clockLabel, DUE_WINDOW_MS, endOfDay, fromWallTime, occurrences, plan, startOfDay } from "../src/schedule";

const NY = "America/New_York";
const H = 60 * 60_000;
const at = (y: number, m: number, d: number, hh: number, mm = 0, tz = NY) => fromWallTime(y, m, d, hh, mm, tz);

const once = (id: string, date: string, time: string, extra: Partial<Reminder> = {}) =>
  Reminder.parse({ id, text: `R ${id}`, time, leadMinutes: null, repeat: "none", date, ...extra });
const daily = (id: string, time: string, leadMinutes: number | null = null) =>
  Reminder.parse({ id, text: `R ${id}`, time, leadMinutes, repeat: "daily" });
const weekly = (id: string, time: string, days: number[]) =>
  Reminder.parse({ id, text: `R ${id}`, time, leadMinutes: null, repeat: "weekly", days });

describe("wall-clock times", () => {
  test("convert in the given zone, including daylight saving changes", () => {
    expect(at(2026, 9, 25, 14)).toBe(Date.UTC(2026, 8, 25, 18)); // EDT
    expect(at(2026, 12, 25, 14)).toBe(Date.UTC(2026, 11, 25, 19)); // EST
    expect(at(2026, 9, 25, 14, 0, "Europe/Berlin")).toBe(Date.UTC(2026, 8, 25, 12));
    // 2:30 on March 8 2026 doesn't exist in New York; it comes out at 3:30 EDT.
    expect(at(2026, 3, 8, 2, 30)).toBe(Date.UTC(2026, 2, 8, 7, 30));
    // 1:30 on November 1 2026 happens twice; the first (EDT) wins.
    expect(at(2026, 11, 1, 1, 30)).toBe(Date.UTC(2026, 10, 1, 5, 30));
  });

  test("day bounds follow the local calendar", () => {
    const noon = at(2026, 9, 25, 12);
    expect(startOfDay(noon, NY)).toBe(at(2026, 9, 25, 0));
    expect(endOfDay(noon, NY)).toBe(at(2026, 9, 26, 0));
    // The fall-back day is 25 hours long.
    expect(endOfDay(at(2026, 11, 1, 12), NY) - startOfDay(at(2026, 11, 1, 12), NY)).toBe(25 * H);
  });

  test("labels read like a clock", () => {
    expect(clockLabel(at(2026, 9, 25, 14), NY)).toBe("2:00 PM");
    expect(clockLabel(at(2026, 9, 25, 8, 5), NY)).toBe("8:05 AM");
  });
});

describe("occurrences", () => {
  test("once, daily and weekly", () => {
    const from = at(2026, 9, 21, 0); // Monday
    const to = at(2026, 9, 28, 0);
    expect(occurrences(once("a", "2026-09-25", "14:00"), from, to, NY)).toEqual([at(2026, 9, 25, 14)]);
    expect(occurrences(once("a", "2026-10-25", "14:00"), from, to, NY)).toEqual([]);
    expect(occurrences(daily("b", "08:30"), from, to, NY)).toHaveLength(7);
    // Monday and Friday.
    expect(occurrences(weekly("c", "09:00", [1, 5]), from, to, NY)).toEqual([at(2026, 9, 21, 9), at(2026, 9, 25, 9)]);
  });

  test("a daily reminder keeps its local time across daylight saving", () => {
    const list = occurrences(daily("b", "08:00"), at(2026, 10, 31, 0), at(2026, 11, 3, 0), NY);
    expect(list).toEqual([at(2026, 10, 31, 8), at(2026, 11, 1, 8), at(2026, 11, 2, 8)]);
    expect(list[1]! - list[0]!).toBe(25 * H);
  });

  test("weekdays follow the zone, not UTC", () => {
    // 21:00 Friday in New York is already Saturday in UTC.
    expect(occurrences(weekly("c", "21:00", [5]), at(2026, 9, 21, 0), at(2026, 9, 28, 0), NY)).toEqual([at(2026, 9, 25, 21)]);
  });
});

describe("plan", () => {
  const reminders = [
    once("doctor", "2026-09-25", "14:00"),
    daily("pills", "20:00", 60),
    weekly("church", "10:00", [0]),
  ];

  test("lists what's still to come today, honoring lead time", () => {
    const p = plan(reminders, at(2026, 9, 25, 9), NY, new Set());
    expect(p.today.map((r) => `${r.label}: ${r.text}`)).toEqual(["2:00 PM: R doctor"]);
    expect(p.due).toEqual([]);
    // An hour before 8 PM the pills show up too.
    const later = plan(reminders, at(2026, 9, 25, 19, 5), NY, new Set());
    expect(later.today.map((r) => r.id)).toEqual(["pills"]);
  });

  test("brings one up at its time until she answers or the window ends", () => {
    const due = at(2026, 9, 25, 14);
    expect(plan(reminders, due - 1000, NY, new Set()).due).toEqual([]);
    const p = plan(reminders, due, NY, new Set());
    expect(p.due).toEqual([{ key: `doctor@${due}`, id: "doctor", at: due, label: "2:00 PM", text: "R doctor" }]);
    expect(p.today.map((r) => r.id)).not.toContain("doctor");
    expect(plan(reminders, due + H, NY, new Set([`doctor@${due}`])).due).toEqual([]);
    expect(plan(reminders, due + DUE_WINDOW_MS - 1000, NY, new Set()).due).toHaveLength(1);
    expect(plan(reminders, due + DUE_WINDOW_MS + 1000, NY, new Set()).due).toEqual([]);
  });

  test("a reminder from late last night is still due just after midnight", () => {
    const late = [daily("late", "23:30")];
    const p = plan(late, at(2026, 9, 26, 0, 30), NY, new Set());
    expect(p.due.map((r) => r.at)).toEqual([at(2026, 9, 25, 23, 30)]);
    expect(p.today.map((r) => r.at)).toEqual([at(2026, 9, 26, 23, 30)]);
  });
});

describe("Reminders service", () => {
  function setup() {
    const root = mkdtempSync(`${tmpdir()}/rem-`);
    const file = `${root}/reminders.json`;
    const core = new Core(new EventQueue(`${root}/q.sqlite`), "test");
    const svc = new Reminders(core, () => NY, () => file);
    const events = () => core.queue.peek(100).filter((e) => e.type === "reminder");
    return { file, core, svc, events };
  }

  test("records shown once, OK once, and survives a bad file", () => {
    const { file, core, svc, events } = setup();
    writeFileSync(file, JSON.stringify([once("doctor", "2026-09-25", "14:00")]));
    const due = at(2026, 9, 25, 14);
    svc.tick(due + 1000);
    svc.tick(due + 5000);
    expect(core.model.reminders.due.map((r) => r.key)).toEqual([`doctor@${due}`]);
    expect(State.safeParse(toState(core.model, due)).success).toBe(true);
    expect(events().map((e) => (e as { stage: string }).stage)).toEqual(["shown"]);

    expect(svc.ok(`doctor@${due}`, due + 9000)).toBe(true);
    expect(svc.ok(`doctor@${due}`, due + 9000)).toBe(false);
    expect(svc.ok("other@1", due + 9000)).toBe(false);
    expect(() => svc.ok("../x", due)).toThrow();
    expect(core.model.reminders.due).toEqual([]);
    expect(events().map((e) => (e as { stage: string }).stage)).toEqual(["shown", "ok"]);

    // A broken file keeps the last good list.
    writeFileSync(file, "{ nope");
    svc.tick(due + 10_000);
    expect(svc.reminders().map((r) => r.id)).toEqual(["doctor"]);
  });

  test("a restart doesn't show or record a reminder twice", () => {
    const { file, core, svc, events } = setup();
    writeFileSync(file, JSON.stringify([daily("pills", "20:00")]));
    const due = at(2026, 9, 25, 20);
    svc.tick(due);
    svc.ok(`pills@${due}`, due + 1000);
    const again = new Reminders(core, () => NY, () => file);
    again.tick(due + 2000);
    expect(core.model.reminders.due).toEqual([]);
    expect(events()).toHaveLength(2);
  });
});
