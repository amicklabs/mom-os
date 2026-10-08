import { z } from "zod";
import { ReminderItem } from "./reminders";

// Live state that momd writes to $XDG_RUNTIME_DIR/momos/state.json and the
// shell watches. Writes are atomic (write a temp file, then rename). If the file
// is missing or stale, the shell assumes momd is down and falls back to
// config.json alone.

export const Banner = z.object({
  id: z.string(),
  kind: z.enum(["message", "info", "warning"]),
  text: z.string().max(280),
  // Epoch ms. Null means it stays until dismissed or replaced.
  until: z.number().nullable(),
});
export type Banner = z.infer<typeof Banner>;

export const State = z.object({
  version: z.literal(1),
  updatedAt: z.number(), // epoch ms; the shell treats >30 s old as stale
  online: z.boolean().nullable(), // null = unknown
  wifi: z.object({ ssid: z.string().nullable(), signal: z.number().nullable() }).nullable(),
  battery: z.object({ percent: z.number(), charging: z.boolean() }).nullable(),
  // Someone is looking at her screen, over VNC or in a browser. `control`:
  // one of them can use her mouse and keyboard, which is always so over VNC.
  // Optional so older files parse.
  viewer: z.object({ connected: z.boolean(), since: z.number().nullable(), control: z.boolean().optional() }),
  // The last help request. "sending" starts once any picture of the screen
  // has been taken, so the shell knows it can show the pop-up again.
  // "offline" means it's waiting in momd's queue and goes by itself when the
  // internet is back; `queued` counts the requests waiting there. Optional so
  // older files still parse.
  help: z.object({
    status: z.enum(["idle", "sending", "sent", "failed", "offline"]),
    at: z.number().nullable(),
    queued: z.number().optional(),
  }),
  banner: Banner.nullable(),
  lid: z.object({ closed: z.boolean() }),
  convex: z.enum(["connected", "connecting", "disabled", "error"]),
  // `today`: reminders still to come today and past their lead time, for the
  // home screen card. `due`: reminders whose time has come and that she hasn't
  // pressed OK on, oldest first. Optional so older files still parse.
  reminders: z.object({ today: z.array(ReminderItem), due: z.array(ReminderItem) }).optional(),
  // Unread messages in Telegram Desktop, for the badge on the Telegram tile.
  // Missing until momd has heard from Telegram. Optional so older files parse.
  telegram: z.object({ unread: z.number().int().nonnegative() }).optional(),
});
export type State = z.infer<typeof State>;

export const STATE_STALE_MS = 30_000;
