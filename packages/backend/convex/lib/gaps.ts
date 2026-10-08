import type { Doc } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import type { DeviceStatusDoc } from "../validators";

// A silence longer than this is recorded as a gap: the laptop was asleep, off,
// or without internet. Heartbeats come every minute while it's up.
export const GAP_MIN_MS = 15 * 60_000;

// Marks the device as heard from now. A long silence before this call is
// stored in deviceGaps for the weekly report.
export async function markSeen(
  ctx: MutationCtx,
  device: Doc<"devices">,
  now: number,
  status?: DeviceStatusDoc,
): Promise<void> {
  if (device.lastSeenAt !== undefined && now - device.lastSeenAt > GAP_MIN_MS) {
    await ctx.db.insert("deviceGaps", { deviceId: device._id, from: device.lastSeenAt, to: now });
  }
  await ctx.db.patch(device._id, status ? { status, lastSeenAt: now } : { lastSeenAt: now });
}
