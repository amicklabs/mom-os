import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import {
  actionValidator,
  deviceEventValidator,
  deviceStatusValidator,
  helpKindValidator,
  jobKindValidator,
  jobStatusValidator,
  reminderFieldsValidator,
  screenShareSessionValidator,
  settingsValidator,
  sourceValidator,
} from "./validators";

export default defineSchema({
  // One row per laptop. Only the SHA-256 of the device token is stored.
  devices: defineTable({
    name: v.string(),
    tokenHash: v.string(),
    createdAt: v.number(),
    revokedAt: v.optional(v.number()),
    status: v.optional(deviceStatusValidator),
    lastSeenAt: v.optional(v.number()),
  }).index("by_tokenHash", ["tokenHash"]),

  events: defineTable({
    deviceId: v.id("devices"),
    eventId: v.string(),
    at: v.number(),
    type: v.string(),
    event: deviceEventValidator,
  })
    .index("by_device_and_eventId", ["deviceId", "eventId"])
    .index("by_device_and_at", ["deviceId", "at"]),

  // One settings document per device, checked against the Settings zod schema
  // on every write. Family photos live in file storage.
  settings: defineTable({
    deviceId: v.id("devices"),
    settings: settingsValidator,
    photos: v.array(
      v.object({ memberId: v.string(), storageId: v.id("_storage"), fileName: v.string() }),
    ),
    updatedAt: v.number(),
  }).index("by_device", ["deviceId"]),

  helpRequests: defineTable({
    deviceId: v.id("devices"),
    createdAt: v.number(),
    screenshots: v.array(v.id("_storage")),
    // True while it has files, screenshots or a voice note, for the cleanup
    // cron to delete. False once they're gone.
    hasScreenshots: v.boolean(),
    context: deviceStatusValidator,
    // Why no fresh screenshot went with it, such as "screen was off".
    note: v.optional(v.string()),
    // What she asked for in the Help pop-up. Missing on requests from before
    // the pop-up, which were a screenshot and the ring buffer.
    kinds: v.optional(v.array(helpKindValidator)),
    // Her own words, typed in the pop-up.
    text: v.optional(v.string()),
    // Her voice note, Ogg Opus, and its length in seconds.
    voice: v.optional(v.id("_storage")),
    voiceSeconds: v.optional(v.number()),
    // When she pressed, if it waited in the laptop's queue while offline.
    askedAt: v.optional(v.number()),
    // When the helper tapped Got it.
    seenAt: v.optional(v.number()),
    // The job started for it automatically, when the helper's autoInvestigate
    // setting is on and she wrote or spoke.
    autoJobId: v.optional(v.id("jobs")),
    status: v.union(v.literal("open"), v.literal("answered"), v.literal("closed")),
    replies: v.array(
      v.object({ text: v.string(), at: v.number(), source: sourceValidator }),
    ),
    telegramNotifiedAt: v.optional(v.number()),
  })
    .index("by_device_and_createdAt", ["deviceId", "createdAt"])
    .index("by_status_and_createdAt", ["status", "createdAt"])
    .index("by_createdAt", ["createdAt"])
    .index("by_hasScreenshots_and_createdAt", ["hasScreenshots", "createdAt"]),

  // Allowlisted actions for momd. momd never runs anything else from Convex.
  actions: defineTable({
    deviceId: v.id("devices"),
    action: actionValidator,
    createdAt: v.number(),
    source: sourceValidator,
    status: v.union(v.literal("pending"), v.literal("done"), v.literal("failed")),
    completedAt: v.optional(v.number()),
    result: v.optional(v.string()),
    screenshot: v.optional(v.id("_storage")),
    // The ring buffer's pictures for a recent-screens action, oldest first,
    // with the time each was taken.
    screenshots: v.optional(v.array(v.object({ storageId: v.id("_storage"), takenAt: v.number() }))),
    helpRequestId: v.optional(v.id("helpRequests")),
    // Set when it was asked for on Telegram: the result, a refusal, or a
    // laptop that doesn't pick it up is reported back to that chat.
    telegram: v.optional(v.object({ chatId: v.string(), replyTo: v.optional(v.number()) })),
  })
    .index("by_device_and_status", ["deviceId", "status"])
    .index("by_device_and_createdAt", ["deviceId", "createdAt"])
    .index("by_createdAt", ["createdAt"]),

  jobs: defineTable({
    deviceId: v.id("devices"),
    kind: jobKindValidator,
    prompt: v.string(),
    helpRequestId: v.optional(v.id("helpRequests")),
    source: sourceValidator,
    status: jobStatusValidator,
    createdAt: v.number(),
    updatedAt: v.number(),
    workerId: v.optional(v.string()),
    leaseMs: v.optional(v.number()),
    leaseExpiresAt: v.optional(v.number()),
    sessionId: v.optional(v.string()),
    report: v.optional(v.string()),
    // How many times a worker's lease ran out on this job. After
    // MAX_LOST_LEASES (cleanup.ts) the job fails instead of going back to the queue.
    lostLeases: v.optional(v.number()),
    // A plain-language message for her that the agent suggests. The helper
    // decides whether to send it.
    suggestedMessage: v.optional(v.string()),
    // "Investigate more": the earlier job this follows, and the Claude session
    // the dispatcher resumes instead of starting a new one.
    parentJobId: v.optional(v.id("jobs")),
    resumeSessionId: v.optional(v.string()),
  })
    .index("by_status_and_createdAt", ["status", "createdAt"])
    .index("by_createdAt", ["createdAt"])
    .index("by_device_and_createdAt", ["deviceId", "createdAt"]),

  // Maps each bot message to what it was about, so a reply to it routes to the
  // right help request or job.
  telegramMessages: defineTable({
    chatId: v.string(),
    messageId: v.number(),
    // "restart" is the bot's "restart?" question. "reload" is its menu of her
    // pages to reload. "ask" is a question the helper answers by replying
    // (ForceReply); `ask` says what the answer is for.
    kind: v.union(v.literal("help"), v.literal("job"), v.literal("restart"), v.literal("reload"), v.literal("ask")),
    ask: v.optional(v.union(v.literal("investigate"), v.literal("more"), v.literal("say"))),
    deviceId: v.id("devices"),
    helpRequestId: v.optional(v.id("helpRequests")),
    jobId: v.optional(v.id("jobs")),
    sentAt: v.number(),
  })
    .index("by_chat_and_message", ["chatId", "messageId"])
    .index("by_helpRequest", ["helpRequestId"])
    .index("by_job", ["jobId"]),

  // Reminders for her screen. momd schedules them itself from the list.
  reminders: defineTable({
    deviceId: v.id("devices"),
    reminder: reminderFieldsValidator,
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_device", ["deviceId"]),

  // Screensaver photos, already resized to JPEG by the admin app.
  slideshowPhotos: defineTable({
    deviceId: v.id("devices"),
    storageId: v.id("_storage"),
    fileName: v.string(),
    addedBy: v.string(),
    createdAt: v.number(),
  }).index("by_device_and_createdAt", ["deviceId", "createdAt"]),

  // Stretches when a device sent nothing, recorded when it comes back. The
  // weekly report uses them for time offline and long silences.
  deviceGaps: defineTable({
    deviceId: v.id("devices"),
    from: v.number(),
    to: v.number(),
  }).index("by_device_and_to", ["deviceId", "to"]),

  // Weekly reports. Kept whether or not Telegram sent them.
  reports: defineTable({
    deviceId: v.id("devices"),
    // Local date of the Sunday it covers up to, in REPORT_TIMEZONE.
    week: v.string(),
    from: v.number(),
    to: v.number(),
    text: v.string(),
    createdAt: v.number(),
    telegramSentAt: v.optional(v.number()),
  })
    .index("by_device_and_week", ["deviceId", "week"])
    .index("by_createdAt", ["createdAt"]),

  // The browser screen-sharing session momd reports, one row per device.
  // `session` is null once it has ended, so the token doesn't outlive it.
  screenShares: defineTable({
    deviceId: v.id("devices"),
    session: v.union(screenShareSessionValidator, v.null()),
    updatedAt: v.number(),
  }).index("by_deviceId", ["deviceId"]),
});
