// Shown instead of the app when required environment variables are missing.
export function SetupPage({ missing }: { missing: string[] }) {
  return (
    <main className="mx-auto flex min-h-dvh max-w-xl flex-col gap-5 p-6">
      <h1 className="text-2xl font-semibold">MomOS admin needs setting up</h1>
      <p className="text-stone-600 dark:text-stone-400">These environment variables are missing:</p>
      <ul className="flex flex-col gap-1">
        {missing.map((name) => (
          <li key={name}>
            <code className="rounded bg-stone-200 px-2 py-0.5 text-sm dark:bg-stone-800">{name}</code>
          </li>
        ))}
      </ul>
      <ol className="flex list-decimal flex-col gap-2 pl-5 text-sm text-stone-700 dark:text-stone-300">
        <li>
          Create a Clerk application. Copy its publishable and secret keys into <code>apps/admin/.env.local</code> (or the
          Vercel project).
        </li>
        <li>
          In Clerk, turn on the Convex integration or add a JWT template named <code>convex</code>, with the{" "}
          <code>email</code> and <code>email_verified</code> claims.
        </li>
        <li>
          Set <code>NEXT_PUBLIC_CONVEX_URL</code> to the Convex deployment URL.
        </li>
        <li>
          On the Convex deployment, set <code>CLERK_JWT_ISSUER_DOMAIN</code> to the Clerk Frontend API URL and{" "}
          <code>ADMIN_EMAILS</code> to the emails allowed in.
        </li>
      </ol>
      <p className="text-sm text-stone-500">
        <code>apps/admin/.env.example</code> lists every variable.
      </p>
    </main>
  );
}
