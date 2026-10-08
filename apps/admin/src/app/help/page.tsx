"use client";

import { api } from "@momos/backend/convex/_generated/api";
import { useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import Link from "next/link";
import { useState } from "react";
import type { DeviceSummary } from "@/components/device-context";
import { NeedsDevice } from "@/components/shell";
import { Badge, Button, Card, Empty, ErrorText, Loading, useNow, useRun, type Tone } from "@/components/ui";
import { ago, when } from "@/lib/format";

type Help = FunctionReturnType<typeof api.admin.helpRequests>[number];

export default function HelpPage() {
  return <NeedsDevice>{(device) => <Inbox device={device} />}</NeedsDevice>;
}

function Inbox({ device }: { device: DeviceSummary }) {
  const requests = useQuery(api.admin.helpRequests, { deviceId: device._id, limit: 30 });
  if (requests === undefined) return <Loading />;
  const name = device.personName ?? device.name;
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold">Help requests</h1>
      {requests.length === 0 && <Empty>{name} hasn&apos;t asked for help yet.</Empty>}
      {requests.map((h) => (
        <HelpCard key={h._id} help={h} name={name} />
      ))}
    </div>
  );
}

const TONE = { open: "red", answered: "blue", closed: "gray" } as const;

const KIND: Record<string, { label: string; tone: Tone }> = {
  message: { label: "Wrote", tone: "blue" },
  screenshot: { label: "Showed the screen", tone: "gray" },
  "call-me": { label: "Asked you to call", tone: "amber" },
  voice: { label: "Voice note", tone: "green" },
};

function HelpCard({ help, name }: { help: Help; name: string }) {
  const now = useNow();
  const reply = useMutation(api.admin.replyToHelp);
  const close = useMutation(api.admin.closeHelpRequest);
  const markSeen = useMutation(api.admin.markHelpSeen);
  const investigate = useMutation(api.admin.investigateHelp);
  const [text, setText] = useState("");
  const [agentOpen, setAgentOpen] = useState(false);
  const [note, setNote] = useState("");
  const [jobNote, setJobNote] = useState<string | null>(null);
  const { busy, error, run } = useRun();
  const c = help.context;
  const hasFiles = help.screenshotUrls.length > 0 || help.voiceUrl !== null;

  return (
    <Card
      title={
        <span className="flex flex-wrap items-center gap-2">
          {when(help.askedAt ?? help.createdAt)}
          <Badge tone={TONE[help.status]}>{help.status}</Badge>
          {help.kinds.map((k) => (
            <Badge key={k} tone={KIND[k]?.tone ?? "gray"}>
              {KIND[k]?.label ?? k}
            </Badge>
          ))}
        </span>
      }
      action={<span className="text-xs text-stone-500">{ago(help.askedAt ?? help.createdAt, now)}</span>}
    >
      {help.text && (
        <blockquote className="mb-3 whitespace-pre-wrap border-l-4 border-sky-300 pl-3 text-base text-stone-800 dark:border-sky-700 dark:text-stone-200">
          {help.text}
        </blockquote>
      )}
      <p className="text-sm text-stone-600 dark:text-stone-400">
        Using {c.app ?? "the home screen"}. Internet {c.online ? "working" : "not working"}
        {c.battery ? `. Battery ${Math.round(c.battery.percent)}%${c.battery.charging ? ", charging" : ""}` : ""}
        {c.viewer ? ". Someone was viewing the screen" : ""}.
        {help.askedAt ? ` Waited on the laptop while offline; arrived ${ago(help.createdAt, now)}.` : ""}
      </p>
      {help.note && <p className="mt-1 text-sm text-amber-700 dark:text-amber-400">Note: {help.note}</p>}
      {help.seenAt && (
        <p className="mt-1 text-sm text-emerald-700 dark:text-emerald-400">{name}&apos;s screen says you saw it ({ago(help.seenAt, now)}).</p>
      )}

      {help.voiceUrl && (
        <div className="mt-3">
          <p className="mb-1 text-xs text-stone-500">Voice note{help.voiceSeconds ? `, ${help.voiceSeconds} s` : ""}</p>
          <audio controls preload="none" src={help.voiceUrl} className="w-full" />
        </div>
      )}

      {help.screenshotUrls.length > 0 && (
        <div className="-mx-4 mt-3 flex snap-x snap-mandatory gap-2 overflow-x-auto px-4 pb-2">
          {help.screenshotUrls.map((url, i) => (
            <a key={url} href={url} target="_blank" rel="noreferrer" className="w-[85%] shrink-0 snap-start sm:w-[45%]">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={url} alt={`Screenshot ${i + 1}`} className="w-full rounded-lg border border-stone-200 dark:border-stone-800" />
            </a>
          ))}
        </div>
      )}
      {!hasFiles && (help.kinds.includes("screenshot") || help.kinds.includes("voice")) && (
        <p className="mt-2 text-xs text-stone-500">
          {help.hasScreenshots ? "Files unavailable." : "No files (or they were deleted after 60 days)."}
        </p>
      )}

      {help.replies.length > 0 && (
        <ul className="mt-3 flex flex-col gap-1 text-sm">
          {help.replies.map((r, i) => (
            <li key={i} className="rounded-lg bg-sky-50 px-3 py-2 dark:bg-sky-950">
              &ldquo;{r.text}&rdquo; <span className="text-xs text-stone-500">via {r.source}, {ago(r.at, now)}</span>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button disabled={busy || help.seenAt !== undefined} onClick={() => run(() => markSeen({ helpRequestId: help._id }))}>
          Got it
        </Button>
        <Button disabled={busy} onClick={() => setAgentOpen((o) => !o)}>
          Send an agent
        </Button>
        {help.status !== "closed" && (
          <Button variant="ghost" disabled={busy} onClick={() => run(() => close({ helpRequestId: help._id }))}>
            Done
          </Button>
        )}
      </div>
      {agentOpen && (
        <form
          className="mt-3 flex flex-col gap-2"
          onSubmit={async (e) => {
            e.preventDefault();
            const instructions = note.trim();
            const r = await run(() => investigate({ helpRequestId: help._id, ...(instructions ? { instructions } : {}) }));
            if (r) {
              setJobNote(r.created ? "Agent job queued." : "An agent is already looking at this one.");
              setAgentOpen(false);
              setNote("");
            }
          }}
        >
          <textarea
            rows={2}
            maxLength={2000}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Anything to tell the agent? (optional)"
            aria-label="Note for the agent"
          />
          <div className="flex flex-wrap items-center gap-2">
            <Button type="submit" variant="primary" disabled={busy}>
              {note.trim() ? "Send with this note" : "Send without a note"}
            </Button>
            <Button variant="ghost" disabled={busy} onClick={() => setAgentOpen(false)}>
              Cancel
            </Button>
          </div>
        </form>
      )}
      {jobNote && (
        <p className="mt-2 text-sm text-emerald-700 dark:text-emerald-400">
          {jobNote} Follow it on the <Link href="/jobs" className="underline">Jobs page</Link>.
        </p>
      )}

      <form
        className="mt-3 flex flex-col gap-2"
        onSubmit={async (e) => {
          e.preventDefault();
          const ok = await run(() => reply({ helpRequestId: help._id, text }));
          if (ok) setText("");
        }}
      >
        <textarea rows={2} maxLength={280} value={text} onChange={(e) => setText(e.target.value)} placeholder={`Reply on ${name}'s screen`} aria-label="Reply" />
        <div className="flex flex-wrap items-center gap-2">
          <Button type="submit" variant="primary" disabled={busy || !text.trim()}>
            Send reply
          </Button>
          <span className="ml-auto text-xs text-stone-500">{text.length}/280</span>
        </div>
        <ErrorText error={error} />
      </form>
    </Card>
  );
}
