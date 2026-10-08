import { reconnect } from "@momos/momctl/speaker";
import { log, sleep } from "./core";

// Brings her saved Bluetooth speaker back: once shortly after login and once
// after each wake from sleep, never on a timer. Trying all the time could pull
// a family speaker away from someone else's phone. BlueZ also accepts the
// speaker when it connects by itself, since it's trusted.

// Bluetooth and PipeWire need a moment after login or wake.
export const SPEAKER_SETTLE_MS = 20_000;
const CHECK_MS = 15_000;
// A gap this much longer than the check interval means the laptop slept.
const WAKE_GAP_MS = 45_000;

type Reconnect = typeof reconnect;

export async function speakerKeeper(
  opts: { reconnect?: Reconnect; wait?: (ms: number) => Promise<void>; now?: () => number } = {},
): Promise<void> {
  const tryOnce = opts.reconnect ?? reconnect;
  const wait = opts.wait ?? sleep;
  const now = opts.now ?? Date.now;
  const attempt = async (why: string) => {
    await wait(SPEAKER_SETTLE_MS);
    try {
      const r = await tryOnce();
      if (r.skipped === "computer") log("speaker", `${why}: the computer was chosen for the sound; not reconnecting`);
      else if (r.tried.length > 0) log("speaker", `${why}: ${r.connected ? `connected ${r.connected}` : `no answer from ${r.tried.join(", ")}`}`);
    } catch (e) {
      log("speaker", `${why}: can't reconnect:`, e);
    }
  };
  await attempt("login");
  let last = now();
  for (;;) {
    await wait(CHECK_MS);
    const t = now();
    const woke = t - last > CHECK_MS + WAKE_GAP_MS;
    last = t;
    if (woke) {
      await attempt("wake");
      last = now();
    }
  }
}
