import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { ADMIN, addDevice, newBackend, settings, type Backend } from "./test.setup";

let t: Backend;

beforeEach(() => {
  vi.stubEnv("ADMIN_EMAILS", ADMIN.email);
  t = newBackend();
});
afterEach(() => {
  vi.unstubAllEnvs();
});

const doctor = { text: "Doctor appointment", time: "14:00", leadMinutes: null, repeat: "none" as const, date: "2026-09-30" };

describe("reminders", () => {
  it("are saved by an admin and reach the device", async () => {
    const { deviceId, token } = await addDevice(t);
    const admin = t.withIdentity(ADMIN);
    const id = await admin.mutation(api.reminders.save, { deviceId, reminder: doctor });
    await admin.mutation(api.reminders.save, {
      deviceId,
      reminder: { text: "Take your pills", time: "08:30", leadMinutes: 60, repeat: "weekly", days: [5, 1, 1] },
    });
    const content = await t.query(api.device.content, { deviceToken: token });
    expect(content.reminders).toEqual([
      { id, ...doctor },
      expect.objectContaining({ text: "Take your pills", repeat: "weekly", days: [1, 5] }),
    ]);

    await admin.mutation(api.reminders.save, { deviceId, reminderId: id, reminder: { ...doctor, time: "15:00" } });
    await admin.mutation(api.reminders.remove, { reminderId: id });
    const after = await t.query(api.device.content, { deviceToken: token });
    expect(after.reminders.map((r) => r.text)).toEqual(["Take your pills"]);
  });

  it("are checked against the shared schema", async () => {
    const { deviceId } = await addDevice(t);
    const admin = t.withIdentity(ADMIN);
    await expect(admin.mutation(api.reminders.save, { deviceId, reminder: { ...doctor, time: "25:00" } })).rejects.toThrow("Invalid reminder");
    await expect(admin.mutation(api.reminders.save, { deviceId, reminder: { ...doctor, text: " " } })).rejects.toThrow("Invalid reminder");
    await expect(
      admin.mutation(api.reminders.save, { deviceId, reminder: { text: "x", time: "09:00", leadMinutes: null, repeat: "weekly", days: [] } }),
    ).rejects.toThrow("Invalid reminder");
    await expect(
      admin.mutation(api.reminders.save, { deviceId, reminder: { text: "x", time: "09:00", leadMinutes: null, repeat: "weekly", days: [7] } }),
    ).rejects.toThrow("Invalid reminder");
  });

  it("need an admin", async () => {
    const { deviceId } = await addDevice(t);
    await expect(t.mutation(api.reminders.save, { deviceId, reminder: doctor })).rejects.toThrow("Sign in required");
    await expect(t.withIdentity({ ...ADMIN, email: "someone@example.com" }).query(api.reminders.list, { deviceId })).rejects.toThrow("Admin");
  });

  it("stay with their own device", async () => {
    const a = await addDevice(t, "a");
    const b = await addDevice(t, "b");
    const admin = t.withIdentity(ADMIN);
    const id = await admin.mutation(api.reminders.save, { deviceId: a.deviceId, reminder: doctor });
    expect((await t.query(api.device.content, { deviceToken: b.token })).reminders).toEqual([]);
    await expect(admin.mutation(api.reminders.save, { deviceId: b.deviceId, reminderId: id, reminder: doctor })).rejects.toThrow("not found");
  });
});

describe("slideshow", () => {
  async function upload(type = "image/jpeg", bytes = 10) {
    return await t.run((ctx) => ctx.storage.store(new Blob([new Uint8Array(bytes)], { type })));
  }

  it("adds JPEG photos under generated names and lists them for the device", async () => {
    const { deviceId, token } = await addDevice(t);
    const admin = t.withIdentity(ADMIN);
    const added = await admin.mutation(api.slideshow.add, { deviceId, storageId: await upload() });
    await admin.mutation(api.slideshow.add, { deviceId, storageId: await upload() });
    if (!added.ok) throw new Error(added.error);
    const photoId = added.photoId;
    const { slideshow } = await t.query(api.device.content, { deviceToken: token });
    expect(slideshow).toHaveLength(2);
    for (const p of slideshow) {
      expect(p.fileName).toMatch(/^p-[a-z0-9]+-[0-9a-f]{8}\.jpg$/);
      expect(p.url).toMatch(/^https?:/);
    }
    expect(new Set(slideshow.map((p) => p.fileName)).size).toBe(2);
    const listed = await admin.query(api.slideshow.list, { deviceId });
    expect(listed[0]?.addedBy).toBe(ADMIN.email);

    await admin.mutation(api.slideshow.remove, { photoId });
    expect((await t.query(api.device.content, { deviceToken: token })).slideshow).toHaveLength(1);
    expect(await t.run((ctx) => ctx.db.system.query("_storage").collect())).toHaveLength(1);
  });

  it("refuses a photo over 3 MB and deletes the upload", async () => {
    const { deviceId } = await addDevice(t);
    const admin = t.withIdentity(ADMIN);
    const big = await admin.mutation(api.slideshow.add, { deviceId, storageId: await upload("image/jpeg", 3 * 1024 * 1024 + 1) });
    expect(big).toEqual({ ok: false, error: "Slideshow photos must be JPEG and under 3 MB." });
    expect(await t.run((ctx) => ctx.db.system.query("_storage").collect())).toHaveLength(0);
  });

  it("is refused to a revoked device", async () => {
    const { deviceId, token } = await addDevice(t);
    await t.withIdentity(ADMIN).mutation(api.admin.revokeDevice, { deviceId });
    await expect(t.query(api.device.content, { deviceToken: token })).rejects.toThrow("revoked");
  });
});

describe("family photos", () => {
  // convex-test doesn't record an upload's content type, so set it here.
  async function upload(type = "image/jpeg", bytes = 10) {
    return await t.run(async (ctx) => {
      const id = await ctx.storage.store(new Blob([new Uint8Array(bytes)], { type }));
      await ctx.db.patch(id as unknown as Id<"settings">, { contentType: type } as never);
      return id;
    });
  }
  const stored = () => t.run((ctx) => ctx.db.system.query("_storage").collect());

  it("replaces a member's photo and deletes the old file", async () => {
    const { deviceId, token } = await addDevice(t);
    const admin = t.withIdentity(ADMIN);
    await admin.mutation(api.admin.updateSettings, { deviceId, settings });
    await admin.mutation(api.admin.setFamilyPhoto, { deviceId, memberId: "lucy", storageId: await upload("image/png") });
    const second = await admin.mutation(api.admin.setFamilyPhoto, { deviceId, memberId: "lucy", storageId: await upload() });
    expect(second).toEqual({ ok: true, fileName: "lucy.jpg" });
    const got = await t.query(api.device.settings, { deviceToken: token });
    expect(got?.family[0]?.photo).toBe("lucy.jpg");
    expect(await stored()).toHaveLength(1);
  });

  it("refuses a bad file or unknown member and deletes the upload", async () => {
    const { deviceId } = await addDevice(t);
    const admin = t.withIdentity(ADMIN);
    const early = await admin.mutation(api.admin.setFamilyPhoto, { deviceId, memberId: "lucy", storageId: await upload() });
    expect(early).toEqual({ ok: false, error: "Save the family member before adding a photo." });
    await admin.mutation(api.admin.updateSettings, { deviceId, settings });
    const gif = await admin.mutation(api.admin.setFamilyPhoto, { deviceId, memberId: "lucy", storageId: await upload("image/gif") });
    expect(gif).toEqual({ ok: false, error: "Photos must be JPEG, PNG or WebP and under 5 MB." });
    const big = await admin.mutation(api.admin.setFamilyPhoto, {
      deviceId,
      memberId: "lucy",
      storageId: await upload("image/jpeg", 5 * 1024 * 1024 + 1),
    });
    expect(big.ok).toBe(false);
    expect(await stored()).toHaveLength(0);
  });
});
