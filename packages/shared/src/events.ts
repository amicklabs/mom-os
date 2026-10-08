import { z } from "zod";

// Events momd records locally (SQLite) and uploads to Convex in batches.
// `at` is the time on the laptop when it happened, so events recorded while
// offline keep their real order.

const base = { id: z.string(), at: z.number() };

export const DeviceEvent = z.discriminatedUnion("type", [
  z.object({ ...base, type: z.literal("boot") }),
  z.object({ ...base, type: z.literal("app"), app: z.string().nullable(), title: z.null().optional() }),
  z.object({ ...base, type: z.literal("network"), online: z.boolean(), ssid: z.string().nullable(), signal: z.number().nullable(), dns: z.boolean().nullable() }),
  z.object({ ...base, type: z.literal("power"), percent: z.number(), charging: z.boolean() }),
  // `via`: the VNC port or a browser session. `control`: a viewer can use her
  // mouse and keyboard. Both optional, since older momd didn't send them.
  z.object({ ...base, type: z.literal("viewer"), connected: z.boolean(), control: z.boolean().optional(), via: z.enum(["vnc", "web"]).optional() }),
  z.object({ ...base, type: z.literal("help"), stage: z.enum(["pressed", "sent", "failed"]) }),
  z.object({ ...base, type: z.literal("lid"), closed: z.boolean() }),
  z.object({ ...base, type: z.literal("sleep"), stage: z.enum(["suspend", "resume"]) }),
  z.object({ ...base, type: z.literal("lock"), locked: z.boolean() }),
  z.object({ ...base, type: z.literal("action"), actionId: z.string(), action: z.string(), ok: z.boolean() }),
  z.object({ ...base, type: z.literal("health"), report: z.record(z.string(), z.unknown()) }),
  z.object({ ...base, type: z.literal("error"), source: z.string(), message: z.string().max(2000) }),
  // A reminder came up on her screen, or she pressed OK on it. `due` is the
  // time it was set for.
  z.object({ ...base, type: z.literal("reminder"), reminderId: z.string(), due: z.number(), stage: z.enum(["shown", "ok"]) }),
]);
export type DeviceEvent = z.infer<typeof DeviceEvent>;

// Heartbeat payload, sent every 60 s and on any change.
export const DeviceStatus = z.object({
  at: z.number(),
  app: z.string().nullable(), // tile id or window class of the focused app, never a window title
  online: z.boolean(),
  wifi: z.object({ ssid: z.string().nullable(), signal: z.number().nullable() }).nullable(),
  battery: z.object({ percent: z.number(), charging: z.boolean() }).nullable(),
  viewer: z.boolean(),
  // A viewer can use her mouse and keyboard. Optional for older momd.
  viewerControl: z.boolean().optional(),
  locked: z.boolean(),
  lidClosed: z.boolean(),
  version: z.string(),
});
export type DeviceStatus = z.infer<typeof DeviceStatus>;
