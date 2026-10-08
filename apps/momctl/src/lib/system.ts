import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, unlinkSync } from "node:fs";
import { dirname } from "node:path";
import { runtimeDir } from "@momos/shared";
import { run, runOk } from "./run";
import { wakeForScreenshot } from "./screen";

// ---- units ----------------------------------------------------------------

// systemd --user units for `momctl logs` and `momctl restart`, as installed
// from system/files/systemd/.
export const UNITS = { momd: "momd.service", shell: "momos-shell.service", wayvnc: "momos-wayvnc.service" } as const;
export type UnitName = keyof typeof UNITS;
export const isUnitName = (s: string | undefined): s is UnitName => !!s && s in UNITS;

export async function logs(unit: UnitName, lines: number): Promise<{ unit: string; lines: string[] }> {
  const out = await runOk(["journalctl", "--user", "-u", UNITS[unit], "-n", String(lines), "--no-pager", "-o", "short-iso"]);
  return { unit: UNITS[unit], lines: out.split("\n").filter((l) => l && !l.startsWith("-- ")) };
}

export async function restart(unit: UnitName): Promise<{ unit: string; restarted: true }> {
  await runOk(["systemctl", "--user", "restart", UNITS[unit]], { timeoutMs: 30_000 });
  return { unit: UNITS[unit], restarted: true };
}

// ---- power -----------------------------------------------------------------

// `momctl power off|restart`, for the Turn off and Restart pages under More.
// Her account may do both without a password, even with the admin logged in
// over SSH: system/files/polkit/50-momos-reboot.rules.
export type PowerAction = "off" | "restart";
export const isPowerAction = (s: string | undefined): s is PowerAction => s === "off" || s === "restart";

export function powerCommand(action: PowerAction): string[] {
  return ["systemctl", action === "off" ? "poweroff" : "reboot"];
}

export async function power(action: PowerAction, runner: typeof runOk = runOk): Promise<{ power: PowerAction; started: true }> {
  await runner(powerCommand(action), { timeoutMs: 30_000 });
  return { power: action, started: true };
}

// ---- volume ---------------------------------------------------------------

const SINK = "@DEFAULT_AUDIO_SINK@";

export async function getVolume(): Promise<{ percent: number; muted: boolean }> {
  const out = await runOk(["wpctl", "get-volume", SINK]);
  const m = out.match(/Volume:\s*([\d.]+)/);
  return { percent: m ? Math.round(Number(m[1]) * 100) : 0, muted: out.includes("[MUTED]") };
}

export async function volume(dir: "up" | "down" | "mute"): Promise<{ percent: number; muted: boolean }> {
  if (dir === "mute") await runOk(["wpctl", "set-mute", SINK, "toggle"]);
  else {
    // Louder always unmutes; that's what she means.
    if (dir === "up") await runOk(["wpctl", "set-mute", SINK, "0"]);
    await runOk(["wpctl", "set-volume", "-l", "1.0", SINK, dir === "up" ? "5%+" : "5%-"]);
  }
  return getVolume();
}

// ---- screenshots ----------------------------------------------------------

// `momctl screenshot`: turn the screen on if it's off, then take the picture.
// There's no notice on her screen: she asked for screenshots to be silent
// (September 28, 2026). Screen sharing still always tells her. `screenWoken`
// says the screen was off and this turned it on; it stays on until the idle
// timer turns it off.
export async function wakeAndScreenshot(
  out?: string,
  opts: { lidClosed?: boolean } = {},
): Promise<{ path: string; bytes: number; screenWoken: boolean }> {
  const { woken } = await wakeForScreenshot(opts.lidClosed ?? false);
  return { ...(await screenshot(out)), screenWoken: woken };
}

// Takes the picture with grim.
export async function screenshot(out: string | undefined, opts: { jpeg?: boolean } = {}): Promise<{ path: string; bytes: number }> {
  let path = out;
  if (!path) {
    const dir = `${runtimeDir()}/shots`;
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    prune(dir, 4);
    path = `${dir}/screenshot-${new Date().toISOString().replace(/[:.]/g, "-")}.${opts.jpeg ? "jpg" : "png"}`;
  } else {
    mkdirSync(dirname(path), { recursive: true });
  }
  const jpeg = opts.jpeg ?? /\.jpe?g$/i.test(path);
  await runOk(["grim", ...(jpeg ? ["-t", "jpeg", "-q", "75"] : []), path], { timeoutMs: 15_000 });
  return { path, bytes: statSync(path).size };
}

// Keep the newest `keep` files in dir.
export function prune(dir: string, keep: number): void {
  if (!existsSync(dir)) return;
  const files = readdirSync(dir)
    .filter((f) => !f.startsWith("."))
    .map((f) => ({ f, t: statSync(`${dir}/${f}`).mtimeMs }))
    .sort((a, b) => b.t - a.t);
  for (const { f } of files.slice(keep)) {
    try {
      unlinkSync(`${dir}/${f}`);
    } catch {
      // already gone
    }
  }
}

// ---- battery --------------------------------------------------------------

const PS = "/sys/class/power_supply";

function readProps(dir: string): Record<string, string> {
  const props: Record<string, string> = {};
  try {
    for (const line of readFileSync(`${dir}/uevent`, "utf8").split("\n")) {
      const i = line.indexOf("=");
      if (i > 0) props[line.slice(0, i).replace(/^POWER_SUPPLY_/, "")] = line.slice(i + 1);
    }
  } catch {
    // no such supply
  }
  return props;
}

export interface BatteryInfo {
  percent: number;
  charging: boolean;
  status: string;
  acOnline: boolean | null;
  healthPercent: number | null; // full capacity as % of design
  cycles: number | null;
}

export function battery(root = PS): BatteryInfo | null {
  if (!existsSync(root)) return null;
  const supplies = readdirSync(root).map((n) => readProps(`${root}/${n}`));
  const bat = supplies.find((p) => p.TYPE === "Battery" && p.PRESENT !== "0");
  if (!bat) return null;
  const ac = supplies.find((p) => p.TYPE === "Mains");
  const acOnline = ac ? ac.ONLINE === "1" : null;
  const status = bat.STATUS ?? "Unknown";
  const full = Number(bat.CHARGE_FULL ?? bat.ENERGY_FULL);
  const design = Number(bat.CHARGE_FULL_DESIGN ?? bat.ENERGY_FULL_DESIGN);
  return {
    percent: Math.max(0, Math.min(100, Number(bat.CAPACITY ?? 0))),
    charging: status === "Charging" || (acOnline === true && status !== "Discharging"),
    status,
    acOnline,
    healthPercent: full > 0 && design > 0 ? Math.round((full / design) * 1000) / 10 : null,
    cycles: bat.CYCLE_COUNT ? Number(bat.CYCLE_COUNT) : null,
  };
}

// ---- network --------------------------------------------------------------

// nmcli -t separates fields with ':' and escapes literal colons as '\:'.
export function splitTerse(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (ch === "\\" && i + 1 < line.length) cur += line[++i];
    else if (ch === ":") {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

export interface WifiInfo {
  connectivity: string; // NetworkManager: full, limited, portal, none, unknown
  wifi: { ssid: string | null; signal: number | null; device: string | null } | null;
  devices: { device: string; type: string; state: string; connection: string }[];
}

export async function wifi(): Promise<WifiInfo> {
  const [conn, devs, aps] = await Promise.all([
    runOk(["nmcli", "-t", "networking", "connectivity"], { timeoutMs: 5000 }),
    runOk(["nmcli", "-t", "-f", "DEVICE,TYPE,STATE,CONNECTION", "device"], { timeoutMs: 5000 }),
    // --rescan no: read the cached scan, never trigger a new one.
    run(["nmcli", "-t", "-f", "ACTIVE,SSID,SIGNAL,DEVICE", "device", "wifi", "list", "--rescan", "no"], { timeoutMs: 5000 }),
  ]);
  const devices = devs
    .split("\n")
    .filter(Boolean)
    .map((l) => {
      const [device = "", type = "", state = "", connection = ""] = splitTerse(l);
      return { device, type, state, connection };
    })
    .filter((d) => d.type !== "loopback");
  let wifiInfo: WifiInfo["wifi"] = null;
  const hasWifi = devices.some((d) => d.type === "wifi");
  if (hasWifi) {
    const active = aps.stdout
      .split("\n")
      .map(splitTerse)
      .find((f) => f[0] === "yes");
    wifiInfo = active
      ? { ssid: active[1] || null, signal: active[2] ? Number(active[2]) : null, device: active[3] || null }
      : { ssid: null, signal: null, device: devices.find((d) => d.type === "wifi")?.device ?? null };
  }
  return { connectivity: conn.trim(), wifi: wifiInfo, devices };
}
