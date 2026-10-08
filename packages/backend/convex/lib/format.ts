import type { DeviceStatusDoc } from "../validators";

// Heartbeats come every 60 s, so three missed ones mean offline.
export const ONLINE_WINDOW_MS = 3 * 60_000;

export const TELEGRAM_TEXT_LIMIT = 4096;
export const TELEGRAM_CAPTION_LIMIT = 1024;

export function isOnline(lastSeenAt: number | undefined, now: number): boolean {
  return lastSeenAt !== undefined && now - lastSeenAt < ONLINE_WINDOW_MS;
}

export function truncate(text: string, limit: number): string {
  if (text.length <= limit) return text;
  const marker = "\n\n[cut off]";
  return text.slice(0, limit - marker.length) + marker;
}

export function ago(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 60) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h} h ago`;
  return `${Math.round(h / 24)} days ago`;
}

// The same as statusLines, on one line: "Using youtube · Internet working
// (home, 70%) · Battery 54%".
export function contextLine(status: DeviceStatusDoc | undefined): string {
  if (!status) return "No status from the laptop yet.";
  const wifi = status.wifi?.ssid ? ` (${status.wifi.ssid}${status.wifi.signal != null ? `, ${status.wifi.signal}%` : ""})` : "";
  const parts = [
    `Using ${status.app ?? "the home screen"}`,
    `Internet ${status.online ? "working" : "not working"}${wifi}`,
    status.battery
      ? `Battery ${Math.round(status.battery.percent)}%${status.battery.charging ? ", charging" : ""}`
      : "Battery unknown",
  ];
  if (status.locked) parts.push("locked");
  if (status.lidClosed) parts.push("lid closed");
  if (status.viewer) parts.push("someone is viewing the screen");
  return parts.join(" · ");
}

export function statusLines(status: DeviceStatusDoc | undefined): string[] {
  if (!status) return ["No heartbeat yet."];
  const lines = [`App: ${status.app ?? "home screen"}`];
  const wifi = status.wifi?.ssid ? ` (${status.wifi.ssid}${status.wifi.signal != null ? `, ${status.wifi.signal}%` : ""})` : "";
  lines.push(`Internet: ${status.online ? "working" : "not working"}${wifi}`);
  if (status.battery) {
    lines.push(`Battery: ${Math.round(status.battery.percent)}%${status.battery.charging ? ", charging" : ""}`);
  } else {
    lines.push("Battery: unknown");
  }
  const flags = [
    status.locked ? "locked" : null,
    status.lidClosed ? "lid closed" : null,
    status.viewer ? "someone is viewing the screen" : null,
  ].filter(Boolean);
  if (flags.length) lines.push(`Also: ${flags.join(", ")}`);
  return lines;
}
