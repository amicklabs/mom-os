import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { expandHome, type MomConfig, type ResolvedDevice } from "./config";
import { rsyncShell, shellQuote, sshArgs, sshInteractive } from "./ssh";

// `mom deploy`: build the laptop binaries into dist/deploy/bin, sync them and
// the parts of the repo the laptop needs to /usr/local/src/momos (binaries in
// /usr/local/src/momos/bin), send the personal config to /etc/momos, then run
// system/install.sh there. Its "binaries" step copies the binaries to
// /usr/local/bin.

export const REMOTE_SRC = "/usr/local/src/momos";
// install.sh's default --config, so running it by hand on the laptop reads the
// same file.
export const REMOTE_CONFIG = "/etc/momos/config.json";

// "all" or a comma- or space-separated list: "shell,binaries" or "shell binaries".
export function parseSteps(steps: string): string[] {
  const list = steps.split(/[\s,]+/).filter(Boolean);
  for (const s of list) {
    if (!/^[a-z][a-z-]*$/.test(s)) throw new Error(`bad step name "${s}"`);
  }
  if (list.length === 0) throw new Error("no install steps given");
  return list;
}
export const LAPTOP_APPS = ["momctl", "momd"] as const;
// The laptop is an x86_64 Haswell. The baseline build runs on any x86_64.
export const LAPTOP_TARGET = "bun-linux-x64-baseline";

export function findRepo(config: MomConfig, cwd = process.cwd()): string | null {
  if (config.repoDir) return resolve(expandHome(config.repoDir));
  let dir = resolve(cwd);
  for (;;) {
    if (existsSync(join(dir, "PLAN.md")) && existsSync(join(dir, "pnpm-workspace.yaml"))) return dir;
    const up = dirname(dir);
    if (up === dir) return null;
    dir = up;
  }
}

export function appEntry(appDir: string, name: string): string | null {
  const pkgPath = join(appDir, "package.json");
  const candidates: string[] = [];
  if (existsSync(pkgPath)) {
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as { bin?: string | Record<string, string>; main?: string; module?: string };
    if (typeof pkg.bin === "string") candidates.push(pkg.bin);
    else if (pkg.bin?.[name]) candidates.push(pkg.bin[name]);
    if (pkg.module) candidates.push(pkg.module);
    if (pkg.main) candidates.push(pkg.main);
  }
  candidates.push("src/main.ts", "src/index.ts", "src/cli.ts", `src/${name}.ts`);
  for (const c of candidates) {
    const p = join(appDir, c);
    if (existsSync(p) && /\.(ts|js|mjs)$/.test(p)) return p;
  }
  return null;
}

export interface DeployPlan {
  builds: { app: string; argv: string[]; cwd: string }[];
  rsync: string[][];
  configPush: { local: string; remote: string } | null;
  install: string;
  skipped: string[];
}

export interface DeployOptions {
  steps: string;
  configFile: string | null;
  build: boolean;
}

export function planDeploy(repo: string, device: ResolvedDevice, o: DeployOptions): DeployPlan {
  const outDir = join(repo, "dist", "deploy");
  const skipped: string[] = [];
  const builds: DeployPlan["builds"] = [];
  if (o.build) {
    for (const app of LAPTOP_APPS) {
      const dir = join(repo, "apps", app);
      const entry = existsSync(dir) ? appEntry(dir, app) : null;
      if (!entry) {
        skipped.push(`apps/${app} (no entry point found)`);
        continue;
      }
      builds.push({
        app,
        cwd: dir,
        argv: ["bun", "build", "--compile", "--minify", `--target=${LAPTOP_TARGET}`, entry, "--outfile", join(outDir, "bin", app)],
      });
    }
  }

  // With -R, the "/./" marks where the path on the laptop starts.
  const sources: string[] = [];
  for (const part of ["system", "shell", "config/example.jsonc", "AGENTS.md"]) {
    if (existsSync(join(repo, part))) sources.push(`${repo}/./${part}`);
    else skipped.push(part);
  }
  if (o.build || existsSync(join(outDir, "bin"))) sources.push(`${outDir}/./bin`);

  // No -p, -o or -g: files land owned by root with their source mode masked
  // by root's umask, which keeps exec bits and drops group and other write.
  // That also works with the old rsync macOS ships, which lacks --chown.
  const rsync: string[][] = [[
    "rsync", "-rltR", "--delete", "-e", rsyncShell(device),
    `--rsync-path=sudo mkdir -p ${REMOTE_SRC} && sudo rsync`,
    ...sources, `${device.adminUser}@${device.host}:${REMOTE_SRC}/`,
  ]];
  // The personal config goes over plain ssh so it can be written mode 0600.
  const configPush = o.configFile
    ? {
        local: expandHome(o.configFile),
        // install -D reading /dev/stdin writes the file in place.
        remote: ["sudo", "install", "-D", "-m", "600", "-o", "root", "-g", "root", "/dev/stdin", REMOTE_CONFIG].map(shellQuote).join(" "),
      }
    : null;

  const install = ["sudo", `${REMOTE_SRC}/system/install.sh`, "--config", REMOTE_CONFIG, ...parseSteps(o.steps)]
    .map(shellQuote)
    .join(" ");
  return { builds, rsync, configPush, install, skipped };
}

async function run(argv: string[], cwd?: string): Promise<number> {
  const proc = Bun.spawn(argv, { cwd, stdin: "inherit", stdout: "inherit", stderr: "inherit" });
  return await proc.exited;
}

export async function deploy(repo: string, device: ResolvedDevice, o: DeployOptions, dryRun: boolean, log: (s: string) => void): Promise<number> {
  const plan = planDeploy(repo, device, o);
  for (const s of plan.skipped) log(`skipping ${s}`);
  if (dryRun) {
    for (const b of plan.builds) log(`build: ${b.argv.map(shellQuote).join(" ")}`);
    for (const r of plan.rsync) log(`sync:  ${r.map(shellQuote).join(" ")}`);
    if (plan.configPush) log(`config: ${plan.configPush.local} -> ${REMOTE_CONFIG}`);
    log(`run:   ssh ${sshArgs(device, plan.install, { tty: true }).map(shellQuote).join(" ")}`);
    return 0;
  }
  mkdirSync(join(repo, "dist", "deploy", "bin"), { recursive: true });
  for (const b of plan.builds) {
    log(`Building ${b.app} for the laptop`);
    const code = await run(b.argv, b.cwd);
    if (code !== 0) {
      log(`Build of ${b.app} failed (exit ${code}). Nothing was sent.`);
      return code;
    }
  }
  for (const r of plan.rsync) {
    log(`Syncing to ${device.name}:${REMOTE_SRC}`);
    const code = await run(r);
    if (code !== 0) {
      log(`rsync failed (exit ${code}). install.sh was not run.`);
      return code;
    }
  }
  if (plan.configPush) {
    log(`Sending ${plan.configPush.local} to ${REMOTE_CONFIG}`);
    const proc = Bun.spawn(["ssh", ...sshArgs(device, plan.configPush.remote)], {
      stdin: Bun.file(plan.configPush.local),
      stdout: "inherit",
      stderr: "inherit",
    });
    const code = await proc.exited;
    if (code !== 0) {
      log(`Sending the config failed (exit ${code}). install.sh was not run.`);
      return code;
    }
  }
  log(`Running install.sh ${parseSteps(o.steps).join(" ")} on ${device.name}`);
  return await sshInteractive(device, plan.install, { tty: true });
}
