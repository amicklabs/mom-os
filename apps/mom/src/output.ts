// Readable text by default, JSON with --json.

function scalar(v: unknown): string {
  if (v === null || v === undefined) return "-";
  if (typeof v === "string") return v;
  return String(v);
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

export function toText(value: unknown, indent = 0): string {
  const pad = "  ".repeat(indent);
  if (Array.isArray(value)) {
    if (value.length === 0) return `${pad}(none)`;
    return value
      .map((item) => {
        if (isPlainObject(item) || Array.isArray(item)) {
          const body = toText(item, indent + 1).replace(/^\s+/, "");
          return `${pad}- ${body}`;
        }
        return `${pad}- ${scalar(item)}`;
      })
      .join("\n");
  }
  if (isPlainObject(value)) {
    const entries = Object.entries(value);
    if (entries.length === 0) return `${pad}(empty)`;
    return entries
      .map(([k, v]) => {
        if (isPlainObject(v) || (Array.isArray(v) && v.some((x) => typeof x === "object" && x !== null))) {
          return `${pad}${k}:\n${toText(v, indent + 1)}`;
        }
        if (Array.isArray(v)) return `${pad}${k}: ${v.map(scalar).join(", ") || "(none)"}`;
        return `${pad}${k}: ${scalar(v)}`;
      })
      .join("\n");
  }
  return pad + scalar(value);
}

export function print(value: unknown, json: boolean): void {
  if (json) {
    process.stdout.write(JSON.stringify(value, null, 2) + "\n");
    return;
  }
  process.stdout.write(toText(value) + "\n");
}

export function fail(message: string, json: boolean, code = 1): never {
  if (json) process.stdout.write(JSON.stringify({ ok: false, error: message }) + "\n");
  else process.stderr.write(`mom: ${message}\n`);
  process.exit(code);
}

export function ago(ms: number, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - ms) / 1000));
  if (s < 60) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h} h ago`;
  return `${Math.round(h / 24)} days ago`;
}
