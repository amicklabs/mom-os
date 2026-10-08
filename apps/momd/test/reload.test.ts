import { describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import type { ConfigFile, Tile } from "@momos/shared";
import type { ReloadResult } from "@momos/momctl/reload";
import { validatePending } from "../src/actions";
import { noBackend } from "../src/convex";
import { Core, Supervisor } from "../src/core";
import { Help } from "../src/help";
import { EventQueue } from "../src/queue";
import { RELOAD_MAX_AGE_MS, RELOAD_NOTICE_SECONDS, reload, say } from "../src/runner";
import { makeHandler } from "../src/socket";

const config: ConfigFile = {
  person: { name: "Mom", user: "mom" },
  helper: { name: "Sam", phone: "555-555-0100" },
  tiles: [
    { id: "recipes", label: "Recipes", type: "webapp", url: "https://recipes.example.com/pages/welcome" },
    { id: "telegram", label: "Telegram", type: "app", app: "telegram" },
  ],
  family: [],
};

function core() {
  const root = mkdtempSync(`${tmpdir()}/rl-`);
  process.env.XDG_CONFIG_HOME = `${root}/config`;
  mkdirSync(`${root}/config/momos`, { recursive: true });
  writeFileSync(`${root}/config/momos/config.json`, JSON.stringify(config));
  return new Core(new EventQueue(`${root}/q.sqlite`), "test");
}

const ran: { tile: Tile; locked?: boolean }[] = [];
const run = async (tile: Tile, o: { locked?: boolean } = {}): Promise<ReloadResult> => {
  ran.push({ tile, locked: o.locked });
  return { tileId: tile.id, label: tile.label, workspace: `tile-${tile.id}`, action: "reloaded", window: { address: "0x1", class: "c" } };
};

describe("reload action", () => {
  test("is allowlisted with a tile id", () => {
    expect(validatePending({ _id: "a", action: { type: "reload", tileId: "recipes" } }).ok).toBe(true);
    expect(validatePending({ _id: "a", action: { type: "reload", tileId: "no such thing!" } }).ok).toBe(false);
  });

  test("reloads the tile and tells her briefly", async () => {
    const c = core();
    ran.length = 0;
    const r = await reload(c, "recipes", { createdAt: Date.now(), run, config: () => config });
    expect(r).toMatchObject({ ok: true, result: "reloaded Recipes" });
    expect(ran[0]).toMatchObject({ tile: { id: "recipes" }, locked: false });
    expect(c.model.banner?.text).toBe("Sam refreshed Recipes.");
    expect(c.model.banner?.kind).toBe("info");
    expect(c.model.banner!.until! - Date.now()).toBeLessThanOrEqual(RELOAD_NOTICE_SECONDS * 1000);
  });

  test("a tile that wasn't open says it was opened", async () => {
    const c = core();
    const opened = async (tile: Tile) => ({ ...(await run(tile)), action: "opened" as const });
    expect((await reload(c, "recipes", { run: opened, config: () => config })).result).toBe("Recipes wasn't open, so it was opened");
  });

  test("never covers a message from the helper", async () => {
    const c = core();
    say(c, "I'll call you soon");
    await reload(c, "recipes", { run, config: () => config });
    expect(c.model.banner?.text).toBe("Sam says: I'll call you soon");
  });

  test("refuses a tile she doesn't have, and one that waited too long", async () => {
    const c = core();
    ran.length = 0;
    await expect(reload(c, "nope", { run, config: () => config })).rejects.toThrow('no tile "nope"');
    const old = await reload(c, "recipes", { run, config: () => config, createdAt: 1000, now: 1000 + RELOAD_MAX_AGE_MS + 1 });
    expect(old).toMatchObject({ ok: false, result: "refused: it was sent more than 10 minutes ago" });
    expect(ran).toEqual([]);
    expect(c.model.banner).toBeNull();
  });

  test("the socket command needs a tile id", async () => {
    const c = core();
    const handler = makeHandler(c, new Help(c, noBackend), new Supervisor(c));
    await expect(handler("reload", {})).rejects.toThrow("reload needs tileId");
    await expect(handler("reload", { tileId: "telegram" })).rejects.toThrow("isn't a web page");
  });
});
