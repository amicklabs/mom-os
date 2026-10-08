import type { Socket } from "bun";
import { chmodSync, existsSync, mkdirSync, unlinkSync } from "node:fs";
import { dirname } from "node:path";
import { HelpArgs, paths, Request, type Response } from "@momos/shared";
import { loadConfig } from "@momos/momctl/config";
import { findTile, openTile } from "@momos/momctl/launch";
import { home } from "@momos/momctl/shell";
import { momdRequest } from "@momos/momctl/client";
import { type Core, log, type Supervisor } from "./core";
import type { Help } from "./help";
import type { Reminders } from "./reminders";
import { doLock, reload, say } from "./runner";

// JSON lines over a Unix socket, one request and one response per connection.
// Commands: status, say, help, voice, banner-dismiss, lock-state, home, open,
// reload, lock, reminder-ok, ping.

export type Handler = (cmd: string, args: Record<string, unknown>) => Promise<unknown>;

interface Conn {
  buf: string;
  handled: boolean;
  out: Uint8Array | null;
}

export function makeHandler(core: Core, help: Help, sup: Supervisor, reminders?: Reminders): Handler {
  return async (cmd, args) => {
    switch (cmd) {
      case "ping":
        return { pong: true };
      case "status":
        return {
          state: core.state(),
          status: core.status(),
          health: {
            pid: process.pid,
            version: core.version,
            uptimeSeconds: Math.round((Date.now() - core.startedAt) / 1000),
            queuedEvents: core.queue.count(),
            tasks: Object.fromEntries(sup.tasks),
          },
        };
      case "say": {
        const text = typeof args.text === "string" ? args.text.trim() : "";
        if (!text) throw new Error("say needs text");
        const seconds = typeof args.seconds === "number" && args.seconds > 0 ? args.seconds : null;
        return { banner: say(core, text, seconds) };
      }
      case "help": {
        const parsed = HelpArgs.safeParse(args);
        if (!parsed.success) throw new Error(`help: ${parsed.error.issues[0]?.message ?? "bad arguments"}`);
        return await help.request(parsed.data);
      }
      case "voice":
        // "Say it out loud": start, stop (keep it for help --voice) or cancel.
        switch (args.action) {
          case "start":
            return { recording: true, ...help.voice.start() };
          case "stop": {
            const note = await help.voice.stop();
            return { recording: false, seconds: note?.seconds ?? null };
          }
          case "cancel":
            await help.voice.cancel();
            return { recording: false };
          default:
            throw new Error("voice takes start, stop or cancel");
        }
      case "banner-dismiss":
        core.dispatch({ type: "banner-dismiss", id: typeof args.id === "string" ? args.id : undefined });
        return { banner: core.model.banner };
      case "lock-state":
        if (typeof args.locked !== "boolean") throw new Error("lock-state needs locked: true or false");
        core.dispatch({ type: "lock", source: "shell", locked: args.locked });
        return { locked: args.locked };
      case "home":
        return home();
      case "open": {
        if (typeof args.tileId !== "string") throw new Error("open needs tileId");
        return openTile(findTile(loadConfig(), args.tileId));
      }
      case "reload": {
        // momctl reload: the same as the reload action, without an age limit.
        if (typeof args.tileId !== "string") throw new Error("reload needs tileId");
        const r = await reload(core, args.tileId);
        return r.reload;
      }
      case "lock":
        await doLock(core);
        return { locked: true };
      case "reminder-ok": {
        if (typeof args.key !== "string") throw new Error("reminder-ok needs key");
        if (!reminders) throw new Error("reminders are not running");
        return { answered: reminders.ok(args.key), due: core.model.reminders.due };
      }
      default:
        throw new Error(`unknown command "${cmd}"`);
    }
  };
}

export async function serveSocket(handler: Handler): Promise<void> {
  const path = paths.socket();
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  if (existsSync(path)) {
    // Another momd answering? Then don't steal its socket.
    const alive = await momdRequest("ping", {}, { timeoutMs: 1000, socket: path }).then(
      () => true,
      () => false,
    );
    if (alive) throw new Error(`another momd is already serving ${path}`);
    unlinkSync(path);
  }

  // Write out as much as the socket takes; drain() sends the rest, then ends.
  const flush = (s: Socket<Conn>) => {
    const out = s.data.out;
    if (!out) return;
    const n = s.write(out);
    s.data.out = n < out.length ? out.subarray(Math.max(n, 0)) : null;
    if (!s.data.out) s.end();
  };

  const server = Bun.listen<Conn>({
    unix: path,
    socket: {
      open(s) {
        s.data = { buf: "", handled: false, out: null };
      },
      drain(s) {
        flush(s);
      },
      async data(s, chunk) {
        if (s.data.handled) return;
        s.data.buf += chunk.toString();
        const nl = s.data.buf.indexOf("\n");
        if (nl < 0) {
          if (s.data.buf.length > 64 * 1024) s.end();
          return;
        }
        s.data.handled = true;
        let res: Response;
        try {
          const req = Request.parse(JSON.parse(s.data.buf.slice(0, nl)));
          res = { ok: true, data: (await handler(req.cmd, req.args)) ?? null };
        } catch (e) {
          res = { ok: false, error: e instanceof Error ? e.message : String(e) };
        }
        s.data.out = new TextEncoder().encode(JSON.stringify(res) + "\n");
        flush(s);
      },
      error(_s, err) {
        log("socket", err);
      },
    },
  });
  chmodSync(path, 0o600);
  log("socket", `listening on ${path}`);

  const cleanup = () => {
    server.stop(true);
    try {
      unlinkSync(path);
    } catch {
      // already gone
    }
  };
  process.once("exit", cleanup);
  // Serve until the process ends.
  await new Promise<never>(() => {});
}
