import { MAX_REMINDERS } from "@momos/shared";
import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { requireAdmin } from "./lib/auth";
import { parseReminder, remindersFor } from "./lib/content";
import { reminderFieldsValidator } from "./validators";

// Admin functions for her reminders. Auth is the same as admin.ts.

export const list = query({
  args: { deviceId: v.id("devices") },
  handler: async (ctx, { deviceId }) => {
    await requireAdmin(ctx);
    return await remindersFor(ctx, deviceId);
  },
});

export const save = mutation({
  args: {
    deviceId: v.id("devices"),
    reminderId: v.optional(v.id("reminders")),
    reminder: reminderFieldsValidator,
  },
  returns: v.id("reminders"),
  handler: async (ctx, { deviceId, reminderId, reminder }) => {
    await requireAdmin(ctx);
    const device = await ctx.db.get(deviceId);
    if (!device) throw new Error("Unknown device.");
    const fields = parseReminder(reminder);
    const now = Date.now();
    if (reminderId) {
      const existing = await ctx.db.get(reminderId);
      if (!existing || existing.deviceId !== deviceId) throw new Error("Reminder not found.");
      await ctx.db.patch(reminderId, { reminder: fields, updatedAt: now });
      return reminderId;
    }
    const count = (await ctx.db.query("reminders").withIndex("by_device", (q) => q.eq("deviceId", deviceId)).take(MAX_REMINDERS)).length;
    if (count >= MAX_REMINDERS) throw new Error(`At most ${MAX_REMINDERS} reminders.`);
    return await ctx.db.insert("reminders", { deviceId, reminder: fields, createdAt: now, updatedAt: now });
  },
});

export const remove = mutation({
  args: { reminderId: v.id("reminders") },
  returns: v.null(),
  handler: async (ctx, { reminderId }) => {
    await requireAdmin(ctx);
    if (await ctx.db.get(reminderId)) await ctx.db.delete(reminderId);
    return null;
  },
});
