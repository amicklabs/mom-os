// Heartbeats come every 60 s; three missed means offline. Matches the backend.
export const ONLINE_WINDOW_MS = 3 * 60_000;

export function isOnline(lastSeenAt: number | null | undefined, now: number): boolean {
  return lastSeenAt != null && now - lastSeenAt < ONLINE_WINDOW_MS;
}

export function ago(at: number, now: number): string {
  const s = Math.max(0, Math.round((now - at) / 1000));
  if (s < 45) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 36) return `${h} h ago`;
  return `${Math.round(h / 24)} days ago`;
}

export function when(at: number): string {
  return new Date(at).toLocaleString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function time(at: number): string {
  return new Date(at).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit", second: "2-digit" });
}

export function day(at: number): string {
  return new Date(at).toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
}
