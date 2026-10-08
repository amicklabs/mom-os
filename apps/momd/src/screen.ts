import { screenOn } from "@momos/momctl/screen";
import { every } from "./core";

// Follows whether her screen is lit, so momd knows when it has just come on.
// A help press usually follows a key press or click that woke the screen, and
// grim needs a moment after that before the first frame is drawn.

export const SCREEN_POLL_MS = 5000;
// A screen that came on less than this long ago counts as just woken.
export const JUST_WOKE_MS = 10_000;

export class ScreenWatch {
  private on: boolean | null = null;
  private onSince: number | null = null;

  constructor(
    private readonly read: () => Promise<boolean | null> = () => screenOn(),
    private readonly now: () => number = Date.now,
  ) {}

  // Ask Hyprland now. True if any monitor is on, false if all are off, null if
  // unknown.
  async check(): Promise<boolean | null> {
    const on = await this.read();
    if (on === true && this.on === false) this.onSince = this.now();
    if (on !== null) this.on = on;
    return on;
  }

  // The screen was seen going from off to on within JUST_WOKE_MS.
  justWoke(): boolean {
    return this.on === true && this.onSince !== null && this.now() - this.onSince < JUST_WOKE_MS;
  }

  run(): Promise<void> {
    return every(SCREEN_POLL_MS, async () => {
      await this.check();
    });
  }
}
