import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "./_generated/api";
import { ADMIN, ADMIN_TG_ID, addDevice, DISPATCHER_TOKEN, newBackend, settings, WEBHOOK_SECRET, type Backend } from "./test.setup";
import type { SettingsDoc } from "./validators";

// Reloading one of her pages: the admin app's Reload buttons and the bot's
// /reload command and menu.

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
  nextId = 700;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit) => {
      const id = nextId++;
      sent.push({ method: url.split("/").pop()!, body: JSON.parse(String(init.body)), id });
      return new Response(JSON.stringify({ ok: true, result: { message_id: id } }));
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

async function settle() {
  for (let i = 0; i < 3; i++) {
    vi.advanceTimersByTime(1);
    await t.finishInProgressScheduledFunctions();
  }
}

const withPages: SettingsDoc = {
  ...settings,
  tiles: [
    ...settings.tiles,
    { id: "recipes", label: "Recipes", type: "webapp", url: "https://recipes.example.com/pages/welcome" },
    { id: "telegram", label: "Telegram", type: "app", app: "telegram" },
    { id: "family", label: "Family", type: "page", page: "family" },
  ],
};

async function device(token = "device-token", name = "laptop") {
  const d = await addDevice(t, token, name);
  await t.withIdentity(ADMIN).mutation(api.admin.updateSettings, { deviceId: d.deviceId, settings: withPages });
  return d;
}

const pending = (token: string) => t.query(api.device.pendingActions, { deviceToken: token });
const texts = () => sent.filter((s) => s.method === "sendMessage").map((s) => s.body.text as string);
const lastMessage = () => [...sent].reverse().find((s) => s.method === "sendMessage")!;
const buttons = (s: Sent) => (s.body.reply_markup?.inline_keyboard ?? []).flat() as { text: string; callback_data: string }[];

let myMessage = 9000;
async function message(text: string, replyTo?: number) {
  await t.fetch("/telegram/webhook", {
    method: "POST",
    headers: { "content-type": "application/json", "X-Telegram-Bot-Api-Secret-Token": WEBHOOK_SECRET },
    body: JSON.stringify({
      update_id: 1,
      message: {
        message_id: myMessage++,
        chat: { id: Number(ADMIN_TG_ID) },
        from: { id: Number(ADMIN_TG_ID) },
        text,
        ...(replyTo ? { reply_to_message: { message_id: replyTo } } : {}),
      },
    }),
  });
  await settle();
}

async function tap(data: string, messageId: number) {
  await t.fetch("/telegram/webhook", {
    method: "POST",
    headers: { "content-type": "application/json", "X-Telegram-Bot-Api-Secret-Token": WEBHOOK_SECRET },
    body: JSON.stringify({
      update_id: 1,
      callback_query: { id: "cb", from: { id: Number(ADMIN_TG_ID) }, data, message: { message_id: messageId, chat: { id: Number(ADMIN_TG_ID) } } },
    }),
  });
  await settle();
}

describe("reload from the admin app", () => {
  it("queues a reload of one of her web pages", async () => {
    const { deviceId, token } = await device();
    await t.withIdentity(ADMIN).mutation(api.admin.queueAction, { deviceId, action: { type: "reload", tileId: "recipes" } });
    await t.withIdentity(ADMIN).mutation(api.admin.queueAction, { deviceId, action: { type: "reload", tileId: "internet" } });
    expect((await pending(token)).map((p) => p.action)).toEqual([
      { type: "reload", tileId: "recipes" },
      { type: "reload", tileId: "internet" },
    ]);
  });

  it("refuses tiles she doesn't have and tiles that aren't web pages", async () => {
    const { deviceId, token } = await device();
    const queue = (tileId: string) => t.withIdentity(ADMIN).mutation(api.admin.queueAction, { deviceId, action: { type: "reload", tileId } });
    await expect(queue("nope")).rejects.toThrow("No tile with id nope");
    await expect(queue("telegram")).rejects.toThrow("Telegram isn't a web page");
    await expect(queue("family")).rejects.toThrow("Family isn't a web page");
    await expect(queue("Not An Id")).rejects.toThrow("Invalid action");
    expect(await pending(token)).toEqual([]);
  });

  it("refuses everything on a device with no settings yet", async () => {
    const { deviceId, token } = await addDevice(t, "bare", "bare");
    await expect(
      t.withIdentity(ADMIN).mutation(api.admin.queueAction, { deviceId, action: { type: "reload", tileId: "youtube" } }),
    ).rejects.toThrow("No tile with id youtube");
    expect(await pending(token)).toEqual([]);
  });
});

describe("/reload on Telegram", () => {
  it("lists her web pages as buttons, and a tap reloads one", async () => {
    const { token } = await device();
    await message("/reload");
    const menu = lastMessage();
    expect(menu.body.text).toContain("Which page should I reload on Mom's laptop (laptop)?");
    expect(menu.body.text).toContain('"Sam refreshed <page>."');
    expect(buttons(menu).map((b) => [b.text, b.callback_data])).toEqual([
      ["YouTube", "rld:youtube"],
      ["Browser", "rld:internet"],
      ["Recipes", "rld:recipes"],
    ]);
    await tap("rld:recipes", menu.id);
    expect((await pending(token)).map((p) => p.action)).toEqual([{ type: "reload", tileId: "recipes" }]);
    const toast = sent.find((s) => s.method === "answerCallbackQuery")!;
    expect(toast.body.text).toBe("Reloading Recipes on Mom's laptop.");
  });

  it("takes a page by id or label, and says how it went", async () => {
    const { token } = await device();
    await message("/reload Recipes");
    expect(texts().at(-1)).toBe("Reloading Recipes on Mom's laptop.");
    await message("/reload youtube");
    const actions = await pending(token);
    expect(actions.map((p) => p.action)).toEqual([
      { type: "reload", tileId: "recipes" },
      { type: "reload", tileId: "youtube" },
    ]);

    await t.mutation(api.device.completeAction, { deviceToken: token, actionId: actions[0]!._id, ok: true, result: "reloaded Recipes" });
    await settle();
    expect(texts().at(-1)).toBe("Reloaded Recipes on Mom's laptop.");
    await t.mutation(api.device.completeAction, { deviceToken: token, actionId: actions[1]!._id, ok: false, result: "the screen is locked" });
    await settle();
    expect(texts().at(-1)).toBe("The reload didn't happen on Mom's laptop: the screen is locked");
  });

  it("answers an unknown page with the menu, and a non-web tile with why not", async () => {
    const { token } = await device();
    await message("/reload weather");
    expect(lastMessage().body.text).toMatch(/^Mom has no page called "weather". Which page/);
    expect(buttons(lastMessage())).toHaveLength(3);
    await message("/reload telegram");
    expect(texts().at(-1)).toContain("Telegram isn't a web page");
    expect(await pending(token)).toEqual([]);
  });

  it("with several devices, asks which or takes a name first", async () => {
    await device("token-a", "air");
    await device("token-b", "desk");
    await message("/reload recipes");
    expect(texts().at(-1)).toContain("Which one? Send /reload followed by one of: air, desk.");
    await message("/reload desk recipes");
    expect((await pending("token-b")).map((p) => p.action)).toEqual([{ type: "reload", tileId: "recipes" }]);
    expect(await pending("token-a")).toEqual([]);
    await message("/reload air");
    const menu = lastMessage();
    expect(menu.body.text).toContain("(air)");
    await tap("rld:youtube", menu.id);
    expect((await pending("token-a")).map((p) => p.action)).toEqual([{ type: "reload", tileId: "youtube" }]);
  });

  it("ignores a reload button on a message that isn't a reload menu", async () => {
    const { token } = await device();
    await message("/status");
    await tap("rld:recipes", lastMessage().id);
    expect(await pending(token)).toEqual([]);
    expect(sent.find((s) => s.method === "answerCallbackQuery")!.body.text).toBe("That menu isn't mine.");
  });
});
