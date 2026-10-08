import { describe, expect, test } from "bun:test";
import { activeSession, extendedMinutes, KEYSYM, keysymFor, keysymsFor, minutesLeft, pingUrl } from "./screen-share";

const session = { url: "wss://laptop.example.ts.net/", token: "t", control: false, served: true, expiresAt: 10 * 60_000 };

describe("sessions", () => {
  test("a session counts until it ends", () => {
    expect(activeSession(session, 0)).toBe(session);
    expect(activeSession(session, 10 * 60_000)).toBeNull();
    expect(activeSession(null, 0)).toBeNull();
    expect(activeSession(undefined, 0)).toBeNull();
  });

  test("minutes left round up and extending caps at an hour", () => {
    expect(minutesLeft(session, 0)).toBe(10);
    expect(minutesLeft(session, 9 * 60_000 + 1)).toBe(1);
    expect(minutesLeft(session, 11 * 60_000)).toBe(1);
    expect(extendedMinutes(session, 0)).toBe(25);
    expect(extendedMinutes({ expiresAt: 55 * 60_000 }, 0)).toBe(60);
  });

  test("the ping address comes from the WebSocket address", () => {
    expect(pingUrl("wss://laptop.example.ts.net/")).toBe("https://laptop.example.ts.net/ping");
    expect(pingUrl("wss://laptop.example.ts.net:8443/")).toBe("https://laptop.example.ts.net:8443/ping");
    expect(pingUrl("ws://laptop/")).toBeNull();
  });
});

describe("keysyms", () => {
  test("Latin-1 is its own keysym, the rest is offset", () => {
    expect(keysymFor("a")).toBe(0x61);
    expect(keysymFor(" ")).toBe(0x20);
    expect(keysymFor("é")).toBe(0xe9);
    expect(keysymFor("€")).toBe(0x010020ac);
    expect(keysymFor("😀")).toBe(0x0101f600);
  });

  test("newline and tab are keys; other control characters are dropped", () => {
    expect(keysymsFor("a\nb\tc\u0007")).toEqual([0x61, KEYSYM.Return, 0x62, KEYSYM.Tab, 0x63]);
  });
});
