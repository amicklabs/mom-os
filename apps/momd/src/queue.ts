import { Database } from "bun:sqlite";
import { DeviceEvent } from "@momos/shared";

// Events waiting to go to Convex, kept in SQLite so they survive restarts and
// time offline. The table is capped: when it's full the oldest go first.

export const QUEUE_CAP = 50_000;

export class EventQueue {
  // The help outbox (outbox.ts) keeps its table in the same file.
  readonly db: Database;
  private inserts = 0;

  constructor(
    path: string,
    private readonly cap = QUEUE_CAP,
  ) {
    this.db = new Database(path, { create: true });
    this.db.exec("PRAGMA journal_mode = WAL");
    this.db.exec("PRAGMA synchronous = NORMAL");
    this.db.exec("CREATE TABLE IF NOT EXISTS events (seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT UNIQUE NOT NULL, at INTEGER NOT NULL, body TEXT NOT NULL)");
    this.db.exec("CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)");
    this.trim();
  }

  add(event: DeviceEvent): void {
    this.db.query("INSERT OR IGNORE INTO events (id, at, body) VALUES (?, ?, ?)").run(event.id, event.at, JSON.stringify(event));
    if (++this.inserts % 100 === 0) this.trim();
  }

  // Oldest first. Rows that no longer parse are dropped.
  peek(limit: number): DeviceEvent[] {
    const rows = this.db.query("SELECT id, body FROM events ORDER BY seq LIMIT ?").all(limit) as { id: string; body: string }[];
    const out: DeviceEvent[] = [];
    const bad: string[] = [];
    for (const r of rows) {
      const parsed = DeviceEvent.safeParse(safeJson(r.body));
      if (parsed.success) out.push(parsed.data);
      else bad.push(r.id);
    }
    if (bad.length) this.ack(bad);
    return out;
  }

  ack(ids: string[]): void {
    if (!ids.length) return;
    const del = this.db.query("DELETE FROM events WHERE id = ?");
    this.db.transaction((xs: string[]) => {
      for (const id of xs) del.run(id);
    })(ids);
  }

  count(): number {
    return (this.db.query("SELECT COUNT(*) AS n FROM events").get() as { n: number }).n;
  }

  trim(): void {
    const n = this.count();
    if (n > this.cap) this.db.query("DELETE FROM events WHERE seq IN (SELECT seq FROM events ORDER BY seq LIMIT ?)").run(n - this.cap);
  }

  getMeta(key: string): string | null {
    const row = this.db.query("SELECT value FROM meta WHERE key = ?").get(key) as { value: string } | null;
    return row?.value ?? null;
  }

  setMeta(key: string, value: string): void {
    this.db.query("INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(key, value);
  }

  close(): void {
    this.db.close();
  }
}

function safeJson(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}
