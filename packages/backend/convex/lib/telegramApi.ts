// Minimal Telegram Bot API client. Plain text only (no parse_mode), so reports
// never fail on unescaped Markdown.

export type TelegramConfig = {
  botToken: string | null;
  webhookSecret: string | null;
  adminIds: string[];
};

export function telegramConfig(): TelegramConfig {
  return {
    botToken: process.env.TELEGRAM_BOT_TOKEN?.trim() || null,
    webhookSecret: process.env.TELEGRAM_WEBHOOK_SECRET?.trim() || null,
    adminIds: (process.env.TELEGRAM_ADMIN_IDS ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter((s) => /^-?\d+$/.test(s)),
  };
}

export function canSend(cfg: TelegramConfig): cfg is TelegramConfig & { botToken: string } {
  return cfg.botToken !== null && cfg.adminIds.length > 0;
}

// An inline keyboard button. `data` comes back in the callback query, at most
// 64 bytes. A button with `url` opens that link instead (https or tg only).
export type Button = { text: string; data?: string; url?: string };

function keyboard(buttons: Button[][]) {
  return buttons.map((row) => row.map((b) => (b.url ? { text: b.text, url: b.url } : { text: b.text, callback_data: b.data ?? "" })));
}

// The admin app's address, from ADMIN_APP_URL, for links like Watch her
// screen. Null when it's unset or not https.
export function adminAppUrl(env: string | undefined = process.env.ADMIN_APP_URL): string | null {
  const raw = env?.trim();
  if (!raw) return null;
  try {
    const url = new URL(raw);
    return url.protocol === "https:" ? url.origin + url.pathname.replace(/\/+$/, "") : null;
  } catch {
    return null;
  }
}

export type SendOptions = {
  replyTo?: number;
  buttons?: Button[][];
  // Ask for a reply: Telegram opens the reply box with this placeholder.
  forceReply?: string;
};

type TelegramMessage = { message_id: number };

async function call<T>(token: string, method: string, body: FormData | Record<string, unknown>): Promise<T> {
  const init: RequestInit =
    body instanceof FormData
      ? { method: "POST", body }
      : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) };
  const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, init);
  const json = (await res.json().catch(() => null)) as { ok: boolean; result?: T; description?: string } | null;
  if (!json?.ok) throw new Error(`Telegram ${method} failed: ${json?.description ?? res.status}`);
  return json.result as T;
}

function replyParameters(replyTo?: number) {
  return replyTo ? { message_id: replyTo, allow_sending_without_reply: true } : undefined;
}

function replyMarkup(o: SendOptions) {
  if (o.forceReply !== undefined) {
    return { force_reply: true, input_field_placeholder: o.forceReply.slice(0, 64) };
  }
  if (o.buttons?.length) {
    return { inline_keyboard: keyboard(o.buttons) };
  }
  return undefined;
}

export async function sendMessage(
  token: string,
  chatId: string,
  text: string,
  opts: SendOptions = {},
): Promise<number> {
  const reply = replyParameters(opts.replyTo);
  const markup = replyMarkup(opts);
  const msg = await call<TelegramMessage>(token, "sendMessage", {
    chat_id: chatId,
    text,
    link_preview_options: { is_disabled: true },
    ...(reply ? { reply_parameters: reply } : {}),
    ...(markup ? { reply_markup: markup } : {}),
  });
  return msg.message_id;
}

// Sends photos as one sendPhoto or as media groups of up to ten. Returns every
// message id, since a reply may point at any of them. `captions` go with the
// photos at the same index.
export async function sendPhotos(
  token: string,
  chatId: string,
  photos: Blob[],
  replyTo?: number,
  captions: (string | undefined)[] = [],
): Promise<number[]> {
  const ids: number[] = [];
  const reply = replyTo ? JSON.stringify(replyParameters(replyTo)) : null;
  for (let start = 0; start < photos.length; start += 10) {
    const chunk = photos.slice(start, start + 10);
    const form = new FormData();
    form.append("chat_id", chatId);
    if (reply) form.append("reply_parameters", reply);
    if (chunk.length === 1) {
      form.append("photo", chunk[0]!, "screen.jpg");
      const caption = captions[start];
      if (caption) form.append("caption", caption.slice(0, 1024));
      ids.push((await call<TelegramMessage>(token, "sendPhoto", form)).message_id);
      continue;
    }
    const media = chunk.map((blob, i) => {
      form.append(`p${i}`, blob, `screen-${start + i}.jpg`);
      const caption = captions[start + i];
      return { type: "photo", media: `attach://p${i}`, ...(caption ? { caption: caption.slice(0, 1024) } : {}) };
    });
    form.append("media", JSON.stringify(media));
    const msgs = await call<TelegramMessage[]>(token, "sendMediaGroup", form);
    ids.push(...msgs.map((m) => m.message_id));
  }
  return ids;
}

// A voice message. Telegram shows Ogg Opus as a voice note with a waveform.
export async function sendVoice(
  token: string,
  chatId: string,
  voice: Blob,
  opts: { replyTo?: number; duration?: number; caption?: string } = {},
): Promise<number> {
  const form = new FormData();
  form.append("chat_id", chatId);
  form.append("voice", voice, "voice.ogg");
  if (opts.duration) form.append("duration", String(Math.round(opts.duration)));
  if (opts.caption) form.append("caption", opts.caption.slice(0, 1024));
  if (opts.replyTo) form.append("reply_parameters", JSON.stringify(replyParameters(opts.replyTo)));
  return (await call<TelegramMessage>(token, "sendVoice", form)).message_id;
}

// Stops the spinner on a tapped button, with an optional short notice.
export async function answerCallbackQuery(token: string, callbackQueryId: string, text?: string): Promise<void> {
  await call<boolean>(token, "answerCallbackQuery", {
    callback_query_id: callbackQueryId,
    ...(text ? { text: text.slice(0, 200) } : {}),
  });
}

// Replaces a message's buttons, or removes them with an empty list.
export async function editButtons(token: string, chatId: string, messageId: number, buttons: Button[][]): Promise<void> {
  await call<unknown>(token, "editMessageReplyMarkup", {
    chat_id: chatId,
    message_id: messageId,
    reply_markup: { inline_keyboard: keyboard(buttons) },
  });
}
