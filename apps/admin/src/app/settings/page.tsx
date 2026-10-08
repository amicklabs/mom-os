"use client";

import { NATIVE_APPS, Settings, type FamilyMember, type Tile } from "@momos/shared";
import { api } from "@momos/backend/convex/_generated/api";
import type { Id } from "@momos/backend/convex/_generated/dataModel";
import { useMutation, useQuery } from "convex/react";
import { useMemo, useState, type ReactNode } from "react";
import type { DeviceSummary } from "@/components/device-context";
import { NeedsDevice } from "@/components/shell";
import { Button, Card, ErrorText, Field, Loading, useRun } from "@/components/ui";

export default function SettingsPage() {
  return <NeedsDevice>{(device) => <Loader key={device._id} device={device} />}</NeedsDevice>;
}

// A starting point for a device that has no settings yet. Nothing personal.
const TEMPLATE: Settings = {
  person: { name: "", user: "" },
  helper: { name: "", phone: "" },
  tiles: [
    { id: "family", label: "Family", icon: "family", type: "page", page: "family" },
    { id: "telegram", label: "Telegram", icon: "telegram", type: "app", app: "telegram" },
    { id: "youtube", label: "YouTube", icon: "youtube", type: "webapp", url: "https://www.youtube.com" },
    { id: "facebook", label: "Facebook", icon: "facebook", type: "webapp", url: "https://www.facebook.com" },
    { id: "email", label: "Email", icon: "email", type: "webapp", url: "https://mail.google.com" },
    { id: "photos", label: "Photos", icon: "photos", type: "webapp", url: "https://photos.google.com" },
    { id: "internet", label: "Browser", icon: "internet", type: "app", app: "chromium" },
  ],
  family: [],
};

const TILE_TYPES: { value: Tile["type"]; label: string }[] = [
  { value: "webapp", label: "Web app" },
  { value: "app", label: "Installed app" },
  { value: "telegram-chat", label: "Telegram chat" },
  { value: "page", label: "Page" },
];

function Loader({ device }: { device: DeviceSummary }) {
  const data = useQuery(api.admin.settings, { deviceId: device._id });
  if (data === undefined) return <Loading />;
  // The server checked these against the same schema on write.
  const saved = data ? (data.settings as Settings) : null;
  return <Editor deviceId={device._id} saved={saved} photos={data?.photos ?? []} />;
}

function Editor({
  deviceId,
  saved,
  photos,
}: {
  deviceId: Id<"devices">;
  saved: Settings | null;
  photos: { id: string; url: string }[];
}) {
  const [draft, setDraft] = useState<Settings>(() => structuredClone(saved ?? TEMPLATE));
  const update = useMutation(api.admin.updateSettings);
  const { busy, error, run } = useRun();
  const [savedAt, setSavedAt] = useState<number | null>(null);

  const parsed = useMemo(() => Settings.safeParse(draft), [draft]);
  const errors = useMemo(() => {
    const map = new Map<string, string>();
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        const key = issue.path.map(String).join(".");
        if (!map.has(key)) map.set(key, issue.message);
      }
    }
    for (const [key, message] of duplicateErrors(draft)) map.set(key, message);
    return map;
  }, [parsed, draft]);
  const err = (path: string) => errors.get(path);
  const dirty = JSON.stringify(draft) !== JSON.stringify(saved);
  const valid = errors.size === 0;

  function set(fn: (d: Settings) => void) {
    setDraft((prev) => {
      const next = structuredClone(prev);
      fn(next);
      return next;
    });
    setSavedAt(null);
  }

  async function save() {
    if (!parsed.success) return;
    const ok = await run(async () => {
      await update({ deviceId, settings: parsed.data });
      return true;
    });
    if (ok) setSavedAt(Date.now());
  }

  return (
    <div className="flex flex-col gap-4 pb-24">
      <h1 className="text-xl font-semibold">Settings</h1>
      {!saved && (
        <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-200">
          This device has no settings in Convex yet. The laptop keeps using its local config until you save.
        </p>
      )}

      <Card title="Names">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Person's name" error={err("person.name")} hint="Shown in the greeting.">
            <input value={draft.person.name} onChange={(e) => set((d) => void (d.person.name = e.target.value))} />
          </Field>
          <Field label="Linux user" error={err("person.user")}>
            <input value={draft.person.user} autoCapitalize="none" onChange={(e) => set((d) => void (d.person.user = e.target.value))} />
          </Field>
          <Field label="Person's phone" error={err("person.phone")} hint="Optional. The Call button under a help request on Telegram shows it.">
            <input
              type="tel"
              value={draft.person.phone ?? ""}
              onChange={(e) => set((d) => void (d.person.phone = e.target.value.trim() ? e.target.value : null))}
            />
          </Field>
          <Field
            label="Person's Telegram username"
            error={err("person.telegram")}
            hint="Optional. The Call button links to this Telegram chat. Without the @."
          >
            <input
              value={draft.person.telegram ?? ""}
              autoCapitalize="none"
              placeholder="username"
              onChange={(e) => set((d) => void (d.person.telegram = e.target.value.replace(/^@/, "").trim() || null))}
            />
          </Field>
          <Field label="Helper's name" error={err("helper.name")} hint='Used in "Get help from ..."'>
            <input value={draft.helper.name} onChange={(e) => set((d) => void (d.helper.name = e.target.value))} />
          </Field>
          <Field label="Helper's phone" error={err("helper.phone")} hint="Shown in large type when the laptop is offline.">
            <input type="tel" value={draft.helper.phone} onChange={(e) => set((d) => void (d.helper.phone = e.target.value))} />
          </Field>
          <Field
            label="Helper's Telegram username"
            error={err("helper.telegram")}
            hint='Optional. Adds "Message ... on Telegram" to the Help pop-up. Without the @.'
          >
            <input
              value={draft.helper.telegram ?? ""}
              autoCapitalize="none"
              placeholder="username"
              onChange={(e) => set((d) => void (d.helper.telegram = e.target.value.replace(/^@/, "").trim() || null))}
            />
          </Field>
        </div>
        <label className="mt-3 flex min-h-11 items-center gap-3 rounded-xl border border-stone-200 px-3 py-2 text-sm dark:border-stone-800">
          <input
            type="checkbox"
            className="h-5 w-5"
            checked={draft.helper.autoInvestigate === true}
            onChange={(e) =>
              set((d) => {
                if (e.target.checked) d.helper.autoInvestigate = true;
                else delete d.helper.autoInvestigate;
              })
            }
          />
          <span>
            <span className="font-medium">Send an agent on every help request</span>
            <span className="block text-xs text-stone-500">
              Off: help requests just reach you, and you tap Send an agent when you want one. On: an agent starts looking whenever a help request comes with writing or a voice note.
            </span>
          </span>
        </label>
      </Card>

      <Card
        title={`Tiles (${draft.tiles.length}/12)`}
        action={
          <Button
            variant="ghost"
            disabled={draft.tiles.length >= 12}
            onClick={() => set((d) => void d.tiles.push({ id: "", label: "", type: "webapp", url: "https://" }))}
          >
            Add tile
          </Button>
        }
      >
        <ErrorLine message={err("tiles")} />
        <ol className="flex flex-col gap-3">
          {draft.tiles.map((tile, i) => (
            <li key={i} className="rounded-xl border border-stone-200 p-3 dark:border-stone-800">
              <TileEditor tile={tile} index={i} err={err} onChange={(t) => set((d) => void (d.tiles[i] = t))} />
              <RowControls
                index={i}
                count={draft.tiles.length}
                move={(to) => set((d) => void d.tiles.splice(to, 0, d.tiles.splice(i, 1)[0]!))}
                remove={() => set((d) => void d.tiles.splice(i, 1))}
              />
            </li>
          ))}
        </ol>
      </Card>

      <Card
        title={`Family (${draft.family.length}/24)`}
        action={
          <Button
            variant="ghost"
            disabled={draft.family.length >= 24}
            onClick={() => set((d) => void d.family.push({ id: "", name: "", telegram: "", photo: null }))}
          >
            Add person
          </Button>
        }
      >
        <ErrorLine message={err("family")} />
        <ol className="flex flex-col gap-3">
          {draft.family.map((m, i) => (
            <li key={i} className="rounded-xl border border-stone-200 p-3 dark:border-stone-800">
              <MemberEditor
                member={m}
                index={i}
                err={err}
                deviceId={deviceId}
                photoUrl={photos.find((p) => p.id === m.id)?.url ?? null}
                isSaved={!!saved?.family.some((s) => s.id === m.id)}
                onChange={(next) => set((d) => void (d.family[i] = next))}
              />
              <RowControls
                index={i}
                count={draft.family.length}
                move={(to) => set((d) => void d.family.splice(to, 0, d.family.splice(i, 1)[0]!))}
                remove={() => set((d) => void d.family.splice(i, 1))}
              />
            </li>
          ))}
        </ol>
      </Card>

      <div className="fixed inset-x-0 bottom-14 z-10 border-t border-stone-200 bg-stone-50/95 p-3 backdrop-blur md:bottom-0 dark:border-stone-800 dark:bg-stone-950/95">
        <div className="mx-auto flex max-w-4xl items-center gap-3">
          <Button variant="primary" disabled={!dirty || !valid || busy} onClick={save}>
            {busy ? "Saving..." : "Save settings"}
          </Button>
          <Button disabled={!dirty || busy} onClick={() => setDraft(structuredClone(saved ?? TEMPLATE))}>
            Undo changes
          </Button>
          <span className="min-w-0 flex-1 truncate text-sm">
            {!valid ? (
              <span className="text-red-600 dark:text-red-400">
                {errors.size} problem{errors.size > 1 ? "s" : ""} to fix
              </span>
            ) : savedAt && !dirty ? (
              <span className="text-emerald-700 dark:text-emerald-400">Saved. The laptop picks it up within seconds.</span>
            ) : dirty ? (
              <span className="text-stone-500">Unsaved changes</span>
            ) : null}
          </span>
        </div>
        <div className="mx-auto max-w-4xl">
          <ErrorText error={error} />
        </div>
      </div>
    </div>
  );
}

function duplicateErrors(s: Settings): [string, string][] {
  const out: [string, string][] = [];
  const seen = new Set<string>();
  s.tiles.forEach((t, i) => {
    if (t.id && seen.has(t.id)) out.push([`tiles.${i}.id`, "Another tile already uses this id"]);
    seen.add(t.id);
  });
  const members = new Set<string>();
  s.family.forEach((m, i) => {
    if (m.id && members.has(m.id)) out.push([`family.${i}.id`, "Another person already uses this id"]);
    members.add(m.id);
  });
  return out;
}

function ErrorLine({ message }: { message?: string }) {
  return message ? <p className="mb-2 text-sm text-red-600 dark:text-red-400">{message}</p> : null;
}

function RowControls({ index, count, move, remove }: { index: number; count: number; move: (to: number) => void; remove: () => void }) {
  return (
    <div className="mt-3 flex gap-2">
      <Button variant="ghost" disabled={index === 0} onClick={() => move(index - 1)} aria-label="Move up">
        Up
      </Button>
      <Button variant="ghost" disabled={index === count - 1} onClick={() => move(index + 1)} aria-label="Move down">
        Down
      </Button>
      <Button variant="ghost" className="ml-auto text-red-600 dark:text-red-400" onClick={remove}>
        Remove
      </Button>
    </div>
  );
}

function slug(label: string) {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

type Err = (path: string) => string | undefined;

function TileEditor({ tile, index, err, onChange }: { tile: Tile; index: number; err: Err; onChange: (t: Tile) => void }) {
  const p = `tiles.${index}`;
  const base = { id: tile.id, label: tile.label, icon: tile.icon ?? null };

  function changeType(type: Tile["type"]) {
    if (type === "webapp") onChange({ ...base, type, url: "https://" });
    else if (type === "app") onChange({ ...base, type, app: "chromium" });
    else if (type === "telegram-chat") onChange({ ...base, type, telegram: "" });
    else onChange({ ...base, type, page: "family" });
  }

  let specific: ReactNode;
  if (tile.type === "webapp") {
    specific = (
      <Field label="URL" error={err(`${p}.url`)} hint="https only.">
        <input type="url" autoCapitalize="none" value={tile.url} onChange={(e) => onChange({ ...tile, url: e.target.value })} />
      </Field>
    );
  } else if (tile.type === "app") {
    specific = (
      <Field label="App" error={err(`${p}.app`)}>
        <select value={tile.app} onChange={(e) => onChange({ ...tile, app: e.target.value as keyof typeof NATIVE_APPS })}>
          {Object.keys(NATIVE_APPS).map((a) => (
            <option key={a} value={a}>
              {a}
            </option>
          ))}
        </select>
      </Field>
    );
  } else if (tile.type === "telegram-chat") {
    specific = (
      <Field label="Telegram username" error={err(`${p}.telegram`)}>
        <input autoCapitalize="none" value={tile.telegram} onChange={(e) => onChange({ ...tile, telegram: e.target.value })} />
      </Field>
    );
  } else {
    specific = (
      <Field label="Page" error={err(`${p}.page`)} hint='The shell knows "family".'>
        <input autoCapitalize="none" value={tile.page} onChange={(e) => onChange({ ...tile, page: e.target.value })} />
      </Field>
    );
  }

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <Field label="Label" error={err(`${p}.label`)}>
        <input
          value={tile.label}
          onChange={(e) => {
            const label = e.target.value;
            // Fill the id from the label until the id is edited by hand.
            const id = !tile.id || tile.id === slug(tile.label) ? slug(label) : tile.id;
            onChange({ ...tile, label, id });
          }}
        />
      </Field>
      <Field label="Type">
        <select value={tile.type} onChange={(e) => changeType(e.target.value as Tile["type"])}>
          {TILE_TYPES.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </select>
      </Field>
      {specific}
      <Field label="Id" error={err(`${p}.id`)} hint="Lowercase letters, digits and dashes.">
        <input autoCapitalize="none" value={tile.id} onChange={(e) => onChange({ ...tile, id: e.target.value })} />
      </Field>
      <Field label="Icon" error={err(`${p}.icon`)} hint="A name from the shell's icon set, or your own SVG in icons/ next to config.json. Empty for text only.">
        <input autoCapitalize="none" value={tile.icon ?? ""} onChange={(e) => onChange({ ...tile, icon: e.target.value || null })} />
      </Field>
    </div>
  );
}

function MemberEditor({
  member,
  index,
  err,
  deviceId,
  photoUrl,
  isSaved,
  onChange,
}: {
  member: FamilyMember;
  index: number;
  err: Err;
  deviceId: Id<"devices">;
  photoUrl: string | null;
  isSaved: boolean;
  onChange: (m: FamilyMember) => void;
}) {
  const p = `family.${index}`;
  const generateUploadUrl = useMutation(api.admin.generateUploadUrl);
  const setPhoto = useMutation(api.admin.setFamilyPhoto);
  const removePhoto = useMutation(api.admin.removeFamilyPhoto);
  const { busy, error, run } = useRun();

  async function upload(file: File) {
    await run(async () => {
      const url = await generateUploadUrl();
      const res = await fetch(url, { method: "POST", headers: { "Content-Type": file.type }, body: file });
      if (!res.ok) throw new Error("Upload failed.");
      const { storageId } = (await res.json()) as { storageId: Id<"_storage"> };
      const result = await setPhoto({ deviceId, memberId: member.id, storageId });
      if (!result.ok) throw new Error(result.error);
      onChange({ ...member, photo: result.fileName });
    });
  }

  return (
    <div className="flex gap-3">
      <div className="flex w-20 shrink-0 flex-col items-center gap-2">
        {photoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={photoUrl} alt={member.name} className="h-20 w-20 rounded-full object-cover" />
        ) : (
          <div className="flex h-20 w-20 items-center justify-center rounded-full bg-stone-200 text-2xl font-semibold text-stone-600 dark:bg-stone-800 dark:text-stone-300">
            {member.name.slice(0, 1).toUpperCase() || "?"}
          </div>
        )}
        {isSaved ? (
          <>
            <label className="cursor-pointer text-xs font-medium text-sky-700 dark:text-sky-400">
              {busy ? "Uploading..." : photoUrl ? "Change" : "Add photo"}
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp"
                className="hidden"
                disabled={busy}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  e.target.value = "";
                  if (file) void upload(file);
                }}
              />
            </label>
            {photoUrl && (
              <button
                type="button"
                className="text-xs text-red-600 dark:text-red-400"
                disabled={busy}
                onClick={() =>
                  run(async () => {
                    await removePhoto({ deviceId, memberId: member.id });
                    onChange({ ...member, photo: null });
                  })
                }
              >
                Remove
              </button>
            )}
          </>
        ) : (
          <span className="text-center text-xs text-stone-500">Save first to add a photo</span>
        )}
      </div>
      <div className="grid min-w-0 flex-1 gap-3 sm:grid-cols-2">
        <Field label="Name" error={err(`${p}.name`)}>
          <input
            value={member.name}
            onChange={(e) => {
              const name = e.target.value;
              const id = !member.id || member.id === slug(member.name) ? slug(name) : member.id;
              onChange({ ...member, name, id: isSaved ? member.id : id });
            }}
          />
        </Field>
        <Field label="Telegram username" error={err(`${p}.telegram`)}>
          <input autoCapitalize="none" value={member.telegram} onChange={(e) => onChange({ ...member, telegram: e.target.value })} />
        </Field>
        <Field label="Id" error={err(`${p}.id`)} hint={isSaved ? "Changing it drops the uploaded photo." : undefined}>
          <input autoCapitalize="none" value={member.id} onChange={(e) => onChange({ ...member, id: e.target.value })} />
        </Field>
        <Field label="Photo file" error={err(`${p}.photo`)} hint={photoUrl ? "Set by the upload." : "A file already in the laptop's photos folder, or empty."}>
          <input
            autoCapitalize="none"
            value={member.photo ?? ""}
            readOnly={!!photoUrl}
            onChange={(e) => onChange({ ...member, photo: e.target.value || null })}
          />
        </Field>
        <ErrorText error={error} />
      </div>
    </div>
  );
}
