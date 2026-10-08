import { mkdirSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { runtimeDir } from "@momos/shared";

// One launch per tile at a time. A second tap on a tile while its app is still
// starting must not start it again, or two windows of the same app end up on
// its workspace. momctl takes a lock file per tile before it launches and
// drops it when the window shows up or the wait ends. momd reads the same
// files so it doesn't send her home from a tile workspace that is still empty
// because its app is starting.

// Longer than openTile's wait, so a lock outlives any launch that's still
// being watched, and short enough that a crashed momctl can't block a tile
// for long.
export const LAUNCH_LOCK_MS = 25_000;

export interface LaunchLock {
  tileId: string;
  workspace: string;
  pid: number;
  at: number;
}

const lockDir = () => runtimeDir();
const lockPath = (dir: string, tileId: string) => `${dir}/launch-${tileId}.json`;

function readLock(path: string): LaunchLock | null {
  try {
    const l = JSON.parse(readFileSync(path, "utf8")) as LaunchLock;
    return typeof l.at === "number" && typeof l.workspace === "string" ? l : null;
  } catch {
    return null;
  }
}

// Take the tile's launch lock. Returns the lock if we got it, or null if
// another launch of the same tile started less than LAUNCH_LOCK_MS ago.
export function acquireLaunch(
  tileId: string,
  workspace: string,
  opts: { dir?: string; now?: number; pid?: number } = {},
): LaunchLock | null {
  const dir = opts.dir ?? lockDir();
  const now = opts.now ?? Date.now();
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const path = lockPath(dir, tileId);
  const lock: LaunchLock = { tileId, workspace, pid: opts.pid ?? process.pid, at: now };
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      writeFileSync(path, JSON.stringify(lock), { flag: "wx", mode: 0o600 });
      return lock;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
      const held = readLock(path);
      if (held && now - held.at >= 0 && now - held.at < LAUNCH_LOCK_MS) return null;
      // Stale or unreadable: take it over.
      try {
        unlinkSync(path);
      } catch {
        // someone else removed it first
      }
    }
  }
  return null;
}

// Drop the lock, but only if it's still ours.
export function releaseLaunch(lock: LaunchLock, opts: { dir?: string } = {}): void {
  const path = lockPath(opts.dir ?? lockDir(), lock.tileId);
  const held = readLock(path);
  if (held && held.pid === lock.pid && held.at === lock.at) {
    try {
      unlinkSync(path);
    } catch {
      // already gone
    }
  }
}

// Workspaces with a launch in progress right now.
export function launchingWorkspaces(opts: { dir?: string; now?: number } = {}): Set<string> {
  const dir = opts.dir ?? lockDir();
  const now = opts.now ?? Date.now();
  const out = new Set<string>();
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return out;
  }
  for (const name of names) {
    if (!/^launch-.+\.json$/.test(name)) continue;
    const l = readLock(`${dir}/${name}`);
    if (l && now - l.at < LAUNCH_LOCK_MS) out.add(l.workspace);
  }
  return out;
}
