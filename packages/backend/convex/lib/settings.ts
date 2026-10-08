import { Action, Settings } from "@momos/shared";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import type { SettingsDoc } from "../validators";

function describe(issues: { path: PropertyKey[]; message: string }[]): string {
  return issues
    .slice(0, 5)
    .map((i) => `${i.path.map(String).join(".") || "(root)"}: ${i.message}`)
    .join("; ");
}

export function parseSettings(input: unknown): SettingsDoc {
  const parsed = Settings.safeParse(input);
  if (!parsed.success) throw new Error(`Invalid settings: ${describe(parsed.error.issues)}`);
  const ids = new Set<string>();
  for (const tile of parsed.data.tiles) {
    if (ids.has(tile.id)) throw new Error(`Invalid settings: duplicate tile id ${tile.id}`);
    ids.add(tile.id);
  }
  const members = new Set<string>();
  for (const m of parsed.data.family) {
    if (members.has(m.id)) throw new Error(`Invalid settings: duplicate family id ${m.id}`);
    members.add(m.id);
  }
  return parsed.data as SettingsDoc;
}

export function parseAction(input: unknown): Action {
  const parsed = Action.safeParse(input);
  if (!parsed.success) throw new Error(`Invalid action: ${describe(parsed.error.issues)}`);
  return parsed.data;
}

type DbCtx = Pick<QueryCtx | MutationCtx, "db">;

export async function settingsFor(ctx: DbCtx, deviceId: Id<"devices">): Promise<Doc<"settings"> | null> {
  return await ctx.db
    .query("settings")
    .withIndex("by_device", (q) => q.eq("deviceId", deviceId))
    .unique();
}

export async function withPhotoUrls(
  ctx: Pick<QueryCtx, "storage">,
  doc: Doc<"settings">,
): Promise<{ id: string; fileName: string; url: string }[]> {
  const photos = await Promise.all(
    doc.photos.map(async (p) => {
      const url = await ctx.storage.getUrl(p.storageId);
      return url ? { id: p.memberId, fileName: p.fileName, url } : null;
    }),
  );
  return photos.filter((p) => p !== null);
}

export async function personName(ctx: DbCtx, device: Doc<"devices">): Promise<string> {
  const doc = await settingsFor(ctx, device._id);
  return doc?.settings.person.name ?? device.name;
}
