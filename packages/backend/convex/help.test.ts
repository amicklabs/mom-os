import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { ACTION_WAIT_MS } from "./lib/actions";
import { RESTART_CONFIRM_MS } from "./telegram";
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

// The Help pop-up's requests, and everything the helper does with them on
// Telegram: the buttons, the questions he answers by replying, and the
// notices when something doesn't happen.

type Sent = { method: string; body: Record<string, any>; id: number };
let t: Backend;
let sent: Sent[];
let nextId: number;

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubEnv("ADMIN_EMAILS", ADMIN.email);
  vi.stubEnv("DISPATCHER_TOKEN", DISPATCHER_TOKEN);
  vi.stubEnv("TELEGRAM_BOT_TOKEN", "123:abc");
  vi.stubEnv("TELEGRAM_WEBHOOK_SECRET", WEBHOOK_SECRET);
  vi.stubEnv("TELEGRAM_ADMIN_IDS", ADMIN_TG_ID);
  sent = [];
  nextId = 500;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit) => {
      const method = url.split("/").pop()!;
      let body: Record<string, any>;
      let result: unknown = { message_id: nextId++ };
      if (init.body instanceof FormData) {
        body = Object.fromEntries([...init.body.entries()].filter(([, v]) => typeof v === "string"));
        for (const k of ["media", "reply_parameters"]) if (typeof body[k] === "string") body[k] = JSON.parse(body[k]);
        if (method === "sendMediaGroup") result = (body.media as unknown[]).map(() => ({ message_id: nextId++ }));
      } else {
        body = JSON.parse(String(init.body));
      }
      sent.push({ method, body, id: Array.isArray(result) ? -1 : (result as { message_id: number }).message_id });
      return new Response(JSON.stringify({ ok: true, result }), { headers: { "content-type": "application/json" } });
    }),
  );
  t = newBackend();
});
afterEach(async () => {
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

// Runs what's due now, without jumping to later timers like checkAction.
async function settle() {
  for (let i = 0; i < 3; i++) {
    vi.advanceTimersByTime(1);
    await t.finishInProgressScheduledFunctions();
  }
}

const post = (update: Record<string, unknown>, secret = WEBHOOK_SECRET) =>
  t.fetch("/telegram/webhook", {
    method: "POST",
    headers: { "content-type": "application/json", "X-Telegram-Bot-Api-Secret-Token": secret },
    body: JSON.stringify({ update_id: 1, ...update }),
  });

let myMessage = 9000;
async function reply(text: string, replyTo?: number, fromId = Number(ADMIN_TG_ID)) {
  const res = await post({
    message: {
      message_id: myMessage++,
      chat: { id: Number(ADMIN_TG_ID) },
      from: { id: fromId },
      text,
      ...(replyTo ? { reply_to_message: { message_id: replyTo } } : {}),
    },
  });
  await settle();
  return res;
}

async function tap(data: string, messageId: number, opts: { fromId?: number; secret?: string } = {}) {
  const res = await post(
    {
      callback_query: {
        id: `cb-${nextId}`,
        from: { id: opts.fromId ?? Number(ADMIN_TG_ID) },
        data,
        message: { message_id: messageId, chat: { id: Number(ADMIN_TG_ID) } },
      },
    },
    opts.secret,
  );
  await settle();
  return res;
}

const lastOf = (method: string) => [...sent].reverse().find((s) => s.method === method);
const lastId = () => lastOf("sendMessage")!.id;
const texts = () => sent.filter((s) => s.method === "sendMessage").map((s) => s.body.text as string);
const toast = () => lastOf("answerCallbackQuery")?.body.text as string | undefined;
const buttonTexts = (s: Sent | undefined) =>
  (s?.body.reply_markup?.inline_keyboard ?? []).flat().map((b: { text: string }) => b.text);
const pending = (token: string) => t.query(api.device.pendingActions, { deviceToken: token });
const jobs = () => t.run((ctx) => ctx.db.query("jobs").collect());

async function newHelp(
  o: {
    text?: string;
    kinds?: ("message" | "screenshot" | "call-me" | "voice")[];
    screenshot?: boolean;
    voiceBytes?: number;
    askedAt?: number;
    auto?: boolean;
    person?: { phone?: string; telegram?: string };
  } = {},
) {
  const { deviceId, token } = await addDevice(t);
  await t.withIdentity(ADMIN).mutation(api.admin.updateSettings, {
    deviceId,
    settings: {
      ...settings,
      person: { ...settings.person, ...o.person },
      helper: { ...settings.helper, ...(o.auto ? { autoInvestigate: true } : {}) },
    },
  });
  const shot = o.screenshot
    ? [await t.run((ctx) => ctx.storage.store(new Blob(["jpeg"], { type: "image/jpeg" })))]
    : [];
  const voice = o.voiceBytes
    ? await t.run((ctx) => ctx.storage.store(new Blob([new Uint8Array(o.voiceBytes!)], { type: "audio/ogg" })))
    : undefined;
  const { helpRequestId } = await t.mutation(api.device.createHelpRequest, {
    deviceToken: token,
    screenshots: shot,
    context: status,
    kinds: o.kinds ?? [],
    ...(o.text ? { text: o.text } : {}),
    ...(voice ? { voice, voiceSeconds: 7 } : {}),
    ...(o.askedAt ? { askedAt: o.askedAt } : {}),
  });
  await settle();
  return { deviceId, token, helpRequestId, helpMessageId: 500 };
}

// momd's side of an action: upload, then complete.
async function complete(token: string, actionId: Id<"actions">, ok: boolean, result?: string) {
  await t.mutation(api.device.completeAction, { deviceToken: token, actionId, ok, ...(result ? { result } : {}) });
  await settle();
}

describe("a help request from the pop-up", () => {
  it("quotes her words, shows the screen, asks to call, and has the buttons", async () => {
    const { helpRequestId } = await newHelp({
      text: "The video stopped\nand I can't get it back",
      kinds: ["message", "screenshot", "call-me"],
      screenshot: true,
    });
    expect(sent.map((s) => s.method)).toEqual(["sendMessage", "sendPhoto"]);
    const text = sent[0]!.body.text as string;
    expect(text.split("\n")[0]).toBe("Mom asked you to call");
    expect(text).toContain("“The video stopped\nand I can't get it back”");
    expect(text).toContain("Mom's screen is below.");
    expect(text).toContain("Using youtube · Internet working (home, 70%) · Battery 54%");
    expect(text).not.toContain("agent");
    expect(buttonTexts(sent[0])).toEqual([
      "Send an agent",
      "Message Mom's screen",
      "Screenshot",
      "Last 10 minutes",
      "Reload a page",
      "Call Mom",
      "Got it",
      "Restart Mom's laptop",
      "Done",
    ]);
    expect(sent[1]!.body.reply_parameters.message_id).toBe(500);
    const help = await t.run((ctx) => ctx.db.get(helpRequestId));
    expect(help?.kinds).toEqual(["message", "screenshot", "call-me"]);
    expect(help?.text).toBe("The video stopped\nand I can't get it back");
  });

  it("doesn't start an agent on its own when she writes or speaks", async () => {
    const { helpRequestId } = await newHelp({ text: "Are you coming Sunday?", kinds: ["message", "voice"], voiceBytes: 100 });
    expect(await jobs()).toEqual([]);
    expect((await t.run((ctx) => ctx.db.get(helpRequestId)))?.autoJobId).toBeUndefined();
  });

  it("links Watch Mom's screen to the admin app when ADMIN_APP_URL is set", async () => {
    vi.stubEnv("ADMIN_APP_URL", "https://admin.example.com/");
    await newHelp({ kinds: ["call-me"] });
    const watch = (sent[0]!.body.reply_markup.inline_keyboard as { text: string; url?: string }[][])
      .flat()
      .find((b) => b.text === "Watch Mom's screen");
    expect(watch?.url).toBe("https://admin.example.com/screen");
  });

  it("with autoInvestigate on, starts a read-only investigation when she wrote something", async () => {
    const { helpRequestId } = await newHelp({ text: "Where did my email go?", kinds: ["message"], auto: true });
    expect(sent[0]!.body.text).toContain("An agent is looking into it.");
    const all = await jobs();
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({ kind: "investigate", status: "queued", helpRequestId });
    expect(all[0]!.source).toBe("device");
    expect(all[0]!.prompt).toContain("Do not change anything");
    const help = await t.run((ctx) => ctx.db.get(helpRequestId));
    expect(help?.autoJobId).toBe(all[0]!._id);
    const pendingJobs = await t.query(api.dispatcher.pendingJobs, { dispatcherToken: DISPATCHER_TOKEN });
    expect(pendingJobs[0]?.helpRequest).toMatchObject({ text: "Where did my email go?", kinds: ["message"], hasVoice: false });
  });

  it("sends a voice note as a Telegram voice message, and autoInvestigate investigates it", async () => {
    const { helpRequestId } = await newHelp({ kinds: ["voice"], voiceBytes: 3000, auto: true });
    expect(sent.map((s) => s.method)).toEqual(["sendMessage", "sendVoice"]);
    expect(sent[0]!.body.text.split("\n")[0]).toBe("Mom sent a voice note");
    expect(sent[0]!.body.text).toContain("The voice note (7 s) is below. There's no transcript.");
    expect(sent[1]!.body).toMatchObject({ duration: "7", reply_parameters: { message_id: 500 } });
    const [job] = await jobs();
    expect(job?.prompt).toContain("voice note");
    expect(job?.prompt).toContain("no transcript");
    const pendingJobs = await t.query(api.dispatcher.pendingJobs, { dispatcherToken: DISPATCHER_TOKEN });
    expect(pendingJobs[0]?.helpRequest?.hasVoice).toBe(true);
    // A reply to the voice message routes to the help request like the text.
    const links = await t.run((ctx) => ctx.db.query("telegramMessages").collect());
    expect(links.filter((l) => l.helpRequestId === helpRequestId).map((l) => l.messageId)).toEqual([500, 501]);
  });

  it("refuses a voice note that's too big", async () => {
    await expect(newHelp({ kinds: ["voice"], voiceBytes: 3 * 1024 * 1024 })).rejects.toThrow("too big");
  });

  it("doesn't start an agent for a screenshot alone, even with autoInvestigate on", async () => {
    await newHelp({ kinds: ["screenshot"], screenshot: true, auto: true });
    expect(await jobs()).toEqual([]);
    expect(sent[0]!.body.text.split("\n")[0]).toBe("Mom needs help");
  });

  it("says when a request waited in the laptop's queue", async () => {
    await newHelp({ kinds: ["call-me"], askedAt: Date.now() - 25 * 60_000 });
    expect(sent[0]!.body.text).toContain("Mom asked 25 min ago, while the laptop was offline.");
  });
});

describe("button taps", () => {
  it("need the secret and an admin", async () => {
    const { token } = await newHelp({ kinds: ["screenshot"], screenshot: true });
    sent = [];
    expect((await tap("shot:x", 500, { secret: "wrong" })).status).toBe(401);
    const res = await tap(`got:x`, 500, { fromId: 42 });
    expect(res.status).toBe(200);
    expect(sent).toEqual([]);
    expect(await pending(token)).toEqual([]);
  });

  it("Got it tells her once", async () => {
    const { token, helpRequestId } = await newHelp({ kinds: ["call-me"] });
    await tap(`got:${helpRequestId}`, 500);
    expect((await pending(token)).map((p) => p.action)).toEqual([{ type: "help-seen" }]);
    expect(toast()).toBe("Mom's screen now says you saw the message.");
    const help = await t.run((ctx) => ctx.db.get(helpRequestId));
    expect(help?.seenAt).toBeTypeOf("number");
    expect(help?.status).toBe("answered");
    await tap(`got:${helpRequestId}`, 500);
    expect(toast()).toBe("Mom already knows you saw it.");
    expect(await pending(token)).toHaveLength(1);
  });

  it("Send an agent asks for a note, and Send without a note sends one", async () => {
    const { helpRequestId } = await newHelp({ text: "The sound is gone", kinds: ["message"] });
    await tap(`agent:${helpRequestId}`, 500);
    expect(await jobs()).toEqual([]);
    const question = lastOf("sendMessage")!;
    expect(question.body.text).toBe("Anything to tell the agent? Reply to this message with a note, or tap Send without a note.");
    expect(question.body.reply_parameters.message_id).toBe(500);
    expect(buttonTexts(question)).toEqual(["Send without a note"]);
    await tap(`agt:${helpRequestId}`, question.id);
    const [job] = await jobs();
    expect(job).toMatchObject({ kind: "investigate", status: "queued", helpRequestId, source: "telegram" });
    expect(job?.prompt).toContain("Mom asked for help and wrote what's wrong.");
    expect(job?.prompt).not.toContain("note for you");
    expect(lastOf("editMessageReplyMarkup")?.body.message_id).toBe(question.id);
    expect(texts().at(-1)).toBe("Sent an agent to look. The report will come here.");
    // Her words reach the agent from the help request itself.
    const pendingJobs = await t.query(api.dispatcher.pendingJobs, { dispatcherToken: DISPATCHER_TOKEN });
    expect(pendingJobs[0]?.helpRequest?.text).toBe("The sound is gone");
  });

  it("Send an agent with a note: his reply goes into the prompt with her request", async () => {
    const { helpRequestId } = await newHelp({ text: "The sound is gone", kinds: ["message"] });
    await tap(`agent:${helpRequestId}`, 500);
    await reply("Check the Bluetooth speaker first", lastId());
    const [job] = await jobs();
    expect(job?.helpRequestId).toBe(helpRequestId);
    expect(job?.prompt).toContain("Mom asked for help and wrote what's wrong.");
    expect(job?.prompt).toContain('Sam\'s note for you:\n"""\nCheck the Bluetooth speaker first\n"""');
    expect(job?.prompt).toContain("Do not change anything.");
    expect(texts().at(-1)).toBe("Sent an agent with your note. The report will come here.");
  });

  it("Call Mom shows the number and a link to the Telegram chat", async () => {
    const { helpRequestId } = await newHelp({ kinds: ["call-me"], person: { phone: "555-555-0101", telegram: "example_mom" } });
    await tap(`call:${helpRequestId}`, 500);
    const msg = lastOf("sendMessage")!;
    expect(msg.body.text).toContain("Mom's phone: 555-555-0101");
    expect(msg.body.reply_parameters.message_id).toBe(500);
    expect(msg.body.reply_markup.inline_keyboard).toEqual([[{ text: "Open Mom's Telegram chat", url: "https://t.me/example_mom" }]]);
  });

  it("Call Mom without a number says where to add it", async () => {
    const { helpRequestId } = await newHelp({ kinds: ["call-me"] });
    await tap(`call:${helpRequestId}`, 500);
    expect(texts().at(-1)).toContain("I don't have Mom's phone number.");
  });

  it("Reload a page shows the menu of her pages", async () => {
    const { token, helpRequestId } = await newHelp({ kinds: ["call-me"] });
    await tap(`rldm:${helpRequestId}`, 500);
    const menu = lastOf("sendMessage")!;
    expect(buttonTexts(menu)).toEqual(["YouTube", "Browser"]);
    await tap("rld:youtube", menu.id);
    expect((await pending(token)).map((p) => p.action)).toEqual([{ type: "reload", tileId: "youtube" }]);
  });

  it("Done closes the request and takes the buttons off", async () => {
    const { helpRequestId } = await newHelp({ kinds: ["call-me"] });
    await tap(`done:${helpRequestId}`, 500);
    expect((await t.run((ctx) => ctx.db.get(helpRequestId)))?.status).toBe("closed");
    expect(lastOf("editMessageReplyMarkup")?.body).toMatchObject({ message_id: 500, reply_markup: { inline_keyboard: [] } });
    await tap(`done:${helpRequestId}`, 500);
    expect(toast()).toBe("Already done.");
  });

  it("Investigate sends one agent, and not a second while one is looking", async () => {
    const { helpRequestId } = await newHelp({ kinds: ["screenshot"], screenshot: true });
    await tap(`inv:${helpRequestId}`, 500);
    expect(await jobs()).toHaveLength(1);
    expect(texts().at(-1)).toBe("Sent an agent to look. The report will come here.");
    await tap(`inv:${helpRequestId}`, 500);
    expect(await jobs()).toHaveLength(1);
    expect(toast()).toBe("An agent is already looking at this one.");
  });

  it("Investigate with instructions asks, and the reply becomes the job", async () => {
    const { helpRequestId } = await newHelp({ kinds: ["screenshot"], screenshot: true });
    await tap(`invi:${helpRequestId}`, 500);
    const question = lastOf("sendMessage")!;
    expect(question.body.text).toContain("What should the agent look into?");
    expect(question.body.reply_markup).toMatchObject({ force_reply: true });
    const questionId = lastId();
    await reply("Check whether YouTube is signed in", questionId);
    const [job] = await jobs();
    expect(job?.prompt).toContain("Check whether YouTube is signed in");
    expect(job?.helpRequestId).toBe(helpRequestId);
    expect(job?.source).toBe("telegram");
  });

  it("Message Mom's screen asks, and the reply shows on her screen", async () => {
    const { token, helpRequestId } = await newHelp({ kinds: ["call-me"] });
    await tap(`say:${helpRequestId}`, 500);
    const question = lastOf("sendMessage")!;
    expect(question.body.text).toBe("What should Mom's screen say? Reply to this message.");
    expect(question.body.reply_markup.input_field_placeholder).toBe('Shows as "Sam says: …"');
    await reply("I'll call you after lunch.", lastId());
    expect((await pending(token)).map((p) => p.action)).toEqual([{ type: "say", text: "I'll call you after lunch." }]);
    expect(texts().at(-1)).toBe("Showing on Mom's screen.");
    const help = await t.run((ctx) => ctx.db.get(helpRequestId));
    expect(help?.replies.map((r) => r.text)).toEqual(["I'll call you after lunch."]);
  });

  it("Screenshot sends the picture back to the chat", async () => {
    const { token, helpRequestId } = await newHelp({ kinds: ["call-me"] });
    await tap(`shot:${helpRequestId}`, 500);
    const [action] = await pending(token);
    expect(action?.action).toEqual({ type: "screenshot" });
    const storageId = await t.run((ctx) => ctx.storage.store(new Blob(["png"])));
    await t.mutation(api.device.attachScreenshot, { deviceToken: token, actionId: action!._id, storageId });
    await complete(token, action!._id, true);
    const photo = lastOf("sendPhoto")!;
    expect(photo.body.caption).toBe("Mom's screen now.");
    expect(photo.body.reply_parameters.message_id).toBe(500);
  });

  it("Last 10 minutes sends the ring buffer as an album, oldest first", async () => {
    const { token, helpRequestId } = await newHelp({ kinds: ["call-me"] });
    await tap(`last:${helpRequestId}`, 500);
    const [action] = await pending(token);
    expect(action?.action).toEqual({ type: "recent-screens" });
    const now = Date.now();
    const screens = await t.run(async (ctx) => [
      { storageId: await ctx.storage.store(new Blob(["b"])), takenAt: now - 2 * 60_000 },
      { storageId: await ctx.storage.store(new Blob(["a"])), takenAt: now - 9 * 60_000 },
    ]);
    await t.mutation(api.device.attachScreens, { deviceToken: token, actionId: action!._id, screens });
    await complete(token, action!._id, true);
    const album = lastOf("sendMediaGroup")!;
    expect(album.body.media.map((m: { caption?: string }) => m.caption)).toEqual([
      "Mom's screen, oldest first. This one: 9 min ago.",
      "2 min ago",
    ]);
  });

  it("Last 10 minutes with nothing in the ring buffer says why", async () => {
    const { token, helpRequestId } = await newHelp({ kinds: ["call-me"] });
    await tap(`last:${helpRequestId}`, 500);
    const [action] = await pending(token);
    await complete(token, action!._id, true, "no pictures: the screen was off or locked");
    expect(texts().at(-1)).toBe("No pictures from the last few minutes on Mom's laptop. no pictures: the screen was off or locked");
  });

  it("Restart asks first, and only Yes restarts", async () => {
    const { token, helpRequestId, deviceId } = await newHelp({ kinds: ["call-me"] });
    await tap(`rst:${helpRequestId}`, 500);
    const question = lastOf("sendMessage")!;
    expect(question.body.text).toContain("Restart Mom's laptop (laptop)?");
    expect(buttonTexts(question)).toEqual(["Yes, restart", "No"]);
    const questionId = lastId();
    await tap(`rstn:${deviceId}`, questionId);
    expect(toast()).toBe("Not restarting.");
    expect(lastOf("editMessageReplyMarkup")?.body.reply_markup).toEqual({ inline_keyboard: [] });
    expect(await pending(token)).toEqual([]);
    await tap(`rsty:${deviceId}`, questionId);
    expect((await pending(token)).map((p) => p.action)).toEqual([{ type: "restart" }]);
  });

  it("Yes on an old restart question does nothing", async () => {
    const { token, helpRequestId, deviceId } = await newHelp({ kinds: ["call-me"] });
    await tap(`rst:${helpRequestId}`, 500);
    const questionId = lastId();
    vi.advanceTimersByTime(RESTART_CONFIRM_MS + 1000);
    await tap(`rsty:${deviceId}`, questionId);
    expect(texts().at(-1)).toContain("too old");
    expect(await pending(token)).toEqual([]);
  });

  it("Yes on a message that isn't a restart question does nothing", async () => {
    const { token, deviceId } = await newHelp({ kinds: ["call-me"] });
    await tap(`rsty:${deviceId}`, 500);
    expect(toast()).toBe("That question isn't mine.");
    expect(await pending(token)).toEqual([]);
  });
});

describe("when an action doesn't happen", () => {
  it("tells the helper why a restart was refused", async () => {
    const { token, helpRequestId, deviceId } = await newHelp({ kinds: ["call-me"] });
    await tap(`rst:${helpRequestId}`, 500);
    await tap(`rsty:${deviceId}`, lastId());
    const [action] = await pending(token);
    await complete(token, action!._id, false, "refused: the disk asks for its passphrase at startup");
    expect(texts().at(-1)).toBe(
      "The restart didn't happen on Mom's laptop: refused: the disk asks for its passphrase at startup",
    );
  });

  it("says so when the laptop doesn't pick an action up", async () => {
    const { token, helpRequestId } = await newHelp({ kinds: ["call-me"] });
    await t.run((ctx) => ctx.db.query("devices").first().then((d) => ctx.db.patch(d!._id, { lastSeenAt: Date.now() - 20 * 60_000 })));
    await tap(`shot:${helpRequestId}`, 500);
    vi.advanceTimersByTime(ACTION_WAIT_MS);
    await t.finishInProgressScheduledFunctions();
    expect(texts().at(-1)).toBe(
      "The screenshot hasn't reached Mom's laptop yet. It looks offline; it was last heard from 22 min ago. It stays queued and happens when the laptop is back.",
    );
    expect(await pending(token)).toHaveLength(1);
  });

  it("stays quiet when a message reached her screen", async () => {
    const { token, helpRequestId } = await newHelp({ kinds: ["call-me"] });
    await reply("On my way", 500);
    const [action] = await pending(token);
    const before = sent.length;
    await complete(token, action!._id, true);
    vi.advanceTimersByTime(ACTION_WAIT_MS);
    await t.finishInProgressScheduledFunctions();
    expect(sent.length).toBe(before);
    expect(helpRequestId).toBeTruthy();
  });
});

describe("agent reports", () => {
  async function report(jobId: Id<"jobs">, status: "awaiting_approval" | "done", extra: { suggestedMessage?: string } = {}) {
    await t.mutation(api.dispatcher.claimJob, { dispatcherToken: DISPATCHER_TOKEN, jobId, workerId: "w", leaseMs: 60_000 });
    await t.mutation(api.dispatcher.updateJob, {
      dispatcherToken: DISPATCHER_TOKEN,
      jobId,
      workerId: "w",
      status,
      report: "YouTube is signed out.",
      sessionId: "session-1",
      ...extra,
    });
    await settle();
    return lastOf("sendMessage")!;
  }

  it("come back as a reply to her help message, with buttons", async () => {
    await newHelp({ text: "It says sign in", kinds: ["message"], auto: true });
    const [job] = await jobs();
    const msg = await report(job!._id, "awaiting_approval", { suggestedMessage: "I'm fixing YouTube for you. Give me five minutes." });
    expect(msg.body.reply_parameters.message_id).toBe(500);
    expect(msg.body.text).toContain("YouTube is signed out.");
    expect(msg.body.text).toContain("Suggested message for Mom: “I'm fixing YouTube for you. Give me five minutes.”");
    expect(buttonTexts(msg)).toEqual(["Approve fix", "Investigate more", "Send this to Mom", "Dismiss"]);
  });

  it("Approve fix approves, and only once", async () => {
    await newHelp({ text: "It says sign in", kinds: ["message"], auto: true });
    const [job] = await jobs();
    await report(job!._id, "awaiting_approval");
    const reportId = lastId();
    await tap(`apv:${job!._id}`, reportId);
    expect((await t.run((ctx) => ctx.db.get(job!._id)))?.status).toBe("approved");
    expect(lastOf("editMessageReplyMarkup")).toBeTruthy();
    await tap(`apv:${job!._id}`, reportId);
    expect(toast()).toContain("nothing to approve");
  });

  it("Send this to Mom puts the suggestion on her screen", async () => {
    const { token } = await newHelp({ text: "It says sign in", kinds: ["message"], auto: true });
    const [job] = await jobs();
    await report(job!._id, "done", { suggestedMessage: "Everything looks fine now." });
    await tap(`send:${job!._id}`, lastId());
    expect((await pending(token)).map((p) => p.action)).toEqual([{ type: "say", text: "Everything looks fine now." }]);
    expect(toast()).toBe("Sent to Mom's screen.");
  });

  it("Investigate more resumes the same session with his instructions", async () => {
    await newHelp({ text: "It says sign in", kinds: ["message"], auto: true });
    const [job] = await jobs();
    await report(job!._id, "awaiting_approval");
    await tap(`more:${job!._id}`, lastId());
    expect(lastOf("sendMessage")!.body.reply_markup).toMatchObject({ force_reply: true });
    await reply("Is it only YouTube, or Gmail too?", lastId());
    const all = await jobs();
    const followUp = all.find((j) => j._id !== job!._id)!;
    expect(followUp).toMatchObject({
      status: "queued",
      prompt: "Is it only YouTube, or Gmail too?",
      resumeSessionId: "session-1",
      parentJobId: job!._id,
      helpRequestId: job!.helpRequestId,
    });
    expect(all.find((j) => j._id === job!._id)?.status).toBe("cancelled");
    const pendingJobs = await t.query(api.dispatcher.pendingJobs, { dispatcherToken: DISPATCHER_TOKEN });
    expect(pendingJobs.map((j) => j.resumeSessionId)).toEqual(["session-1"]);
  });

  it("Dismiss cancels a waiting fix and takes the buttons off", async () => {
    await newHelp({ text: "It says sign in", kinds: ["message"], auto: true });
    const [job] = await jobs();
    await report(job!._id, "awaiting_approval");
    await tap(`dis:${job!._id}`, lastId());
    expect((await t.run((ctx) => ctx.db.get(job!._id)))?.status).toBe("cancelled");
    expect(lastOf("editMessageReplyMarkup")?.body.reply_markup).toEqual({ inline_keyboard: [] });
  });
});

describe("commands", () => {
  it("/run and /look start an agent with his own instructions", async () => {
    await newHelp({ kinds: ["call-me"] });
    sent = [];
    await reply("/run Check the battery health");
    await reply("/look why is the sound off?");
    const all = await jobs();
    expect(all.map((j) => j.prompt.split("\n")[0])).toEqual(["Check the battery health", "why is the sound off?"]);
    expect(all.every((j) => j.source === "telegram" && j.helpRequestId === undefined)).toBe(true);
    expect(texts()).toEqual([
      "Sent an agent to look at Mom's laptop. The report will come here.",
      "Sent an agent to look at Mom's laptop. The report will come here.",
    ]);
  });

  it("/run's report replies to the message that started it", async () => {
    await newHelp({ kinds: ["call-me"] });
    await reply("/run Check the battery health");
    const startedId = lastId();
    const [job] = await jobs();
    await t.mutation(api.dispatcher.claimJob, { dispatcherToken: DISPATCHER_TOKEN, jobId: job!._id, workerId: "w", leaseMs: 60_000 });
    await t.mutation(api.dispatcher.updateJob, { dispatcherToken: DISPATCHER_TOKEN, jobId: job!._id, workerId: "w", status: "done", report: "Fine." });
    await settle();
    expect(lastOf("sendMessage")!.body.reply_parameters.message_id).toBe(startedId);
  });

  it("/run picks a device by name when there are several", async () => {
    await newHelp({ kinds: ["call-me"] });
    const other = await addDevice(t, "token-b", "desk");
    await reply("/run check it");
    expect(texts().at(-1)).toContain("Which one?");
    await reply("/run desk: check the sound");
    const [job] = await jobs();
    expect(job?.deviceId).toBe(other.deviceId);
    expect(job?.prompt.split("\n")[0]).toBe("check the sound");
  });

  it("/screenshot asks for a picture", async () => {
    const { token } = await newHelp({ kinds: ["call-me"] });
    await reply("/screenshot");
    expect((await pending(token)).map((p) => p.action)).toEqual([{ type: "screenshot" }]);
    expect(texts().at(-1)).toBe("Asking Mom's laptop for a picture.");
  });
});

describe("admin app", () => {
  it("shows her words, kinds and voice, and has Got it, Send an agent and Done", async () => {
    const { token, helpRequestId } = await newHelp({ kinds: ["voice", "call-me"], voiceBytes: 100 });
    const [row] = await t.withIdentity(ADMIN).query(api.admin.helpRequests, {});
    expect(row?.kinds).toEqual(["voice", "call-me"]);
    expect(row?.voiceUrl).toBeTypeOf("string");
    expect(await t.withIdentity(ADMIN).mutation(api.admin.markHelpSeen, { helpRequestId })).toEqual({ already: false });
    expect((await pending(token)).map((p) => p.action.type)).toEqual(["help-seen"]);
    const first = await t.withIdentity(ADMIN).mutation(api.admin.investigateHelp, { helpRequestId, instructions: "She means the TV, not the laptop." });
    expect(first.created).toBe(true);
    const [job] = await jobs();
    expect(job?.prompt).toContain('Sam\'s note for you:\n"""\nShe means the TV, not the laptop.\n"""');
    // Without a note, not a second one while that one is looking.
    expect((await t.withIdentity(ADMIN).mutation(api.admin.investigateHelp, { helpRequestId })).created).toBe(false);
    await t.withIdentity(ADMIN).mutation(api.admin.closeHelpRequest, { helpRequestId });
    expect((await t.run((ctx) => ctx.db.get(helpRequestId)))?.status).toBe("closed");
  });
});
