import { convexTest } from "convex-test";
import type { Id } from "./_generated/dataModel";
import { sha256Hex } from "./lib/auth";
import schema from "./schema";
import type { DeviceStatusDoc, SettingsDoc } from "./validators";

declare global {
  interface ImportMeta {
    glob(pattern: string): Record<string, () => Promise<unknown>>;
  }
}

export const modules = import.meta.glob("./**/*.*s");

export const ADMIN = { email: "admin@example.com", emailVerified: true, subject: "user_admin" };
export const DISPATCHER_TOKEN = "dispatcher-secret";
export const WEBHOOK_SECRET = "webhook-secret";
export const ADMIN_TG_ID = "1001";

export function newBackend() {
  return convexTest(schema, modules);
}
export type Backend = ReturnType<typeof newBackend>;

export async function addDevice(t: Backend, token = "device-token", name = "laptop") {
  const tokenHash = await sha256Hex(token);
  const deviceId: Id<"devices"> = await t.run((ctx) =>
    ctx.db.insert("devices", { name, tokenHash, createdAt: Date.now() }),
  );
  return { deviceId, token };
}

export const status: DeviceStatusDoc = {
  at: 1,
  app: "youtube",
  online: true,
  wifi: { ssid: "home", signal: 70 },
  battery: { percent: 54, charging: false },
  viewer: false,
  locked: false,
  lidClosed: false,
  version: "0.1.0",
};

export const settings: SettingsDoc = {
  person: { name: "Mom", user: "mom" },
  helper: { name: "Sam", phone: "555-555-0100" },
  tiles: [
    { id: "youtube", label: "YouTube", type: "webapp", url: "https://www.youtube.com" },
    { id: "internet", label: "Browser", type: "app", app: "chromium" },
  ],
  family: [{ id: "lucy", name: "Lucy", telegram: "example_user" }],
};
