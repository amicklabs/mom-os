import type { Database } from "bun:sqlite";
import { copyFileSync, mkdirSync, renameSync, unlinkSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { dataDir, type DeviceStatus, type HelpKind } from "@momos/shared";

// Help requests waiting to reach the helper, kept in momd's SQLite file so
// they survive a restart and time offline. Her screenshot and voice note wait
// next to it in ~/.local/share/momos/help-outbox/. A request is removed once
// Convex has it, or after OUTBOX_MAX_AGE_MS.

export const OUTBOX_MAX_AGE_MS = 3 * 24 * 60 * 60_000;
export const OUTBOX_CAP = 20;
// Waits between tries after a failure: 15 s, 30 s, 1 min, up to 10 min.
const BACKOFF_MS = [15_000, 30_000, 60_000, 120_000, 300_000, 600_000];

export interface HelpItem {
  id: string;
  askedAt: number;
  kinds: HelpKind[];
  text: string | null;
  // Why no fresh screenshot went with it, if she asked for one.
  note: string | null;
  context: DeviceStatus;
  screenshot: string | null;
  voice: string | null;
  voiceSeconds: number | null;
  attempts: number;
  nextAt: number;
}

export const outboxDir = () => `${dataDir()}/help-outbox`;

const remove = (f: string | null) => {
  if (!f) return;
  try {
    unlinkSync(f);
  } catch {
    // gone already
  }
};

export class HelpOutbox {
  constructor(
    private readonly db: Database,
    private readonly dir: () => string = outboxDir,
    private readonly now: () => number = Date.now,
  ) {
    db.exec(
      "CREATE TABLE IF NOT EXISTS help_outbox (id TEXT PRIMARY KEY, asked_at INTEGER NOT NULL, body TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0, next_at INTEGER NOT NULL DEFAULT 0, last_error TEXT)",
    );
  }

  // Moves (or copies) a file into the outbox folder, so it outlives the
  // runtime directory and a reboot.
  keep(file: string, ext: string, copy = false): string {
    const dir = this.dir();
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const dest = `${dir}/${randomUUID()}.${ext}`;
    if (copy) copyFileSync(file, dest);
    else {
      try {
        renameSync(file, dest);
      } catch {
        // Another filesystem: copy, then remove.
        copyFileSync(file, dest);
        remove(file);
      }
    }
    return dest;
  }

  add(item: Omit<HelpItem, "id" | "attempts" | "nextAt">): HelpItem {
    const full: HelpItem = { ...item, id: randomUUID(), attempts: 0, nextAt: 0 };
    const { id, askedAt, attempts, nextAt, ...body } = full;
    this.db
      .query("INSERT INTO help_outbox (id, asked_at, body, attempts, next_at) VALUES (?, ?, ?, ?, ?)")
      .run(id, askedAt, JSON.stringify(body), attempts, nextAt);
    this.trim();
    return full;
  }

  // Oldest first.
  list(): HelpItem[] {
    const rows = this.db
      .query("SELECT id, asked_at, body, attempts, next_at FROM help_outbox ORDER BY asked_at, rowid")
      .all() as { id: string; asked_at: number; body: string; attempts: number; next_at: number }[];
    const out: HelpItem[] = [];
    for (const r of rows) {
      try {
        out.push({ ...(JSON.parse(r.body) as Omit<HelpItem, "id" | "askedAt" | "attempts" | "nextAt">), id: r.id, askedAt: r.asked_at, attempts: r.attempts, nextAt: r.next_at });
      } catch {
        this.db.query("DELETE FROM help_outbox WHERE id = ?").run(r.id);
      }
    }
    return out;
  }

  // Ready to try now.
  due(): HelpItem[] {
    const now = this.now();
    return this.list().filter((i) => i.nextAt <= now);
  }

  count(): number {
    return (this.db.query("SELECT COUNT(*) AS n FROM help_outbox").get() as { n: number }).n;
  }

  // Convex has it: delete the row and its files.
  done(item: HelpItem): void {
    this.db.query("DELETE FROM help_outbox WHERE id = ?").run(item.id);
    remove(item.screenshot);
    remove(item.voice);
  }

  failed(item: HelpItem, error: string): void {
    const attempts = item.attempts + 1;
    const wait = BACKOFF_MS[Math.min(attempts - 1, BACKOFF_MS.length - 1)]!;
    this.db
      .query("UPDATE help_outbox SET attempts = ?, next_at = ?, last_error = ? WHERE id = ?")
      .run(attempts, this.now() + wait, error.slice(0, 500), item.id);
  }

  // Try everything again now, when the internet comes back.
  retryNow(): void {
    this.db.query("UPDATE help_outbox SET next_at = 0").run();
  }

  // Drops requests that are too old, and the oldest beyond the cap. Returns
  // how many went.
  trim(): number {
    const items = this.list();
    const cutoff = this.now() - OUTBOX_MAX_AGE_MS;
    const drop = items.filter((i, idx) => i.askedAt < cutoff || idx < items.length - OUTBOX_CAP);
    for (const i of drop) this.done(i);
    return drop.length;
  }
}
