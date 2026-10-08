import { expect, test } from "bun:test";
import { speakerKeeper } from "../src/speaker";

// A fake clock: each wait moves time forward by what was asked, plus an
// extra jump on the waits listed in `sleeps` (the laptop asleep).
function run(sleeps: Record<number, number>, waits: number) {
  let t = 1_000_000;
  let n = 0;
  const calls: number[] = [];
  const stop = new Error("stop");
  const keeper = speakerKeeper({
    now: () => t,
    wait: async (ms) => {
      n++;
      if (n > waits) throw stop;
      t += ms + (sleeps[n] ?? 0);
    },
    reconnect: async () => {
      calls.push(t);
      return { tried: [], connected: null };
    },
  });
  return keeper.then(
    () => calls,
    (e) => {
      if (e !== stop) throw e;
      return calls;
    },
  );
}

test("reconnects once after login and not again while the laptop stays awake", async () => {
  expect((await run({}, 20)).length).toBe(1);
});

test("reconnects again after a wake from sleep", async () => {
  // Wait 1 is the settle before the login attempt; the laptop sleeps for an
  // hour during wait 4, a check.
  expect((await run({ 4: 3_600_000 }, 20)).length).toBe(2);
});
