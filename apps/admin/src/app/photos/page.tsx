"use client";

import { api } from "@momos/backend/convex/_generated/api";
import type { Id } from "@momos/backend/convex/_generated/dataModel";
import { useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { useState } from "react";
import type { DeviceSummary } from "@/components/device-context";
import { NeedsDevice } from "@/components/shell";
import { Card, ConfirmDialog, Empty, ErrorText, Loading, useNow, useRun } from "@/components/ui";
import { ago } from "@/lib/format";
import { resizeToJpeg } from "@/lib/image";

export default function PhotosPage() {
  return <NeedsDevice>{(device) => <Photos key={device._id} device={device} />}</NeedsDevice>;
}

type Photo = FunctionReturnType<typeof api.slideshow.list>[number];

function Photos({ device }: { device: DeviceSummary }) {
  const photos = useQuery(api.slideshow.list, { deviceId: device._id });
  const generateUploadUrl = useMutation(api.admin.generateUploadUrl);
  const add = useMutation(api.slideshow.add);
  const remove = useMutation(api.slideshow.remove);
  const [progress, setProgress] = useState<string | null>(null);
  const [failures, setFailures] = useState<string[]>([]);
  const [deleting, setDeleting] = useState<Photo | null>(null);
  const { busy, error, run } = useRun();
  const now = useNow(60_000);
  const name = device.personName ?? device.name;

  async function upload(files: File[]) {
    setFailures([]);
    const failed: string[] = [];
    await run(async () => {
      for (const [i, file] of files.entries()) {
        setProgress(`Uploading ${i + 1} of ${files.length}...`);
        try {
          const jpeg = await resizeToJpeg(file, 1600);
          const url = await generateUploadUrl();
          const res = await fetch(url, { method: "POST", headers: { "Content-Type": "image/jpeg" }, body: jpeg });
          if (!res.ok) throw new Error("upload failed");
          const { storageId } = (await res.json()) as { storageId: Id<"_storage"> };
          const result = await add({ deviceId: device._id, storageId });
          if (!result.ok) throw new Error(result.error);
        } catch (err) {
          failed.push(`${file.name}: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
    });
    setProgress(null);
    setFailures(failed);
  }

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold">Screensaver photos</h1>
      <p className="text-sm text-stone-500">
        When {name}&apos;s laptop sits untouched for a few minutes, these photos fade from one to the next with a big clock in the
        corner. Any touch brings back what was on the screen. Photos are shrunk to 1600 pixels on the long side before upload.
      </p>

      <Card>
        <label
          className={`flex min-h-24 cursor-pointer flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed border-stone-300 p-4 text-center dark:border-stone-700 ${
            busy ? "opacity-50" : "hover:bg-stone-50 dark:hover:bg-stone-800"
          }`}
        >
          <span className="font-medium text-sky-700 dark:text-sky-400">{progress ?? "Add photos"}</span>
          <span className="text-xs text-stone-500">JPEG, PNG, HEIC or WebP. Pick several at once.</span>
          <input
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            disabled={busy}
            onChange={(e) => {
              const files = [...(e.target.files ?? [])];
              e.target.value = "";
              if (files.length) void upload(files);
            }}
          />
        </label>
        {failures.length > 0 && (
          <ul className="mt-2 text-sm text-red-600 dark:text-red-400">
            {failures.map((f) => (
              <li key={f}>{f}</li>
            ))}
          </ul>
        )}
        <ErrorText error={error} />
      </Card>

      {photos === undefined ? (
        <Loading />
      ) : photos.length === 0 ? (
        <Empty>No photos yet. Without photos the screensaver shows a calm clock.</Empty>
      ) : (
        <>
          <p className="text-sm text-stone-500">
            {photos.length} photo{photos.length > 1 ? "s" : ""}, newest first.
          </p>
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
            {photos.map((p) => (
              <li key={p._id} className="overflow-hidden rounded-xl border border-stone-200 bg-white dark:border-stone-800 dark:bg-stone-900">
                {p.url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={p.url} alt="" loading="lazy" className="aspect-[4/3] w-full bg-stone-100 object-cover dark:bg-stone-800" />
                ) : (
                  <div className="aspect-[4/3] w-full bg-stone-100 dark:bg-stone-800" />
                )}
                <div className="flex items-center justify-between gap-2 px-2 py-1">
                  <span className="min-w-0 truncate text-xs text-stone-500" title={p.addedBy}>
                    {ago(p.createdAt, now)}
                  </span>
                  <button type="button" className="min-h-9 px-2 text-xs font-medium text-red-600 dark:text-red-400" onClick={() => setDeleting(p)}>
                    Remove
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}

      <ConfirmDialog
        open={deleting !== null}
        title="Remove this photo?"
        confirmLabel="Remove"
        danger
        busy={busy}
        onCancel={() => setDeleting(null)}
        onConfirm={() => {
          const p = deleting;
          setDeleting(null);
          if (p) void run(() => remove({ photoId: p._id }));
        }}
      >
        It comes off {name}&apos;s screensaver the next time the laptop is online.
      </ConfirmDialog>
    </div>
  );
}
