import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { internalAction, internalMutation, internalQuery, query, type QueryCtx } from "./_generated/server";
import { requireAdmin } from "./lib/auth";
import { RETENTION_MS } from "./cleanup";
import { buildReport, isReportTime, localParts, reportTimeZone, WEEK_MS } from "./lib/report";
import { personName, settingsFor } from "./lib/settings";
import { canSend, sendMessage, telegramConfig } from "./lib/telegramApi";

// Weekly reports. An hourly cron calls generateDue, which does nothing except
// on Sunday between 18:00 and 18:59 in REPORT_TIMEZONE (default
// America/New_York). That makes daylight saving time and a changed time zone
// work without touching the cron. Each report is stored, then sent on Telegram
// when it's configured. The admin app's Reports page shows them either way.

const MAX_EVENTS = 8000;

async function reportText(ctx: QueryCtx, device: Doc<"devices">, from: number, to: number, tz: string): Promise<string> {
  const events = await ctx.db
    .query("events")
    .withIndex("by_device_and_at", (q) => q.eq("deviceId", device._id).gte("at", from).lt("at", to))
    .take(MAX_EVENTS);
  // Whether the internet worked when the week began: the last network event
  // before it. Few enough events come before that the scan stays short.
  let onlineAtStart: boolean | null = null;
  for await (const e of ctx.db
    .query("events")
    .withIndex("by_device_and_at", (q) => q.eq("deviceId", device._id).lt("at", from))
    .order("desc")) {
    if (e.event.type === "network") {
      onlineAtStart = e.event.online;
      break;
    }
    if (from - e.at > WEEK_MS) break;
  }
  const gaps = await ctx.db
    .query("deviceGaps")
    .withIndex("by_device_and_to", (q) => q.eq("deviceId", device._id).gt("to", from))
    .take(500);
  const help = await ctx.db
    .query("helpRequests")
    .withIndex("by_device_and_createdAt", (q) => q.eq("deviceId", device._id).gte("createdAt", from).lt("createdAt", to))
    .take(500);
  const settings = await settingsFor(ctx, device._id);
  return buildReport({
    person: await personName(ctx, device),
    from,
    to,
    tz,
    events: events.map((e) => e.event),
    onlineAtStart,
    gaps: gaps.filter((g) => g.from < to),
    lastSeenAt: device.lastSeenAt ?? null,
    helpRequests: help.length,
    tileLabels: Object.fromEntries((settings?.settings.tiles ?? []).map((t) => [t.id, t.label])),
  });
}

export const generateDue = internalMutation({
  args: { force: v.optional(v.boolean()) },
  returns: v.number(),
  handler: async (ctx, { force }) => {
    const tz = reportTimeZone();
    const now = Date.now();
    if (!force && !isReportTime(now, tz)) return 0;
    const week = localParts(now, tz).date;
    const devices = (await ctx.db.query("devices").take(50)).filter((d) => d.revokedAt === undefined);
    let made = 0;
    for (const device of devices) {
      const existing = await ctx.db
        .query("reports")
        .withIndex("by_device_and_week", (q) => q.eq("deviceId", device._id).eq("week", week))
        .first();
      if (existing) continue;
      const from = now - WEEK_MS;
      const text = await reportText(ctx, device, from, now, tz);
      const reportId = await ctx.db.insert("reports", { deviceId: device._id, week, from, to: now, text, createdAt: now });
      await ctx.scheduler.runAfter(0, internal.reports.send, { reportId });
      made++;
    }
    return made;
  },
});

export const reportById = internalQuery({
  args: { reportId: v.id("reports") },
  handler: async (ctx, { reportId }) => await ctx.db.get(reportId),
});

export const send = internalAction({
  args: { reportId: v.id("reports") },
  returns: v.null(),
  handler: async (ctx, { reportId }) => {
    const cfg = telegramConfig();
    if (!canSend(cfg)) {
      console.log(`Telegram not configured; report ${reportId} is only in the admin app.`);
      return null;
    }
    const report = await ctx.runQuery(internal.reports.reportById, { reportId });
    if (!report) return null;
    let sent = false;
    for (const chatId of cfg.adminIds) {
      try {
        await sendMessage(cfg.botToken, chatId, report.text);
        sent = true;
      } catch (err) {
        console.error(`Sending report ${reportId} to Telegram failed:`, err);
      }
    }
    if (sent) await ctx.runMutation(internal.reports.markSent, { reportId });
    return null;
  },
});

export const markSent = internalMutation({
  args: { reportId: v.id("reports") },
  returns: v.null(),
  handler: async (ctx, { reportId }) => {
    await ctx.db.patch(reportId, { telegramSentAt: Date.now() });
    return null;
  },
});

// Gaps older than the event retention aren't needed by any report.
export const purgeGaps = internalMutation({
  args: {},
  returns: v.number(),
  handler: async (ctx) => {
    const cutoff = Date.now() - RETENTION_MS;
    const old = await ctx.db
      .query("deviceGaps")
      .withIndex("by_creation_time", (q) => q.lt("_creationTime", cutoff))
      .take(200);
    for (const g of old) await ctx.db.delete(g._id);
    if (old.length === 200) await ctx.scheduler.runAfter(0, internal.reports.purgeGaps, {});
    return old.length;
  },
});

// ---- admin ------------------------------------------------------------------

export const list = query({
  args: { deviceId: v.id("devices"), limit: v.optional(v.number()) },
  handler: async (ctx, { deviceId, limit }) => {
    await requireAdmin(ctx);
    const n = Math.min(Math.max(limit ?? 20, 1), 100);
    const rows = await ctx.db
      .query("reports")
      .withIndex("by_device_and_week", (q) => q.eq("deviceId", deviceId))
      .order("desc")
      .take(n);
    return rows.map((r) => ({
      _id: r._id,
      week: r.week,
      from: r.from,
      to: r.to,
      text: r.text,
      createdAt: r.createdAt,
      telegramSentAt: r.telegramSentAt ?? null,
    }));
  },
});

// The report as it would read if it were sent now. Not stored.
export const preview = query({
  args: { deviceId: v.id("devices") },
  returns: v.union(v.null(), v.object({ text: v.string(), timeZone: v.string() })),
  handler: async (ctx, { deviceId }) => {
    await requireAdmin(ctx);
    const device = await ctx.db.get(deviceId as Id<"devices">);
    if (!device) return null;
    const tz = reportTimeZone();
    const now = Date.now();
    return { text: await reportText(ctx, device, now - WEEK_MS, now, tz), timeZone: tz };
  },
});
