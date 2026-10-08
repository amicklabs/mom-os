import { httpRouter } from "convex/server";
import { internal } from "./_generated/api";
import { httpAction } from "./_generated/server";
import { constantTimeEqual } from "./lib/auth";
import { telegramConfig } from "./lib/telegramApi";
import { answerTap, deliver } from "./telegram";

type Message = {
  message_id: number;
  from?: { id: number };
  chat: { id: number };
  text?: string;
  caption?: string;
  reply_to_message?: { message_id: number };
};

type Update = {
  message?: Message;
  // A tap on one of the bot's inline buttons.
  callback_query?: {
    id: string;
    from?: { id: number };
    data?: string;
    message?: { message_id: number; chat: { id: number } };
  };
};

const http = httpRouter();

http.route({
  path: "/telegram/webhook",
  method: "POST",
  handler: httpAction(async (ctx, req) => {
    const cfg = telegramConfig();
    if (!cfg.webhookSecret || cfg.adminIds.length === 0) {
      return new Response("Telegram is not configured", { status: 503 });
    }
    const secret = req.headers.get("X-Telegram-Bot-Api-Secret-Token") ?? "";
    if (!(await constantTimeEqual(secret, cfg.webhookSecret))) {
      return new Response("Forbidden", { status: 401 });
    }

    let update: Update;
    try {
      update = (await req.json()) as Update;
    } catch {
      return new Response("ok");
    }

    // Anything not from an admin gets a 200 and no answer, so Telegram doesn't
    // retry and strangers learn nothing. That goes for taps and messages alike.
    const tap = update.callback_query;
    if (tap) {
      const fromId = tap.from ? String(tap.from.id) : null;
      if (!fromId || !cfg.adminIds.includes(fromId) || !tap.message || !tap.data) {
        if (fromId) console.log(`Ignored a Telegram button tap from non-admin ${fromId}.`);
        return new Response("ok");
      }
      const chatId = String(tap.message.chat.id);
      const plan = await ctx.runMutation(internal.telegram.callback, {
        chatId,
        messageId: tap.message.message_id,
        data: tap.data.slice(0, 64),
      });
      if (cfg.botToken) {
        await answerTap(cfg.botToken, tap.id, chatId, tap.message.message_id, plan);
        await deliver(ctx, cfg.botToken, chatId, plan.messages);
      }
      return new Response("ok");
    }

    const msg = update.message;
    const fromId = msg?.from ? String(msg.from.id) : null;
    if (!msg || !fromId || !cfg.adminIds.includes(fromId)) {
      if (fromId) console.log(`Ignored Telegram message from non-admin ${fromId}.`);
      return new Response("ok");
    }
    const text = msg.text ?? msg.caption;
    if (!text) return new Response("ok");

    const chatId = String(msg.chat.id);
    const plan = await ctx.runMutation(internal.telegram.route, {
      chatId,
      messageId: msg.message_id,
      text,
      replyToMessageId: msg.reply_to_message?.message_id,
    });
    if (cfg.botToken) await deliver(ctx, cfg.botToken, chatId, plan.messages);
    return new Response("ok");
  }),
});

export default http;
