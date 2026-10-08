import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { requireAdmin } from "./lib/auth";
import { MAX_SLIDESHOW_PHOTOS, SLIDESHOW_MAX_BYTES } from "./lib/content";

// Admin functions for the screensaver photos. The admin app resizes each photo
// to at most 1600 px on the long edge and uploads it as JPEG with
// admin.generateUploadUrl, then calls `add`.

export const list = query({
  args: { deviceId: v.id("devices") },
  handler: async (ctx, { deviceId }) => {
    await requireAdmin(ctx);
    const rows = await ctx.db
      .query("slideshowPhotos")
      .withIndex("by_device_and_createdAt", (q) => q.eq("deviceId", deviceId))
      .order("desc")
      .take(MAX_SLIDESHOW_PHOTOS);
    return await Promise.all(
      rows.map(async (p) => ({
        _id: p._id,
        fileName: p.fileName,
        addedBy: p.addedBy,
        createdAt: p.createdAt,
        url: await ctx.storage.getUrl(p.storageId),
      })),
    );
  },
});

function fileNameFor(now: number): string {
  const bytes = new Uint8Array(4);
  crypto.getRandomValues(bytes);
  const rand = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `p-${now.toString(36)}-${rand}.jpg`;
}

// Returns an error instead of throwing when the photo is refused, since a
// throw would roll back deleting the upload.
export const add = mutation({
  args: { deviceId: v.id("devices"), storageId: v.id("_storage") },
  returns: v.union(
    v.object({ ok: v.literal(true), photoId: v.id("slideshowPhotos") }),
    v.object({ ok: v.literal(false), error: v.string() }),
  ),
  handler: async (ctx, { deviceId, storageId }) => {
    const who = await requireAdmin(ctx);
    const reject = async (error: string) => {
      await ctx.storage.delete(storageId);
      return { ok: false as const, error };
    };
    if (!(await ctx.db.get(deviceId))) return await reject("Unknown device.");
    const meta = await ctx.db.system.get(storageId);
    // contentType comes from the upload's Content-Type header.
    const jpeg = meta?.contentType === undefined || meta.contentType === "image/jpeg";
    if (!meta || !jpeg || meta.size > SLIDESHOW_MAX_BYTES) {
      return await reject("Slideshow photos must be JPEG and under 3 MB.");
    }
    const count = (
      await ctx.db
        .query("slideshowPhotos")
        .withIndex("by_device_and_createdAt", (q) => q.eq("deviceId", deviceId))
        .take(MAX_SLIDESHOW_PHOTOS)
    ).length;
    if (count >= MAX_SLIDESHOW_PHOTOS) return await reject(`At most ${MAX_SLIDESHOW_PHOTOS} photos.`);
    const now = Date.now();
    const photoId = await ctx.db.insert("slideshowPhotos", {
      deviceId,
      storageId,
      fileName: fileNameFor(now),
      addedBy: who.email,
      createdAt: now,
    });
    return { ok: true as const, photoId };
  },
});

export const remove = mutation({
  args: { photoId: v.id("slideshowPhotos") },
  returns: v.null(),
  handler: async (ctx, { photoId }) => {
    await requireAdmin(ctx);
    const photo = await ctx.db.get(photoId);
    if (!photo) return null;
    await ctx.storage.delete(photo.storageId);
    await ctx.db.delete(photoId);
    return null;
  },
});
