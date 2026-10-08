import { existsSync, mkdirSync, readdirSync, unlinkSync } from "node:fs";
import { paths, type SlideshowPhoto } from "@momos/shared";
import { log } from "./core";
import { writeAtomic } from "./files";

// Keeps ~/.local/share/momos/slideshow/ matching the photo list from Convex:
// downloads what's missing and deletes what's gone. The shell's screensaver
// shows whatever *.jpg files are there.

const PHOTO_FILE = /^[A-Za-z0-9_-]{1,80}\.jpg$/;

export interface SyncPlan {
  download: SlideshowPhoto[];
  remove: string[];
}

// Pure: what to fetch and what to delete, given the remote list and the file
// names in the folder. Temp files and anything not named like a photo are
// left alone.
export function planSync(remote: SlideshowPhoto[], local: string[]): SyncPlan {
  const have = new Set(local.filter((f) => PHOTO_FILE.test(f)));
  const want = new Set<string>();
  const download: SlideshowPhoto[] = [];
  for (const p of remote) {
    if (!PHOTO_FILE.test(p.fileName) || want.has(p.fileName)) continue;
    want.add(p.fileName);
    if (!have.has(p.fileName)) download.push(p);
  }
  const remove = [...have].filter((f) => !want.has(f)).sort();
  return { download, remove };
}

export type Fetch = (url: string) => Promise<Uint8Array>;

const httpFetch: Fetch = async (url) => {
  const res = await fetch(url, { signal: AbortSignal.timeout(120_000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return new Uint8Array(await res.arrayBuffer());
};

// Runs one sync at a time. A list that arrives mid-sync runs next, and only
// the newest waiting list counts.
export class SlideshowSync {
  private running = false;
  private next: SlideshowPhoto[] | null = null;
  private latest: SlideshowPhoto[] | null = null;

  constructor(
    private readonly dir: () => string = paths.slideshow,
    private readonly get: Fetch = httpFetch,
    private readonly retryMs = 5 * 60_000,
  ) {}

  async sync(list: SlideshowPhoto[]): Promise<void> {
    this.next = list;
    this.latest = list;
    if (this.running) return;
    this.running = true;
    try {
      while (this.next) {
        const current = this.next;
        this.next = null;
        await this.apply(current);
      }
    } finally {
      this.running = false;
    }
  }

  private async apply(list: SlideshowPhoto[]): Promise<void> {
    const dir = this.dir();
    mkdirSync(dir, { recursive: true, mode: 0o755 });
    const local = existsSync(dir) ? readdirSync(dir) : [];
    const { download, remove } = planSync(list, local);
    for (const f of remove) {
      try {
        unlinkSync(`${dir}/${f}`);
      } catch {
        // already gone
      }
    }
    let failed = 0;
    for (const p of download) {
      try {
        writeAtomic(`${dir}/${p.fileName}`, await this.get(p.url));
      } catch (e) {
        failed++;
        log("slideshow", `can't download ${p.fileName}:`, e);
      }
    }
    if (download.length || remove.length) log("slideshow", `${download.length - failed} added, ${remove.length} removed`);
    // Try the missing ones again later, unless a newer list comes first.
    if (failed && this.retryMs > 0) {
      setTimeout(() => {
        if (this.latest === list) void this.sync(list);
      }, this.retryMs).unref?.();
    }
  }
}
