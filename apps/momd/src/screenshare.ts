import { randomBytes, timingSafeEqual } from "node:crypto";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import type { Server, ServerWebSocket, Socket } from "bun";
import {
  runtimeDir,
  SCREEN_SHARE_DEFAULT_MINUTES,
  SCREEN_SHARE_MAX_AGE_MS,
  SCREEN_SHARE_MAX_MINUTES,
  SCREEN_SHARE_PORT,
  SCREEN_SHARE_PROTOCOL_PREFIX,
  type ScreenShareSession,
} from "@momos/shared";
import { sessionEnv } from "@momos/momctl/env";
import { run, which } from "@momos/momctl/run";
import { wakeForScreenshot } from "@momos/momctl/screen";
import { type Core, log, sleep } from "./core";

// Screen sharing to the admin app in a browser (docs/contracts.md, "Screen
// sharing in a browser").
//
// Nothing listens until the helper starts a session from the admin app with
// the screen-share action. Then momd:
//
// - starts a second wayvnc, apart from the one on port 5900, on a Unix socket
//   in a directory only her user can open, with no VNC password, and with
//   input turned off (-d) unless the session allows control. So view-only is
//   wayvnc's doing on the laptop, not the browser's;
// - listens on 127.0.0.1:5901 for WebSockets. Tailscale Serve, set up once by
//   `install.sh web-screen`, passes https://<laptop>.ts.net/ on the tailnet
//   through to it. momd takes a connection only with the session's random
//   token as a WebSocket subprotocol and Tailscale's user header, then copies
//   bytes between it and wayvnc;
// - closes all of it when the time is up, when the helper stops it, or when
//   momd stops.
//
// The viewer banner follows the WebSocket connections momd holds.

// At most this many browsers at once (say his phone and his computer).
export const MAX_VIEWERS = 2;
// Browsers wait this long for wayvnc's socket after it starts.
const SOCKET_WAIT_MS = 5000;
// wayvnc that exits by itself during a session is started again, this many
// times, then the session ends.
const MAX_RESPAWNS = 3;
const FPS = 15;

export interface VncProcess {
  exited: Promise<number>;
  kill(): void;
}

export interface ScreenShareDeps {
  // Start wayvnc listening on the Unix socket `socket`, with its control
  // socket at `ctl` and input off when viewOnly.
  spawnVnc(opts: { socket: string; ctl: string; config: string; viewOnly: boolean }): VncProcess;
  // The laptop's MagicDNS name, like "laptop.tailnet.ts.net", or null.
  dnsName(): Promise<string | null>;
  // Whether Tailscale Serve passes https://<dnsName>/ to our port.
  served(dnsName: string): Promise<boolean>;
  // Turn a dark screen on, so there's something to see. Never with the lid
  // closed.
  wake(lidClosed: boolean): Promise<void>;
  now(): number;
  port: number;
  dir: string;
  // Refuse connections without Tailscale Serve's user header. Only tests turn
  // it off.
  requireTailnetUser: boolean;
}

interface Session {
  token: string;
  control: boolean;
  startedAt: number;
  expiresAt: number;
  url: string;
  served: boolean;
  vnc: VncProcess | null;
  respawns: number;
  timer: ReturnType<typeof setTimeout> | null;
  server: Server<ConnData>;
}

interface ConnData {
  id: number;
  login: string;
  vnc: Socket<unknown> | null;
  // Bytes from the browser before wayvnc's socket was open, or while it
  // couldn't take more.
  pending: Uint8Array[];
  closed: boolean;
}

// The session token from a Sec-WebSocket-Protocol header, if it offers
// "binary" too (noVNC's framing).
export function tokenFromProtocols(header: string | null): string | null {
  if (!header) return null;
  const offered = header.split(",").map((p) => p.trim());
  if (!offered.includes("binary")) return null;
  const mine = offered.find((p) => p.startsWith(SCREEN_SHARE_PROTOCOL_PREFIX));
  return mine ? mine.slice(SCREEN_SHARE_PROTOCOL_PREFIX.length) : null;
}

export function tokenMatches(given: string | null, expected: string): boolean {
  if (!given || given.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(given), Buffer.from(expected));
}

// Whether `tailscale serve status --json` shows port 443 on this name passed
// to 127.0.0.1:<port>.
export function servedFrom(status: unknown, dnsName: string, port: number): boolean {
  if (!status || typeof status !== "object") return false;
  const web = (status as { Web?: Record<string, { Handlers?: Record<string, { Proxy?: string }> }> }).Web ?? {};
  const site = web[`${dnsName}:443`];
  const proxy = site?.Handlers?.["/"]?.Proxy ?? "";
  return new RegExp(`^(http://)?(127\\.0\\.0\\.1|localhost):${port}/?$`).test(proxy);
}

export function clampMinutes(minutes: number | undefined): number {
  const m = Math.round(minutes ?? SCREEN_SHARE_DEFAULT_MINUTES);
  return Math.max(1, Math.min(SCREEN_SHARE_MAX_MINUTES, m));
}

export function describeSession(s: { control: boolean; expiresAt: number }, now: number): string {
  const mins = Math.max(1, Math.round((s.expiresAt - now) / 60_000));
  return `${s.control ? "with control" : "view only"}, for ${mins} minute${mins === 1 ? "" : "s"}`;
}

export class ScreenShare {
  private session: Session | null = null;
  private conns = new Set<ServerWebSocket<ConnData>>();
  private nextId = 1;
  // Serializes start and stop.
  private busy: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly core: Core,
    private readonly deps: ScreenShareDeps = systemDeps(),
  ) {}

  // What momd reports to Convex: the running session, or null.
  current(): ScreenShareSession | null {
    const s = this.session;
    if (!s) return null;
    return { url: s.url, token: s.token, control: s.control, startedAt: s.startedAt, expiresAt: s.expiresAt, served: s.served };
  }

  viewers(): number {
    return this.conns.size;
  }

  // The port it listens on while a session runs (tests ask for port 0).
  listeningPort(): number | null {
    return this.session?.server.port ?? null;
  }

  // The screen-share action. createdAt is when it was queued in Convex.
  start(opts: { control?: boolean; minutes?: number; createdAt?: number | null }): Promise<{ ok: boolean; result?: string }> {
    return this.serial(() => this.doStart(opts));
  }

  stop(why: string): Promise<void> {
    return this.serial(async () => this.doStop(why));
  }

  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const p = this.busy.then(fn, fn);
    this.busy = p.catch(() => undefined);
    return p;
  }

  private async doStart(opts: { control?: boolean; minutes?: number; createdAt?: number | null }): Promise<{ ok: boolean; result?: string }> {
    const now = this.deps.now();
    if (opts.createdAt != null && now - opts.createdAt > SCREEN_SHARE_MAX_AGE_MS) {
      return { ok: false, result: "refused: it was sent more than 2 minutes ago" };
    }
    const control = opts.control === true;
    const expiresAt = now + clampMinutes(opts.minutes) * 60_000;

    const s = this.session;
    if (s) {
      // Already running: new end time, and restart wayvnc if control changed.
      s.expiresAt = expiresAt;
      this.arm(s);
      if (s.control !== control) {
        s.control = control;
        await this.restartVnc(s);
        log("screen-share", control ? "control on" : "view only");
      }
      return { ok: true, result: describeSession(s, now) };
    }

    const dns = await this.deps.dnsName();
    if (!dns) return { ok: false, result: "Tailscale isn't up, so no browser can reach the laptop" };
    const served = await this.deps.served(dns).catch(() => false);

    rmSync(this.deps.dir, { recursive: true, force: true });
    mkdirSync(this.deps.dir, { recursive: true, mode: 0o700 });
    // No password: only her own processes can open the socket, and momd
    // checks the browser's token before it connects.
    writeFileSync(`${this.deps.dir}/wayvnc.conf`, "", { mode: 0o600 });

    let server: Server<ConnData>;
    try {
      server = this.listen();
    } catch (e) {
      rmSync(this.deps.dir, { recursive: true, force: true });
      return { ok: false, result: `couldn't listen on 127.0.0.1:${this.deps.port}: ${(e as Error).message}` };
    }
    const session: Session = {
      token: randomBytes(32).toString("hex"),
      control,
      startedAt: now,
      expiresAt,
      url: `wss://${dns}/`,
      served,
      vnc: null,
      respawns: 0,
      timer: null,
      server,
    };
    this.session = session;
    try {
      await this.startVnc(session);
    } catch (e) {
      this.doStop("wayvnc didn't start");
      return { ok: false, result: `wayvnc didn't start: ${(e as Error).message}` };
    }
    this.arm(session);
    await this.deps.wake(this.core.model.lidClosed).catch(() => undefined);
    log("screen-share", `started, ${describeSession(session, now)}${served ? "" : "; tailscale serve isn't set up"}`);
    return { ok: true, result: describeSession(session, now) + (served ? "" : ". Tailscale Serve isn't set up on the laptop yet: run install.sh web-screen.") };
  }

  private doStop(why: string): void {
    const s = this.session;
    if (!s) return;
    this.session = null;
    if (s.timer) clearTimeout(s.timer);
    for (const ws of this.conns) this.closeConn(ws, 1000, "screen sharing ended");
    this.conns.clear();
    this.viewerChanged();
    s.server.stop(true);
    s.vnc?.kill();
    s.vnc = null;
    rmSync(this.deps.dir, { recursive: true, force: true });
    log("screen-share", `stopped: ${why}`);
  }

  private arm(s: Session): void {
    if (s.timer) clearTimeout(s.timer);
    s.timer = setTimeout(() => void this.stop("time is up"), Math.max(0, s.expiresAt - this.deps.now()));
  }

  private get paths() {
    return { socket: `${this.deps.dir}/vnc.sock`, ctl: `${this.deps.dir}/wayvncctl.sock`, config: `${this.deps.dir}/wayvnc.conf` };
  }

  private async startVnc(s: Session): Promise<void> {
    const p = this.paths;
    rmSync(p.socket, { force: true });
    const proc = this.deps.spawnVnc({ ...p, viewOnly: !s.control });
    s.vnc = proc;
    void proc.exited.then((code) => {
      if (this.session !== s || s.vnc !== proc) return; // stopped or replaced on purpose
      s.vnc = null;
      if (s.respawns >= MAX_RESPAWNS) {
        void this.stop(`wayvnc keeps exiting (${code})`);
        return;
      }
      s.respawns++;
      log("screen-share", `wayvnc exited (${code}); starting it again`);
      void this.serial(async () => {
        if (this.session === s && !s.vnc) await this.startVnc(s).catch((e) => this.doStop(`wayvnc didn't restart: ${(e as Error).message}`));
      });
    });
    const until = Date.now() + SOCKET_WAIT_MS;
    while (!existsSync(p.socket)) {
      if (Date.now() > until) {
        proc.kill();
        s.vnc = null;
        throw new Error("its socket didn't appear");
      }
      await sleep(50);
    }
  }

  // Control changed: wayvnc starts again with or without -d. Browsers lose
  // their connection and reconnect by themselves.
  private async restartVnc(s: Session): Promise<void> {
    const old = s.vnc;
    s.vnc = null;
    for (const ws of this.conns) this.closeConn(ws, 4001, "control changed");
    this.conns.clear();
    this.viewerChanged();
    if (old) {
      old.kill();
      await Promise.race([old.exited, sleep(3000)]);
    }
    await this.startVnc(s);
  }

  private viewerChanged(): void {
    const s = this.session;
    this.core.dispatch({ type: "viewer", via: "web", connected: this.conns.size > 0, control: !!s && s.control });
  }

  private closeConn(ws: ServerWebSocket<ConnData>, code: number, reason: string): void {
    ws.data.closed = true;
    try {
      ws.data.vnc?.end();
    } catch {
      // already closed
    }
    try {
      ws.close(code, reason);
    } catch {
      // already closed
    }
  }

  private listen(): Server<ConnData> {
    const self = this;
    return Bun.serve<ConnData>({
      hostname: "127.0.0.1",
      port: this.deps.port,
      fetch(req, server) {
        const s = self.session;
        const url = new URL(req.url);
        if (!s) return new Response("Screen sharing is off.\n", { status: 404 });
        if (req.headers.get("upgrade")?.toLowerCase() !== "websocket") {
          // A plain visit, to check the laptop is reachable from a device.
          // Says nothing a tailnet device couldn't see anyway.
          if (url.pathname === "/ping") {
            return new Response("ok\n", { headers: { "Access-Control-Allow-Origin": "*", "Cache-Control": "no-store" } });
          }
          return new Response("MomOS screen sharing. Open it from the admin app.\n", { status: 200 });
        }
        const login = req.headers.get("tailscale-user-login") ?? "";
        if (self.deps.requireTailnetUser && !login) return new Response("Forbidden\n", { status: 403 });
        if (!tokenMatches(tokenFromProtocols(req.headers.get("sec-websocket-protocol")), s.token)) {
          log("screen-share", `refused a connection with a wrong or missing token${login ? ` from ${login}` : ""}`);
          return new Response("Unauthorized\n", { status: 401 });
        }
        if (self.conns.size >= MAX_VIEWERS) return new Response("Too many viewers\n", { status: 429 });
        if (!s.vnc) return new Response("Starting, try again\n", { status: 503 });
        const ok = server.upgrade(req, {
          headers: { "Sec-WebSocket-Protocol": "binary" },
          data: { id: self.nextId++, login, vnc: null, pending: [], closed: false },
        });
        return ok ? undefined : new Response("Upgrade failed\n", { status: 400 });
      },
      websocket: {
        maxPayloadLength: 1 << 20,
        open(ws) {
          self.conns.add(ws);
          self.viewerChanged();
          log("screen-share", `viewer connected${ws.data.login ? `: ${ws.data.login}` : ""}`);
          void Bun.connect<unknown>({
            unix: self.paths.socket,
            socket: {
              open(sock) {
                if (ws.data.closed) {
                  sock.end();
                  return;
                }
                ws.data.vnc = sock;
                flush(ws.data);
              },
              data(_sock, chunk) {
                if (!ws.data.closed) ws.send(chunk);
              },
              drain() {
                flush(ws.data);
              },
              close() {
                if (!ws.data.closed) self.closeConn(ws, 4000, "wayvnc closed the connection");
              },
              error(_sock, err) {
                log("screen-share", "wayvnc socket error:", err);
              },
            },
          }).catch((e: unknown) => {
            log("screen-share", "can't reach wayvnc:", e);
            self.closeConn(ws, 1011, "wayvnc isn't answering");
          });
        },
        message(ws, msg) {
          if (typeof msg === "string") return; // RFB is binary only
          ws.data.pending.push(new Uint8Array(msg));
          flush(ws.data);
        },
        close(ws) {
          ws.data.closed = true;
          try {
            ws.data.vnc?.end();
          } catch {
            // already closed
          }
          if (self.conns.delete(ws)) {
            self.viewerChanged();
            log("screen-share", "viewer left");
          }
        },
      },
    });
  }
}

// Write what the browser sent to wayvnc, keeping what the socket can't take
// yet for its drain event.
function flush(c: ConnData): void {
  const sock = c.vnc;
  if (!sock) return;
  while (c.pending.length) {
    const chunk = c.pending[0]!;
    const n = sock.write(chunk);
    if (n >= chunk.length) {
      c.pending.shift();
    } else {
      if (n > 0) c.pending[0] = chunk.subarray(n);
      return;
    }
  }
}

function systemSpawn(opts: { socket: string; ctl: string; config: string; viewOnly: boolean }): VncProcess {
  const bin = which("wayvnc");
  if (!bin) throw new Error("wayvnc isn't installed");
  const argv = [
    bin,
    `--config=${opts.config}`,
    "--render-cursor",
    `--max-fps=${FPS}`,
    `--socket=${opts.ctl}`,
    "--unix-socket",
    ...(opts.viewOnly ? ["--disable-input"] : []),
    opts.socket,
  ];
  const proc = Bun.spawn(argv, { env: sessionEnv(), stdin: "ignore", stdout: "ignore", stderr: "inherit" });
  return { exited: proc.exited, kill: () => proc.kill() };
}

async function tailscaleJson(args: string[]): Promise<unknown> {
  const r = await run(["tailscale", ...args], { timeoutMs: 10_000 });
  if (r.code !== 0) return null;
  try {
    return JSON.parse(r.stdout);
  } catch {
    return null;
  }
}

export function systemDeps(): ScreenShareDeps {
  return {
    spawnVnc: systemSpawn,
    async dnsName() {
      const status = (await tailscaleJson(["status", "--json"]).catch(() => null)) as { Self?: { DNSName?: string } } | null;
      const name = status?.Self?.DNSName?.replace(/\.$/, "") ?? "";
      return /^[A-Za-z0-9.-]+$/.test(name) ? name : null;
    },
    async served(dnsName) {
      return servedFrom(await tailscaleJson(["serve", "status", "--json"]), dnsName, SCREEN_SHARE_PORT);
    },
    async wake(lidClosed) {
      // Throws with the lid closed, and leaves the screen off.
      await wakeForScreenshot(lidClosed).catch(() => undefined);
    },
    now: () => Date.now(),
    port: SCREEN_SHARE_PORT,
    dir: `${runtimeDir()}/screen`,
    requireTailnetUser: true,
  };
}
