import { describe, expect, test } from "bun:test";
import type { Tile } from "@momos/shared";
import type { HyprClient } from "@momos/momctl/hypr";
import { parseWindowEvent } from "../src/calls";
import {
  AFTER_CLOSE_MS,
  DUPLICATE_MS,
  EMPTY_GRACE_MS,
  LAUNCH_RECHECK_MS,
  placementFor,
  settleFor,
  WindowKeeper,
  type WindowOps,
} from "../src/windows";

const tiles: Tile[] = [
  { id: "telegram", label: "Telegram", type: "app", app: "telegram" },
  { id: "youtube", label: "YouTube", type: "webapp", url: "https://www.youtube.com" },
  { id: "photos", label: "Photos", type: "webapp", url: "https://photos.google.com" },
  { id: "internet", label: "Browser", type: "app", app: "chromium" },
];

const YT = "chrome-www.youtube.com__-Default";
const PHOTOS = "chrome-photos.google.com__-Default";

const client = (address: string, workspace: string, focusHistoryID = 0, cls = YT): HyprClient => ({
  address,
  class: cls,
  initialClass: cls,
  title: "",
  pid: 1,
  mapped: true,
  hidden: false,
  workspace: { id: 1, name: workspace },
  focusHistoryID,
  fullscreen: 0,
});

describe("window events", () => {
  test("parses moves and workspace changes", () => {
    expect(parseWindowEvent("movewindowv2>>55d1,7,tile-youtube")).toEqual({ kind: "move", address: "0x55d1", workspace: "tile-youtube" });
    expect(parseWindowEvent("workspacev2>>3,home")).toEqual({ kind: "workspace", workspace: "home" });
  });
});

describe("placing new windows", () => {
  test("a web app window on another tile's workspace goes to its own, quietly", () => {
    expect(placementFor({ address: "0x1", cls: PHOTOS, workspace: "tile-internet" }, tiles, [], 0)).toEqual({
      do: "move",
      workspace: "tile-photos",
      follow: false,
    });
    expect(placementFor({ address: "0x1", cls: PHOTOS, workspace: "tile-photos" }, tiles, [], 0)).toEqual({ do: "none" });
  });

  test("a second window of the same web app right after the first is closed", () => {
    const recent = [{ address: "0x1", tileId: "youtube", at: 1000 }];
    const second = { address: "0x2", cls: YT, workspace: "tile-youtube" };
    expect(placementFor(second, tiles, recent, 1000 + DUPLICATE_MS - 1)).toEqual({ do: "close-duplicate", keep: "0x1" });
    expect(placementFor(second, tiles, recent, 1000 + DUPLICATE_MS)).toEqual({ do: "none" });
  });

  test("a plain browser window stays where she is, except on home", () => {
    expect(placementFor({ address: "0x1", cls: "chromium", workspace: "tile-youtube" }, tiles, [], 0)).toEqual({ do: "none" });
    expect(placementFor({ address: "0x1", cls: "chromium", workspace: "home" }, tiles, [], 0)).toEqual({
      do: "move",
      workspace: "tile-internet",
      follow: true,
    });
  });

  test("Telegram and unknown windows are left alone", () => {
    expect(placementFor({ address: "0x1", cls: "org.telegram.desktop", workspace: "home" }, tiles, [], 0)).toEqual({ do: "none" });
    expect(placementFor({ address: "0x1", cls: "xdg-desktop-portal-gtk", workspace: "tile-youtube" }, tiles, [], 0)).toEqual({
      do: "none",
    });
  });
});

describe("where she ends up", () => {
  const none = new Set<string>();

  test("an empty workspace sends her home", () => {
    expect(settleFor("tile-youtube", [client("0x1", "tile-internet")], null, none, true)).toEqual({ do: "home" });
    expect(settleFor("tile-youtube", [], null, none, false)).toEqual({ do: "home" });
  });

  test("unless the tile's app is still starting there", () => {
    expect(settleFor("tile-youtube", [], null, new Set(["tile-youtube"]), false)).toEqual({ do: "wait" });
  });

  test("home and special workspaces are left alone", () => {
    expect(settleFor("home", [], null, none, true)).toEqual({ do: "none" });
    expect(settleFor("special:magic", [], null, none, true)).toEqual({ do: "none" });
  });

  test("after a close, the window she used last on that workspace gets focus", () => {
    const here = [client("0x1", "tile-internet", 4), client("0x2", "tile-internet", 1), client("0x3", "tile-youtube", 0)];
    expect(settleFor("tile-internet", here, null, none, true)).toEqual({ do: "focus", address: "0x2" });
    expect(settleFor("tile-internet", here, "0x1", none, true)).toEqual({ do: "none" });
    // Not after other events: the shell's own panels may have the keyboard.
    expect(settleFor("tile-internet", here, null, none, false)).toEqual({ do: "none" });
  });
});

function fakeOps(state: { active: string; clients: HyprClient[]; launching?: Set<string> }) {
  let now = 0;
  const timers: { at: number; fn: () => void }[] = [];
  const calls: string[] = [];
  const ops: WindowOps = {
    tiles: () => tiles,
    clients: async () => state.clients,
    activeWorkspace: async () => state.active,
    activeWindow: async () => null,
    focusWindow: async (a) => void calls.push(`focus ${a}`),
    moveWindow: async (a, ws, follow) => void calls.push(`move ${a} ${ws}${follow ? " follow" : ""}`),
    closeWindow: async (a) => void calls.push(`close ${a}`),
    goHome: async () => {
      calls.push("home");
      state.active = "home";
    },
    launching: () => state.launching ?? new Set(),
    now: () => now,
    later: (fn, ms) => void timers.push({ at: now + ms, fn }),
    log: () => {},
  };
  const advance = async (ms: number) => {
    now += ms;
    for (;;) {
      const due = timers.filter((t) => t.at <= now);
      if (!due.length) break;
      for (const t of due) timers.splice(timers.indexOf(t), 1);
      for (const t of due) t.fn();
      await new Promise((r) => setTimeout(r, 0));
    }
  };
  return { ops, calls, advance };
}

describe("WindowKeeper", () => {
  test("closing the last window on screen goes home", async () => {
    const state = { active: "tile-internet", clients: [client("0x9", "tile-telegram", 0, "org.telegram.desktop")] };
    const { ops, calls, advance } = fakeOps(state);
    const k = new WindowKeeper(ops);
    await k.handle(parseWindowEvent("closewindow>>5")!);
    expect(calls).toEqual([]);
    await advance(AFTER_CLOSE_MS);
    expect(calls).toEqual(["home"]);
  });

  test("closing one of two windows focuses the other, not another workspace", async () => {
    const state = {
      active: "tile-youtube",
      clients: [client("0x1", "tile-youtube", 2), client("0x2", "tile-internet", 1, "chromium")],
    };
    const { ops, calls, advance } = fakeOps(state);
    const k = new WindowKeeper(ops);
    await k.handle(parseWindowEvent("closewindow>>3")!);
    await advance(AFTER_CLOSE_MS);
    expect(calls).toEqual(["focus 0x1"]);
  });

  test("an empty tile workspace waits for its launch, then goes home if nothing came", async () => {
    const state = { active: "tile-youtube", clients: [] as HyprClient[], launching: new Set(["tile-youtube"]) };
    const { ops, calls, advance } = fakeOps(state);
    const k = new WindowKeeper(ops);
    await k.handle(parseWindowEvent("workspacev2>>4,tile-youtube")!);
    await advance(EMPTY_GRACE_MS);
    expect(calls).toEqual([]);
    state.launching = new Set();
    await advance(LAUNCH_RECHECK_MS);
    expect(calls).toEqual(["home"]);
  });

  test("a double launch closes the second window", async () => {
    const { ops, calls } = fakeOps({ active: "tile-youtube", clients: [] });
    const k = new WindowKeeper(ops);
    await k.handle(parseWindowEvent(`openwindow>>1,tile-youtube,${YT},YouTube`)!);
    await k.handle(parseWindowEvent(`openwindow>>2,tile-youtube,${YT},YouTube`)!);
    expect(calls).toEqual(["close 0x2"]);
    // The first one closing doesn't make a later window a duplicate of it.
    await k.handle(parseWindowEvent("closewindow>>1")!);
    await k.handle(parseWindowEvent(`openwindow>>3,tile-youtube,${YT},YouTube`)!);
    expect(calls).toEqual(["close 0x2"]);
  });

  test("a restored web app window moves off the browser's workspace", async () => {
    const { ops, calls } = fakeOps({ active: "tile-internet", clients: [] });
    const k = new WindowKeeper(ops);
    await k.handle(parseWindowEvent(`openwindow>>7,tile-internet,${PHOTOS},Google Photos`)!);
    expect(calls).toEqual(["move 0x7 tile-photos"]);
  });
});
