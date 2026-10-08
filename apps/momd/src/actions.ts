import { Action } from "@momos/shared";

// Actions arrive from Convex. Only the types in the shared Action schema are
// ever run; anything else is refused and reported back as failed.

export interface PendingAction {
  _id: string;
  action: unknown;
  createdAt?: number;
}

export type Validated =
  | { ok: true; id: string; action: Action; createdAt: number | null }
  | { ok: false; id: string | null; error: string };

export function validatePending(item: unknown): Validated {
  if (!item || typeof item !== "object") return { ok: false, id: null, error: "not an object" };
  const id = (item as { _id?: unknown })._id;
  if (typeof id !== "string" || !id) return { ok: false, id: null, error: "missing _id" };
  const parsed = Action.safeParse((item as { action?: unknown }).action);
  if (!parsed.success) {
    const type = (item as { action?: { type?: unknown } }).action?.type;
    return { ok: false, id, error: `refused action${typeof type === "string" ? ` "${type.slice(0, 40)}"` : ""}: ${parsed.error.issues[0]?.message ?? "invalid"}` };
  }
  const createdAt = (item as { createdAt?: unknown }).createdAt;
  return { ok: true, id, action: parsed.data, createdAt: typeof createdAt === "number" ? createdAt : null };
}

export const bannerTextForSay = (helper: string, text: string) => `${helper} says: ${text}`.slice(0, 280);
export const bannerTextForRestart = (helper: string) => `${helper} is restarting the computer. It will be back in a minute.`;
export const bannerTextForRecentScreens = (helper: string) => `${helper} is looking at your last few minutes`;
export const bannerTextForHelpSeen = (helper: string) => `${helper} saw your message.`;
// A short note after the helper reloads one of her pages, since the page
// blanks and she may be taken to it.
export const bannerTextForReload = (helper: string, label: string) => `${helper} refreshed ${label}.`.slice(0, 280);
export const isReloadBanner = (helper: string, text: string) => text.startsWith(`${helper} refreshed `);
