import { existsSync, readdirSync } from "node:fs";

// The dispatcher does live control (say, VNC, screenshots) through the `mom`
// CLI, the same way the helper and the agents do.

export interface MomResult {
  code: number;
  data: unknown;
  stderr: string;
}

export async function runMom(bin: string, device: string | null, args: string[], env: Record<string, string | undefined>, timeoutMs = 60_000): Promise<MomResult> {
  const argv = [bin, "--json", ...(device ? ["--device", device] : []), ...args];
  const proc = Bun.spawn(argv, { env, stdin: "ignore", stdout: "pipe", stderr: "pipe" });
  const timer = setTimeout(() => proc.kill("SIGTERM"), timeoutMs);
  try {
    const [stdout, stderr, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
    let data: unknown = null;
    try {
      data = stdout.trim() ? JSON.parse(stdout) : null;
    } catch {
      data = { output: stdout.trim() };
    }
    return { code, data, stderr };
  } finally {
    clearTimeout(timer);
  }
}

export function momError(r: MomResult): string {
  const d = r.data as { error?: unknown } | null;
  if (d && typeof d.error === "string") return d.error;
  return r.stderr.trim().split("\n").pop() || `mom exited ${r.code}`;
}

// A systemd user service may start before Hyprland exports its environment.
// A VNC viewer launched from here needs the desktop session, so find it the
// same way mom does on the laptop.
export function graphicalEnv(base: Record<string, string | undefined>): Record<string, string | undefined> {
  const env = { ...base };
  const rt = env.XDG_RUNTIME_DIR ?? `/run/user/${process.getuid?.() ?? 1000}`;
  env.XDG_RUNTIME_DIR = rt;
  try {
    if (!env.WAYLAND_DISPLAY) {
      const sock = readdirSync(rt).find((f) => /^wayland-\d+$/.test(f));
      if (sock) env.WAYLAND_DISPLAY = sock;
    }
    if (!env.HYPRLAND_INSTANCE_SIGNATURE && existsSync(`${rt}/hypr`)) {
      const sig = readdirSync(`${rt}/hypr`).find((d) => existsSync(`${rt}/hypr/${d}/.socket.sock`));
      if (sig) env.HYPRLAND_INSTANCE_SIGNATURE = sig;
    }
  } catch {}
  return env;
}
