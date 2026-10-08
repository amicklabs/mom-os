import { existsSync } from "node:fs";
import { sessionEnv } from "./env";

export interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

export class CommandError extends Error {
  constructor(
    message: string,
    readonly result?: RunResult,
  ) {
    super(message);
  }
}

// Run a program to completion and capture its output. Never throws for a
// non-zero exit; the caller decides. Throws only if the program is missing or
// times out.
export async function run(
  cmd: string[],
  opts: { timeoutMs?: number; stdin?: string; env?: Record<string, string | undefined> } = {},
): Promise<RunResult> {
  const bin = which(cmd[0]!);
  if (!bin) throw new CommandError(`${cmd[0]} is not installed`);
  const proc = Bun.spawn([bin, ...cmd.slice(1)], {
    stdin: opts.stdin !== undefined ? new TextEncoder().encode(opts.stdin) : "ignore",
    stdout: "pipe",
    stderr: "pipe",
    env: opts.env ?? sessionEnv(),
  });
  const timeoutMs = opts.timeoutMs ?? 15_000;
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    proc.kill("SIGKILL");
  }, timeoutMs);
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  clearTimeout(timer);
  if (timedOut) throw new CommandError(`${cmd[0]} timed out after ${timeoutMs} ms`);
  return { code, stdout, stderr };
}

// Like run, but throws unless the program exits 0.
export async function runOk(cmd: string[], opts?: Parameters<typeof run>[1]): Promise<string> {
  const r = await run(cmd, opts);
  if (r.code !== 0) {
    const detail = (r.stderr || r.stdout).trim().split("\n").slice(-3).join(" ");
    throw new CommandError(`${cmd[0]} exited ${r.code}${detail ? `: ${detail}` : ""}`, r);
  }
  return r.stdout;
}

// Start a program fully detached from us, so it survives momctl exiting and
// isn't killed with momd's cgroup. Prefers uwsm-app, which puts the app in its
// own systemd scope; falls back to setsid.
export function launchDetached(cmd: string[]): string[] {
  const argv = which("uwsm-app") ? ["uwsm-app", "--", ...cmd] : ["setsid", "-f", ...cmd];
  const bin = which(argv[0]!);
  if (!bin) throw new CommandError(`${argv[0]} is not installed`);
  // Real /dev/null descriptors: Chromium exits at once when Bun's "ignore"
  // leaves its stdio closed.
  const devnull = Bun.file("/dev/null");
  const env = sessionEnv();
  const proc = Bun.spawn([bin, ...argv.slice(1)], {
    // Her home, not ours: over SSH the working directory is the admin's home,
    // which she can't enter, and uwsm-app's scope (systemd-run --same-dir)
    // then fails before the app starts.
    cwd: env.HOME && existsSync(env.HOME) ? env.HOME : "/",
    stdin: devnull,
    stdout: devnull,
    stderr: devnull,
    env,
  });
  proc.unref();
  return argv;
}

const whichCache = new Map<string, string | null>();

export function which(name: string): string | null {
  if (name.includes("/")) return existsSync(name) ? name : null;
  if (whichCache.has(name)) return whichCache.get(name)!;
  const dirs = (process.env.PATH ?? "/usr/local/bin:/usr/bin").split(":");
  for (const extra of ["/usr/local/bin", "/usr/bin"]) if (!dirs.includes(extra)) dirs.push(extra);
  let found: string | null = null;
  for (const d of dirs) {
    if (d && existsSync(`${d}/${name}`)) {
      found = `${d}/${name}`;
      break;
    }
  }
  whichCache.set(name, found);
  return found;
}
