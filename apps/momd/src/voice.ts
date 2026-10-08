import { existsSync, mkdirSync, statSync, unlinkSync } from "node:fs";
import { runtimeDir, VOICE_MAX_BYTES, VOICE_MAX_SECONDS } from "@momos/shared";
import { log } from "./core";

// "Say it out loud" in the Help pop-up. pw-record takes the default
// microphone through PipeWire into a WAV file, and ffmpeg turns it into Ogg
// Opus, which Telegram shows as a voice note. A recording stops by itself
// after VOICE_MAX_SECONDS. Nothing leaves the laptop until she sends it.

export const SAMPLE_RATE = 48_000;

export interface Proc {
  exited: Promise<number>;
  kill(signal?: NodeJS.Signals | number): void;
}

export interface VoiceDeps {
  // Start recording into `wav`. Defaults to pw-record.
  record?: (wav: string) => Proc;
  // Turn `wav` into Ogg Opus at `ogg`. Defaults to ffmpeg.
  encode?: (wav: string, ogg: string) => Promise<void>;
  dir?: () => string;
  now?: () => number;
  maxMs?: number;
}

export interface VoiceNote {
  file: string;
  seconds: number;
}

function pwRecord(wav: string): Proc {
  // The .wav name picks the container. Mono is plenty for a voice.
  return Bun.spawn(["pw-record", "--rate", String(SAMPLE_RATE), "--channels", "1", "--format", "s16", wav], {
    stdin: "ignore",
    stdout: "ignore",
    stderr: "pipe",
  });
}

async function ffmpegOpus(wav: string, ogg: string): Promise<void> {
  const p = Bun.spawn(
    ["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-i", wav, "-ac", "1", "-c:a", "libopus", "-b:a", "32k", "-application", "voip", ogg],
    { stdin: "ignore", stdout: "ignore", stderr: "pipe" },
  );
  const timer = setTimeout(() => p.kill("SIGKILL"), 30_000);
  const [code, err] = await Promise.all([p.exited, new Response(p.stderr).text()]);
  clearTimeout(timer);
  if (code !== 0) throw new Error(`ffmpeg exited ${code}: ${err.trim().split("\n").slice(-2).join(" ")}`);
}

// Seconds of 16-bit mono audio in a WAV file, from its size. The 44-byte
// header is close enough for a length Telegram shows in whole seconds.
export function wavSeconds(bytes: number, rate = SAMPLE_RATE): number {
  return Math.max(0, Math.round((bytes - 44) / (rate * 2)));
}

const remove = (f: string) => {
  try {
    unlinkSync(f);
  } catch {
    // gone already
  }
};

export class VoiceRecorder {
  private current: { proc: Proc; wav: string; startedAt: number; timer: ReturnType<typeof setTimeout> } | null = null;
  private stopping: Promise<VoiceNote | null> | null = null;
  // The last finished note, waiting to be sent or thrown away.
  private ready: VoiceNote | null = null;
  private readonly record: (wav: string) => Proc;
  private readonly encode: (wav: string, ogg: string) => Promise<void>;
  private readonly dir: () => string;
  private readonly now: () => number;
  readonly maxMs: number;

  constructor(deps: VoiceDeps = {}) {
    this.record = deps.record ?? pwRecord;
    this.encode = deps.encode ?? ffmpegOpus;
    this.dir = deps.dir ?? (() => `${runtimeDir()}/help`);
    this.now = deps.now ?? Date.now;
    this.maxMs = deps.maxMs ?? VOICE_MAX_SECONDS * 1000;
  }

  recording(): boolean {
    return this.current !== null;
  }

  // Starts a new recording, throwing away any note she didn't send. A second
  // start while recording answers with the running one.
  start(): { startedAt: number; maxSeconds: number } {
    if (this.current) return { startedAt: this.current.startedAt, maxSeconds: this.maxMs / 1000 };
    this.discard();
    const dir = this.dir();
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const startedAt = this.now();
    const wav = `${dir}/voice-${startedAt}.wav`;
    const proc = this.record(wav);
    const timer = setTimeout(() => {
      log("voice", `stopping at ${this.maxMs / 1000} seconds`);
      void this.stop();
    }, this.maxMs);
    this.current = { proc, wav, startedAt, timer };
    // pw-record dying early (no microphone, say) ends the recording.
    void proc.exited.then((code) => {
      if (this.current?.proc === proc && !this.stopping) {
        log("voice", `pw-record exited ${code} on its own`);
        void this.stop();
      }
    });
    log("voice", "recording");
    return { startedAt, maxSeconds: this.maxMs / 1000 };
  }

  // Stops and encodes. Resolves with the note, or null when there's nothing
  // usable.
  stop(): Promise<VoiceNote | null> {
    if (this.stopping) return this.stopping;
    const cur = this.current;
    if (!cur) return Promise.resolve(this.ready);
    this.stopping = (async () => {
      clearTimeout(cur.timer);
      // SIGINT lets pw-record finish the WAV header.
      cur.proc.kill("SIGINT");
      const killer = setTimeout(() => cur.proc.kill("SIGKILL"), 3000);
      await cur.proc.exited.catch(() => -1);
      clearTimeout(killer);
      this.current = null;
      try {
        if (!existsSync(cur.wav)) throw new Error("pw-record wrote nothing");
        const seconds = wavSeconds(statSync(cur.wav).size);
        if (seconds < 1) throw new Error("the recording is shorter than a second");
        const ogg = cur.wav.replace(/\.wav$/, ".ogg");
        await this.encode(cur.wav, ogg);
        if (!existsSync(ogg) || statSync(ogg).size === 0) throw new Error("ffmpeg wrote nothing");
        if (statSync(ogg).size > VOICE_MAX_BYTES) {
          remove(ogg);
          throw new Error("the voice note is too big");
        }
        this.ready = { file: ogg, seconds: Math.min(seconds, Math.ceil(this.maxMs / 1000)) };
        log("voice", `recorded ${this.ready.seconds} s`);
        return this.ready;
      } catch (e) {
        log("voice", "no voice note:", e);
        return null;
      } finally {
        remove(cur.wav);
      }
    })().finally(() => {
      this.stopping = null;
    });
    return this.stopping;
  }

  // Stops if needed, and hands over the note. The caller owns the file.
  async take(): Promise<VoiceNote | null> {
    const note = await this.stop();
    this.ready = null;
    return note;
  }

  // Stops and throws the recording away.
  async cancel(): Promise<void> {
    if (this.current || this.stopping) await this.stop();
    this.discard();
  }

  private discard(): void {
    if (this.ready) remove(this.ready.file);
    this.ready = null;
  }
}
