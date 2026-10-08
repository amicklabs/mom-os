import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { Action, DeviceEvent, ScreenShareSession, State } from "@momos/shared";
import { Core } from "../src/core";
import { initialModel, reduce, toState } from "../src/model";
import { EventQueue } from "../src/queue";
import { makeRunner } from "../src/runner";
import { clampMinutes, ScreenShare, type ScreenShareDeps, servedFrom, tokenFromProtocols, tokenMatches } from "../src/screenshare";
import { noBackend } from "../src/convex";

const newCore = () => new Core(new EventQueue(`${mkdtempSync(`${tmpdir()}/c-`)}/q.sqlite`), "test");

describe("helpers", () => {
  test("the token comes from the subprotocols, next to binary", () => {
    expect(tokenFromProtocols("binary, momos.abc")).toBe("abc");
    expect(tokenFromProtocols("momos.abc,binary")).toBe("abc");
    expect(tokenFromProtocols("momos.abc")).toBeNull();
    expect(tokenFromProtocols("binary")).toBeNull();
    expect(tokenFromProtocols(null)).toBeNull();
  });

  test("tokens compare exactly", () => {
    expect(tokenMatches("a".repeat(64), "a".repeat(64))).toBe(true);
    expect(tokenMatches("a".repeat(63) + "b", "a".repeat(64))).toBe(false);
    expect(tokenMatches("a", "a".repeat(64))).toBe(false);
    expect(tokenMatches(null, "a".repeat(64))).toBe(false);
  });

  test("tailscale serve status must pass 443 on this name to our port", () => {
    const status = { TCP: { "443": { HTTPS: true } }, Web: { "laptop.example.ts.net:443": { Handlers: { "/": { Proxy: "http://127.0.0.1:5901" } } } } };
    expect(servedFrom(status, "laptop.example.ts.net", 5901)).toBe(true);
    expect(servedFrom(status, "other.example.ts.net", 5901)).toBe(false);
    expect(servedFrom(status, "laptop.example.ts.net", 5902)).toBe(false);
    expect(servedFrom({}, "laptop.example.ts.net", 5901)).toBe(false);
    expect(servedFrom(null, "laptop.example.ts.net", 5901)).toBe(false);
  });

  test("minutes stay between 1 and 60, 15 by default", () => {
    expect(clampMinutes(undefined)).toBe(15);
    expect(clampMinutes(0)).toBe(1);
    expect(clampMinutes(500)).toBe(60);
  });

  test("the action schema takes start and stop and nothing else", () => {
    expect(Action.safeParse({ type: "screen-share", op: "start", control: false, minutes: 15 }).success).toBe(true);
    expect(Action.safeParse({ type: "screen-share", op: "stop" }).success).toBe(true);
    expect(Action.safeParse({ type: "screen-share", op: "start", minutes: 61 }).success).toBe(false);
    expect(Action.safeParse({ type: "screen-share", op: "run", command: "sh" }).success).toBe(false);
  });
});

describe("viewer state", () => {
  test("VNC always has control; a browser only when the session allows it", () => {
    let m = initialModel();
    const step = (msg: Parameters<typeof reduce>[1]) => {
      const r = reduce(m, msg, 1000);
      m = r.model;
      return r.events;
    };
    expect(step({ type: "viewer", via: "web", connected: true, control: false })).toEqual([
      { type: "viewer", connected: true, control: false, via: "web" },
    ]);
    expect(m.viewer).toEqual({ connected: true, since: 1000, control: false });
    expect(step({ type: "viewer", via: "web", connected: true, control: true })).toHaveLength(1);
    expect(m.viewer.control).toBe(true);
    step({ type: "viewer", via: "web", connected: true, control: false });
    step({ type: "viewer", connected: true }); // TigerVNC
    expect(m.viewer.control).toBe(true);
    step({ type: "viewer", connected: false });
    expect(m.viewer).toEqual({ connected: true, since: 1000, control: false });
    step({ type: "viewer", via: "web", connected: false });
    expect(m.viewer).toEqual({ connected: false, since: null, control: false });
    expect(State.safeParse(toState(m, 5)).success).toBe(true);
  });

  test("viewer events still parse", () => {
    expect(DeviceEvent.safeParse({ id: "1", at: 1, type: "viewer", connected: true }).success).toBe(true);
    expect(DeviceEvent.safeParse({ id: "1", at: 1, type: "viewer", connected: true, control: false, via: "web" }).success).toBe(true);
  });
});

// A fake wayvnc: a Unix socket server that answers with "RFB" and echoes.
function fakeDeps(dir: string, spawned: { viewOnly: boolean }[], overrides: Partial<ScreenShareDeps> = {}): ScreenShareDeps {
  return {
    spawnVnc(opts) {
      spawned.push({ viewOnly: opts.viewOnly });
      const server = Bun.listen({
        unix: opts.socket,
        socket: {
          open(s) {
            s.write("RFB 003.008\n");
          },
          data(s, d) {
            s.write(d);
          },
        },
      });
      let done: (code: number) => void = () => {};
      const exited = new Promise<number>((r) => (done = r));
      return {
        exited,
        kill() {
          server.stop(true);
          rmSync(opts.socket, { force: true });
          done(0);
        },
      };
    },
    dnsName: async () => "laptop.example.ts.net",
    served: async () => true,
    wake: async () => {},
    now: () => Date.now(),
    port: 0,
    dir,
    requireTailnetUser: true,
    ...overrides,
  };
}

function connect(port: number, protocols: string[], login: string | null = "helper@example.com") {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/`, { protocols, headers: login ? { "Tailscale-User-Login": login } : {} } as unknown as string[]);
  ws.binaryType = "arraybuffer";
  const received: string[] = [];
  const opened = new Promise<boolean>((resolve) => {
    ws.onopen = () => resolve(true);
    ws.onerror = () => resolve(false);
    ws.onclose = () => resolve(false);
  });
  const closed = new Promise<number>((resolve) => ws.addEventListener("close", (e) => resolve(e.code)));
  ws.onmessage = (e) => received.push(new TextDecoder().decode(e.data as ArrayBuffer));
  return { ws, received, opened, closed };
}

const until = async (fn: () => boolean, ms = 2000) => {
  const end = Date.now() + ms;
  while (!fn()) {
    if (Date.now() > end) throw new Error("timed out waiting");
    await Bun.sleep(10);
  }
};

describe("a session", () => {
  let share: ScreenShare | null = null;
  afterEach(async () => {
    await share?.stop("test over");
    share = null;
  });

  test("nothing listens until it starts, and the token lets a browser in", async () => {
    const core = newCore();
    const spawned: { viewOnly: boolean }[] = [];
    share = new ScreenShare(core, fakeDeps(mkdtempSync(`${tmpdir()}/ss-`), spawned));
    expect(share.current()).toBeNull();
    expect(share.listeningPort()).toBeNull();

    const r = await share.start({ minutes: 15 });
    expect(r.ok).toBe(true);
    expect(r.result).toContain("view only");
    const s = share.current()!;
    expect(ScreenShareSession.safeParse(s).success).toBe(true);
    expect(s.url).toBe("wss://laptop.example.ts.net/");
    expect(s.control).toBe(false);
    expect(spawned).toEqual([{ viewOnly: true }]);
    const port = share.listeningPort()!;

    // No token, a wrong one, or no Tailscale user: refused.
    expect(await connect(port, ["binary"]).opened).toBe(false);
    expect(await connect(port, ["binary", `momos.${"0".repeat(64)}`]).opened).toBe(false);
    expect(await connect(port, ["binary", `momos.${s.token}`], null).opened).toBe(false);
    expect(core.model.viewer.connected).toBe(false);

    const c = connect(port, ["binary", `momos.${s.token}`]);
    expect(await c.opened).toBe(true);
    expect(c.ws.protocol).toBe("binary");
    await until(() => c.received.join("").startsWith("RFB"));
    c.ws.send(new TextEncoder().encode("hello"));
    await until(() => c.received.join("").includes("hello"));
    expect(core.model.viewer).toMatchObject({ connected: true, control: false });

    c.ws.close();
    await until(() => !core.model.viewer.connected);
  });

  test("control restarts wayvnc with input on, and stop closes everything", async () => {
    const core = newCore();
    const spawned: { viewOnly: boolean }[] = [];
    share = new ScreenShare(core, fakeDeps(mkdtempSync(`${tmpdir()}/ss-`), spawned));
    await share.start({ control: false });
    const token = share.current()!.token;
    const port = share.listeningPort()!;
    const c = connect(port, ["binary", `momos.${token}`]);
    expect(await c.opened).toBe(true);
    await until(() => core.model.viewer.connected);

    const r = await share.start({ control: true, minutes: 30 });
    expect(r.result).toContain("with control");
    expect(spawned).toEqual([{ viewOnly: true }, { viewOnly: false }]);
    // Same token; the browser was dropped and reconnects.
    expect(share.current()!.token).toBe(token);
    expect(await c.closed).toBe(4001);
    const c2 = connect(port, ["binary", `momos.${token}`]);
    expect(await c2.opened).toBe(true);
    await until(() => core.model.viewer.control);

    await share.stop("done");
    expect(share.current()).toBeNull();
    await until(() => !core.model.viewer.connected);
    expect(core.model.viewer.control).toBe(false);
    expect(await connect(port, ["binary", `momos.${token}`]).opened).toBe(false);
  });

  test("a start that waited too long is refused", async () => {
    share = new ScreenShare(newCore(), fakeDeps(mkdtempSync(`${tmpdir()}/ss-`), []));
    const r = await share.start({ createdAt: Date.now() - 3 * 60_000 });
    expect(r.ok).toBe(false);
    expect(share.current()).toBeNull();
  });

  test("without Tailscale it doesn't start", async () => {
    share = new ScreenShare(newCore(), fakeDeps(mkdtempSync(`${tmpdir()}/ss-`), [], { dnsName: async () => null }));
    const r = await share.start({});
    expect(r.ok).toBe(false);
    expect(share.listeningPort()).toBeNull();
  });

  test("the runner starts and stops it", async () => {
    const core = newCore();
    share = new ScreenShare(core, fakeDeps(mkdtempSync(`${tmpdir()}/ss-`), []));
    const runAction = makeRunner(core, () => noBackend, share);
    expect((await runAction("a1", { type: "screen-share", op: "start", minutes: 5 }, { createdAt: Date.now() })).ok).toBe(true);
    expect(share.current()).not.toBeNull();
    expect(await runAction("a2", { type: "screen-share", op: "stop" }, { createdAt: Date.now() })).toEqual({ ok: true, result: "stopped" });
    expect(share.current()).toBeNull();
  });
});
