import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import type { JobStatus } from "../validators";

// queued -> investigating -> awaiting_approval -> approved -> fixing -> done,
// or failed / cancelled from any live state. Investigate-only jobs go
// investigating -> done. Staying in investigating or fixing renews the lease.
const TRANSITIONS: Record<JobStatus, readonly JobStatus[]> = {
  queued: ["investigating"],
  investigating: ["investigating", "awaiting_approval", "done"],
  awaiting_approval: ["approved"],
  approved: ["fixing"],
  fixing: ["fixing", "done"],
  done: [],
  failed: [],
  cancelled: [],
};

const TERMINAL: readonly JobStatus[] = ["done", "failed", "cancelled"];
const LEASED: readonly JobStatus[] = ["investigating", "fixing"];

export const MAX_PROMPT = 8000;
export const MAX_REPORT = 100_000;
export const DEFAULT_LEASE_MS = 5 * 60_000;
export const MAX_LEASE_MS = 60 * 60_000;
// A suggested message goes on her screen as a say action, which holds 280
// characters with the "Sam says: " prefix.
export const SUGGESTED_MAX = 260;

export function canTransition(from: JobStatus, to: JobStatus): boolean {
  if (TERMINAL.includes(from)) return false;
  if (to === "failed" || to === "cancelled") return true;
  return TRANSITIONS[from].includes(to);
}

export function isTerminal(status: JobStatus): boolean {
  return TERMINAL.includes(status);
}

export function isLeased(status: JobStatus): boolean {
  return LEASED.includes(status);
}

export async function createJob(
  ctx: MutationCtx,
  args: {
    deviceId: Id<"devices">;
    kind: Doc<"jobs">["kind"];
    prompt: string;
    helpRequestId?: Id<"helpRequests">;
    source: Doc<"jobs">["source"];
    // "Investigate more": the job it follows, whose Claude session it resumes.
    parentJobId?: Id<"jobs">;
    resumeSessionId?: string;
  },
): Promise<Id<"jobs">> {
  const device = await ctx.db.get(args.deviceId);
  if (!device) throw new Error("Unknown device.");
  const prompt = args.prompt.trim();
  if (!prompt) throw new Error("A job needs a prompt.");
  if (prompt.length > MAX_PROMPT) throw new Error(`Prompt is longer than ${MAX_PROMPT} characters.`);
  if (args.helpRequestId) {
    const help = await ctx.db.get(args.helpRequestId);
    if (!help || help.deviceId !== args.deviceId) throw new Error("Help request not found for this device.");
  }
  const now = Date.now();
  return await ctx.db.insert("jobs", {
    deviceId: args.deviceId,
    kind: args.kind,
    prompt,
    helpRequestId: args.helpRequestId,
    source: args.source,
    status: "queued",
    createdAt: now,
    updatedAt: now,
    ...(args.parentJobId ? { parentJobId: args.parentJobId } : {}),
    ...(args.resumeSessionId ? { resumeSessionId: args.resumeSessionId } : {}),
  });
}

export async function approveJob(ctx: MutationCtx, jobId: Id<"jobs">): Promise<Doc<"jobs">> {
  const job = await ctx.db.get(jobId);
  if (!job) throw new Error("Job not found.");
  if (job.status !== "awaiting_approval") {
    throw new Error(`Job is ${job.status}, not awaiting approval.`);
  }
  await ctx.db.patch(jobId, {
    status: "approved",
    updatedAt: Date.now(),
    workerId: undefined,
    leaseExpiresAt: undefined,
  });
  return job;
}

export async function claimJob(
  ctx: MutationCtx,
  args: { jobId: Id<"jobs">; workerId: string; leaseMs: number },
): Promise<boolean> {
  const job = await ctx.db.get(args.jobId);
  if (!job) return false;
  const leaseMs = Math.min(Math.max(args.leaseMs, 10_000), MAX_LEASE_MS);
  const now = Date.now();
  let next: JobStatus;
  if (job.status === "queued") next = "investigating";
  else if (job.status === "approved") next = "fixing";
  else if (isLeased(job.status) && (job.leaseExpiresAt ?? 0) <= now) {
    // The previous worker's lease ran out; another worker may take over.
    next = job.status;
  } else return false;
  await ctx.db.patch(job._id, {
    status: next,
    workerId: args.workerId,
    leaseMs,
    leaseExpiresAt: now + leaseMs,
    updatedAt: now,
  });
  return true;
}

export async function updateJob(
  ctx: MutationCtx,
  args: {
    jobId: Id<"jobs">;
    workerId: string;
    status: JobStatus;
    report?: string;
    sessionId?: string;
    suggestedMessage?: string;
  },
): Promise<void> {
  const job = await ctx.db.get(args.jobId);
  if (!job) throw new Error("Job not found.");
  if (job.workerId !== args.workerId) throw new Error("This worker does not hold the job.");
  const now = Date.now();
  if (!canTransition(job.status, args.status)) {
    throw new Error(`Cannot move a job from ${job.status} to ${args.status}.`);
  }
  if (args.report !== undefined && args.report.length > MAX_REPORT) {
    throw new Error(`Report is longer than ${MAX_REPORT} characters.`);
  }
  const keepLease = isLeased(args.status);
  const leaseMs = job.leaseMs ?? DEFAULT_LEASE_MS;
  await ctx.db.patch(job._id, {
    status: args.status,
    updatedAt: now,
    report: args.report ?? job.report,
    sessionId: args.sessionId ?? job.sessionId,
    leaseExpiresAt: keepLease ? now + leaseMs : undefined,
    ...(args.suggestedMessage?.trim() ? { suggestedMessage: args.suggestedMessage.trim().slice(0, SUGGESTED_MAX) } : {}),
  });
  if (args.status === "awaiting_approval" || args.status === "done" || args.status === "failed") {
    await ctx.scheduler.runAfter(0, internal.telegram.sendJobReport, { jobId: job._id });
  }
}

export async function cancelJob(ctx: MutationCtx, jobId: Id<"jobs">): Promise<void> {
  const job = await ctx.db.get(jobId);
  if (!job) throw new Error("Job not found.");
  if (isTerminal(job.status)) return;
  await ctx.db.patch(jobId, {
    status: "cancelled",
    updatedAt: Date.now(),
    leaseExpiresAt: undefined,
  });
}
