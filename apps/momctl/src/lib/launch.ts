import type { ConfigFile, Tile } from "@momos/shared";
import * as hypr from "./hypr";
import type { HyprClient } from "./hypr";
import { acquireLaunch, releaseLaunch } from "./launchlock";
import { launchDetached } from "./run";
import { HOME_WORKSPACE, type TileTarget, tileTarget, tileWorkspace } from "./tiles";

export interface OpenResult {
  tileId: string;
  workspace: string;
  // "waited": another launch of this tile was already starting it, and this
  // call brought that launch's window forward instead of starting another.
  action: "focused" | "launched" | "waited";
  window: { address: string; class: string } | null;
  command?: string[];
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function findTile(config: ConfigFile, tileId: string): Tile {
  const tile = config.tiles.find((t) => t.id === tileId);
  if (!tile) throw new Error(`no tile "${tileId}"; tiles are ${config.tiles.map((t) => t.id).join(", ")}`);
  return tile;
}

// The tile's window to bring back: the one she used last.
export function existingWindow(clients: HyprClient[], target: TileTarget): HyprClient | undefined {
  return clients
    .filter((c) => c.mapped !== false && target.matches(c.class || c.initialClass))
    .sort((a, b) => a.focusHistoryID - b.focusHistoryID)[0];
}

// A window of the tile's app that wasn't there before the launch.
export function newWindow(clients: HyprClient[], target: TileTarget, known: ReadonlySet<string>): HyprClient | undefined {
  return clients.find((c) => c.mapped !== false && !known.has(c.address) && target.matches(c.class || c.initialClass));
}

// Launch the tile's app on its own workspace, or bring its window back if it's
// already open. Each tile lives on the named workspace tile-<id>. Only one
// launch per tile runs at a time (launchlock.ts): a second tap while the app is
// starting waits for the first launch's window instead of starting another.
export async function openTile(tile: Tile, opts: { waitMs?: number } = {}): Promise<OpenResult> {
  const target = tileTarget(tile);
  if (!target) throw new Error(`"${tile.id}" is a page tile; the shell opens those itself`);
  const waitMs = opts.waitMs ?? 20_000;

  const before = await hypr.clients();
  const existing = existingWindow(before, target);

  // A Telegram chat reuses Telegram's window wherever it already lives.
  const workspace =
    tile.type === "telegram-chat" && existing && !existing.workspace.name.startsWith("special")
      ? existing.workspace.name
      : tileWorkspace(tile.id);

  if (existing && !target.alwaysLaunch) {
    await place(existing.address, existing.workspace.name, workspace);
    return { tileId: tile.id, workspace, action: "focused", window: { address: existing.address, class: existing.class } };
  }

  // Telegram chat tiles hand over a link every time; Telegram keeps one window.
  const lock = target.alwaysLaunch ? null : acquireLaunch(tile.id, workspace);
  const launching = target.alwaysLaunch || lock !== null;
  const action = launching ? "launched" : "waited";
  let command: string[] | undefined;
  try {
    // Switch first so the new window maps on the tile's workspace.
    await hypr.focusWorkspace(workspace);
    if (launching) command = launchDetached(target.command);

    const known = new Set(before.map((c) => c.address));
    const deadline = Date.now() + waitMs;
    while (Date.now() < deadline) {
      await sleep(250);
      const now = await hypr.clients().catch(() => []);
      const win = newWindow(now, target, known) ?? (existing ? now.find((c) => c.address === existing.address) : undefined);
      if (!win) continue;
      try {
        await place(win.address, win.workspace.name, workspace);
      } catch {
        // It closed under us (momd closes a duplicate window). Look again.
        known.add(win.address);
        continue;
      }
      return { tileId: tile.id, workspace, action, window: { address: win.address, class: win.class }, ...(command ? { command } : {}) };
    }
  } finally {
    if (lock) releaseLaunch(lock);
  }

  // Nothing showed up. Don't leave her looking at an empty workspace.
  await leaveIfEmpty(workspace).catch(() => {});
  return { tileId: tile.id, workspace, action, window: null, ...(command ? { command } : {}) };
}

async function leaveIfEmpty(workspace: string): Promise<void> {
  const [active, list] = await Promise.all([hypr.activeWorkspace(), hypr.clients()]);
  if (active.name !== workspace) return;
  if (list.some((c) => c.mapped !== false && c.workspace.name === workspace)) return;
  await goHomeWorkspace();
}

async function place(address: string, current: string, workspace: string): Promise<void> {
  if (current !== workspace) await hypr.moveWindow(address, workspace, false);
  await hypr.focusWorkspace(workspace);
  await hypr.focusWindow(address);
}

export const goHomeWorkspace = () => hypr.focusWorkspace(HOME_WORKSPACE);
