import { readdirSync, readFileSync } from "node:fs";
import { goHomeWorkspace } from "./launch";
import { run } from "./run";

// The MomOS shell's IPC: `qs -c momos ipc call shell <fn> [args]`.
export const SHELL_CONFIG = "momos";

export async function shellCall(fn: string, ...args: string[]): Promise<{ ok: true; output: string } | { ok: false; error: string }> {
  try {
    const r = await run(["qs", "-c", SHELL_CONFIG, "ipc", "call", "shell", fn, ...args], { timeoutMs: 5000 });
    // qs 0.3 prints "Function not found." (or "Target not found.") and still
    // exits 0 when the shell lacks the function.
    const out = r.stdout.trim();
    if (r.code === 0 && /^(function|target) not found/i.test(out)) return { ok: false, error: out };
    if (r.code === 0) return { ok: true, output: out };
    return { ok: false, error: (r.stderr || r.stdout).trim().split("\n")[0] || `qs exited ${r.code}` };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

// Home always ends on the home workspace, whether or not the shell answered.
export async function home(): Promise<{ shell: string; workspace: "home" }> {
  const s = await shellCall("home");
  await goHomeWorkspace();
  return { shell: s.ok ? "ok" : s.error, workspace: "home" };
}

export async function lock(): Promise<{ locked: true }> {
  const s = await shellCall("lock");
  if (!s.ok) throw new Error(`the shell didn't lock the screen: ${s.error}`);
  return { locked: true };
}

// The screensaver lives in the shell (IpcHandler function "screensaver"). An
// older shell without it gets a clear error instead of qs's own message.
export async function screensaver(state: "on" | "off"): Promise<{ screensaver: "on" | "off" }> {
  const s = await shellCall("screensaver", state);
  if (s.ok) return { screensaver: state };
  if (/function not found/i.test(s.error)) {
    throw new Error(`the shell has no screensaver yet (${s.error})`);
  }
  throw new Error(`the shell didn't turn the screensaver ${state}: ${s.error}`);
}

export async function unlock(): Promise<{ locked: false; via: "shell" | "hyprlock" }> {
  const s = await shellCall("unlock");
  if (s.ok) return { locked: false, via: "shell" };
  // If some other locker is up (Omarchy's hyprlock), SIGUSR1 unlocks it.
  if (processRunning("hyprlock")) {
    await run(["pkill", "-USR1", "-x", "hyprlock"]);
    return { locked: false, via: "hyprlock" };
  }
  throw new Error(`the shell didn't unlock the screen: ${s.error}`);
}

// Cheap check through /proc, without spawning pgrep.
export function processRunning(comm: string): boolean {
  const uid = process.getuid?.();
  for (const pid of readdirSync("/proc")) {
    if (!/^\d+$/.test(pid)) continue;
    try {
      if (readFileSync(`/proc/${pid}/comm`, "utf8").trim() !== comm) continue;
      if (uid === undefined) return true;
      const status = readFileSync(`/proc/${pid}/status`, "utf8");
      const m = status.match(/^Uid:\s+(\d+)/m);
      if (m && Number(m[1]) === uid) return true;
    } catch {
      // process went away
    }
  }
  return false;
}
