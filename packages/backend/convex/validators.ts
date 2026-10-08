import { v, type Infer } from "convex/values";

// Convex validators that mirror the zod schemas in @momos/shared. Convex checks
// the shape at the boundary; the zod schemas add the finer rules (regexes,
// lengths, https-only URLs) inside the mutations that store settings and
// actions.

const nullish = <T extends Parameters<typeof v.optional>[0]>(inner: T) =>
  v.optional(v.union(inner, v.null()));

const tileBase = {
  id: v.string(),
  label: v.string(),
  icon: nullish(v.string()),
};

export const tileValidator = v.union(
  v.object({ ...tileBase, type: v.literal("webapp"), url: v.string() }),
  v.object({ ...tileBase, type: v.literal("app"), app: v.string() }),
  v.object({ ...tileBase, type: v.literal("telegram-chat"), telegram: v.string() }),
  v.object({ ...tileBase, type: v.literal("page"), page: v.string() }),
);

export const familyMemberValidator = v.object({
  id: v.string(),
  name: v.string(),
  photo: nullish(v.string()),
  telegram: v.string(),
});

export const settingsValidator = v.object({
  person: v.object({
    name: v.string(),
    user: v.string(),
    phone: nullish(v.string()),
    telegram: nullish(v.string()),
  }),
  helper: v.object({
    name: v.string(),
    phone: v.string(),
    telegram: nullish(v.string()),
    autoInvestigate: nullish(v.boolean()),
  }),
  tiles: v.array(tileValidator),
  family: v.array(familyMemberValidator),
});
export type SettingsDoc = Infer<typeof settingsValidator>;

export const actionValidator = v.union(
  v.object({ type: v.literal("say"), text: v.string(), seconds: nullish(v.number()) }),
  v.object({ type: v.literal("home") }),
  v.object({ type: v.literal("open"), tileId: v.string() }),
  v.object({ type: v.literal("lock") }),
  v.object({ type: v.literal("screenshot") }),
  v.object({ type: v.literal("restart") }),
  v.object({ type: v.literal("recent-screens") }),
  v.object({ type: v.literal("help-seen") }),
  v.object({ type: v.literal("reload"), tileId: v.string() }),
  v.object({
    type: v.literal("screen-share"),
    op: v.union(v.literal("start"), v.literal("stop")),
    control: v.optional(v.boolean()),
    minutes: v.optional(v.number()),
  }),
);

// A browser screen-sharing session, as momd reports it (ScreenShareSession in
// @momos/shared).
export const screenShareSessionValidator = v.object({
  url: v.string(),
  token: v.string(),
  control: v.boolean(),
  startedAt: v.number(),
  expiresAt: v.number(),
  served: v.boolean(),
});

export const helpKindValidator = v.union(
  v.literal("message"),
  v.literal("screenshot"),
  v.literal("call-me"),
  v.literal("voice"),
);

// A reminder as stored, without its id (the document id is the id).
const reminderBase = {
  text: v.string(),
  time: v.string(),
  leadMinutes: v.union(v.number(), v.null()),
};
export const reminderFieldsValidator = v.union(
  v.object({ ...reminderBase, repeat: v.literal("none"), date: v.string() }),
  v.object({ ...reminderBase, repeat: v.literal("daily") }),
  v.object({ ...reminderBase, repeat: v.literal("weekly"), days: v.array(v.number()) }),
);
export type ReminderFields = Infer<typeof reminderFieldsValidator>;

export const reminderValidator = v.union(
  v.object({ id: v.string(), ...reminderBase, repeat: v.literal("none"), date: v.string() }),
  v.object({ id: v.string(), ...reminderBase, repeat: v.literal("daily") }),
  v.object({ id: v.string(), ...reminderBase, repeat: v.literal("weekly"), days: v.array(v.number()) }),
);

const wifiValidator = v.union(
  v.object({ ssid: v.union(v.string(), v.null()), signal: v.union(v.number(), v.null()) }),
  v.null(),
);
const batteryValidator = v.union(v.object({ percent: v.number(), charging: v.boolean() }), v.null());

export const deviceStatusValidator = v.object({
  at: v.number(),
  app: v.union(v.string(), v.null()),
  online: v.boolean(),
  wifi: wifiValidator,
  battery: batteryValidator,
  viewer: v.boolean(),
  viewerControl: v.optional(v.boolean()),
  locked: v.boolean(),
  lidClosed: v.boolean(),
  version: v.string(),
});
export type DeviceStatusDoc = Infer<typeof deviceStatusValidator>;

const eventBase = { id: v.string(), at: v.number() };

export const deviceEventValidator = v.union(
  v.object({ ...eventBase, type: v.literal("boot") }),
  v.object({ ...eventBase, type: v.literal("app"), app: v.union(v.string(), v.null()), title: v.optional(v.null()) }),
  v.object({
    ...eventBase,
    type: v.literal("network"),
    online: v.boolean(),
    ssid: v.union(v.string(), v.null()),
    signal: v.union(v.number(), v.null()),
    dns: v.union(v.boolean(), v.null()),
  }),
  v.object({ ...eventBase, type: v.literal("power"), percent: v.number(), charging: v.boolean() }),
  v.object({
    ...eventBase,
    type: v.literal("viewer"),
    connected: v.boolean(),
    control: v.optional(v.boolean()),
    via: v.optional(v.union(v.literal("vnc"), v.literal("web"))),
  }),
  v.object({ ...eventBase, type: v.literal("help"), stage: v.union(v.literal("pressed"), v.literal("sent"), v.literal("failed")) }),
  v.object({ ...eventBase, type: v.literal("lid"), closed: v.boolean() }),
  v.object({ ...eventBase, type: v.literal("sleep"), stage: v.union(v.literal("suspend"), v.literal("resume")) }),
  v.object({ ...eventBase, type: v.literal("lock"), locked: v.boolean() }),
  v.object({ ...eventBase, type: v.literal("action"), actionId: v.string(), action: v.string(), ok: v.boolean() }),
  v.object({ ...eventBase, type: v.literal("health"), report: v.record(v.string(), v.any()) }),
  v.object({ ...eventBase, type: v.literal("error"), source: v.string(), message: v.string() }),
  v.object({
    ...eventBase,
    type: v.literal("reminder"),
    reminderId: v.string(),
    due: v.number(),
    stage: v.union(v.literal("shown"), v.literal("ok")),
  }),
);
export type DeviceEventDoc = Infer<typeof deviceEventValidator>;

export const jobKindValidator = v.union(v.literal("investigate"), v.literal("fix"));

export const JOB_STATUSES = [
  "queued",
  "investigating",
  "awaiting_approval",
  "approved",
  "fixing",
  "done",
  "failed",
  "cancelled",
] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

export const jobStatusValidator = v.union(
  v.literal("queued"),
  v.literal("investigating"),
  v.literal("awaiting_approval"),
  v.literal("approved"),
  v.literal("fixing"),
  v.literal("done"),
  v.literal("failed"),
  v.literal("cancelled"),
);

// "device": started by her own help request (auto-investigate).
export const sourceValidator = v.union(
  v.literal("admin"),
  v.literal("telegram"),
  v.literal("dispatcher"),
  v.literal("device"),
);
