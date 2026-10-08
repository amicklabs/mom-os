import { mkdirSync, readFileSync, unlinkSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { type Action, type Banner, type ConfigFile, runtimeDir } from "@momos/shared";
import { loadConfig } from "@momos/momctl/config";
import { findTile, openTile } from "@momos/momctl/launch";
import { type ReloadResult, reloadTile } from "@momos/momctl/reload";
import { home, lock } from "@momos/momctl/shell";
import { wakeForScreenshot } from "@momos/momctl/screen";
import { screenshot } from "@momos/momctl/system";
import { runOk } from "@momos/momctl/run";
import {
  bannerTextForHelpSeen,
  bannerTextForRecentScreens,
  bannerTextForReload,
  bannerTextForRestart,
  bannerTextForSay,
  isReloadBanner,
} from "./actions";
import type { Backend } from "./convex";
import { type Core, log, sleep } from "./core";
import { recentScreens } from "./help";
import { isLocked } from "./model";
import type { ScreenShare } from "./screenshare";

// Carries out allowlisted actions, using the same code as momctl.

export function showBanner(core: Core, kind: Banner["kind"], text: string, seconds?: number | null): Banner {
  const banner: Banner = {
    id: randomUUID(),
    kind,
    text: text.slice(0, 280),
    until: seconds ? Date.now() + seconds * 1000 : null,
  };
  core.dispatch({ type: "banner", banner });
  return banner;
}

export function say(core: Core, text: string, seconds?: number | null): Banner {
  return showBanner(core, "message", bannerTextForSay(core.helperName(), text), seconds);
}

export async function doLock(core: Core): Promise<void> {
  await lock();
  core.dispatch({ type: "lock", source: "shell", locked: true });
}

// A restart that waited longer than this in Convex is refused: the laptop was
// probably off or offline, and a reboot out of nowhere would scare her.
export const RESTART_MAX_AGE_MS = 10 * 60_000;
export const RESTART_DELAY_MS = 10_000;
const RESTART_META = "restart.actionId";

async function systemReboot(): Promise<void> {
  // Polkit lets her user reboot without a password, even with other sessions
  // open (system/files/polkit/50-momos-reboot.rules).
  await runOk(["systemctl", "reboot"], { timeoutMs: 30_000 });
}

// True when the disk is encrypted and nothing unlocks it at boot, so a reboot
// stops at the passphrase prompt and she can't get back in. The keyfile step in
// system/install.sh adds cryptkey= to the kernel command line.
export function bootNeedsPassphrase(cmdline: string): boolean {
  const args = cmdline.split(/\s+/);
  const encrypted = args.some((a) => a.startsWith("cryptdevice=") || a.startsWith("rd.luks"));
  const keyfile = args.some((a) => a.startsWith("cryptkey=") || a.startsWith("rd.luks.key="));
  return encrypted && !keyfile;
}

function readCmdline(): string {
  try {
    return readFileSync("/proc/cmdline", "utf8");
  } catch {
    return "";
  }
}

// Shows the banner, then reboots after RESTART_DELAY_MS. Returns at once, so
// the action is marked done in Convex before the reboot. The action id is
// saved first: if Convex didn't hear back and offers the same action after the
// reboot, it's reported done instead of rebooting again.
export function restart(
  core: Core,
  id: string,
  createdAt: number | null,
  opts: { reboot?: () => Promise<void>; delayMs?: number; now?: number; cmdline?: string } = {},
): { ok: boolean; result?: string } {
  if (core.queue.getMeta(RESTART_META) === id) return { ok: true, result: "restarted" };
  if (bootNeedsPassphrase(opts.cmdline ?? readCmdline())) {
    return { ok: false, result: "refused: the disk asks for its passphrase at startup, so the laptop would stop there until someone typed it. Install the keyfile first." };
  }
  const now = opts.now ?? Date.now();
  if (createdAt !== null && now - createdAt > RESTART_MAX_AGE_MS) {
    return { ok: false, result: "refused: it was sent more than 10 minutes ago" };
  }
  core.queue.setMeta(RESTART_META, id);
  const banner = showBanner(core, "info", bannerTextForRestart(core.helperName()), 60);
  const reboot = opts.reboot ?? systemReboot;
  setTimeout(() => {
    reboot().catch((e: unknown) => {
      log("restart", "reboot failed:", e);
      core.error("restart", e);
      core.dispatch({ type: "banner-dismiss", id: banner.id });
    });
  }, opts.delayMs ?? RESTART_DELAY_MS);
  return { ok: true, result: `rebooting in ${Math.round((opts.delayMs ?? RESTART_DELAY_MS) / 1000)} seconds` };
}

// A reload that waited longer than this is refused, like a restart: taking
// her to a page out of nowhere, long after the helper asked, would confuse her.
export const RELOAD_MAX_AGE_MS = 10 * 60_000;
// "Sam refreshed YouTube." shows this long.
export const RELOAD_NOTICE_SECONDS = 6;

// Tells her briefly that the helper reloaded a page. It never covers another
// banner, such as a message from the helper, only an earlier reload note.
export function reloadNotice(core: Core, label: string): Banner | null {
  const helper = core.helperName();
  const current = core.model.banner;
  if (current && !isReloadBanner(helper, current.text)) return null;
  return showBanner(core, "info", bannerTextForReload(helper, label), RELOAD_NOTICE_SECONDS);
}

// Reloads one of her tiles' pages (the reload action and momctl reload). The
// tile must be in her config; momctl's reloadTile refuses anything but web
// pages and a locked screen.
export async function reload(
  core: Core,
  tileId: string,
  opts: { createdAt?: number | null; now?: number; run?: typeof reloadTile; config?: () => ConfigFile } = {},
): Promise<{ ok: boolean; result: string; reload?: ReloadResult }> {
  const now = opts.now ?? Date.now();
  if (opts.createdAt != null && now - opts.createdAt > RELOAD_MAX_AGE_MS) {
    return { ok: false, result: "refused: it was sent more than 10 minutes ago" };
  }
  const tile = findTile((opts.config ?? loadConfig)(), tileId);
  const r = await (opts.run ?? reloadTile)(tile, { locked: isLocked(core.model) });
  reloadNotice(core, tile.label);
  return {
    ok: true,
    result: r.action === "reloaded" ? `reloaded ${tile.label}` : `${tile.label} wasn't open, so it was opened`,
    reload: r,
  };
}

// "Sam saw your message" stays this long unless she presses OK.
export const HELP_SEEN_SECONDS = 30 * 60;

// The ring buffer's last ten minutes, for the helper. She's told first, the
// same way as for a screenshot. The pictures leave the laptop only here.
export async function sendRecentScreens(
  core: Core,
  b: Backend,
  actionId: string,
  opts: { screens?: { file: string; takenAt: number }[]; wait?: (ms: number) => Promise<unknown> } = {},
): Promise<{ ok: boolean; result?: string }> {
  showBanner(core, "info", bannerTextForRecentScreens(core.helperName()), 15);
  await (opts.wait ?? sleep)(1500);
  const screens = opts.screens ?? recentScreens();
  const uploaded: { storageId: string; takenAt: number }[] = [];
  for (const s of screens) {
    try {
      uploaded.push({ storageId: await b.upload(s.file, "image/jpeg"), takenAt: s.takenAt });
    } catch (e) {
      log("actions", `couldn't upload ${s.file}:`, e);
    }
  }
  if (!uploaded.length) {
    return { ok: true, result: screens.length ? "the pictures couldn't be uploaded" : "none were taken: the screen was off, locked or closed" };
  }
  await b.mutation("device.attachScreens", { actionId, screens: uploaded });
  return { ok: true, result: `${uploaded.length} picture${uploaded.length === 1 ? "" : "s"}` };
}

export function makeRunner(core: Core, backend: () => Backend, share?: ScreenShare) {
  return async (id: string, action: Action, info: { createdAt: number | null } = { createdAt: null }): Promise<{ ok: boolean; result?: string }> => {
    switch (action.type) {
      case "restart":
        return restart(core, id, info.createdAt);
      case "say":
        say(core, action.text, action.seconds);
        return { ok: true };
      case "home":
        await home();
        return { ok: true };
      case "open": {
        const r = await openTile(findTile(loadConfig(), action.tileId));
        return { ok: true, result: r.action };
      }
      case "lock":
        await doLock(core);
        return { ok: true };
      case "reload": {
        const r = await reload(core, action.tileId, { createdAt: info.createdAt });
        return { ok: r.ok, result: r.result };
      }
      case "screenshot": {
        // Silent, like momctl screenshot: she asked for no notice on
        // screenshots. The action and its picture stay on record in Convex.
        // A dark screen is turned on and left on.
        const { woken } = await wakeForScreenshot(core.model.lidClosed);
        const dir = `${runtimeDir()}/help`;
        mkdirSync(dir, { recursive: true, mode: 0o700 });
        const { path } = await screenshot(`${dir}/action-${Date.now()}.jpg`, { jpeg: true });
        try {
          const b = backend();
          const storageId = await b.upload(path, "image/jpeg");
          await b.mutation("device.attachScreenshot", { actionId: id, storageId });
        } finally {
          try {
            unlinkSync(path);
          } catch {
            // gone already
          }
        }
        return woken ? { ok: true, result: "the screen was off; turned it on" } : { ok: true };
      }
      case "recent-screens":
        return sendRecentScreens(core, backend(), id);
      case "help-seen":
        showBanner(core, "info", bannerTextForHelpSeen(core.helperName()), HELP_SEEN_SECONDS);
        return { ok: true };
      case "screen-share":
        if (!share) return { ok: false, result: "screen sharing isn't available" };
        if (action.op === "stop") {
          await share.stop("the helper stopped it");
          return { ok: true, result: "stopped" };
        }
        return share.start({ control: action.control, minutes: action.minutes, createdAt: info.createdAt });
    }
  };
}
