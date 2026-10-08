import { v, type Infer } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { internalAction, internalMutation, internalQuery, type ActionCtx, type MutationCtx } from "./_generated/server";
import { markHelpSeen, queueAction, replyToHelp, SAY_MAX, type TelegramTarget } from "./lib/actions";
import { investigateHelp, investigateMore, kindsOf } from "./lib/help";
import { ago, contextLine, isOnline, statusLines, TELEGRAM_TEXT_LIMIT, truncate } from "./lib/format";
import { approveJob, cancelJob, createJob, isTerminal } from "./lib/jobs";
import { isReloadable } from "@momos/shared";
import { personName, settingsFor } from "./lib/settings";
import {
  adminAppUrl,
  answerCallbackQuery,
  canSend,
  editButtons,
  sendMessage,
  sendPhotos,
  sendVoice,
  telegramConfig,
  type Button,
} from "./lib/telegramApi";

// The Telegram side of MomOS: help messages, job reports and action results
// out; the helper's replies, commands and button taps in. When the Telegram
// variables are missing, sending logs and does nothing, and the webhook
// refuses requests.
//
// Incoming messages and button taps are decided in a mutation (route,
// callback), which returns a Plan: what to answer. The webhook sends it and
// records which bot message is about what, so a later reply or tap finds it.

// ---- plans ------------------------------------------------------------------

const linkValidator = v.object({
  kind: v.union(v.literal("help"), v.literal("job"), v.literal("restart"), v.literal("reload"), v.literal("ask")),
  ask: v.optional(v.union(v.literal("investigate"), v.literal("more"), v.literal("say"))),
  deviceId: v.id("devices"),
  helpRequestId: v.optional(v.id("helpRequests")),
  jobId: v.optional(v.id("jobs")),
});
export type Link = Infer<typeof linkValidator>;

const buttonsValidator = v.array(v.array(v.object({ text: v.string(), data: v.optional(v.string()), url: v.optional(v.string()) })));

const outValidator = v.object({
  text: v.string(),
  replyTo: v.optional(v.number()),
  buttons: v.optional(buttonsValidator),
  forceReply: v.optional(v.string()),
  link: v.optional(linkValidator),
});
export type Out = Infer<typeof outValidator>;

export const planValidator = v.object({
  // A short notice on the helper's screen after a button tap.
  toast: v.optional(v.string()),
  messages: v.array(outValidator),
  // Take the buttons off the message whose button was tapped.
  clearButtons: v.optional(v.boolean()),
});
export type Plan = Infer<typeof planValidator>;

const say = (text: string, replyTo?: number, extra: Partial<Out> = {}): Plan => ({
  messages: [{ text, ...(replyTo ? { replyTo } : {}), ...extra }],
});

// Sends a plan's messages to one chat and records their links. Used by the
// webhook and by the scheduled senders.
export async function deliver(
  ctx: Pick<ActionCtx, "runMutation">,
  token: string,
  chatId: string,
  messages: Out[],
): Promise<void> {
  for (const m of messages) {
    try {
      const id = await sendMessage(token, chatId, truncate(m.text, TELEGRAM_TEXT_LIMIT), {
        replyTo: m.replyTo,
        buttons: m.buttons,
        forceReply: m.forceReply,
      });
      if (m.link) await ctx.runMutation(internal.telegram.recordMessages, { chatId, messageIds: [id], ...m.link });
    } catch (err) {
      console.error("Sending on Telegram failed:", err);
    }
  }
}

// ---- help messages ----------------------------------------------------------

// Every button's data is "<verb>:<id>", well inside Telegram's 64 bytes. No
// agent starts on its own: Send an agent asks for a note first. Watch <person>'s
// screen links to the admin app's Screen page when ADMIN_APP_URL is set.
// Older help messages still carry inv, invi and say buttons, which keep working.
export function helpButtons(helpRequestId: string, person: string, adminUrl: string | null = null): Button[][] {
  return [
    [
      { text: "Send an agent", data: `agent:${helpRequestId}` },
      { text: `Message ${person}'s screen`, data: `say:${helpRequestId}` },
    ],
    [
      { text: "Screenshot", data: `shot:${helpRequestId}` },
      { text: "Last 10 minutes", data: `last:${helpRequestId}` },
    ],
    adminUrl
      ? [
          { text: "Reload a page", data: `rldm:${helpRequestId}` },
          { text: `Watch ${person}'s screen`, url: `${adminUrl}/screen` },
        ]
      : [{ text: "Reload a page", data: `rldm:${helpRequestId}` }],
    [
      { text: `Call ${person}`, data: `call:${helpRequestId}` },
      { text: "Got it", data: `got:${helpRequestId}` },
    ],
    [
      { text: `Restart ${person}'s laptop`, data: `rst:${helpRequestId}` },
      { text: "Done", data: `done:${helpRequestId}` },
    ],
  ];
}

export const helpPayload = internalQuery({
  args: { helpRequestId: v.id("helpRequests") },
  handler: async (ctx, { helpRequestId }) => {
    const help = await ctx.db.get(helpRequestId);
    if (!help) return null;
    const device = await ctx.db.get(help.deviceId);
    if (!device) return null;
    const settings = await settingsFor(ctx, device._id);
    return {
      deviceId: device._id,
      person: settings?.settings.person.name ?? device.name,
      helper: settings?.settings.helper.name ?? null,
      createdAt: help.createdAt,
      context: help.context,
      note: help.note ?? null,
      kinds: help.kinds ?? null,
      text: help.text ?? null,
      voice: help.voice ?? null,
      voiceSeconds: help.voiceSeconds ?? null,
      askedAt: help.askedAt ?? null,
      autoJob: help.autoJobId !== undefined,
      screenshots: help.screenshots,
    };
  },
});

type HelpKindList = NonNullable<Doc<"helpRequests">["kinds"]>;

export function helpHeadline(person: string, kinds: HelpKindList | null): string {
  if (kinds?.includes("call-me")) return `${person} asked you to call`;
  if (kinds?.includes("voice")) return `${person} sent a voice note`;
  return `${person} needs help`;
}

export function helpMessageText(p: {
  person: string;
  context: Parameters<typeof contextLine>[0];
  note?: string | null;
  kinds: HelpKindList | null;
  text?: string | null;
  voiceSeconds?: number | null;
  hasVoice?: boolean;
  hasScreenshot?: boolean;
  askedAt?: number | null;
  createdAt?: number;
  autoJob?: boolean;
}): string {
  const kinds = p.kinds;
  const headline = helpHeadline(p.person, kinds);
  const lines = [headline];
  if (p.text) lines.push("", ...p.text.split("\n").map((l, i, all) => `${i === 0 ? "“" : ""}${l}${i === all.length - 1 ? "”" : ""}`));
  const extra: string[] = [];
  if (kinds?.includes("call-me") && !headline.includes("call")) extra.push(`${p.person} would like you to call.`);
  if (p.hasVoice) {
    const secs = p.voiceSeconds ? ` (${p.voiceSeconds} s)` : "";
    extra.push(
      headline.includes("voice note")
        ? `The voice note${secs} is below. There's no transcript.`
        : `${p.person} also sent a voice note${secs}, below. There's no transcript.`,
    );
  }
  if (p.hasScreenshot) extra.push(`${p.person}'s screen is below.`);
  else if (kinds?.includes("screenshot")) extra.push(`${p.person} asked to show you the screen, but no picture came with it.`);
  if (p.note) extra.push(noteLine(p.note));
  if (p.askedAt && p.createdAt && p.createdAt - p.askedAt > 60_000) {
    extra.push(`${p.person} asked ${ago(p.createdAt - p.askedAt)}, while the laptop was offline.`);
  }
  if (extra.length) lines.push("", ...extra);
  lines.push("", contextLine(p.context));
  if (p.autoJob) lines.push("", "An agent is looking into it. Its report will come here.");
  return lines.join("\n");
}

// "screen was off" reads as "Note: the screen was off, so there's no fresh
// picture." Anything else momd sends is shown as it came.
export function noteLine(note: string): string {
  const off = /^screen was off(?::\s*(.*))?$/i.exec(note);
  if (off) return `Note: the screen was off${off[1] ? ` (${off[1]})` : ""}, so there's no fresh picture.`;
  return `Note: ${note}`;
}

export const sendHelp = internalAction({
  args: { helpRequestId: v.id("helpRequests") },
  returns: v.null(),
  handler: async (ctx, { helpRequestId }) => {
    const cfg = telegramConfig();
    if (!canSend(cfg)) {
      console.log(`Telegram not configured; help request ${helpRequestId} not sent.`);
      return null;
    }
    const p = await ctx.runQuery(internal.telegram.helpPayload, { helpRequestId });
    if (!p) return null;
    const blobs = (await Promise.all(p.screenshots.map((id) => ctx.storage.get(id)))).filter(
      (b): b is Blob => b !== null,
    );
    const voice = p.voice ? await ctx.storage.get(p.voice) : null;
    const text = helpMessageText({ ...p, hasVoice: voice !== null, hasScreenshot: blobs.length > 0 });
    for (const chatId of cfg.adminIds) {
      const messageIds: number[] = [];
      try {
        const textId = await sendMessage(cfg.botToken, chatId, truncate(text, TELEGRAM_TEXT_LIMIT), {
          buttons: helpButtons(helpRequestId, p.person, adminAppUrl()),
        });
        messageIds.push(textId);
        if (blobs.length) messageIds.push(...(await sendPhotos(cfg.botToken, chatId, blobs, textId)));
        if (voice) {
          messageIds.push(
            await sendVoice(cfg.botToken, chatId, voice, { replyTo: textId, duration: p.voiceSeconds ?? undefined }),
          );
        }
      } catch (err) {
        console.error(`Sending help request ${helpRequestId} to Telegram failed:`, err);
      }
      if (messageIds.length) {
        await ctx.runMutation(internal.telegram.recordMessages, {
          chatId,
          messageIds,
          kind: "help",
          deviceId: p.deviceId,
          helpRequestId,
        });
      }
    }
    return null;
  },
});

// ---- job reports ------------------------------------------------------------

export const jobPayload = internalQuery({
  args: { jobId: v.id("jobs") },
  handler: async (ctx, { jobId }) => {
    const job = await ctx.db.get(jobId);
    if (!job) return null;
    const device = await ctx.db.get(job.deviceId);
    return { job, person: device ? await personName(ctx, device) : "Unknown device" };
  },
});

// The bot message a report about this job should reply to in a chat: her help
// message, or the message that started the job or the job it follows.
export const replyTarget = internalQuery({
  args: { chatId: v.string(), jobId: v.id("jobs") },
  returns: v.union(v.number(), v.null()),
  handler: async (ctx, { chatId, jobId }) => {
    const job = await ctx.db.get(jobId);
    if (!job) return null;
    if (job.helpRequestId) {
      const links = await ctx.db
        .query("telegramMessages")
        .withIndex("by_helpRequest", (q) => q.eq("helpRequestId", job.helpRequestId))
        .take(20);
      const help = links.filter((l) => l.chatId === chatId && l.kind === "help").sort((a, b) => a.messageId - b.messageId)[0];
      if (help) return help.messageId;
    }
    for (const id of [jobId, job.parentJobId]) {
      if (!id) continue;
      const links = await ctx.db
        .query("telegramMessages")
        .withIndex("by_job", (q) => q.eq("jobId", id))
        .take(20);
      const link = links.filter((l) => l.chatId === chatId).sort((a, b) => a.messageId - b.messageId)[0];
      if (link) return link.messageId;
    }
    return null;
  },
});

const STATUS_HEADLINE: Record<string, string> = {
  awaiting_approval: "has a report and a proposed fix",
  done: "is done",
  failed: "failed",
};

export function jobReportText(p: {
  person: string;
  job: { _id: string; kind: string; status: string; report?: string; suggestedMessage?: string };
}) {
  const head = `Agent job for ${p.person} (${p.job.kind}) ${STATUS_HEADLINE[p.job.status] ?? p.job.status}.`;
  const suggestion = p.job.suggestedMessage ? `\n\nSuggested message for ${p.person}: “${p.job.suggestedMessage}”` : "";
  const tail =
    p.job.status === "awaiting_approval" ? `\n\nTap Approve fix, or reply "go" to this message.` : "";
  const body = p.job.report?.trim() ? `\n\n${p.job.report.trim()}` : "";
  const room = TELEGRAM_TEXT_LIMIT - head.length - suggestion.length - tail.length;
  return head + truncate(body, room) + suggestion + tail;
}

export function jobButtons(
  person: string,
  job: { _id: string; status: string; sessionId?: string; report?: string; suggestedMessage?: string },
): Button[][] {
  const rows: Button[][] = [];
  if (job.status === "awaiting_approval") rows.push([{ text: "Approve fix", data: `apv:${job._id}` }]);
  if (job.sessionId || job.report) rows.push([{ text: "Investigate more", data: `more:${job._id}` }]);
  if (job.suggestedMessage) rows.push([{ text: `Send this to ${person}`, data: `send:${job._id}` }]);
  rows.push([{ text: "Dismiss", data: `dis:${job._id}` }]);
  return rows;
}

export const sendJobReport = internalAction({
  args: { jobId: v.id("jobs") },
  returns: v.null(),
  handler: async (ctx, { jobId }) => {
    const cfg = telegramConfig();
    if (!canSend(cfg)) {
      console.log(`Telegram not configured; report for job ${jobId} not sent.`);
      return null;
    }
    const payload = await ctx.runQuery(internal.telegram.jobPayload, { jobId });
    if (!payload) return null;
    for (const chatId of cfg.adminIds) {
      try {
        const replyTo = await ctx.runQuery(internal.telegram.replyTarget, { chatId, jobId });
        const id = await sendMessage(cfg.botToken, chatId, jobReportText(payload), {
          replyTo: replyTo ?? undefined,
          buttons: jobButtons(payload.person, payload.job),
        });
        await ctx.runMutation(internal.telegram.recordMessages, {
          chatId,
          messageIds: [id],
          kind: "job",
          deviceId: payload.job.deviceId,
          jobId,
        });
      } catch (err) {
        console.error(`Sending job ${jobId} report to Telegram failed:`, err);
      }
    }
    return null;
  },
});

// ---- action results ---------------------------------------------------------

export const actionPayload = internalQuery({
  args: { actionId: v.id("actions") },
  handler: async (ctx, { actionId }) => {
    const action = await ctx.db.get(actionId);
    if (!action) return null;
    const device = await ctx.db.get(action.deviceId);
    const tileId = "tileId" in action.action ? action.action.tileId : null;
    const tiles = tileId ? ((await settingsFor(ctx, action.deviceId))?.settings.tiles ?? []) : [];
    return {
      action,
      person: device ? await personName(ctx, device) : "the laptop",
      lastSeenAt: device?.lastSeenAt ?? null,
      tileLabel: tiles.find((t) => t.id === tileId)?.label ?? tileId,
    };
  },
});

const ACTION_LABEL: Record<string, string> = {
  say: "Your message",
  screenshot: "The screenshot",
  "recent-screens": "The last 10 minutes",
  restart: "The restart",
  "help-seen": "Got it",
  home: "Going home",
  open: "Opening the app",
  lock: "Locking",
  "screen-share": "Screen sharing",
  reload: "The reload",
};

export function actionFailedText(person: string, type: string, result: string | undefined): string {
  const label = ACTION_LABEL[type] ?? `The ${type} action`;
  return `${label} didn't happen on ${person}'s laptop: ${result?.trim() || "no reason given"}`;
}

export function actionWaitingText(person: string, type: string, lastSeenAt: number | null, now: number): string {
  const label = ACTION_LABEL[type] ?? `The ${type} action`;
  const seen = lastSeenAt === null ? "It hasn't been heard from yet." : isOnline(lastSeenAt, now)
    ? `It was heard from ${ago(now - lastSeenAt)}, so momd may be stuck.`
    : `It looks offline; it was last heard from ${ago(now - lastSeenAt)}.`;
  const after =
    type === "restart"
      ? " A restart that waits more than 10 minutes is refused, so send it again when the laptop is back."
      : type === "reload"
        ? " A reload that waits more than 10 minutes is refused, so send it again when the laptop is back."
        : " It stays queued and happens when the laptop is back.";
  return `${label} hasn't reached ${person}'s laptop yet. ${seen}${after}`;
}

// The result of an action asked for on Telegram: pictures, or why not.
export const sendActionResult = internalAction({
  args: { actionId: v.id("actions") },
  returns: v.null(),
  handler: async (ctx, { actionId }) => {
    const cfg = telegramConfig();
    if (!canSend(cfg)) return null;
    const p = await ctx.runQuery(internal.telegram.actionPayload, { actionId });
    if (!p?.action.telegram || p.action.status === "pending") return null;
    const { action, person } = p;
    const { chatId, replyTo } = action.telegram!;
    const type = action.action.type;
    const text = async (t: string) => {
      await sendMessage(cfg.botToken, chatId, truncate(t, TELEGRAM_TEXT_LIMIT), { replyTo });
    };
    try {
      if (action.status === "failed") {
        await text(actionFailedText(person, type, action.result));
      } else if (type === "screenshot") {
        const blob = action.screenshot ? await ctx.storage.get(action.screenshot) : null;
        const note = action.result ? ` (${action.result})` : "";
        if (blob) await sendPhotos(cfg.botToken, chatId, [blob], replyTo, [`${person}'s screen now${note}.`]);
        else await text(`The screenshot from ${person}'s laptop didn't arrive.`);
      } else if (type === "recent-screens") {
        const shots = action.screenshots ?? [];
        const blobs = await Promise.all(shots.map((s) => ctx.storage.get(s.storageId)));
        const kept = shots.map((s, i) => ({ s, blob: blobs[i] })).filter((x): x is { s: typeof x.s; blob: Blob } => !!x.blob);
        if (!kept.length) {
          await text(`No pictures from the last few minutes on ${person}'s laptop. ${action.result ?? ""}`.trim());
          return null;
        }
        const at = action.completedAt ?? Date.now();
        const captions = kept.map(({ s }, i) => {
          const when = at - s.takenAt < 60_000 ? "just now" : ago(at - s.takenAt);
          return i === 0 ? `${person}'s screen, oldest first. This one: ${when}.` : when;
        });
        await sendPhotos(cfg.botToken, chatId, kept.map((k) => k.blob), replyTo, captions);
      } else if (type === "restart") {
        await text(`${person}'s laptop is restarting (${action.result ?? "now"}). It should be back in a minute or two.`);
      } else if (type === "reload") {
        await text(reloadDoneText(person, p.tileLabel ?? "the page", action.result));
      }
    } catch (err) {
      console.error(`Sending the result of action ${actionId} to Telegram failed:`, err);
    }
    return null;
  },
});

export function reloadDoneText(person: string, label: string, result: string | undefined): string {
  if (result?.includes("wasn't open")) return `${label} wasn't open on ${person}'s laptop, so it opened fresh.`;
  return `Reloaded ${label} on ${person}'s laptop.`;
}

// Runs ACTION_WAIT_MS after an action from Telegram was queued.
export const checkAction = internalAction({
  args: { actionId: v.id("actions") },
  returns: v.null(),
  handler: async (ctx, { actionId }) => {
    const cfg = telegramConfig();
    if (!canSend(cfg)) return null;
    const p = await ctx.runQuery(internal.telegram.actionPayload, { actionId });
    if (!p?.action.telegram || p.action.status !== "pending") return null;
    try {
      await sendMessage(
        cfg.botToken,
        p.action.telegram.chatId,
        actionWaitingText(p.person, p.action.action.type, p.lastSeenAt, Date.now()),
        { replyTo: p.action.telegram.replyTo },
      );
    } catch (err) {
      console.error(`Telling Telegram about waiting action ${actionId} failed:`, err);
    }
    return null;
  },
});

// ---- links ------------------------------------------------------------------

const recordArgs = v.object({
  chatId: v.string(),
  messageIds: v.array(v.number()),
  kind: v.union(v.literal("help"), v.literal("job"), v.literal("restart"), v.literal("reload"), v.literal("ask")),
  ask: v.optional(v.union(v.literal("investigate"), v.literal("more"), v.literal("say"))),
  deviceId: v.id("devices"),
  helpRequestId: v.optional(v.id("helpRequests")),
  jobId: v.optional(v.id("jobs")),
});

export const recordMessages = internalMutation({
  args: recordArgs.fields,
  returns: v.null(),
  handler: async (ctx, { messageIds, ...rest }) => {
    const sentAt = Date.now();
    for (const messageId of messageIds) {
      await ctx.db.insert("telegramMessages", { ...rest, messageId, sentAt });
    }
    if (rest.kind === "help" && rest.helpRequestId) await ctx.db.patch(rest.helpRequestId, { telegramNotifiedAt: sentAt });
    return null;
  },
});

// ---- the helper's messages ---------------------------------------------------

const USAGE = [
  "Help messages have buttons: Send an agent, Message <name>'s screen, Screenshot, Last 10 minutes, Reload a page, Call <name>, Got it, Restart <name>'s laptop and Done.",
  "Reply to a help message to show your words on the laptop's screen.",
  'Reply "look" to a help message to send an agent without a note.',
  'Reply "go" to a job report to approve the fix.',
  "/run <instructions> sends an agent to look, with your instructions. /look <instructions> does the same.",
  "/screenshot shows you the laptop's screen now.",
  "/status shows every device.",
  "/restart restarts the laptop, after you confirm.",
  "/reload lists the laptop's pages to reload. /reload <page> reloads one, such as /reload youtube.",
  "With several laptops, start with a name: /run air: check the sound.",
].join("\n");

async function statusReport(ctx: MutationCtx): Promise<string> {
  const now = Date.now();
  const devices = (await ctx.db.query("devices").take(50)).filter((d) => d.revokedAt === undefined);
  if (!devices.length) return "No devices yet.";
  const parts = await Promise.all(
    devices.map(async (d) => {
      const name = await personName(ctx, d);
      const seen = d.lastSeenAt === undefined ? "never seen" : isOnline(d.lastSeenAt, now) ? "online" : `offline, last seen ${ago(now - d.lastSeenAt)}`;
      return [`${name} (${d.name}): ${seen}`, ...statusLines(d.status)].join("\n");
    }),
  );
  return truncate(parts.join("\n\n"), TELEGRAM_TEXT_LIMIT);
}

const command = (word: string) => new RegExp(`^/?${word}(@\\w+)?[.!]?$`, "i");
const LOOK = /^\/?look(@\w+)?( into it)?[.!]?$/i;
const APPROVE = /^\/?(go|fix)(@\w+)?[.!]?$/i;
const RESTART = /^\/restart(@\w+)?(\s+(.+))?$/i;
const RUN = /^\/(run|look)(@\w+)?\s+([\s\S]+)$/i;
const SCREENSHOT = /^\/screenshot(@\w+)?(\s+(.+))?$/i;
const RELOAD = /^\/reload(@\w+)?(\s+(.+))?$/i;
const YES = /^(yes|y)[.!]?$/i;
// A restart question stops working after this long.
export const RESTART_CONFIRM_MS = 5 * 60_000;

type Named = { d: Doc<"devices">; person: string };

async function helperName(ctx: MutationCtx, deviceId: Id<"devices">): Promise<string> {
  return (await settingsFor(ctx, deviceId))?.settings.helper.name ?? "Your helper";
}

// One device by the person's or the device's name, or the only one there is.
async function pickDevice(ctx: MutationCtx, name: string | undefined, usage: string): Promise<Named | { reply: string }> {
  const devices = (await ctx.db.query("devices").take(50)).filter((d) => d.revokedAt === undefined);
  const named = await Promise.all(devices.map(async (d) => ({ d, person: await personName(ctx, d) })));
  const wanted = name?.trim().toLowerCase();
  const matches = wanted
    ? named.filter(({ d, person }) => d.name.toLowerCase() === wanted || person.toLowerCase() === wanted)
    : named;
  if (matches.length === 0) return { reply: wanted ? `No device called "${name!.trim()}".` : "No devices yet." };
  if (matches.length > 1) return { reply: `Which one? ${usage} ${matches.map(({ d }) => d.name).join(", ")}.` };
  return matches[0]!;
}

function restartQuestion(n: Named, replyTo?: number): Plan {
  return {
    messages: [
      {
        text: `Restart ${n.person}'s laptop (${n.d.name})? The screen will say it's restarting, then it reboots. Tap "Yes, restart" or reply "yes" within 5 minutes.`,
        ...(replyTo ? { replyTo } : {}),
        buttons: [[{ text: "Yes, restart", data: `rsty:${n.d._id}` }, { text: "No", data: `rstn:${n.d._id}` }]],
        link: { kind: "restart", deviceId: n.d._id },
      },
    ],
  };
}

// Her tiles that reload: web apps and the Browser.
async function reloadableTiles(ctx: MutationCtx, deviceId: Id<"devices">) {
  return ((await settingsFor(ctx, deviceId))?.settings.tiles ?? []).filter(isReloadable);
}

// The menu of her pages, one button each. A tap queues the reload; the
// menu's link says which device it's for, so the button only needs the tile.
async function reloadMenu(ctx: MutationCtx, n: Named, replyTo?: number, lead = ""): Promise<Plan> {
  const tiles = await reloadableTiles(ctx, n.d._id);
  if (!tiles.length) return say(`${lead}${n.person}'s laptop has no web pages to reload.`, replyTo);
  const buttons = [];
  for (let i = 0; i < tiles.length; i += 2) buttons.push(tiles.slice(i, i + 2).map((t) => ({ text: t.label, data: `rld:${t.id}` })));
  const helper = await helperName(ctx, n.d._id);
  return {
    messages: [
      {
        text: `${lead}Which page should I reload on ${n.person}'s laptop (${n.d.name})? It comes to the front and reloads, or opens if it's closed. The screen says "${helper} refreshed <page>." for a few seconds.`,
        ...(replyTo ? { replyTo } : {}),
        buttons,
        link: { kind: "reload", deviceId: n.d._id },
      },
    ],
  };
}

async function queueReload(ctx: MutationCtx, a: { n: Named; tileId: string; chatId: string; replyTo?: number }): Promise<string> {
  const tile = (await reloadableTiles(ctx, a.n.d._id)).find((t) => t.id === a.tileId);
  await queueAction(ctx, {
    deviceId: a.n.d._id,
    action: { type: "reload", tileId: a.tileId },
    source: "telegram",
    telegram: target(a.chatId, a.replyTo),
  });
  return `Reloading ${tile?.label ?? a.tileId} on ${a.n.person}'s laptop.`;
}

// "/reload", "/reload youtube", and with several devices "/reload air
// youtube". A page is matched by its id or its label.
async function reloadCommand(ctx: MutationCtx, arg: string | undefined, chatId: string, me?: number): Promise<Plan> {
  const words = arg?.trim().split(/\s+/).filter(Boolean) ?? [];
  let n: Named | { reply: string } | null = null;
  let page = words.join(" ");
  if (words.length) {
    const first = await pickDevice(ctx, words[0], "");
    if (!("reply" in first) && (first.d.name.toLowerCase() === words[0]!.toLowerCase() || first.person.toLowerCase() === words[0]!.toLowerCase())) {
      n = first;
      page = words.slice(1).join(" ");
    }
  }
  n ??= await pickDevice(ctx, undefined, "Send /reload followed by one of:");
  if ("reply" in n) return say(n.reply, me);
  if (!page) return reloadMenu(ctx, n, me);
  const wanted = page.toLowerCase();
  const tile = ((await settingsFor(ctx, n.d._id))?.settings.tiles ?? []).find((t) => t.id === wanted || t.label.toLowerCase() === wanted);
  if (!tile) return reloadMenu(ctx, n, me, `${n.person} has no page called "${page}". `);
  return say(await queueReload(ctx, { n, tileId: tile.id, chatId, replyTo: me }), me);
}

// An agent job with the helper's own instructions, from /run or /look.
async function runJob(ctx: MutationCtx, n: Named, instructions: string, replyTo: number, helpRequestId?: Id<"helpRequests">): Promise<Plan> {
  const prompt = `${instructions.trim()}\n\nOnly look; don't change anything. Report what you found and propose a fix if one is needed.`;
  const jobId = await createJob(ctx, { deviceId: n.d._id, kind: "investigate", prompt, helpRequestId, source: "telegram" });
  return say(`Sent an agent to look at ${n.person}'s laptop. The report will come here.`, replyTo, {
    link: { kind: "job", deviceId: n.d._id, jobId },
  });
}

const target = (chatId: string, replyTo?: number): TelegramTarget => ({ chatId, ...(replyTo ? { replyTo } : {}) });

// What an incoming message from an admin means. Returns what to answer.
export const route = internalMutation({
  args: {
    chatId: v.string(),
    messageId: v.optional(v.number()),
    text: v.string(),
    replyToMessageId: v.optional(v.number()),
  },
  returns: planValidator,
  handler: async (ctx, { chatId, messageId, text, replyToMessageId }): Promise<Plan> => {
    const t = text.trim();
    const me = messageId;
    try {
      if (command("status").test(t)) return say(await statusReport(ctx), me);
      const restart = RESTART.exec(t);
      if (restart) {
        const n = await pickDevice(ctx, restart[3], "Send /restart followed by one of:");
        return "reply" in n ? say(n.reply, me) : restartQuestion(n, me);
      }
      const reload = RELOAD.exec(t);
      if (reload) return await reloadCommand(ctx, reload[3], chatId, me);
      if (command("(start|help)").test(t)) return say(USAGE, me);
      const shot = SCREENSHOT.exec(t);
      if (shot) {
        const n = await pickDevice(ctx, shot[3], "Send /screenshot followed by one of:");
        if ("reply" in n) return say(n.reply, me);
        await queueAction(ctx, { deviceId: n.d._id, action: { type: "screenshot" }, source: "telegram", telegram: target(chatId, me) });
        return say(`Asking ${n.person}'s laptop for a picture.`, me);
      }

      const link =
        replyToMessageId === undefined
          ? null
          : await ctx.db
              .query("telegramMessages")
              .withIndex("by_chat_and_message", (q) => q.eq("chatId", chatId).eq("messageId", replyToMessageId))
              .first();

      const run = RUN.exec(t);
      if (run && !LOOK.test(t)) {
        const instructions = run[3]!.trim();
        if (link?.kind === "help" && link.helpRequestId) {
          const device = await ctx.db.get(link.deviceId);
          if (!device) return say("That device is gone.", me);
          return await runJob(ctx, { d: device, person: await personName(ctx, device) }, instructions, me!, link.helpRequestId);
        }
        if (link?.kind === "job" && link.jobId) {
          const jobId = await investigateMore(ctx, { jobId: link.jobId, instructions, source: "telegram" });
          return say("Sent the agent back to look further. The report will come here.", me, {
            link: { kind: "job", deviceId: link.deviceId, jobId },
          });
        }
        // "/run air: check the sound" picks a device by name.
        const named = /^([A-Za-z0-9_-]{1,40}):\s+([\s\S]+)$/.exec(instructions);
        const n = await pickDevice(ctx, named?.[1], "Start with a name, like /run air: check the sound. Devices:");
        if ("reply" in n) {
          // "air:" wasn't a device; maybe it's just part of the instructions.
          if (named) {
            const only = await pickDevice(ctx, undefined, "Start with a name, like /run air: check the sound. Devices:");
            if (!("reply" in only)) return await runJob(ctx, only, instructions, me!);
          }
          return say(n.reply, me);
        }
        return await runJob(ctx, n, named ? named[2]! : instructions, me!);
      }

      if (replyToMessageId === undefined) return say(USAGE, me);
      if (!link) return say("I can't tell what that reply is about. Reply to a help message or a job report.", me);

      const device = await ctx.db.get(link.deviceId);
      if (!device) return say("That device is gone.", me);
      const person = await personName(ctx, device);

      if (link.kind === "help" && link.helpRequestId) {
        if (LOOK.test(t)) {
          const { jobId, created } = await investigateHelp(ctx, { helpRequestId: link.helpRequestId, source: "telegram" });
          return say(
            created ? "Sent an agent to look. The report will come here." : "An agent is already looking at this one. Its report will come here.",
            me,
            { link: { kind: "job", deviceId: link.deviceId, jobId } },
          );
        }
        if (t.startsWith("/")) return say(USAGE, me);
        return sayOnScreen(ctx, { chatId, me, person, text: t, helpRequestId: link.helpRequestId, deviceId: link.deviceId });
      }
      if (link.kind === "restart") {
        if (!YES.test(t)) return say('Not restarting. Send /restart again and tap "Yes, restart" to go ahead.', me);
        return await confirmRestart(ctx, { chatId, me, link });
      }
      if (link.kind === "job" && link.jobId) {
        if (APPROVE.test(t)) {
          await approveJob(ctx, link.jobId);
          return say("Approved. The agent will start the fix.", me);
        }
        return say('Reply "go" to approve the fix, or tap a button on the report.', me);
      }
      if (link.kind === "ask") return await answerAsk(ctx, { chatId, me, link, person, text: t });
    } catch (err) {
      return say(`That didn't work: ${err instanceof Error ? err.message : String(err)}`, me);
    }
    return say(USAGE, me);
  },
});

async function sayOnScreen(
  ctx: MutationCtx,
  a: { chatId: string; me?: number; person: string; text: string; helpRequestId?: Id<"helpRequests">; deviceId: Id<"devices"> },
): Promise<Plan> {
  if (a.helpRequestId) {
    await replyToHelp(ctx, { helpRequestId: a.helpRequestId, text: a.text, source: "telegram", telegram: target(a.chatId, a.me) });
  } else {
    await queueAction(ctx, {
      deviceId: a.deviceId,
      action: { type: "say", text: a.text.trim().slice(0, SAY_MAX) },
      source: "telegram",
      telegram: target(a.chatId, a.me),
    });
  }
  const cut = a.text.trim().length > SAY_MAX ? ` It was cut to ${SAY_MAX} characters.` : "";
  return say(`Showing on ${a.person}'s screen.${cut}`, a.me);
}

async function confirmRestart(ctx: MutationCtx, a: { chatId: string; me?: number; link: Doc<"telegramMessages"> }): Promise<Plan> {
  if (Date.now() - a.link.sentAt > RESTART_CONFIRM_MS) return say("That question is too old. Send /restart again.", a.me);
  const device = await ctx.db.get(a.link.deviceId);
  if (!device) return say("That device is gone.", a.me);
  await queueAction(ctx, {
    deviceId: a.link.deviceId,
    action: { type: "restart" },
    source: "telegram",
    telegram: target(a.chatId, a.me ?? a.link.messageId),
  });
  return say(`Restarting ${await personName(ctx, device)}'s laptop. It should be back in a minute or two.`, a.me);
}

// The helper's answer to one of the bot's questions (ForceReply).
async function answerAsk(
  ctx: MutationCtx,
  a: { chatId: string; me?: number; link: Doc<"telegramMessages">; person: string; text: string },
): Promise<Plan> {
  const { link, text } = a;
  if (!text) return say("That was empty, so nothing happened.", a.me);
  if (link.ask === "say") {
    return sayOnScreen(ctx, { chatId: a.chatId, me: a.me, person: a.person, text, helpRequestId: link.helpRequestId, deviceId: link.deviceId });
  }
  if (link.ask === "investigate" && link.helpRequestId) {
    const { jobId } = await investigateHelp(ctx, { helpRequestId: link.helpRequestId, source: "telegram", instructions: text });
    return say("Sent an agent with your note. The report will come here.", a.me, {
      link: { kind: "job", deviceId: link.deviceId, jobId },
    });
  }
  if (link.ask === "more" && link.jobId) {
    const jobId = await investigateMore(ctx, { jobId: link.jobId, instructions: text, source: "telegram" });
    return say("Sent the agent back to look further. The report will come here.", a.me, {
      link: { kind: "job", deviceId: link.deviceId, jobId },
    });
  }
  return say(USAGE, a.me);
}

// ---- button taps ------------------------------------------------------------

const ask = (text: string, placeholder: string, replyTo: number, link: Link): Plan => ({
  messages: [{ text, replyTo, forceReply: placeholder, link }],
});

// A tap on one of the bot's buttons. `messageId` is the message the button
// was on.
export const callback = internalMutation({
  args: { chatId: v.string(), messageId: v.number(), data: v.string() },
  returns: planValidator,
  handler: async (ctx, { chatId, messageId, data }): Promise<Plan> => {
    const [verb, id] = data.split(":", 2);
    if (!verb || !id) return { toast: "That button doesn't do anything.", messages: [] };
    try {
      switch (verb) {
        case "got":
        case "agent":
        case "agt":
        case "inv":
        case "invi":
        case "shot":
        case "last":
        case "say":
        case "rldm":
        case "call":
        case "rst":
        case "done":
          return await helpTap(ctx, { chatId, messageId, verb, id });
        case "apv":
        case "more":
        case "dis":
        case "send":
          return await jobTap(ctx, { chatId, messageId, verb, id });
        case "rld": {
          const link = await ctx.db
            .query("telegramMessages")
            .withIndex("by_chat_and_message", (q) => q.eq("chatId", chatId).eq("messageId", messageId))
            .first();
          if (!link || link.kind !== "reload") return { toast: "That menu isn't mine.", messages: [] };
          const device = await ctx.db.get(link.deviceId);
          if (!device) return { toast: "That device is gone.", messages: [] };
          const n = { d: device, person: await personName(ctx, device) };
          return { toast: await queueReload(ctx, { n, tileId: id, chatId, replyTo: messageId }), messages: [] };
        }
        case "rsty":
        case "rstn": {
          const link = await ctx.db
            .query("telegramMessages")
            .withIndex("by_chat_and_message", (q) => q.eq("chatId", chatId).eq("messageId", messageId))
            .first();
          if (!link || link.kind !== "restart" || link.deviceId !== id) return { toast: "That question isn't mine.", messages: [] };
          if (verb === "rstn") return { toast: "Not restarting.", messages: [], clearButtons: true };
          return { ...(await confirmRestart(ctx, { chatId, link })), clearButtons: true };
        }
      }
    } catch (err) {
      return { toast: "That didn't work.", messages: [{ text: `That didn't work: ${err instanceof Error ? err.message : String(err)}`, replyTo: messageId }] };
    }
    return { toast: "That button doesn't do anything anymore.", messages: [] };
  },
});

async function helpTap(ctx: MutationCtx, a: { chatId: string; messageId: number; verb: string; id: string }): Promise<Plan> {
  const helpRequestId = ctx.db.normalizeId("helpRequests", a.id);
  const help = helpRequestId ? await ctx.db.get(helpRequestId) : null;
  if (!help) return { toast: "That help request is gone.", messages: [] };
  const device = await ctx.db.get(help.deviceId);
  if (!device) return { toast: "That device is gone.", messages: [] };
  const person = await personName(ctx, device);
  const tg = target(a.chatId, a.messageId);
  const base = { deviceId: help.deviceId, helpRequestId: help._id };
  switch (a.verb) {
    case "got": {
      const { already } = await markHelpSeen(ctx, { helpRequestId: help._id, source: "telegram", telegram: tg });
      return { toast: already ? `${person} already knows you saw it.` : `${person}'s screen now says you saw the message.`, messages: [] };
    }
    case "agent":
      // Inline buttons and ForceReply can't share a message, so the question
      // has the button and he replies to it to add a note.
      return {
        messages: [
          {
            text: "Anything to tell the agent? Reply to this message with a note, or tap Send without a note.",
            replyTo: a.messageId,
            buttons: [[{ text: "Send without a note", data: `agt:${help._id}` }]],
            link: { kind: "ask", ask: "investigate", ...base },
          },
        ],
      };
    case "agt":
    case "inv": {
      const { jobId, created } = await investigateHelp(ctx, { helpRequestId: help._id, source: "telegram" });
      const clearButtons = a.verb === "agt";
      if (!created) return { toast: "An agent is already looking at this one.", messages: [], clearButtons };
      return {
        toast: "Sent an agent.",
        messages: [{ text: "Sent an agent to look. The report will come here.", replyTo: a.messageId, link: { kind: "job", deviceId: help.deviceId, jobId } }],
        clearButtons,
      };
    }
    case "invi":
      return ask("What should the agent look into? Reply to this message.", "What should the agent look into?", a.messageId, {
        kind: "ask",
        ask: "investigate",
        ...base,
      });
    case "say":
      return ask(`What should ${person}'s screen say? Reply to this message.`, `Shows as "${await helperName(ctx, help.deviceId)} says: …"`, a.messageId, {
        kind: "ask",
        ask: "say",
        ...base,
      });
    case "shot":
      await queueAction(ctx, { deviceId: help.deviceId, action: { type: "screenshot" }, source: "telegram", helpRequestId: help._id, telegram: tg });
      return { toast: `Asking for ${person}'s screen.`, messages: [] };
    case "last":
      await queueAction(ctx, { deviceId: help.deviceId, action: { type: "recent-screens" }, source: "telegram", helpRequestId: help._id, telegram: tg });
      return { toast: `Asking for the last 10 minutes. ${person} is told first.`, messages: [] };
    case "rldm":
      return await reloadMenu(ctx, { d: device, person }, a.messageId);
    case "call":
      return { toast: `How to call ${person}.`, ...(await callPlan(ctx, { person, deviceId: help.deviceId, replyTo: a.messageId })) };
    case "rst":
      return restartQuestion({ d: device, person }, a.messageId);
    case "done":
      if (help.status === "closed") return { toast: "Already done.", messages: [], clearButtons: true };
      await ctx.db.patch(help._id, { status: "closed" });
      return { toast: `Marked done. A reply to it still reaches ${person}'s screen.`, messages: [], clearButtons: true };
  }
  return { messages: [] };
}

// Call her: Telegram buttons can't dial, so her number goes in the text,
// where Telegram makes it tappable, and her Telegram chat is a link.
async function callPlan(ctx: MutationCtx, a: { person: string; deviceId: Id<"devices">; replyTo: number }): Promise<Plan> {
  const p = (await settingsFor(ctx, a.deviceId))?.settings.person;
  const phone = p?.phone?.trim();
  const tg = p?.telegram?.trim();
  if (!phone && !tg) {
    return say(`I don't have ${a.person}'s phone number. Add it in the admin app's Settings, under Names, and it shows here.`, a.replyTo);
  }
  const lines = [phone ? `${a.person}'s phone: ${phone}` : `I don't have ${a.person}'s phone number; add it in the admin app's Settings.`];
  if (phone) lines.push("Tap the number to call.");
  if (tg) lines.push(`${phone ? "Or open" : "Open"} ${a.person}'s Telegram chat and call from there.`);
  return say(lines.join("\n"), a.replyTo, tg ? { buttons: [[{ text: `Open ${a.person}'s Telegram chat`, url: `https://t.me/${tg}` }]] } : {});
}

async function jobTap(ctx: MutationCtx, a: { chatId: string; messageId: number; verb: string; id: string }): Promise<Plan> {
  const jobId = ctx.db.normalizeId("jobs", a.id);
  const job = jobId ? await ctx.db.get(jobId) : null;
  if (!job) return { toast: "That job is gone.", messages: [] };
  const device = await ctx.db.get(job.deviceId);
  const person = device ? await personName(ctx, device) : "the person";
  switch (a.verb) {
    case "apv":
      if (job.status !== "awaiting_approval") return { toast: `That job is ${job.status.replace("_", " ")}, so there's nothing to approve.`, messages: [] };
      await approveJob(ctx, job._id);
      return { toast: "Approved. The agent is starting the fix.", messages: [{ text: "Approved. The agent is starting the fix.", replyTo: a.messageId }], clearButtons: true };
    case "more":
      return ask("What should the agent look into next? Reply to this message.", "What should the agent look into?", a.messageId, {
        kind: "ask",
        ask: "more",
        deviceId: job.deviceId,
        jobId: job._id,
        ...(job.helpRequestId ? { helpRequestId: job.helpRequestId } : {}),
      });
    case "dis":
      if (!isTerminal(job.status)) await cancelJob(ctx, job._id);
      return { toast: "Dismissed.", messages: [], clearButtons: true };
    case "send": {
      if (!job.suggestedMessage) return { toast: "This report has no message to send.", messages: [] };
      const plan = await sayOnScreen(ctx, {
        chatId: a.chatId,
        me: a.messageId,
        person,
        text: job.suggestedMessage,
        helpRequestId: job.helpRequestId,
        deviceId: job.deviceId,
      });
      return { toast: `Sent to ${person}'s screen.`, messages: plan.messages };
    }
  }
  return { messages: [] };
}

// ---- webhook plumbing -------------------------------------------------------

// Answers a tap and sends the plan. Called from the webhook.
export async function answerTap(
  token: string,
  callbackQueryId: string,
  chatId: string,
  messageId: number,
  plan: Plan,
): Promise<void> {
  try {
    await answerCallbackQuery(token, callbackQueryId, plan.toast);
  } catch (err) {
    console.error("Answering a button tap failed:", err);
  }
  if (plan.clearButtons) {
    try {
      await editButtons(token, chatId, messageId, []);
    } catch (err) {
      console.error("Removing buttons failed:", err);
    }
  }
}
