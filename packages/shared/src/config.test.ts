import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { Action } from "./actions";
import { ConfigFile, dkmsModules, isReloadable, lidMode, type Tile } from "./config";

const stripComments = (s: string) => s.replace(/^\s*\/\/.*$/gm, "");
const example = () => JSON.parse(stripComments(readFileSync(new URL("../../../config/example.jsonc", import.meta.url), "utf8")));

test("example config is valid", () => {
  expect(ConfigFile.safeParse(example()).success).toBe(true);
});

test("http tiles and unknown apps are rejected", () => {
  const base = { person: { name: "B", user: "b" }, helper: { name: "N", phone: "1" }, family: [] };
  expect(ConfigFile.safeParse({ ...base, tiles: [{ id: "x", label: "X", type: "webapp", url: "http://x.com" }] }).success).toBe(false);
  expect(ConfigFile.safeParse({ ...base, tiles: [{ id: "x", label: "X", type: "app", app: "bash" }] }).success).toBe(false);
});

test("the hardware block is optional and defaults to no DKMS checks and a normal lid", () => {
  const base = { person: { name: "B", user: "b" }, helper: { name: "N", phone: "1" }, tiles: [], family: [] };
  const plain = ConfigFile.parse(base);
  expect(dkmsModules(plain)).toEqual([]);
  expect(lidMode(plain)).toBe("normal");
  expect(lidMode(ConfigFile.parse({ ...base, local: { hardware: null } }))).toBe("normal");

  const mac = ConfigFile.parse({ ...base, local: { hardware: { dkmsModules: ["wl", "facetimehd"], lid: "flaky-macbook" } } });
  expect(dkmsModules(mac)).toEqual(["wl", "facetimehd"]);
  expect(lidMode(mac)).toBe("flaky-macbook");

  expect(ConfigFile.safeParse({ ...base, local: { hardware: { lid: "sometimes" } } }).success).toBe(false);
  expect(ConfigFile.safeParse({ ...base, local: { hardware: { dkmsModules: ["wl; reboot"] } } }).success).toBe(false);
});

test("the example config is set up for the 2013 MacBook Air", () => {
  const config = ConfigFile.parse(example());
  expect(dkmsModules(config)).toEqual(["wl", "facetimehd"]);
  expect(lidMode(config)).toBe("flaky-macbook");
});

const tile = (t: Tile) => t;

test("only web pages reload: web apps and the Browser", () => {
  const tiles = ConfigFile.parse(example()).tiles;
  const reloadable = tiles.filter(isReloadable).map((t) => t.type === "app" ? t.app : t.type);
  expect(reloadable.length).toBeGreaterThan(0);
  expect(reloadable.every((k) => k === "webapp" || k === "chromium")).toBe(true);
  expect(isReloadable(tile({ id: "t", label: "T", type: "app", app: "telegram" }))).toBe(false);
  expect(isReloadable(tile({ id: "f", label: "F", type: "page", page: "family" }))).toBe(false);
  expect(isReloadable(tile({ id: "c", label: "C", type: "telegram-chat", telegram: "example_user" }))).toBe(false);
  expect(isReloadable(tile({ id: "b", label: "Browser", type: "app", app: "chromium" }))).toBe(true);
});

test("the reload action takes a tile id and nothing else", () => {
  expect(Action.safeParse({ type: "reload", tileId: "recipes" }).success).toBe(true);
  expect(Action.safeParse({ type: "reload" }).success).toBe(false);
  expect(Action.safeParse({ type: "reload", tileId: "../x" }).success).toBe(false);
  expect(Action.safeParse({ type: "reload", tileId: "Family Recipes" }).success).toBe(false);
});

test("her phone, her Telegram username and autoInvestigate are optional", () => {
  const base = { person: { name: "B", user: "b" }, helper: { name: "N", phone: "1" }, tiles: [], family: [] };
  expect(ConfigFile.parse(base).helper.autoInvestigate).toBeUndefined();
  const full = ConfigFile.parse({
    ...base,
    person: { name: "B", user: "b", phone: "555-555-0101", telegram: "example_person" },
    helper: { name: "N", phone: "1", autoInvestigate: true },
  });
  expect(full.person.phone).toBe("555-555-0101");
  expect(full.helper.autoInvestigate).toBe(true);
  expect(ConfigFile.safeParse({ ...base, person: { name: "B", user: "b", telegram: "@no" } }).success).toBe(false);
});
