import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { ResolvedDevice } from "./config";
import { expandHome } from "./config";
import { shellQuote, sshArgs } from "./ssh";

// `mom devices create <name>`: make a device and its token in Convex without
// the admin app. Runs `npx convex run provision:createDevice` in
// packages/backend, so it needs a checkout that's linked to the deployment
// (packages/backend/.env.local) and a logged-in Convex CLI. --prod passes
// --prod along, for the project's production deployment.

export interface Created {
  deviceId: string;
  token: string;
}

// Config files may be JSONC with whole-line // comments, like config/example.jsonc.
export function readJsonc(path: string): unknown {
  const text = readFileSync(expandHome(path), "utf8")
    .split("\n")
    .filter((l) => !/^\s*\/\//.test(l))
    .join("\n");
  return JSON.parse(text);
}

// --prod runs against the project's production deployment instead of the one
// in packages/backend/.env.local.
export function convexRunArgv(fn: string, args: unknown, o: { prod?: boolean } = {}): string[] {
  return ["npx", "convex", "run", ...(o.prod ? ["--prod"] : []), fn, JSON.stringify(args)];
}

// `npx convex run` prints the return value as JSON, possibly after log lines.
export function parseRunOutput(stdout: string): unknown {
  const text = stdout.trim();
  const start = text.search(/^[[{]/m);
  if (start < 0) throw new Error(`convex run printed no JSON: ${text.slice(0, 200)}`);
  return JSON.parse(text.slice(start));
}

export async function convexRun(repo: string, fn: string, args: unknown, o: { prod?: boolean } = {}): Promise<unknown> {
  const cwd = join(repo, "packages", "backend");
  if (!existsSync(join(cwd, ".env.local")) && !process.env.CONVEX_DEPLOYMENT && !(o.prod && process.env.CONVEX_DEPLOY_KEY)) {
    throw new Error(
      `${cwd}/.env.local is missing. Run \`npx convex dev --once\` there first, or set CONVEX_DEPLOYMENT${o.prod ? " or CONVEX_DEPLOY_KEY" : ""}.`,
    );
  }
  const proc = Bun.spawn(convexRunArgv(fn, args, o), { cwd, stdin: "ignore", stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (code !== 0) {
    const detail = (stderr.trim() || stdout.trim()).split("\n").filter((l) => !/ExperimentalWarning|trace-warnings/.test(l)).slice(-4).join("\n");
    throw new Error(`npx convex run ${fn} failed (exit ${code}): ${detail}`);
  }
  return parseRunOutput(stdout);
}

export async function createDevice(repo: string, name: string, settingsFile: string | null, o: { prod?: boolean } = {}): Promise<Created> {
  const args: Record<string, unknown> = { name };
  if (settingsFile) args.settings = readJsonc(settingsFile);
  const r = (await convexRun(repo, "provision:createDevice", args, o)) as Partial<Created>;
  if (typeof r?.deviceId !== "string" || typeof r?.token !== "string") throw new Error("convex run returned no device");
  return { deviceId: r.deviceId, token: r.token };
}

// Write the token to ~<person>/.config/momos/device-token on the laptop, mode
// 600 and owned by the person. The token goes over stdin, never on a command line.
export function installTokenCommand(person: string): string {
  const q = shellQuote(person);
  return [
    `home=$(getent passwd ${q} | cut -d: -f6)`,
    `[ -n "$home" ] || { echo "no user ${person}" >&2; exit 1; }`,
    `sudo install -d -m 700 -o ${q} -g "$(id -gn ${q})" "$home/.config/momos"`,
    `sudo install -m 600 -o ${q} -g "$(id -gn ${q})" /dev/stdin "$home/.config/momos/device-token"`,
  ].join(" && ");
}

export async function installToken(device: ResolvedDevice, token: string): Promise<void> {
  const proc = Bun.spawn(["ssh", ...sshArgs(device, installTokenCommand(device.user))], {
    stdin: new TextEncoder().encode(`${token}\n`),
    stdout: "inherit",
    stderr: "inherit",
  });
  const code = await proc.exited;
  if (code !== 0) throw new Error(`writing the token on ${device.name} failed (exit ${code})`);
}
