import { HELP_NOTE_MAX } from "@momos/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { TELEGRAM_TEXT_LIMIT } from "./lib/format";
import { jobReportText, noteLine } from "./telegram";
import {
  ADMIN,
  ADMIN_TG_ID,
  addDevice,
  DISPATCHER_TOKEN,
  newBackend,
  settings,
  status,
  WEBHOOK_SECRET,
  type Backend,
} from "./test.setup";

let t: Backend;
let sent: { method: string; body: unknown }[];
let nextId: number;

function telegramStub() {
  return vi.fn(async (url: string, init: RequestInit) => {
    const method = url.split("/").pop()!;
    let body: unknown = init.body;
    let result: unknown;
    if (init.body instanceof FormData) {
      body = Object.fromEntries([...init.body.entries()].filter(([, v]) => typeof v === "string"));
      if (method === "sendMediaGroup") {
        const media = JSON.parse(init.body.get("media") as string) as unknown[];
        result = media.map(() => ({ message_id: nextId++ }));
      } else result = { message_id: nextId++ };
    } else {
      body = JSON.parse(String(init.body));
      result = { message_id: nextId++ };
    }
    sent.push({ method, body });
    return new Response(JSON.stringify({ ok: true, result }), { headers: { "content-type": "application/json" } });
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubEnv("ADMIN_EMAILS", ADMIN.email);
  vi.stubEnv("DISPATCHER_TOKEN", DISPATCHER_TOKEN);
  vi.stubEnv("TELEGRAM_BOT_TOKEN", "123:abc");
  vi.stubEnv("TELEGRAM_WEBHOOK_SECRET", WEBHOOK_SECRET);
  vi.stubEnv("TELEGRAM_ADMIN_IDS", ADMIN_TG_ID);
  sent = [];
  nextId = 500;
  vi.stubGlobal("fetch", telegramStub());
  t = newBackend();
});
afterEach(async () => {
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

function webhook(message: Record<string, unknown>, secret = WEBHOOK_SECRET) {
  return t.fetch("/telegram/webhook", {
    method: "POST",
    headers: { "content-type": "application/json", "X-Telegram-Bot-Api-Secret-Token": secret },
    body: JSON.stringify({ update_id: 1, message: { message_id: 900, chat: { id: Number(ADMIN_TG_ID) }, ...message } }),
  });
}
const fromAdmin = { from: { id: Number(ADMIN_TG_ID) } };

async function helpRequest(note?: string) {
  const { deviceId, token } = await addDevice(t);
  await t.withIdentity(ADMIN).mutation(api.admin.updateSettings, { deviceId, settings });
  const shots = await t.run(async (ctx) => [
    await ctx.storage.store(new Blob(["a"], { type: "image/png" })),
    await ctx.storage.store(new Blob(["b"], { type: "image/png" })),
  ]);
  const { helpRequestId } = await t.mutation(api.device.createHelpRequest, {
    deviceToken: token,
    screenshots: shots,
    context: status,
    ...(note === undefined ? {} : { note }),
  });
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  return { deviceId, token, helpRequestId };
}

describe("help messages", () => {
  it("sends the context and screenshots and records every message id", async () => {
    const { helpRequestId } = await helpRequest();
    expect(sent.map((s) => s.method)).toEqual(["sendMessage", "sendMediaGroup"]);
    const text = (sent[0]!.body as { text: string }).text;
    // An older momd's request: no kinds, the screenshots are the whole thing.
    expect(text).toContain("Mom needs help");
    expect(text).toContain("Mom's screen is below.");
    expect(text).toContain("Using youtube · Internet working (home, 70%) · Battery 54%");
    const links = await t.run((ctx) => ctx.db.query("telegramMessages").collect());
    expect(links.map((l) => l.messageId)).toEqual([500, 501, 502]);
    expect(links.every((l) => l.helpRequestId === helpRequestId)).toBe(true);
  });

  it("leaves out the note line when there's no note", async () => {
    const { helpRequestId } = await helpRequest();
    expect((sent[0]!.body as { text: string }).text).not.toContain("Note:");
    expect((await t.run((ctx) => ctx.db.get(helpRequestId)))!.note).toBeUndefined();
  });

  it("stores the note and puts it in the message", async () => {
    const { helpRequestId } = await helpRequest("screen was off");
    const text = (sent[0]!.body as { text: string }).text;
    expect(text).toContain("Note: the screen was off, so there's no fresh picture.");
    expect((await t.run((ctx) => ctx.db.get(helpRequestId)))!.note).toBe("screen was off");
  });

  it("shows other notes as they came and cuts long ones", async () => {
    expect(noteLine("screen was off: the lid was closed")).toBe(
      "Note: the screen was off (the lid was closed), so there's no fresh picture.",
    );
    expect(noteLine("no fresh screenshot: grim failed")).toBe("Note: no fresh screenshot: grim failed");
    const { helpRequestId } = await helpRequest("y".repeat(500));
    const help = await t.run((ctx) => ctx.db.get(helpRequestId));
    expect(help!.note!.length).toBe(HELP_NOTE_MAX);
  });

  it("is a no-op when Telegram is not configured", async () => {
    vi.stubEnv("TELEGRAM_BOT_TOKEN", "");
    await helpRequest();
    expect(sent).toEqual([]);
  });
});

describe("webhook", () => {
  it("rejects a missing or wrong secret", async () => {
    expect((await webhook({ ...fromAdmin, text: "/status" }, "wrong")).status).toBe(401);
    expect((await webhook({ ...fromAdmin, text: "/status" }, "")).status).toBe(401);
    expect(sent).toEqual([]);
  });

  it("refuses requests when Telegram is not configured", async () => {
    vi.stubEnv("TELEGRAM_WEBHOOK_SECRET", "");
    expect((await webhook({ ...fromAdmin, text: "/status" })).status).toBe(503);
  });

  it("ignores messages from anyone but the admins", async () => {
    await helpRequest();
    sent = [];
    const res = await webhook({ from: { id: 42 }, text: "hello", reply_to_message: { message_id: 500 } });
    expect(res.status).toBe(200);
    expect(sent).toEqual([]);
    expect(await t.run((ctx) => ctx.db.query("actions").collect())).toEqual([]);
  });

  it("turns a plain reply to a help message into a say action", async () => {
    const { token, helpRequestId } = await helpRequest();
    sent = [];
    // Replying to one of the screenshots works as well as to the text.
    await webhook({ ...fromAdmin, text: "I'll call you in five minutes.", reply_to_message: { message_id: 502 } });
    const pending = await t.query(api.device.pendingActions, { deviceToken: token });
    expect(pending.map((p) => p.action)).toEqual([{ type: "say", text: "I'll call you in five minutes." }]);
    const help = await t.run((ctx) => ctx.db.get(helpRequestId));
    expect(help?.status).toBe("answered");
    expect(help?.replies[0]?.source).toBe("telegram");
    expect((sent[0]!.body as { text: string }).text).toContain("Showing on Mom's screen");
  });

  it("starts an investigate job on look", async () => {
    const { helpRequestId } = await helpRequest();
    await webhook({ ...fromAdmin, text: "look", reply_to_message: { message_id: 500 } });
    const jobs = await t.query(api.dispatcher.pendingJobs, { dispatcherToken: DISPATCHER_TOKEN });
    expect(jobs).toHaveLength(1);
    expect(jobs[0]?.kind).toBe("investigate");
    expect(jobs[0]?.helpRequestId).toBe(helpRequestId);
    expect(jobs[0]?.helpRequest?.screenshotUrls).toHaveLength(2);
  });

  it("approves a job when go is a reply to its report", async () => {
    const { deviceId } = await helpRequest();
    const jobId = await t.mutation(api.dispatcher.createJob, {
      dispatcherToken: DISPATCHER_TOKEN,
      deviceId,
      kind: "fix",
      prompt: "Fix it",
    });
    await t.mutation(api.dispatcher.claimJob, { dispatcherToken: DISPATCHER_TOKEN, jobId, workerId: "w", leaseMs: 60_000 });
    sent = [];
    await t.mutation(api.dispatcher.updateJob, {
      dispatcherToken: DISPATCHER_TOKEN,
      jobId,
      workerId: "w",
      status: "awaiting_approval",
      report: "Found it.",
    });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(sent[0]?.method).toBe("sendMessage");
    const reportId = 503;
    const link = await t.run((ctx) => ctx.db.query("telegramMessages").filter((q) => q.eq(q.field("jobId"), jobId)).first());
    expect(link?.messageId).toBe(reportId);

    await webhook({ ...fromAdmin, text: "sure", reply_to_message: { message_id: reportId } });
    expect((await t.run((ctx) => ctx.db.get(jobId)))?.status).toBe("awaiting_approval");
    await webhook({ ...fromAdmin, text: "/fix", reply_to_message: { message_id: reportId } });
    expect((await t.run((ctx) => ctx.db.get(jobId as Id<"jobs">)))?.status).toBe("approved");
  });

  it("answers /status with every device", async () => {
    await helpRequest();
    sent = [];
    await webhook({ ...fromAdmin, text: "/status" });
    const text = (sent[0]!.body as { text: string }).text;
    expect(text).toContain("Mom (laptop): online");
    expect(text).toContain("Internet: working (home, 70%)");
  });
});

describe("job report text", () => {
  it("stays inside Telegram's limit and keeps the approval hint", () => {
    const text = jobReportText({
      person: "Mom",
      job: { _id: "j", kind: "fix", status: "awaiting_approval", report: "x".repeat(10_000) },
    });
    expect(text.length).toBeLessThanOrEqual(TELEGRAM_TEXT_LIMIT);
    expect(text).toContain("[cut off]");
    expect(text.endsWith('Tap Approve fix, or reply "go" to this message.')).toBe(true);
  });
});
