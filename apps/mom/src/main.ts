#!/usr/bin/env bun
import { writeFileSync } from "node:fs";
import { ConfigError, configPath, expandHome, loadConfig, resolveDevice, writeStarterConfig, type MomConfig } from "./config";
import { dispatcherOverview, listFrom } from "./convex";
import { deploy, findRepo } from "./deploy";
import { createDevice, installToken } from "./provision";
import { PASSTHROUGH, RemoteError, runMomctl, screenshot } from "./momctl";
import { ago, fail, print } from "./output";
import { sshInteractive } from "./ssh";
import { update } from "./update";
import { launchDetached, noViewerMessage, vncCommand } from "./vnc";
import { doctor, doctorText } from "./doctor";
import { DONE_SECONDS, MAX_NOTICE_MINUTES, NOTICE_MINUTES, sshNoticeWriter, withUpdatingNotice } from "./notice";

const VERSION = "0.1.0";

// `mom restart shell`: the notice shows this long before the screen blinks,
// and stays this long after, while the new shell starts.
const RESTART_NOTICE_LEAD_MS = 3000;
const RESTART_NOTICE_TAIL_MS = 5000;

const USAGE = `mom: see and fix a MomOS laptop from your own machine.

Usage: mom [--device NAME] [--json] <command> [args]

The laptop's screen and apps (momctl on the laptop as the person, over SSH):
  status                      Full state: momd, apps, network, battery
  screenshot [--out FILE]     Take a screenshot and copy it here; prints the path.
                              Nothing shows on the laptop.
  apps                        Open app windows
  open <tile>                 Launch or focus a tile's app
  reload <tile>               Reload a web app or Browser tile's page (F5), or
                              open it if it isn't open. The screen says
                              "<helper> refreshed <tile>." for a few seconds
  home                        Show the home screen
  say "<text>" [--seconds N]  Show a message on the laptop's screen
  lock | unlock               Lock or unlock the screen
  volume up|down|mute         Change the volume
  click <x> <y> [right]       Click at a screen position (left button unless
                              "right")
  type "<text>"               Type text
  key <combo>                 Press a key combination
  press-help [--text T] [--screenshot] [--call-me] [--voice-file F]
                              Send a help request as the Help pop-up does
                              (momctl help). F is an Ogg Opus file on the laptop
  screensaver on|off          Start or stop the screensaver
  screen on|off               Turn the screen on or off (on does nothing while
                              the lid is closed)
  wifi                        Wi-Fi status
  wifi scan [--fresh]         Networks in range, known ones first
  wifi connect <name> [--password-stdin] [--hidden] [--save-only]
                              Join a network and save it, or with --save-only
                              only save it for later. The password is
                              typed at a prompt or piped in, never an argument.
  wifi forget <name> [--force]
                              Delete a saved network (--force if it's in use)
  wifi portal [open]          Check for a hotel-style sign-in page, or open it
  speaker                     Bluetooth, saved speakers and where the sound goes
  speaker scan [--seconds N]  Speakers nearby (10 s). One in pairing mode
                              shows up by name
  speaker connect <address>   Pair if needed, connect, and play the sound on it
  speaker output computer|<address>
                              Play the sound on the laptop or on a speaker,
                              without disconnecting anything
  speaker disconnect <address>
                              Disconnect it; the sound goes back to the laptop
  speaker forget <address>    Unpair it
  logs [--unit momd|shell|wayvnc] [--lines N]
                              Recent logs from the person's session
  restart shell|momd|wayvnc [--no-notice]
                              Restart part of the person's session. For the
                              shell, the updating notice shows (see deploy)
  health                      Battery, disk, DKMS modules, versions

Remote access:
  ssh [command...]            Shell (or one command) as the admin user
  vnc                         Open the laptop's screen in a local VNC viewer

Maintenance:
  deploy [--steps LIST] [--config FILE] [--no-build] [--dry-run]
         [--no-notice]
                              Build momctl and momd, sync the repo to
                              /usr/local/src/momos and run system/install.sh.
                              The screen says "<helper> is updating your
                              computer" meanwhile, unless --no-notice
  doctor [--config FILE]      Check what the first deploy needs: SSH, rsync
                              on both ends, the admin's passwordless sudo and
                              the config file. Prints a fix for each problem.
  update [--yes] [--no-reboot] [--no-notice]
                              Update the system, check the DKMS drivers listed
                              in local.hardware were built, reboot only if
                              they were, then confirm everything came back.
                              Shows the updating notice, as deploy does
  updating on [--minutes N] | done | off
                              Show or clear the updating notice by hand, e.g.
                              around work over \`mom ssh\`. on lasts N minutes
                              (15, at most 20); done says "Done" for a few
                              seconds

Convex (needs convexUrl and the dispatcher token):
  help-requests               Recent help requests
  jobs                        Recent agent jobs

Setup:
  init [--device NAME] [--host HOST] [--user USER] [--admin USER]
       [--helper NAME] [--convex-url URL] [--force]
                              Write a starter ${configPath()}
  devices                     List configured devices
  devices create <name> [--settings FILE] [--install] [--token-out FILE]
                 [--prod]
                              Create a device and its token in Convex (npx
                              convex run, no admin app needed). --settings
                              seeds its settings from a config file.
                              --install writes the token to the person's
                              ~/.config/momos/device-token on the laptop.
                              Otherwise the token is printed once. --prod
                              uses the production deployment instead of the
                              one in packages/backend/.env.local.

Options:
  -d, --device NAME   Which laptop (default: $MOM_DEVICE, defaultDevice, or the only one)
      --json          JSON output (momctl's JSON is passed through as is)
  -h, --help          This help
  -v, --version       Print the version
`;

interface Globals {
  device: string | null;
  json: boolean;
  help: boolean;
  version: boolean;
}

// Pull mom's own flags out of argv wherever they are. Everything else is
// left in order for the command.
export function parseGlobals(argv: string[]): { globals: Globals; rest: string[] } {
  const globals: Globals = { device: null, json: false, help: false, version: false };
  const rest: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--") {
      rest.push(...argv.slice(i + 1));
      break;
    }
    if (a === "--json") globals.json = true;
    else if (a === "-h" || a === "--help") globals.help = true;
    else if ((a === "-v" || a === "--version") && rest.length === 0) globals.version = true;
    else if (a === "-d" || a === "--device") globals.device = argv[++i] ?? null;
    else if (a.startsWith("--device=")) globals.device = a.slice("--device=".length);
    else rest.push(a);
  }
  return { globals, rest };
}

function takeFlag(args: string[], name: string): boolean {
  const i = args.indexOf(name);
  if (i === -1) return false;
  args.splice(i, 1);
  return true;
}

function takeOption(args: string[], name: string): string | null {
  const i = args.indexOf(name);
  if (i !== -1) {
    const v = args[i + 1] ?? null;
    args.splice(i, 2);
    return v;
  }
  const eq = args.findIndex((a) => a.startsWith(`${name}=`));
  if (eq !== -1) {
    const v = args[eq]!.slice(name.length + 1);
    args.splice(eq, 1);
    return v;
  }
  return null;
}

function commandHelp(cmd: string): string | null {
  const lines = USAGE.split("\n");
  const i = lines.findIndex((l) => new RegExp(`^  ${cmd.replace(/[-]/g, "\\-")}\\b`).test(l) || l.includes(`| ${cmd} `));
  if (i === -1) return null;
  const out = [lines[i]!];
  // Continuation lines, and further entries for the same command, like
  // "devices" and "devices create".
  for (let j = i + 1; j < lines.length && (/^ {7,}/.test(lines[j]!) || lines[j]!.startsWith(`  ${cmd} `)); j++) out.push(lines[j]!);
  return `Usage: mom [--device NAME] [--json]\n${out.join("\n")}`;
}

async function confirm(question: string): Promise<boolean> {
  if (!process.stdin.isTTY) return false;
  process.stdout.write(`${question} [y/N] `);
  for await (const line of console) {
    return /^y(es)?$/i.test(line.trim());
  }
  return false;
}

// A Wi-Fi password for `mom wifi connect --password-stdin`: piped in, or typed
// at a prompt with echo off. It reaches the laptop on ssh's stdin.
async function readPassword(): Promise<string> {
  if (!process.stdin.isTTY) return (await Bun.stdin.text()).replace(/\r?\n$/, "");
  const stty = (arg: string) => Bun.spawnSync(["stty", arg], { stdin: "inherit" });
  process.stderr.write("Password: ");
  stty("-echo");
  try {
    for await (const line of console) return line;
    return "";
  } finally {
    stty("echo");
    process.stderr.write("\n");
  }
}

async function main(argv: string[]): Promise<number> {
  const { globals, rest } = parseGlobals(argv);
  const json = globals.json;
  if (globals.version) {
    print(json ? { version: VERSION } : `mom ${VERSION}`, json);
    return 0;
  }
  const cmd = rest.shift();
  if (!cmd || cmd === "help") {
    if (cmd === "help" && rest[0]) {
      process.stdout.write((commandHelp(rest[0]) ?? USAGE) + "\n");
      return 0;
    }
    process.stdout.write(USAGE);
    return cmd || globals.help ? 0 : 1;
  }
  if (globals.help) {
    process.stdout.write((commandHelp(cmd) ?? USAGE) + "\n");
    return 0;
  }

  if (cmd === "init") {
    const force = takeFlag(rest, "--force");
    const path = configPath();
    const config = writeStarterConfig(
      path,
      {
        device: takeOption(rest, "--device") ?? globals.device ?? undefined,
        host: takeOption(rest, "--host") ?? undefined,
        user: takeOption(rest, "--user") ?? undefined,
        admin: takeOption(rest, "--admin") ?? undefined,
        convexUrl: takeOption(rest, "--convex-url") ?? undefined,
        helper: takeOption(rest, "--helper") ?? undefined,
      },
      force,
    );
    print(json ? { path, config } : `Wrote ${path}. Edit the device entry, then try \`mom status\`.`, json);
    return 0;
  }

  const config: MomConfig = loadConfig();

  if (cmd === "devices" && rest[0] === "create") {
    rest.shift();
    const settingsFile = takeOption(rest, "--settings");
    const tokenOut = takeOption(rest, "--token-out");
    const install = takeFlag(rest, "--install");
    const prod = takeFlag(rest, "--prod");
    const name = rest.shift();
    if (!name) fail("Usage: mom devices create <name> [--settings FILE] [--install] [--token-out FILE] [--prod]", json, 2);
    const repo = findRepo(config);
    if (!repo) fail("Can't find the mom-os checkout. Run from inside it or set repoDir in mom.json.", json);
    // Resolve the laptop before creating anything, so --install can't leave
    // an orphaned device behind a config mistake.
    const target = install ? resolveDevice(config, globals.device ?? (config.devices[name] ? name : null)) : null;
    const created = await createDevice(repo, name, settingsFile, { prod });
    const where: string[] = [];
    if (tokenOut) {
      writeFileSync(expandHome(tokenOut), `${created.token}\n`, { mode: 0o600 });
      where.push(expandHome(tokenOut));
    }
    if (target) {
      await installToken(target, created.token);
      where.push(`${target.name}:~${target.user}/.config/momos/device-token`);
    }
    const shown = where.length ? { deviceId: created.deviceId, tokenWrittenTo: where } : created;
    print(json ? shown : where.length ? `Created ${name} (${created.deviceId}). Token written to ${where.join(", ")}.` : shown, json);
    return 0;
  }

  if (cmd === "devices") {
    const rows = Object.entries(config.devices).map(([name, d]) => ({
      name,
      default: name === (config.defaultDevice ?? (Object.keys(config.devices).length === 1 ? name : null)),
      host: d.host,
      person: d.user,
      admin: d.adminUser,
      vnc: `${d.vncHost ?? d.host}:${d.vncPort}`,
    }));
    print(rows, json);
    return 0;
  }

  if (cmd === "help-requests" || cmd === "jobs") {
    const overview = await dispatcherOverview(config);
    const list =
      cmd === "jobs" ? listFrom(overview, "jobs", "recentJobs") : listFrom(overview, "helpRequests", "openHelpRequests");
    if (json) {
      print(list, true);
      return 0;
    }
    const rows = list.map((item) => {
      const o = item as Record<string, unknown>;
      const at = typeof o.createdAt === "number" ? ago(o.createdAt) : undefined;
      return cmd === "jobs"
        ? { id: o._id, kind: o.kind, status: o.status, created: at, prompt: o.prompt }
        : { id: o._id, status: o.status, created: at, device: o.deviceName ?? o.deviceId };
    });
    print(rows.length ? rows : cmd === "jobs" ? "No jobs." : "No help requests.", false);
    return 0;
  }

  const device = resolveDevice(config, globals.device);

  if (cmd === "ssh") {
    // Like plain ssh: the words are joined and the remote shell parses them.
    const remote = rest.length ? rest.join(" ") : null;
    return await sshInteractive(device, remote, { tty: remote === null || process.stdin.isTTY === true, batch: false });
  }

  if (cmd === "vnc") {
    const launch = vncCommand(device);
    if (!launch) fail(noViewerMessage(), json);
    launchDetached(launch.argv);
    print(json ? { ok: true, viewer: launch.viewer, argv: launch.argv } : `Opened ${launch.viewer} for ${device.name}. The laptop shows a banner while you're connected.`, json);
    return 0;
  }

  if (cmd === "screenshot") {
    const out = takeOption(rest, "--out");
    const r = await screenshot(device, out ?? undefined);
    // On stderr, so stdout stays just the path for scripts.
    if (!json && r.screenWoken) process.stderr.write("(woke the screen)\n");
    print(json ? r : r.path, json);
    return 0;
  }

  if (cmd === "doctor") {
    const configFile = takeOption(rest, "--config") ?? device.configFile ?? null;
    const checks = await doctor(device, configFile);
    const ok = checks.every((c) => c.ok !== false);
    print(json ? { ok, checks } : doctorText(checks), json);
    return ok ? 0 : 1;
  }

  if (cmd === "deploy") {
    const steps = takeOption(rest, "--steps") ?? "all";
    const configFile = takeOption(rest, "--config") ?? device.configFile ?? null;
    const build = !takeFlag(rest, "--no-build");
    const dryRun = takeFlag(rest, "--dry-run");
    const notice = !takeFlag(rest, "--no-notice");
    if (!configFile) fail(`No personal config to send. Pass --config FILE or set devices.${device.name}.configFile in mom.json.`, json);
    const repo = findRepo(config);
    if (!repo) fail("Can't find the mom-os checkout. Run from inside it or set repoDir in mom.json.", json);
    const log = (s: string) => process.stderr.write(`${s}\n`);
    const run = () => deploy(repo, device, { steps, configFile, build }, dryRun, log);
    if (dryRun && notice) log(`notice: ${device.name} would show "<helper> is updating your computer" while this runs (--no-notice to skip)`);
    const code = notice && !dryRun
      ? await withUpdatingNotice({ write: sshNoticeWriter(device), log, ok: (c) => c === 0 }, run)
      : await run();
    if (json) print({ ok: code === 0, exitCode: code }, true);
    return code;
  }

  if (cmd === "update") {
    const yes = takeFlag(rest, "--yes") || takeFlag(rest, "-y");
    const reboot = !takeFlag(rest, "--no-reboot");
    const notice = !takeFlag(rest, "--no-notice");
    if (!yes && !(await confirm(`Update ${device.name} (${device.host}) now? It may reboot.`))) {
      fail("Not confirmed. Pass --yes to run without asking.", json);
    }
    const log = (s: string) => process.stderr.write(`${s}\n`);
    const run = () => update(device, { reboot, log });
    const report = notice ? await withUpdatingNotice({ write: sshNoticeWriter(device), log, ok: (r) => r.ok }, run) : await run();
    if (json) print(report, true);
    else {
      print(
        {
          result: report.ok ? "Update finished and everything came back." : "Update needs attention.",
          kernel: report.kernelAfter ? `${report.kernelBefore} -> ${report.kernelAfter}` : report.kernelBefore,
          rebooted: report.rebooted ? "yes" : "no",
          problems: report.problems,
        },
        false,
      );
    }
    return report.ok ? 0 : 1;
  }

  if (cmd === "updating") {
    const op = rest.shift();
    const minutes = Number(takeOption(rest, "--minutes") ?? NOTICE_MINUTES);
    if ((op !== "on" && op !== "done" && op !== "off") || !(minutes >= 1 && minutes <= MAX_NOTICE_MINUTES)) {
      fail(`Usage: mom updating on [--minutes N] | done | off  (N from 1 to ${MAX_NOTICE_MINUTES})`, json, 2);
    }
    const write = sshNoticeWriter(device);
    const ok = await write(
      op === "on" ? { op: "updating", seconds: minutes * 60 } : op === "done" ? { op: "done", seconds: DONE_SECONDS } : { op: "clear" },
    );
    if (!ok) fail(`Couldn't reach ${device.name} to change the notice.`, json);
    const said = op === "on" ? `for up to ${minutes} minutes` : op === "done" ? `"Done" for ${DONE_SECONDS} seconds` : "off";
    print(json ? { ok: true, notice: op } : `Updating notice on ${device.name}: ${said}.`, json);
    return 0;
  }

  // Restarting the shell blanks her screen for a moment, so she's told first.
  if (cmd === "restart") {
    const notice = !takeFlag(rest, "--no-notice") && rest[0] === "shell";
    const run = async () => {
      if (notice) await Bun.sleep(RESTART_NOTICE_LEAD_MS);
      const r = await runMomctl(device, ["restart", ...rest]);
      // Leave the notice up while the new shell starts and reads it.
      if (notice && r.code === 0) await Bun.sleep(RESTART_NOTICE_TAIL_MS);
      return r;
    };
    const log = (s: string) => process.stderr.write(`${s}\n`);
    const r = notice ? await withUpdatingNotice({ write: sshNoticeWriter(device), log, ok: () => true, done: false }, run) : await run();
    if (json) process.stdout.write(r.raw.trim() ? (r.raw.endsWith("\n") ? r.raw : `${r.raw}\n`) : `${JSON.stringify({ ok: r.code === 0 })}\n`);
    else {
      if (r.data !== null) print(r.data, false);
      if (r.code !== 0 && r.stderr.trim()) process.stderr.write(r.stderr);
    }
    return r.code;
  }

  const momctlCmd = PASSTHROUGH[cmd];
  if (!momctlCmd) fail(`Unknown command "${cmd}". Run \`mom --help\`.`, json, 2);
  const stdin = momctlCmd === "wifi" && rest.includes("--password-stdin") ? await readPassword() : undefined;
  const r = await runMomctl(device, [momctlCmd, ...rest], { stdin });
  if (json) {
    if (r.raw.trim()) process.stdout.write(r.raw.endsWith("\n") ? r.raw : `${r.raw}\n`);
    else print({ ok: r.code === 0, error: r.stderr.trim() || null }, true);
  } else {
    if (r.data !== null) print(r.data, false);
    if (r.code !== 0 && r.stderr.trim()) process.stderr.write(r.stderr);
  }
  return r.code;
}

if (import.meta.main) {
  const json = process.argv.includes("--json");
  main(process.argv.slice(2))
    .then((code) => process.exit(code))
    .catch((e: unknown) => {
      if (e instanceof ConfigError) fail(e.message, json, 2);
      if (e instanceof RemoteError) fail(e.message, json, e.code || 1);
      fail(e instanceof Error ? e.message : String(e), json);
    });
}
