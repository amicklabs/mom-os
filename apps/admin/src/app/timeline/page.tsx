"use client";

import { api } from "@momos/backend/convex/_generated/api";
import type { Doc } from "@momos/backend/convex/_generated/dataModel";
import { usePaginatedQuery } from "convex/react";
import type { DeviceSummary } from "@/components/device-context";
import { NeedsDevice } from "@/components/shell";
import { Badge, Button, Card, Empty, Loading, type Tone } from "@/components/ui";
import { day, time } from "@/lib/format";

export default function TimelinePage() {
  return <NeedsDevice>{(device) => <Timeline device={device} />}</NeedsDevice>;
}

type Event = Doc<"events">["event"];

function describe(e: Event): { text: string; tone: Tone } {
  switch (e.type) {
    case "boot":
      return { text: "Laptop started", tone: "blue" };
    case "app":
      return { text: e.app ? `Opened ${e.app}` : "Went to the home screen", tone: "gray" };
    case "network":
      return {
        text: e.online
          ? `Internet working${e.ssid ? ` on ${e.ssid}` : ""}${e.signal != null ? ` (${e.signal}%)` : ""}`
          : `Internet down${e.dns === false ? " (DNS failing)" : ""}`,
        tone: e.online ? "green" : "red",
      };
    case "power":
      return { text: `Battery ${Math.round(e.percent)}%${e.charging ? ", charging" : ""}`, tone: e.percent < 15 && !e.charging ? "red" : "gray" };
    case "viewer":
      return {
        text:
          (e.via === "web" ? "Browser: " : e.via === "vnc" ? "VNC: " : "") +
          (e.connected ? (e.control ? "someone is viewing the screen, with control" : "someone started viewing the screen") : "screen viewer left"),
        tone: "blue",
      };
    case "help":
      return { text: `Help button: ${e.stage}`, tone: e.stage === "failed" ? "red" : "amber" };
    case "lid":
      return { text: e.closed ? "Lid closed" : "Lid opened", tone: "gray" };
    case "sleep":
      return { text: e.stage === "suspend" ? "Went to sleep" : "Woke up", tone: "gray" };
    case "lock":
      return { text: e.locked ? "Screen locked" : "Screen unlocked", tone: "amber" };
    case "action":
      return { text: `Action ${e.action} ${e.ok ? "done" : "failed"}`, tone: e.ok ? "gray" : "red" };
    case "health":
      return { text: `Health report: ${JSON.stringify(e.report).slice(0, 200)}`, tone: "gray" };
    case "error":
      return { text: `Error in ${e.source}: ${e.message}`, tone: "red" };
    case "reminder":
      return {
        text: `Reminder for ${time(e.due)} ${e.stage === "shown" ? "came up" : "answered with OK"}`,
        tone: e.stage === "shown" ? "amber" : "green",
      };
  }
}

function Timeline({ device }: { device: DeviceSummary }) {
  const { results, status, loadMore } = usePaginatedQuery(api.admin.events, { deviceId: device._id }, { initialNumItems: 50 });
  if (status === "LoadingFirstPage") return <Loading />;

  const groups: { day: string; events: typeof results }[] = [];
  for (const e of results) {
    const d = day(e.at);
    const last = groups[groups.length - 1];
    if (last && last.day === d) last.events.push(e);
    else groups.push({ day: d, events: [e] });
  }

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold">Timeline</h1>
      {results.length === 0 && <Empty>No events yet.</Empty>}
      {groups.map((g) => (
        <Card key={g.day} title={g.day}>
          <ul className="flex flex-col gap-2">
            {g.events.map((e) => {
              const { text, tone } = describe(e.event);
              return (
                <li key={e._id} className="flex items-start gap-3 text-sm">
                  <span className="w-20 shrink-0 pt-0.5 font-mono text-xs text-stone-500">{time(e.at)}</span>
                  <span className="min-w-0 flex-1 break-words">{text}</span>
                  <Badge tone={tone}>{e.type}</Badge>
                </li>
              );
            })}
          </ul>
        </Card>
      ))}
      {status === "CanLoadMore" && (
        <Button onClick={() => loadMore(100)} className="self-center">
          Load older events
        </Button>
      )}
      {status === "LoadingMore" && <Loading />}
    </div>
  );
}
