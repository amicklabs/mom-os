import { existsSync, readdirSync, readFileSync } from "node:fs";
import { lidMode } from "@momos/shared";
import { dpms, monitors } from "@momos/momctl/hypr";
import { run, which } from "@momos/momctl/run";
import { type Core, log, sleep } from "./core";
import { LID, LidDetector, parseLidState, parseLight } from "./lid";

// On a laptop configured with "lid": "flaky-macbook", samples the flaky lid
// switch and the light sensor four times a second and acts on what the
// detector decides. See PLAN.md "Lid and sleep" and ~/MACHINE-NOTES.md on the
// laptop.

const LID_DIR = "/proc/acpi/button/lid";
const LIGHT = "/sys/devices/platform/applesmc.768/light";
// While the lid is closed, check this often that the screen is still off (a
// key pressed by the closed lid can wake it).
const REASSERT_MS = 5000;

function lidStatePath(): string | null {
  if (!existsSync(LID_DIR)) return null;
  const dev = readdirSync(LID_DIR)[0];
  return dev ? `${LID_DIR}/${dev}/state` : null;
}

async function screen(on: boolean): Promise<void> {
  try {
    await dpms(on);
  } catch (e) {
    log("lid", `can't turn the screen ${on ? "on" : "off"}:`, e);
  }
}

async function pauseMedia(): Promise<void> {
  if (!which("playerctl")) return;
  await run(["playerctl", "--all-players", "pause"], { timeoutMs: 5000 }).catch(() => undefined);
}

// True when a charger is plugged in. Plugged in, the laptop never sleeps, so the
// helper can always reach it; see system/files/bin/momos-idle for the idle side.
export function onAC(dir = "/sys/class/power_supply"): boolean {
  if (!existsSync(dir)) return false;
  for (const name of readdirSync(dir)) {
    try {
      if (readFileSync(`${dir}/${name}/type`, "utf8").trim() !== "Mains") continue;
      if (readFileSync(`${dir}/${name}/online`, "utf8").trim() === "1") return true;
    } catch {
      // A supply without these files isn't a charger.
    }
  }
  return false;
}

// How often to look for a change to local.hardware.lid in config.json.
const MODE_CHECK_MS = 30_000;

// Only a laptop whose config says "flaky-macbook" gets the averaging rule. With
// "normal", logind handles the lid as usual and momd has nothing to do; with
// "ignore", nothing handles it. Returns when the mode changes, so the
// supervisor starts it over with the new one.
export async function lidMonitor(core: Core, cfg = LID, modeCheckMs = MODE_CHECK_MS): Promise<void> {
  const mode = lidMode(core.config());
  if (mode !== "flaky-macbook") {
    log("lid", `lid mode is "${mode}"; momd leaves the lid alone`);
    while (lidMode(core.config()) === mode) await sleep(modeCheckMs);
    return;
  }
  const statePath = lidStatePath();
  if (!statePath || !existsSync(LIGHT)) {
    log("lid", `no lid switch or light sensor here (${statePath ?? LID_DIR}, ${LIGHT}); lid detection is off`);
    await new Promise<never>(() => {});
  }

  const detector = new LidDetector(cfg);
  let lastReassert = 0;
  let suspendAttemptAt = 0;
  let lastSampleAt = 0;
  let lastModeCheck = Date.now();

  for (;;) {
    const t = Date.now();
    if (t - lastModeCheck >= modeCheckMs) {
      lastModeCheck = t;
      if (lidMode(core.config()) !== mode) {
        log("lid", "lid mode changed; starting over");
        if (detector.closed) {
          core.dispatch({ type: "lid", closed: false });
          await screen(true);
        }
        return;
      }
    }
    const closed = parseLidState(readFileSync(statePath!, "utf8"));
    const light = parseLight(readFileSync(LIGHT, "utf8"));
    const tr = detector.push({ t, closed, dark: light === 0 });

    if (tr && "resumed" in tr) {
      log("lid", `woke after ${Math.round(tr.gapMs / 1000)} s asleep`);
      core.record({ type: "sleep", stage: "suspend" }, lastSampleAt);
      core.record({ type: "sleep", stage: "resume" }, t);
      if (core.model.lidClosed) core.dispatch({ type: "lid", closed: false });
      await screen(true);
    } else if (tr) {
      log("lid", tr.closed ? "closed" : "opened");
      core.dispatch({ type: "lid", closed: tr.closed });
      if (tr.closed) {
        await screen(false);
        await pauseMedia();
        lastReassert = Date.now();
      } else {
        await screen(true);
      }
    } else if (detector.closed) {
      const now = Date.now();
      if (now - lastReassert >= REASSERT_MS) {
        lastReassert = now;
        const mons = await monitors().catch(() => []);
        if (mons.some((m) => m.dpmsStatus)) await screen(false);
      }
      const since = detector.since ?? now;
      if (now - since >= cfg.suspendAfterMs && now - suspendAttemptAt >= cfg.suspendAfterMs && !onAC()) {
        suspendAttemptAt = now;
        log("lid", `closed for ${Math.round((now - since) / 60_000)} min; suspending`);
        const r = await run(["systemctl", "suspend"], { timeoutMs: 30_000 }).catch((e: Error) => ({ code: -1, stderr: e.message, stdout: "" }));
        if (r.code !== 0) log("lid", "suspend failed:", r.stderr.trim());
      }
    }

    lastSampleAt = t;
    await sleep(Math.max(0, cfg.sampleMs - (Date.now() - t)));
  }
}
