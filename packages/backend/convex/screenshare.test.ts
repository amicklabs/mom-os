import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "./_generated/api";
import { queueAction } from "./lib/actions";
import { ADMIN, addDevice, newBackend, type Backend } from "./test.setup";

let t: Backend;

beforeEach(() => {
  vi.stubEnv("ADMIN_EMAILS", ADMIN.email);
  t = newBackend();
});
afterEach(() => {
  vi.unstubAllEnvs();
});

const session = {
  url: "wss://laptop.example.ts.net/",
  token: "a".repeat(64),
  control: false,
  startedAt: 1000,
  expiresAt: 1000 + 15 * 60_000,
  served: true,
};

describe("screen sharing", () => {
  it("the admin app can queue start and stop, and momd sees them", async () => {
    const { deviceId, token } = await addDevice(t);
    const admin = t.withIdentity(ADMIN);
    await admin.mutation(api.admin.queueAction, { deviceId, action: { type: "screen-share", op: "start", control: false, minutes: 15 } });
    await admin.mutation(api.admin.queueAction, { deviceId, action: { type: "screen-share", op: "stop" } });
    const pending = await t.query(api.device.pendingActions, { deviceToken: token });
    expect(pending.map((p) => p.action)).toEqual([
      { type: "screen-share", op: "start", control: false, minutes: 15 },
      { type: "screen-share", op: "stop" },
    ]);
  });

  it("refuses more than an hour", async () => {
    const { deviceId } = await addDevice(t);
    await expect(
      t.withIdentity(ADMIN).mutation(api.admin.queueAction, { deviceId, action: { type: "screen-share", op: "start", minutes: 120 } }),
    ).rejects.toThrow(/Invalid action/);
  });

  it("only the admin app may start it, not Telegram or the dispatcher", async () => {
    const { deviceId } = await addDevice(t);
    for (const source of ["telegram", "dispatcher", "device"] as const) {
      await expect(
        t.run((ctx) => queueAction(ctx, { deviceId, action: { type: "screen-share", op: "start" }, source })),
      ).rejects.toThrow(/only be started from the admin app/);
    }
  });

  it("needs a signed-in admin", async () => {
    const { deviceId } = await addDevice(t);
    await expect(t.mutation(api.admin.queueAction, { deviceId, action: { type: "screen-share", op: "start" } })).rejects.toThrow();
    await expect(t.query(api.admin.screenShare, { deviceId })).rejects.toThrow();
  });

  it("momd reports the session, and only the admin reads it back", async () => {
    const { deviceId, token } = await addDevice(t);
    const admin = t.withIdentity(ADMIN);
    expect(await admin.query(api.admin.screenShare, { deviceId })).toBeNull();

    await t.mutation(api.device.reportScreenShare, { deviceToken: token, session });
    expect(await admin.query(api.admin.screenShare, { deviceId })).toMatchObject(session);

    await t.mutation(api.device.reportScreenShare, { deviceToken: token, session: { ...session, control: true } });
    expect((await admin.query(api.admin.screenShare, { deviceId }))?.control).toBe(true);

    await t.mutation(api.device.reportScreenShare, { deviceToken: token, session: null });
    expect(await admin.query(api.admin.screenShare, { deviceId })).toBeNull();
  });

  it("rejects a malformed session or an unknown device", async () => {
    const { token } = await addDevice(t);
    await expect(
      t.mutation(api.device.reportScreenShare, { deviceToken: token, session: { ...session, url: "ws://example.com/" } }),
    ).rejects.toThrow(/Invalid screen-share session/);
    await expect(t.mutation(api.device.reportScreenShare, { deviceToken: "nope", session })).rejects.toThrow(/Unknown device/);
  });

  it("revoking the device forgets its token", async () => {
    const { deviceId, token } = await addDevice(t);
    await t.mutation(api.device.reportScreenShare, { deviceToken: token, session });
    await t.withIdentity(ADMIN).mutation(api.admin.revokeDevice, { deviceId });
    expect(await t.withIdentity(ADMIN).query(api.admin.screenShare, { deviceId })).toBeNull();
  });
});
