import { isReloadable, type Tile } from "@momos/shared";
import * as hypr from "./hypr";
import * as input from "./input";
import { type OpenResult, openTile } from "./launch";
import * as shell from "./shell";

// Reloading a tile's page, for when a web page is stuck or still shows a
// sign-in form after she signed in somewhere else. The window comes forward
// and gets F5, the way she'd reload it herself. A tile with no window open is
// opened instead, which loads the page fresh.

export interface ReloadResult {
  tileId: string;
  label: string;
  workspace: string;
  // "reloaded": its window was open and got F5. "opened": it wasn't open, so
  // it was launched, which loads the page anyway.
  action: "reloaded" | "opened";
  window: { address: string; class: string } | null;
}

export interface ReloadDeps {
  open: (tile: Tile) => Promise<OpenResult>;
  activeWindow: () => Promise<{ address: string } | null>;
  focusWindow: (address: string) => Promise<void>;
  key: (combo: string) => Promise<unknown>;
  // Why synthetic keys can't work (no ydotoold), or null.
  inputProblem: () => string | null;
  // Ends the screensaver, which would otherwise swallow the key.
  screensaverOff: () => Promise<unknown>;
  sleep: (ms: number) => Promise<unknown>;
}

const defaults: ReloadDeps = {
  open: (tile) => openTile(tile),
  activeWindow: hypr.activeWindow,
  focusWindow: hypr.focusWindow,
  key: input.key,
  inputProblem: input.ydotoolProblem,
  screensaverOff: () => shell.screensaver("off"),
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
};

export const RELOAD_KEY = "f5";

export async function reloadTile(
  tile: Tile,
  opts: { locked?: boolean; deps?: Partial<ReloadDeps> } = {},
): Promise<ReloadResult> {
  const d = { ...defaults, ...opts.deps };
  if (!isReloadable(tile)) throw new Error(`"${tile.id}" isn't a web page; only web app tiles and the Browser reload`);
  // The key would go to the lock screen.
  if (opts.locked) throw new Error("the screen is locked");
  // Checked before anything moves, so a broken ydotoold doesn't leave her on
  // another tile with nothing reloaded.
  const problem = d.inputProblem();
  if (problem) throw new Error(problem);

  const r = await d.open(tile);
  const base = { tileId: tile.id, label: tile.label, workspace: r.workspace, window: r.window };
  if (r.action !== "focused") {
    if (!r.window) throw new Error(`${tile.label} didn't open`);
    return { ...base, action: "opened" };
  }
  const address = r.window!.address;

  await d.screensaverOff().catch(() => {});
  // F5 goes to whatever has focus, so press it only once her window has it.
  let active = await d.activeWindow().catch(() => null);
  for (let i = 0; i < 4 && active?.address !== address; i++) {
    await d.sleep(150);
    await d.focusWindow(address).catch(() => {});
    active = await d.activeWindow().catch(() => null);
  }
  if (active?.address !== address) throw new Error(`couldn't bring ${tile.label} to the front, so it wasn't reloaded`);
  await d.key(RELOAD_KEY);
  return { ...base, action: "reloaded" };
}
