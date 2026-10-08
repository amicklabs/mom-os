import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { DeviceStatus, State } from "@momos/shared";
import { validatePending } from "../src/actions";
import { HELP_RESET_MS, heartbeatKey, initialModel, reduce, toState, toStatus, type Model, type Msg } from "../src/model";
import { EventQueue } from "../src/queue";

function run(msgs: Msg[], start: Model = initialModel(), now = 1000) {
  let m = start;
  const events: unknown[] = [];
  for (const msg of msgs) {
    const r = reduce(m, msg, now);
    m = r.model;
    events.push(...r.events);
  }
  return { m, events };
}

describe("reducer", () => {
  test("state and status validate against the shared schemas", () => {
    const { m } = run([
      { type: "network", online: true, dns: true, wifi: { ssid: "Home", signal: 70 } },
      { type: "battery", battery: { percent: 80, charging: false } },
      { type: "app", app: "youtube" },
    ]);
    expect(State.safeParse(toState(m, 5)).success).toBe(true);
    expect(DeviceStatus.safeParse(toStatus(m, 5, "0.1.0")).success).toBe(true);
  });

  test("events only on real changes", () => {
    const net = { type: "network", online: true, dns: true, wifi: { ssid: "Home", signal: 70 } } as const;
    const { events } = run([
      net,
      { ...net, wifi: { ssid: "Home", signal: 55 } }, // signal alone: no event
      { ...net, online: false },
      { type: "app", app: "youtube" },
      { type: "app", app: "youtube" },
      { type: "viewer", connected: false }, // already false
      { type: "viewer", connected: true },
    ]);
    expect(events.map((e) => (e as { type: string }).type)).toEqual(["network", "network", "app", "viewer"]);
  });

  test("power events on plug changes and every 5 points", () => {
    const b = (percent: number, charging = false) => ({ type: "battery", battery: { percent, charging } }) as const;
    const { events } = run([b(80), b(79), b(77), b(75), b(75, true), b(76, true)]);
    expect(events).toEqual([
      { type: "power", percent: 80, charging: false },
      { type: "power", percent: 75, charging: false },
      { type: "power", percent: 75, charging: true },
    ]);
  });

  test("lock from either source", () => {
    const { m, events } = run([
      { type: "lock", source: "shell", locked: true },
      { type: "lock", source: "other", locked: true },
      { type: "lock", source: "shell", locked: false },
    ]);
    expect(toStatus(m, 0, "x").locked).toBe(true);
    expect(events).toEqual([{ type: "lock", locked: true }]);
  });

  test("banners expire on tick and can be dismissed", () => {
    const banner = { id: "b1", kind: "message", text: "hi", until: 2000 } as const;
    let r = reduce(initialModel(), { type: "banner", banner }, 1000);
    expect(reduce(r.model, { type: "tick" }, 1500).model.banner).not.toBeNull();
    expect(reduce(r.model, { type: "tick" }, 2000).model.banner).toBeNull();
    expect(reduce(r.model, { type: "banner-dismiss", id: "other" }, 1500).model.banner).not.toBeNull();
    r = reduce(r.model, { type: "banner-dismiss" }, 1500);
    expect(r.model.banner).toBeNull();
  });

  test("help statuses log sent and failed", () => {
    const { m, events } = run([{ type: "help", status: "sending" }, { type: "help", status: "offline" }]);
    expect(m.help.status).toBe("offline");
    expect(events).toEqual([{ type: "help", stage: "failed" }]);
    expect(reduce(m, { type: "tick" }, 1000 + HELP_RESET_MS - 1).model.help.status).toBe("offline");
    expect(reduce(m, { type: "tick" }, 1000 + HELP_RESET_MS).model.help.status).toBe("idle");
  });

  test("heartbeat key ignores signal strength", () => {
    const a = run([{ type: "network", online: true, dns: true, wifi: { ssid: "H", signal: 70 } }]).m;
    const b = run([{ type: "network", online: true, dns: true, wifi: { ssid: "H", signal: 40 } }]).m;
    expect(heartbeatKey(a)).toBe(heartbeatKey(b));
  });
});

describe("event queue", () => {
  const db = () => `${mkdtempSync(`${tmpdir()}/q-`)}/q.sqlite`;

  test("add, peek, ack, dedupe", () => {
    const q = new EventQueue(db());
    q.add({ id: "a", at: 1, type: "boot" });
    q.add({ id: "b", at: 2, type: "lid", closed: true });
    q.add({ id: "a", at: 1, type: "boot" });
    expect(q.count()).toBe(2);
    expect(q.peek(10).map((e) => e.id)).toEqual(["a", "b"]);
    q.ack(["a"]);
    expect(q.peek(10).map((e) => e.id)).toEqual(["b"]);
  });

  test("capped, dropping the oldest", () => {
    const q = new EventQueue(db(), 50);
    for (let i = 0; i < 230; i++) q.add({ id: `e${i}`, at: i, type: "boot" });
    q.trim();
    expect(q.count()).toBe(50);
    expect(q.peek(1)[0]!.id).toBe("e180");
  });

  test("survives reopening", () => {
    const path = db();
    const q = new EventQueue(path);
    q.add({ id: "x", at: 1, type: "boot" });
    q.setMeta("k", "v");
    q.close();
    const q2 = new EventQueue(path);
    expect(q2.count()).toBe(1);
    expect(q2.getMeta("k")).toBe("v");
  });
});

describe("action validation", () => {
  test("allowlisted actions pass", () => {
    expect(validatePending({ _id: "1", action: { type: "say", text: "Hi Mom" } })).toMatchObject({ ok: true, action: { type: "say" } });
    expect(validatePending({ _id: "2", action: { type: "open", tileId: "youtube" } }).ok).toBe(true);
    expect(validatePending({ _id: "3", action: { type: "screenshot" } }).ok).toBe(true);
    expect(validatePending({ _id: "4", action: { type: "restart" }, createdAt: 5 })).toMatchObject({ ok: true, createdAt: 5 });
  });

  test("anything else is refused", () => {
    expect(validatePending({ _id: "1", action: { type: "exec", cmd: "rm -rf ~" } })).toMatchObject({ ok: false, id: "1" });
    expect(validatePending({ _id: "2", action: { type: "open", tileId: "../../etc" } }).ok).toBe(false);
    expect(validatePending({ _id: "3", action: { type: "say", text: "x".repeat(281) } }).ok).toBe(false);
    expect(validatePending({ action: { type: "home" } })).toMatchObject({ ok: false, id: null });
    expect(validatePending(null).ok).toBe(false);
  });
});
