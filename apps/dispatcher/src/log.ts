// Logs go to stderr. Under systemd, journald reads the <N> prefix as the
// syslog priority, so `journalctl --user -u momos-dispatcher -p warning` works.

const underJournal = !!process.env.JOURNAL_STREAM;

function format(parts: unknown[]): string {
  return parts
    .map((p) => {
      if (typeof p === "string") return p;
      if (p instanceof Error) return p.message;
      try {
        return JSON.stringify(p);
      } catch {
        return String(p);
      }
    })
    .join(" ");
}

function write(priority: number, parts: unknown[]) {
  const msg = format(parts);
  for (const line of msg.split("\n")) {
    process.stderr.write(underJournal ? `<${priority}>${line}\n` : `${new Date().toISOString()} ${line}\n`);
  }
}

export const log = {
  error: (...p: unknown[]) => write(3, p),
  warn: (...p: unknown[]) => write(4, p),
  info: (...p: unknown[]) => write(6, p),
  debug: (...p: unknown[]) => {
    if (process.env.MOMOS_DEBUG) write(7, p);
  },
};
