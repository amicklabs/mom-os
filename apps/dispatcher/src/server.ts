import { chmodSync, existsSync, unlinkSync } from "node:fs";
import { createConnection, createServer, type Server } from "node:net";
import { log } from "./log";

// JSON lines over a Unix socket, the same shape momd uses: a request is
// {"cmd": "...", "args": {...}}, a response is {"ok": true, "data": ...} or
// {"ok": false, "error": "..."}. A connection may carry several requests;
// responses come back in order and echo the request's "id" if it had one.

export type Handler = (args: Record<string, unknown>) => Promise<unknown> | unknown;

export async function handleLine(line: string, handlers: Record<string, Handler>): Promise<Record<string, unknown>> {
  let req: { cmd?: unknown; args?: unknown; id?: unknown };
  try {
    req = JSON.parse(line);
  } catch {
    return { ok: false, error: "Request is not JSON." };
  }
  const id = req && (typeof req.id === "string" || typeof req.id === "number") ? { id: req.id } : {};
  if (!req || typeof req.cmd !== "string") return { ok: false, error: "Request needs a cmd.", ...id };
  const handler = Object.hasOwn(handlers, req.cmd) ? handlers[req.cmd] : undefined;
  if (!handler) return { ok: false, error: `Unknown command "${req.cmd}". Known: ${Object.keys(handlers).join(", ")}.`, ...id };
  const args = req.args && typeof req.args === "object" && !Array.isArray(req.args) ? (req.args as Record<string, unknown>) : {};
  try {
    return { ok: true, data: (await handler(args)) ?? null, ...id };
  } catch (e) {
    return { ok: false, error: (e as Error).message, ...id };
  }
}

// Remove a leftover socket, but refuse if another dispatcher is answering.
async function clearStale(path: string): Promise<void> {
  if (!existsSync(path)) return;
  const alive = await new Promise<boolean>((resolve) => {
    const c = createConnection(path);
    c.once("connect", () => {
      c.destroy();
      resolve(true);
    });
    c.once("error", () => resolve(false));
  });
  if (alive) throw new Error(`Another dispatcher is already listening on ${path}.`);
  unlinkSync(path);
}

export async function serve(path: string, handlers: Record<string, Handler>): Promise<Server> {
  await clearStale(path);
  const server = createServer((sock) => {
    sock.setEncoding("utf8");
    let buf = "";
    let chain = Promise.resolve();
    sock.on("data", (chunk: string) => {
      buf += chunk;
      if (buf.length > 1_000_000) {
        sock.destroy();
        return;
      }
      let nl: number;
      while ((nl = buf.indexOf("\n")) !== -1) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line) continue;
        chain = chain.then(async () => {
          const res = await handleLine(line, handlers);
          if (!sock.destroyed) sock.write(JSON.stringify(res) + "\n");
        });
      }
    });
    sock.on("error", (e) => log.debug(`socket client: ${e.message}`));
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(path, () => resolve());
  });
  chmodSync(path, 0o600);
  log.info(`listening on ${path}`);
  return server;
}
