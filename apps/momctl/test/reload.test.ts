import { describe, expect, test } from "bun:test";
import type { Tile } from "@momos/shared";
import type { OpenResult } from "../src/lib/launch";
import { type ReloadDeps, reloadTile } from "../src/lib/reload";

const recipes: Tile = { id: "recipes", label: "Recipes", type: "webapp", url: "https://recipes.example.com/pages/welcome" };
const browser: Tile = { id: "internet", label: "Browser", type: "app", app: "chromium" };
const win = { address: "0xabc", class: "chrome-recipes.example.com__pages_welcome-Default" };

function fake(opts: { open?: Partial<OpenResult>; active?: (string | null)[]; problem?: string | null } = {}) {
  const calls: string[] = [];
  const active = [...(opts.active ?? ["0xabc"])];
  const deps: ReloadDeps = {
    open: async (t) => {
      calls.push(`open ${t.id}`);
      return { tileId: t.id, workspace: `tile-${t.id}`, action: "focused", window: win, ...opts.open };
    },
    activeWindow: async () => {
      const a = active.length > 1 ? active.shift()! : active[0]!;
      return a ? { address: a } : null;
    },
    focusWindow: async (a) => void calls.push(`focus ${a}`),
    key: async (k) => void calls.push(`key ${k}`),
    inputProblem: () => opts.problem ?? null,
    screensaverOff: async () => void calls.push("screensaver off"),
    sleep: async () => {},
  };
  return { deps, calls };
}

describe("reloading a tile", () => {
  test("an open window comes forward and gets F5", async () => {
    const { deps, calls } = fake();
    const r = await reloadTile(recipes, { deps });
    expect(r).toMatchObject({ tileId: "recipes", label: "Recipes", action: "reloaded", workspace: "tile-recipes" });
    expect(calls).toEqual(["open recipes", "screensaver off", "key f5"]);
  });

  test("the Browser tile reloads too", async () => {
    const { deps } = fake();
    expect((await reloadTile(browser, { deps })).action).toBe("reloaded");
  });

  test("a tile that isn't open is opened, with no key", async () => {
    const { deps, calls } = fake({ open: { action: "launched" } });
    expect((await reloadTile(recipes, { deps })).action).toBe("opened");
    expect(calls).toEqual(["open recipes"]);
  });

  test("a launch whose window never came is an error", async () => {
    const { deps } = fake({ open: { action: "launched", window: null } });
    await expect(reloadTile(recipes, { deps })).rejects.toThrow("Recipes didn't open");
  });

  test("the key waits until her window has focus", async () => {
    const { deps, calls } = fake({ active: ["0xother", "0xother", "0xabc"] });
    expect((await reloadTile(recipes, { deps })).action).toBe("reloaded");
    expect(calls.filter((c) => c.startsWith("focus"))).toHaveLength(2);
    expect(calls.at(-1)).toBe("key f5");
  });

  test("no key goes anywhere else if focus never comes", async () => {
    const { deps, calls } = fake({ active: [null] });
    await expect(reloadTile(recipes, { deps })).rejects.toThrow("couldn't bring Recipes to the front");
    expect(calls.some((c) => c.startsWith("key"))).toBe(false);
  });

  test("only web pages, never while locked, never without ydotool", async () => {
    const { deps, calls } = fake();
    await expect(reloadTile({ id: "telegram", label: "Telegram", type: "app", app: "telegram" }, { deps })).rejects.toThrow("isn't a web page");
    await expect(reloadTile({ id: "family", label: "Family", type: "page", page: "family" }, { deps })).rejects.toThrow("isn't a web page");
    await expect(reloadTile(recipes, { deps, locked: true })).rejects.toThrow("locked");
    const broken = fake({ problem: "ydotoold is not running" });
    await expect(reloadTile(recipes, { deps: broken.deps })).rejects.toThrow("ydotoold");
    expect([...calls, ...broken.calls]).toEqual([]);
  });
});
