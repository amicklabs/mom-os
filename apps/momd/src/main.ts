#!/usr/bin/env bun
import { mkdirSync, readFileSync } from "node:fs";
import { dataDir, paths, runtimeDir } from "@momos/shared";
import { ensureSessionEnv } from "@momos/momctl/env";
import { health } from "@momos/momctl/health";
import { VERSION } from "@momos/momctl/version";
import { ConvexSync } from "./convex";
import { Core, every, log, sleep, Supervisor } from "./core";
import { writeAtomic } from "./files";
import { Help, ringBuffer } from "./help";
import { lidMonitor } from "./lidmon";
import { batteryMonitor, focusMonitor, lockMonitor, networkMonitor, viewerMonitor } from "./monitors";
import { EventQueue } from "./queue";
import { Reminders } from "./reminders";
import { makeRunner } from "./runner";
import { ScreenWatch } from "./screen";
import { ScreenShare } from "./screenshare";
import { makeHandler, serveSocket } from "./socket";
import { speakerKeeper } from "./speaker";
import { launcherMonitor, telegramUnread } from "./telegram";
import { hyprWindowOps, WindowKeeper } from "./windows";

const STATE_EVERY_MS = 10_000;
const HEALTH_EVERY_MS = 24 * 60 * 60_000;
// A safety net for the window rules; Hyprland's events do the real work.
const WINDOWS_EVERY_MS = 10_000;

ensureSessionEnv();
mkdirSync(runtimeDir(), { recursive: true, mode: 0o700 });
mkdirSync(dataDir(), { recursive: true, mode: 0o700 });

const queue = new EventQueue(paths.db());
const core = new Core(queue, VERSION);
const sup = new Supervisor(core);
log("momd", `starting ${VERSION}, pid ${process.pid}`);

// A boot event once per boot, however often momd restarts.
try {
  const bootId = readFileSync("/proc/sys/kernel/random/boot_id", "utf8").trim();
  if (queue.getMeta("bootId") !== bootId) {
    queue.setMeta("bootId", bootId);
    core.record({ type: "boot" });
  }
} catch (e) {
  log("momd", "can't read boot id:", e);
}

// ---- state.json: on every change and every 10 s ---------------------------

let writeTimer: ReturnType<typeof setTimeout> | null = null;
const writeState = () => {
  try {
    writeAtomic(paths.state(), JSON.stringify(core.state()) + "\n");
  } catch (e) {
    log("state", "can't write state.json:", e);
  }
};
core.onChange(() => {
  if (!writeTimer) {
    writeTimer = setTimeout(() => {
      writeTimer = null;
      writeState();
    }, 50);
  }
});
writeState();

// ---- tasks ----------------------------------------------------------------

let convex: ConvexSync;
const share = new ScreenShare(core);
const runAction = makeRunner(core, () => convex, share);
convex = new ConvexSync(core, runAction, undefined, () => share.current());
const screen = new ScreenWatch();
const help = new Help(core, convex, { screen });
const reminders = new Reminders(core);
const windows = new WindowKeeper(hyprWindowOps(() => core.config()?.tiles ?? []));
const telegram = telegramUnread(core);

sup.start("state", () => every(STATE_EVERY_MS, writeState));
sup.start("tick", () => every(1000, () => core.dispatch({ type: "tick" })));
sup.start("socket", () => serveSocket(makeHandler(core, help, sup, reminders)), { minMs: 2000 });
sup.start("reminders", () => reminders.run(), { minMs: 5000 });
sup.start("network", () => networkMonitor(core));
sup.start("battery", () => batteryMonitor(core));
sup.start("focus", () => focusMonitor(core, windows, telegram), { minMs: 2000, maxMs: 30_000 });
sup.start("windows", () =>
  every(WINDOWS_EVERY_MS, () => windows.settle().then(() => {}, (e) => log("windows", "can't check windows:", e))),
);
sup.start("viewer", () => viewerMonitor(core), { minMs: 5000, maxMs: 5 * 60_000 });
sup.start("lock", () => lockMonitor(core));
sup.start("lid", () => lidMonitor(core), { minMs: 5000 });
sup.start("convex", () => convex.run(), { minMs: 5000, maxMs: 5 * 60_000 });
sup.start("screen", () => screen.run(), { minMs: 5000 });
sup.start("screenshots", () => ringBuffer(core, screen), { minMs: 60_000, maxMs: 10 * 60_000 });
sup.start("help-outbox", () => help.runOutbox(), { minMs: 5000 });
sup.start("telegram", () => launcherMonitor(telegram), { minMs: 10_000, maxMs: 5 * 60_000 });
sup.start("speaker", () => speakerKeeper(), { minMs: 60_000, maxMs: 10 * 60_000 });
sup.start("health", async () => {
  await sleep(60_000); // let things settle after boot
  await every(60 * 60_000, async () => {
    const last = Number(queue.getMeta("lastHealth") ?? 0);
    if (Date.now() - last < HEALTH_EVERY_MS) return;
    core.record({ type: "health", report: await health() });
    queue.setMeta("lastHealth", String(Date.now()));
  });
});

const shutdown = async (sig: string) => {
  log("momd", `${sig}; stopping`);
  sup.stop();
  await share.stop("momd is stopping").catch(() => undefined);
  try {
    queue.close();
  } catch {
    // already closed
  }
  process.exit(0);
};
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
