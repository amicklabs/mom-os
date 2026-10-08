import { expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { noBackend } from "../src/convex";
import { Core, Supervisor } from "../src/core";
import { Help } from "../src/help";
import { viewerCountFrom } from "../src/monitors";
import { EventQueue } from "../src/queue";
import { makeHandler } from "../src/socket";

const newCore = () => new Core(new EventQueue(`${mkdtempSync(`${tmpdir()}/c-`)}/q.sqlite`), "test");

process.env.XDG_DATA_HOME = mkdtempSync(`${tmpdir()}/data-`);

test("help without Convex says offline, queues it and logs it", async () => {
  const core = newCore();
  const help = new Help(core, noBackend);
  expect((await help.request({ callMe: true })).status).toBe("offline");
  expect(core.model.help).toMatchObject({ status: "offline", queued: 1 });
  expect(core.queue.peek(10).map((e) => (e.type === "help" ? e.stage : e.type))).toEqual(["pressed", "failed"]);
});

test("two presses at once are two requests, one after the other", async () => {
  const core = newCore();
  const help = new Help(core, noBackend);
  const [a, b] = await Promise.all([help.request({ text: "one" }), help.request({ text: "two" })]);
  expect([a.queued, b.queued]).toEqual([1, 2]);
  expect(help.outbox.list().map((i) => i.text)).toEqual(["one", "two"]);
});

test("wayvncctl events", () => {
  expect(viewerCountFrom({ method: "client-connected", params: { id: "0x1", connection_count: 1 } })).toBe(1);
  expect(viewerCountFrom({ method: "client-disconnected", params: { connection_count: 0 } })).toBe(0);
  expect(viewerCountFrom({ method: "client-disconnected", params: { connection_count: 1 } })).toBe(1);
  expect(viewerCountFrom({ method: "capture-changed", params: {} })).toBeNull();
  expect(viewerCountFrom({ method: "wayvnc-shutdown" })).toBe(0);
});

test("screenshots are silent: momd has no screenshot notice to show", async () => {
  process.env.XDG_CONFIG_HOME = mkdtempSync(`${tmpdir()}/cfg-`);
  const core = newCore();
  const handler = makeHandler(core, new Help(core, noBackend), new Supervisor(core));
  await expect(handler("screenshot-notice", { seconds: 8 })).rejects.toThrow('unknown command "screenshot-notice"');
  expect(core.model.banner).toBeNull();
});
