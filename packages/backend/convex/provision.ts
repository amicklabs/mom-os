import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { internalAction, internalMutation, internalQuery } from "./_generated/server";
import { newToken } from "./admin";
import { sha256Hex } from "./lib/auth";
import { parseSettings, settingsFor } from "./lib/settings";

// Device provisioning from the command line, for when the admin app can't
// sign in yet. Internal functions, so only someone with deploy access to the
// Convex project can run them:
//
//   npx convex run provision:createDevice '{"name":"mom"}'
//
// `mom devices create <name>` wraps this.

export const createDevice = internalAction({
  args: { name: v.string(), settings: v.optional(v.any()) },
  returns: v.object({ deviceId: v.id("devices"), token: v.string() }),
  handler: async (ctx, { name, settings }): Promise<{ deviceId: Id<"devices">; token: string }> => {
    const trimmed = name.trim();
    if (!trimmed || trimmed.length > 64) throw new Error("Give the device a name up to 64 characters.");
    // Check the settings before creating anything.
    const parsed = settings === undefined ? null : parseSettings(stripLocal(settings));
    const token = newToken();
    const deviceId: Id<"devices"> = await ctx.runMutation(internal.admin.insertDevice, {
      name: trimmed,
      tokenHash: await sha256Hex(token),
    });
    if (parsed) await ctx.runMutation(internal.provision.saveSettings, { deviceId, settings: parsed });
    return { deviceId, token };
  },
});

// Replace a device's settings (tiles, family, names), keeping uploaded photos.
export const saveSettings = internalMutation({
  args: { deviceId: v.id("devices"), settings: v.any() },
  returns: v.null(),
  handler: async (ctx, { deviceId, settings }) => {
    if (!(await ctx.db.get(deviceId))) throw new Error("Unknown device.");
    const parsed = parseSettings(stripLocal(settings));
    const existing = await settingsFor(ctx, deviceId);
    const now = Date.now();
    if (existing) await ctx.db.patch(existing._id, { settings: parsed, updatedAt: now });
    else await ctx.db.insert("settings", { deviceId, settings: parsed, photos: [], updatedAt: now });
    return null;
  },
});

export const listDevices = internalQuery({
  args: {},
  handler: async (ctx) => {
    const devices = await ctx.db.query("devices").take(100);
    return devices.map((d) => ({
      _id: d._id,
      name: d.name,
      createdAt: d.createdAt,
      revoked: d.revokedAt !== undefined,
      lastSeenAt: d.lastSeenAt ?? null,
    }));
  },
});

// The laptop's config.json carries a "local" block (Convex URL, token file)
// that never belongs in Convex.
function stripLocal(input: unknown): unknown {
  if (!input || typeof input !== "object" || Array.isArray(input)) return input;
  const { local: _local, ...rest } = input as Record<string, unknown>;
  return rest;
}
