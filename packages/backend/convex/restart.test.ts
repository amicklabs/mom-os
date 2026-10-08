import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "./_generated/api";
import { RESTART_CONFIRM_MS } from "./telegram";
import { ADMIN, ADMIN_TG_ID, addDevice, newBackend, settings, WEBHOOK_SECRET, type Backend } from "./test.setup";

let t: Backend;
let sent: { text: string; reply_parameters?: { message_id: number } }[];
let nextId: number;

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubEnv("ADMIN_EMAILS", ADMIN.email);
  vi.stubEnv("TELEGRAM_BOT_TOKEN", "123:abc");
  vi.stubEnv("TELEGRAM_WEBHOOK_SECRET", WEBHOOK_SECRET);
  vi.stubEnv("TELEGRAM_ADMIN_IDS", ADMIN_TG_ID);
  sent = [];
  nextId = 700;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init: RequestInit) => {
      sent.push(JSON.parse(String(init.body)));
      return new Response(JSON.stringify({ ok: true, result: { message_id: nextId++ } }));
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

function webhook(text: string, replyTo?: number, fromId = Number(ADMIN_TG_ID)) {
  return t.fetch("/telegram/webhook", {
    method: "POST",
    headers: { "content-type": "application/json", "X-Telegram-Bot-Api-Secret-Token": WEBHOOK_SECRET },
    body: JSON.stringify({
      update_id: 1,
      message: {
        message_id: 900,
        chat: { id: Number(ADMIN_TG_ID) },
        from: { id: fromId },
        text,
        ...(replyTo ? { reply_to_message: { message_id: replyTo } } : {}),
      },
    }),
  });
}

async function device(token = "device-token", name = "laptop") {
  const d = await addDevice(t, token, name);
  await t.withIdentity(ADMIN).mutation(api.admin.updateSettings, { deviceId: d.deviceId, settings });
  return d;
}

const pending = (token: string) => t.query(api.device.pendingActions, { deviceToken: token });

describe("restart", () => {
  it("is an allowlisted action the admin app can queue", async () => {
    const { deviceId, token } = await device();
    await t.withIdentity(ADMIN).mutation(api.admin.queueAction, { deviceId, action: { type: "restart" } });
    expect((await pending(token)).map((p) => p.action)).toEqual([{ type: "restart" }]);
  });

  it("asks on Telegram first and restarts on a yes reply", async () => {
    const { token } = await device();
    await webhook("/restart");
    expect(sent[0]!.text).toContain("Restart Mom's laptop (laptop)?");
    expect(await pending(token)).toEqual([]);
    const question = 700;

    await webhook("yes", question);
    expect((await pending(token)).map((p) => p.action)).toEqual([{ type: "restart" }]);
    expect(sent[1]!.text).toContain("Restarting Mom's laptop.");
  });

  it("does nothing on any other reply, or a yes that comes too late", async () => {
    const { token } = await device();
    await webhook("/restart");
    await webhook("no", 700);
    expect(sent[1]!.text).toContain("Not restarting.");
    await webhook("/restart");
    vi.advanceTimersByTime(RESTART_CONFIRM_MS + 1000);
    await webhook("yes", 702);
    expect(sent[3]!.text).toContain("too old");
    expect(await pending(token)).toEqual([]);
  });

  it("ignores /restart from anyone but an admin", async () => {
    const { token } = await device();
    await webhook("/restart", undefined, 42);
    expect(sent).toEqual([]);
    expect(await pending(token)).toEqual([]);
  });

  it("asks which device when there are several, and takes a name", async () => {
    const a = await device("token-a", "air");
    await device("token-b", "desk");
    await webhook("/restart");
    expect(sent[0]!.text).toContain("Which one?");
    expect(sent[0]!.text).toContain("air");
    await webhook("/restart desk");
    expect(sent[1]!.text).toContain("(desk)?");
    await webhook("/restart nobody");
    expect(sent[2]!.text).toContain('No device called "nobody"');
    await webhook("yes", 701);
    expect(await pending(a.token)).toEqual([]);
    expect((await pending("token-b")).map((p) => p.action.type)).toEqual(["restart"]);
  });
});
