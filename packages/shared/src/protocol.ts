import { z } from "zod";

// momctl talks to momd over a Unix socket at $XDG_RUNTIME_DIR/momos/momd.sock.
// One JSON object per line in each direction. momctl sends a Request and reads
// one Response, then closes.

export const Request = z.object({
  cmd: z.string(),
  args: z.record(z.string(), z.unknown()).default({}),
});
export type Request = z.infer<typeof Request>;

export const Response = z.union([
  z.object({ ok: z.literal(true), data: z.unknown() }),
  z.object({ ok: z.literal(false), error: z.string() }),
]);
export type Response = z.infer<typeof Response>;

export function runtimeDir(env: Record<string, string | undefined> = process.env): string {
  const base = env.XDG_RUNTIME_DIR ?? `/run/user/${process.getuid?.() ?? 1000}`;
  return `${base}/momos`;
}

export function configDir(env: Record<string, string | undefined> = process.env): string {
  const base = env.XDG_CONFIG_HOME ?? `${env.HOME}/.config`;
  return `${base}/momos`;
}

export function dataDir(env: Record<string, string | undefined> = process.env): string {
  const base = env.XDG_DATA_HOME ?? `${env.HOME}/.local/share`;
  return `${base}/momos`;
}

export const paths = {
  socket: () => `${runtimeDir()}/momd.sock`,
  state: () => `${runtimeDir()}/state.json`,
  config: () => `${configDir()}/config.json`,
  photos: () => `${configDir()}/photos`,
  reminders: () => `${configDir()}/reminders.json`,
  slideshow: () => `${dataDir()}/slideshow`,
  deviceToken: () => `${configDir()}/device-token`,
  db: () => `${dataDir()}/momd.sqlite`,
  screenshots: () => `${dataDir()}/screenshots`,
};

// The longest note a help request carries, such as "screen was off". The note
// says why no fresh screenshot went with it. Longer notes are cut to fit.
export const HELP_NOTE_MAX = 200;

export function helpNote(note: string | null | undefined): string | undefined {
  const n = note?.trim();
  if (!n) return undefined;
  return n.length > HELP_NOTE_MAX ? `${n.slice(0, HELP_NOTE_MAX - 3)}...` : n;
}
