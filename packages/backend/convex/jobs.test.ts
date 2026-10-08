import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { MAX_LOST_LEASES } from "./cleanup";
import { ADMIN, addDevice, DISPATCHER_TOKEN, newBackend, type Backend } from "./test.setup";

let t: Backend;
const dispatcherToken = DISPATCHER_TOKEN;

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubEnv("ADMIN_EMAILS", ADMIN.email);
  vi.stubEnv("DISPATCHER_TOKEN", DISPATCHER_TOKEN);
  t = newBackend();
});
afterEach(async () => {
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

async function status(jobId: Id<"jobs">) {
  return (await t.run((ctx) => ctx.db.get(jobId)))?.status;
}

describe("job lifecycle", () => {
  it("runs investigate, approval and fix with leases", async () => {
    const { deviceId } = await addDevice(t);
    const jobId = await t.mutation(api.dispatcher.createJob, {
      dispatcherToken,
      deviceId,
      kind: "investigate",
      prompt: "Why is the screen black?",
    });
    let pending = await t.query(api.dispatcher.pendingJobs, { dispatcherToken });
    expect(pending.map((j) => j._id)).toEqual([jobId]);

    const lease = { dispatcherToken, jobId, leaseMs: 60_000 };
    expect(await t.mutation(api.dispatcher.claimJob, { ...lease, workerId: "w1" })).toBe(true);
    expect(await t.mutation(api.dispatcher.claimJob, { ...lease, workerId: "w2" })).toBe(false);
    expect(await status(jobId)).toBe("investigating");
    expect(await t.query(api.dispatcher.pendingJobs, { dispatcherToken })).toEqual([]);

    await expect(
      t.mutation(api.dispatcher.updateJob, { dispatcherToken, jobId, workerId: "w2", status: "done" }),
    ).rejects.toThrow("does not hold");
    await expect(
      t.mutation(api.dispatcher.updateJob, { dispatcherToken, jobId, workerId: "w1", status: "fixing" }),
    ).rejects.toThrow("Cannot move");

    await t.mutation(api.dispatcher.updateJob, {
      dispatcherToken,
      jobId,
      workerId: "w1",
      status: "awaiting_approval",
      report: "Chromium crashed. Restart it?",
      sessionId: "sess-1",
    });
    expect(await status(jobId)).toBe("awaiting_approval");
    expect(await t.mutation(api.dispatcher.claimJob, { ...lease, workerId: "w2" })).toBe(false);

    await t.withIdentity(ADMIN).mutation(api.admin.approveJob, { jobId });
    await expect(t.mutation(api.dispatcher.approveJob, { dispatcherToken, jobId })).rejects.toThrow(
      "not awaiting approval",
    );
    pending = await t.query(api.dispatcher.pendingJobs, { dispatcherToken });
    expect(pending[0]?.status).toBe("approved");
    expect(pending[0]?.sessionId).toBe("sess-1");

    expect(await t.mutation(api.dispatcher.claimJob, { ...lease, workerId: "w2" })).toBe(true);
    expect(await status(jobId)).toBe("fixing");
    await t.mutation(api.dispatcher.updateJob, { dispatcherToken, jobId, workerId: "w2", status: "done", report: "Fixed." });
    const job = await t.run((ctx) => ctx.db.get(jobId));
    expect(job?.status).toBe("done");
    expect(job?.report).toBe("Fixed.");
    expect(job?.leaseExpiresAt).toBeUndefined();

    await expect(
      t.mutation(api.dispatcher.updateJob, { dispatcherToken, jobId, workerId: "w2", status: "failed" }),
    ).rejects.toThrow("Cannot move");
  });

  it("lets investigate-only jobs finish straight from investigating", async () => {
    const { deviceId } = await addDevice(t);
    const jobId = await t.withIdentity(ADMIN).mutation(api.admin.createJob, { deviceId, kind: "investigate", prompt: "Look" });
    await t.mutation(api.dispatcher.claimJob, { dispatcherToken, jobId, workerId: "w1", leaseMs: 60_000 });
    await t.mutation(api.dispatcher.updateJob, { dispatcherToken, jobId, workerId: "w1", status: "done", report: "All fine." });
    expect(await status(jobId)).toBe("done");
  });

  it("returns a job to the queue when its lease runs out", async () => {
    const { deviceId } = await addDevice(t);
    const jobId = await t.mutation(api.dispatcher.createJob, { dispatcherToken, deviceId, kind: "fix", prompt: "Fix it" });
    await t.mutation(api.dispatcher.claimJob, { dispatcherToken, jobId, workerId: "w1", leaseMs: 60_000 });

    // Renewing the lease with a same-state update keeps it alive.
    vi.advanceTimersByTime(50_000);
    await t.mutation(api.dispatcher.updateJob, { dispatcherToken, jobId, workerId: "w1", status: "investigating" });
    vi.advanceTimersByTime(50_000);
    expect(await t.mutation(internal.cleanup.releaseExpiredLeases, {})).toBe(0);

    vi.advanceTimersByTime(20_000);
    expect(await t.mutation(internal.cleanup.releaseExpiredLeases, {})).toBe(1);
    expect(await status(jobId)).toBe("queued");
    expect(await t.mutation(api.dispatcher.claimJob, { dispatcherToken, jobId, workerId: "w2", leaseMs: 60_000 })).toBe(true);
    await expect(
      t.mutation(api.dispatcher.updateJob, { dispatcherToken, jobId, workerId: "w1", status: "done" }),
    ).rejects.toThrow("does not hold");
  });

  it("puts expired investigating and fixing jobs back in pendingJobs", async () => {
    const { deviceId } = await addDevice(t);
    const jobId = await t.mutation(api.dispatcher.createJob, { dispatcherToken, deviceId, kind: "fix", prompt: "Fix it" });
    const claim = (workerId: string) => t.mutation(api.dispatcher.claimJob, { dispatcherToken, jobId, workerId, leaseMs: 60_000 });
    const pendingIds = async () => (await t.query(api.dispatcher.pendingJobs, { dispatcherToken })).map((j) => j._id);

    // Investigating: the worker dies, the lease runs out, the job is queued again.
    await claim("w1");
    expect(await pendingIds()).toEqual([]);
    vi.advanceTimersByTime(61_000);
    await t.mutation(internal.cleanup.releaseExpiredLeases, {});
    expect(await pendingIds()).toEqual([jobId]);

    // Fixing: same, back to approved.
    await claim("w2");
    await t.mutation(api.dispatcher.updateJob, { dispatcherToken, jobId, workerId: "w2", status: "awaiting_approval", report: "Plan" });
    await t.mutation(api.dispatcher.approveJob, { dispatcherToken, jobId });
    await claim("w2");
    expect(await status(jobId)).toBe("fixing");
    expect(await pendingIds()).toEqual([]);
    vi.advanceTimersByTime(61_000);
    await t.mutation(internal.cleanup.releaseExpiredLeases, {});
    expect(await status(jobId)).toBe("approved");
    expect(await pendingIds()).toEqual([jobId]);
  });

  it("fails a job that keeps losing its worker", async () => {
    const { deviceId } = await addDevice(t);
    const jobId = await t.mutation(api.dispatcher.createJob, { dispatcherToken, deviceId, kind: "investigate", prompt: "Look" });
    for (let i = 1; i < MAX_LOST_LEASES; i++) {
      expect(await t.mutation(api.dispatcher.claimJob, { dispatcherToken, jobId, workerId: `w${i}`, leaseMs: 60_000 })).toBe(true);
      vi.advanceTimersByTime(61_000);
      await t.mutation(internal.cleanup.releaseExpiredLeases, {});
      expect(await status(jobId)).toBe("queued");
    }
    await t.mutation(api.dispatcher.claimJob, { dispatcherToken, jobId, workerId: "last", leaseMs: 60_000 });
    vi.advanceTimersByTime(61_000);
    await t.mutation(internal.cleanup.releaseExpiredLeases, {});
    const job = await t.run((ctx) => ctx.db.get(jobId));
    expect(job?.status).toBe("failed");
    expect(job?.lostLeases).toBe(MAX_LOST_LEASES);
    expect(job?.report).toContain("lost this job");
    expect(await t.query(api.dispatcher.pendingJobs, { dispatcherToken })).toEqual([]);
  });

  it("can cancel from any live state", async () => {
    const { deviceId } = await addDevice(t);
    const jobId = await t.withIdentity(ADMIN).mutation(api.admin.createJob, { deviceId, kind: "investigate", prompt: "Look" });
    await t.withIdentity(ADMIN).mutation(api.admin.cancelJob, { jobId });
    expect(await status(jobId)).toBe("cancelled");
    expect(await t.mutation(api.dispatcher.claimJob, { dispatcherToken, jobId, workerId: "w1", leaseMs: 60_000 })).toBe(false);
  });
});
