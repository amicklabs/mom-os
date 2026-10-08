"use client";

import { api } from "@momos/backend/convex/_generated/api";
import type { Id } from "@momos/backend/convex/_generated/dataModel";
import { useMutation, useQuery } from "convex/react";
import { Badge, Button, Card, ErrorText, useNow, useRun } from "@/components/ui";
import { lastReload, reloadableTiles, reloadStatus } from "@/lib/reload";

// A Reload button beside each of her web pages. The page comes to the front
// on her screen and reloads, or opens if it was closed, and her screen says
// "<helper> refreshed <page>." for a few seconds. Each row shows how the last
// reload of that page went, whether it came from here or from Telegram.
export function ReloadPages({ deviceId, name }: { deviceId: Id<"devices">; name: string }) {
  const settings = useQuery(api.admin.settings, { deviceId });
  const detail = useQuery(api.admin.device, { deviceId });
  const queue = useMutation(api.admin.queueAction);
  const { busy, error, run } = useRun();
  const now = useNow(2000);
  const tiles = reloadableTiles(settings?.settings.tiles ?? []);
  if (!tiles.length) return null;
  const actions = detail?.actions ?? [];

  return (
    <Card title="Reload a page">
      <p className="mb-3 text-sm text-stone-500">
        For a page that&apos;s stuck, or still asks to sign in after {name} signed in somewhere else. It comes to the front on{" "}
        {name}&apos;s screen and reloads, and the screen says so for a few seconds.
      </p>
      <ul className="flex flex-col divide-y divide-stone-100 dark:divide-stone-800">
        {tiles.map((t) => {
          const status = reloadStatus(lastReload(actions, t.id, now), now);
          return (
            <li key={t.id} className="flex items-center justify-between gap-3 py-2">
              <div className="min-w-0">
                <div className="truncate font-medium">{t.label}</div>
                {status && (
                  <div className="mt-0.5">
                    <Badge tone={status.tone}>{status.text}</Badge>
                  </div>
                )}
              </div>
              <Button
                disabled={busy}
                aria-label={`Reload ${t.label}`}
                onClick={() => void run(() => queue({ deviceId, action: { type: "reload", tileId: t.id } }))}
              >
                Reload
              </Button>
            </li>
          );
        })}
      </ul>
      <ErrorText error={error} />
    </Card>
  );
}
