import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalMutation } from "./_generated/server";

export const RETENTION_MS = 60 * 24 * 60 * 60_000;
const BATCH = 200;
export const MAX_LOST_LEASES = 3;

// Deletes events older than 60 days, by arrival time on the server.
export const purgeEvents = internalMutation({
  args: {},
  returns: v.number(),
  handler: async (ctx) => {
    const cutoff = Date.now() - RETENTION_MS;
    const old = await ctx.db
      .query("events")
      .withIndex("by_creation_time", (q) => q.lt("_creationTime", cutoff))
      .take(BATCH);
    for (const e of old) await ctx.db.delete(e._id);
    if (old.length === BATCH) await ctx.scheduler.runAfter(0, internal.cleanup.purgeEvents, {});
    return old.length;
  },
});

// Deletes help screenshots and voice notes older than 60 days. The help
// request itself stays, with her words, without the files.
export const purgeHelpScreenshots = internalMutation({
  args: {},
  returns: v.number(),
  handler: async (ctx) => {
    const cutoff = Date.now() - RETENTION_MS;
    const old = await ctx.db
      .query("helpRequests")
      .withIndex("by_hasScreenshots_and_createdAt", (q) => q.eq("hasScreenshots", true).lt("createdAt", cutoff))
      .take(BATCH / 10);
    for (const h of old) {
      for (const id of h.screenshots) await ctx.storage.delete(id);
      if (h.voice) await ctx.storage.delete(h.voice);
      await ctx.db.patch(h._id, { screenshots: [], voice: undefined, hasScreenshots: false });
    }
    if (old.length === BATCH / 10) await ctx.scheduler.runAfter(0, internal.cleanup.purgeHelpScreenshots, {});
    return old.length;
  },
});

// Old actions go too, with any screenshot taken for them, and so do the
// Telegram message links.
export const purgeActions = internalMutation({
  args: {},
  returns: v.number(),
  handler: async (ctx) => {
    const cutoff = Date.now() - RETENTION_MS;
    const old = await ctx.db
      .query("actions")
      .withIndex("by_createdAt", (q) => q.lt("createdAt", cutoff))
      .take(BATCH);
    for (const a of old) {
      if (a.screenshot) await ctx.storage.delete(a.screenshot);
      for (const s of a.screenshots ?? []) await ctx.storage.delete(s.storageId);
      await ctx.db.delete(a._id);
    }
    const links = await ctx.db
      .query("telegramMessages")
      .withIndex("by_creation_time", (q) => q.lt("_creationTime", cutoff))
      .take(BATCH);
    for (const l of links) await ctx.db.delete(l._id);
    if (old.length === BATCH || links.length === BATCH) {
      await ctx.scheduler.runAfter(0, internal.cleanup.purgeActions, {});
    }
    return old.length;
  },
});

// A worker that dies mid-job leaves its lease to run out. The job goes back to
// the state it was claimed from, so another worker can pick it up. A job that
// keeps losing its worker (a crash it causes, say) fails after MAX_LOST_LEASES
// instead of looping forever.
export const releaseExpiredLeases = internalMutation({
  args: {},
  returns: v.number(),
  handler: async (ctx) => {
    const now = Date.now();
    let released = 0;
    for (const [status, back] of [
      ["investigating", "queued"],
      ["fixing", "approved"],
    ] as const) {
      const jobs = await ctx.db
        .query("jobs")
        .withIndex("by_status_and_createdAt", (q) => q.eq("status", status))
        .take(100);
      for (const job of jobs) {
        if ((job.leaseExpiresAt ?? 0) > now) continue;
        const lostLeases = (job.lostLeases ?? 0) + 1;
        if (lostLeases >= MAX_LOST_LEASES) {
          const why = `The dispatcher lost this job ${lostLeases} times while ${status}, so it was stopped.`;
          await ctx.db.patch(job._id, {
            status: "failed",
            lostLeases,
            workerId: undefined,
            leaseExpiresAt: undefined,
            updatedAt: now,
            report: job.report ? `${job.report}\n\n${why}` : why,
          });
          await ctx.scheduler.runAfter(0, internal.telegram.sendJobReport, { jobId: job._id });
        } else {
          await ctx.db.patch(job._id, {
            status: back,
            lostLeases,
            workerId: undefined,
            leaseExpiresAt: undefined,
            updatedAt: now,
          });
        }
        released++;
      }
    }
    return released;
  },
});
