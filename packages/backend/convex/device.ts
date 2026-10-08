import { v } from "convex/values";
import { helpNote, helpText, RECENT_SCREENS, ScreenShareSession, VOICE_MAX_BYTES, VOICE_MAX_SECONDS } from "@momos/shared";
import { internal } from "./_generated/api";
import { mutation, query } from "./_generated/server";
import { requireDevice } from "./lib/auth";
import { remindersFor, slideshowFor } from "./lib/content";
import { markSeen } from "./lib/gaps";
import { investigateHelp } from "./lib/help";
import { settingsFor, withPhotoUrls } from "./lib/settings";
import {
  actionValidator,
  deviceEventValidator,
  deviceStatusValidator,
  helpKindValidator,
  reminderValidator,
  screenShareSessionValidator,
  settingsValidator,
} from "./validators";

// Functions momd calls. Every one takes the device token; the server looks up
// its SHA-256 and rejects unknown or revoked devices.

const MAX_EVENTS = 100;
const MAX_HELP_SCREENSHOTS = 11;
// A queued help request older than this is the laptop's clock, not hers.
const MAX_QUEUED_MS = 7 * 24 * 60 * 60_000;

export const heartbeat = mutation({
  args: { deviceToken: v.string(), status: deviceStatusValidator },
  returns: v.object({ serverTime: v.number() }),
  handler: async (ctx, { deviceToken, status }) => {
    const device = await requireDevice(ctx, deviceToken);
    const now = Date.now();
    await markSeen(ctx, device, now, status);
    return { serverTime: now };
  },
});

export const ingestEvents = mutation({
  args: { deviceToken: v.string(), events: v.array(deviceEventValidator) },
  returns: v.object({ accepted: v.number() }),
  handler: async (ctx, { deviceToken, events }) => {
    const device = await requireDevice(ctx, deviceToken);
    if (events.length > MAX_EVENTS) throw new Error(`At most ${MAX_EVENTS} events per call.`);
    let accepted = 0;
    const seen = new Set<string>();
    for (const event of events) {
      if (seen.has(event.id)) continue;
      seen.add(event.id);
      const existing = await ctx.db
        .query("events")
        .withIndex("by_device_and_eventId", (q) => q.eq("deviceId", device._id).eq("eventId", event.id))
        .first();
      if (existing) continue;
      await ctx.db.insert("events", {
        deviceId: device._id,
        eventId: event.id,
        at: event.at,
        type: event.type,
        event,
      });
      accepted++;
    }
    await markSeen(ctx, device, Date.now());
    return { accepted };
  },
});

export const settings = query({
  args: { deviceToken: v.string() },
  returns: v.union(
    v.null(),
    v.object({
      ...settingsValidator.fields,
      photos: v.array(v.object({ id: v.string(), fileName: v.string(), url: v.string() })),
      updatedAt: v.number(),
    }),
  ),
  handler: async (ctx, { deviceToken }) => {
    const device = await requireDevice(ctx, deviceToken);
    const doc = await settingsFor(ctx, device._id);
    if (!doc) return null;
    return { ...doc.settings, photos: await withPhotoUrls(ctx, doc), updatedAt: doc.updatedAt };
  },
});

// Reminders and slideshow photos. Kept apart from settings so either can change
// without rewriting config.json, and so they work before settings are saved.
export const content = query({
  args: { deviceToken: v.string() },
  returns: v.object({
    reminders: v.array(reminderValidator),
    slideshow: v.array(v.object({ id: v.string(), fileName: v.string(), url: v.string() })),
  }),
  handler: async (ctx, { deviceToken }) => {
    const device = await requireDevice(ctx, deviceToken);
    return { reminders: await remindersFor(ctx, device._id), slideshow: await slideshowFor(ctx, device._id) };
  },
});

export const pendingActions = query({
  args: { deviceToken: v.string() },
  returns: v.array(v.object({ _id: v.id("actions"), action: actionValidator, createdAt: v.number() })),
  handler: async (ctx, { deviceToken }) => {
    const device = await requireDevice(ctx, deviceToken);
    const rows = await ctx.db
      .query("actions")
      .withIndex("by_device_and_status", (q) => q.eq("deviceId", device._id).eq("status", "pending"))
      .take(50);
    return rows.map((r) => ({ _id: r._id, action: r.action, createdAt: r.createdAt }));
  },
});

export const completeAction = mutation({
  args: {
    deviceToken: v.string(),
    actionId: v.id("actions"),
    ok: v.boolean(),
    result: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, { deviceToken, actionId, ok, result }) => {
    const device = await requireDevice(ctx, deviceToken);
    const action = await ctx.db.get(actionId);
    if (!action || action.deviceId !== device._id) throw new Error("Action not found.");
    if (action.status !== "pending") return null;
    await ctx.db.patch(actionId, {
      status: ok ? "done" : "failed",
      completedAt: Date.now(),
      result: result?.slice(0, 2000),
    });
    // Asked for on Telegram: the pictures, or why it didn't happen, go back.
    if (action.telegram) await ctx.scheduler.runAfter(0, internal.telegram.sendActionResult, { actionId });
    return null;
  },
});

export const generateUploadUrl = mutation({
  args: { deviceToken: v.string() },
  returns: v.string(),
  handler: async (ctx, { deviceToken }) => {
    await requireDevice(ctx, deviceToken);
    return await ctx.storage.generateUploadUrl();
  },
});

export const createHelpRequest = mutation({
  args: {
    deviceToken: v.string(),
    // A picture of the screen, when she asked for one. Older momd also sent
    // the ring buffer here; new ones never do.
    screenshots: v.array(v.id("_storage")),
    context: deviceStatusValidator,
    // Why no fresh screenshot went with it, such as "screen was off".
    note: v.optional(v.string()),
    // What she asked for in the pop-up. Missing from older momd.
    kinds: v.optional(v.array(helpKindValidator)),
    text: v.optional(v.string()),
    voice: v.optional(v.id("_storage")),
    voiceSeconds: v.optional(v.number()),
    // When she pressed, for a request that waited in the laptop's queue.
    askedAt: v.optional(v.number()),
  },
  returns: v.object({ helpRequestId: v.id("helpRequests") }),
  handler: async (ctx, args) => {
    const { deviceToken, screenshots, context, note, kinds, text, voice, voiceSeconds, askedAt } = args;
    const device = await requireDevice(ctx, deviceToken);
    if (screenshots.length > MAX_HELP_SCREENSHOTS) {
      throw new Error(`At most ${MAX_HELP_SCREENSHOTS} screenshots.`);
    }
    if (voice) {
      const meta = await ctx.db.system.get(voice);
      if (!meta || meta.size > VOICE_MAX_BYTES) throw new Error("The voice note is missing or too big.");
    }
    const now = Date.now();
    const words = helpText(text);
    const helpRequestId = await ctx.db.insert("helpRequests", {
      deviceId: device._id,
      createdAt: now,
      screenshots,
      // Files for the cleanup cron to delete after 60 days.
      hasScreenshots: screenshots.length > 0 || voice !== undefined,
      context,
      note: helpNote(note),
      ...(kinds ? { kinds: [...new Set(kinds)] } : {}),
      ...(words ? { text: words } : {}),
      ...(voice
        ? { voice, voiceSeconds: Math.max(0, Math.min(VOICE_MAX_SECONDS + 5, Math.round(voiceSeconds ?? 0))) }
        : {}),
      ...(askedAt !== undefined && askedAt < now - 60_000 && askedAt > now - MAX_QUEUED_MS ? { askedAt } : {}),
      status: "open",
      replies: [],
    });
    await markSeen(ctx, device, now, context);
    // The helper decides whether to send an agent: she often uses Help to
    // talk to him. With autoInvestigate on, her words or voice start one
    // straight away, as before. It only looks; a fix still waits for approval.
    const auto = (await settingsFor(ctx, device._id))?.settings.helper.autoInvestigate === true;
    if (auto && (words || voice)) {
      const { jobId } = await investigateHelp(ctx, { helpRequestId, source: "device" });
      await ctx.db.patch(helpRequestId, { autoJobId: jobId });
    }
    await ctx.scheduler.runAfter(0, internal.telegram.sendHelp, { helpRequestId });
    return { helpRequestId };
  },
});

export const attachScreenshot = mutation({
  args: { deviceToken: v.string(), actionId: v.id("actions"), storageId: v.id("_storage") },
  returns: v.null(),
  handler: async (ctx, { deviceToken, actionId, storageId }) => {
    const device = await requireDevice(ctx, deviceToken);
    const action = await ctx.db.get(actionId);
    if (!action || action.deviceId !== device._id || action.action.type !== "screenshot") {
      throw new Error("Screenshot action not found.");
    }
    if (action.screenshot) await ctx.storage.delete(action.screenshot);
    await ctx.db.patch(actionId, { screenshot: storageId });
    return null;
  },
});

// The ring buffer's pictures, for a recent-screens action.
export const attachScreens = mutation({
  args: {
    deviceToken: v.string(),
    actionId: v.id("actions"),
    screens: v.array(v.object({ storageId: v.id("_storage"), takenAt: v.number() })),
  },
  returns: v.null(),
  handler: async (ctx, { deviceToken, actionId, screens }) => {
    const device = await requireDevice(ctx, deviceToken);
    const action = await ctx.db.get(actionId);
    if (!action || action.deviceId !== device._id || action.action.type !== "recent-screens") {
      throw new Error("Recent-screens action not found.");
    }
    if (screens.length > RECENT_SCREENS) throw new Error(`At most ${RECENT_SCREENS} pictures.`);
    for (const old of action.screenshots ?? []) await ctx.storage.delete(old.storageId);
    await ctx.db.patch(actionId, { screenshots: [...screens].sort((a, b) => a.takenAt - b.takenAt) });
    return null;
  },
});

// The browser screen-sharing session, after a screen-share action started,
// changed or ended it, when it timed out, and whenever momd connects. Null
// means none is running.
export const reportScreenShare = mutation({
  args: { deviceToken: v.string(), session: v.union(screenShareSessionValidator, v.null()) },
  returns: v.null(),
  handler: async (ctx, { deviceToken, session }) => {
    const device = await requireDevice(ctx, deviceToken);
    if (session !== null && !ScreenShareSession.safeParse(session).success) {
      throw new Error("Invalid screen-share session.");
    }
    const row = await ctx.db
      .query("screenShares")
      .withIndex("by_deviceId", (q) => q.eq("deviceId", device._id))
      .unique();
    if (row) await ctx.db.patch(row._id, { session, updatedAt: Date.now() });
    else await ctx.db.insert("screenShares", { deviceId: device._id, session, updatedAt: Date.now() });
    return null;
  },
});
