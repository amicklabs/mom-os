"use client";

import { api } from "@momos/backend/convex/_generated/api";
import { useQuery } from "convex/react";
import { useState } from "react";
import type { DeviceSummary } from "@/components/device-context";
import { NeedsDevice } from "@/components/shell";
import { Badge, Button, Card, Empty, Loading } from "@/components/ui";
import { when } from "@/lib/format";

export default function ReportsPage() {
  return <NeedsDevice>{(device) => <Reports key={device._id} device={device} />}</NeedsDevice>;
}

function Reports({ device }: { device: DeviceSummary }) {
  const reports = useQuery(api.reports.list, { deviceId: device._id, limit: 30 });
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold">Weekly reports</h1>
      <p className="text-sm text-stone-500">
        Every Sunday at 6 PM a summary of the week goes to the Telegram admins. They&apos;re kept here too, including when Telegram
        isn&apos;t set up.
      </p>
      <Preview device={device} />
      {reports === undefined ? (
        <Loading />
      ) : reports.length === 0 ? (
        <Empty>No reports yet. The first one comes on Sunday evening.</Empty>
      ) : (
        reports.map((r) => (
          <Card
            key={r._id}
            title={`Week to ${r.week}`}
            action={<Badge tone={r.telegramSentAt ? "green" : "gray"}>{r.telegramSentAt ? "Sent on Telegram" : "Not sent"}</Badge>}
          >
            <pre className="whitespace-pre-wrap break-words font-sans text-sm">{r.text}</pre>
            <p className="mt-2 text-xs text-stone-500">Made {when(r.createdAt)}</p>
          </Card>
        ))
      )}
    </div>
  );
}

function Preview({ device }: { device: DeviceSummary }) {
  const [open, setOpen] = useState(false);
  return (
    <Card
      title="This week so far"
      action={
        <Button variant="ghost" onClick={() => setOpen(!open)}>
          {open ? "Hide" : "Show"}
        </Button>
      }
    >
      {open ? <PreviewBody device={device} /> : <p className="text-sm text-stone-500">The last 7 days, as the report would read now.</p>}
    </Card>
  );
}

function PreviewBody({ device }: { device: DeviceSummary }) {
  const preview = useQuery(api.reports.preview, { deviceId: device._id });
  if (preview === undefined) return <Loading />;
  if (preview === null) return <Empty>No data.</Empty>;
  return (
    <>
      <pre className="whitespace-pre-wrap break-words font-sans text-sm">{preview.text}</pre>
      <p className="mt-2 text-xs text-stone-500">Days and times in {preview.timeZone}.</p>
    </>
  );
}
