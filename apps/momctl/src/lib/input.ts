import { existsSync } from "node:fs";
import { dispatch } from "./hypr";
import { runOk, which } from "./run";

// Synthetic input through ydotool. It needs the ydotoold daemon running with
// access to /dev/uinput. The pointer is placed with Hyprland (exact pixels,
// no pointer acceleration) and ydotool only presses the button.

// momos-ydotoold.service runs ydotoold per user with its socket in the runtime
// dir. Over SSH YDOTOOL_SOCKET isn't set, so look there first.
export function ydotoolSocket(env = process.env): string {
  if (env.YDOTOOL_SOCKET && existsSync(env.YDOTOOL_SOCKET)) return env.YDOTOOL_SOCKET;
  const own = `${env.XDG_RUNTIME_DIR ?? `/run/user/${process.getuid?.() ?? 1000}`}/.ydotool_socket`;
  const candidates = [own, "/tmp/.ydotool_socket"];
  return candidates.find((p) => existsSync(p)) ?? own;
}

export function ydotoolProblem(): string | null {
  if (!which("ydotool")) return "ydotool is not installed (pacman -S ydotool)";
  const sock = ydotoolSocket();
  if (!existsSync(sock)) return `ydotoold is not running: no socket at ${sock} (it needs /dev/uinput access)`;
  return null;
}

async function ydotool(args: string[]): Promise<void> {
  const problem = ydotoolProblem();
  if (problem) throw new Error(problem);
  await runOk(["ydotool", ...args], { timeoutMs: 10_000, env: { ...process.env, YDOTOOL_SOCKET: ydotoolSocket() } });
}

export async function click(x: number, y: number, button: "left" | "right" = "left"): Promise<{ x: number; y: number }> {
  if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || y < 0) throw new Error("click needs two non-negative numbers");
  const problem = ydotoolProblem();
  if (problem) throw new Error(problem);
  await dispatch(`hl.dsp.cursor.move({ x = ${Math.round(x)}, y = ${Math.round(y)} })`);
  // 0xC0 = left down+up, 0xC1 = right down+up.
  await ydotool(["click", button === "left" ? "0xC0" : "0xC1"]);
  return { x: Math.round(x), y: Math.round(y) };
}

export async function type(text: string): Promise<{ typed: number }> {
  await ydotool(["type", "--key-delay", "12", "--", text]);
  return { typed: text.length };
}

// Linux input event codes (linux/input-event-codes.h).
const KEYS: Record<string, number> = {
  esc: 1, escape: 1, backspace: 14, tab: 15, enter: 28, return: 28, space: 57,
  ctrl: 29, control: 29, shift: 42, alt: 56, super: 125, meta: 125, win: 125,
  minus: 12, equal: 13, leftbrace: 26, rightbrace: 27, semicolon: 39, apostrophe: 40,
  grave: 41, backslash: 43, comma: 51, dot: 52, period: 52, slash: 53,
  capslock: 58, home: 102, up: 103, pageup: 104, left: 105, right: 106, end: 107,
  down: 108, pagedown: 109, insert: 110, delete: 111, del: 111,
  mute: 113, volumedown: 114, volumeup: 115,
  f1: 59, f2: 60, f3: 61, f4: 62, f5: 63, f6: 64, f7: 65, f8: 66, f9: 67, f10: 68, f11: 87, f12: 88,
  "1": 2, "2": 3, "3": 4, "4": 5, "5": 6, "6": 7, "7": 8, "8": 9, "9": 10, "0": 11,
  q: 16, w: 17, e: 18, r: 19, t: 20, y: 21, u: 22, i: 23, o: 24, p: 25,
  a: 30, s: 31, d: 32, f: 33, g: 34, h: 35, j: 36, k: 37, l: 38,
  z: 44, x: 45, c: 46, v: 47, b: 48, n: 49, m: 50,
};

// "ctrl+shift+t" -> ["29:1","42:1","20:1","20:0","42:0","29:0"]
export function keySequence(combo: string): string[] {
  const parts = combo.toLowerCase().split("+").map((p) => p.trim()).filter(Boolean);
  if (parts.length === 0) throw new Error("key needs a combo like enter or ctrl+l");
  const codes = parts.map((p) => {
    const code = KEYS[p];
    if (code === undefined) throw new Error(`unknown key "${p}"`);
    return code;
  });
  return [...codes.map((c) => `${c}:1`), ...codes.reverse().map((c) => `${c}:0`)];
}

export async function key(combo: string): Promise<{ key: string }> {
  await ydotool(["key", ...keySequence(combo)]);
  return { key: combo };
}
