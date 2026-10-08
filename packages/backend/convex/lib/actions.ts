import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { isReloadable } from "@momos/shared";
import { parseAction, settingsFor } from "./settings";

export const SAY_MAX = 280;
// How long an action asked for on Telegram may sit unpicked before the helper
// hears that the laptop hasn't answered. momd picks actions up within seconds
// when it's online.
export const ACTION_WAIT_MS = 90_000;

export type TelegramTarget = { chatId: string; replyTo?: number };

export async function queueAction(
  ctx: MutationCtx,
  args: {
    deviceId: Id<"devices">;
    action: unknown;
    source: Doc<"actions">["source"];
    helpRequestId?: Id<"helpRequests">;
    // Report the result, a refusal or a laptop that doesn't answer to this chat.
    telegram?: TelegramTarget;
  },
): Promise<Id<"actions">> {
  const device = await ctx.db.get(args.deviceId);
  if (!device) throw new Error("Unknown device.");
  if (device.revokedAt !== undefined) throw new Error("Device revoked.");
  const action = parseAction(args.action);
  // Screen sharing only starts from the admin app, never from Telegram or the
  // dispatcher.
  if (action.type === "screen-share" && args.source !== "admin") {
    throw new Error("Screen sharing can only be started from the admin app.");
  }
  if (action.type === "open") {
    const doc = await settingsFor(ctx, args.deviceId);
    if (doc && !doc.settings.tiles.some((t) => t.id === action.tileId)) {
      throw new Error(`No tile with id ${action.tileId}.`);
    }
  }
  if (action.type === "reload") {
    // Only one of her own tiles, and only a web page. Without settings there
    // are no tiles to check against, so nothing is accepted.
    const tile = (await settingsFor(ctx, args.deviceId))?.settings.tiles.find((t) => t.id === action.tileId);
    if (!tile) throw new Error(`No tile with id ${action.tileId}.`);
    if (!isReloadable(tile)) throw new Error(`${tile.label} isn't a web page, so it can't be reloaded.`);
  }
  const actionId = await ctx.db.insert("actions", {
    deviceId: args.deviceId,
    action,
    createdAt: Date.now(),
    source: args.source,
    status: "pending",
    helpRequestId: args.helpRequestId,
    ...(args.telegram ? { telegram: args.telegram } : {}),
  });
  if (args.telegram) {
    await ctx.scheduler.runAfter(ACTION_WAIT_MS, internal.telegram.checkAction, { actionId });
  }
  return actionId;
}

// Puts the helper's reply on her screen as a `say` action and records it on the
// help request.
export async function replyToHelp(
  ctx: MutationCtx,
  args: {
    helpRequestId: Id<"helpRequests">;
    text: string;
    source: Doc<"actions">["source"];
    telegram?: TelegramTarget;
  },
): Promise<Id<"actions">> {
  const help = await ctx.db.get(args.helpRequestId);
  if (!help) throw new Error("Help request not found.");
  const text = args.text.trim().slice(0, SAY_MAX);
  if (!text) throw new Error("Reply is empty.");
  const actionId = await queueAction(ctx, {
    deviceId: help.deviceId,
    action: { type: "say", text },
    source: args.source,
    helpRequestId: help._id,
    telegram: args.telegram,
  });
  await ctx.db.patch(help._id, {
    status: help.status === "closed" ? "closed" : "answered",
    replies: [...help.replies, { text, at: Date.now(), source: args.source }],
  });
  return actionId;
}

// "Got it": her screen says the helper saw her message.
export async function markHelpSeen(
  ctx: MutationCtx,
  args: { helpRequestId: Id<"helpRequests">; source: Doc<"actions">["source"]; telegram?: TelegramTarget },
): Promise<{ already: boolean }> {
  const help = await ctx.db.get(args.helpRequestId);
  if (!help) throw new Error("Help request not found.");
  if (help.seenAt !== undefined) return { already: true };
  await queueAction(ctx, {
    deviceId: help.deviceId,
    action: { type: "help-seen" },
    source: args.source,
    helpRequestId: help._id,
    telegram: args.telegram,
  });
  await ctx.db.patch(help._id, {
    seenAt: Date.now(),
    status: help.status === "open" ? "answered" : help.status,
  });
  return { already: false };
}

export async function screenshotUrls(
  ctx: Pick<QueryCtx, "storage">,
  ids: Id<"_storage">[],
): Promise<string[]> {
  const urls = await Promise.all(ids.map((id) => ctx.storage.getUrl(id)));
  return urls.filter((u): u is string => u !== null);
}
