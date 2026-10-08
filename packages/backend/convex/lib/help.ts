import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { createJob, isTerminal } from "./jobs";
import { personName, settingsFor } from "./settings";

// Help requests: what she asked for, in words the helper and the agents read.

export type HelpKind = NonNullable<Doc<"helpRequests">["kinds"]>[number];

// Requests from before the pop-up carried no kinds and were a screenshot.
export function kindsOf(help: Pick<Doc<"helpRequests">, "kinds">): HelpKind[] {
  return help.kinds ?? ["screenshot"];
}

// The job prompt for a help request. The dispatcher adds her words and the
// laptop's state from the help request itself, so this says what to do. The
// helper's note, when he sent the agent with one, goes in as his own words.
export function helpJobPrompt(
  person: string,
  help: Pick<Doc<"helpRequests">, "kinds" | "text" | "voice">,
  note?: string,
  helper = "The helper",
): string {
  const kinds = kindsOf(help);
  const parts: string[] = [];
  if (help.text) parts.push(`${person} asked for help and wrote what's wrong. Find out what they mean and what went wrong.`);
  else if (kinds.includes("voice")) {
    parts.push(`${person} asked for help with a voice note. There is no transcript, so you can't hear it; find out from the screen, status and logs what they were doing and what might be wrong.`);
  } else parts.push(`${person} asked for help. Find out what they were doing and what went wrong.`);
  const said = note?.trim().slice(0, 2000);
  if (said) parts.push(`${helper}'s note for you:\n"""\n${said}\n"""`);
  parts.push("Use screenshots, status and logs. Do not change anything. Report what you found and propose a fix.");
  return parts.join(" ");
}

// Starts a read-only investigation for a help request, unless one is already
// running for it. Returns the job and whether it's new.
export async function investigateHelp(
  ctx: MutationCtx,
  args: {
    helpRequestId: Id<"helpRequests">;
    source: Doc<"jobs">["source"];
    instructions?: string;
  },
): Promise<{ jobId: Id<"jobs">; created: boolean }> {
  const help = await ctx.db.get(args.helpRequestId);
  if (!help) throw new Error("Help request not found.");
  // Without instructions, don't send a second agent after the same thing.
  if (!args.instructions?.trim()) {
    const jobs = await ctx.db
      .query("jobs")
      .withIndex("by_device_and_createdAt", (q) => q.eq("deviceId", help.deviceId).gte("createdAt", help.createdAt))
      .take(50);
    const live = jobs.find((j) => j.helpRequestId === help._id && !isTerminal(j.status));
    if (live) return { jobId: live._id, created: false };
  }
  const device = await ctx.db.get(help.deviceId);
  const person = device ? await personName(ctx, device) : "The person";
  const helper = (await settingsFor(ctx, help.deviceId))?.settings.helper.name;
  const jobId = await createJob(ctx, {
    deviceId: help.deviceId,
    kind: "investigate",
    prompt: helpJobPrompt(person, help, args.instructions, helper),
    helpRequestId: help._id,
    source: args.source,
  });
  return { jobId, created: true };
}

// "Investigate more": a new read-only job that resumes the earlier job's
// Claude session with the helper's instructions. An earlier job still waiting
// for approval is cancelled, since the follow-up replaces its report.
export async function investigateMore(
  ctx: MutationCtx,
  args: { jobId: Id<"jobs">; instructions: string; source: Doc<"jobs">["source"] },
): Promise<Id<"jobs">> {
  const job = await ctx.db.get(args.jobId);
  if (!job) throw new Error("Job not found.");
  const instructions = args.instructions.trim();
  if (!instructions) throw new Error("Say what the agent should look into.");
  if (job.status === "awaiting_approval") {
    await ctx.db.patch(job._id, { status: "cancelled", updatedAt: Date.now(), leaseExpiresAt: undefined });
  }
  // Without a session to resume, the earlier report goes in the prompt.
  const earlier = !job.sessionId && job.report ? `\n\nAn earlier agent reported:\n${job.report}` : "";
  return await createJob(ctx, {
    deviceId: job.deviceId,
    kind: "investigate",
    prompt: (instructions.slice(0, 2000) + earlier).slice(0, 7900),
    helpRequestId: job.helpRequestId,
    source: args.source,
    parentJobId: job._id,
    ...(job.sessionId ? { resumeSessionId: job.sessionId } : {}),
  });
}
