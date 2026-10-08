import { mkdirSync, readdirSync, statSync, unlinkSync, writeFileSync, copyFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ResolvedDevice } from "./config";
import { asPersonCommand, momctlCommand, sshBytes, sshCapture, sshFailureMessage } from "./ssh";

// momctl commands `mom` passes straight through. `help` is spelled
// `press-help` here so `mom help` can print usage.
export const PASSTHROUGH: Record<string, string> = {
  status: "status",
  open: "open",
  reload: "reload",
  home: "home",
  lock: "lock",
  unlock: "unlock",
  volume: "volume",
  apps: "apps",
  say: "say",
  "press-help": "help",
  click: "click",
  type: "type",
  key: "key",
  wifi: "wifi",
  speaker: "speaker",
  logs: "logs",
  restart: "restart",
  health: "health",
  screensaver: "screensaver",
  screen: "screen",
};

export class RemoteError extends Error {
  constructor(message: string, readonly code = 1) {
    super(message);
  }
}

export interface MomctlResult {
  code: number;
  data: unknown;
  raw: string;
  stderr: string;
}

export function parseMomctlOutput(stdout: string): unknown {
  const text = stdout.trim();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    // momctl should print one JSON document. If a warning slipped onto
    // stdout, take the last line that parses.
    for (const line of text.split("\n").reverse()) {
      try {
        return JSON.parse(line);
      } catch {}
    }
    return { output: text };
  }
}

export async function runMomctl(device: ResolvedDevice, args: string[], o: { stdin?: string } = {}): Promise<MomctlResult> {
  const stdin = o.stdin === undefined ? undefined : new TextEncoder().encode(o.stdin);
  const r = await sshCapture(device, momctlCommand(device.user, args), { stdin });
  if (r.code === 255) throw new RemoteError(sshFailureMessage(device, r.stderr), 255);
  if (r.code !== 0 && /sudo: a (terminal|password) is required/.test(r.stderr)) {
    throw new RemoteError(`${device.adminUser} on ${device.name} needs passwordless sudo to run commands as ${device.user}.`);
  }
  if (r.code === 127 && /momctl/.test(r.stderr)) {
    throw new RemoteError(`momctl isn't installed on ${device.name}. Run \`mom deploy\`.`, 127);
  }
  return { code: r.code, data: parseMomctlOutput(r.stdout), raw: r.stdout, stderr: r.stderr };
}

// Find the screenshot path in momctl's JSON, whatever shape it takes.
export function findPngPath(data: unknown): string | null {
  if (typeof data === "string") return /\.png$/i.test(data) ? data : null;
  if (Array.isArray(data)) {
    for (const x of data) {
      const p = findPngPath(x);
      if (p) return p;
    }
    return null;
  }
  if (data && typeof data === "object") {
    const o = data as Record<string, unknown>;
    for (const key of ["path", "file", "out"]) {
      if (typeof o[key] === "string") return o[key] as string;
    }
    for (const v of Object.values(o)) {
      const p = findPngPath(v);
      if (p) return p;
    }
  }
  return null;
}

export function screenshotDir(home = homedir()): string {
  const base = process.env.XDG_CACHE_HOME ?? join(home, ".cache");
  return join(base, "momos", "screenshots");
}

function stamp(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

const KEEP_SCREENSHOTS = 50;

function prune(dir: string, device: string) {
  const files = readdirSync(dir)
    .filter((f) => f.startsWith(`${device}-2`) && f.endsWith(".png"))
    .map((f) => ({ f, t: statSync(join(dir, f)).mtimeMs }))
    .sort((a, b) => b.t - a.t);
  for (const { f } of files.slice(KEEP_SCREENSHOTS)) {
    try {
      unlinkSync(join(dir, f));
    } catch {}
  }
}

export interface ScreenshotResult {
  device: string;
  path: string;
  latest: string;
  remotePath: string;
  takenAt: number;
  bytes: number;
  // Whether momctl had to turn the screen on first. Null from a momctl too old
  // to say.
  screenWoken: boolean | null;
}

export function findScreenWoken(data: unknown): boolean | null {
  const w = (data as { data?: { screenWoken?: unknown } } | null)?.data?.screenWoken;
  return typeof w === "boolean" ? w : null;
}

// Take a screenshot with momctl, copy it back, and delete the remote copy.
// Nothing shows on her screen.
export async function screenshot(device: ResolvedDevice, out?: string): Promise<ScreenshotResult> {
  const remotePath = `/tmp/momos-mom-${Date.now()}-${Math.floor(Math.random() * 1e6)}.png`;
  const r = await runMomctl(device, ["screenshot", "--out", remotePath]);
  if (r.code !== 0) {
    throw new RemoteError(`momctl screenshot failed: ${JSON.stringify(r.data) ?? r.stderr.trim()}`, r.code);
  }
  const path = findPngPath(r.data) ?? remotePath;
  const fetch = await sshBytes(
    device,
    asPersonCommand(device.user, ["sh", "-c", 'cat -- "$1" && rm -f -- "$1"', "fetch", path]),
  );
  if (fetch.code !== 0 || fetch.bytes.length === 0) {
    throw new RemoteError(`Couldn't copy ${path} back from ${device.name}: ${fetch.stderr.trim() || `exit ${fetch.code}`}`);
  }
  const dir = screenshotDir();
  mkdirSync(dir, { recursive: true });
  const takenAt = Date.now();
  const local = out ?? join(dir, `${device.name}-${stamp(new Date(takenAt))}.png`);
  writeFileSync(local, fetch.bytes);
  const latest = join(dir, `${device.name}-latest.png`);
  if (local !== latest) copyFileSync(local, latest);
  if (!out) prune(dir, device.name);
  return { device: device.name, path: local, latest, remotePath: path, takenAt, bytes: fetch.bytes.length, screenWoken: findScreenWoken(r.data) };
}
