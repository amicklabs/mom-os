import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { z } from "zod";

// ~/.config/momos/mom.json on the helper's machines. It holds
// only how to reach each laptop. Nothing here is secret: the dispatcher token
// lives in its own file and the person's settings live on the laptop.

const Name = z.string().regex(/^[a-z0-9][a-z0-9-]{0,39}$/, "lowercase letters, digits and dashes");
const UnixUser = z.string().regex(/^[a-z_][a-z0-9_-]{0,31}$/);

export const DeviceConfig = z.object({
  // SSH host, normally the laptop's Tailscale name.
  host: z.string().min(1),
  sshPort: z.number().int().min(1).max(65535).nullish(),
  identityFile: z.string().nullish(),
  // The person's account. momctl runs as this user.
  user: UnixUser,
  // The account mom logs in as. Needs passwordless sudo.
  adminUser: UnixUser,
  vncHost: z.string().nullish(),
  vncPort: z.number().int().min(1).max(65535).default(5900),
  // Local path of the real config.json, sent along by `mom deploy`.
  configFile: z.string().nullish(),
});
export type DeviceConfig = z.infer<typeof DeviceConfig>;

export const MomConfig = z.object({
  defaultDevice: Name.nullish(),
  // How agents refer to the helper in prompts and messages ("Sam").
  helperName: z.string().min(1).max(32).nullish(),
  devices: z.record(Name, DeviceConfig),
  convexUrl: z.url().nullish(),
  // Where the dispatcher token lives. Unset means DISPATCHER_TOKEN_FILE.
  dispatcherTokenFile: z.string().nullish(),
  // The mom-os checkout used by `mom deploy`. Found from the current
  // directory when unset.
  repoDir: z.string().nullish(),
});
export type MomConfig = z.infer<typeof MomConfig>;

export class ConfigError extends Error {}

export function expandHome(p: string, home = homedir()): string {
  if (p === "~") return home;
  if (p.startsWith("~/")) return join(home, p.slice(2));
  return p;
}

export function configPath(env: Record<string, string | undefined> = process.env): string {
  if (env.MOM_CONFIG) return expandHome(env.MOM_CONFIG);
  const base = env.XDG_CONFIG_HOME ?? join(env.HOME ?? homedir(), ".config");
  return join(base, "momos", "mom.json");
}

export function parseConfig(raw: string, source = "mom.json"): MomConfig {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch (e) {
    throw new ConfigError(`${source} is not valid JSON: ${(e as Error).message}`);
  }
  const parsed = MomConfig.safeParse(json);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  ${i.path.join(".") || "(root)"}: ${i.message}`).join("\n");
    throw new ConfigError(`${source} has problems:\n${issues}`);
  }
  return parsed.data;
}

export function loadConfig(path = configPath()): MomConfig {
  if (!existsSync(path)) {
    throw new ConfigError(`No config at ${path}. Run \`mom init\` to write a starter file.`);
  }
  return parseConfig(readFileSync(path, "utf8"), path);
}

export interface ResolvedDevice extends DeviceConfig {
  name: string;
}

// --device flag, then $MOM_DEVICE, then defaultDevice, then the only device.
export function resolveDevice(config: MomConfig, requested?: string | null, env = process.env): ResolvedDevice {
  const names = Object.keys(config.devices);
  const name = requested ?? env.MOM_DEVICE ?? config.defaultDevice ?? (names.length === 1 ? names[0] : undefined);
  if (!name) {
    if (names.length === 0) throw new ConfigError("No devices in mom.json. Add one under \"devices\".");
    throw new ConfigError(`Several devices (${names.join(", ")}). Pick one with --device or set defaultDevice.`);
  }
  const device = config.devices[name];
  if (!device) throw new ConfigError(`Unknown device "${name}". Known: ${names.join(", ") || "none"}.`);
  return { name, ...device };
}

export interface InitOptions {
  device?: string;
  host?: string;
  user?: string;
  admin?: string;
  convexUrl?: string;
  helper?: string;
}

export function starterConfig(o: InitOptions = {}): MomConfig {
  const name = o.device ?? "laptop";
  return {
    defaultDevice: name,
    helperName: o.helper ?? null,
    devices: {
      [name]: {
        host: o.host ?? "laptop-tailscale-name",
        sshPort: null,
        identityFile: null,
        user: o.user ?? "person",
        adminUser: o.admin ?? "admin",
        vncHost: null,
        vncPort: 5900,
        configFile: null,
      },
    },
    convexUrl: o.convexUrl ?? null,
    dispatcherTokenFile: null,
    repoDir: null,
  };
}

export function writeStarterConfig(path: string, o: InitOptions, force: boolean): MomConfig {
  if (existsSync(path) && !force) {
    throw new ConfigError(`${path} already exists. Use --force to overwrite it.`);
  }
  const config = starterConfig(o);
  // Validate what we are about to write so a bad flag fails here, not later.
  MomConfig.parse(config);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(config, null, 2) + "\n", { mode: 0o600 });
  return config;
}

export const DISPATCHER_TOKEN_FILE = "~/.config/momos/dispatcher-token";
// The default before the token moved. Older `mom init` runs wrote it into
// mom.json, so a configured value equal to it counts as unset.
const OLD_DEFAULT_TOKEN_FILE = "~/.config/momos-dev/dispatcher-token";

// Which file holds the dispatcher token: the configured path, else the default.
export function resolveDispatcherTokenFile(configured: string | null | undefined, home = homedir()): string {
  if (configured && expandHome(configured, home) !== expandHome(OLD_DEFAULT_TOKEN_FILE, home)) return expandHome(configured, home);
  return expandHome(DISPATCHER_TOKEN_FILE, home);
}

export function readDispatcherToken(config: MomConfig): string {
  const file = resolveDispatcherTokenFile(config.dispatcherTokenFile);
  if (!existsSync(file)) throw new ConfigError(`No dispatcher token at ${file}.`);
  const token = readFileSync(file, "utf8").trim();
  if (!token) throw new ConfigError(`Dispatcher token file ${file} is empty.`);
  return token;
}
