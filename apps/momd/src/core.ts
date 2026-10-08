import { randomUUID } from "node:crypto";
import { statSync } from "node:fs";
import { type ConfigFile, type DeviceEvent, paths } from "@momos/shared";
import { tryLoadConfig } from "@momos/momctl/config";
import { initialModel, reduce, toState, toStatus, type Model, type Msg, type NewEvent } from "./model";
import type { EventQueue } from "./queue";

export const log = (source: string, ...msg: unknown[]) =>
  console.error(`[${source}]`, ...msg.map((m) => (m instanceof Error ? m.message : m)));

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// Holds the model, the event log and the config, and tells listeners when
// anything changes. Every other part of momd goes through here.
export class Core {
  model: Model = initialModel();
  private changeListeners = new Set<() => void>();
  private eventListeners = new Set<() => void>();
  private lastError = new Map<string, number>();
  private cfg: { mtime: number; value: ConfigFile | null } | null = null;
  readonly startedAt = Date.now();

  constructor(
    readonly queue: EventQueue,
    readonly version: string,
  ) {}

  dispatch(msg: Msg): void {
    const r = reduce(this.model, msg, Date.now());
    this.model = r.model;
    for (const e of r.events) this.record(e);
    if (r.changed) for (const fn of this.changeListeners) fn();
  }

  record(e: NewEvent, at = Date.now()): void {
    try {
      this.queue.add({ ...e, id: randomUUID(), at } as DeviceEvent);
    } catch (err) {
      log("queue", "can't store event:", err);
      return;
    }
    for (const fn of this.eventListeners) fn();
  }

  // Log an error event, at most once every 10 minutes per source.
  error(source: string, err: unknown): void {
    const now = Date.now();
    if (now - (this.lastError.get(source) ?? 0) < 10 * 60_000) return;
    this.lastError.set(source, now);
    this.record({ type: "error", source, message: String(err instanceof Error ? err.message : err).slice(0, 2000) });
  }

  onChange(fn: () => void): () => void {
    this.changeListeners.add(fn);
    return () => this.changeListeners.delete(fn);
  }

  onEvent(fn: () => void): () => void {
    this.eventListeners.add(fn);
    return () => this.eventListeners.delete(fn);
  }

  state = () => toState(this.model, Date.now());
  status = () => toStatus(this.model, Date.now(), this.version);

  // config.json, re-read when it changes on disk. Null if missing or invalid.
  config(): ConfigFile | null {
    let mtime = 0;
    try {
      mtime = statSync(paths.config()).mtimeMs;
    } catch {
      mtime = -1;
    }
    if (!this.cfg || this.cfg.mtime !== mtime) this.cfg = { mtime, value: mtime < 0 ? null : tryLoadConfig() };
    return this.cfg.value;
  }

  helperName(): string {
    return this.config()?.helper.name ?? "Your helper";
  }
}

export interface TaskStatus {
  running: boolean;
  restarts: number;
  lastError: string | null;
  lastErrorAt: number | null;
}

// Run a long-lived task forever. If it throws or returns, log it and start it
// again after a delay that doubles up to maxMs, so one broken part never stops
// the others.
export class Supervisor {
  readonly tasks = new Map<string, TaskStatus>();
  private stopped = false;

  constructor(private readonly core: Core) {}

  start(name: string, fn: () => Promise<void>, opts: { minMs?: number; maxMs?: number } = {}): void {
    const minMs = opts.minMs ?? 1000;
    const maxMs = opts.maxMs ?? 60_000;
    const status: TaskStatus = { running: false, restarts: 0, lastError: null, lastErrorAt: null };
    this.tasks.set(name, status);
    void (async () => {
      let delay = minMs;
      while (!this.stopped) {
        const started = Date.now();
        status.running = true;
        try {
          await fn();
        } catch (err) {
          status.lastError = err instanceof Error ? err.message : String(err);
          status.lastErrorAt = Date.now();
          log(name, "failed:", status.lastError);
          this.core.error(name, err);
        }
        status.running = false;
        if (this.stopped) break;
        if (Date.now() - started > 5 * 60_000) delay = minMs;
        status.restarts++;
        await sleep(delay);
        delay = Math.min(delay * 2, maxMs);
      }
    })();
  }

  stop(): void {
    this.stopped = true;
  }
}

// Repeat fn every intervalMs. An error ends the loop so the supervisor backs off.
export async function every(intervalMs: number | (() => number), fn: () => Promise<void> | void): Promise<void> {
  for (;;) {
    await fn();
    await sleep(typeof intervalMs === "function" ? intervalMs() : intervalMs);
  }
}
