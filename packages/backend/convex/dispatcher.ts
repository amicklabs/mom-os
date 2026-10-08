import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { requireDispatcher } from "./lib/auth";
import { screenshotUrls } from "./lib/actions";
import { isOnline } from "./lib/format";
import { kindsOf } from "./lib/help";
import { approveJob as approve, claimJob as claim, createJob as create, updateJob as update } from "./lib/jobs";
import { settingsFor } from "./lib/settings";
import { jobKindValidator, jobStatusValidator } from "./validators";

// Functions the dispatcher calls. Every one takes the dispatcher token,
// compared in constant time with DISPATCHER_TOKEN.

export const pendingJobs = query({
  args: { dispatcherToken: v.string() },
  handler: async (ctx, { dispatcherToken }) => {
    await requireDispatcher(dispatcherToken);
    const queued = await ctx.db
      .query("jobs")
      .withIndex("by_status_and_createdAt", (q) => q.eq("status", "queued"))
      .take(50);
    const approved = await ctx.db
      .query("jobs")
      .withIndex("by_status_and_createdAt", (q) => q.eq("status", "approved"))
      .take(50);
    const jobs = [...queued, ...approved].sort((a, b) => a.createdAt - b.createdAt);
    return await Promise.all(
      jobs.map(async (job) => {
        const device = await ctx.db.get(job.deviceId);
        const settings = await settingsFor(ctx, job.deviceId);
        const help = job.helpRequestId ? await ctx.db.get(job.helpRequestId) : null;
        return {
          ...job,
          deviceName: device?.name ?? null,
          personName: settings?.settings.person.name ?? null,
          helperName: settings?.settings.helper.name ?? null,
          helpRequest: help
            ? {
                createdAt: help.createdAt,
                askedAt: help.askedAt ?? null,
                context: help.context,
                replies: help.replies,
                kinds: kindsOf(help),
                text: help.text ?? null,
                hasVoice: help.voice !== undefined,
                voiceSeconds: help.voiceSeconds ?? null,
                note: help.note ?? null,
                screenshotUrls: await screenshotUrls(ctx, help.screenshots),
              }
            : null,
        };
      }),
    );
  },
});

export const claimJob = mutation({
  args: { dispatcherToken: v.string(), jobId: v.id("jobs"), workerId: v.string(), leaseMs: v.number() },
  returns: v.boolean(),
  handler: async (ctx, { dispatcherToken, ...args }) => {
    await requireDispatcher(dispatcherToken);
    return await claim(ctx, args);
  },
});

export const updateJob = mutation({
  args: {
    dispatcherToken: v.string(),
    jobId: v.id("jobs"),
    workerId: v.string(),
    status: jobStatusValidator,
    report: v.optional(v.string()),
    sessionId: v.optional(v.string()),
    // A plain-language message for her, from the agent's report.
    suggestedMessage: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, { dispatcherToken, ...args }) => {
    await requireDispatcher(dispatcherToken);
    await update(ctx, args);
    return null;
  },
});

export const overview = query({
  args: { dispatcherToken: v.string() },
  handler: async (ctx, { dispatcherToken }) => {
    await requireDispatcher(dispatcherToken);
    const now = Date.now();
    const devices = (await ctx.db.query("devices").take(50)).filter((d) => d.revokedAt === undefined);
    const openHelp = await ctx.db
      .query("helpRequests")
      .withIndex("by_status_and_createdAt", (q) => q.eq("status", "open"))
      .order("desc")
      .take(20);
    const jobs = await ctx.db.query("jobs").withIndex("by_createdAt").order("desc").take(20);
    return {
      devices: await Promise.all(
        devices.map(async (d) => ({
          _id: d._id,
          name: d.name,
          personName: (await settingsFor(ctx, d._id))?.settings.person.name ?? null,
          online: isOnline(d.lastSeenAt, now),
          lastSeenAt: d.lastSeenAt ?? null,
          status: d.status ?? null,
        })),
      ),
      helpRequests: await Promise.all(
        openHelp.map(async (h) => ({
          _id: h._id,
          deviceId: h.deviceId,
          createdAt: h.createdAt,
          context: h.context,
          kinds: kindsOf(h),
          text: h.text ?? null,
          hasVoice: h.voice !== undefined,
          screenshotUrls: await screenshotUrls(ctx, h.screenshots),
        })),
      ),
      jobs,
    };
  },
});

export const createJob = mutation({
  args: {
    dispatcherToken: v.string(),
    deviceId: v.id("devices"),
    kind: jobKindValidator,
    prompt: v.string(),
    helpRequestId: v.optional(v.id("helpRequests")),
  },
  returns: v.id("jobs"),
  handler: async (ctx, { dispatcherToken, ...args }) => {
    await requireDispatcher(dispatcherToken);
    return await create(ctx, { ...args, source: "dispatcher" });
  },
});

export const approveJob = mutation({
  args: { dispatcherToken: v.string(), jobId: v.id("jobs") },
  returns: v.null(),
  handler: async (ctx, { dispatcherToken, jobId }) => {
    await requireDispatcher(dispatcherToken);
    await approve(ctx, jobId);
    return null;
  },
});
