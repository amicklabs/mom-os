# 3. Convex backend

Convex holds the data: heartbeats, events, settings, help requests, reminders, photos, agent jobs and weekly reports. It also receives the Telegram bot's messages. The laptop, the admin app and the dispatcher all connect to it outbound. Nothing connects in to your home.

Do this step on your machine.

## Create the deployment

Make a free account at [convex.dev](https://convex.dev), then push the backend:

```sh
cd ~/src/mom-os/packages/backend
npx convex dev --once
```

The first run asks you to log in and to create a project. It writes `packages/backend/.env.local` with two lines you'll need:

- `CONVEX_DEPLOYMENT`, which tells the Convex CLI which deployment to use;
- `CONVEX_URL`, ending in `.convex.cloud`. The laptop, `mom` and the admin app connect here.

The same deployment also answers HTTP at the same name ending in `.convex.site`. The Telegram webhook goes there.

This guide uses that one deployment, which Convex calls the dev deployment, for everything. It runs crons and HTTP routes like any other, and `mom devices create` talks to it through `.env.local`. If you'd rather use a separate production deployment from `npx convex deploy`, add `--prod` to every `npx convex env set` and `npx convex run` below, and to `mom devices create` in step 7.

After you pull new MomOS code, push the functions again with `npx convex dev --once`, or `pnpm --filter @momos/backend push` from the repo root.

## Set the environment variables

Convex functions read their secrets from the deployment's environment. Set them from `packages/backend`. You'll set the Telegram ones in [step 4](04-telegram.md) and the Clerk ones in [step 10](10-admin-app.md).

The dispatcher token is a shared secret between Convex and the dispatcher. `mom help-requests` and `mom jobs` use it too. Make one and keep a copy on the machine that will run the dispatcher, in the file `mom` and the dispatcher read by default:

```sh
mkdir -p ~/.config/momos
openssl rand -hex 32 > ~/.config/momos/dispatcher-token
chmod 600 ~/.config/momos/dispatcher-token
tr -d '\n' < ~/.config/momos/dispatcher-token | npx convex env set DISPATCHER_TOKEN
```

Piping the value in keeps it out of your shell history.

The weekly report goes out on Sunday between 6 and 7 PM in `REPORT_TIMEZONE`. The default is `America/New_York`. Set it to yours:

```sh
npx convex env set REPORT_TIMEZONE Europe/London
```

All the variables, for reference:

| Variable | Set in | What it is |
|---|---|---|
| `DISPATCHER_TOKEN` | this step | shared secret for the dispatcher and `mom` |
| `REPORT_TIMEZONE` | this step | time zone for the Sunday report, optional |
| `TELEGRAM_BOT_TOKEN` | step 4 | from BotFather |
| `TELEGRAM_WEBHOOK_SECRET` | step 4 | a random string Telegram sends back on every webhook call |
| `TELEGRAM_ADMIN_IDS` | step 4 | your numeric Telegram user ID, comma-separated if more than one |
| `CLERK_JWT_ISSUER_DOMAIN` | step 10 | your Clerk Frontend API URL |
| `ADMIN_EMAILS` | step 10 | emails allowed into the admin app, comma-separated |
| `ADMIN_APP_URL` | step 10 | the admin app's https address, optional. Adds Watch Mom's screen under help requests on Telegram. |

Anything missing turns that feature off without breaking the rest. With no Telegram variables, help requests still land in the admin app. With no Clerk variables, the admin app can't sign in, but the laptop and dispatcher work.

## What Convex keeps, and for how long

Daily cron jobs delete events, help screenshots, actions, Telegram message links and recorded silences after 60 days. Help requests stay, without their pictures. Settings, reminders, screensaver photos, jobs and weekly reports stay. [security.md](../security.md) lists what each table holds.

Next: [Telegram bot](04-telegram.md).
