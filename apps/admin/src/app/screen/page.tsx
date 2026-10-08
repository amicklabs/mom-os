"use client";

import type RFB from "@novnc/novnc";
import { api } from "@momos/backend/convex/_generated/api";
import type { Id } from "@momos/backend/convex/_generated/dataModel";
import { useMutation, useQuery } from "convex/react";
import { useState } from "react";
import type { DeviceSummary } from "@/components/device-context";
import { ReloadPages } from "@/components/reload-pages";
import { NeedsDevice } from "@/components/shell";
import { Badge, Button, Card, ConfirmDialog, ErrorText, Loading, useNow, useRun } from "@/components/ui";
import { VncViewer, type ViewerStatus } from "@/components/vnc-viewer";
import { isOnline } from "@/lib/format";
import {
  activeSession,
  DEFAULT_MINUTES,
  extendedMinutes,
  KEYSYM,
  keysymsFor,
  minutesLeft,
  START_WAIT_MS,
} from "@/lib/screen-share";

export default function ScreenPage() {
  return <NeedsDevice>{(device) => <Screen device={device} />}</NeedsDevice>;
}

type Action = Parameters<ReturnType<typeof useMutation<typeof api.admin.queueAction>>>[0]["action"];

function Screen({ device }: { device: DeviceSummary }) {
  const name = device.personName ?? device.name;
  const now = useNow(1000);
  const raw = useQuery(api.admin.screenShare, { deviceId: device._id });
  const detail = useQuery(api.admin.device, { deviceId: device._id });
  const queue = useMutation(api.admin.queueAction);
  const { busy, error, run } = useRun();
  const [pending, setPending] = useState<{ id: Id<"actions">; label: string; at: number } | null>(null);
  const [confirmControl, setConfirmControl] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [rfb, setRfb] = useState<RFB | null>(null);
  const [viewer, setViewer] = useState<ViewerStatus | null>(null);

  const session = activeSession(raw ?? null, now);
  const online = isOnline(device.lastSeenAt, now);
  const action = pending ? detail?.actions.find((a) => a._id === pending.id) : undefined;

  async function send(a: Action, label: string) {
    const id = await run(() => queue({ deviceId: device._id, action: a }));
    if (id) setPending({ id, label, at: now });
  }
  const start = () => send({ type: "screen-share", op: "start", control: false, minutes: DEFAULT_MINUTES }, "Starting");
  const stop = () => {
    setExpanded(false);
    void send({ type: "screen-share", op: "stop" }, "Stopping");
  };
  const setControl = (on: boolean) =>
    session &&
    send(
      { type: "screen-share", op: "start", control: on, minutes: minutesLeft(session, now) },
      on ? "Turning control on" : "Turning control off",
    );
  const extend = () =>
    session &&
    send({ type: "screen-share", op: "start", control: session.control, minutes: extendedMinutes(session, now) }, "Adding time");

  if (raw === undefined) return <Loading />;

  let progress: { text: string; tone: "info" | "error" } | null = null;
  if (pending && action?.status === "failed") progress = { text: `${pending.label} didn't work: ${action.result ?? "no reason given"}`, tone: "error" };
  else if (pending && (!action || action.status === "pending")) {
    progress =
      now - pending.at < START_WAIT_MS
        ? { text: `${pending.label}. Waiting for the laptop...`, tone: "info" }
        : { text: "The laptop hasn't picked this up yet. Is it online?", tone: "error" };
  }

  const controlOn = session?.control === true;

  return (
    <div className="flex flex-col gap-4">
      <Card
        title={`${name}'s screen`}
        action={
          session ? (
            <Badge tone={controlOn ? "amber" : "blue"}>{controlOn ? "You have control" : "View only"}</Badge>
          ) : (
            <Badge>Off</Badge>
          )
        }
      >
        {!session ? (
          <div className="flex flex-col gap-3">
            <p className="text-sm text-stone-600 dark:text-stone-400">
              See {name}&apos;s screen here while you talk them through something. It starts view only, stops by itself after{" "}
              {DEFAULT_MINUTES} minutes, and the screen says you&apos;re looking whenever this page is connected.
            </p>
            {!online && <p className="text-sm text-amber-700 dark:text-amber-400">The laptop looks offline right now.</p>}
            <Button variant="primary" className="w-full sm:w-auto" disabled={busy} onClick={() => void start()}>
              Start screen sharing
            </Button>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <p className="text-sm text-stone-600 dark:text-stone-400">
              On for {minutesLeft(session, now)} more minute{minutesLeft(session, now) === 1 ? "" : "s"}.{" "}
              {controlOn
                ? `${name}'s screen says you can move the mouse.`
                : `${name}'s screen says you're looking while you're connected.`}
            </p>
            {!session.served && (
              <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-200">
                The laptop isn&apos;t set up for this yet. Over <code>mom ssh</code>, run{" "}
                <code>sudo /usr/local/src/momos/system/install.sh web-screen</code>.
              </p>
            )}
            <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
              <Button variant="danger" disabled={busy} onClick={stop}>
                Stop
              </Button>
              <Button disabled={busy} onClick={() => void extend()}>
                Add {DEFAULT_MINUTES} minutes
              </Button>
              <Button disabled={busy} onClick={() => setExpanded(true)} className="col-span-2 sm:col-span-1">
                Full screen
              </Button>
            </div>
            <label className="flex min-h-11 items-center gap-3 rounded-xl border border-stone-200 px-3 py-2 text-sm dark:border-stone-800">
              <input
                type="checkbox"
                className="h-5 w-5"
                checked={controlOn}
                disabled={busy}
                onChange={(e) => (e.target.checked ? setConfirmControl(true) : void setControl(false))}
              />
              <span>
                <span className="font-medium">Use {name}&apos;s mouse and keyboard</span>
                <span className="block text-xs text-stone-500">Off unless you turn it on. The laptop enforces it.</span>
              </span>
            </label>
          </div>
        )}
        {progress && (
          <p className={`mt-3 text-sm ${progress.tone === "error" ? "text-red-600 dark:text-red-400" : "text-stone-500"}`}>{progress.text}</p>
        )}
        <ErrorText error={error} />
      </Card>

      <ConfirmDialog
        open={confirmControl}
        title={`Use ${name}'s mouse and keyboard?`}
        confirmLabel="Turn on control"
        busy={busy}
        onCancel={() => setConfirmControl(false)}
        onConfirm={() => {
          setConfirmControl(false);
          void setControl(true);
        }}
      >
        {name}&apos;s screen will say you can move the mouse. The viewer reconnects for a moment while the laptop switches.
      </ConfirmDialog>

      {session && (
        <div
          className={
            expanded
              ? "fixed inset-0 z-50 flex flex-col bg-black pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]"
              : "flex flex-col gap-2"
          }
        >
          {expanded && (
            <div className="flex items-center gap-2 p-2 text-sm text-stone-200">
              <Button variant="ghost" className="text-stone-100" onClick={() => setExpanded(false)}>
                Close
              </Button>
              <span className="min-w-0 flex-1 truncate text-center">
                {controlOn ? "You have control" : "View only"} · {minutesLeft(session, now)} min
              </span>
              <Button variant="danger" disabled={busy} onClick={stop}>
                Stop
              </Button>
            </div>
          )}
          <VncViewer
            key={session.token}
            url={session.url}
            token={session.token}
            control={controlOn}
            onStatus={setViewer}
            onReady={setRfb}
            className={expanded ? "min-h-0 flex-1" : "aspect-[1366/768] w-full rounded-xl"}
          />
          {controlOn && viewer?.kind === "connected" && rfb && <Keys rfb={rfb} dark={expanded} />}
        </div>
      )}

      {!expanded && <ReloadPages deviceId={device._id} name={name} />}

      {session && !expanded && (
        <Card title="Tips">
          <ul className="list-disc space-y-1 pl-5 text-sm text-stone-600 dark:text-stone-400">
            <li>This device needs Tailscale turned on, signed in as you.</li>
            <li>With control on: tap to click, drag to move, two-finger tap to right-click.</li>
            <li>Screen sharing turns itself off when the time runs out. Add time before then.</li>
          </ul>
        </Card>
      )}
    </div>
  );
}

// Typing for phones, which have no keyboard noVNC can capture.
function Keys({ rfb, dark }: { rfb: RFB; dark: boolean }) {
  const [text, setText] = useState("");
  const press = (keysym: number) => rfb.sendKey(keysym, null);
  const keys: [string, number][] = [
    ["Enter", KEYSYM.Return],
    ["Delete", KEYSYM.BackSpace],
    ["Tab", KEYSYM.Tab],
    ["Esc", KEYSYM.Escape],
    ["←", KEYSYM.Left],
    ["→", KEYSYM.Right],
    ["↑", KEYSYM.Up],
    ["↓", KEYSYM.Down],
  ];
  return (
    <div className={`flex flex-col gap-2 ${dark ? "p-2" : ""}`}>
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          for (const k of keysymsFor(text)) press(k);
          setText("");
        }}
      >
        <input
          className="min-w-0 flex-1"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Type on the screen"
          aria-label="Text to type on the screen"
          autoCapitalize="off"
          autoCorrect="off"
        />
        <Button type="submit" variant="primary" disabled={!text}>
          Type
        </Button>
      </form>
      <div className="grid grid-cols-4 gap-2 sm:grid-cols-8">
        {keys.map(([label, keysym]) => (
          <Button key={label} onClick={() => press(keysym)}>
            {label}
          </Button>
        ))}
      </div>
    </div>
  );
}
