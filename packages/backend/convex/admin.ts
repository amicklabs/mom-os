import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { action, internalMutation, mutation, query, type QueryCtx } from "./_generated/server";
import { requireAdmin, sha256Hex, viewer } from "./lib/auth";
import { markHelpSeen as markSeen, queueAction as queue, replyToHelp as reply, screenshotUrls } from "./lib/actions";
import { investigateHelp as investigate, kindsOf } from "./lib/help";
import { approveJob as approve, cancelJob as cancel, createJob as create } from "./lib/jobs";
import { parseSettings, settingsFor, withPhotoUrls } from "./lib/settings";
import { actionValidator, jobKindValidator, settingsValidator } from "./validators";

// Functions the admin app calls. Auth is Clerk; the signed-in email must be in
// ADMIN_EMAILS.

const PHOTO_TYPES: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};
const MAX_PHOTO_BYTES = 5 * 1024 * 1024;

export const whoami = query({
  args: {},
  handler: async (ctx) => {
    const who = await viewer(ctx);
    return who ? { signedIn: true, email: who.email, isAdmin: who.isAdmin } : { signedIn: false, email: null, isAdmin: false };
  },
});

async function openHelpCount(ctx: QueryCtx, deviceId: Id<"devices">) {
  const open = await ctx.db
    .query("helpRequests")
    .withIndex("by_status_and_createdAt", (q) => q.eq("status", "open"))
    .order("desc")
    .take(100);
  return open.filter((h) => h.deviceId === deviceId).length;
}

export const overview = query({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);
    const devices = await ctx.db.query("devices").order("desc").take(50);
    const jobs = await ctx.db.query("jobs").withIndex("by_createdAt").order("desc").take(50);
    return await Promise.all(
      devices.map(async (d) => {
        const doc = await settingsFor(ctx, d._id);
        return {
          _id: d._id,
          name: d.name,
          personName: doc?.settings.person.name ?? null,
          createdAt: d.createdAt,
          revokedAt: d.revokedAt ?? null,
          lastSeenAt: d.lastSeenAt ?? null,
          status: d.status ?? null,
          openHelp: await openHelpCount(ctx, d._id),
          activeJobs: jobs.filter(
            (j) => j.deviceId === d._id && !["done", "failed", "cancelled"].includes(j.status),
          ).length,
        };
      }),
    );
  },
});

export const device = query({
  args: { deviceId: v.id("devices") },
  handler: async (ctx, { deviceId }) => {
    await requireAdmin(ctx);
    const d = await ctx.db.get(deviceId);
    if (!d) return null;
    const actions = await ctx.db
      .query("actions")
      .withIndex("by_device_and_createdAt", (q) => q.eq("deviceId", deviceId))
      .order("desc")
      .take(20);
    return {
      _id: d._id,
      name: d.name,
      createdAt: d.createdAt,
      revokedAt: d.revokedAt ?? null,
      lastSeenAt: d.lastSeenAt ?? null,
      status: d.status ?? null,
      actions: await Promise.all(
        actions.map(async (a) => ({
          ...a,
          screenshotUrl: a.screenshot ? await ctx.storage.getUrl(a.screenshot) : null,
        })),
      ),
    };
  },
});

export const events = query({
  args: { deviceId: v.id("devices"), paginationOpts: paginationOptsValidator },
  handler: async (ctx, { deviceId, paginationOpts }) => {
    await requireAdmin(ctx);
    return await ctx.db
      .query("events")
      .withIndex("by_device_and_at", (q) => q.eq("deviceId", deviceId))
      .order("desc")
      .paginate(paginationOpts);
  },
});

export const helpRequests = query({
  args: { deviceId: v.optional(v.id("devices")), limit: v.optional(v.number()) },
  handler: async (ctx, { deviceId, limit }) => {
    await requireAdmin(ctx);
    const n = Math.min(Math.max(limit ?? 30, 1), 100);
    const rows = deviceId
      ? await ctx.db
          .query("helpRequests")
          .withIndex("by_device_and_createdAt", (q) => q.eq("deviceId", deviceId))
          .order("desc")
          .take(n)
      : await ctx.db.query("helpRequests").withIndex("by_createdAt").order("desc").take(n);
    return await Promise.all(
      rows.map(async (h) => ({
        ...h,
        kinds: kindsOf(h),
        screenshotUrls: await screenshotUrls(ctx, h.screenshots),
        voiceUrl: h.voice ? await ctx.storage.getUrl(h.voice) : null,
      })),
    );
  },
});

export const jobs = query({
  args: { deviceId: v.optional(v.id("devices")), limit: v.optional(v.number()) },
  handler: async (ctx, { deviceId, limit }) => {
    await requireAdmin(ctx);
    const n = Math.min(Math.max(limit ?? 30, 1), 100);
    return deviceId
      ? await ctx.db
          .query("jobs")
          .withIndex("by_device_and_createdAt", (q) => q.eq("deviceId", deviceId))
          .order("desc")
          .take(n)
      : await ctx.db.query("jobs").withIndex("by_createdAt").order("desc").take(n);
  },
});

export const settings = query({
  args: { deviceId: v.id("devices") },
  handler: async (ctx, { deviceId }) => {
    await requireAdmin(ctx);
    const doc = await settingsFor(ctx, deviceId);
    if (!doc) return null;
    return { settings: doc.settings, photos: await withPhotoUrls(ctx, doc), updatedAt: doc.updatedAt };
  },
});

export const updateSettings = mutation({
  args: { deviceId: v.id("devices"), settings: settingsValidator },
  returns: v.null(),
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    if (!(await ctx.db.get(args.deviceId))) throw new Error("Unknown device.");
    const parsed = parseSettings(args.settings);
    const existing = await settingsFor(ctx, args.deviceId);
    const memberIds = new Set(parsed.family.map((m) => m.id));
    const photos = existing?.photos ?? [];
    const kept: Doc<"settings">["photos"] = [];
    for (const p of photos) {
      if (memberIds.has(p.memberId)) kept.push(p);
      else await ctx.storage.delete(p.storageId);
    }
    // A member with an uploaded photo always points at that file.
    for (const m of parsed.family) {
      const photo = kept.find((p) => p.memberId === m.id);
      if (photo) m.photo = photo.fileName;
    }
    const now = Date.now();
    if (existing) await ctx.db.patch(existing._id, { settings: parsed, photos: kept, updatedAt: now });
    else await ctx.db.insert("settings", { deviceId: args.deviceId, settings: parsed, photos: kept, updatedAt: now });
    return null;
  },
});

export const generateUploadUrl = mutation({
  args: {},
  returns: v.string(),
  handler: async (ctx) => {
    await requireAdmin(ctx);
    return await ctx.storage.generateUploadUrl();
  },
});

// Returns an error instead of throwing when the photo is refused, since a
// throw would roll back deleting the upload.
export const setFamilyPhoto = mutation({
  args: { deviceId: v.id("devices"), memberId: v.string(), storageId: v.id("_storage") },
  returns: v.union(
    v.object({ ok: v.literal(true), fileName: v.string() }),
    v.object({ ok: v.literal(false), error: v.string() }),
  ),
  handler: async (ctx, { deviceId, memberId, storageId }) => {
    await requireAdmin(ctx);
    const reject = async (error: string) => {
      await ctx.storage.delete(storageId);
      return { ok: false as const, error };
    };
    const doc = await settingsFor(ctx, deviceId);
    const member = doc?.settings.family.find((m) => m.id === memberId);
    if (!doc || !member) return await reject("Save the family member before adding a photo.");
    const meta = await ctx.db.system.get(storageId);
    const ext = meta?.contentType ? PHOTO_TYPES[meta.contentType] : undefined;
    if (!meta || !ext || meta.size > MAX_PHOTO_BYTES) return await reject("Photos must be JPEG, PNG or WebP and under 5 MB.");
    const fileName = `${memberId}.${ext}`;
    const photos = [];
    for (const p of doc.photos) {
      if (p.memberId === memberId) await ctx.storage.delete(p.storageId);
      else photos.push(p);
    }
    photos.push({ memberId, storageId, fileName });
    const settings = parseSettings({
      ...doc.settings,
      family: doc.settings.family.map((m) => (m.id === memberId ? { ...m, photo: fileName } : m)),
    });
    await ctx.db.patch(doc._id, { settings, photos, updatedAt: Date.now() });
    return { ok: true as const, fileName };
  },
});

export const removeFamilyPhoto = mutation({
  args: { deviceId: v.id("devices"), memberId: v.string() },
  returns: v.null(),
  handler: async (ctx, { deviceId, memberId }) => {
    await requireAdmin(ctx);
    const doc = await settingsFor(ctx, deviceId);
    if (!doc) return null;
    for (const p of doc.photos) if (p.memberId === memberId) await ctx.storage.delete(p.storageId);
    await ctx.db.patch(doc._id, {
      photos: doc.photos.filter((p) => p.memberId !== memberId),
      settings: {
        ...doc.settings,
        family: doc.settings.family.map((m) => (m.id === memberId ? { ...m, photo: null } : m)),
      },
      updatedAt: Date.now(),
    });
    return null;
  },
});

export const queueAction = mutation({
  args: { deviceId: v.id("devices"), action: actionValidator },
  returns: v.id("actions"),
  handler: async (ctx, { deviceId, action }) => {
    await requireAdmin(ctx);
    return await queue(ctx, { deviceId, action, source: "admin" });
  },
});

// The browser screen-sharing session for the Screen page: the address and
// token to connect with, whether the viewer may use her mouse and keyboard,
// and when it ends. Null when none is running. The token only works over the
// tailnet, and only until the session ends.
export const screenShare = query({
  args: { deviceId: v.id("devices") },
  handler: async (ctx, { deviceId }) => {
    await requireAdmin(ctx);
    const row = await ctx.db
      .query("screenShares")
      .withIndex("by_deviceId", (q) => q.eq("deviceId", deviceId))
      .unique();
    return row?.session ? { ...row.session, updatedAt: row.updatedAt } : null;
  },
});

export function newToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return "momos_" + btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// An action rather than a mutation, so the token comes from a real random
// source. The plaintext token is returned once and never stored.
export const createDevice = action({
  args: { name: v.string() },
  returns: v.object({ deviceId: v.id("devices"), token: v.string() }),
  handler: async (ctx, { name }): Promise<{ deviceId: Id<"devices">; token: string }> => {
    await requireAdmin(ctx);
    const trimmed = name.trim();
    if (!trimmed || trimmed.length > 64) throw new Error("Give the device a name up to 64 characters.");
    const token = newToken();
    const deviceId: Id<"devices"> = await ctx.runMutation(internal.admin.insertDevice, {
      name: trimmed,
      tokenHash: await sha256Hex(token),
    });
    return { deviceId, token };
  },
});

export const insertDevice = internalMutation({
  args: { name: v.string(), tokenHash: v.string() },
  returns: v.id("devices"),
  handler: async (ctx, args) => {
    return await ctx.db.insert("devices", { ...args, createdAt: Date.now() });
  },
});

export const revokeDevice = mutation({
  args: { deviceId: v.id("devices") },
  returns: v.null(),
  handler: async (ctx, { deviceId }) => {
    await requireAdmin(ctx);
    const d = await ctx.db.get(deviceId);
    if (!d) throw new Error("Unknown device.");
    if (d.revokedAt === undefined) await ctx.db.patch(deviceId, { revokedAt: Date.now() });
    // Forget any screen-sharing token it reported.
    const share = await ctx.db
      .query("screenShares")
      .withIndex("by_deviceId", (q) => q.eq("deviceId", deviceId))
      .unique();
    if (share?.session) await ctx.db.patch(share._id, { session: null, updatedAt: Date.now() });
    return null;
  },
});

export const createJob = mutation({
  args: {
    deviceId: v.id("devices"),
    kind: jobKindValidator,
    prompt: v.string(),
    helpRequestId: v.optional(v.id("helpRequests")),
  },
  returns: v.id("jobs"),
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    return await create(ctx, { ...args, source: "admin" });
  },
});

export const approveJob = mutation({
  args: { jobId: v.id("jobs") },
  returns: v.null(),
  handler: async (ctx, { jobId }) => {
    await requireAdmin(ctx);
    await approve(ctx, jobId);
    return null;
  },
});

export const cancelJob = mutation({
  args: { jobId: v.id("jobs") },
  returns: v.null(),
  handler: async (ctx, { jobId }) => {
    await requireAdmin(ctx);
    await cancel(ctx, jobId);
    return null;
  },
});

export const replyToHelp = mutation({
  args: { helpRequestId: v.id("helpRequests"), text: v.string() },
  returns: v.id("actions"),
  handler: async (ctx, { helpRequestId, text }) => {
    await requireAdmin(ctx);
    return await reply(ctx, { helpRequestId, text, source: "admin" });
  },
});

export const closeHelpRequest = mutation({
  args: { helpRequestId: v.id("helpRequests") },
  returns: v.null(),
  handler: async (ctx, { helpRequestId }) => {
    await requireAdmin(ctx);
    const help = await ctx.db.get(helpRequestId);
    if (!help) throw new Error("Help request not found.");
    await ctx.db.patch(helpRequestId, { status: "closed" });
    return null;
  },
});

// "Got it": her screen says the helper saw her message.
export const markHelpSeen = mutation({
  args: { helpRequestId: v.id("helpRequests") },
  returns: v.object({ already: v.boolean() }),
  handler: async (ctx, { helpRequestId }) => {
    await requireAdmin(ctx);
    return await markSeen(ctx, { helpRequestId, source: "admin" });
  },
});

// A read-only agent for a help request, with her words as the problem, unless
// one is already looking at it.
export const investigateHelp = mutation({
  args: { helpRequestId: v.id("helpRequests"), instructions: v.optional(v.string()) },
  returns: v.object({ jobId: v.id("jobs"), created: v.boolean() }),
  handler: async (ctx, { helpRequestId, instructions }) => {
    await requireAdmin(ctx);
    return await investigate(ctx, { helpRequestId, instructions, source: "admin" });
  },
});
