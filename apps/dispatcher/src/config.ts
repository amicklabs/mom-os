import { existsSync, readFileSync } from "node:fs";
import { homedir, hostname } from "node:os";
import { join } from "node:path";
import { configPath, expandHome, loadConfig, resolveDispatcherTokenFile, type MomConfig } from "../../mom/src/config";

// The dispatcher shares mom's config (~/.config/momos/mom.json) for the Convex
// URL, the token file and the device list. Environment variables override it,
// which is how tests and the systemd unit point it elsewhere.

export interface DispatcherSettings {
  momConfigPath: string;
  convexUrl: string | null;
  tokenFile: string;
  workerId: string;
  socketPath: string;
  workDir: string;
  claudeBin: string;
  momBin: string;
  model: string | null;
  readDirs: string[];
  investigateTimeoutMs: number;
  fixTimeoutMs: number;
  leaseMs: number;
  helperName: string;
}

const env = process.env;
const home = env.HOME ?? homedir();

function runtimeDir(): string {
  return env.XDG_RUNTIME_DIR ?? `/run/user/${process.getuid?.() ?? 1000}`;
}

export function screenshotCacheDir(): string {
  return join(env.XDG_CACHE_HOME ?? join(home, ".cache"), "momos", "screenshots");
}

export function tryLoadMomConfig(): { config: MomConfig | null; error: string | null } {
  try {
    return { config: loadConfig(), error: null };
  } catch (e) {
    return { config: null, error: (e as Error).message };
  }
}

export function settings(config: MomConfig | null): DispatcherSettings {
  const minutes = (v: string | undefined, d: number) => (v && Number(v) > 0 ? Number(v) : d) * 60_000;
  const repo = env.MOMOS_REPO_DIR ?? config?.repoDir ?? null;
  return {
    momConfigPath: configPath(),
    convexUrl: env.MOMOS_CONVEX_URL ?? config?.convexUrl ?? null,
    tokenFile: resolveDispatcherTokenFile(env.MOMOS_DISPATCHER_TOKEN_FILE ?? config?.dispatcherTokenFile, home),
    workerId: `${hostname()}-${process.pid}`,
    socketPath: env.MOMOS_DISPATCHER_SOCKET ?? join(runtimeDir(), "momos-dispatcher.sock"),
    // One fixed directory for every job: Claude Code files sessions by working
    // directory, so --resume only finds a session from the same place.
    workDir: env.MOMOS_DISPATCHER_WORKDIR ?? join(env.XDG_STATE_HOME ?? join(home, ".local", "state"), "momos", "dispatcher", "work"),
    claudeBin: env.MOMOS_CLAUDE_BIN ?? "claude",
    momBin: env.MOMOS_MOM_BIN ?? "mom",
    model: env.MOMOS_CLAUDE_MODEL ?? null,
    readDirs: [screenshotCacheDir(), ...(repo ? [expandHome(repo)] : [])],
    investigateTimeoutMs: minutes(env.MOMOS_INVESTIGATE_MINUTES, 10),
    fixTimeoutMs: minutes(env.MOMOS_FIX_MINUTES, 20),
    leaseMs: 5 * 60_000,
    helperName: config?.helperName ?? "the helper",
  };
}

export function readToken(file: string): string | null {
  if (!existsSync(file)) return null;
  const t = readFileSync(file, "utf8").trim();
  return t || null;
}

// Pick the mom device for a Convex device: same name, else the default or
// only device in mom.json.
export function momDeviceFor(config: MomConfig | null, convexName: string | null | undefined): string | null {
  if (!config) return null;
  if (convexName && config.devices[convexName]) return convexName;
  const names = Object.keys(config.devices);
  return config.defaultDevice ?? (names.length === 1 ? names[0]! : null);
}
