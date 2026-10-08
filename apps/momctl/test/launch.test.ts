import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import type { Tile } from "@momos/shared";
import type { HyprClient } from "../src/lib/hypr";
import { existingWindow, newWindow } from "../src/lib/launch";
import { acquireLaunch, LAUNCH_LOCK_MS, launchingWorkspaces, releaseLaunch } from "../src/lib/launchlock";
import { tileTarget } from "../src/lib/tiles";

const dir = () => mkdtempSync(`${tmpdir()}/momctl-launch-`);

describe("launch lock", () => {
  test("a second launch of the same tile doesn't get the lock", () => {
    const d = dir();
    const first = acquireLaunch("youtube", "tile-youtube", { dir: d, now: 1000, pid: 1 });
    expect(first).not.toBeNull();
    expect(acquireLaunch("youtube", "tile-youtube", { dir: d, now: 1500, pid: 2 })).toBeNull();
    // Another tile is unaffected.
    expect(acquireLaunch("email", "tile-email", { dir: d, now: 1500, pid: 2 })).not.toBeNull();
    expect(launchingWorkspaces({ dir: d, now: 2000 })).toEqual(new Set(["tile-youtube", "tile-email"]));
  });

  test("release frees the tile, but only for the owner", () => {
    const d = dir();
    const first = acquireLaunch("youtube", "tile-youtube", { dir: d, now: 1000, pid: 1 })!;
    releaseLaunch({ ...first, pid: 99 }, { dir: d });
    expect(existsSync(`${d}/launch-youtube.json`)).toBe(true);
    releaseLaunch(first, { dir: d });
    expect(existsSync(`${d}/launch-youtube.json`)).toBe(false);
    expect(acquireLaunch("youtube", "tile-youtube", { dir: d, now: 1100, pid: 2 })).not.toBeNull();
  });

  test("a stale or broken lock is taken over", () => {
    const d = dir();
    acquireLaunch("youtube", "tile-youtube", { dir: d, now: 1000, pid: 1 });
    const later = 1000 + LAUNCH_LOCK_MS;
    expect(launchingWorkspaces({ dir: d, now: later })).toEqual(new Set());
    expect(acquireLaunch("youtube", "tile-youtube", { dir: d, now: later, pid: 2 })?.pid).toBe(2);
    writeFileSync(`${d}/launch-email.json`, "not json");
    expect(acquireLaunch("email", "tile-email", { dir: d, now: later, pid: 3 })?.pid).toBe(3);
  });
});

const win = (address: string, cls: string, workspace: string, focusHistoryID: number): HyprClient => ({
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

describe("finding a tile's window", () => {
  const youtube: Tile = { id: "youtube", label: "YouTube", type: "webapp", url: "https://www.youtube.com" };
  const target = tileTarget(youtube)!;
  const clients = [
    win("0x1", "chromium", "tile-internet", 0),
    win("0x2", "chrome-www.youtube.com__-Default", "tile-youtube", 3),
    win("0x3", "chrome-www.youtube.com__-Default", "tile-internet", 1),
  ];

  test("brings back the one she used last", () => {
    expect(existingWindow(clients, target)?.address).toBe("0x3");
  });

  test("a new window is one that wasn't there before", () => {
    expect(newWindow(clients, target, new Set(["0x1", "0x2"]))?.address).toBe("0x3");
    expect(newWindow(clients, target, new Set(["0x2", "0x3"]))).toBeUndefined();
  });
});
