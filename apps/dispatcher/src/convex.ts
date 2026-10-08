import { ConvexClient } from "convex/browser";
import { makeFunctionReference } from "convex/server";
import type { JobKind, JobStatus, PendingJob } from "./jobs";
import { log } from "./log";
import type { Backend } from "./runner";

// Convex by function name (docs/contracts.md), so the dispatcher builds
// without the backend's generated types.
const fn = {
  pendingJobs: makeFunctionReference<"query">("dispatcher:pendingJobs"),
  overview: makeFunctionReference<"query">("dispatcher:overview"),
  claimJob: makeFunctionReference<"mutation">("dispatcher:claimJob"),
  updateJob: makeFunctionReference<"mutation">("dispatcher:updateJob"),
  createJob: makeFunctionReference<"mutation">("dispatcher:createJob"),
  approveJob: makeFunctionReference<"mutation">("dispatcher:approveJob"),
};

export type Overview = {
  devices?: { _id: string; name: string; personName?: string | null; online?: boolean; lastSeenAt?: number | null; status?: Record<string, unknown> | null }[];
  helpRequests?: { _id: string; deviceId: string; createdAt: number; context?: Record<string, unknown> | null }[];
  jobs?: { _id: string; deviceId: string; kind: JobKind; status: JobStatus; prompt: string; report?: string; createdAt: number; updatedAt?: number; sessionId?: string }[];
};

export interface ConvexHandlers {
  onPending(jobs: PendingJob[]): void;
  onOverview(overview: Overview): void;
  onError(where: string, e: Error): void;
}

export class ConvexLink implements Backend {
  private client: ConvexClient;
  private unsubscribers: (() => void)[] = [];

  constructor(readonly url: string, private token: string, handlers: ConvexHandlers) {
    this.client = new ConvexClient(url);
    const args = { dispatcherToken: token };
    this.unsubscribers.push(
      this.client.onUpdate(fn.pendingJobs, args, (jobs) => handlers.onPending((jobs ?? []) as PendingJob[]), (e) => handlers.onError("pendingJobs", e)),
      this.client.onUpdate(fn.overview, args, (o) => handlers.onOverview((o ?? {}) as Overview), (e) => handlers.onError("overview", e)),
    );
  }

  get connected(): boolean {
    try {
      return this.client.connectionState().isWebSocketConnected;
    } catch {
      return false;
    }
  }

  async claimJob(jobId: string, workerId: string, leaseMs: number): Promise<boolean> {
    return (await this.client.mutation(fn.claimJob, { dispatcherToken: this.token, jobId, workerId, leaseMs })) === true;
  }

  async updateJob(a: { jobId: string; workerId: string; status: JobStatus; report?: string; sessionId?: string; suggestedMessage?: string }): Promise<void> {
    await this.client.mutation(fn.updateJob, { dispatcherToken: this.token, ...a });
  }

  async createJob(a: { deviceId: string; kind: JobKind; prompt: string; helpRequestId?: string }): Promise<string> {
    return (await this.client.mutation(fn.createJob, { dispatcherToken: this.token, ...a })) as string;
  }

  async approveJob(jobId: string): Promise<void> {
    await this.client.mutation(fn.approveJob, { dispatcherToken: this.token, jobId });
  }

  async close(): Promise<void> {
    for (const u of this.unsubscribers) {
      try {
        u();
      } catch {}
    }
    try {
      await this.client.close();
    } catch (e) {
      log.debug(`closing Convex client: ${(e as Error).message}`);
    }
  }
}
