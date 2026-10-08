import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "./_generated/api";
import { newBackend, settings, status, type Backend } from "./test.setup";

let t: Backend;

beforeEach(() => {
  t = newBackend();
});
afterEach(() => {
  vi.unstubAllEnvs();
});

describe("provision", () => {
  it("creates a device whose token works, with its settings", async () => {
    const { deviceId, token } = await t.action(internal.provision.createDevice, {
      name: " mom ",
      settings: { ...settings, local: { convexUrl: "https://example.convex.cloud" } },
    });
    expect(token).toMatch(/^momos_/);
    await t.mutation(api.device.heartbeat, { deviceToken: token, status });
    const s = await t.query(api.device.settings, { deviceToken: token });
    expect(s?.person.name).toBe("Mom");
    expect(s && "local" in s).toBe(false);
    const list = await t.query(internal.provision.listDevices, {});
    expect(list).toEqual([expect.objectContaining({ _id: deviceId, name: "mom", revoked: false })]);
  });

  it("rejects bad settings without creating a device", async () => {
    await expect(
      t.action(internal.provision.createDevice, { name: "mom", settings: { person: { name: "" } } }),
    ).rejects.toThrow("Invalid settings");
    expect(await t.query(internal.provision.listDevices, {})).toEqual([]);
  });
});
