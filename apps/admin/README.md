# admin

The helper's admin app: Next.js, deployed to Vercel, signed in with Clerk. It reads and writes Convex and never connects to the laptop.

Pages: Home, Help, Reminders, Photos, Timeline, Jobs, Reports, Settings and Devices. [docs/using/admin-app.md](../../docs/using/admin-app.md) walks through each.

## Run locally

```sh
cp .env.example .env.local     # fill in the three variables
pnpm --filter @momos/admin dev
```

It needs `NEXT_PUBLIC_CONVEX_URL`, `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` and `CLERK_SECRET_KEY`. With any missing, it shows a setup page listing them. The Convex deployment also needs `CLERK_JWT_ISSUER_DOMAIN` and `ADMIN_EMAILS`. `.env.example` lists them all.

## Check

```sh
pnpm --filter @momos/admin typecheck
pnpm --filter @momos/admin lint
pnpm --filter @momos/admin build
```

The build needs no environment variables.

Deploying to Vercel, and Clerk's development and production keys: [docs/setup/10-admin-app.md](../../docs/setup/10-admin-app.md).
