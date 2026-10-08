import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { expandHome, type ResolvedDevice } from "./config";

// Every SSH call shares one control connection per host. The laptop's firewall
// rate-limits new SSH connections, so opening one per command would soon lock
// us out.

export function shellQuote(s: string): string {
  if (s !== "" && /^[A-Za-z0-9_@%+=:,./-]+$/.test(s)) return s;
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

export function controlDir(home = homedir()): string {
  return join(home, ".ssh", "momos");
}

export interface SshOptions {
  // Allocate a terminal (interactive shells, live output with colors).
  tty?: boolean;
  // Refuse password prompts. On for everything except `mom ssh`.
  batch?: boolean;
  connectTimeout?: number;
  // Bytes for the remote command's stdin, like a Wi-Fi password.
  stdin?: Uint8Array;
}

export function sshOptionArgs(device: ResolvedDevice, o: SshOptions = {}): string[] {
  const args = [
    "-o", "ControlMaster=auto",
    // %C is a hash of host, port and user, which keeps the socket path short
    // enough for macOS.
    "-o", `ControlPath=${join(controlDir(), "%C")}`,
    "-o", "ControlPersist=10m",
    "-o", "ServerAliveInterval=15",
    "-o", "ServerAliveCountMax=3",
    "-o", `ConnectTimeout=${o.connectTimeout ?? 15}`,
  ];
  if (o.batch ?? true) args.push("-o", "BatchMode=yes");
  if (device.sshPort) args.push("-p", String(device.sshPort));
  if (device.identityFile) args.push("-i", expandHome(device.identityFile));
  return args;
}

export function sshTarget(device: ResolvedDevice): string {
  return `${device.adminUser}@${device.host}`;
}

export function sshArgs(device: ResolvedDevice, remoteCommand: string | null, o: SshOptions = {}): string[] {
  const args = [...sshOptionArgs(device, o), o.tty ? "-t" : "-T", sshTarget(device)];
  if (remoteCommand !== null) args.push(remoteCommand);
  return args;
}

// The `-e` value for rsync, so rsync rides the same control connection.
export function rsyncShell(device: ResolvedDevice): string {
  return ["ssh", ...sshOptionArgs(device)].map(shellQuote).join(" ");
}

// Runs as the person on the laptop and finds their graphical session, so
// momctl can reach Hyprland, Wayland, PipeWire and the user systemd instance.
// sudo resets the environment, so everything is rebuilt from scratch here.
// Kept POSIX sh: the admin's login shell only passes it through.
export const REMOTE_ENV_SCRIPT = `
uid=$(id -u)
XDG_RUNTIME_DIR=/run/user/$uid
export XDG_RUNTIME_DIR
export DBUS_SESSION_BUS_ADDRESS="unix:path=$XDG_RUNTIME_DIR/bus"
PATH=/usr/local/bin:/usr/bin:/bin
export PATH
sig=""
wl=""
# hyprctl knows which instances are alive. Take the newest one it lists.
if command -v hyprctl >/dev/null 2>&1; then
  out=$(hyprctl instances 2>/dev/null)
  sig=$(printf '%s\\n' "$out" | sed -n 's/^instance \\(.*\\):$/\\1/p' | tail -n 1)
  wl=$(printf '%s\\n' "$out" | sed -n 's/^[[:space:]]*wl socket: *//p' | tail -n 1)
fi
# Fall back to the newest instance directory that still has a socket.
if [ -z "$sig" ] && [ -d "$XDG_RUNTIME_DIR/hypr" ]; then
  for d in $(ls -1t "$XDG_RUNTIME_DIR/hypr" 2>/dev/null); do
    if [ -S "$XDG_RUNTIME_DIR/hypr/$d/.socket.sock" ]; then sig=$d; break; fi
  done
fi
if [ -z "$wl" ]; then
  for s in "$XDG_RUNTIME_DIR"/wayland-*; do
    case "$s" in *.lock) continue ;; esac
    if [ -S "$s" ]; then wl=\${s##*/}; break; fi
  done
fi
[ -n "$sig" ] && export HYPRLAND_INSTANCE_SIGNATURE="$sig"
[ -n "$wl" ] && export WAYLAND_DISPLAY="$wl"
exec "$@"
`.trim();

// A command string for the admin's login shell that runs argv as the person,
// inside their session environment.
export function asPersonCommand(person: string, argv: string[]): string {
  return ["sudo", "-n", "-u", person, "-H", "--", "sh", "-c", REMOTE_ENV_SCRIPT, "momos-env", ...argv]
    .map(shellQuote)
    .join(" ");
}

export function momctlCommand(person: string, args: string[]): string {
  return asPersonCommand(person, ["momctl", ...args]);
}

export interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

function ensureControlDir() {
  mkdirSync(controlDir(), { recursive: true, mode: 0o700 });
}

// Run a remote command and capture its output.
export async function sshCapture(device: ResolvedDevice, remoteCommand: string, o: SshOptions = {}): Promise<RunResult> {
  ensureControlDir();
  const proc = Bun.spawn(["ssh", ...sshArgs(device, remoteCommand, o)], {
    stdin: o.stdin ?? "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { code, stdout, stderr };
}

// Run a remote command and capture raw bytes (for screenshots).
export async function sshBytes(device: ResolvedDevice, remoteCommand: string): Promise<{ code: number; bytes: Uint8Array; stderr: string }> {
  ensureControlDir();
  const proc = Bun.spawn(["ssh", ...sshArgs(device, remoteCommand)], { stdin: "ignore", stdout: "pipe", stderr: "pipe" });
  const [buf, stderr, code] = await Promise.all([
    new Response(proc.stdout).arrayBuffer(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { code, bytes: new Uint8Array(buf), stderr };
}

// Run a remote command with the terminal attached.
export async function sshInteractive(device: ResolvedDevice, remoteCommand: string | null, o: SshOptions = {}): Promise<number> {
  ensureControlDir();
  const proc = Bun.spawn(["ssh", ...sshArgs(device, remoteCommand, o)], {
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  });
  return await proc.exited;
}

// Close the control connection, e.g. before a reboot.
export async function sshCloseMaster(device: ResolvedDevice): Promise<void> {
  const proc = Bun.spawn(["ssh", ...sshOptionArgs(device), "-O", "exit", sshTarget(device)], {
    stdin: "ignore",
    stdout: "ignore",
    stderr: "ignore",
  });
  await proc.exited;
}

export function sshFailureMessage(device: ResolvedDevice, stderr: string): string {
  const detail = stderr.trim().split("\n").filter(Boolean).slice(-2).join(" ");
  return `Can't reach ${device.name} (${device.host}) over SSH. Is Tailscale up on both ends?${detail ? ` ssh said: ${detail}` : ""}`;
}
