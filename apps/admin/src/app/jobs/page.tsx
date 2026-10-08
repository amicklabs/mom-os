"use client";

import { api } from "@momos/backend/convex/_generated/api";
import type { Doc } from "@momos/backend/convex/_generated/dataModel";
import { useMutation, useQuery } from "convex/react";
import { useState } from "react";
import type { DeviceSummary } from "@/components/device-context";
import { NeedsDevice } from "@/components/shell";
import { Badge, Button, Card, Empty, ErrorText, Field, Loading, useNow, useRun, type Tone } from "@/components/ui";
import { ago, when } from "@/lib/format";

export default function JobsPage() {
  return <NeedsDevice>{(device) => <Jobs device={device} />}</NeedsDevice>;
}

const STATUS: Record<Doc<"jobs">["status"], { label: string; tone: Tone }> = {
  queued: { label: "Queued", tone: "gray" },
  investigating: { label: "Investigating", tone: "blue" },
  awaiting_approval: { label: "Needs approval", tone: "amber" },
  approved: { label: "Approved", tone: "blue" },
  fixing: { label: "Fixing", tone: "blue" },
  done: { label: "Done", tone: "green" },
  failed: { label: "Failed", tone: "red" },
  cancelled: { label: "Cancelled", tone: "gray" },
};
const LIVE = new Set(["queued", "investigating", "awaiting_approval", "approved", "fixing"]);

function Jobs({ device }: { device: DeviceSummary }) {
  const jobs = useQuery(api.admin.jobs, { deviceId: device._id, limit: 50 });
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold">Agent jobs</h1>
      <NewJob device={device} />
      {jobs === undefined ? <Loading /> : jobs.length === 0 ? <Empty>No jobs yet.</Empty> : jobs.map((j) => <JobCard key={j._id} job={j} />)}
    </div>
  );
}

function NewJob({ device }: { device: DeviceSummary }) {
  const create = useMutation(api.admin.createJob);
  const [kind, setKind] = useState<"investigate" | "fix">("investigate");
  const [prompt, setPrompt] = useState("");
  const { busy, error, run } = useRun();
  return (
    <Card title="Start a job">
      <form
        className="flex flex-col gap-3"
        onSubmit={async (e) => {
          e.preventDefault();
          const id = await run(() => create({ deviceId: device._id, kind, prompt }));
          if (id) setPrompt("");
        }}
      >
        <Field label="Kind" hint="Investigate is read-only. Fix still waits for your approval before changing anything.">
          <select value={kind} onChange={(e) => setKind(e.target.value as "investigate" | "fix")}>
            <option value="investigate">Investigate</option>
            <option value="fix">Fix</option>
          </select>
        </Field>
        <Field label="What should the agent do?">
          <textarea rows={3} maxLength={8000} value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="The camera stopped working in Telegram calls." />
        </Field>
        <Button type="submit" variant="primary" disabled={busy || !prompt.trim()} className="self-start">
          Queue job
        </Button>
        <ErrorText error={error} />
      </form>
    </Card>
  );
}

function JobCard({ job }: { job: Doc<"jobs"> }) {
  const now = useNow();
  const approve = useMutation(api.admin.approveJob);
  const cancel = useMutation(api.admin.cancelJob);
  const { busy, error, run } = useRun();
  const [open, setOpen] = useState(job.status === "awaiting_approval");
  const s = STATUS[job.status];
  const report = job.report?.trim();

  return (
    <Card
      title={
        <span className="flex items-center gap-2">
          <span className="capitalize">{job.kind}</span>
          <Badge tone={s.tone}>{s.label}</Badge>
        </span>
      }
      action={
        <span className="text-xs text-stone-500" title={when(job.createdAt)}>
          {ago(job.createdAt, now)}
        </span>
      }
    >
      <p className="whitespace-pre-wrap text-sm text-stone-700 dark:text-stone-300">{job.prompt}</p>
      <p className="mt-1 text-xs text-stone-500">
        From {job.source}
        {job.workerId ? `, worker ${job.workerId}` : ""}
        {job.updatedAt !== job.createdAt ? `, updated ${ago(job.updatedAt, now)}` : ""}
      </p>
      {report && (
        <div className="mt-3">
          <button type="button" className="text-sm font-medium text-sky-700 dark:text-sky-400" onClick={() => setOpen(!open)}>
            {open ? "Hide report" : "Show report"}
          </button>
          {open && (
            <pre className="mt-2 max-h-[60vh] overflow-auto whitespace-pre-wrap break-words rounded-lg bg-stone-100 p-3 font-sans text-sm dark:bg-stone-800">
              {report}
            </pre>
          )}
        </div>
      )}
      {LIVE.has(job.status) && (
        <div className="mt-3 flex gap-2">
          {job.status === "awaiting_approval" && (
            <Button variant="primary" disabled={busy} onClick={() => run(() => approve({ jobId: job._id }))}>
              Approve fix
            </Button>
          )}
          <Button
            variant="ghost"
            disabled={busy}
            onClick={() => {
              if (confirm("Cancel this job?")) void run(() => cancel({ jobId: job._id }));
            }}
          >
            Cancel
          </Button>
        </div>
      )}
      <ErrorText error={error} />
    </Card>
  );
}
