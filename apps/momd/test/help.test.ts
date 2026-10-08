import { expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import type { Backend } from "../src/convex";
import { Core, Supervisor } from "../src/core";
import { Help, recentScreens } from "../src/help";
import { HelpOutbox } from "../src/outbox";
import { EventQueue } from "../src/queue";
import { makeRunner, sendRecentScreens } from "../src/runner";
import { ScreenWatch } from "../src/screen";
import { makeHandler } from "../src/socket";
import { type Proc, VoiceRecorder, wavSeconds } from "../src/voice";

process.env.XDG_RUNTIME_DIR = mkdtempSync(`${tmpdir()}/rt-`);
process.env.XDG_DATA_HOME = mkdtempSync(`${tmpdir()}/data-`);
process.env.XDG_CONFIG_HOME = mkdtempSync(`${tmpdir()}/cfg-`);
mkdirSync(`${process.env.XDG_CONFIG_HOME}/momos`, { recursive: true });
writeFileSync(
  `${process.env.XDG_CONFIG_HOME}/momos/config.json`,
  JSON.stringify({ person: { name: "Mom", user: "mom" }, helper: { name: "Sam", phone: "555" }, tiles: [], family: [] }),
);

const newCore = (db = `${mkdtempSync(`${tmpdir()}/c-`)}/q.sqlite`) => new Core(new EventQueue(db), "test");
const screenOn = () => new ScreenWatch(async () => true);
const writes = async (path: string) => writeFileSync(path, "jpg");

// A backend that can be switched off, fail, and remembers what it got.
function fakeBackend() {
  const state = { ready: true, fail: null as string | null };
  const uploads: { path: string; type: string }[] = [];
  const calls: { name: string; args: Record<string, any> }[] = [];
  const backend: Backend = {
    ready: () => state.ready,
    upload: async (path, type) => {
      if (state.fail) throw new Error(state.fail);
      uploads.push({ path, type });
      return `storage-${uploads.length}`;
    },
    mutation: async <T>(name: string, args: Record<string, unknown>) => {
      if (state.fail) throw new Error(state.fail);
      calls.push({ name, args });
      return { helpRequestId: "h1" } as T;
    },
  };
  const requests = () => calls.filter((c) => c.name === "device.createHelpRequest").map((c) => c.args);
  return { state, backend, uploads, calls, requests };
}

// pw-record and ffmpeg stand-ins: the recording is a WAV of the given length,
// written when it's stopped.
function fakeVoice(seconds = 4, opts: { maxMs?: number } = {}) {
  const log: string[] = [];
  const voice = new VoiceRecorder({
    maxMs: opts.maxMs,
    dir: () => `${process.env.XDG_RUNTIME_DIR}/help`,
    record: (wav): Proc => {
      log.push("record");
      let done!: (code: number) => void;
      const exited = new Promise<number>((r) => (done = r));
      return {
        exited,
        kill: (sig) => {
          log.push(`kill ${sig}`);
          writeFileSync(wav, new Uint8Array(44 + seconds * 48_000 * 2));
          done(0);
        },
      };
    },
    encode: async (_wav, ogg) => {
      log.push("encode");
      writeFileSync(ogg, "OggS opus");
    },
  });
  return { voice, log };
}

test("her words go out with the kinds she chose", async () => {
  const core = newCore();
  const { backend, requests } = fakeBackend();
  const help = new Help(core, backend, { screen: screenOn(), shoot: writes });
  const r = await help.request({ text: "  The sound stopped.\r\n  ", callMe: true });
  expect(r).toMatchObject({ status: "sent", kinds: ["message", "call-me"], queued: 0 });
  expect(requests()[0]).toMatchObject({ text: "The sound stopped.", kinds: ["message", "call-me"], screenshots: [] });
  expect(core.model.help).toMatchObject({ status: "sent", queued: 0 });
});

test("the screen is captured before the shell hears it's sending", async () => {
  const core = newCore();
  const { backend } = fakeBackend();
  const order: string[] = [];
  core.onChange(() => {
    if (core.model.help.status === "sending" && !order.includes("sending")) order.push("sending");
  });
  const help = new Help(core, backend, {
    screen: screenOn(),
    shoot: async (path) => {
      order.push("shoot");
      writeFileSync(path, "jpg");
    },
  });
  await help.request({ screenshot: true });
  expect(order).toEqual(["shoot", "sending"]);
});

test("offline, a request waits in the outbox and goes when the internet is back", async () => {
  const core = newCore();
  const { state, backend, uploads, requests } = fakeBackend();
  state.ready = false;
  const help = new Help(core, backend, { screen: screenOn(), shoot: writes });
  const r = await help.request({ text: "Is anyone there?", screenshot: true });
  expect(r).toMatchObject({ status: "offline", queued: 1, freshScreenshot: true });
  expect(requests()).toEqual([]);
  const [item] = help.outbox.list();
  expect(existsSync(item!.screenshot!)).toBe(true);

  // Still offline: nothing happens.
  expect(await help.drain()).toBe(0);
  state.ready = true;
  expect(await help.drain()).toBe(1);
  expect(requests()[0]).toMatchObject({ text: "Is anyone there?", kinds: ["message", "screenshot"], askedAt: item!.askedAt });
  expect(uploads[0]!.type).toBe("image/jpeg");
  expect(existsSync(item!.screenshot!)).toBe(false);
  expect(core.model.help).toMatchObject({ status: "sent", queued: 0 });
  expect(core.model.banner?.text).toBe("Sam has your message now.");
});

test("a failed send stays in the outbox, waits, and is tried again", async () => {
  const core = newCore();
  const { state, backend, requests } = fakeBackend();
  state.fail = "Convex said no";
  const help = new Help(core, backend, { screen: screenOn(), shoot: writes });
  const r = await help.request({ callMe: true });
  expect(r).toMatchObject({ status: "failed", queued: 1 });
  expect(help.outbox.due()).toEqual([]); // waiting out its backoff
  state.fail = null;
  help.outbox.retryNow();
  expect(await help.drain()).toBe(1);
  expect(requests()).toHaveLength(1);
  expect(help.outbox.count()).toBe(0);
});

test("the outbox survives a restart of momd", async () => {
  const db = `${mkdtempSync(`${tmpdir()}/c-`)}/q.sqlite`;
  const first = newCore(db);
  const off = fakeBackend();
  off.state.ready = false;
  await new Help(first, off.backend, { screen: screenOn(), shoot: writes }).request({ text: "Still there?" });
  first.queue.close();

  const second = newCore(db);
  const on = fakeBackend();
  const help = new Help(second, on.backend, { screen: screenOn(), shoot: writes });
  expect(second.model.help.queued).toBe(1);
  await help.drain();
  expect(on.requests()[0]?.text).toBe("Still there?");
});

test("the outbox drops requests older than three days", () => {
  let now = 1_000_000_000;
  const core = newCore();
  const outbox = new HelpOutbox(core.queue.db, () => `${process.env.XDG_DATA_HOME}/ob`, () => now);
  outbox.add({ askedAt: now, kinds: ["call-me"], text: null, note: null, context: core.status(), screenshot: null, voice: null, voiceSeconds: null });
  now += 3 * 24 * 60 * 60_000 + 1;
  expect(outbox.trim()).toBe(1);
  expect(outbox.count()).toBe(0);
});

test("a voice note is recorded, encoded, and sent as Ogg Opus", async () => {
  const core = newCore();
  const { backend, uploads, requests } = fakeBackend();
  const { voice, log } = fakeVoice(5);
  const help = new Help(core, backend, { screen: screenOn(), shoot: writes, voice });
  expect(voice.start().maxSeconds).toBe(60);
  expect(voice.recording()).toBe(true);
  const r = await help.request({ voice: true, text: "listen" });
  expect(log).toEqual(["record", "kill SIGINT", "encode"]);
  expect(r).toMatchObject({ status: "sent", kinds: ["message", "voice"], voiceSeconds: 5 });
  expect(uploads.map((u) => u.type)).toEqual(["audio/ogg"]);
  expect(requests()[0]).toMatchObject({ voice: "storage-1", voiceSeconds: 5, kinds: ["message", "voice"] });
  // The WAV is gone, and the Ogg left with the request.
  expect(readdirSync(`${process.env.XDG_RUNTIME_DIR}/help`).filter((f) => f.startsWith("voice-"))).toEqual([]);
});

test("voice with nothing recorded still sends, without the voice kind", async () => {
  const core = newCore();
  const { backend, requests } = fakeBackend();
  const help = new Help(core, backend, { screen: screenOn(), shoot: writes, voice: fakeVoice().voice });
  const r = await help.request({ voice: true });
  expect(r.kinds).toEqual([]);
  expect(requests()[0]?.note).toBe("no voice note: nothing was recorded");
});

test("a recording stops by itself at the limit and waits to be sent", async () => {
  const { voice, log } = fakeVoice(1, { maxMs: 30 });
  voice.start();
  await Bun.sleep(80);
  expect(voice.recording()).toBe(false);
  expect(log).toEqual(["record", "kill SIGINT", "encode"]);
  const note = await voice.take();
  expect(note?.seconds).toBe(1);
  expect(await voice.take()).toBeNull();
});

test("a cancelled recording is thrown away", async () => {
  const { voice } = fakeVoice(3);
  voice.start();
  await voice.cancel();
  expect(voice.recording()).toBe(false);
  expect(await voice.take()).toBeNull();
});

test("a recording under a second isn't a voice note", async () => {
  const { voice } = fakeVoice(0);
  voice.start();
  expect(await voice.stop()).toBeNull();
});

test("WAV length from its size", () => {
  expect(wavSeconds(44 + 48_000 * 2 * 7)).toBe(7);
  expect(wavSeconds(10)).toBe(0);
});

test("a voice file for testing must be Ogg and not too big", async () => {
  const core = newCore();
  const { backend, requests, uploads } = fakeBackend();
  const help = new Help(core, backend, { screen: screenOn(), shoot: writes });
  const dir = mkdtempSync(`${tmpdir()}/v-`);
  writeFileSync(`${dir}/tone.ogg`, "OggS");
  writeFileSync(`${dir}/tone.mp3`, "ID3");
  expect((await help.request({ voiceFile: `${dir}/tone.ogg` })).kinds).toEqual(["voice"]);
  expect(uploads[0]!.type).toBe("audio/ogg");
  // Copied, not moved: the test file stays.
  expect(existsSync(`${dir}/tone.ogg`)).toBe(true);
  const r = await help.request({ voiceFile: `${dir}/tone.mp3` });
  expect(r.kinds).toEqual([]);
  expect(requests()[1]?.note).toContain("must be an Ogg Opus file");
});

test("recent screens: she's told, then the pictures go oldest first", async () => {
  const core = newCore();
  const { backend, uploads, calls } = fakeBackend();
  const order: string[] = [];
  const r = await sendRecentScreens(core, backend, "action-1", {
    screens: recentScreens(["/ring/300.jpg", "/ring/100.jpg", "/ring/200.jpg"]),
    wait: async () => order.push(`banner: ${core.model.banner?.text}`),
  });
  expect(order).toEqual(["banner: Sam is looking at your last few minutes"]);
  expect(uploads.map((u) => u.path)).toEqual(["/ring/100.jpg", "/ring/200.jpg", "/ring/300.jpg"]);
  expect(calls.at(-1)).toEqual({
    name: "device.attachScreens",
    args: {
      actionId: "action-1",
      screens: [
        { storageId: "storage-1", takenAt: 100 },
        { storageId: "storage-2", takenAt: 200 },
        { storageId: "storage-3", takenAt: 300 },
      ],
    },
  });
  expect(r).toEqual({ ok: true, result: "3 pictures" });
});

test("recent screens with an empty ring buffer says why", async () => {
  const core = newCore();
  const { backend, calls } = fakeBackend();
  const r = await sendRecentScreens(core, backend, "a", { screens: [], wait: async () => {} });
  expect(r.result).toContain("none were taken");
  expect(calls).toEqual([]);
});

test("help-seen tells her Sam saw her message", async () => {
  const core = newCore();
  const run = makeRunner(core, () => fakeBackend().backend);
  expect(await run("a", { type: "help-seen" })).toEqual({ ok: true });
  expect(core.model.banner).toMatchObject({ kind: "info", text: "Sam saw your message." });
});

test("the socket takes help's arguments and voice commands", async () => {
  const core = newCore();
  const { backend, requests } = fakeBackend();
  const { voice } = fakeVoice(2);
  const help = new Help(core, backend, { screen: screenOn(), shoot: writes, voice });
  const handler = makeHandler(core, help, new Supervisor(core));
  await expect(handler("help", { text: 5 })).rejects.toThrow("help:");
  expect(await handler("voice", { action: "start" })).toMatchObject({ recording: true, maxSeconds: 60 });
  expect(await handler("voice", { action: "stop" })).toEqual({ recording: false, seconds: 2 });
  expect(await handler("help", { voice: true, callMe: true })).toMatchObject({ status: "sent", kinds: ["call-me", "voice"] });
  expect(requests()[0]?.voiceSeconds).toBe(2);
  expect(await handler("voice", { action: "start" })).toMatchObject({ recording: true });
  expect(await handler("voice", { action: "cancel" })).toEqual({ recording: false });
  await expect(handler("voice", { action: "play" })).rejects.toThrow("start, stop or cancel");
});
