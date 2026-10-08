import { existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import {
  type HelpArgs,
  type HelpKind,
  helpKinds,
  helpNote,
  helpText,
  paths,
  RECENT_SCREENS,
  runtimeDir,
  VOICE_MAX_BYTES,
} from "@momos/shared";
import { WAKE_SETTLE_MS } from "@momos/momctl/screen";
import { prune, screenshot } from "@momos/momctl/system";
import { type Core, every, log, sleep } from "./core";
import type { Backend } from "./convex";
import { isLocked } from "./model";
import { type HelpItem, HelpOutbox } from "./outbox";
import { showBanner } from "./runner";
import { ScreenWatch } from "./screen";
import { VoiceRecorder } from "./voice";

// The Help pop-up's requests, and the ring buffer of recent screenshots.
//
// A request goes into the outbox (outbox.ts) first, then straight to Convex
// when the laptop is online. If it can't go, it waits there and goes by itself
// later. The ring buffer never leaves the laptop on its own: only the helper's
// recent-screens action sends it, and she's told first.

export const RING_KEEP = 10;
export const RING_EVERY_MS = 60_000;
const HELP_TIMEOUT_MS = 60_000;
// How often the outbox is checked while something waits in it.
export const OUTBOX_EVERY_MS = 5000;

export function ringFiles(): string[] {
  const dir = paths.screenshots();
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => /^\d+\.jpg$/.test(f))
    .sort((a, b) => Number(b.slice(0, -4)) - Number(a.slice(0, -4)))
    .slice(0, RING_KEEP)
    .map((f) => `${dir}/${f}`);
}

// The ring buffer's pictures for the recent-screens action, oldest first,
// with the time each was taken (its file name).
export function recentScreens(files: string[] = ringFiles()): { file: string; takenAt: number }[] {
  return files
    .map((file) => ({ file, takenAt: Number(file.slice(file.lastIndexOf("/") + 1, -4)) }))
    .filter((s) => Number.isFinite(s.takenAt))
    .sort((a, b) => a.takenAt - b.takenAt)
    .slice(-RECENT_SCREENS);
}

// Whether the ring buffer should take its picture this minute. Nothing to see
// with the screen locked, the lid shut or every monitor off, and grim would
// only time out on a dark screen. `screenOn` null means Hyprland didn't say.
export function ringShouldCapture(m: { locked: boolean; lidClosed: boolean; screenOn: boolean | null }): boolean {
  return !m.locked && !m.lidClosed && m.screenOn !== false;
}

export async function ringBuffer(core: Core, screen: ScreenWatch): Promise<void> {
  const dir = paths.screenshots();
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  await every(RING_EVERY_MS, async () => {
    // Skips are silent: a dark screen overnight is normal.
    if (isLocked(core.model) || core.model.lidClosed) return;
    const on = await screen.check();
    if (!ringShouldCapture({ locked: false, lidClosed: false, screenOn: on })) return;
    await screenshot(`${dir}/${Date.now()}.jpg`, { jpeg: true });
    prune(dir, RING_KEEP);
  });
}

export type HelpStatus = "sent" | "failed" | "offline";

// `note` says why no fresh screenshot went with it, when she asked for one.
// `queued` counts requests still waiting in the outbox, this one included
// unless it was sent.
export interface HelpResult {
  status: HelpStatus;
  kinds: HelpKind[];
  freshScreenshot: boolean;
  voiceSeconds: number | null;
  note: string | null;
  queued: number;
}

export interface HelpDeps {
  screen?: ScreenWatch;
  // Takes a picture into path. Defaults to grim through momctl's library.
  shoot?: (path: string) => Promise<unknown>;
  wait?: (ms: number) => Promise<unknown>;
  voice?: VoiceRecorder;
  outbox?: HelpOutbox;
}

const withTimeout = <T>(p: Promise<T>, ms: number, what: string): Promise<T> => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    p,
    new Promise<never>((_, rej) => {
      timer = setTimeout(() => rej(new Error(`${what} timed out`)), ms);
    }),
  ]).finally(() => clearTimeout(timer));
};

export class Help {
  private chain: Promise<unknown> = Promise.resolve();
  private sending = new Set<string>();
  private readonly screen: ScreenWatch;
  private readonly shoot: (path: string) => Promise<unknown>;
  private readonly wait: (ms: number) => Promise<unknown>;
  readonly voice: VoiceRecorder;
  readonly outbox: HelpOutbox;

  constructor(
    private readonly core: Core,
    private readonly backend: Backend,
    deps: HelpDeps = {},
  ) {
    this.screen = deps.screen ?? new ScreenWatch();
    this.shoot = deps.shoot ?? ((path) => screenshot(path, { jpeg: true }));
    this.wait = deps.wait ?? sleep;
    this.voice = deps.voice ?? new VoiceRecorder();
    this.outbox = deps.outbox ?? new HelpOutbox(core.queue.db);
    this.core.dispatch({ type: "help-queue", queued: this.outbox.count() });
  }

  // One request at a time, in the order she made them.
  request(args: HelpArgs = {}): Promise<HelpResult> {
    const p = this.chain.then(() => this.send(args));
    this.chain = p.catch(() => undefined);
    return p;
  }

  // A picture of the screen as it is, or why there isn't one. The request
  // goes out either way.
  private async freshShot(path: string): Promise<{ path: string | null; note: string | null }> {
    if (this.core.model.lidClosed) return { path: null, note: "screen was off: the lid was closed" };
    const on = await this.screen.check();
    if (on === false) return { path: null, note: "screen was off" };
    // She usually wakes the screen to press Help. Give it a moment to draw.
    if (this.screen.justWoke()) await this.wait(WAKE_SETTLE_MS);
    try {
      await this.shoot(path);
      return { path, note: null };
    } catch (e) {
      log("help", "no fresh screenshot:", e);
      const off = (await this.screen.check()) === false;
      return { path: null, note: off ? "screen was off" : `no fresh screenshot: ${e instanceof Error ? e.message : e}` };
    }
  }

  // A voice note file given on the command line, for testing.
  private voiceFile(file: string): { file: string; seconds: number | null } {
    if (!/\.(ogg|oga|opus)$/i.test(file)) throw new Error("the voice note must be an Ogg Opus file (.ogg)");
    const size = statSync(file).size;
    if (size === 0 || size > VOICE_MAX_BYTES) throw new Error("the voice note is empty or too big");
    return { file: this.outbox.keep(file, "ogg", true), seconds: null };
  }

  private queued(): number {
    const n = this.outbox.count();
    this.core.dispatch({ type: "help-queue", queued: n });
    return n;
  }

  private offline(): boolean {
    return !this.backend.ready() || this.core.model.online === false;
  }

  private async send(args: HelpArgs): Promise<HelpResult> {
    this.core.record({ type: "help", stage: "pressed" });
    const text = helpText(args.text) ?? null;
    const notes: string[] = [];

    // The pop-up is hidden now. Take the picture before anything changes.
    let shot: string | null = null;
    if (args.screenshot) {
      const dir = `${runtimeDir()}/help`;
      mkdirSync(dir, { recursive: true, mode: 0o700 });
      const fresh = await this.freshShot(`${dir}/help-${Date.now()}.jpg`);
      if (fresh.path && existsSync(fresh.path)) shot = this.outbox.keep(fresh.path, "jpg");
      else if (fresh.path) fresh.note = "no fresh screenshot: grim wrote nothing";
      if (fresh.note) {
        notes.push(fresh.note);
        log("help", `sending without a fresh screenshot (${fresh.note})`);
      }
    }
    // The shell brings the pop-up back when it sees this.
    this.core.dispatch({ type: "help", status: "sending" });

    let voice: { file: string; seconds: number | null } | null = null;
    try {
      if (args.voiceFile) voice = this.voiceFile(args.voiceFile);
      else if (args.voice) {
        const note = await this.voice.take();
        if (note) voice = { file: this.outbox.keep(note.file, "ogg"), seconds: note.seconds };
        else notes.push("no voice note: nothing was recorded");
      }
    } catch (e) {
      log("help", "no voice note:", e);
      notes.push(`no voice note: ${e instanceof Error ? e.message : e}`);
    }

    const kinds = helpKinds({ text, screenshot: args.screenshot, callMe: args.callMe, voice: voice !== null });
    const note = helpNote(notes.join("; ")) ?? null;
    const item = this.outbox.add({
      askedAt: Date.now(),
      kinds,
      text,
      note,
      context: this.core.status(),
      screenshot: shot,
      voice: voice?.file ?? null,
      voiceSeconds: voice?.seconds ?? null,
    });
    const result = (status: HelpStatus): HelpResult => {
      this.core.dispatch({ type: "help", status });
      return { status, kinds, freshScreenshot: shot !== null, voiceSeconds: voice?.seconds ?? null, note, queued: this.queued() };
    };

    if (this.offline()) {
      log("help", "offline; the request waits in the outbox");
      return result("offline");
    }
    try {
      await withTimeout(this.deliver(item), HELP_TIMEOUT_MS, "help request");
      return result("sent");
    } catch (e) {
      log("help", "failed; the request waits in the outbox:", e);
      this.core.error("help", e);
      this.outbox.failed(item, e instanceof Error ? e.message : String(e));
      return result(this.offline() ? "offline" : "failed");
    }
  }

  // Uploads a request's files and creates it in Convex. It leaves the outbox
  // only once Convex has it.
  private async deliver(item: HelpItem): Promise<void> {
    if (this.sending.has(item.id)) throw new Error("already sending");
    this.sending.add(item.id);
    try {
      const screenshots: string[] = [];
      if (item.screenshot && existsSync(item.screenshot)) screenshots.push(await this.backend.upload(item.screenshot, "image/jpeg"));
      const voice = item.voice && existsSync(item.voice) ? await this.backend.upload(item.voice, "audio/ogg") : null;
      await this.backend.mutation("device.createHelpRequest", {
        screenshots,
        context: item.context,
        kinds: voice ? item.kinds : item.kinds.filter((k) => k !== "voice"),
        askedAt: item.askedAt,
        ...(item.text ? { text: item.text } : {}),
        ...(item.note ? { note: item.note } : {}),
        ...(voice ? { voice, ...(item.voiceSeconds !== null ? { voiceSeconds: item.voiceSeconds } : {}) } : {}),
      });
      this.outbox.done(item);
    } finally {
      this.sending.delete(item.id);
    }
  }

  // Sends whatever waits in the outbox. When a request that had to wait gets
  // through, she's told.
  async drain(): Promise<number> {
    if (this.offline()) return 0;
    let sent = 0;
    for (const item of this.outbox.due()) {
      if (this.sending.has(item.id)) continue;
      try {
        await withTimeout(this.deliver(item), HELP_TIMEOUT_MS, "help request");
        sent++;
        log("help", `sent a request from ${Math.round((Date.now() - item.askedAt) / 60_000)} min ago`);
      } catch (e) {
        log("help", "outbox send failed:", e);
        this.outbox.failed(item, e instanceof Error ? e.message : String(e));
        if (this.offline()) break;
      }
    }
    this.queued();
    if (sent > 0) {
      this.core.dispatch({ type: "help", status: "sent" });
      showBanner(this.core, "info", `${this.core.helperName()} has your message now.`, 120);
    }
    return sent;
  }

  // Supervised. Checks the outbox every few seconds, and at once when the
  // internet comes back.
  async runOutbox(): Promise<void> {
    let wasOnline = this.core.model.online;
    this.outbox.trim();
    await every(OUTBOX_EVERY_MS, async () => {
      const online = this.core.model.online;
      if (online === true && wasOnline !== true) this.outbox.retryNow();
      wasOnline = online;
      if (this.outbox.count() > 0) await this.drain();
    });
  }
}
