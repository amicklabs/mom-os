import { expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { HELP_NOTE_MAX } from "@momos/shared";
import type { Backend } from "../src/convex";
import { Core } from "../src/core";
import { Help, ringShouldCapture } from "../src/help";
import { EventQueue } from "../src/queue";
import { JUST_WOKE_MS, ScreenWatch } from "../src/screen";

process.env.XDG_RUNTIME_DIR = mkdtempSync(`${tmpdir()}/rt-`);
process.env.XDG_DATA_HOME = mkdtempSync(`${tmpdir()}/data-`);
const newCore = () => new Core(new EventQueue(`${mkdtempSync(`${tmpdir()}/c-`)}/q.sqlite`), "test");

function fakeBackend() {
  const uploads: string[] = [];
  const requests: { screenshots: string[]; note?: string; kinds?: string[] }[] = [];
  const backend: Backend = {
    ready: () => true,
    upload: async (path) => {
      uploads.push(path);
      return `id-${uploads.length}`;
    },
    mutation: async <T>(name: string, args: Record<string, unknown>) => {
      if (name === "device.createHelpRequest") requests.push(args as { screenshots: string[]; note?: string });
      return { helpRequestId: "h1" } as T;
    },
  };
  return { backend, uploads, requests };
}

// A screen that reports each value in turn, then the last one forever.
function screenOf(...values: (boolean | null)[]) {
  let i = 0;
  let now = 1_000_000;
  const watch = new ScreenWatch(
    async () => values[Math.min(i++, values.length - 1)]!,
    () => now,
  );
  return { watch, advance: (ms: number) => (now += ms) };
}

const writes = async (path: string) => writeFileSync(path, "jpg");

test("the ring buffer skips a dark or locked screen", () => {
  expect(ringShouldCapture({ locked: false, lidClosed: false, screenOn: true })).toBe(true);
  expect(ringShouldCapture({ locked: false, lidClosed: false, screenOn: null })).toBe(true);
  expect(ringShouldCapture({ locked: false, lidClosed: false, screenOn: false })).toBe(false);
  expect(ringShouldCapture({ locked: false, lidClosed: true, screenOn: true })).toBe(false);
  expect(ringShouldCapture({ locked: true, lidClosed: false, screenOn: true })).toBe(false);
});

test("the screen watch notices the screen coming on", async () => {
  const s = screenOf(true, false, true);
  await s.watch.check();
  expect(s.watch.justWoke()).toBe(false); // on since before momd looked
  await s.watch.check();
  expect(s.watch.justWoke()).toBe(false);
  await s.watch.check();
  expect(s.watch.justWoke()).toBe(true);
  s.advance(JUST_WOKE_MS);
  expect(s.watch.justWoke()).toBe(false);
});

test("an unknown screen state doesn't count as a change", async () => {
  const s = screenOf(false, null, true);
  await s.watch.check();
  await s.watch.check();
  await s.watch.check();
  expect(s.watch.justWoke()).toBe(true);
});

test("a screenshot request with the screen off goes without a picture, and says why", async () => {
  const core = newCore();
  const { backend, uploads, requests } = fakeBackend();
  let shots = 0;
  const help = new Help(core, backend, {
    screen: screenOf(false).watch,
    shoot: async () => {
      shots++;
    },
  });
  const r = await help.request({ screenshot: true });
  expect(r).toMatchObject({ status: "sent", freshScreenshot: false, note: "screen was off", kinds: ["screenshot"] });
  expect(shots).toBe(0);
  expect(uploads).toEqual([]);
  expect(requests[0]!.screenshots).toEqual([]);
  expect(requests[0]!.note).toBe("screen was off");
  expect(core.model.help.status).toBe("sent");
});

test("the ring buffer never goes with a help request", async () => {
  const core = newCore();
  const { backend, uploads } = fakeBackend();
  const help = new Help(core, backend, { screen: screenOf(true).watch, shoot: writes });
  await help.request({ screenshot: true, text: "hello" });
  await help.request({ callMe: true });
  expect(uploads).toHaveLength(1);
  expect(uploads[0]).toContain("/help-outbox/");
});

test("help is sent even when grim fails", async () => {
  const core = newCore();
  const { backend, requests } = fakeBackend();
  const help = new Help(core, backend, {
    screen: screenOf(null).watch,
    shoot: async () => {
      throw new Error("grim timed out after 15000 ms");
    },
  });
  const r = await help.request({ screenshot: true });
  expect(r.status).toBe("sent");
  expect(r.note).toContain("grim timed out");
  expect(requests[0]!.note).toContain("grim timed out");
  expect(requests[0]!.screenshots).toEqual([]);
});

test("help with the lid closed skips the fresh picture", async () => {
  const core = newCore();
  core.dispatch({ type: "lid", closed: true });
  const { backend } = fakeBackend();
  const help = new Help(core, backend, { screen: screenOf(true).watch, shoot: writes });
  expect((await help.request({ screenshot: true })).note).toBe("screen was off: the lid was closed");
});

test("help waits for a screen that just came on, then takes the picture", async () => {
  const core = newCore();
  const { backend, uploads, requests } = fakeBackend();
  const s = screenOf(false, true);
  await s.watch.check(); // the poller saw it off
  const events: string[] = [];
  const help = new Help(core, backend, {
    screen: s.watch,
    shoot: async (path) => {
      events.push("shoot");
      writeFileSync(path, "jpg");
    },
    wait: async (ms) => {
      events.push(`wait ${ms}`);
    },
  });
  const r = await help.request({ screenshot: true });
  expect(r).toMatchObject({ status: "sent", freshScreenshot: true, note: null });
  expect(Object.keys(requests[0]!)).not.toContain("note");
  expect(events[0]).toMatch(/^wait \d+$/);
  expect(events[1]).toBe("shoot");
  expect(uploads).toHaveLength(1);
});

test("help doesn't wait when the screen has been on a while", async () => {
  const core = newCore();
  const { backend } = fakeBackend();
  const events: string[] = [];
  const help = new Help(core, backend, {
    screen: screenOf(true).watch,
    shoot: async (path) => {
      events.push("shoot");
      writeFileSync(path, "jpg");
    },
    wait: async () => {
      events.push("wait");
    },
  });
  await help.request({ screenshot: true });
  expect(events).toEqual(["shoot"]);
});

test("a long note is cut to fit before it goes to Convex", async () => {
  const core = newCore();
  const { backend, requests } = fakeBackend();
  const help = new Help(core, backend, {
    screen: screenOf(null).watch,
    shoot: async () => {
      throw new Error("x".repeat(500));
    },
  });
  await help.request({ screenshot: true });
  expect(requests[0]!.note!.length).toBe(HELP_NOTE_MAX);
});
