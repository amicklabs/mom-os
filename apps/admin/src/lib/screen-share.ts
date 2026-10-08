// Pure helpers for the Screen page. Kept apart from React so they can be
// tested.

export const DEFAULT_MINUTES = 15;
export const MAX_MINUTES = 60;
// How long to wait for the laptop to report a session after Start.
export const START_WAIT_MS = 20_000;

export type Session = { url: string; token: string; control: boolean; expiresAt: number; served: boolean };

// A session counts while its end time hasn't passed.
export function activeSession<T extends Session>(s: T | null | undefined, now: number): T | null {
  return s && s.expiresAt > now ? s : null;
}

// Minutes left, rounded up, at least 1.
export function minutesLeft(s: Pick<Session, "expiresAt">, now: number): number {
  return Math.max(1, Math.ceil((s.expiresAt - now) / 60_000));
}

// Minutes for "Add 15 minutes", capped at the laptop's maximum.
export function extendedMinutes(s: Pick<Session, "expiresAt">, now: number, add = DEFAULT_MINUTES): number {
  return Math.min(MAX_MINUTES, minutesLeft(s, now) + add);
}

// The address that says whether this device reaches the laptop at all.
export function pingUrl(wsUrl: string): string | null {
  const m = /^wss:\/\/([A-Za-z0-9.-]+(?::\d+)?)\//.exec(wsUrl);
  return m ? `https://${m[1]}/ping` : null;
}

// X11 keysyms for typed text, which is what VNC sends. Latin-1 characters are
// their own keysym; everything else is 0x01000000 plus the code point. Newline
// and tab are the Return and Tab keys.
export const KEYSYM = {
  BackSpace: 0xff08,
  Tab: 0xff09,
  Return: 0xff0d,
  Escape: 0xff1b,
  Left: 0xff51,
  Up: 0xff52,
  Right: 0xff53,
  Down: 0xff54,
} as const;

export function keysymFor(ch: string): number | null {
  if (ch === "\n" || ch === "\r") return KEYSYM.Return;
  if (ch === "\t") return KEYSYM.Tab;
  const cp = ch.codePointAt(0);
  if (cp === undefined || cp < 0x20 || cp === 0x7f) return null;
  if (cp <= 0xff) return cp;
  return 0x01000000 + cp;
}

export function keysymsFor(text: string): number[] {
  const out: number[] = [];
  for (const ch of text) {
    const k = keysymFor(ch);
    if (k !== null) out.push(k);
  }
  return out;
}
