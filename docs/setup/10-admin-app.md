# 10. Admin app on Vercel with Clerk

The admin app is a Next.js site that works on your phone and your computer. It reads and writes Convex and never touches the laptop directly. Clerk handles sign-in, and Convex only answers the email addresses you list.

This step is optional. Without it you still have the bot, `mom` and the Convex dashboard, but settings, reminders and screensaver photos are much easier here.

Do this step on your machine.

## Clerk

1. Make an application at [clerk.com](https://clerk.com). Email sign-in is enough. Google sign-in works too.
2. Connect it to Convex. In the Clerk dashboard, turn on the Convex integration. If your dashboard doesn't offer it, make a JWT template named `convex` with the `email` and `email_verified` claims.
3. Note three values from the dashboard: the publishable key, starting `pk_`, the secret key, starting `sk_`, and the Frontend API URL, like `https://your-app.clerk.accounts.dev`.

Tell Convex which Clerk to trust and who may sign in, then push again so the auth config picks up the new value. From `packages/backend`:

```sh
npx convex env set CLERK_JWT_ISSUER_DOMAIN https://your-app.clerk.accounts.dev
npx convex env set ADMIN_EMAILS you@example.com
npx convex dev --once
```

`ADMIN_EMAILS` is comma-separated. The email must be verified in Clerk. Anyone else can sign in to Clerk but gets nothing from Convex.

## Try it locally

```sh
cd ~/src/mom-os/apps/admin
cp .env.example .env.local
```

Fill in `.env.local`:

```sh
NEXT_PUBLIC_CONVEX_URL=https://happy-animal-123.convex.cloud
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_...
CLERK_SECRET_KEY=sk_test_...
```

Then run it and open http://localhost:3000:

```sh
pnpm --filter @momos/admin dev
```

With any of the three missing, the app shows a setup page listing what's missing instead of failing.

## Deploy to Vercel

1. In [Vercel](https://vercel.com), add a new project and import your copy of this repo.
2. Set **Root Directory** to `apps/admin`. Vercel detects Next.js and pnpm.
3. Add the same three environment variables.
4. Deploy.

The app sends `X-Robots-Tag: noindex` so search engines leave it alone.

On your phone, open the site and add it to the home screen. For the Screen page, install Tailscale on the phone too and sign in as yourself; see [Screen sharing in the admin app](08-tailscale-and-firewall.md#screen-sharing-in-the-admin-app).

## Clerk development and production keys

Clerk gives every application a development instance first. Its keys start with `pk_test_` and `sk_test_`, work on any domain, including `localhost` and `your-project.vercel.app`, and show a small "Development mode" badge. For one family that's fine.

A Clerk production instance, with `pk_live_` keys, only works on the domain you set it up for. It won't work on a `vercel.app` address. To use one:

1. Add a domain you own to the Vercel project, like `mom.example.com`.
2. Create the production instance in Clerk for that domain and add the DNS records Clerk asks for.
3. Put the `pk_live_` and `sk_live_` keys in Vercel.
4. Set `CLERK_JWT_ISSUER_DOMAIN` on Convex to the production Frontend API URL, usually `https://clerk.mom.example.com`, and push again with `npx convex dev --once`.

If sign-in works but the app says "Not allowed", check that `ADMIN_EMAILS` has your email exactly and that Clerk shows it as verified.

[using/admin-app.md](../using/admin-app.md) walks through each page.

Next: [dispatcher and bar widget](11-dispatcher.md).
