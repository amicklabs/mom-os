import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { ConvexClient } from "convex/browser";
import { makeFunctionReference } from "convex/server";
import { z } from "zod";
import { type Action, DeviceContent, paths, type ScreenShareSession, Settings } from "@momos/shared";
import { type Core, log, sleep } from "./core";
import { writeAtomic } from "./files";
import { heartbeatKey } from "./model";
import { validatePending } from "./actions";
import { SlideshowSync } from "./slideshow";

// Everything that talks to Convex. Runs only when config.local.convexUrl and a
// device token exist; otherwise the state says "disabled" and the rest of momd
// carries on. Functions are called by name (see docs/contracts.md), since the
// backend is built separately.

const HEARTBEAT_MS = 60_000;
const HEARTBEAT_MIN_GAP_MS = 5000;
const UPLOAD_BATCH = 100;
const CALL_TIMEOUT_MS = 30_000;

// createdAt is when the action was queued in Convex, if known.
export type RunAction = (
  id: string,
  action: Action,
  info: { createdAt: number | null },
) => Promise<{ ok: boolean; result?: string }>;

export interface Backend {
  // True when the WebSocket is up and calls should go through.
  ready(): boolean;
  mutation<T = unknown>(name: string, args: Record<string, unknown>): Promise<T>;
  // Upload a file to Convex storage, returning its storage id.
  upload(path: string, contentType: string): Promise<string>;
}

// Family photos from device.settings. fileName is what FamilyMember.photo
// refers to; the same pattern keeps it inside the photos directory.
const Photos = z.array(
  z.object({ id: z.string(), fileName: z.string().regex(/^[A-Za-z0-9._-]+\.(jpg|jpeg|png|webp)$/), url: z.url() }),
);

function withTimeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${what} timed out`)), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

function readToken(file: string): string | null {
  try {
    const t = readFileSync(file, "utf8").trim();
    return t || null;
  } catch {
    return null;
  }
}

// "device.heartbeat" -> the function "heartbeat" in convex/device.ts.
type Args = Record<string, unknown>;
const mutationRef = (name: string) => makeFunctionReference<"mutation", Args, unknown>(name.replace(".", ":"));
const queryRef = (name: string) => makeFunctionReference<"query", Args, unknown>(name.replace(".", ":"));

export class ConvexSync implements Backend {
  private client: ConvexClient | null = null;
  private token: string | null = null;
  private done = new Set<string>();
  private running = new Set<string>();
  private unacked = new Map<string, { ok: boolean; result?: string }>();
  private lastHeartbeat = 0;
  private lastKey = "";
  private uploadWanted = true;
  // The screen-sharing session last reported, as JSON; null to report again.
  private shareSent: string | null = null;
  private shareRetryAt = 0;

  constructor(
    private readonly core: Core,
    private readonly runAction: RunAction,
    private readonly slideshow = new SlideshowSync(),
    // The browser screen-sharing session, reported whenever it changes and
    // on every connect.
    private readonly screenShare: () => ScreenShareSession | null = () => null,
  ) {}

  ready(): boolean {
    return !!this.client && !!this.token && this.client.connectionState().isWebSocketConnected;
  }

  async mutation<T = unknown>(name: string, args: Record<string, unknown>): Promise<T> {
    if (!this.client || !this.token) throw new Error("Convex is not set up");
    return withTimeout(this.client.mutation(mutationRef(name), { deviceToken: this.token, ...args }) as Promise<T>, CALL_TIMEOUT_MS, name);
  }

  async upload(path: string, contentType: string): Promise<string> {
    const url = await this.mutation<string>("device.generateUploadUrl", {});
    const res = await fetch(url, { method: "POST", headers: { "Content-Type": contentType }, body: Bun.file(path), signal: AbortSignal.timeout(60_000) });
    if (!res.ok) throw new Error(`upload failed: HTTP ${res.status}`);
    const { storageId } = (await res.json()) as { storageId?: string };
    if (!storageId) throw new Error("upload returned no storageId");
    return storageId;
  }

  // Supervised. Returns (to be restarted) when the config changes.
  async run(): Promise<void> {
    const cfg = this.core.config();
    const url = cfg?.local?.convexUrl ?? null;
    const tokenFile = cfg?.local?.deviceTokenFile ?? paths.deviceToken();
    const token = readToken(tokenFile);
    if (!url || !token) {
      this.core.dispatch({ type: "convex", convex: "disabled" });
      // Look again in a minute, in case setup has finished since.
      await sleep(60_000);
      return;
    }

    this.core.dispatch({ type: "convex", convex: "connecting" });
    this.token = token;
    this.shareSent = null;
    const client = new ConvexClient(url, {
      unsavedChangesWarning: false,
      skipConvexDeploymentUrlCheck: true,
      logger: { log: () => {}, logVerbose: () => {}, warn: (...a: unknown[]) => log("convex", ...a), error: (...a: unknown[]) => log("convex", ...a) },
    });
    this.client = client;
    let subError: Error | null = null;
    const onError = (e: Error) => {
      subError = e;
      log("convex", "subscription error:", e);
      this.core.error("convex", e);
      this.core.dispatch({ type: "convex", convex: "error" });
    };

    const unsubs = [
      client.onUpdate(queryRef("device.settings"), { deviceToken: token }, (v: unknown) => void this.applySettings(v), onError),
      client.onUpdate(queryRef("device.pendingActions"), { deviceToken: token }, (v: unknown) => void this.handleActions(v), onError),
      // Reminders and slideshow. An error here (say, a backend without
      // device.content yet) is logged but doesn't stop the rest.
      client.onUpdate(
        queryRef("device.content"),
        { deviceToken: token },
        (v: unknown) => void this.applyContent(v),
        (e: Error) => {
          log("convex", "content subscription error:", e);
          this.core.error("content", e);
        },
      ),
    ];
    const offEvent = this.core.onEvent(() => (this.uploadWanted = true));

    try {
      for (;;) {
        await sleep(2000);
        const conn = client.connectionState();
        if (!subError) this.core.dispatch({ type: "convex", convex: conn.isWebSocketConnected ? "connected" : "connecting" });
        if (conn.isWebSocketConnected) {
          await this.maybeHeartbeat();
          await this.reportScreenShare();
          await this.uploadEvents();
          await this.retryCompletions();
        }
        // Restart with fresh settings if the local block changed.
        const now = this.core.config();
        if ((now?.local?.convexUrl ?? null) !== url || readToken(now?.local?.deviceTokenFile ?? paths.deviceToken()) !== token) {
          log("convex", "local config changed; reconnecting");
          return;
        }
        if (subError) throw subError;
      }
    } finally {
      offEvent();
      for (const u of unsubs) u();
      this.client = null;
      await client.close().catch(() => undefined);
    }
  }

  private async maybeHeartbeat(): Promise<void> {
    const now = Date.now();
    const key = heartbeatKey(this.core.model);
    const due = now - this.lastHeartbeat >= HEARTBEAT_MS || (key !== this.lastKey && now - this.lastHeartbeat >= HEARTBEAT_MIN_GAP_MS);
    if (!due) return;
    try {
      await this.mutation("device.heartbeat", { status: this.core.status() });
      this.lastHeartbeat = now;
      this.lastKey = key;
    } catch (e) {
      log("convex", "heartbeat failed:", e);
      this.lastHeartbeat = now - HEARTBEAT_MS + 15_000; // try again in 15 s
    }
  }

  // Tell Convex about the browser screen-sharing session when it changed.
  // After a failure it tries again in 10 seconds.
  async reportScreenShare(now = Date.now()): Promise<void> {
    const session = this.screenShare();
    const json = JSON.stringify(session);
    if (json === this.shareSent || now < this.shareRetryAt) return;
    try {
      await this.mutation("device.reportScreenShare", { session });
      this.shareSent = json;
    } catch (e) {
      log("convex", "screen-share report failed:", e);
      this.shareRetryAt = now + 10_000;
    }
  }

  private async uploadEvents(): Promise<void> {
    if (!this.uploadWanted) return;
    for (;;) {
      const batch = this.core.queue.peek(UPLOAD_BATCH);
      if (!batch.length) {
        this.uploadWanted = false;
        return;
      }
      try {
        await this.mutation("device.ingestEvents", { events: batch });
      } catch (e) {
        log("convex", "event upload failed:", e);
        return; // keep them; try again next round
      }
      this.core.queue.ack(batch.map((e) => e.id));
    }
  }

  private async applySettings(value: unknown): Promise<void> {
    try {
      // null: nothing saved in Convex yet, so keep the local file.
      if (value === null) return;
      const parsed = Settings.safeParse(value);
      if (!parsed.success) {
        const issue = parsed.error.issues[0];
        throw new Error(`settings from Convex are invalid at ${issue?.path.join(".")}: ${issue?.message}`);
      }
      const current = (() => {
        try {
          return JSON.parse(readFileSync(paths.config(), "utf8")) as { local?: unknown };
        } catch {
          return {};
        }
      })();
      const next = { ...parsed.data, ...(current.local !== undefined ? { local: current.local } : {}) };
      const text = JSON.stringify(next, null, 2) + "\n";
      let old = "";
      try {
        old = readFileSync(paths.config(), "utf8");
      } catch {
        // first write
      }
      if (text !== old) {
        writeAtomic(paths.config(), text);
        log("convex", "settings updated");
      }
      const photos = Photos.safeParse((value as { photos?: unknown })?.photos ?? []);
      if (photos.success) await this.syncPhotos(photos.data);
      else log("convex", "ignoring invalid photo list");
    } catch (e) {
      log("convex", e);
      this.core.error("settings", e);
    }
  }

  // reminders.json for Reminders, and the slideshow folder.
  private async applyContent(value: unknown): Promise<void> {
    try {
      const parsed = DeviceContent.safeParse(value);
      if (!parsed.success) {
        const issue = parsed.error.issues[0];
        throw new Error(`content from Convex is invalid at ${issue?.path.join(".")}: ${issue?.message}`);
      }
      const text = JSON.stringify(parsed.data.reminders, null, 2) + "\n";
      let old = "";
      try {
        old = readFileSync(paths.reminders(), "utf8");
      } catch {
        // first write
      }
      if (text !== old) {
        writeAtomic(paths.reminders(), text);
        log("convex", `reminders updated (${parsed.data.reminders.length})`);
      }
      await this.slideshow.sync(parsed.data.slideshow);
    } catch (e) {
      log("convex", e);
      this.core.error("content", e);
    }
  }

  // Download photos whose URL changed. photos/.index.json remembers the URL
  // each file came from.
  private async syncPhotos(list: z.infer<typeof Photos>): Promise<void> {
    const dir = paths.photos();
    mkdirSync(dir, { recursive: true });
    const indexPath = `${dir}/.index.json`;
    let index: Record<string, string> = {};
    try {
      index = JSON.parse(readFileSync(indexPath, "utf8"));
    } catch {
      // none yet
    }
    let changed = false;
    for (const p of list) {
      const file = `${dir}/${p.fileName}`;
      if (index[p.fileName] === p.url && existsSync(file)) continue;
      const res = await fetch(p.url, { signal: AbortSignal.timeout(60_000) });
      if (!res.ok) {
        log("convex", `photo ${p.fileName}: HTTP ${res.status}`);
        continue;
      }
      writeAtomic(file, new Uint8Array(await res.arrayBuffer()));
      index[p.fileName] = p.url;
      changed = true;
    }
    if (changed) writeAtomic(indexPath, JSON.stringify(index));
  }

  private async handleActions(value: unknown): Promise<void> {
    if (!Array.isArray(value)) return;
    for (const item of value) {
      const v = validatePending(item);
      if (!v.id || this.done.has(v.id) || this.running.has(v.id)) continue;
      this.running.add(v.id);
      let outcome: { ok: boolean; result?: string };
      let type = "unknown";
      if (!v.ok) {
        log("actions", v.error);
        outcome = { ok: false, result: v.error };
      } else {
        type = v.action.type;
        try {
          outcome = await this.runAction(v.id, v.action, { createdAt: v.createdAt });
        } catch (e) {
          outcome = { ok: false, result: (e as Error).message.slice(0, 500) };
        }
      }
      this.core.record({ type: "action", actionId: v.id, action: type, ok: outcome.ok });
      this.running.delete(v.id);
      this.done.add(v.id);
      if (this.done.size > 1000) this.done = new Set([...this.done].slice(-500));
      this.unacked.set(v.id, outcome);
      await this.retryCompletions();
    }
  }

  private async retryCompletions(): Promise<void> {
    for (const [id, outcome] of this.unacked) {
      try {
        await this.mutation("device.completeAction", { actionId: id, ok: outcome.ok, ...(outcome.result ? { result: outcome.result } : {}) });
        this.unacked.delete(id);
      } catch (e) {
        log("convex", `completeAction ${id} failed:`, e);
        return;
      }
    }
  }
}

// Used when Convex isn't configured, so callers don't need null checks.
export const noBackend: Backend = {
  ready: () => false,
  mutation: () => Promise.reject(new Error("Convex is not set up")),
  upload: () => Promise.reject(new Error("Convex is not set up")),
};
