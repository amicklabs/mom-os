import { CommandError, run, runOk } from "./run";

// Hyprland 0.56 takes Lua for `hyprctl dispatch`. The argument is wrapped as
// `return hl.dispatch(<arg>)`, so it must be an hl.dsp.* call, for example
//   hyprctl dispatch 'hl.dsp.focus({ workspace = "name:home" })'
// hyprctl prints "ok" on success. A Lua error prints "error: ..." (exit 7).

export interface HyprClient {
  address: string;
  class: string;
  initialClass: string;
  title: string;
  pid: number;
  mapped: boolean;
  hidden: boolean;
  workspace: { id: number; name: string };
  focusHistoryID: number;
  fullscreen: number;
}

export interface HyprWorkspace {
  id: number;
  name: string;
  windows: number;
  monitor: string;
}

export interface HyprMonitor {
  name: string;
  focused: boolean;
  dpmsStatus: boolean;
  width: number;
  height: number;
  activeWorkspace: { id: number; name: string };
}

// A Lua string literal. Escapes everything outside printable ASCII so no input
// can break out of the literal.
export function luaStr(s: string): string {
  let out = '"';
  for (const ch of s) {
    const c = ch.codePointAt(0)!;
    if (ch === '"' || ch === "\\") out += "\\" + ch;
    else if (c >= 0x20 && c < 0x7f) out += ch;
    else out += Array.from(new TextEncoder().encode(ch), (b) => `\\${b.toString().padStart(3, "0")}`).join("");
  }
  return out + '"';
}

async function hyprJson<T>(what: string): Promise<T> {
  const out = await runOk(["hyprctl", "-j", what], { timeoutMs: 5000 });
  try {
    return JSON.parse(out) as T;
  } catch {
    throw new CommandError(`hyprctl ${what}: ${out.trim().slice(0, 200) || "no output"}`);
  }
}

export const clients = () => hyprJson<HyprClient[]>("clients");
export const workspaces = () => hyprJson<HyprWorkspace[]>("workspaces");
export const activeWorkspace = () => hyprJson<HyprWorkspace>("activeworkspace");
export const monitors = () => hyprJson<HyprMonitor[]>("monitors");
export const activeWindow = async (): Promise<HyprClient | null> => {
  const w = await hyprJson<Partial<HyprClient>>("activewindow");
  return w && w.address ? (w as HyprClient) : null;
};

export async function dispatch(lua: string): Promise<void> {
  const r = await run(["hyprctl", "dispatch", lua], { timeoutMs: 5000 });
  const out = r.stdout.trim();
  if (r.code !== 0 || out !== "ok") {
    throw new CommandError(`hyprctl dispatch failed: ${(out || r.stderr.trim()).split("\n")[0]}`, r);
  }
}

export const lua = {
  focusWorkspace: (name: string) => `hl.dsp.focus({ workspace = ${luaStr(`name:${name}`)} })`,
  focusWindow: (address: string) => `hl.dsp.focus({ window = ${luaStr(`address:${address}`)} })`,
  moveWindow: (address: string, workspace: string, follow: boolean) =>
    `hl.dsp.window.move({ workspace = ${luaStr(`name:${workspace}`)}, window = ${luaStr(`address:${address}`)}, follow = ${follow} })`,
  closeWindow: (address: string) => `hl.dsp.window.close({ window = ${luaStr(`address:${address}`)} })`,
  dpms: (on: boolean) => `hl.dsp.dpms({ action = ${luaStr(on ? "on" : "off")} })`,
  exec: (cmd: string) => `hl.dsp.exec_cmd(${luaStr(cmd)})`,
};

export const focusWorkspace = (name: string) => dispatch(lua.focusWorkspace(name));
export const focusWindow = (address: string) => dispatch(lua.focusWindow(address));
export const moveWindow = (address: string, workspace: string, follow = false) =>
  dispatch(lua.moveWindow(address, workspace, follow));
export const closeWindow = (address: string) => dispatch(lua.closeWindow(address));
export const dpms = (on: boolean) => dispatch(lua.dpms(on));
