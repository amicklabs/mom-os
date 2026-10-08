import { isReloadable } from "@momos/shared";

// Reloading her pages from the admin app: which tiles get a Reload button,
// and what to say about the last reload of each.

type TileLike = { id: string; label: string; type: string; app?: unknown };
type ActionLike = {
  _id: string;
  action: { type: string; tileId?: string };
  status: "pending" | "done" | "failed";
  createdAt: number;
  result?: string;
};

// The laptop refuses a reload that waited longer than this.
export const RELOAD_MAX_AGE_MS = 10 * 60_000;
// How long a result stays next to its button.
export const RELOAD_SHOWN_MS = 15 * 60_000;
// After this long without an answer, say the laptop may be offline.
export const RELOAD_SLOW_MS = 30_000;

export function reloadableTiles<T extends TileLike>(tiles: readonly T[]): T[] {
  return tiles.filter(isReloadable);
}

// The newest reload of this tile, from any source, if it's recent.
export function lastReload<A extends ActionLike>(actions: readonly A[], tileId: string, now: number): A | null {
  const mine = actions.filter((a) => a.action.type === "reload" && a.action.tileId === tileId && now - a.createdAt < RELOAD_SHOWN_MS);
  return mine.sort((a, b) => b.createdAt - a.createdAt)[0] ?? null;
}

export type ReloadStatus = { text: string; tone: "green" | "red" | "amber" };

export function reloadStatus(a: ActionLike | null, now: number): ReloadStatus | null {
  if (!a) return null;
  if (a.status === "done") {
    return a.result?.includes("wasn't open")
      ? { text: "It wasn't open, so it opened fresh", tone: "green" }
      : { text: "Reloaded", tone: "green" };
  }
  if (a.status === "failed") return { text: `Didn't reload: ${a.result?.trim() || "no reason given"}`, tone: "red" };
  if (now - a.createdAt > RELOAD_MAX_AGE_MS) return { text: "The laptop never picked it up, and it's too late now", tone: "red" };
  if (now - a.createdAt > RELOAD_SLOW_MS) return { text: "The laptop hasn't picked it up yet. Is it online?", tone: "amber" };
  return { text: "Waiting for the laptop...", tone: "amber" };
}
