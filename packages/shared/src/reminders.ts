import { z } from "zod";

// Reminders the helper sets in the admin app. momd gets them from Convex
// (`device.content`), keeps a copy in ~/.config/momos/reminders.json, and
// schedules them itself, so they still come up when the laptop is offline.
// Times are wall-clock times in the laptop's time zone.

export const ReminderId = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);
export const ClockTime = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/); // "14:00"
export const LocalDate = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/); // "2026-09-30"
export const Weekday = z.number().int().min(0).max(6); // 0 is Sunday

const ReminderBase = z.object({
  id: ReminderId,
  text: z.string().trim().min(1).max(80),
  time: ClockTime,
  // Minutes before `time` that it starts showing on the home screen card.
  // Null shows it all day.
  leadMinutes: z.number().int().min(0).max(24 * 60).nullable(),
});

export const Reminder = z.discriminatedUnion("repeat", [
  ReminderBase.extend({ repeat: z.literal("none"), date: LocalDate }),
  ReminderBase.extend({ repeat: z.literal("daily") }),
  ReminderBase.extend({ repeat: z.literal("weekly"), days: z.array(Weekday).min(1).max(7) }),
]);
export type Reminder = z.infer<typeof Reminder>;

export const MAX_REMINDERS = 50;

// One occurrence of a reminder as the shell shows it. momd computes these
// into state.json.
export const ReminderItem = z.object({
  key: z.string(), // `${id}@${at}`
  id: ReminderId,
  at: z.number(), // epoch ms
  label: z.string(), // "2:00 PM"
  text: z.string(),
});
export type ReminderItem = z.infer<typeof ReminderItem>;

// A photo for the screensaver. momd keeps ~/.local/share/momos/slideshow/
// matching this list.
export const SlideshowPhoto = z.object({
  id: z.string(),
  fileName: z.string().regex(/^[A-Za-z0-9_-]{1,80}\.jpg$/),
  url: z.url(),
});
export type SlideshowPhoto = z.infer<typeof SlideshowPhoto>;

export const MAX_SLIDESHOW_PHOTOS = 300;

// What `device.content` returns: everything for the device besides settings.
export const DeviceContent = z.object({
  reminders: z.array(Reminder).max(MAX_REMINDERS),
  slideshow: z.array(SlideshowPhoto).max(MAX_SLIDESHOW_PHOTOS),
});
export type DeviceContent = z.infer<typeof DeviceContent>;
