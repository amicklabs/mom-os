import { expect, test } from "bun:test";
import { ScreenOffError, screenOnFrom, WAKE_SETTLE_MS, wakeForScreenshot } from "../src/lib/screen";

test("the screen is on if any monitor is", () => {
  expect(screenOnFrom([{ dpmsStatus: true }])).toBe(true);
  expect(screenOnFrom([{ dpmsStatus: false }, { dpmsStatus: true }])).toBe(true);
  expect(screenOnFrom([{ dpmsStatus: false }, { dpmsStatus: false }])).toBe(false);
  expect(screenOnFrom([])).toBeNull();
  expect(screenOnFrom(null)).toBeNull();
});

function deps(on: boolean | null) {
  const calls: string[] = [];
  return {
    calls,
    deps: {
      isOn: async () => on,
      turnOn: async () => {
        calls.push("on");
      },
      wait: async (ms: number) => {
        calls.push(`wait ${ms}`);
      },
    },
  };
}

test("a dark screen is turned on and given time to draw before the picture", async () => {
  const d = deps(false);
  expect(await wakeForScreenshot(false, d.deps)).toEqual({ woken: true });
  expect(d.calls).toEqual(["on", `wait ${WAKE_SETTLE_MS}`]);
});

test("a lit or unknown screen is left alone", async () => {
  for (const on of [true, null]) {
    const d = deps(on);
    expect(await wakeForScreenshot(false, d.deps)).toEqual({ woken: false });
    expect(d.calls).toEqual([]);
  }
});

test("with the lid closed a dark screen stays off and the picture is refused", async () => {
  const d = deps(false);
  await expect(wakeForScreenshot(true, d.deps)).rejects.toBeInstanceOf(ScreenOffError);
  expect(d.calls).toEqual([]);
});
