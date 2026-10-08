import { z } from "zod";

// What she asked for in the Help pop-up. One request can carry several: her
// words with a picture of her screen, say, or a voice note and a request to
// call.
//   message     her typed words
//   screenshot  a picture of the screen behind the pop-up
//   call-me     she asked the helper to call her
//   voice       a voice note, up to VOICE_MAX_SECONDS, as Ogg Opus
export const HelpKind = z.enum(["message", "screenshot", "call-me", "voice"]);
export type HelpKind = z.infer<typeof HelpKind>;

// The longest text she can type in the pop-up. Telegram's message limit is
// 4096, and the rest of the message needs room.
export const HELP_TEXT_MAX = 1000;
export const VOICE_MAX_SECONDS = 60;
// A minute of Opus at 32 kbit/s is about 240 kB. Anything bigger than this
// isn't one of ours.
export const VOICE_MAX_BYTES = 2 * 1024 * 1024;

// The `help` socket command's arguments (momctl help --text ... --screenshot
// --call-me --voice). All optional: a bare `momctl help` is a plain press.
export const HelpArgs = z.object({
  text: z.string().max(HELP_TEXT_MAX * 4).optional(),
  screenshot: z.boolean().optional(),
  callMe: z.boolean().optional(),
  // Send the voice note being recorded (it's stopped first) or just recorded.
  voice: z.boolean().optional(),
  // Send this Ogg Opus file as the voice note instead, for testing.
  voiceFile: z.string().max(4096).optional(),
});
export type HelpArgs = z.infer<typeof HelpArgs>;

// Her words, trimmed and cut to fit, or undefined when there are none.
export function helpText(text: string | null | undefined): string | undefined {
  const t = text?.replace(/\r\n?/g, "\n").trim();
  if (!t) return undefined;
  return t.length > HELP_TEXT_MAX ? `${t.slice(0, HELP_TEXT_MAX - 3)}...` : t;
}

// Which kinds a request carries, in a fixed order.
export function helpKinds(r: { text?: string | null; screenshot?: boolean; callMe?: boolean; voice?: boolean }): HelpKind[] {
  const kinds: HelpKind[] = [];
  if (helpText(r.text)) kinds.push("message");
  if (r.screenshot) kinds.push("screenshot");
  if (r.callMe) kinds.push("call-me");
  if (r.voice) kinds.push("voice");
  return kinds;
}

// How many of the ring buffer's pictures the `recent-screens` action sends:
// one a minute, so the last ten minutes.
export const RECENT_SCREENS = 10;
