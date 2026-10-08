import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { buildClaudeArgs, runClaude } from "./claude";
import {
  clampReport,
  parseClaudeOutput,
  phaseFor,
  pickJob,
  runningStatus,
  splitReport,
  statusAfterInvestigation,
  type JobStatus,
  type PendingJob,
  type Phase,
} from "./jobs";
import { log } from "./log";
import { fixPrompt, followUpPrompt, investigatePrompt, systemPrompt, type Names } from "./prompts";

// Runs one job at a time: claim with a lease, keep the lease alive, run
// Claude, write the result back. Nothing a job does can throw out of here.

export interface Backend {
  claimJob(jobId: string, workerId: string, leaseMs: number): Promise<boolean>;
  updateJob(args: { jobId: string; workerId: string; status: JobStatus; report?: string; sessionId?: string; suggestedMessage?: string }): Promise<void>;
}

export interface RunnerOptions {
  backend: Backend;
  workerId: string;
  leaseMs: number;
  claudeBin: string;
  workDir: string;
  readDirs: string[];
  model: string | null;
  investigateTimeoutMs: number;
  fixTimeoutMs: number;
  helperName: string;
  // Environment for claude. MOM_DEVICE is added per job.
  env: Record<string, string | undefined>;
  momDeviceFor(job: PendingJob): string | null;
  newSessionId?: () => string;
  // For fetching her help screenshot; tests replace it.
  fetch?: (url: string, init?: RequestInit) => Promise<Response>;
}

export interface JobRecord {
  jobId: string;
  phase: Phase;
  device: string | null;
  person: string | null;
  prompt: string;
  startedAt: number;
  finishedAt: number | null;
  outcome: JobStatus | "running" | "lost";
  error: string | null;
  sessionId: string | null;
}

export class Runner {
  private pending: PendingJob[] = [];
  private skip = new Map<string, number>();
  private busy = false;
  private kickTimer: ReturnType<typeof setTimeout> | null = null;
  readonly history: JobRecord[] = [];
  current: JobRecord | null = null;

  constructor(private o: RunnerOptions) {}

  // New snapshot from the pendingJobs subscription.
  setPending(jobs: PendingJob[]) {
    this.pending = jobs;
    this.kick();
  }

  get pendingCount(): number {
    return this.pending.filter((j) => phaseFor(j) !== null).length;
  }

  kick() {
    if (this.busy) return;
    const job = pickJob(this.pending, this.skip);
    if (!job) {
      // A skipped job becomes eligible again later; look then.
      const next = Math.min(...[...this.skip.values()].filter((t) => t > Date.now()));
      if (Number.isFinite(next) && !this.kickTimer) {
        this.kickTimer = setTimeout(() => {
          this.kickTimer = null;
          this.kick();
        }, next - Date.now() + 50);
      }
      return;
    }
    this.busy = true;
    this.runJob(job)
      .catch((e) => log.error(`job ${job._id}: unexpected error: ${(e as Error).stack ?? e}`))
      .finally(() => {
        this.busy = false;
        this.pending = this.pending.filter((j) => j._id !== job._id);
        setTimeout(() => this.kick(), 0);
      });
  }

  // Resolves when the current job (if any) is done. For tests and shutdown.
  async idle(): Promise<void> {
    while (this.busy) await new Promise((r) => setTimeout(r, 20));
  }

  private remember(r: JobRecord) {
    this.history.unshift(r);
    this.history.length = Math.min(this.history.length, 20);
  }

  private async update(jobId: string, status: JobStatus, report?: string, sessionId?: string, suggestedMessage?: string | null): Promise<boolean> {
    try {
      await this.o.backend.updateJob({
        jobId,
        workerId: this.o.workerId,
        status,
        ...(report !== undefined ? { report: clampReport(report) } : {}),
        ...(sessionId ? { sessionId } : {}),
        ...(suggestedMessage ? { suggestedMessage } : {}),
      });
      return true;
    } catch (e) {
      log.error(`job ${jobId}: updateJob(${status}) failed: ${(e as Error).message}`);
      return false;
    }
  }

  // The picture she showed with her help request, saved where the agent may
  // read it. Null when there's none or it can't be fetched.
  private async helpScreenshot(job: PendingJob): Promise<string | null> {
    const url = job.helpRequest?.screenshotUrls?.find((u): u is string => !!u);
    const dir = this.o.readDirs[0];
    if (!url || !dir || !(job.helpRequest?.kinds ?? []).includes("screenshot")) return null;
    try {
      const res = await (this.o.fetch ?? fetch)(url, { signal: AbortSignal.timeout(30_000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      mkdirSync(dir, { recursive: true });
      const path = join(dir, `help-${job.helpRequestId ?? job._id}.jpg`);
      writeFileSync(path, new Uint8Array(await res.arrayBuffer()));
      return path;
    } catch (e) {
      log.warn(`job ${job._id}: couldn't fetch the help screenshot: ${(e as Error).message}`);
      return null;
    }
  }

  async runJob(job: PendingJob): Promise<void> {
    const phase = phaseFor(job);
    if (!phase) return;

    let claimed = false;
    try {
      claimed = await this.o.backend.claimJob(job._id, this.o.workerId, this.o.leaseMs);
    } catch (e) {
      log.warn(`job ${job._id}: claim failed: ${(e as Error).message}. Retrying in 30 s.`);
      this.skip.set(job._id, Date.now() + 30_000);
      return;
    }
    if (!claimed) {
      log.info(`job ${job._id}: another worker has it`);
      this.skip.set(job._id, Date.now() + 5 * 60_000);
      return;
    }

    const device = this.o.momDeviceFor(job);
    const record: JobRecord = {
      jobId: job._id,
      phase,
      device,
      person: job.personName ?? null,
      prompt: job.prompt,
      startedAt: Date.now(),
      finishedAt: null,
      outcome: "running",
      error: null,
      sessionId: null,
    };
    this.current = record;
    this.remember(record);
    log.info(`job ${job._id}: ${phase} for ${job.personName ?? job.deviceName ?? job.deviceId} on ${device ?? "(no mom device)"}`);

    const finish = async (status: JobStatus, report: string, sessionId: string | null, error: string | null = null, suggestedMessage: string | null = null) => {
      record.finishedAt = Date.now();
      record.error = error;
      record.sessionId = sessionId;
      const ok = await this.update(job._id, status, report, sessionId ?? undefined, suggestedMessage);
      record.outcome = ok ? status : "lost";
      this.current = null;
      log.info(`job ${job._id}: ${ok ? status : `could not record ${status}`}${error ? ` (${error})` : ""}`);
    };

    try {
      if (!device) {
        await finish("failed", "The dispatcher has no mom device for this laptop. Add it to ~/.config/momos/mom.json on the dispatcher machine.", null, "no device");
        return;
      }
      let sessionId: string;
      if (phase === "fix") {
        if (!job.sessionId) {
          await finish("failed", "This job has no investigation session to continue, so the fix can't run. Start a new investigation.", null, "no session");
          return;
        }
        sessionId = job.sessionId;
      } else {
        // "Investigate more" picks up the earlier job's session.
        sessionId = job.resumeSessionId ?? (this.o.newSessionId ?? (() => crypto.randomUUID()))();
      }
      const resume = phase === "fix" || !!job.resumeSessionId;
      record.sessionId = sessionId;

      // Names come from the settings in Convex. The helper falls back to mom.json.
      const names: Names = { person: job.personName ?? "the person", helper: job.helperName ?? this.o.helperName };
      let prompt: string;
      if (phase === "fix") prompt = fixPrompt(job, names);
      else if (job.resumeSessionId) prompt = followUpPrompt(job, names);
      else prompt = investigatePrompt(job, device, names, Date.now(), await this.helpScreenshot(job));
      const args = buildClaudeArgs({
        phase,
        prompt,
        systemPrompt: systemPrompt(names),
        sessionId,
        resume,
        readDirs: this.o.readDirs,
        model: this.o.model,
      });

      // Renew the lease while Claude works. If the job can't be renewed (it
      // was cancelled, or the lease went to another worker), stop Claude.
      const abort = new AbortController();
      const status = runningStatus(phase);
      const renewEvery = Math.max(1000, Math.floor(this.o.leaseMs / 3));
      const renew = setInterval(async () => {
        try {
          await this.o.backend.updateJob({ jobId: job._id, workerId: this.o.workerId, status });
        } catch (e) {
          log.warn(`job ${job._id}: lease renewal failed, stopping: ${(e as Error).message}`);
          abort.abort();
        }
      }, renewEvery);

      const timeoutMs = phase === "investigate" ? this.o.investigateTimeoutMs : this.o.fixTimeoutMs;
      let outcome;
      try {
        outcome = await runClaude({
          bin: this.o.claudeBin,
          args,
          cwd: this.o.workDir,
          env: { ...this.o.env, MOM_DEVICE: device },
          timeoutMs,
          signal: abort.signal,
        });
      } finally {
        clearInterval(renew);
      }

      if (outcome.aborted) {
        record.outcome = "lost";
        record.finishedAt = Date.now();
        record.error = "lease lost";
        this.current = null;
        return;
      }
      if (outcome.timedOut) {
        const mins = Math.round(timeoutMs / 60000);
        await finish("failed", `The agent ran for ${mins} minutes without finishing, so the dispatcher stopped it.`, sessionId, "timeout");
        return;
      }
      const result = parseClaudeOutput(outcome.stdout, outcome.code, outcome.stderr);
      const sid = result.sessionId ?? sessionId;
      if (!result.ok) {
        log.warn(`job ${job._id}: ${result.error}`);
        await finish("failed", `The agent didn't finish: ${result.error}`, sid, result.error);
        return;
      }
      log.info(`job ${job._id}: claude done in ${result.turns ?? "?"} turns${result.costUsd !== null ? `, $${result.costUsd.toFixed(2)}` : ""}`);
      if (phase === "investigate") {
        const { report, fixNeeded, suggestedMessage } = splitReport(result.text);
        await finish(statusAfterInvestigation(fixNeeded), report || "(The agent wrote no report.)", sid, null, suggestedMessage);
      } else {
        await finish("done", result.text.trim() || "(The agent wrote no report.)", sid);
      }
    } catch (e) {
      const msg = (e as Error).message;
      log.error(`job ${job._id}: ${msg}`);
      await finish("failed", `The dispatcher hit an error running this job: ${msg}`, record.sessionId, msg);
    }
  }
}
