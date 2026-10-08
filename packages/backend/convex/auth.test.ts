import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "./_generated/api";
import { ADMIN, addDevice, DISPATCHER_TOKEN, newBackend, settings, status, type Backend } from "./test.setup";

let t: Backend;

beforeEach(() => {
  vi.stubEnv("ADMIN_EMAILS", "Other@example.com, admin@example.com");
  vi.stubEnv("DISPATCHER_TOKEN", DISPATCHER_TOKEN);
  t = newBackend();
});
afterEach(() => vi.unstubAllEnvs());

describe("device auth", () => {
  it("accepts a known token and records the heartbeat", async () => {
    const { deviceId, token } = await addDevice(t);
    const res = await t.mutation(api.device.heartbeat, { deviceToken: token, status });
    expect(res.serverTime).toBeTypeOf("number");
    const device = await t.run((ctx) => ctx.db.get(deviceId));
    expect(device?.status?.app).toBe("youtube");
    expect(device?.lastSeenAt).toBe(res.serverTime);
  });

  it("rejects unknown and empty tokens", async () => {
    await addDevice(t);
    await expect(t.mutation(api.device.heartbeat, { deviceToken: "nope", status })).rejects.toThrow("Unknown device");
    await expect(t.query(api.device.pendingActions, { deviceToken: "" })).rejects.toThrow("Unknown device");
  });

  it("rejects a revoked device", async () => {
    const { deviceId, token } = await addDevice(t);
    await t.withIdentity(ADMIN).mutation(api.admin.revokeDevice, { deviceId });
    await expect(t.query(api.device.settings, { deviceToken: token })).rejects.toThrow("revoked");
  });

  it("only lets a device complete its own actions", async () => {
    const a = await addDevice(t, "token-a");
    const b = await addDevice(t, "token-b");
    const actionId = await t.withIdentity(ADMIN).mutation(api.admin.queueAction, {
      deviceId: a.deviceId,
      action: { type: "home" },
    });
    await expect(
      t.mutation(api.device.completeAction, { deviceToken: b.token, actionId, ok: true }),
    ).rejects.toThrow("not found");
    await t.mutation(api.device.completeAction, { deviceToken: a.token, actionId, ok: true });
    expect(await t.query(api.device.pendingActions, { deviceToken: a.token })).toEqual([]);
  });
});

describe("dispatcher auth", () => {
  it("accepts the right token", async () => {
    const res = await t.query(api.dispatcher.overview, { dispatcherToken: DISPATCHER_TOKEN });
    expect(res.devices).toEqual([]);
  });

  it("rejects a wrong or empty token", async () => {
    await expect(t.query(api.dispatcher.pendingJobs, { dispatcherToken: "dispatcher-secreT" })).rejects.toThrow(
      "Invalid dispatcher token",
    );
    await expect(t.query(api.dispatcher.pendingJobs, { dispatcherToken: "" })).rejects.toThrow("Invalid dispatcher token");
  });

  it("rejects everything when DISPATCHER_TOKEN is unset", async () => {
    vi.stubEnv("DISPATCHER_TOKEN", "");
    await expect(t.query(api.dispatcher.pendingJobs, { dispatcherToken: "" })).rejects.toThrow("Invalid dispatcher token");
  });
});

describe("admin auth", () => {
  it("rejects signed-out callers", async () => {
    await expect(t.query(api.admin.overview, {})).rejects.toThrow("Sign in required");
  });

  it("rejects emails not in ADMIN_EMAILS and unverified emails", async () => {
    await expect(
      t.withIdentity({ email: "someone@example.com", emailVerified: true }).query(api.admin.overview, {}),
    ).rejects.toThrow("Admin access");
    await expect(
      t.withIdentity({ email: "admin@example.com", emailVerified: false }).query(api.admin.overview, {}),
    ).rejects.toThrow("Admin access");
  });

  it("matches ADMIN_EMAILS case-insensitively", async () => {
    const who = await t.withIdentity({ email: "other@EXAMPLE.com", emailVerified: true }).query(api.admin.whoami, {});
    expect(who.isAdmin).toBe(true);
  });

  it("creates a device whose token works once and is stored only as a hash", async () => {
    const { deviceId, token } = await t.withIdentity(ADMIN).action(api.admin.createDevice, { name: "Mom's laptop" });
    expect(token).toMatch(/^momos_[A-Za-z0-9_-]{43}$/);
    const device = await t.run((ctx) => ctx.db.get(deviceId));
    expect(device?.tokenHash).not.toContain(token);
    await t.mutation(api.device.heartbeat, { deviceToken: token, status });
  });
});

describe("settings", () => {
  it("validates settings with the shared zod schema", async () => {
    const { deviceId, token } = await addDevice(t);
    const admin = t.withIdentity(ADMIN);
    const bad = { ...settings, tiles: [{ id: "x", label: "X", type: "webapp" as const, url: "http://example.com" }] };
    await expect(admin.mutation(api.admin.updateSettings, { deviceId, settings: bad })).rejects.toThrow("Invalid settings");
    const unknownApp = { ...settings, tiles: [{ id: "x", label: "X", type: "app" as const, app: "bash" }] };
    await expect(admin.mutation(api.admin.updateSettings, { deviceId, settings: unknownApp })).rejects.toThrow(
      "Invalid settings",
    );

    expect(await t.query(api.device.settings, { deviceToken: token })).toBeNull();
    await admin.mutation(api.admin.updateSettings, { deviceId, settings });
    const got = await t.query(api.device.settings, { deviceToken: token });
    expect(got?.person.name).toBe("Mom");
    expect(got?.photos).toEqual([]);
  });

  it("rejects actions outside the allowlist rules", async () => {
    const { deviceId } = await addDevice(t);
    const admin = t.withIdentity(ADMIN);
    await admin.mutation(api.admin.updateSettings, { deviceId, settings });
    await expect(
      admin.mutation(api.admin.queueAction, { deviceId, action: { type: "say", text: "" } }),
    ).rejects.toThrow("Invalid action");
    await expect(
      admin.mutation(api.admin.queueAction, { deviceId, action: { type: "open", tileId: "missing" } }),
    ).rejects.toThrow("No tile");
    await admin.mutation(api.admin.queueAction, { deviceId, action: { type: "open", tileId: "youtube" } });
  });
});
