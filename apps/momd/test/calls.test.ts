import { describe, expect, test } from "bun:test";
import { CallWatcher, isCallTitle, parseWindowEvent, WATCH_MS } from "../src/calls";

describe("Telegram calls", () => {
  test("titles", () => {
    expect(isCallTitle("Lucy Smith")).toBe(true);
    expect(isCallTitle("Telegram")).toBe(false);
    expect(isCallTitle("Telegram (12)")).toBe(false);
    expect(isCallTitle("Media viewer")).toBe(false);
    expect(isCallTitle("")).toBe(false);
  });

  test("parses Hyprland window events", () => {
    expect(parseWindowEvent("openwindow>>55d1a2b3c4d0,tile-telegram,org.telegram.desktop,Lucy, the kid")).toEqual({
      kind: "open",
      address: "0x55d1a2b3c4d0",
      workspace: "tile-telegram",
      cls: "org.telegram.desktop",
      title: "Lucy, the kid",
    });
    expect(parseWindowEvent("windowtitlev2>>55d1,Lucy")).toEqual({ kind: "title", address: "0x55d1", title: "Lucy" });
    expect(parseWindowEvent("closewindow>>55d1")).toEqual({ kind: "close", address: "0x55d1" });
    expect(parseWindowEvent("activewindow>>a,b")).toBeNull();
  });

  test("brings a new Telegram window forward once its title names a person", async () => {
    let now = 0;
    const raised: string[] = [];
    const w = new CallWatcher(async (a) => void raised.push(a), () => now);
    const ev = (line: string) => w.handle(parseWindowEvent(line)!);

    // The main window: never raised.
    await ev("openwindow>>1,tile-telegram,org.telegram.desktop,");
    await ev("windowtitlev2>>1,Telegram (2)");
    // Another app's window with a name for a title: ignored.
    await ev("openwindow>>2,home,chromium,Lucy");
    // A call window that gets its title after mapping.
    await ev("openwindow>>3,tile-telegram,org.telegram.desktop,");
    expect(raised).toEqual([]);
    expect(await ev("windowtitlev2>>3,Lucy")).toBe(true);
    // Title changes after that don't raise it again.
    expect(await ev("windowtitlev2>>3,Lucy (calling)")).toBe(false);
    expect(raised).toEqual(["0x3"]);

    // An old Telegram window renamed later isn't a new call.
    now += WATCH_MS + 1;
    expect(await ev("windowtitlev2>>1,Bob")).toBe(false);
    expect(raised).toEqual(["0x3"]);
  });
});
