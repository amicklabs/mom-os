import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { Core } from "../src/core";
import { LID, LidDetector, parseLidState, parseLight, type LidSample } from "../src/lid";
import { lidMonitor } from "../src/lidmon";
import { EventQueue } from "../src/queue";

// Recorded on the laptop on September 25: four readings a second of the lid
// switch and the light sensor. The lid was really closed 13:15:02-13:16:02 and
// 13:16:40-13:18:49, open otherwise.
const day = Date.parse("2026-09-25T00:00:00Z");
const at = (hms: string) => {
  const [h, m, s] = hms.split(":").map(Number);
  return day + ((h! * 60 + m!) * 60 + s!) * 1000;
};

function load(): LidSample[] {
  const text = readFileSync(new URL("./fixtures/lidtest-2026-09-25.txt", import.meta.url), "utf8");
  return text
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [time, light, state] = line.trim().split(/\s+/);
      return { t: at(time!), closed: parseLidState(state!), dark: parseLight(light!) === 0 };
    });
}

const closures = [
  { from: at("13:15:02"), to: at("13:16:02") },
  { from: at("13:16:40"), to: at("13:18:49") },
];
const reallyClosed = (t: number) => closures.some((c) => t >= c.from && t < c.to);

test("fixture parses", () => {
  const s = load();
  expect(s.length).toBeGreaterThan(3000);
  expect(s.filter((x) => x.closed).length).toBe(594);
});

test("recorded lid log: no false closes, every real close caught within 10 s", () => {
  const d = new LidDetector();
  const transitions: { closed: boolean; at: number }[] = [];
  const falseClosed: number[] = [];
  for (const s of load()) {
    const tr = d.push(s);
    if (tr && "closed" in tr) transitions.push(tr);
    // While the lid is really open, the detector may only say closed in the
    // short moment after a real opening, before it has noticed.
    const justOpened = closures.some((c) => s.t >= c.to && s.t < c.to + 3000);
    if (d.closed && !reallyClosed(s.t) && !justOpened) falseClosed.push(s.t);
  }
  expect(falseClosed).toEqual([]);
  // Exactly one close and one open per real closure.
  expect(transitions.map((t) => t.closed)).toEqual([true, false, true, false]);
  for (const [i, c] of closures.entries()) {
    const close = transitions[i * 2]!;
    const open = transitions[i * 2 + 1]!;
    expect(close.at).toBeGreaterThanOrEqual(c.from);
    expect(close.at - c.from).toBeLessThanOrEqual(10_000);
    expect(open.at).toBeGreaterThanOrEqual(c.to - 1000);
    expect(open.at - c.to).toBeLessThanOrEqual(3000);
  }
});

test("a single flicker while open never closes", () => {
  const d = new LidDetector();
  for (let i = 0; i < 400; i++) {
    const tr = d.push({ t: i * 250, closed: i % 37 === 0, dark: true });
    expect(tr).toBeNull();
  }
});

test("the switch alone is not enough when the light sensor sees light", () => {
  const d = new LidDetector();
  for (let i = 0; i < 200; i++) d.push({ t: i * 250, closed: true, dark: false });
  expect(d.closed).toBe(false);
});

test("a gap in samples reports a resume and starts over", () => {
  const d = new LidDetector();
  for (let i = 0; i < 60; i++) d.push({ t: i * 250, closed: true, dark: true });
  expect(d.closed).toBe(true);
  const tr = d.push({ t: 60 * 250 + 600_000, closed: true, dark: true });
  expect(tr).toMatchObject({ resumed: true });
  expect(d.closed).toBe(false);
});

test("light sensor parsing", () => {
  expect(parseLight("(0,0)\n")).toBe(0);
  expect(parseLight("(12,0)")).toBe(12);
  expect(parseLight("garbage")).toBeNull();
  expect(parseLidState("state:      closed\n")).toBe(true);
  expect(parseLidState("state:      open\n")).toBe(false);
});

test("momd leaves the lid alone unless the config says flaky-macbook", async () => {
  const dir = mkdtempSync(`${tmpdir()}/lidcfg-`);
  process.env.XDG_CONFIG_HOME = dir;
  mkdirSync(`${dir}/momos`);
  const write = (hardware: unknown) =>
    writeFileSync(
      `${dir}/momos/config.json`,
      JSON.stringify({ person: { name: "B", user: "b" }, helper: { name: "N", phone: "1" }, tiles: [], family: [], local: { hardware } }),
    );
  write({ lid: "normal" });
  const core = new Core(new EventQueue(`${mkdtempSync(`${tmpdir()}/lidq-`)}/q.sqlite`), "test");
  let returned = false;
  const run = lidMonitor(core, LID, 20).then(() => {
    returned = true;
  });
  await Bun.sleep(80);
  // Idle: it never decides anything about the lid.
  expect(returned).toBe(false);
  expect(core.model.lidClosed).toBe(false);
  // A mode change ends it, so the supervisor starts over with the new mode.
  await Bun.sleep(5);
  write({ lid: "ignore" });
  await Promise.race([run, Bun.sleep(1000)]);
  expect(returned).toBe(true);
});
