import { existsSync, readdirSync, statSync } from "node:fs";

// momctl often runs over SSH, where the Wayland and Hyprland variables of the
// person's session aren't set. Fill them in from the runtime directory so that
// hyprctl, grim, wpctl and systemctl --user reach her session.

function newestHyprInstance(runtime: string): string | undefined {
  const dir = `${runtime}/hypr`;
  if (!existsSync(dir)) return undefined;
  const live = readdirSync(dir)
    .filter((name) => existsSync(`${dir}/${name}/.socket.sock`))
    .map((name) => ({ name, mtime: statSync(`${dir}/${name}`).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);
  return live[0]?.name;
}

function firstWaylandSocket(runtime: string): string | undefined {
  if (!existsSync(runtime)) return undefined;
  return readdirSync(runtime)
    .filter((n) => /^wayland-\d+$/.test(n))
    .sort()[0];
}

// Mutates process.env so every child process and the shared path helpers see
// the same session. Safe to call often; it re-checks the Hyprland instance in
// case Hyprland restarted.
export function ensureSessionEnv(): void {
  const env = process.env;
  const uid = process.getuid?.() ?? 1000;
  if (!env.XDG_RUNTIME_DIR) env.XDG_RUNTIME_DIR = `/run/user/${uid}`;
  const runtime = env.XDG_RUNTIME_DIR;
  const sig = env.HYPRLAND_INSTANCE_SIGNATURE;
  if (!sig || !existsSync(`${runtime}/hypr/${sig}/.socket.sock`)) {
    const found = newestHyprInstance(runtime);
    if (found) env.HYPRLAND_INSTANCE_SIGNATURE = found;
  }
  if (!env.WAYLAND_DISPLAY || !existsSync(`${runtime}/${env.WAYLAND_DISPLAY}`)) {
    const found = firstWaylandSocket(runtime);
    if (found) env.WAYLAND_DISPLAY = found;
  }
  if (!env.DBUS_SESSION_BUS_ADDRESS && existsSync(`${runtime}/bus`)) {
    env.DBUS_SESSION_BUS_ADDRESS = `unix:path=${runtime}/bus`;
  }
}

export function sessionEnv(): Record<string, string | undefined> {
  ensureSessionEnv();
  return process.env;
}

export function hyprSocketDir(): string | null {
  ensureSessionEnv();
  const sig = process.env.HYPRLAND_INSTANCE_SIGNATURE;
  if (!sig) return null;
  return `${process.env.XDG_RUNTIME_DIR}/hypr/${sig}`;
}
