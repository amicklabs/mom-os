# backend

The Convex backend: schema, functions, crons and the Telegram webhook. Everything lives in `convex/`.

| File | Called by | Auth |
|---|---|---|
| `device.ts` | momd | device token, stored as a SHA-256 hash |
| `admin.ts`, `reminders.ts`, `slideshow.ts`, `reports.ts` | the admin app | Clerk, and an email in `ADMIN_EMAILS` |
| `dispatcher.ts` | the dispatcher and `mom` | `DISPATCHER_TOKEN` |
| `http.ts`, `telegram.ts` | Telegram | `TELEGRAM_WEBHOOK_SECRET`, and a sender in `TELEGRAM_ADMIN_IDS` |
| `provision.ts` | `npx convex run`, `mom devices create` | deploy access to the project |
| `crons.ts`, `cleanup.ts` | Convex | internal |

## Deploy

```sh
npx convex dev --once          # or: pnpm --filter @momos/backend push
npx convex env set NAME value
```

The first run creates the project and writes `.env.local`. [docs/setup/03-convex.md](../../docs/setup/03-convex.md) lists every environment variable.

## Test

```sh
pnpm --filter @momos/backend test
pnpm --filter @momos/backend typecheck
```

Tests run against `convex-test` with no deployment.

Every function, its arguments and its auth: [docs/contracts.md](../../docs/contracts.md#convex-api).
