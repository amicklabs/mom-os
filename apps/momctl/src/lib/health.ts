import { readFileSync, statfsSync } from "node:fs";
import { release, uptime } from "node:os";
import { dkmsModules } from "@momos/shared";
import { tryLoadConfig } from "./config";
import { run } from "./run";
import { battery } from "./system";
import { VERSION } from "./version";

export interface DkmsModule {
  module: string;
  version: string | null;
  builtForRunningKernel: boolean;
  status: string | null;
}

// Parse `dkms status`. Lines look like
//   broadcom-wl/6.30.223.271, 7.2.5-3-omarchy, x86_64: installed
export function parseDkms(out: string, kernel: string, wanted: Record<string, string>): DkmsModule[] {
  const lines = out.split("\n").filter(Boolean);
  return Object.entries(wanted).map(([label, name]) => {
    const mine = lines.filter((l) => l.startsWith(`${name}/`) || l.startsWith(`${name},`));
    const forKernel = mine.find((l) => l.includes(`, ${kernel},`) || l.includes(`, ${kernel}:`));
    const status = forKernel ? (forKernel.split(":").pop()?.trim() ?? null) : null;
    const version = (mine[0] ?? "").split(",")[0]?.split("/")[1] ?? null;
    return { module: label, version, builtForRunningKernel: status === "installed", status };
  });
}

// Days since the last full system upgrade, from pacman's log.
export function daysSinceUpdate(log = "/var/log/pacman.log", now = Date.now()): number | null {
  let text: string;
  try {
    text = readFileSync(log, "utf8");
  } catch {
    return null;
  }
  const i = text.lastIndexOf("starting full system upgrade");
  if (i < 0) return null;
  const lineStart = text.lastIndexOf("\n", i) + 1;
  const m = text.slice(lineStart, i).match(/^\[([^\]]+)\]/);
  const t = m ? Date.parse(m[1]!) : NaN;
  return Number.isFinite(t) ? Math.floor((now - t) / 86_400_000) : null;
}

// DKMS packages whose name differs from the kernel module they build.
const DKMS_PACKAGE: Record<string, string> = { wl: "broadcom-wl" };

// Kernel module name to DKMS package name, for parseDkms.
export function dkmsWanted(modules: string[]): Record<string, string> {
  return Object.fromEntries(modules.map((m) => [m, DKMS_PACKAGE[m] ?? m]));
}

// `modules` comes from local.hardware.dkmsModules in config.json. With none
// listed, dkms isn't run and the report has an empty list.
export async function health(modules: string[] = dkmsModules(tryLoadConfig())) {
  const kernel = release();
  let dkms: DkmsModule[] | { error: string } = [];
  if (modules.length) {
    try {
      const r = await run(["dkms", "status"], { timeoutMs: 20_000 });
      dkms = parseDkms(r.stdout, kernel, dkmsWanted(modules));
    } catch (e) {
      dkms = { error: (e as Error).message };
    }
  }
  let disk: { freeBytes: number; totalBytes: number; freePercent: number } | null = null;
  try {
    const s = statfsSync("/");
    const free = s.bavail * s.bsize;
    const total = s.blocks * s.bsize;
    disk = { freeBytes: free, totalBytes: total, freePercent: Math.round((free / total) * 1000) / 10 };
  } catch {
    // leave null
  }
  return {
    battery: battery(),
    disk,
    dkms,
    kernel,
    momosVersion: VERSION,
    uptimeSeconds: Math.round(uptime()),
    daysSinceUpdate: daysSinceUpdate(),
  };
}
