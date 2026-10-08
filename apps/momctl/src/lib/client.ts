import { existsSync } from "node:fs";
import { paths, Response } from "@momos/shared";

export class MomdUnavailable extends Error {}

// Send one request to momd and read one JSON-line response.
export async function momdRequest(
  cmd: string,
  args: Record<string, unknown> = {},
  opts: { timeoutMs?: number; socket?: string } = {},
): Promise<Response> {
  const path = opts.socket ?? paths.socket();
  if (!existsSync(path)) throw new MomdUnavailable(`momd is not running (no socket at ${path})`);
  const timeoutMs = opts.timeoutMs ?? 5000;

  return new Promise<Response>((resolve, reject) => {
    let buf = "";
    let done = false;
    const finish = (fn: () => void) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      fn();
    };
    const timer = setTimeout(() => finish(() => reject(new MomdUnavailable(`momd didn't answer within ${timeoutMs} ms`))), timeoutMs);
    Bun.connect({
      unix: path,
      socket: {
        open(s) {
          s.write(JSON.stringify({ cmd, args }) + "\n");
        },
        data(s, chunk) {
          buf += chunk.toString();
          const nl = buf.indexOf("\n");
          if (nl < 0) return;
          const line = buf.slice(0, nl);
          // Settle before end(): end() fires close() synchronously.
          finish(() => {
            let json: unknown = null;
            try {
              json = JSON.parse(line);
            } catch {
              // reported below
            }
            const parsed = Response.safeParse(json);
            if (parsed.success) resolve(parsed.data);
            else reject(new Error(`bad response from momd: ${line.slice(0, 200)}`));
          });
          s.end();
        },
        close() {
          finish(() => reject(new MomdUnavailable("momd closed the connection without answering")));
        },
        error(_s, err) {
          finish(() => reject(new MomdUnavailable(`momd socket error: ${err.message}`)));
        },
      },
    }).catch((err: Error) => finish(() => reject(new MomdUnavailable(`can't reach momd: ${err.message}`))));
  });
}
