"use client";

import { Reminder } from "@momos/shared";
import { api } from "@momos/backend/convex/_generated/api";
import type { Id } from "@momos/backend/convex/_generated/dataModel";
import { useMutation, useQuery } from "convex/react";
import { useMemo, useState } from "react";
import type { DeviceSummary } from "@/components/device-context";
import { NeedsDevice } from "@/components/shell";
import { Button, Card, ConfirmDialog, Empty, ErrorText, Field, Loading, useRun } from "@/components/ui";

export default function RemindersPage() {
  return <NeedsDevice>{(device) => <Reminders key={device._id} device={device} />}</NeedsDevice>;
}

type Fields = Reminder extends infer R ? (R extends Reminder ? Omit<R, "id"> : never) : never;
type Draft = {
  text: string;
  time: string;
  repeat: Reminder["repeat"];
  date: string;
  days: number[];
  leadMinutes: number | null;
};

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const DAY_NAMES = ["Sundays", "Mondays", "Tuesdays", "Wednesdays", "Thursdays", "Fridays", "Saturdays"];
const LEADS: { value: number | null; label: string }[] = [
  { value: null, label: "All day" },
  { value: 15, label: "15 minutes before" },
  { value: 30, label: "30 minutes before" },
  { value: 60, label: "1 hour before" },
  { value: 120, label: "2 hours before" },
  { value: 240, label: "4 hours before" },
];

function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const emptyDraft = (): Draft => ({ text: "", time: "09:00", repeat: "none", date: today(), days: [1], leadMinutes: null });

function toDraft(r: Reminder): Draft {
  return {
    text: r.text,
    time: r.time,
    repeat: r.repeat,
    date: r.repeat === "none" ? r.date : today(),
    days: r.repeat === "weekly" ? r.days : [1],
    leadMinutes: r.leadMinutes,
  };
}

function toFields(d: Draft): Fields {
  const base = { text: d.text.trim(), time: d.time, leadMinutes: d.leadMinutes };
  if (d.repeat === "none") return { ...base, repeat: "none", date: d.date };
  if (d.repeat === "daily") return { ...base, repeat: "daily" };
  return { ...base, repeat: "weekly", days: [...d.days].sort((a, b) => a - b) };
}

function clock(time: string): string {
  const [h, m] = time.split(":").map(Number) as [number, number];
  return `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
}

function when(r: Reminder): string {
  const at = clock(r.time);
  if (r.repeat === "daily") return `Every day at ${at}`;
  if (r.repeat === "weekly") {
    if (r.days.length === 7) return `Every day at ${at}`;
    const names = r.days.map((d) => DAY_NAMES[d]);
    const list = names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names.at(-1)}` : names[0];
    return `${list} at ${at}`;
  }
  const [y, mo, d] = r.date.split("-").map(Number) as [number, number, number];
  const date = new Date(y, mo - 1, d).toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric", year: "numeric" });
  return `${date} at ${at}`;
}

function lead(r: Reminder): string {
  const l = LEADS.find((x) => x.value === r.leadMinutes);
  if (r.leadMinutes === null) return "On the home screen all day";
  return `On the home screen from ${l ? l.label.toLowerCase() : `${r.leadMinutes} minutes before`}`;
}

function isPast(r: Reminder): boolean {
  return r.repeat === "none" && `${r.date}T${r.time}` < `${today()}T00:00`;
}

function Reminders({ device }: { device: DeviceSummary }) {
  const list = useQuery(api.reminders.list, { deviceId: device._id });
  const remove = useMutation(api.reminders.remove);
  const [editing, setEditing] = useState<{ id: Id<"reminders"> | null; draft: Draft } | null>(null);
  const [deleting, setDeleting] = useState<Reminder | null>(null);
  const { busy, error, run } = useRun();
  const name = device.personName ?? device.name;

  const sorted = useMemo(
    () =>
      [...(list ?? [])].sort((a, b) => {
        const key = (r: Reminder) => `${r.repeat === "none" ? r.date : "0000"} ${r.time}`;
        return key(a).localeCompare(key(b));
      }),
    [list],
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-xl font-semibold">Reminders</h1>
        {!editing && (
          <Button variant="primary" onClick={() => setEditing({ id: null, draft: emptyDraft() })}>
            Add reminder
          </Button>
        )}
      </div>
      <p className="text-sm text-stone-500">
        Today&apos;s reminders show in a card on {name}&apos;s home screen. At the time, a big reminder comes up over whatever is on the
        screen until {name} presses OK. Times are in the laptop&apos;s time zone. The laptop keeps working from its last copy when it&apos;s
        offline.
      </p>

      {editing && (
        <Editor
          deviceId={device._id}
          id={editing.id}
          initial={editing.draft}
          onDone={() => setEditing(null)}
        />
      )}

      {list === undefined ? (
        <Loading />
      ) : sorted.length === 0 ? (
        <Empty>No reminders yet.</Empty>
      ) : (
        <Card>
          <ul className="flex flex-col divide-y divide-stone-100 dark:divide-stone-800">
            {sorted.map((r) => (
              <li key={r.id} className={`flex items-start gap-3 py-3 ${isPast(r) ? "opacity-50" : ""}`}>
                <div className="min-w-0 flex-1">
                  <p className="font-medium">{r.text}</p>
                  <p className="text-sm text-stone-600 dark:text-stone-400">
                    {when(r)}
                    {isPast(r) ? " (past)" : ""}
                  </p>
                  <p className="text-xs text-stone-500">{lead(r)}</p>
                </div>
                <Button variant="ghost" onClick={() => setEditing({ id: r.id as Id<"reminders">, draft: toDraft(r) })}>
                  Edit
                </Button>
                <Button variant="ghost" className="text-red-600 dark:text-red-400" onClick={() => setDeleting(r)}>
                  Delete
                </Button>
              </li>
            ))}
          </ul>
          <ErrorText error={error} />
        </Card>
      )}

      <ConfirmDialog
        open={deleting !== null}
        title="Delete this reminder?"
        confirmLabel="Delete"
        danger
        busy={busy}
        onCancel={() => setDeleting(null)}
        onConfirm={() => {
          const r = deleting;
          setDeleting(null);
          if (r) void run(() => remove({ reminderId: r.id as Id<"reminders"> }));
        }}
      >
        &ldquo;{deleting?.text}&rdquo; won&apos;t come up on {name}&apos;s screen any more.
      </ConfirmDialog>
    </div>
  );
}

function Editor({ deviceId, id, initial, onDone }: { deviceId: Id<"devices">; id: Id<"reminders"> | null; initial: Draft; onDone: () => void }) {
  const save = useMutation(api.reminders.save);
  const [d, setD] = useState<Draft>(initial);
  const { busy, error, run } = useRun();
  const fields = toFields(d);
  const parsed = Reminder.safeParse({ ...fields, id: "draft" });
  const issues = new Map<string, string>();
  if (!parsed.success) for (const i of parsed.error.issues) issues.set(String(i.path[0]), i.message);

  function set<K extends keyof Draft>(key: K, value: Draft[K]) {
    setD((prev) => ({ ...prev, [key]: value }));
  }

  return (
    <Card title={id ? "Edit reminder" : "New reminder"}>
      <form
        className="grid gap-3 sm:grid-cols-2"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!parsed.success) return;
          const ok = await run(() => save({ deviceId, reminderId: id ?? undefined, reminder: fields }));
          if (ok) onDone();
        }}
      >
        <div className="sm:col-span-2">
          <Field label="What the reminder says" hint={`Shown as "${clock(d.time)}: ${d.text.trim() || "Doctor appointment"}". Keep it short.`} error={d.text && issues.get("text")}>
            <input value={d.text} maxLength={80} onChange={(e) => set("text", e.target.value)} placeholder="Doctor appointment" autoFocus />
          </Field>
        </div>
        <Field label="Time" error={issues.get("time")}>
          <input type="time" value={d.time} required onChange={(e) => set("time", e.target.value)} />
        </Field>
        <Field label="Repeat">
          <select value={d.repeat} onChange={(e) => set("repeat", e.target.value as Draft["repeat"])}>
            <option value="none">Once</option>
            <option value="daily">Every day</option>
            <option value="weekly">Every week</option>
          </select>
        </Field>
        {d.repeat === "none" && (
          <Field label="Date" error={issues.get("date")}>
            <input type="date" value={d.date} required onChange={(e) => set("date", e.target.value)} />
          </Field>
        )}
        {d.repeat === "weekly" && (
          <div className="flex flex-col gap-1 text-sm sm:col-span-2">
            <span className="font-medium text-stone-700 dark:text-stone-300">On</span>
            <div className="flex flex-wrap gap-2">
              {DAYS.map((label, i) => {
                const on = d.days.includes(i);
                return (
                  <button
                    key={label}
                    type="button"
                    aria-pressed={on}
                    onClick={() => set("days", on ? d.days.filter((x) => x !== i) : [...d.days, i])}
                    className={`min-h-11 min-w-12 rounded-xl border px-3 text-sm font-medium ${
                      on ? "border-sky-600 bg-sky-600 text-white" : "border-stone-300 bg-white dark:border-stone-700 dark:bg-stone-900"
                    }`}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
            {issues.get("days") && <span className="text-xs text-red-600 dark:text-red-400">Pick at least one day.</span>}
          </div>
        )}
        <Field label="Show on the home screen" hint="The card on the home screen lists today's reminders from this time on.">
          <select value={d.leadMinutes ?? ""} onChange={(e) => set("leadMinutes", e.target.value === "" ? null : Number(e.target.value))}>
            {LEADS.map((l) => (
              <option key={l.label} value={l.value ?? ""}>
                {l.label}
              </option>
            ))}
          </select>
        </Field>
        <div className="flex gap-2 sm:col-span-2">
          <Button type="submit" variant="primary" disabled={busy || !parsed.success}>
            {busy ? "Saving..." : "Save reminder"}
          </Button>
          <Button onClick={onDone} disabled={busy}>
            Cancel
          </Button>
        </div>
        <div className="sm:col-span-2">
          <ErrorText error={error} />
        </div>
      </form>
    </Card>
  );
}
