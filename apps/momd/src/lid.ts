// Lid detection for a laptop whose lid switch flickers.
//
// Measured on the MacBook Air (PLAN.md, "Lid and sleep"): with the lid open the
// switch reads "closed" for at most 2.6% of any 10 s window; with the lid
// closed it reads "closed" 66-87% of the time and the light sensor reads 0 in
// 97-100% of samples. So the lid counts as closed when most of the last 10 s
// says closed and the light sensor is dark, and as open again once the switch
// stops saying closed for a couple of seconds.

export const LID = {
  sampleMs: 250,
  // Closing: share of "closed" readings over the last closeWindowMs.
  closeWindowMs: 10_000,
  closeRatio: 0.5,
  // Need at least this much of the window sampled before deciding, so a restart
  // or a resume can't close on a handful of readings.
  minCoverage: 0.9,
  // Light sensor must read 0 in at least this share of the last lightWindowMs.
  lightWindowMs: 2_000,
  lightZeroRatio: 0.75,
  // Opening: share of "closed" readings over the last openWindowMs drops below this.
  openWindowMs: 2_000,
  openRatio: 0.2,
  // A gap this long between samples means the machine slept; start over.
  gapMs: 5_000,
  // Suspend after the lid has been closed this long.
  suspendAfterMs: 30 * 60_000,
} as const;

export type LidConfig = { -readonly [K in keyof typeof LID]: number };

export interface LidSample {
  t: number; // epoch ms
  closed: boolean; // switch says closed
  dark: boolean; // light sensor reads 0
}

export type LidTransition = { closed: boolean; at: number } | { resumed: true; gapMs: number; at: number };

export class LidDetector {
  private samples: LidSample[] = [];
  private _closed = false;
  private _since: number | null = null;
  private readonly cfg: LidConfig;

  constructor(cfg: Partial<LidConfig> = {}) {
    this.cfg = { ...LID, ...cfg };
  }

  get closed(): boolean {
    return this._closed;
  }

  // When the current state began, or null before the first transition.
  get since(): number | null {
    return this._since;
  }

  reset(): void {
    this.samples = [];
    this._closed = false;
    this._since = null;
  }

  push(s: LidSample): LidTransition | null {
    const last = this.samples[this.samples.length - 1];
    if (last && s.t - last.t > this.cfg.gapMs) {
      const gapMs = s.t - last.t;
      this.reset();
      this.samples.push(s);
      return { resumed: true, gapMs, at: s.t };
    }
    this.samples.push(s);
    const keepFrom = s.t - Math.max(this.cfg.closeWindowMs, this.cfg.lightWindowMs, this.cfg.openWindowMs);
    while (this.samples.length && this.samples[0]!.t < keepFrom) this.samples.shift();

    if (!this._closed) {
      if (this.shouldClose(s.t)) return this.flip(true, s.t);
    } else if (this.shouldOpen(s.t)) {
      return this.flip(false, s.t);
    }
    return null;
  }

  private flip(closed: boolean, at: number): LidTransition {
    this._closed = closed;
    this._since = at;
    // Judge the next change only on readings taken after this one, so the
    // readings that caused it can't immediately cause the opposite.
    this.samples = this.samples.slice(-1);
    return { closed, at };
  }

  private window(now: number, ms: number): LidSample[] {
    return this.samples.filter((x) => x.t > now - ms);
  }

  private shouldClose(now: number): boolean {
    const w = this.window(now, this.cfg.closeWindowMs);
    const expected = this.cfg.closeWindowMs / this.cfg.sampleMs;
    if (w.length < expected * this.cfg.minCoverage) return false;
    if (ratio(w, (x) => x.closed) <= this.cfg.closeRatio) return false;
    return ratio(this.window(now, this.cfg.lightWindowMs), (x) => x.dark) >= this.cfg.lightZeroRatio;
  }

  private shouldOpen(now: number): boolean {
    const w = this.window(now, this.cfg.openWindowMs);
    const expected = this.cfg.openWindowMs / this.cfg.sampleMs;
    if (w.length < expected * this.cfg.minCoverage) return false;
    return ratio(w, (x) => x.closed) < this.cfg.openRatio;
  }
}

function ratio<T>(xs: T[], pred: (x: T) => boolean): number {
  if (xs.length === 0) return 0;
  let n = 0;
  for (const x of xs) if (pred(x)) n++;
  return n / xs.length;
}

// "state:      closed" from /proc/acpi/button/lid/*/state
export const parseLidState = (s: string): boolean => /closed/.test(s);
// "(0,0)" from /sys/devices/platform/applesmc.768/light; the first number is the sensor.
export function parseLight(s: string): number | null {
  const m = s.match(/\(?\s*(-?\d+)/);
  return m ? Number(m[1]) : null;
}
