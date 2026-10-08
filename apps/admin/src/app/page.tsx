"use client";

import { api } from "@momos/backend/convex/_generated/api";
import type { Id } from "@momos/backend/convex/_generated/dataModel";
import { useMutation, useQuery } from "convex/react";
import Link from "next/link";
import { useState } from "react";
import type { DeviceSummary } from "@/components/device-context";
import { ReloadPages } from "@/components/reload-pages";
import { NeedsDevice } from "@/components/shell";
import { Badge, Button, Card, ConfirmDialog, ErrorText, Loading, useNow, useRun, type Tone } from "@/components/ui";
import { ago, isOnline, when } from "@/lib/format";

export default function DashboardPage() {
  return <NeedsDevice>{(device) => <Dashboard device={device} />}</NeedsDevice>;
}

function Dashboard({ device }: { device: DeviceSummary }) {
  const now = useNow();
  const online = isOnline(device.lastSeenAt, now);
  const s = device.status;
  const name = device.personName ?? device.name;

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-xl font-semibold">{name}&apos;s laptop</h1>
          <Badge tone={online ? "green" : "red"}>{online ? "Online" : "Offline"}</Badge>
        </div>
        <p className="mt-1 text-sm text-stone-500">
          {device.lastSeenAt ? `Last heard from ${ago(device.lastSeenAt, now)} (${when(device.lastSeenAt)})` : "Never heard from yet"}
        </p>
        {device.openHelp > 0 && (
          <Link href="/help" className="mt-3 block rounded-xl bg-red-50 p-3 text-sm font-medium text-red-800 dark:bg-red-950 dark:text-red-300">
            {device.openHelp} open help request{device.openHelp > 1 ? "s" : ""}. Open the inbox.
          </Link>
        )}
      </Card>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Stat label="Using" value={s ? (s.app ?? "Home screen") : "Unknown"} />
        <Stat
          label="Internet"
          value={s ? (s.online ? "Working" : "Not working") : "Unknown"}
          tone={s ? (s.online ? "green" : "red") : "gray"}
          detail={s?.wifi?.ssid ? `${s.wifi.ssid}${s.wifi.signal != null ? `, ${s.wifi.signal}%` : ""}` : undefined}
        />
        <Stat
          label="Battery"
          value={s?.battery ? `${Math.round(s.battery.percent)}%` : "Unknown"}
          tone={s?.battery ? (s.battery.percent < 15 && !s.battery.charging ? "red" : "gray") : "gray"}
          detail={s?.battery ? (s.battery.charging ? "Charging" : "On battery") : undefined}
        />
        <Stat label="Screen" value={s ? (s.locked ? "Locked" : "Unlocked") : "Unknown"} tone={s?.locked ? "amber" : "gray"} detail={s?.lidClosed ? "Lid closed" : undefined} />
        <Link href="/screen" className="contents">
          <Stat
            label="Viewer"
            value={s ? (s.viewer ? (s.viewerControl ? "Connected, control" : "Connected") : "Nobody") : "Unknown"}
            tone={s?.viewer ? "blue" : "gray"}
            detail={`See ${name}'s screen`}
          />
        </Link>
        <Stat label="Version" value={s?.version ?? "Unknown"} />
      </div>

      <Actions deviceId={device._id} name={name} />
      <ReloadPages deviceId={device._id} name={name} />
      <RecentActions deviceId={device._id} />
    </div>
  );
}

function Stat({ label, value, detail, tone = "gray" }: { label: string; value: string; detail?: string; tone?: Tone }) {
  const color: Record<Tone, string> = {
    green: "text-emerald-700 dark:text-emerald-400",
    red: "text-red-700 dark:text-red-400",
    amber: "text-amber-700 dark:text-amber-400",
    blue: "text-sky-700 dark:text-sky-400",
    gray: "",
  };
  return (
    <div className="rounded-2xl border border-stone-200 bg-white p-3 dark:border-stone-800 dark:bg-stone-900">
      <div className="text-xs uppercase tracking-wide text-stone-500">{label}</div>
      <div className={`mt-1 truncate text-lg font-semibold ${color[tone]}`}>{value}</div>
      {detail && <div className="truncate text-xs text-stone-500">{detail}</div>}
    </div>
  );
}

function Actions({ deviceId, name }: { deviceId: Id<"devices">; name: string }) {
  const queue = useMutation(api.admin.queueAction);
  const settings = useQuery(api.admin.settings, { deviceId });
  const [text, setText] = useState("");
  const [tileId, setTileId] = useState("");
  const [done, setDone] = useState<string | null>(null);
  const [confirmRestart, setConfirmRestart] = useState(false);
  const { busy, error, run } = useRun();
  const tiles = settings?.settings.tiles ?? [];

  async function send(action: Parameters<typeof queue>[0]["action"], label: string) {
    const ok = await run(() => queue({ deviceId, action }));
    if (ok) setDone(label);
  }

  return (
    <Card title="Do something on the laptop">
      <form
        className="flex flex-col gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (!text.trim()) return;
          void send({ type: "say", text: text.trim() }, "Message sent").then(() => setText(""));
        }}
      >
        <label className="text-sm font-medium" htmlFor="say">
          Put a message on {name}&apos;s screen
        </label>
        <textarea id="say" rows={2} maxLength={280} value={text} onChange={(e) => setText(e.target.value)} placeholder="I'll call you in five minutes." />
        <div className="flex items-center justify-between">
          <span className="text-xs text-stone-500">{text.length}/280</span>
          <Button type="submit" variant="primary" disabled={busy || !text.trim()}>
            Say it
          </Button>
        </div>
      </form>

      <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Button disabled={busy} onClick={() => send({ type: "home" }, "Went home")}>
          Go home
        </Button>
        <Button disabled={busy} onClick={() => send({ type: "screenshot" }, "Screenshot requested")}>
          Screenshot
        </Button>
        <Button
          disabled={busy}
          onClick={() => {
            if (confirm(`Lock ${name}'s screen? Unlocking needs the PIN.`)) void send({ type: "lock" }, "Lock requested");
          }}
        >
          Lock
        </Button>
        <Button disabled={busy} onClick={() => setConfirmRestart(true)}>
          Restart
        </Button>
      </div>
      <ConfirmDialog
        open={confirmRestart}
        title={`Restart ${name}'s laptop?`}
        confirmLabel="Restart"
        danger
        busy={busy}
        onCancel={() => setConfirmRestart(false)}
        onConfirm={() => {
          setConfirmRestart(false);
          void send({ type: "restart" }, "Restart requested");
        }}
      >
        {name}&apos;s screen says the computer is restarting, and about 10 seconds later it reboots. Anything open closes. If the
        laptop doesn&apos;t pick this up within 10 minutes, it won&apos;t restart.
      </ConfirmDialog>

      <div className="mt-4 flex gap-2">
        <select className="min-w-0 flex-1" value={tileId} onChange={(e) => setTileId(e.target.value)} aria-label="Tile to open">
          <option value="">Open a tile...</option>
          {tiles.map((t) => (
            <option key={t.id} value={t.id}>
              {t.label}
            </option>
          ))}
        </select>
        <Button disabled={busy || !tileId} onClick={() => send({ type: "open", tileId }, "Opening tile")}>
          Open
        </Button>
      </div>
      {done && !error && <p className="mt-2 text-sm text-emerald-700 dark:text-emerald-400">{done}. It runs when the laptop picks it up.</p>}
      <ErrorText error={error} />
    </Card>
  );
}

function describeAction(a: { type: string; text?: string; tileId?: string; op?: string; control?: boolean }) {
  if (a.type === "say") return `Say "${a.text}"`;
  if (a.type === "open") return `Open ${a.tileId}`;
  if (a.type === "reload") return `Reload ${a.tileId}`;
  if (a.type === "screen-share") return a.op === "stop" ? "Stop screen sharing" : `Screen sharing${a.control ? " with control" : ""}`;
  return a.type[0]!.toUpperCase() + a.type.slice(1);
}

function RecentActions({ deviceId }: { deviceId: Id<"devices"> }) {
  const detail = useQuery(api.admin.device, { deviceId });
  const now = useNow();
  if (detail === undefined) return <Loading />;
  if (!detail || detail.actions.length === 0) return null;
  return (
    <Card title="Recent actions">
      <ul className="flex flex-col divide-y divide-stone-100 dark:divide-stone-800">
        {detail.actions.map((a) => (
          <li key={a._id} className="flex flex-col gap-2 py-2">
            <div className="flex items-center justify-between gap-2 text-sm">
              <span className="min-w-0 truncate">{describeAction(a.action)}</span>
              <span className="flex shrink-0 items-center gap-2">
                <span className="text-xs text-stone-500">{ago(a.createdAt, now)}</span>
                <Badge tone={a.status === "done" ? "green" : a.status === "failed" ? "red" : "amber"}>{a.status}</Badge>
              </span>
            </div>
            {a.result && <p className="text-xs text-stone-500">{a.result}</p>}
            {a.screenshotUrl && (
              <a href={a.screenshotUrl} target="_blank" rel="noreferrer">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={a.screenshotUrl} alt="Screenshot" className="w-full rounded-lg border border-stone-200 dark:border-stone-800" />
              </a>
            )}
          </li>
        ))}
      </ul>
    </Card>
  );
}
