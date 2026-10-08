import type { Overview } from "./convex";
import type { JobRecord } from "./runner";

// Everything the bar plugin shows, already worded. The plugin draws this and
// holds no logic of its own.

export type BarState = "online" | "offline" | "help" | "approval" | "working" | "unknown";

export interface Summary {
  state: BarState;
  attention: boolean;
  title: string;
  label: string;
  lines: string[];
  helpRequests: { id: string; when: string; text: string }[];
  jobs: { id: string; kind: string; status: string; statusLabel: string; when: string; excerpt: string; canApprove: boolean }[];
  approvableJobId: string | null;
  deviceId: string | null;
  screenshot: { path: string; when: string } | null;
}

export interface LocalState {
  convex: "connected" | "connecting" | "no-url" | "no-token" | "error";
  convexError: string | null;
  current: JobRecord | null;
  screenshot: { path: string; takenAt: number } | null;
  preferredDevice: string | null;
}

export function ago(ms: number | null | undefined, now = Date.now()): string {
  if (!ms) return "never";
  const s = Math.max(0, Math.round((now - ms) / 1000));
  if (s < 60) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 36) return `${h} h ago`;
  return `${Math.round(h / 24)} days ago`;
}

const STATUS_LABELS: Record<string, string> = {
  queued: "Waiting to start",
  investigating: "Looking into it",
  awaiting_approval: "Waiting for your OK",
  approved: "Approved, starting fix",
  fixing: "Fixing",
  done: "Done",
  failed: "Failed",
  cancelled: "Cancelled",
};

function excerpt(s: string | undefined, n = 160): string {
  if (!s) return "";
  const flat = s.replace(/\*\*/g, "").replace(/\s+/g, " ").trim();
  return flat.length > n ? flat.slice(0, n - 1) + "…" : flat;
}

function statusLines(status: Record<string, unknown> | null | undefined): string[] {
  if (!status) return [];
  const lines: string[] = [];
  if (typeof status.app === "string" && status.app) lines.push(`Using: ${status.app}`);
  else lines.push("On the home screen");
  const wifi = status.wifi as { ssid?: string | null; signal?: number | null } | null | undefined;
  if (status.online === false) lines.push("Internet: not working");
  else if (wifi?.ssid) lines.push(`Internet: working (${wifi.ssid}${typeof wifi.signal === "number" ? `, ${wifi.signal}%` : ""})`);
  else lines.push("Internet: working");
  const battery = status.battery as { percent?: number; charging?: boolean } | null | undefined;
  if (battery && typeof battery.percent === "number") lines.push(`Battery: ${Math.round(battery.percent)}%${battery.charging ? ", charging" : ""}`);
  if (status.viewer === true) lines.push("Someone is viewing the screen");
  if (status.locked === true) lines.push("Screen is locked");
  if (status.lidClosed === true) lines.push("Lid is closed");
  return lines;
}

export function summarize(overview: Overview | null, local: LocalState, now = Date.now()): Summary {
  const devices = overview?.devices ?? [];
  const device = devices.find((d) => d.name === local.preferredDevice) ?? devices[0] ?? null;
  const person = device?.personName ?? device?.name ?? "The laptop";
  const help = (overview?.helpRequests ?? []).filter((h) => !device || h.deviceId === device._id);
  const jobs = (overview?.jobs ?? []).filter((j) => !device || j.deviceId === device._id);
  const approvable = jobs.find((j) => j.status === "awaiting_approval") ?? null;
  const running = local.current !== null || jobs.some((j) => j.status === "investigating" || j.status === "fixing");

  let state: BarState;
  let label: string;
  if (!overview || !device) {
    state = "unknown";
    label =
      local.convex === "no-token" ? "Dispatcher has no Convex token"
      : local.convex === "no-url" ? "Dispatcher has no Convex URL"
      : local.convex === "error" ? `Can't reach Convex${local.convexError ? `: ${local.convexError}` : ""}`
      : overview ? "No laptops registered"
      : "Connecting to Convex";
  } else if (help.length) {
    state = "help";
    label = `${person} asked for help ${ago(help[0]!.createdAt, now)}`;
  } else if (approvable) {
    state = "approval";
    label = "A fix is waiting for your OK";
  } else if (running) {
    state = "working";
    label = local.current?.phase === "fix" ? "An agent is fixing something" : "An agent is looking into it";
  } else if (device.online) {
    state = "online";
    label = `${person} is online`;
  } else {
    state = "offline";
    label = `${person} is offline, last seen ${ago(device.lastSeenAt, now)}`;
  }

  const lines: string[] = [];
  if (device) {
    lines.push(device.online ? `Online, last heard from ${ago(device.lastSeenAt, now)}` : `Offline, last seen ${ago(device.lastSeenAt, now)}`);
    if (device.online) lines.push(...statusLines(device.status));
  }
  if (local.current) lines.push(`Agent: ${local.current.phase === "fix" ? "fixing" : "investigating"} since ${ago(local.current.startedAt, now)}`);

  return {
    state,
    attention: state === "help" || state === "approval",
    title: person,
    label,
    lines,
    helpRequests: help.slice(0, 5).map((h) => {
      const app = h.context && typeof h.context.app === "string" ? h.context.app : null;
      return { id: h._id, when: ago(h.createdAt, now), text: app ? `Asked for help while using ${app}` : "Asked for help" };
    }),
    jobs: jobs.slice(0, 5).map((j) => ({
      id: j._id,
      kind: j.kind,
      status: j.status,
      statusLabel: STATUS_LABELS[j.status] ?? j.status,
      when: ago(j.updatedAt ?? j.createdAt, now),
      excerpt: excerpt(j.report) || excerpt(j.prompt),
      canApprove: j.status === "awaiting_approval",
    })),
    approvableJobId: approvable?._id ?? null,
    deviceId: device?._id ?? null,
    screenshot: local.screenshot ? { path: local.screenshot.path, when: ago(local.screenshot.takenAt, now) } : null,
  };
}
