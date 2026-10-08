#!/usr/bin/env bun
import { existsSync, statSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import type { Server } from "node:net";
import type { MomConfig } from "../../mom/src/config";
import { momDeviceFor, readToken, screenshotCacheDir, settings, tryLoadMomConfig, type DispatcherSettings } from "./config";
import { ConvexLink, type Overview } from "./convex";
import type { PendingJob } from "./jobs";
import { log } from "./log";
import { graphicalEnv, momError, runMom } from "./mom";
import { Runner, type Backend } from "./runner";
import { serve, type Handler } from "./server";
import { summarize, type LocalState } from "./summary";

const VERSION = "0.1.0";
const RECHECK_MS = 60_000;

class Dispatcher {
  private momConfig: MomConfig | null = null;
  private s: DispatcherSettings;
  private link: ConvexLink | null = null;
  private linkKey = "";
  private overview: Overview | null = null;
  private convexState: LocalState["convex"] = "connecting";
  private convexError: string | null = null;
  private lastProblem = "";
  private screenshot: LocalState["screenshot"] = null;
  private screenshotInFlight: Promise<{ path: string; takenAt: number }> | null = null;
  private server: Server | null = null;
  readonly runner: Runner;

  constructor() {
    const { config, error } = tryLoadMomConfig();
    if (error) log.warn(error);
    this.momConfig = config;
    this.s = settings(config);
    this.screenshot = this.cachedScreenshot();

    const self = this;
    const backend: Backend = {
      claimJob: (id, worker, lease) => self.requireLink().claimJob(id, worker, lease),
      updateJob: (a) => self.requireLink().updateJob(a),
    };
    this.runner = new Runner({
      backend,
      workerId: this.s.workerId,
      leaseMs: this.s.leaseMs,
      claudeBin: this.s.claudeBin,
      workDir: this.s.workDir,
      readDirs: this.s.readDirs,
      model: this.s.model,
      investigateTimeoutMs: this.s.investigateTimeoutMs,
      fixTimeoutMs: this.s.fixTimeoutMs,
      helperName: this.s.helperName,
      env: process.env,
      momDeviceFor: (job: PendingJob) => momDeviceFor(this.momConfig, job.deviceName),
    });
  }

  private requireLink(): ConvexLink {
    if (!this.link) throw new Error("Not connected to Convex.");
    return this.link;
  }

  private problem(state: LocalState["convex"], message: string) {
    this.convexState = state;
    this.convexError = message;
    // Say it once, not every minute.
    if (message !== this.lastProblem) log.warn(message);
    this.lastProblem = message;
  }

  // (Re)connect when the URL or token appears or changes. Runs every minute,
  // so a token written later is picked up without a restart.
  async refreshConnection() {
    const { config } = tryLoadMomConfig();
    if (config) {
      this.momConfig = config;
      this.s = { ...settings(config), workerId: this.s.workerId };
    }
    const url = this.s.convexUrl;
    const token = readToken(this.s.tokenFile);
    if (!url) {
      await this.dropLink();
      return this.problem("no-url", `No Convex URL. Set convexUrl in ${this.s.momConfigPath} or MOMOS_CONVEX_URL. Checking again in a minute.`);
    }
    if (!token) {
      await this.dropLink();
      return this.problem("no-token", `No dispatcher token at ${this.s.tokenFile}. Checking again in a minute.`);
    }
    const key = `${url}\n${token}`;
    if (this.link && key === this.linkKey) return;
    await this.dropLink();
    log.info(`connecting to ${url}`);
    this.convexState = "connecting";
    this.lastProblem = "";
    this.linkKey = key;
    this.link = new ConvexLink(url, token, {
      onPending: (jobs) => {
        this.markConnected();
        log.debug(`pending jobs: ${jobs.length}`);
        this.runner.setPending(jobs);
      },
      onOverview: (o) => {
        this.markConnected();
        this.overview = o;
      },
      onError: (where, e) => this.problem("error", `Convex ${where}: ${e.message}`),
    });
  }

  private markConnected() {
    if (this.convexState !== "connected") log.info("connected to Convex");
    this.convexState = "connected";
    this.convexError = null;
    this.lastProblem = "";
  }

  private async dropLink() {
    if (!this.link) return;
    const l = this.link;
    this.link = null;
    this.linkKey = "";
    this.overview = null;
    await l.close();
  }

  private cachedScreenshot(): LocalState["screenshot"] {
    const dev = momDeviceFor(this.momConfig, null);
    if (!dev) return null;
    const p = join(screenshotCacheDir(), `${dev}-latest.png`);
    try {
      return existsSync(p) ? { path: p, takenAt: statSync(p).mtimeMs } : null;
    } catch {
      return null;
    }
  }

  private summaryDeviceName(): string | null {
    const s = this.summary();
    const d = this.overview?.devices?.find((x) => x._id === s.deviceId);
    return d?.name ?? null;
  }

  private momDevice(args: Record<string, unknown>): string | null {
    if (typeof args.device === "string" && args.device) return args.device;
    return momDeviceFor(this.momConfig, this.summaryDeviceName());
  }

  summary() {
    return summarize(this.overview, {
      convex: this.convexState,
      convexError: this.convexError,
      current: this.runner.current,
      screenshot: this.screenshot,
      preferredDevice: this.momConfig?.defaultDevice ?? null,
    });
  }

  private async takeScreenshot(device: string | null) {
    if (!this.screenshotInFlight) {
      this.screenshotInFlight = (async () => {
        const r = await runMom(this.s.momBin, device, ["screenshot"], process.env, 90_000);
        if (r.code !== 0) throw new Error(momError(r));
        const d = r.data as { latest?: string; path?: string; takenAt?: number };
        const path = d.latest ?? d.path;
        if (!path) throw new Error("mom screenshot printed no path.");
        this.screenshot = { path, takenAt: d.takenAt ?? Date.now() };
        return this.screenshot;
      })().finally(() => {
        this.screenshotInFlight = null;
      });
    }
    return await this.screenshotInFlight;
  }

  handlers(): Record<string, Handler> {
    return {
      ping: () => ({ version: VERSION }),

      overview: () => ({
        dispatcher: {
          version: VERSION,
          workerId: this.s.workerId,
          convex: this.convexState,
          convexError: this.convexError,
          currentJob: this.runner.current,
          pendingJobs: this.runner.pendingCount,
        },
        summary: this.summary(),
      }),

      jobs: () => ({
        current: this.runner.current,
        recent: this.runner.history,
        convex: this.overview?.jobs ?? [],
      }),

      investigate: async (args) => {
        const link = this.requireLink();
        const s = this.summary();
        const deviceId = typeof args.deviceId === "string" ? args.deviceId : s.deviceId;
        if (!deviceId) throw new Error("No laptop registered in Convex.");
        // Tie it to her latest open help request from the last hour, if any.
        const recentHelp = (this.overview?.helpRequests ?? []).find((h) => h.deviceId === deviceId && Date.now() - h.createdAt < 3_600_000);
        const helpRequestId = typeof args.helpRequestId === "string" ? args.helpRequestId : recentHelp?._id;
        const device = (this.overview?.devices ?? []).find((d) => d._id === deviceId);
        const person = device?.personName ?? "The person";
        const prompt =
          typeof args.prompt === "string" && args.prompt.trim()
            ? args.prompt.trim()
            : recentHelp
              ? `${person} pressed the help button. Find out what they needed and what went wrong.`
              : "Take a look at the laptop's screen and check everything is working.";
        const jobId = await link.createJob({ deviceId, kind: "investigate", prompt, ...(helpRequestId ? { helpRequestId } : {}) });
        log.info(`created investigate job ${jobId} from the socket`);
        return { jobId };
      },

      approve: async (args) => {
        const link = this.requireLink();
        const jobId = typeof args.jobId === "string" ? args.jobId : this.summary().approvableJobId;
        if (!jobId) throw new Error("No job is waiting for approval.");
        await link.approveJob(jobId);
        log.info(`approved job ${jobId} from the socket`);
        return { jobId };
      },

      say: async (args) => {
        const text = typeof args.text === "string" ? args.text.trim() : "";
        if (!text) throw new Error("Nothing to say.");
        if (text.length > 280) throw new Error("Keep it under 280 characters.");
        const extra = typeof args.seconds === "number" ? ["--seconds", String(Math.round(args.seconds))] : [];
        const r = await runMom(this.s.momBin, this.momDevice(args), ["say", text, ...extra], process.env);
        if (r.code !== 0) throw new Error(momError(r));
        return r.data;
      },

      vnc: async (args) => {
        const r = await runMom(this.s.momBin, this.momDevice(args), ["vnc"], graphicalEnv(process.env));
        if (r.code !== 0) throw new Error(momError(r));
        return r.data;
      },

      screenshot: async (args) => {
        if (args.refresh === true || !this.screenshot) await this.takeScreenshot(this.momDevice(args));
        return this.summary().screenshot;
      },
    };
  }

  async start() {
    log.info(`momos-dispatcher ${VERSION} starting as ${this.s.workerId}`);
    this.server = await serve(this.s.socketPath, this.handlers());
    await this.refreshConnection();
    setInterval(() => {
      this.refreshConnection().catch((e) => log.error(`refreshing connection: ${(e as Error).message}`));
    }, RECHECK_MS);
  }

  async stop() {
    log.info("stopping");
    this.server?.close();
    try {
      unlinkSync(this.s.socketPath);
    } catch {}
    await this.dropLink();
  }
}

if (import.meta.main) {
  const d = new Dispatcher();
  // A bad job or a flaky network must never take the service down.
  process.on("unhandledRejection", (e) => log.error(`unhandled rejection: ${(e as Error)?.stack ?? e}`));
  process.on("uncaughtException", (e) => log.error(`uncaught exception: ${e.stack ?? e.message}`));
  for (const sig of ["SIGTERM", "SIGINT"] as const) {
    process.on(sig, () => {
      d.stop().finally(() => process.exit(0));
    });
  }
  d.start().catch((e) => {
    log.error(`failed to start: ${(e as Error).message}`);
    process.exit(1);
  });
}
