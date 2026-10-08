import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "./_generated/api";
import { RETENTION_MS } from "./cleanup";
import { addDevice, newBackend, status, type Backend } from "./test.setup";

let t: Backend;

beforeEach(() => {
  t = newBackend();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("events", () => {
  it("ignores duplicate event ids, across and within batches", async () => {
    const { deviceId, token } = await addDevice(t);
    const first = await t.mutation(api.device.ingestEvents, {
      deviceToken: token,
      events: [
        { id: "e1", at: 1, type: "boot" },
        { id: "e2", at: 2, type: "power", percent: 80, charging: true },
        { id: "e2", at: 2, type: "power", percent: 80, charging: true },
      ],
    });
    expect(first.accepted).toBe(2);
    const second = await t.mutation(api.device.ingestEvents, {
      deviceToken: token,
      events: [
        { id: "e2", at: 2, type: "power", percent: 80, charging: true },
        { id: "e3", at: 3, type: "lid", closed: true },
      ],
    });
    expect(second.accepted).toBe(1);
    const stored = await t.run((ctx) =>
      ctx.db.query("events").withIndex("by_device_and_at", (q) => q.eq("deviceId", deviceId)).collect(),
    );
    expect(stored.map((e) => e.eventId)).toEqual(["e1", "e2", "e3"]);
  });

  it("keeps the same event id separate per device", async () => {
    const a = await addDevice(t, "a");
    const b = await addDevice(t, "b");
    const ev = [{ id: "same", at: 1, type: "boot" as const }];
    expect((await t.mutation(api.device.ingestEvents, { deviceToken: a.token, events: ev })).accepted).toBe(1);
    expect((await t.mutation(api.device.ingestEvents, { deviceToken: b.token, events: ev })).accepted).toBe(1);
  });

  it("refuses more than 100 events per call", async () => {
    const { token } = await addDevice(t);
    const events = Array.from({ length: 101 }, (_, i) => ({ id: `e${i}`, at: i, type: "boot" as const }));
    await expect(t.mutation(api.device.ingestEvents, { deviceToken: token, events })).rejects.toThrow("At most 100");
  });

  it("purges events and help screenshots older than 60 days", async () => {
    vi.useFakeTimers();
    const { token } = await addDevice(t);
    await t.mutation(api.device.ingestEvents, { deviceToken: token, events: [{ id: "old", at: 1, type: "boot" }] });
    const shot = await t.run((ctx) => ctx.storage.store(new Blob(["png"], { type: "image/png" })));
    const { helpRequestId } = await t.mutation(api.device.createHelpRequest, {
      deviceToken: token,
      screenshots: [shot],
      context: status,
    });
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    vi.setSystemTime(Date.now() + RETENTION_MS + 60_000);
    await t.mutation(api.device.ingestEvents, { deviceToken: token, events: [{ id: "new", at: 2, type: "boot" }] });
    await t.mutation(internal.cleanup.purgeEvents, {});
    await t.mutation(internal.cleanup.purgeHelpScreenshots, {});

    const left = await t.run((ctx) => ctx.db.query("events").collect());
    expect(left.map((e) => e.eventId)).toEqual(["new"]);
    const help = await t.run((ctx) => ctx.db.get(helpRequestId));
    expect(help?.screenshots).toEqual([]);
    expect(help?.hasScreenshots).toBe(false);
    expect(await t.run((ctx) => ctx.storage.get(shot))).toBeNull();
  });
});
