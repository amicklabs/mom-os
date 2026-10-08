import type { Tile } from "@momos/shared";
import * as hypr from "@momos/momctl/hypr";
import type { HyprClient } from "@momos/momctl/hypr";
import { goHomeWorkspace } from "@momos/momctl/launch";
import { launchingWorkspaces } from "@momos/momctl/launchlock";
import { HOME_WORKSPACE, tileIdForClass, tileWorkspace } from "@momos/momctl/tiles";
import { isTelegramClass, type WindowEvent } from "./calls";
import { log } from "./core";

// Keeps her screen to one thing at a time (docs/contracts.md, "Tiles and
// windows"). Her Hyprland config lays every workspace out as a monocle, so
// only the focused window shows. This adds what the config can't:
//
// - When the window she was looking at closes and its workspace is left
//   empty, she goes to the home workspace. If other windows remain there, the
//   one she used last gets focus.
// - She's never left on an empty workspace other than home, unless a tile's
//   app is still starting there (momctl's launch lock).
// - A web app window that opens somewhere other than its tile's workspace
//   (Chromium restoring its last session, say) goes to its own workspace
//   quietly, so it doesn't cover what she's looking at.
// - A second window of the same web app within a few seconds of the first is
//   a double launch, and is closed.
// - A plain browser window that opens on home moves to the Browser tile's
//   workspace, and she follows it, so home stays empty.

// Two windows of the same web app this close together are a double launch.
export const DUPLICATE_MS = 10_000;
// After a close, let Hyprland settle its focus before looking.
export const AFTER_CLOSE_MS = 250;
// After a switch to an empty workspace, wait this long before sending her home.
export const EMPTY_GRACE_MS = 1500;
// While a launch is starting on the empty workspace, look again this often.
export const LAUNCH_RECHECK_MS = 2000;

export interface NewWindow {
  address: string;
  cls: string;
  workspace: string;
}

export interface RecentWindow {
  address: string;
  tileId: string;
  at: number;
}

export type Placement =
  | { do: "none" }
  | { do: "close-duplicate"; keep: string }
  | { do: "move"; workspace: string; follow: boolean };

// What to do with a window that just opened.
export function placementFor(win: NewWindow, tiles: readonly Tile[], recent: readonly RecentWindow[], now: number): Placement {
  if (isTelegramClass(win.cls)) return { do: "none" }; // her Hyprland config and calls.ts place those
  const tileId = tileIdForClass(tiles, win.cls);
  const tile = tileId ? tiles.find((t) => t.id === tileId) : undefined;
  if (!tile) return { do: "none" }; // a dialog or an app with no tile stays where it opened
  const own = tileWorkspace(tile.id);

  if (tile.type === "app" && tile.app === "chromium") {
    // A plain browser window, from a link or the Browser tile, shows where
    // she is, over what she was looking at. Only home has to stay empty.
    return win.workspace === HOME_WORKSPACE ? { do: "move", workspace: own, follow: true } : { do: "none" };
  }
  if (tile.type !== "webapp") return { do: "none" };

  const twin = recent.find((r) => r.tileId === tile.id && r.address !== win.address && now - r.at >= 0 && now - r.at < DUPLICATE_MS);
  if (twin) return { do: "close-duplicate", keep: twin.address };
  if (win.workspace !== own) return { do: "move", workspace: own, follow: false };
  return { do: "none" };
}

export type Settle = { do: "none" } | { do: "home" } | { do: "wait" } | { do: "focus"; address: string };

// Where she should be, given what's on screen. `afterClose` is set when a
// window just closed: only then does this move keyboard focus, since at other
// times the shell's own panels may hold it.
export function settleFor(
  active: string,
  clients: readonly HyprClient[],
  activeWindow: string | null,
  launching: ReadonlySet<string>,
  afterClose: boolean,
): Settle {
  if (!active || active === HOME_WORKSPACE || active.startsWith("special")) return { do: "none" };
  const here = clients.filter((c) => c.mapped !== false && c.workspace.name === active);
  if (here.length === 0) return launching.has(active) ? { do: "wait" } : { do: "home" };
  if (!afterClose) return { do: "none" };
  if (activeWindow && here.some((c) => c.address === activeWindow)) return { do: "none" };
  const last = [...here].sort((a, b) => a.focusHistoryID - b.focusHistoryID)[0]!;
  return { do: "focus", address: last.address };
}

export interface WindowOps {
  tiles(): readonly Tile[];
  clients(): Promise<HyprClient[]>;
  activeWorkspace(): Promise<string>;
  activeWindow(): Promise<string | null>;
  focusWindow(address: string): Promise<void>;
  moveWindow(address: string, workspace: string, follow: boolean): Promise<void>;
  closeWindow(address: string): Promise<void>;
  goHome(): Promise<void>;
  launching(): ReadonlySet<string>;
  now(): number;
  later(fn: () => void, ms: number): void;
  log(msg: string): void;
}

export class WindowKeeper {
  private recent: RecentWindow[] = [];
  private pending: { at: number; afterClose: boolean } | null = null;

  constructor(private readonly ops: WindowOps) {}

  async handle(ev: WindowEvent): Promise<void> {
    const now = this.ops.now();
    this.recent = this.recent.filter((r) => now - r.at < DUPLICATE_MS);
    switch (ev.kind) {
      case "open":
        return this.opened({ address: ev.address, cls: ev.cls, workspace: ev.workspace }, now);
      case "close":
        this.recent = this.recent.filter((r) => r.address !== ev.address);
        this.schedule(AFTER_CLOSE_MS, true);
        return;
      case "move":
      case "workspace":
        this.schedule(EMPTY_GRACE_MS, false);
        return;
      case "title":
        return;
    }
  }

  private async opened(win: NewWindow, now: number): Promise<void> {
    const p = placementFor(win, this.ops.tiles(), this.recent, now);
    const tileId = tileIdForClass(this.ops.tiles(), win.cls);
    if (tileId && p.do !== "close-duplicate") this.recent.push({ address: win.address, tileId, at: now });
    if (p.do === "close-duplicate") {
      this.ops.log(`closing ${win.cls} window ${win.address}, a second copy of ${p.keep}`);
      await this.ops.closeWindow(win.address);
    } else if (p.do === "move") {
      this.ops.log(`moving ${win.cls} window ${win.address} from ${win.workspace} to ${p.workspace}`);
      await this.ops.moveWindow(win.address, p.workspace, p.follow);
    }
  }

  // Look again in `ms`. An earlier pending look wins; a close upgrades it.
  private schedule(ms: number, afterClose: boolean): void {
    const at = this.ops.now() + ms;
    if (this.pending) {
      this.pending.afterClose ||= afterClose;
      if (this.pending.at <= at) return;
    }
    this.pending = { at, afterClose: this.pending?.afterClose || afterClose };
    const mine = this.pending;
    this.ops.later(() => {
      if (this.pending !== mine) return;
      this.pending = null;
      this.settle(mine.afterClose).catch((e) => this.ops.log(`can't settle windows: ${(e as Error).message}`));
    }, ms);
  }

  // Check where she is now and fix it. Also runs on a timer as a safety net.
  async settle(afterClose = false): Promise<Settle> {
    const [active, clients, activeWindow] = await Promise.all([
      this.ops.activeWorkspace(),
      this.ops.clients(),
      this.ops.activeWindow(),
    ]);
    const s = settleFor(active, clients, activeWindow, this.ops.launching(), afterClose);
    if (s.do === "home") {
      this.ops.log(`${active} is empty; going home`);
      await this.ops.goHome();
    } else if (s.do === "focus") {
      await this.ops.focusWindow(s.address);
    } else if (s.do === "wait") {
      this.schedule(LAUNCH_RECHECK_MS, afterClose);
    }
    return s;
  }
}

export function hyprWindowOps(tiles: () => readonly Tile[]): WindowOps {
  return {
    tiles,
    clients: () => hypr.clients(),
    activeWorkspace: async () => (await hypr.activeWorkspace()).name,
    activeWindow: async () => (await hypr.activeWindow())?.address ?? null,
    focusWindow: (a) => hypr.focusWindow(a),
    moveWindow: (a, ws, follow) => hypr.moveWindow(a, ws, follow),
    closeWindow: (a) => hypr.closeWindow(a),
    goHome: () => goHomeWorkspace(),
    launching: () => launchingWorkspaces(),
    now: Date.now,
    later: (fn, ms) => void setTimeout(fn, ms),
    log: (msg) => log("windows", msg),
  };
}
