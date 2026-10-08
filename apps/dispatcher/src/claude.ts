import { mkdirSync } from "node:fs";
import type { Phase } from "./jobs";
import { log } from "./log";

// How the dispatcher starts Claude Code headless. Checked against
// `claude --help` for v2.1.282.
//
// The agent's reach is set by three things together:
//   --tools            which built-in tools exist at all (Bash, Read, Glob, Grep)
//   --allowedTools     which calls run without asking: only listed `mom`
//                      subcommands, and reads under a few directories
//   --permission-mode dontAsk
//                      anything not allowed is denied, since nobody is there
//                      to answer a prompt
// --setting-sources project,local, run from an empty work directory, keeps
// the helper's own ~/.claude/settings.json (auto mode, their allow rules) out of it.

// Read-only mom subcommands for investigating.
export const INVESTIGATE_COMMANDS = ["status", "screenshot", "apps", "logs", "health", "wifi", "devices", "help-requests", "jobs"] as const;

// What a fix may add. Each is something the helper could do from the admin app or
// her own screen: open and reload things, type and click, restart her
// session's services, unlock. Deliberately left out:
//   ssh     a root shell (passwordless sudo) would make every other limit
//           meaningless; fixes that need root go back to the helper in the report
//   deploy, update
//           reinstall or reboot her machine; the helper runs those
//   lock    locking her out is never a fix
//   vnc     opens a window on the dispatcher machine, useless to an agent
export const FIX_EXTRA_COMMANDS = ["open", "reload", "home", "say", "click", "type", "key", "restart", "volume", "unlock"] as const;

export const DENIED_RULES = [
  "Bash(mom ssh)",
  "Bash(mom ssh *)",
  "Bash(mom deploy *)",
  "Bash(mom update *)",
  "Bash(mom init *)",
  // `mom wifi` and `mom wifi scan` only look. Joining or forgetting a network
  // could cut the laptop off, and the helper along with it; opening a
  // sign-in page acts on her screen.
  "Bash(mom wifi connect *)",
  "Bash(mom wifi forget *)",
  "Bash(mom wifi portal open)",
  "Bash(mom wifi portal open *)",
  "Bash(ssh *)",
  "Bash(sudo *)",
];

export function momRules(commands: readonly string[]): string[] {
  return commands.flatMap((c) => [`Bash(mom ${c})`, `Bash(mom ${c} *)`]);
}

// Permission rules take `//` for absolute paths. Read rules also cover Glob
// and Grep.
export function readRules(dirs: string[]): string[] {
  return dirs.map((d) => `Read(/${d.replace(/\/+$/, "")}/**)`);
}

export function allowedTools(phase: Phase, readDirs: string[]): string[] {
  const commands = phase === "investigate" ? [...INVESTIGATE_COMMANDS] : [...INVESTIGATE_COMMANDS, ...FIX_EXTRA_COMMANDS];
  return [...momRules(commands), ...readRules(readDirs)];
}

export interface ClaudeArgsOptions {
  phase: Phase;
  prompt: string;
  systemPrompt: string;
  // A new session for investigate (so we know the id even on timeout), the
  // stored one for fix.
  sessionId: string;
  // Investigate by resuming sessionId ("Investigate more") instead of
  // starting it.
  resume?: boolean;
  // Directories the agent may read: the screenshot cache, the repo.
  readDirs: string[];
  model?: string | null;
}

export function buildClaudeArgs(o: ClaudeArgsOptions): string[] {
  const args = ["-p", o.prompt, "--output-format", "json"];
  if (o.phase === "investigate" && !o.resume) args.push("--session-id", o.sessionId);
  else args.push("--resume", o.sessionId);
  args.push(
    "--append-system-prompt", o.systemPrompt,
    "--tools", "Bash,Read,Glob,Grep",
    "--permission-mode", "dontAsk",
    "--permission-prompts", "none",
    "--setting-sources", "project,local",
    "--strict-mcp-config",
    "--disable-slash-commands",
    "--no-chrome",
  );
  if (o.model) args.push("--model", o.model);
  for (const d of o.readDirs) args.push("--add-dir", d);
  // Variadic flags go last so they can't swallow anything after them.
  args.push("--disallowedTools", ...DENIED_RULES);
  args.push("--allowedTools", ...allowedTools(o.phase, o.readDirs));
  return args;
}

export interface RunOptions {
  bin: string;
  args: string[];
  cwd: string;
  env: Record<string, string | undefined>;
  timeoutMs: number;
  signal?: AbortSignal;
}

export interface RunOutcome {
  code: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  aborted: boolean;
}

export async function runClaude(o: RunOptions): Promise<RunOutcome> {
  mkdirSync(o.cwd, { recursive: true });
  const proc = Bun.spawn([o.bin, ...o.args], {
    cwd: o.cwd,
    env: o.env,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  let timedOut = false;
  let aborted = false;
  const stop = () => {
    proc.kill("SIGTERM");
    setTimeout(() => {
      if (proc.exitCode === null) proc.kill("SIGKILL");
    }, 10_000).unref();
  };
  const timer = setTimeout(() => {
    timedOut = true;
    log.warn(`claude ran past ${Math.round(o.timeoutMs / 60000)} min, stopping it`);
    stop();
  }, o.timeoutMs);
  const onAbort = () => {
    aborted = true;
    stop();
  };
  o.signal?.addEventListener("abort", onAbort);
  try {
    const [stdout, stderr, code] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    return { code, stdout, stderr, timedOut, aborted };
  } finally {
    clearTimeout(timer);
    o.signal?.removeEventListener("abort", onAbort);
  }
}
