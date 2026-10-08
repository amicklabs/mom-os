import { MAX_SLIDESHOW_PHOTOS, Reminder, type DeviceContent } from "@momos/shared";
import type { Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import type { ReminderFields } from "../validators";

// Reminders and slideshow photos: what a device gets from `device.content`.

export const SLIDESHOW_MAX_BYTES = 3 * 1024 * 1024;
export { MAX_SLIDESHOW_PHOTOS };

// Checks reminder fields with the shared zod schema. The id is a placeholder
// here; the document id becomes the real one.
export function parseReminder(input: ReminderFields): ReminderFields {
  const parsed = Reminder.safeParse({ ...input, id: "check" });
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new Error(`Invalid reminder: ${issue?.path.map(String).join(".") || "(root)"}: ${issue?.message}`);
  }
  const { id: _id, ...fields } = parsed.data;
  if (fields.repeat === "weekly") fields.days = [...new Set(fields.days)].sort((a, b) => a - b);
  return fields;
}

export async function remindersFor(ctx: Pick<QueryCtx, "db">, deviceId: Id<"devices">): Promise<Reminder[]> {
  const rows = await ctx.db
    .query("reminders")
    .withIndex("by_device", (q) => q.eq("deviceId", deviceId))
    .take(100);
  return rows.map((r) => ({ id: r._id, ...r.reminder }) as Reminder);
}

export async function slideshowFor(
  ctx: Pick<QueryCtx, "db" | "storage">,
  deviceId: Id<"devices">,
): Promise<DeviceContent["slideshow"]> {
  const rows = await ctx.db
    .query("slideshowPhotos")
    .withIndex("by_device_and_createdAt", (q) => q.eq("deviceId", deviceId))
    .take(MAX_SLIDESHOW_PHOTOS);
  const out = await Promise.all(
    rows.map(async (p) => {
      const url = await ctx.storage.getUrl(p.storageId);
      return url ? { id: p._id as string, fileName: p.fileName, url } : null;
    }),
  );
  return out.filter((p) => p !== null);
}
