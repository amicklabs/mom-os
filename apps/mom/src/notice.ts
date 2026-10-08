import type { ResolvedDevice } from "./config";
import { asPersonCommand, sshCapture } from "./ssh";

// The "updating" notice on her screen: "Sam is updating your computer. It
// will be back in a minute." `mom deploy`, `mom update` and `mom restart shell`
// write a marker file in her state directory before they start and remove it
// when they end. The shell shows the notice while the marker is fresh, and
// reads it again when it starts, so the notice survives the shell restarting
// and, for `mom update`, a reboot. docs/contracts.md has the format.

// Relative to her home. Under XDG state, not the runtime directory, so it
// outlives a reboot.
export const UPDATING_FILE = ".local/state/momos/updating.json";

// Each write lasts this long. A heartbeat rewrites it while the command runs,
// so a lost connection leaves it up for 15 minutes at most.
export const NOTICE_MINUTES = 15;
export const HEARTBEAT_MS = 4 * 60_000;
// "Done. Your computer is up to date." shows this long after a success.
export const DONE_SECONDS = 8;
// The shell and momos-idle ignore a marker that claims to last longer than
// this, which also catches a clock that jumped backwards.
export const MAX_NOTICE_MINUTES = 20;

export type NoticeOp = { op: "updating"; seconds: number } | { op: "done"; seconds: number } | { op: "clear" };

// POSIX sh, run as her. The expiry uses the laptop's clock, so a helper
// machine with the wrong time can't make it wrong. Temp file, then rename.
export const NOTICE_SCRIPT = `
file="$HOME/${UPDATING_FILE}"
if [ "$1" = clear ]; then rm -f -- "$file"; exit 0; fi
mkdir -p -- "\${file%/*}"
now=$(date +%s%3N)
case $now in *N) now=$(( $(date +%s) * 1000 ));; esac
printf '{"version":1,"state":"%s","at":%s,"expiresAt":%s}\\n' "$1" "$now" "$((now + $2 * 1000))" >"$file.tmp"
mv -f -- "$file.tmp" "$file"
`.trim();

export function noticeCommand(person: string, o: NoticeOp): string {
  const args = o.op === "clear" ? ["clear"] : [o.op, String(Math.round(o.seconds))];
  return asPersonCommand(person, ["sh", "-c", NOTICE_SCRIPT, "momos-notice", ...args]);
}

// Writes or removes the marker. Returns false, never throws, when the laptop
// can't be reached or her account doesn't exist yet (a first deploy).
export type NoticeWriter = (o: NoticeOp) => Promise<boolean>;

export function sshNoticeWriter(device: ResolvedDevice): NoticeWriter {
  return async (o) => {
    try {
      const r = await sshCapture(device, noticeCommand(device.user, o), { connectTimeout: 10 });
      return r.code === 0;
    } catch {
      return false;
    }
  };
}

export interface NoticeOptions<T> {
  write: NoticeWriter;
  log: (s: string) => void;
  // Whether the command worked, for "Done." rather than just clearing.
  ok: (result: T) => boolean;
  // Say "Done. Your computer is up to date." after a success. Off for a shell
  // restart, which updates nothing.
  done?: boolean;
  heartbeatMs?: number;
  // For tests: signals to clear on. Default SIGINT, SIGTERM and SIGHUP.
  signals?: NodeJS.Signals[];
  exit?: (code: number) => void;
}

const SIGNAL_EXIT: Record<string, number> = { SIGINT: 130, SIGTERM: 143, SIGHUP: 129 };

// Runs fn with the notice up. It's cleared on success (or turned into "Done."),
// on failure, on an exception, and on Ctrl-C, SIGTERM or a closed terminal.
// If even that fails, the marker expires by itself.
export async function withUpdatingNotice<T>(o: NoticeOptions<T>, fn: () => Promise<T>): Promise<T> {
  // One write at a time, in order, so a slow heartbeat can't land after the
  // final clear and put the notice back.
  let chain: Promise<boolean> = Promise.resolve(true);
  const send = (op: NoticeOp) => (chain = chain.then(() => o.write(op), () => o.write(op)));

  const updating: NoticeOp = { op: "updating", seconds: NOTICE_MINUTES * 60 };
  if (!(await send(updating))) {
    o.log("Couldn't put the updating notice on the laptop's screen. Carrying on without it.");
  }
  let cleared = false;
  const heartbeat = setInterval(() => {
    if (!cleared) void send(updating);
  }, o.heartbeatMs ?? HEARTBEAT_MS);

  const finish = async (success: boolean) => {
    if (cleared) return;
    cleared = true;
    clearInterval(heartbeat);
    const wrote = success && o.done !== false
      ? await send({ op: "done", seconds: DONE_SECONDS })
      : await send({ op: "clear" });
    if (!wrote) o.log(`Couldn't take the updating notice off the laptop's screen. It goes by itself within ${NOTICE_MINUTES} minutes.`);
  };

  const exit = o.exit ?? ((code: number) => process.exit(code));
  const signals = o.signals ?? ["SIGINT", "SIGTERM", "SIGHUP"];
  let interrupted = false;
  const onSignal = (sig: NodeJS.Signals) => {
    // A second Ctrl-C while clearing leaves at once.
    if (interrupted) return exit(SIGNAL_EXIT[sig] ?? 1);
    interrupted = true;
    void finish(false).finally(() => exit(SIGNAL_EXIT[sig] ?? 1));
  };
  for (const s of signals) process.on(s, onSignal);

  try {
    const result = await fn();
    await finish(o.ok(result));
    return result;
  } catch (e) {
    await finish(false);
    throw e;
  } finally {
    for (const s of signals) process.off(s, onSignal);
  }
}
