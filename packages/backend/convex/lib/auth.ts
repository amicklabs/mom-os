import type { Doc } from "../_generated/dataModel";
import type { ActionCtx, MutationCtx, QueryCtx } from "../_generated/server";

const encoder = new TextEncoder();

export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(value));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

// Compares the SHA-256 digests of both strings, so neither the length nor the
// position of the first differing byte leaks through timing.
export async function constantTimeEqual(a: string, b: string): Promise<boolean> {
  const [da, db] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(a)),
    crypto.subtle.digest("SHA-256", encoder.encode(b)),
  ]);
  const x = new Uint8Array(da);
  const y = new Uint8Array(db);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i]! ^ y[i]!;
  return diff === 0;
}

type DbCtx = Pick<QueryCtx | MutationCtx, "db">;

export async function requireDevice(ctx: DbCtx, deviceToken: string): Promise<Doc<"devices">> {
  if (!deviceToken) throw new Error("Unknown device.");
  const tokenHash = await sha256Hex(deviceToken);
  const device = await ctx.db
    .query("devices")
    .withIndex("by_tokenHash", (q) => q.eq("tokenHash", tokenHash))
    .unique();
  if (!device) throw new Error("Unknown device.");
  if (device.revokedAt !== undefined) throw new Error("Device revoked.");
  return device;
}

export async function requireDispatcher(dispatcherToken: string): Promise<void> {
  const expected = process.env.DISPATCHER_TOKEN;
  if (!expected || !dispatcherToken || !(await constantTimeEqual(dispatcherToken, expected))) {
    throw new Error("Invalid dispatcher token.");
  }
}

export function adminEmails(): string[] {
  return (process.env.ADMIN_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

type AuthCtx = Pick<QueryCtx | MutationCtx | ActionCtx, "auth">;

export async function viewer(ctx: AuthCtx) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) return null;
  const email = (identity.email ?? "").trim().toLowerCase();
  const verified =
    identity.emailVerified !== false &&
    identity.email_verified !== false &&
    identity.email_verified !== "false";
  return {
    subject: identity.subject,
    email,
    isAdmin: !!email && verified && adminEmails().includes(email),
  };
}

export async function requireAdmin(ctx: AuthCtx) {
  const who = await viewer(ctx);
  if (!who) throw new Error("Sign in required.");
  if (!who.isAdmin) throw new Error("Admin access is required.");
  return who;
}
