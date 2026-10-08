import { dpms, type HyprMonitor, monitors } from "./hypr";

// Whether her screen is lit. grim hangs until it times out while every monitor
// is off (DPMS off after the idle timeout, or momd blanking a closed lid), so
// everything that takes a picture checks this first.

// How long to wait after the screen comes on before taking a picture, so the
// first frame is drawn.
export const WAKE_SETTLE_MS = 1500;

// True if any monitor is on, false if all are off, null if there are none or
// Hyprland didn't answer.
export function screenOnFrom(mons: Pick<HyprMonitor, "dpmsStatus">[] | null): boolean | null {
  if (!mons || mons.length === 0) return null;
  return mons.some((m) => m.dpmsStatus);
}

export async function screenOn(read: () => Promise<HyprMonitor[]> = monitors): Promise<boolean | null> {
  return screenOnFrom(await read().catch(() => null));
}

export class ScreenOffError extends Error {}

export interface WakeDeps {
  isOn?: () => Promise<boolean | null>;
  turnOn?: () => Promise<void>;
  wait?: (ms: number) => Promise<unknown>;
}

// Turn the screen on for a picture if it's off, and wait for it to draw. Leaves
// it on: the idle timer turns it off again. Throws ScreenOffError with the lid
// closed, since the screen stays off then and grim would only time out.
export async function wakeForScreenshot(lidClosed: boolean, deps: WakeDeps = {}): Promise<{ woken: boolean }> {
  const on = await (deps.isOn ?? screenOn)();
  if (on !== false) return { woken: false };
  if (lidClosed) throw new ScreenOffError("the screen is off because the lid is closed");
  await (deps.turnOn ?? (() => dpms(true)))();
  await (deps.wait ?? Bun.sleep)(WAKE_SETTLE_MS);
  return { woken: true };
}
