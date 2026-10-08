# 4. Telegram bot

The bot is how the laptop reaches you. When she asks for help, it sends you her words, her screen or her voice note. When an agent finishes, it sends you the report. You answer with the buttons under its messages or by replying to them.

The bot only talks to Telegram user IDs you list. Anyone else who finds it gets no answer.

Do this step on your machine, with Telegram open on your phone.

## Make the bot

1. In Telegram, open a chat with [@BotFather](https://t.me/BotFather) and send `/newbot`.
2. Give it a display name, like "Mom's laptop", and a username ending in `bot`.
3. BotFather replies with a token like `123456789:AA...`. Treat it like a password.

## Find your user ID

Open a chat with your new bot and press **Start**, which sends it `/start`. Then, before setting the webhook, ask Telegram what the bot received:

```sh
read -rs BOT_TOKEN   # paste the token, press Enter
curl -s "https://api.telegram.org/bot$BOT_TOKEN/getUpdates" | jq '.result[].message.from | {id, first_name}'
```

The `id` is your numeric user ID. If the list is empty, send the bot another message and run it again. `getUpdates` stops working once a webhook is set, so do this first.

To let a second person use the bot, have them press Start too and add their ID.

## Tell Convex about the bot

From `packages/backend`:

```sh
printf '%s' "$BOT_TOKEN" | npx convex env set TELEGRAM_BOT_TOKEN
WEBHOOK_SECRET=$(openssl rand -hex 32)
printf '%s' "$WEBHOOK_SECRET" | npx convex env set TELEGRAM_WEBHOOK_SECRET
npx convex env set TELEGRAM_ADMIN_IDS 123456789
```

Use your own ID in the last line. Separate several IDs with commas.

## Point the bot at Convex

The webhook URL is your deployment's `.convex.site` address with `/telegram/webhook` on the end. If `CONVEX_URL` in `packages/backend/.env.local` is `https://happy-animal-123.convex.cloud`, the webhook is `https://happy-animal-123.convex.site/telegram/webhook`.

```sh
curl -s "https://api.telegram.org/bot$BOT_TOKEN/setWebhook" \
  -d url=https://happy-animal-123.convex.site/telegram/webhook \
  -d secret_token="$WEBHOOK_SECRET" \
  -d allowed_updates='["message","callback_query"]'
```

Telegram answers `{"ok":true,...}`. From then on it sends every message to Convex with the secret in the `X-Telegram-Bot-Api-Secret-Token` header. Convex rejects any request without it, and ignores any message whose sender isn't in `TELEGRAM_ADMIN_IDS`.

## Check it

Send the bot `/status`. It answers "No devices yet." until you create one in step 7. Later it lists each laptop, whether it's online and its battery.

If nothing comes back, ask Telegram what went wrong:

```sh
curl -s "https://api.telegram.org/bot$BOT_TOKEN/getWebhookInfo" | jq
```

`last_error_message` of "Wrong response from the webhook: 401" means the secret doesn't match. "503" means `TELEGRAM_WEBHOOK_SECRET` or `TELEGRAM_ADMIN_IDS` isn't set on the deployment. If Telegram reports no error but the bot stays silent, check `TELEGRAM_BOT_TOKEN`, which the bot needs to answer.

Then clear the variables from your shell:

```sh
unset BOT_TOKEN WEBHOOK_SECRET
```

[using/telegram.md](../using/telegram.md) covers everything you can say to the bot.

Next: [install `mom`](05-mom.md).
