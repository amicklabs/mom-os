import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import type { Tile } from "@momos/shared";
import { daysSinceUpdate, dkmsWanted, health, parseDkms } from "../src/lib/health";
import { lua, luaStr } from "../src/lib/hypr";
import { keySequence } from "../src/lib/input";
import { battery, isPowerAction, power, powerCommand, splitTerse } from "../src/lib/system";
import { tileIdForClass, tileTarget } from "../src/lib/tiles";

const tiles: Tile[] = [
  { id: "family", label: "Family", type: "page", page: "family" },
  { id: "telegram", label: "Telegram", type: "app", app: "telegram" },
  { id: "youtube", label: "YouTube", type: "webapp", url: "https://www.youtube.com" },
  { id: "email", label: "Email", type: "webapp", url: "https://mail.google.com/mail/u/0" },
  { id: "internet", label: "Browser", type: "app", app: "chromium" },
  { id: "lucy", label: "Lucy", type: "telegram-chat", telegram: "example_user" },
];

describe("tiles", () => {
  test("webapp windows match on host", () => {
    expect(tileIdForClass(tiles, "chrome-www.youtube.com__-Default")).toBe("youtube");
    expect(tileIdForClass(tiles, "chrome-mail.google.com__mail_u_0-Default")).toBe("email");
    expect(tileIdForClass(tiles, "chromium")).toBe("internet");
    expect(tileIdForClass(tiles, "org.telegram.desktop")).toBe("telegram");
    expect(tileIdForClass(tiles, "foot")).toBeNull();
  });

  test("commands", () => {
    expect(tileTarget(tiles[2]!)!.command).toEqual(["chromium", "--app=https://www.youtube.com"]);
    expect(tileTarget(tiles[5]!)!.command).toEqual(["Telegram", "--", "tg://resolve?domain=example_user"]);
    expect(tileTarget(tiles[0]!)).toBeNull();
  });
});

describe("hyprland lua", () => {
  test("strings can't escape the literal", () => {
    expect(luaStr('a"b\\c')).toBe('"a\\"b\\\\c"');
    expect(luaStr("x\ny")).toBe('"x\\010y"');
    expect(luaStr("é")).toBe('"\\195\\169"');
  });
  test("dispatch calls", () => {
    expect(lua.focusWorkspace("home")).toBe('hl.dsp.focus({ workspace = "name:home" })');
    expect(lua.dpms(false)).toBe('hl.dsp.dpms({ action = "off" })');
    expect(lua.moveWindow("0xabc", "tile-youtube", false)).toBe(
      'hl.dsp.window.move({ workspace = "name:tile-youtube", window = "address:0xabc", follow = false })',
    );
  });
});

test("key combos", () => {
  expect(keySequence("ctrl+l")).toEqual(["29:1", "38:1", "38:0", "29:0"]);
  expect(keySequence("Enter")).toEqual(["28:1", "28:0"]);
  expect(() => keySequence("hyper+q")).toThrow();
});

test("nmcli terse split", () => {
  expect(splitTerse("yes:My\\:Net:65:wlp3s0")).toEqual(["yes", "My:Net", "65", "wlp3s0"]);
});

test("dkms parsing", () => {
  const out = "broadcom-wl/6.30.223.271, 7.2.5-3-omarchy, x86_64: installed\nfacetimehd/0.7.2, 7.2.4-1-omarchy, x86_64: installed\n";
  const r = parseDkms(out, "7.2.5-3-omarchy", { wl: "broadcom-wl", facetimehd: "facetimehd" });
  expect(r[0]).toEqual({ module: "wl", version: "6.30.223.271", builtForRunningKernel: true, status: "installed" });
  expect(r[1]!.builtForRunningKernel).toBe(false);
});

test("dkms modules come from the hardware config", async () => {
  expect(dkmsWanted(["wl", "facetimehd", "apple-bce"])).toEqual({ wl: "broadcom-wl", facetimehd: "facetimehd", "apple-bce": "apple-bce" });
  // No modules listed: dkms isn't run at all.
  const h = await health([]);
  expect(h.dkms).toEqual([]);
});

test("battery from sysfs", () => {
  const root = mkdtempSync(`${tmpdir()}/ps-`);
  mkdirSync(`${root}/BAT0`);
  mkdirSync(`${root}/ADP1`);
  writeFileSync(`${root}/ADP1/uevent`, "POWER_SUPPLY_TYPE=Mains\nPOWER_SUPPLY_ONLINE=1\n");
  writeFileSync(
    `${root}/BAT0/uevent`,
    "POWER_SUPPLY_TYPE=Battery\nPOWER_SUPPLY_STATUS=Full\nPOWER_SUPPLY_PRESENT=1\nPOWER_SUPPLY_CAPACITY=84\nPOWER_SUPPLY_CHARGE_FULL_DESIGN=5100000\nPOWER_SUPPLY_CHARGE_FULL=4240000\nPOWER_SUPPLY_CYCLE_COUNT=518\n",
  );
  expect(battery(root)).toEqual({ percent: 84, charging: true, status: "Full", acOnline: true, healthPercent: 83.1, cycles: 518 });
});

test("days since update", () => {
  const dir = mkdtempSync(`${tmpdir()}/pl-`);
  writeFileSync(`${dir}/log`, "[2026-09-20T10:00:00-0700] [PACMAN] starting full system upgrade\n[2026-09-20T10:05:00-0700] [ALPM] done\n");
  expect(daysSinceUpdate(`${dir}/log`, Date.parse("2026-09-25T12:00:00-0700"))).toBe(5);
});

describe("power", () => {
  test("off and restart map to systemctl", async () => {
    expect(powerCommand("off")).toEqual(["systemctl", "poweroff"]);
    expect(powerCommand("restart")).toEqual(["systemctl", "reboot"]);
    const ran: string[][] = [];
    const r = await power("off", async (cmd) => {
      ran.push(cmd);
      return "";
    });
    expect(ran).toEqual([["systemctl", "poweroff"]]);
    expect(r).toEqual({ power: "off", started: true });
  });

  test("only off and restart", () => {
    expect(isPowerAction("off")).toBe(true);
    expect(isPowerAction("restart")).toBe(true);
    expect(isPowerAction("suspend")).toBe(false);
    expect(isPowerAction(undefined)).toBe(false);
  });
});
