import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "./_generated/api";
import { buildReport, duration, isReportTime, localParts, reportTimeZone, type ReportInput } from "./lib/report";
import { ADMIN, ADMIN_TG_ID, addDevice, newBackend, settings, status, type Backend } from "./test.setup";
import type { DeviceEventDoc } from "./validators";

const NY = "America/New_York";
const H = 60 * 60_000;
// Sunday, September 27 2026, 18:00 in New York (EDT, UTC-4).
const SUNDAY_6PM = Date.UTC(2026, 8, 27, 22, 0);
const WEEK_START = SUNDAY_6PM - 7 * 24 * H;

describe("report time", () => {
  it("is Sunday 18:00 to 18:59 in the report time zone, through daylight saving time", () => {
    expect(isReportTime(SUNDAY_6PM, NY)).toBe(true);
    expect(isReportTime(SUNDAY_6PM + 59 * 60_000, NY)).toBe(true);
    expect(isReportTime(SUNDAY_6PM - 60_000, NY)).toBe(false);
    expect(isReportTime(SUNDAY_6PM + H, NY)).toBe(false);
    // December 6 2026 is in EST (UTC-5).
    expect(isReportTime(Date.UTC(2026, 11, 6, 23, 5), NY)).toBe(true);
    expect(isReportTime(Date.UTC(2026, 11, 6, 22, 5), NY)).toBe(false);
    expect(isReportTime(Date.UTC(2026, 8, 27, 16, 5), "Europe/Berlin")).toBe(true);
    expect(localParts(SUNDAY_6PM, NY)).toEqual({ date: "2026-09-27", weekday: 0, hour: 18, minute: 0 });
  });

  it("falls back to New York for a missing or bad time zone", () => {
    expect(reportTimeZone(undefined)).toBe(NY);
    expect(reportTimeZone("Mars/Olympus")).toBe(NY);
    expect(reportTimeZone("Europe/Berlin")).toBe("Europe/Berlin");
  });

  it("formats durations plainly", () => {
    expect(duration(5 * 60_000)).toBe("5 min");
    expect(duration(2 * H + 10 * 60_000)).toBe("2 h 10 min");
    expect(duration(30 * H)).toBe("1 day 6 h");
  });
});

let n = 0;
const ev = (at: number, e: Record<string, unknown>) => ({ id: `e${n++}`, at, ...e }) as DeviceEventDoc;

function input(events: DeviceEventDoc[], extra: Partial<ReportInput> = {}): ReportInput {
  return {
    person: "Mom",
    from: WEEK_START,
    to: SUNDAY_6PM,
    tz: NY,
    events,
    onlineAtStart: true,
    gaps: [],
    lastSeenAt: SUNDAY_6PM - 60_000,
    helpRequests: 0,
    tileLabels: { youtube: "YouTube", facebook: "Facebook", family: "Family" },
    ...extra,
  };
}

describe("buildReport", () => {
  it("summarizes a week in plain words", () => {
    // Monday 10:00 EDT is 14:00 UTC.
    const mon = Date.UTC(2026, 8, 21, 14, 0);
    const events = [
      ev(mon, { type: "app", app: "youtube" }),
      ev(mon + 1 * H, { type: "app", app: null }),
      ev(mon + 2 * H, { type: "app", app: "youtube" }),
      ev(mon + 3 * H, { type: "app", app: "facebook" }),
      ev(mon + 26 * H, { type: "app", app: "youtube" }), // Tuesday
      ev(mon + 26 * H, { type: "help", stage: "pressed" }),
      ev(mon + 26 * H, { type: "help", stage: "sent" }),
      ev(mon + 27 * H, { type: "network", online: false, ssid: "Home", signal: 20, dns: false }),
      ev(mon + 29 * H + 10 * 60_000, { type: "network", online: true, ssid: "Home", signal: 70, dns: true }),
      ev(mon + 30 * H, { type: "power", percent: 10, charging: false }),
      ev(mon + 30.5 * H, { type: "power", percent: 5, charging: false }),
      ev(mon + 31 * H, { type: "power", percent: 5, charging: true }),
      ev(mon + 32 * H, { type: "lock", locked: true }),
      ev(mon + 33 * H, { type: "lock", locked: false }),
      ev(mon + 34 * H, { type: "reminder", reminderId: "r", due: mon + 34 * H, stage: "shown" }),
      ev(mon + 34 * H, { type: "reminder", reminderId: "r", due: mon + 34 * H, stage: "ok" }),
      ev(WEEK_START - H, { type: "app", app: "family" }), // before the week: ignored
    ];
    const text = buildReport(input(events, { gaps: [{ from: mon + 40 * H, to: mon + 48 * H }] }));
    expect(text).toBe(
      [
        "Weekly report for Mom, Sep 20 to Sep 27",
        "",
        "Used it on 2 days: Mon, Tue.",
        "Most used: YouTube (3 times), Facebook (1).",
        "Help button: pressed once.",
        "Reminders: 1 shown, 1 answered with OK.",
        "Internet: down once, 2 h 10 min in all.",
        "Wi-Fi: weak signal once.",
        "Not heard from: 8 h in all (asleep, off or offline).",
        "Battery: got down to 10% or less once.",
        "Screen locked: once.",
        "",
        "Nothing unusual.",
      ].join("\n"),
    );
  });

  it("flags long silences, failed help and a laptop that went quiet", () => {
    const tue = Date.UTC(2026, 8, 22, 19, 0); // Tue 3:00 PM EDT
    const text = buildReport(
      input([ev(tue, { type: "help", stage: "pressed" }), ev(tue, { type: "help", stage: "failed" })], {
        gaps: [{ from: tue, to: tue + 31 * H }],
        lastSeenAt: SUNDAY_6PM - 30 * H,
        onlineAtStart: false,
      }),
    );
    expect(text).toContain("Help didn't reach you once");
    expect(text).toContain("No word from the laptop for 1 day 7 h, Tue 3:00 PM to Wed 10:00 PM.");
    expect(text).toContain("No word from the laptop since Sat 12:00 PM.");
    // Down from the start of the week until it was last heard from.
    expect(text).toContain("Internet: down once, 5 days 18 h in all.");
  });

  it("says so when she didn't use it", () => {
    expect(buildReport(input([]))).toContain("Mom didn't use the laptop this week.");
    expect(buildReport(input([], { lastSeenAt: null }))).toContain("The laptop has never checked in.");
  });
});

// ---- the cron, end to end ----------------------------------------------------

let t: Backend;
let sent: { text: string; chat_id: string }[];

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubEnv("ADMIN_EMAILS", ADMIN.email);
  vi.stubEnv("TELEGRAM_BOT_TOKEN", "123:abc");
  vi.stubEnv("TELEGRAM_ADMIN_IDS", `${ADMIN_TG_ID},1002`);
  sent = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init: RequestInit) => {
      sent.push(JSON.parse(String(init.body)));
      return new Response(JSON.stringify({ ok: true, result: { message_id: 1 } }));
    }),
  );
  t = newBackend();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

async function deviceWithWeek() {
  vi.setSystemTime(WEEK_START + H);
  const { deviceId, token } = await addDevice(t);
  await t.withIdentity(ADMIN).mutation(api.admin.updateSettings, { deviceId, settings });
  await t.mutation(api.device.heartbeat, { deviceToken: token, status });
  await t.mutation(api.device.ingestEvents, {
    deviceToken: token,
    events: [{ id: "a1", at: WEEK_START + 2 * H, type: "app", app: "youtube" }],
  });
  // Silent for 30 hours, then back.
  vi.setSystemTime(WEEK_START + 32 * H);
  await t.mutation(api.device.heartbeat, { deviceToken: token, status });
  vi.setSystemTime(SUNDAY_6PM - 5 * 60_000);
  await t.mutation(api.device.heartbeat, { deviceToken: token, status });
  return { deviceId, token };
}

describe("weekly report cron", () => {
  it("does nothing outside Sunday 18:00", async () => {
    await deviceWithWeek();
    vi.setSystemTime(SUNDAY_6PM - 10 * 60_000);
    expect(await t.mutation(internal.reports.generateDue, {})).toBe(0);
  });

  it("stores one report per device per week and sends it to every admin", async () => {
    const { deviceId } = await deviceWithWeek();
    const gaps = await t.run((ctx) => ctx.db.query("deviceGaps").collect());
    expect(gaps.map((g) => g.to - g.from)).toEqual([31 * H, SUNDAY_6PM - 5 * 60_000 - (WEEK_START + 32 * H)]);

    vi.setSystemTime(SUNDAY_6PM + 2 * 60_000);
    expect(await t.mutation(internal.reports.generateDue, {})).toBe(1);
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(await t.mutation(internal.reports.generateDue, {})).toBe(0);

    expect(sent.map((s) => s.chat_id)).toEqual([ADMIN_TG_ID, "1002"]);
    expect(sent[0]!.text).toContain("Weekly report for Mom");
    expect(sent[0]!.text).toContain("Most used: YouTube (once).");
    expect(sent[0]!.text).toContain("No word from the laptop for 1 day 7 h, Sun 7:00 PM to Tue 2:00 AM.");

    const reports = await t.withIdentity(ADMIN).query(api.reports.list, { deviceId });
    expect(reports).toHaveLength(1);
    expect(reports[0]!.week).toBe("2026-09-27");
    expect(reports[0]!.telegramSentAt).not.toBeNull();
  });

  it("keeps the report for the admin app when Telegram isn't configured", async () => {
    vi.stubEnv("TELEGRAM_BOT_TOKEN", "");
    const { deviceId } = await deviceWithWeek();
    vi.setSystemTime(SUNDAY_6PM + 2 * 60_000);
    await t.mutation(internal.reports.generateDue, {});
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(sent).toEqual([]);
    const reports = await t.withIdentity(ADMIN).query(api.reports.list, { deviceId });
    expect(reports[0]!.telegramSentAt).toBeNull();
    expect(reports[0]!.text).toContain("Used it on 1 day: Sun.");
  });

  it("follows REPORT_TIMEZONE", async () => {
    vi.stubEnv("REPORT_TIMEZONE", "Europe/Berlin");
    await deviceWithWeek();
    vi.setSystemTime(SUNDAY_6PM + 2 * 60_000); // 00:02 Monday in Berlin
    expect(await t.mutation(internal.reports.generateDue, {})).toBe(0);
    vi.setSystemTime(Date.UTC(2026, 9, 4, 16, 2)); // next Sunday, 18:02 in Berlin
    expect(await t.mutation(internal.reports.generateDue, {})).toBe(1);
  });

  it("previews the report for an admin only", async () => {
    const { deviceId } = await deviceWithWeek();
    const preview = await t.withIdentity(ADMIN).query(api.reports.preview, { deviceId });
    expect(preview?.timeZone).toBe(NY);
    expect(preview?.text).toContain("Weekly report for Mom");
    await expect(t.query(api.reports.preview, { deviceId })).rejects.toThrow("Sign in required");
  });
});
