import type { ConfigFile, Tile } from "@momos/shared";
import * as hypr from "./hypr";
import { openTile } from "./launch";
import { launchDetached, run, runOk, type RunResult } from "./run";
import { splitTerse } from "./system";
import { tileWorkspace } from "./tiles";

// Joining networks for `momctl wifi scan|connect|forget|portal`, over nmcli.
// The shell's "Internet connection" page and `mom wifi ...` both use these.
//
// Passwords arrive on stdin and reach NetworkManager on nmcli's stdin, as
// commands for its profile editor, so they never appear in any argv.
// Profiles are system-wide with the password saved in them, so the laptop
// joins again by itself next time, before anyone logs in. Her account needs
// the polkit rule in system/files/polkit/50-momos-wifi.rules for that.

export type Strength = "strong" | "good" | "weak";
// open: no password. password: WPA/WPA2/WPA3 personal. enterprise: needs a
// username too (802.1X), which the page can't ask for. old: WEP, which it
// doesn't offer either.
export type Kind = "open" | "password" | "enterprise" | "old";

export interface Network {
  name: string;
  signal: number;
  strength: Strength;
  kind: Kind;
  secure: boolean;
  known: boolean;
  inUse: boolean;
}

export interface ScanResult {
  connectivity: string;
  portal: boolean;
  radio: boolean;
  device: string | null;
  current: { name: string; signal: number | null; strength: Strength | null } | null;
  networks: Network[];
}

export interface KnownConnection {
  uuid: string;
  name: string;
  ssid: string;
  active: boolean;
}

// Why a connect or forget failed, for the shell to put in plain words.
export type FailReason =
  | "password" // wrong or missing password
  | "short" // WPA passwords are 8 to 63 characters
  | "not-found" // the network isn't in range any more
  | "unsupported" // enterprise or WEP
  | "in-use" // forget refused: it's the network she's on
  | "unknown-network" // forget: nothing saved under that name
  | "no-wifi" // no Wi-Fi device
  | "not-allowed" // polkit said no
  | "timeout"
  | "failed";

export class WifiError extends Error {
  constructor(
    readonly reason: FailReason,
    message: string,
  ) {
    super(message);
  }
}

// ---- pure helpers (tested) --------------------------------------------------

export function strength(signal: number): Strength {
  if (signal >= 70) return "strong";
  if (signal >= 40) return "good";
  return "weak";
}

// nmcli's SECURITY column: "", "--", "WPA2", "WPA1 WPA2", "WPA3", "WPA2 802.1X",
// "WEP", "OWE", "OWE-TM" and combinations.
export function kindOf(security: string): Kind {
  const s = security.trim();
  if (s === "" || s === "--") return "open";
  if (/802\.1X/i.test(s)) return "enterprise";
  if (/\bWPA/i.test(s)) return "password";
  if (/\bWEP\b/i.test(s)) return "old";
  if (/\bOWE/i.test(s)) return "open";
  return "password";
}

// The key-mgmt value for a new profile. WPA3-only networks need "sae"; mixed
// WPA2/WPA3 ones work with "wpa-psk". OWE is encrypted without a password.
export function keyMgmtFor(security: string): "wpa-psk" | "sae" | "owe" | null {
  const s = security.trim();
  if (s === "" || s === "--") return null;
  if (/\bOWE/i.test(s) && !/\bWPA/i.test(s)) return "owe";
  if (/\bWPA3\b/i.test(s) && !/\bWPA[12]\b/i.test(s)) return "sae";
  return "wpa-psk";
}

export interface ScanRow {
  inUse: boolean;
  ssid: string;
  signal: number;
  security: string;
}

// Printers and TVs announce Wi-Fi Direct networks named "DIRECT-..." that no
// one joins to get online.
export const isDeviceNetwork = (ssid: string) => /^DIRECT-/.test(ssid);

// `nmcli -t -f IN-USE,SSID,SIGNAL,SECURITY device wifi list`. One row per
// access point; hidden networks have an empty SSID.
export function parseScan(out: string): ScanRow[] {
  const rows: ScanRow[] = [];
  for (const line of out.split("\n")) {
    if (!line.trim()) continue;
    const [inUse = "", ssid = "", signal = "", security = ""] = splitTerse(line);
    if (!ssid || ssid === "--") continue;
    if (isDeviceNetwork(ssid) && inUse.trim() !== "*") continue;
    rows.push({ inUse: inUse.trim() === "*", ssid, signal: Number(signal) || 0, security });
  }
  return rows;
}

// One entry per network name, strongest access point wins. The one she's on
// comes first, then ones the laptop knows, then the rest by signal.
export function mergeNetworks(rows: ScanRow[], known: KnownConnection[]): Network[] {
  const byName = new Map<string, { row: ScanRow; inUse: boolean }>();
  for (const r of rows) {
    const cur = byName.get(r.ssid);
    if (!cur) byName.set(r.ssid, { row: r, inUse: r.inUse });
    else {
      if (r.signal > cur.row.signal) cur.row = r;
      if (r.inUse) cur.inUse = true;
    }
  }
  const knownNames = new Set(known.map((k) => k.ssid));
  const activeNames = new Set(known.filter((k) => k.active).map((k) => k.ssid));
  const list: Network[] = [...byName.entries()].map(([name, { row, inUse }]) => {
    const kind = kindOf(row.security);
    return {
      name,
      signal: row.signal,
      strength: strength(row.signal),
      kind,
      secure: kind !== "open",
      known: knownNames.has(name),
      inUse: inUse || activeNames.has(name),
    };
  });
  const rank = (n: Network) => (n.inUse ? 0 : n.known ? 1 : 2);
  return list.sort((a, b) => rank(a) - rank(b) || b.signal - a.signal || a.name.localeCompare(b.name));
}

// Terse output of `nmcli -t -f connection.uuid,connection.id,802-11-wireless.ssid
// connection show uuid A uuid B ...`: "field:value" lines, one block per
// connection, each starting with connection.uuid.
export function parseConnectionFields(out: string): { uuid: string; name: string; ssid: string }[] {
  const list: { uuid: string; name: string; ssid: string }[] = [];
  let cur: { uuid: string; name: string; ssid: string } | null = null;
  for (const line of out.split("\n")) {
    const i = line.indexOf(":");
    if (i < 0) continue;
    const key = line.slice(0, i);
    const value = line.slice(i + 1);
    if (key === "connection.uuid") {
      cur = { uuid: value, name: "", ssid: "" };
      list.push(cur);
    } else if (cur && key === "connection.id") cur.name = value;
    else if (cur && key === "802-11-wireless.ssid") cur.ssid = value;
  }
  return list;
}

// What went wrong, from nmcli's error text.
export function failReason(text: string): FailReason {
  const t = text.toLowerCase();
  if (/secrets were required|no secrets|psk|4-way handshake|supplicant|authentication|password/.test(t)) return "password";
  if (/not authorized|insufficient privileges|permission denied|not allowed/.test(t)) return "not-allowed";
  if (/could not be found|no network with ssid|no suitable device|not available|ssid not found/.test(t)) return "not-found";
  if (/timeout|timed out/.test(t)) return "timeout";
  return "failed";
}

// The file nmcli reads with passwd-file. A newline would start a new entry,
// so only the first line counts.
export function passwdFile(password: string): string {
  return `802-11-wireless-security.psk:${password.split(/\r?\n/)[0]}\n`;
}

export function checkPassword(password: string): void {
  const len = [...password].length;
  if (len < 8 || len > 63) {
    throw new WifiError("short", "Network passwords are 8 to 63 characters long.");
  }
}

// ---- nmcli ------------------------------------------------------------------

type Runner = (cmd: string[], opts?: Parameters<typeof run>[1]) => Promise<RunResult>;
let runner: Runner = run;
// For tests.
export function setRunner(r: Runner | null): void {
  runner = r ?? run;
}

async function nm(args: string[], opts: Parameters<typeof run>[1] = {}): Promise<RunResult> {
  return runner(["nmcli", ...args], { timeoutMs: 10_000, ...opts });
}

async function nmOk(args: string[], opts: Parameters<typeof run>[1] = {}): Promise<string> {
  const r = await nm(args, opts);
  if (r.code !== 0) {
    const text = (r.stderr || r.stdout).trim();
    throw new WifiError(failReason(text), text.split("\n").slice(-2).join(" ") || `nmcli exited ${r.code}`);
  }
  return r.stdout;
}

export async function wifiDevice(): Promise<string | null> {
  const out = await nmOk(["-t", "-f", "DEVICE,TYPE", "device"]);
  for (const line of out.split("\n")) {
    const [dev = "", type = ""] = splitTerse(line);
    if (type === "wifi") return dev;
  }
  return null;
}

export async function knownConnections(): Promise<KnownConnection[]> {
  const out = await nmOk(["-t", "-f", "UUID,TYPE,ACTIVE", "connection", "show"]);
  const wifi = out
    .split("\n")
    .map(splitTerse)
    .filter((f) => f[1] === "802-11-wireless")
    .map((f) => ({ uuid: f[0]!, active: f[2] === "yes" }));
  if (wifi.length === 0) return [];
  const fields = await nmOk([
    "-t",
    "-f",
    "connection.uuid,connection.id,802-11-wireless.ssid",
    "connection",
    "show",
    ...wifi.flatMap((w) => ["uuid", w.uuid]),
  ]);
  const active = new Map(wifi.map((w) => [w.uuid, w.active]));
  return parseConnectionFields(fields).map((c) => ({ ...c, active: active.get(c.uuid) ?? false }));
}

async function radioOn(): Promise<boolean> {
  const r = await nm(["radio", "wifi"]);
  return r.code === 0 && r.stdout.trim() === "enabled";
}

export async function connectivity(check = false): Promise<string> {
  const r = await nm(check ? ["networking", "connectivity", "check"] : ["networking", "connectivity"], {
    timeoutMs: 20_000,
  });
  return r.code === 0 ? r.stdout.trim() : "unknown";
}

// `momctl wifi scan [--fresh]`. Turns the Wi-Fi radio on if it's off: she
// can't have meant to turn it off, and the page is useless without it.
export async function scan(opts: { fresh?: boolean } = {}): Promise<ScanResult> {
  const device = await wifiDevice();
  if (!device) {
    return { connectivity: await connectivity(), portal: false, radio: false, device: null, current: null, networks: [] };
  }
  let radio = await radioOn();
  if (!radio) {
    await nmOk(["radio", "wifi", "on"]);
    radio = true;
  }
  const [list, known, conn] = await Promise.all([
    nmOk(["-t", "-f", "IN-USE,SSID,SIGNAL,SECURITY", "device", "wifi", "list", "--rescan", opts.fresh ? "yes" : "auto"], {
      timeoutMs: 30_000,
    }),
    knownConnections(),
    connectivity(),
  ]);
  const networks = mergeNetworks(parseScan(list), known);
  const on = networks.find((n) => n.inUse);
  const activeKnown = known.find((k) => k.active);
  const current = on
    ? { name: on.name, signal: on.signal, strength: on.strength }
    : activeKnown
      ? { name: activeKnown.ssid || activeKnown.name, signal: null, strength: null }
      : null;
  return { connectivity: conn, portal: conn === "portal", radio, device, current, networks };
}

async function securityOf(name: string): Promise<string | null> {
  const out = await nmOk(["-t", "-f", "SSID,SECURITY", "device", "wifi", "list", "--rescan", "no"]);
  for (const line of out.split("\n")) {
    const [ssid = "", security = ""] = splitTerse(line);
    if (ssid === name) return security;
  }
  return null;
}

export interface ConnectResult {
  connected: boolean;
  name: string;
  already?: boolean;
  saved: boolean;
  connectivity: string;
  portal: boolean;
}

// The commands `nmcli connection edit` reads to store a password. The editor
// trims the value and has no quoting, so a password with spaces at either
// end can't go this way (see connect).
export function editScript(password: string): string {
  return `set 802-11-wireless-security.psk ${password.split(/\r?\n/)[0]}\nsave\nquit\n`;
}

// Save a password into a profile. The password goes on nmcli's stdin, as
// commands for its editor, so it never shows in a process list. The editor
// exits 0 even when saving fails, so check what it printed.
async function storePassword(uuid: string, password: string): Promise<void> {
  const r = await nm(["connection", "edit", "uuid", uuid], { stdin: editScript(password) });
  const out = `${r.stdout}\n${r.stderr}`;
  if (r.code !== 0 || /Error:/.test(out) || !/successfully updated/.test(out)) {
    const line = out.split("\n").find((l) => l.includes("Error:")) ?? `nmcli exited ${r.code}`;
    throw new WifiError(/psk: property is invalid/.test(out) ? "short" : failReason(line), line.trim());
  }
}

// `momctl wifi connect <name> [--password-stdin] [--hidden] [--save-only]`.
//
// - Already on it: nothing to do. Reconnecting would drop the link for a
//   few seconds, and with it the helper's remote access.
// - Known and no password given: bring the saved profile up.
// - Otherwise: a new profile with the password from stdin. If it works, older
//   profiles for the same name go (they had a wrong password); if it fails,
//   the new one goes, so a mistyped password is never kept.
// - --save-only: make the profile and stop, for a network that isn't in
//   range yet, like one the helper loads before she travels. It joins by
//   itself when it's in range.
export async function connect(
  name: string,
  opts: { password?: string; hidden?: boolean; saveOnly?: boolean } = {},
): Promise<ConnectResult> {
  if (!name) throw new WifiError("failed", "connect needs a network name");
  const device = await wifiDevice();
  if (!device) throw new WifiError("no-wifi", "This computer has no Wi-Fi device.");
  if (!(await radioOn())) await nmOk(["radio", "wifi", "on"]);

  const known = (await knownConnections()).filter((k) => k.ssid === name);
  const active = known.find((k) => k.active);
  if (active && opts.password === undefined) {
    const conn = await connectivity();
    return { connected: true, name, already: true, saved: true, connectivity: conn, portal: conn === "portal" };
  }

  if (known.length > 0 && opts.password === undefined && !opts.saveOnly) {
    const target = known[0]!;
    const r = await nm(["--wait", "45", "connection", "up", "uuid", target.uuid], { timeoutMs: 60_000 });
    if (r.code !== 0) {
      const text = (r.stderr || r.stdout).trim();
      throw new WifiError(failReason(text), text.split("\n").slice(-2).join(" "));
    }
    return finish(name, true);
  }

  // What kind of network it is, from the scan. A hidden network, or one
  // saved ahead of time, isn't in it: assume WPA2 if there's a password.
  let security = opts.hidden ? null : await securityOf(name);
  if (security === null) {
    if (!opts.hidden && !opts.saveOnly) throw new WifiError("not-found", `"${name}" isn't in range right now.`);
    security = opts.password ? "WPA2" : "";
  }
  const kind = kindOf(security);
  if (kind === "enterprise" || kind === "old") {
    throw new WifiError("unsupported", `"${name}" needs a kind of sign-in this page doesn't handle.`);
  }
  const keyMgmt = keyMgmtFor(security);
  const needsPassword = keyMgmt === "wpa-psk" || keyMgmt === "sae";
  const password = opts.password;
  if (needsPassword) {
    if (password === undefined) throw new WifiError("password", `"${name}" needs a password.`);
    checkPassword(password);
  }
  // The editor can't keep spaces at the ends, so such a password is handed
  // over while joining instead (passwd-file), and NetworkManager saves it
  // then. That needs a real join, not --save-only.
  const padded = needsPassword && password!.trim() !== password;
  if (padded && opts.saveOnly) {
    throw new WifiError("unsupported", "A password with spaces at the start or end can only be saved while joining.");
  }

  const add = ["connection", "add", "type", "wifi", "ifname", device, "con-name", name, "ssid", name];
  // Not until it has worked: with nothing active, NetworkManager would try it
  // at once and might mark it failed.
  add.push("connection.autoconnect", opts.saveOnly ? "yes" : "no");
  if (opts.hidden) add.push("802-11-wireless.hidden", "yes");
  if (keyMgmt) add.push("wifi-sec.key-mgmt", keyMgmt);
  const added = await nmOk(add);
  const uuid = added.match(/\(([0-9a-f-]{36})\)/i)?.[1];
  if (!uuid) throw new WifiError("failed", `nmcli didn't say which profile it added: ${added.trim()}`);
  const drop = () => nm(["connection", "delete", "uuid", uuid]).catch(() => undefined);

  if (needsPassword && !padded) {
    try {
      await storePassword(uuid, password!);
    } catch (e) {
      await drop();
      throw e;
    }
  }

  if (opts.saveOnly) {
    for (const old of known) await nm(["connection", "delete", "uuid", old.uuid]).catch(() => undefined);
    const conn = await connectivity();
    return { connected: false, name, saved: true, connectivity: conn, portal: conn === "portal" };
  }

  const up = ["--wait", "45", "connection", "up", "uuid", uuid];
  if (padded) up.push("passwd-file", "/dev/stdin");
  const r = await nm(up, { timeoutMs: 60_000, stdin: padded ? passwdFile(password!) : undefined });
  if (r.code !== 0) {
    await drop();
    const text = (r.stderr || r.stdout).trim();
    throw new WifiError(failReason(text), text.split("\n").slice(-2).join(" "));
  }
  await nm(["connection", "modify", "uuid", uuid, "connection.autoconnect", "yes"]);
  for (const old of known) await nm(["connection", "delete", "uuid", old.uuid]).catch(() => undefined);
  return finish(name, padded ? await passwordSaved(uuid) : true);
}

async function finish(name: string, saved: boolean): Promise<ConnectResult> {
  const conn = await connectivity(true);
  return { connected: true, name, saved, connectivity: conn, portal: conn === "portal" };
}

// NetworkManager keeps a password handed over while joining only if the
// caller may change system profiles. Check, so a missing polkit rule shows.
async function passwordSaved(uuid: string): Promise<boolean> {
  const r = await nm(["-s", "-g", "802-11-wireless-security.psk", "connection", "show", "uuid", uuid]);
  return r.code === 0 && r.stdout.trim() !== "";
}


// `momctl wifi forget <name> [--force]`. Refuses the network she's on unless
// --force, since that would cut her off (and the helper with her).
export async function forget(name: string, opts: { force?: boolean } = {}): Promise<{ forgotten: string; profiles: number }> {
  if (!name) throw new WifiError("failed", "forget needs a network name");
  const known = (await knownConnections()).filter((k) => k.ssid === name);
  if (known.length === 0) throw new WifiError("unknown-network", `Nothing is saved for "${name}".`);
  if (known.some((k) => k.active) && !opts.force) {
    throw new WifiError("in-use", `"${name}" is the network in use. Add --force to forget it anyway.`);
  }
  for (const k of known) await nmOk(["connection", "delete", "uuid", k.uuid]);
  return { forgotten: name, profiles: known.length };
}

// A plain http page that never redirects by itself, so a hotel or cafe's
// sign-in page can take it over.
export const PORTAL_URL = "http://neverssl.com/";

// `momctl wifi portal`: ask NetworkManager to check again and say whether a
// sign-in page is in the way.
export async function portalCheck(): Promise<{ connectivity: string; portal: boolean }> {
  const conn = await connectivity(true);
  return { connectivity: conn, portal: conn === "portal" };
}

export function internetTile(config: ConfigFile | null): Tile | null {
  const tiles = config?.tiles ?? [];
  return (
    tiles.find((t) => t.type === "app" && t.app === "chromium") ?? tiles.find((t) => t.id === "internet") ?? null
  );
}

// `momctl wifi portal open`: the sign-in page in the Browser tile's window.
// Chromium hands a URL to its running window as a new tab.
export async function portalOpen(config: ConfigFile | null): Promise<{ url: string; workspace: string }> {
  const tile = internetTile(config);
  let workspace = tileWorkspace("internet");
  if (tile && tile.type !== "page") {
    const r = await openTile(tile);
    workspace = r.workspace;
  } else {
    await hypr.focusWorkspace(workspace);
  }
  launchDetached(["chromium", PORTAL_URL]);
  return { url: PORTAL_URL, workspace };
}

// Everything after `momctl wifi`. `readStdin` supplies the password for
// --password-stdin.
export async function command(args: string[], ctx: { config: () => ConfigFile | null; readStdin: () => Promise<string> }) {
  const sub = args[0];
  const rest = args.slice(1);
  const has = (f: string) => {
    const i = rest.indexOf(f);
    if (i < 0) return false;
    rest.splice(i, 1);
    return true;
  };
  switch (sub) {
    case "scan":
      return scan({ fresh: has("--fresh") });
    case "connect": {
      const withPassword = has("--password-stdin");
      const hidden = has("--hidden");
      const saveOnly = has("--save-only");
      const name = rest.join(" ");
      if (!name) {
        throw new WifiError("failed", "usage: momctl wifi connect <name> [--password-stdin] [--hidden] [--save-only]");
      }
      const password = withPassword ? (await ctx.readStdin()).replace(/\r?\n$/, "") : undefined;
      return connect(name, { password, hidden, saveOnly });
    }
    case "forget": {
      const force = has("--force");
      const name = rest.join(" ");
      if (!name) throw new WifiError("failed", "usage: momctl wifi forget <name> [--force]");
      return forget(name, { force });
    }
    case "portal":
      if (rest[0] === "open") return portalOpen(ctx.config());
      if (rest.length > 0) throw new WifiError("failed", "usage: momctl wifi portal [open]");
      return portalCheck();
    default:
      throw new WifiError("failed", `unknown wifi command "${sub}": scan, connect, forget or portal`);
  }
}
