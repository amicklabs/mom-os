"use client";

import { SignInButton, SignOutButton, UserButton, useAuth } from "@clerk/nextjs";
import { api } from "@momos/backend/convex/_generated/api";
import type { Id } from "@momos/backend/convex/_generated/dataModel";
import { Authenticated, AuthLoading, Unauthenticated, useQuery } from "convex/react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { DeviceProvider, displayName, useDevices } from "./device-context";
import { Button, Card, Loading } from "./ui";

const NAV = [
  { href: "/", label: "Home" },
  { href: "/screen", label: "Screen" },
  { href: "/help", label: "Help" },
  { href: "/reminders", label: "Reminders" },
  { href: "/photos", label: "Photos" },
  { href: "/timeline", label: "Timeline" },
  { href: "/jobs", label: "Jobs" },
  { href: "/reports", label: "Reports" },
  { href: "/settings", label: "Settings" },
  { href: "/devices", label: "Devices" },
];

export function Shell({ children }: { children: ReactNode }) {
  return (
    <>
      <AuthLoading>
        <Centered>
          <Loading />
        </Centered>
      </AuthLoading>
      <Unauthenticated>
        <SignedOutView />
      </Unauthenticated>
      <Authenticated>
        <AdminOnly>
          <DeviceProvider>
            <Frame>{children}</Frame>
          </DeviceProvider>
        </AdminOnly>
      </Authenticated>
    </>
  );
}

function Centered({ children }: { children: ReactNode }) {
  return <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center gap-4 p-4">{children}</main>;
}

function SignedOutView() {
  const { isSignedIn, isLoaded } = useAuth();
  if (isLoaded && isSignedIn) {
    // Clerk says yes but Convex rejected the token.
    return (
      <Centered>
        <Card title="Convex didn't accept the sign-in">
          <p className="text-sm text-stone-600 dark:text-stone-400">
            You are signed in to Clerk, but the Convex deployment can&apos;t verify the token. Check that
            CLERK_JWT_ISSUER_DOMAIN is set on the Convex deployment and that Clerk has a JWT template named
            &ldquo;convex&rdquo; that includes the email claims.
          </p>
          <div className="mt-4">
            <SignOutButton>
              <Button>Sign out</Button>
            </SignOutButton>
          </div>
        </Card>
      </Centered>
    );
  }
  return (
    <Centered>
      <h1 className="text-2xl font-semibold">MomOS admin</h1>
      <p className="text-stone-600 dark:text-stone-400">Sign in to see and help with the laptop.</p>
      <SignInButton mode="modal">
        <Button variant="primary">Sign in</Button>
      </SignInButton>
    </Centered>
  );
}

function AdminOnly({ children }: { children: ReactNode }) {
  const who = useQuery(api.admin.whoami);
  if (who === undefined) {
    return (
      <Centered>
        <Loading />
      </Centered>
    );
  }
  if (!who.isAdmin) {
    return (
      <Centered>
        <Card title="Not allowed">
          <p className="text-sm text-stone-600 dark:text-stone-400">
            {who.email || "This account"} isn&apos;t on the admin list. Add it to ADMIN_EMAILS on the Convex deployment, and
            make sure the email is verified in Clerk.
          </p>
          <div className="mt-4">
            <SignOutButton>
              <Button>Sign out</Button>
            </SignOutButton>
          </div>
        </Card>
      </Centered>
    );
  }
  return <>{children}</>;
}

function Frame({ children }: { children: ReactNode }) {
  const path = usePathname();
  const { devices, device, select } = useDevices();
  const live = devices?.filter((d) => d.revokedAt === null) ?? [];
  return (
    <div className="flex min-h-dvh flex-col pb-20 md:pb-0">
      <header className="sticky top-0 z-10 border-b border-stone-200 bg-stone-50/90 backdrop-blur dark:border-stone-800 dark:bg-stone-950/90">
        <div className="mx-auto flex max-w-4xl items-center gap-3 px-4 py-2">
          <Link href="/" className="font-semibold">
            MomOS
          </Link>
          {live.length > 1 && device ? (
            <select
              aria-label="Device"
              className="min-w-0 flex-1 py-1 text-sm"
              value={device._id}
              onChange={(e) => select(e.target.value as Id<"devices">)}
            >
              {live.map((d) => (
                <option key={d._id} value={d._id}>
                  {displayName(d)}
                </option>
              ))}
            </select>
          ) : (
            <span className="min-w-0 flex-1 truncate text-sm text-stone-500">{device ? displayName(device) : ""}</span>
          )}
          <nav className="hidden flex-wrap justify-end gap-1 md:flex">
            {NAV.map((n) => (
              <NavLink key={n.href} href={n.href} active={isActive(path, n.href)} label={n.label} />
            ))}
          </nav>
          <UserButton />
        </div>
      </header>
      <main className="mx-auto w-full max-w-4xl flex-1 p-4">{children}</main>
      <nav className="fixed inset-x-0 bottom-0 z-10 flex overflow-x-auto border-t border-stone-200 bg-stone-50/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden dark:border-stone-800 dark:bg-stone-950/95">
        {NAV.map((n) => (
          <Link
            key={n.href}
            href={n.href}
            className={`flex min-h-14 min-w-[4.75rem] flex-1 shrink-0 items-center justify-center px-1 text-xs font-medium ${
              isActive(path, n.href) ? "text-sky-700 dark:text-sky-400" : "text-stone-500"
            }`}
          >
            {n.label}
            {n.href === "/help" && device && device.openHelp > 0 && (
              <span className="ml-1 rounded-full bg-red-600 px-1.5 text-[10px] text-white">{device.openHelp}</span>
            )}
          </Link>
        ))}
      </nav>
    </div>
  );
}

function isActive(path: string, href: string) {
  return href === "/" ? path === "/" : path.startsWith(href);
}

function NavLink({ href, label, active }: { href: string; label: string; active: boolean }) {
  return (
    <Link
      href={href}
      className={`rounded-lg px-3 py-1.5 text-sm ${
        active ? "bg-sky-100 text-sky-800 dark:bg-sky-900/50 dark:text-sky-300" : "text-stone-600 hover:bg-stone-100 dark:text-stone-400 dark:hover:bg-stone-800"
      }`}
    >
      {label}
    </Link>
  );
}

// For pages that need a device: shows a pointer to the Devices page when there is none.
export function NeedsDevice({ children }: { children: (device: NonNullable<ReturnType<typeof useDevices>["device"]>) => ReactNode }) {
  const { devices, device } = useDevices();
  if (devices === undefined) return <Loading />;
  if (!device) {
    return (
      <Card title="No device yet">
        <p className="text-sm text-stone-600 dark:text-stone-400">
          Create a device on the <Link className="text-sky-700 underline dark:text-sky-400" href="/devices">Devices page</Link> and put its token on the laptop.
        </p>
      </Card>
    );
  }
  return <>{children(device)}</>;
}
