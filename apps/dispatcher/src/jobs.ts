// Job shapes and the decisions the dispatcher makes about them. No I/O here,
// so it can be tested directly.

export type JobStatus =
  | "queued"
  | "investigating"
  | "awaiting_approval"
  | "approved"
  | "fixing"
  | "done"
  | "failed"
  | "cancelled";

export type JobKind = "investigate" | "fix";

// What dispatcher.pendingJobs returns per job (packages/backend/convex/dispatcher.ts).
export interface PendingJob {
  _id: string;
  deviceId: string;
  kind: JobKind;
  prompt: string;
  status: JobStatus;
  createdAt: number;
  helpRequestId?: string;
  sessionId?: string;
  // "Investigate more": resume this Claude session instead of starting one.
  resumeSessionId?: string;
  parentJobId?: string;
  report?: string;
  deviceName?: string | null;
  personName?: string | null;
  helperName?: string | null;
  helpRequest?: {
    createdAt: number;
    // When she pressed, if the request waited on the laptop while offline.
    askedAt?: number | null;
    context?: unknown;
    replies?: { text: string; at: number }[];
    // What she asked for: message, screenshot, call-me, voice.
    kinds?: string[];
    // Her own words from the Help pop-up.
    text?: string | null;
    hasVoice?: boolean;
    voiceSeconds?: number | null;
    note?: string | null;
    screenshotUrls?: (string | null)[];
  } | null;
}

export type Phase = "investigate" | "fix";

// Queued jobs get investigated. Approved jobs get fixed. The dispatcher never
// fixes anything that wasn't approved first, whatever the job's kind.
export function phaseFor(job: Pick<PendingJob, "status">): Phase | null {
  if (job.status === "queued") return "investigate";
  if (job.status === "approved") return "fix";
  return null;
}

// Oldest first, skipping jobs we've recently failed to claim.
export function pickJob(jobs: PendingJob[], skip: ReadonlyMap<string, number>, now = Date.now()): PendingJob | null {
  const ready = jobs
    .filter((j) => phaseFor(j) !== null)
    .filter((j) => (skip.get(j._id) ?? 0) <= now)
    .sort((a, b) => a.createdAt - b.createdAt);
  return ready[0] ?? null;
}

// The status a phase holds while it runs, which is what renewing the lease
// writes back.
export function runningStatus(phase: Phase): JobStatus {
  return phase === "investigate" ? "investigating" : "fixing";
}

export interface ClaudeResult {
  ok: boolean;
  text: string;
  sessionId: string | null;
  error: string | null;
  costUsd: number | null;
  turns: number | null;
}

// Parse `claude -p --output-format json`. It prints one JSON object with
// type "result"; tolerate stray lines around it.
export function parseClaudeOutput(stdout: string, exitCode: number, stderr = ""): ClaudeResult {
  let obj: Record<string, unknown> | null = null;
  const trimmed = stdout.trim();
  const candidates = [trimmed, ...trimmed.split("\n").reverse()];
  for (const c of candidates) {
    if (!c.startsWith("{")) continue;
    try {
      const parsed = JSON.parse(c);
      if (parsed && typeof parsed === "object") {
        obj = parsed as Record<string, unknown>;
        break;
      }
    } catch {}
  }
  if (!obj) {
    const detail = (stderr.trim() || trimmed).split("\n").slice(-5).join("\n");
    return { ok: false, text: "", sessionId: null, error: `claude exited ${exitCode} without a result${detail ? `: ${detail}` : ""}`, costUsd: null, turns: null };
  }
  const sessionId = typeof obj.session_id === "string" ? obj.session_id : null;
  const text = typeof obj.result === "string" ? obj.result : "";
  const isError = obj.is_error === true || (typeof obj.subtype === "string" && obj.subtype !== "success") || exitCode !== 0;
  const costUsd = typeof obj.total_cost_usd === "number" ? obj.total_cost_usd : null;
  const turns = typeof obj.num_turns === "number" ? obj.num_turns : null;
  if (isError) {
    const why = text || (typeof obj.subtype === "string" ? obj.subtype : `exit ${exitCode}`);
    return { ok: false, text, sessionId, error: `claude failed: ${why}`, costUsd, turns };
  }
  return { ok: true, text, sessionId, error: null, costUsd, turns };
}

export interface SplitReport {
  report: string;
  fixNeeded: boolean;
  // A message for her screen the agent suggests, if it wrote one.
  suggestedMessage: string | null;
}

// Longest suggestion kept; her screen shows 280 characters with the
// "<helper> says: " prefix.
export const SUGGESTED_MAX = 260;

// The investigate prompt asks for a last line "FIX NEEDED: yes" or "no". If
// it's missing, assume a fix is proposed so the helper gets asked, not
// skipped. An optional "MESSAGE FOR <name>: ..." line anywhere is taken out
// as the suggested message.
export function splitReport(text: string): SplitReport {
  const lines = text.trimEnd().split("\n");
  let suggestedMessage: string | null = null;
  for (let i = lines.length - 1; i >= 0; i--) {
    const m = /^\**\s*MESSAGE FOR [^:*]{1,40}:\**\s*(.+)$/i.exec(lines[i]!.trim());
    if (m) {
      const msg = m[1]!.trim().replace(/^["“](.*)["”]$/, "$1").replace(/\*+$/, "").trim();
      if (msg && !/^(none|n\/a|-)\.?$/i.test(msg)) suggestedMessage = msg.slice(0, SUGGESTED_MAX);
      lines.splice(i, 1);
      break;
    }
  }
  let fixNeeded = true;
  for (let i = lines.length - 1; i >= Math.max(0, lines.length - 3); i--) {
    const m = /^\**\s*FIX NEEDED:\s*(yes|no)\b/i.exec(lines[i]!.trim());
    if (m) {
      lines.splice(i, 1);
      fixNeeded = m[1]!.toLowerCase() === "yes";
      break;
    }
  }
  return { report: lines.join("\n").trim(), fixNeeded, suggestedMessage };
}

// After investigation: ask the helper to approve, or finish if nothing needs fixing.
export function statusAfterInvestigation(fixNeeded: boolean): JobStatus {
  return fixNeeded ? "awaiting_approval" : "done";
}

export const MAX_REPORT = 100_000;

export function clampReport(report: string): string {
  if (report.length <= MAX_REPORT) return report;
  return report.slice(0, MAX_REPORT - 40) + "\n\n[report cut to fit]";
}
