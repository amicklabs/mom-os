import { describe, expect, test } from "bun:test";
import { State } from "@momos/shared";
import { parseWindowEvent } from "../src/calls";
import { initialModel, reduce, toState } from "../src/model";
import { launcherUpdateFrom, TelegramUnread, unreadFromTitle } from "../src/telegram";

// What Telegram Desktop 7.2 sent on her laptop, from `busctl --user monitor
// --json=short`, with no unread messages.
const HIDDEN =
  '{"type":"signal","endian":"l","flags":1,"version":1,"cookie":16,"timestamp-realtime":1790633388666030,"sender":":1.55","path":"/com/canonical/unity/launcherentry/TelegramDesktop","interface":"com.canonical.Unity.LauncherEntry","member":"Update","payload":{"type":"sa{sv}","data":["application://org.telegram.desktop.desktop",{"count-visible":{"type":"b","data":false}}]}}';

const update = (app: string, props: Record<string, unknown>) =>
  JSON.stringify({
    type: "signal",
    interface: "com.canonical.Unity.LauncherEntry",
    member: "Update",
    payload: { type: "sa{sv}", data: [app, props] },
  });

describe("Telegram unread count", () => {
  test("window titles", () => {
    expect(unreadFromTitle("Telegram (3)")).toBe(3);
    expect(unreadFromTitle("Telegram")).toBe(0);
    expect(unreadFromTitle(" telegram (12) ")).toBe(12);
    expect(unreadFromTitle("Lucy Smith")).toBeNull();
    expect(unreadFromTitle("Media viewer")).toBeNull();
    expect(unreadFromTitle("")).toBeNull();
  });

  test("launcher signals", () => {
    expect(launcherUpdateFrom(HIDDEN)).toEqual({ visible: false });
    expect(
      launcherUpdateFrom(
        update("application://org.telegram.desktop.desktop", {
          count: { type: "x", data: 4 },
          "count-visible": { type: "b", data: true },
        }),
      ),
    ).toEqual({ count: 4, visible: true });
    // Another app's badge, a method call, and junk are ignored.
    expect(launcherUpdateFrom(update("application://org.gnome.Nautilus.desktop", { count: { type: "x", data: 2 } }))).toBeNull();
    expect(launcherUpdateFrom(JSON.stringify({ type: "method_call", member: "Update" }))).toBeNull();
    expect(launcherUpdateFrom("Monitoring bus message stream.")).toBeNull();
    expect(launcherUpdateFrom(update("application://org.telegram.desktop.desktop", {}))).toBeNull();
  });

  test("the last source to speak wins", () => {
    const seen: number[] = [];
    const t = new TelegramUnread((n) => seen.push(n));
    t.launcher({ visible: false });
    t.launcher({ count: 2, visible: true });
    t.launcher({ count: 5 }); // count alone keeps it visible
    t.launcher({ visible: false });
    expect(seen).toEqual([0, 2, 5, 0]);

    // Her Telegram window, opened after momd started.
    t.window(parseWindowEvent("openwindow>>a1,tile-telegram,org.telegram.desktop,")!);
    t.window(parseWindowEvent("windowtitlev2>>a1,Telegram (7)")!);
    // Another app's window titled like Telegram doesn't count.
    t.window(parseWindowEvent("openwindow>>b2,home,chromium,Telegram (99)")!);
    t.window(parseWindowEvent("windowtitlev2>>b2,Telegram (98)")!);
    // A call window's title isn't a count.
    t.window(parseWindowEvent("openwindow>>c3,tile-telegram,org.telegram.desktop,Lucy")!);
    t.window(parseWindowEvent("windowtitlev2>>a1,Telegram")!);
    expect(seen).toEqual([0, 2, 5, 0, 7, 0]);

    // A window already open when momd starts.
    t.known("0xd4", "org.telegram.desktop", "Telegram (1)");
    t.known("0xe5", "chromium", "Telegram (50)");
    expect(seen.at(-1)).toBe(1);
  });

  test("state.json carries it once known", () => {
    const m0 = initialModel();
    expect(toState(m0, 1).telegram).toBeUndefined();
    const r = reduce(m0, { type: "telegram", unread: 3 }, 1);
    expect(r.changed).toBe(true);
    expect(r.events).toEqual([]);
    const s = toState(r.model, 2);
    expect(s.telegram).toEqual({ unread: 3 });
    expect(State.safeParse(s).success).toBe(true);
    expect(reduce(r.model, { type: "telegram", unread: 3 }, 3).changed).toBe(false);
    expect(reduce(r.model, { type: "telegram", unread: -1 }, 3).model.telegramUnread).toBe(0);
  });
});
