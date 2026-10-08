import { run, type RunResult } from "./run";

// Bluetooth speakers for `momctl speaker ...`: the shell's Speaker page and
// `mom speaker ...` both use these. They talk to BlueZ on the system bus
// (busctl for reading and simple calls, bluetoothctl where BlueZ wants a
// client that stays around: discovery and pairing) and to PipeWire (pw-dump,
// wpctl) to send the sound to the speaker.
//
// Her account needs nothing extra: BlueZ's D-Bus policy lets any local user
// call it, and PipeWire runs in her session.
//
// "Saved" means paired and trusted. Pressing a speaker's row pairs, trusts
// and connects it and makes it the sound output. `output` moves the sound
// between the computer and a connected speaker without disconnecting
// anything. Disconnect clears trusted, so neither the speaker nor momd brings
// it back by itself until she picks it again. momd reconnects a saved speaker
// once after login and once after the laptop wakes up (reconnect below),
// unless she chose the computer for the sound.

export type SpeakerKind = "speaker" | "headphones";

export interface Speaker {
  address: string;
  name: string;
  kind: SpeakerKind;
  // Paired and trusted: the laptop connects to it by itself.
  saved: boolean;
  paired: boolean;
  connected: boolean;
  // Sound is playing on it right now.
  output: boolean;
  // Seen in the last scan. Saved speakers usually aren't: a speaker only
  // answers a scan while its Bluetooth light blinks.
  nearby: boolean;
  signal: number | null;
}

export type AdapterState = "on" | "off" | "blocked" | "none";

export interface Output {
  name: string;
  bluetooth: boolean;
  address: string | null;
}

export interface SpeakerStatus {
  adapter: AdapterState;
  output: Output | null;
  speakers: Speaker[];
}

// Why a command failed, for the shell to put in plain words.
export type SpeakerFailReason =
  | "no-bluetooth" // no adapter at all
  | "off" // the adapter is off and couldn't be turned on (rfkill)
  | "not-found" // not in range, or not in pairing mode
  | "pair" // pairing was refused or failed
  | "connect" // paired, but it wouldn't connect: off, or busy with a phone
  | "no-sound" // connected, but PipeWire has no output for it
  | "unknown-speaker" // forget or disconnect: nothing by that address
  | "timeout"
  | "failed";

export class SpeakerError extends Error {
  constructor(
    readonly reason: SpeakerFailReason,
    message: string,
  ) {
    super(message);
  }
}

// ---- pure helpers (tested) --------------------------------------------------

const ADDRESS = /^[0-9A-F]{2}(:[0-9A-F]{2}){5}$/;

export function normalizeAddress(s: string): string | null {
  const a = s.trim().toUpperCase().replace(/[-_]/g, ":");
  return ADDRESS.test(a) ? a : null;
}

export function devicePath(adapter: string, address: string): string {
  return `${adapter}/dev_${address.replace(/:/g, "_")}`;
}

// A2DP audio sink: the device plays sound.
const AUDIO_SINK_UUID = "0000110b-0000-1000-8000-00805f9b34fb";

// busctl's JSON for a{oa{sa{sv}}}: every value is { type, data }.
type Variant = { type: string; data: unknown };
type Props = Record<string, Variant>;
type Objects = Record<string, Record<string, Props>>;

export interface BtDevice {
  path: string;
  adapter: string;
  address: string;
  name: string | null;
  icon: string;
  cls: number | null;
  uuids: string[];
  paired: boolean;
  // Paired with a stored key. A pairing without one lasts only until the
  // connection drops (see withBonding).
  bonded: boolean;
  trusted: boolean;
  connected: boolean;
  rssi: number | null;
}

export interface BtAdapter {
  path: string;
  powered: boolean;
  powerState: string;
  pairable: boolean;
}

const val = <T>(p: Props | undefined, key: string): T | undefined => p?.[key]?.data as T | undefined;

// `busctl --json=short call org.bluez / org.freedesktop.DBus.ObjectManager
// GetManagedObjects`: { type, data: [ objects ] }.
export function parseObjects(json: string): { adapters: BtAdapter[]; devices: BtDevice[] } {
  const parsed = JSON.parse(json) as { data?: unknown[] };
  const objects = (parsed.data?.[0] ?? {}) as Objects;
  const adapters: BtAdapter[] = [];
  const devices: BtDevice[] = [];
  for (const [path, ifaces] of Object.entries(objects)) {
    const a = ifaces["org.bluez.Adapter1"];
    if (a) {
      adapters.push({
        path,
        powered: val<boolean>(a, "Powered") === true,
        powerState: val<string>(a, "PowerState") ?? (val<boolean>(a, "Powered") ? "on" : "off"),
        pairable: val<boolean>(a, "Pairable") === true,
      });
    }
    const d = ifaces["org.bluez.Device1"];
    if (d) {
      const address = val<string>(d, "Address") ?? "";
      const paired = val<boolean>(d, "Paired") === true;
      devices.push({
        path,
        adapter: val<string>(d, "Adapter") ?? path.replace(/\/dev_[^/]+$/, ""),
        address,
        // Name is the one the device announces. Alias falls back to the
        // address when there's none, which means nothing to her.
        name: val<string>(d, "Name") ?? null,
        icon: val<string>(d, "Icon") ?? "",
        cls: val<number>(d, "Class") ?? null,
        uuids: (val<string[]>(d, "UUIDs") ?? []).map((u) => u.toLowerCase()),
        paired,
        // BlueZ before 5.73 has no Bonded; there, paired meant bonded.
        bonded: val<boolean>(d, "Bonded") ?? paired,
        trusted: val<boolean>(d, "Trusted") === true,
        connected: val<boolean>(d, "Connected") === true,
        rssi: val<number>(d, "RSSI") ?? null,
      });
    }
  }
  adapters.sort((x, y) => x.path.localeCompare(y.path));
  return { adapters, devices };
}

// Something that plays sound: BlueZ's icon from the device class
// ("audio-card" for speakers, "audio-headset", "audio-headphones"), the
// Audio/Video major class, or an audio sink profile.
export function isAudio(d: Pick<BtDevice, "icon" | "cls" | "uuids">): boolean {
  if (d.icon.startsWith("audio-") && d.icon !== "audio-input-microphone") return true;
  if (d.cls !== null && ((d.cls >> 8) & 0x1f) === 0x04) {
    const minor = (d.cls >> 2) & 0x3f;
    // Microphones and video gear aren't somewhere to send sound.
    return minor !== 0x04 && minor < 0x0b;
  }
  return d.uuids.includes(AUDIO_SINK_UUID);
}

export function kindOf(d: Pick<BtDevice, "icon" | "cls">): SpeakerKind {
  if (d.icon === "audio-headset" || d.icon === "audio-headphones") return "headphones";
  if (d.cls !== null && ((d.cls >> 8) & 0x1f) === 0x04) {
    const minor = (d.cls >> 2) & 0x3f;
    if (minor === 0x01 || minor === 0x02 || minor === 0x06) return "headphones";
  }
  return "speaker";
}

// The list she sees: audio devices with a real name. Saved ones first, the
// connected one at the top, then nearby ones by signal.
export function speakerList(devices: BtDevice[], output: Output | null): Speaker[] {
  const list = devices
    .filter((d) => d.name && d.name.trim() !== "" && isAudio(d))
    .map<Speaker>((d) => ({
      address: d.address,
      name: d.name!.trim(),
      kind: kindOf(d),
      saved: d.bonded && d.trusted,
      paired: d.bonded,
      connected: d.connected,
      output: output !== null && output.bluetooth && output.address === d.address,
      nearby: d.rssi !== null,
      signal: d.rssi,
    }));
  const seen = new Set<string>();
  const unique = list.filter((s) => (seen.has(s.address) ? false : (seen.add(s.address), true)));
  const rank = (s: Speaker) => (s.connected ? 0 : s.saved ? 1 : s.paired ? 2 : 3);
  return unique.sort(
    (a, b) => rank(a) - rank(b) || (b.signal ?? -999) - (a.signal ?? -999) || a.name.localeCompare(b.name),
  );
}

export function adapterState(adapters: BtAdapter[]): AdapterState {
  const a = adapters[0];
  if (!a) return "none";
  if (a.powered) return "on";
  return a.powerState === "off-blocked" ? "blocked" : "off";
}

// What went wrong, from BlueZ's error text.
export function failReason(text: string, during: "pair" | "connect"): SpeakerFailReason {
  const t = text.toLowerCase();
  if (/not available|doesnotexist|does not exist|unknownobject|no such object|not found/.test(t)) return "not-found";
  if (/timeout|timed out|page-timeout|noreply/.test(t)) return during === "pair" ? "not-found" : "connect";
  if (/notready|not ready|rfkill|blocked/.test(t)) return "off";
  if (/authentication|rejected|canceled|cancelled|authenticationfailed|authenticationrejected/.test(t)) return "pair";
  return during;
}

// pw-dump's JSON, cut down to what the speaker commands need.
interface PwSink {
  id: number;
  name: string;
  description: string;
  bluetooth: boolean;
  address: string | null;
}

interface PwProfile {
  index: number;
  name: string;
  available: boolean;
}

interface PwBtDevice {
  id: number;
  address: string;
  profile: string | null;
  profiles: PwProfile[];
}

export interface PwState {
  sinks: PwSink[];
  btDevices: PwBtDevice[];
  // default.audio.sink: where the sound goes now.
  defaultName: string | null;
  // default.configured.audio.sink: the last choice made with set-default.
  // WirePlumber goes back to it whenever that sink is there.
  configuredName: string | null;
}

type PwObject = {
  id: number;
  type: string;
  props?: Record<string, unknown>;
  info?: { props?: Record<string, unknown>; params?: Record<string, Record<string, unknown>[]> };
  metadata?: { subject?: number; key: string; value: unknown }[];
};

const upperAddress = (v: unknown) => (typeof v === "string" && v !== "" ? v.toUpperCase() : null);

export function parseDump(json: string): PwState {
  const objs = JSON.parse(json) as PwObject[];
  let defaultName: string | null = null;
  let configuredName: string | null = null;
  const sinks: PwSink[] = [];
  const btDevices: PwBtDevice[] = [];
  for (const o of objs) {
    if (o.type === "PipeWire:Interface:Metadata" && o.props?.["metadata.name"] === "default") {
      for (const m of o.metadata ?? []) {
        const v = typeof m.value === "string" ? safeJson(m.value) : m.value;
        const name = (v as { name?: unknown } | null)?.name;
        if (typeof name !== "string") continue;
        if (m.key === "default.audio.sink") defaultName = name;
        if (m.key === "default.configured.audio.sink") configuredName = name;
      }
      continue;
    }
    const p = o.info?.props;
    if (!p) continue;
    if (o.type === "PipeWire:Interface:Node" && p["media.class"] === "Audio/Sink") {
      const address = upperAddress(p["api.bluez5.address"]);
      sinks.push({
        id: o.id,
        name: String(p["node.name"] ?? ""),
        description: String(p["node.description"] ?? p["node.nick"] ?? p["node.name"] ?? ""),
        bluetooth: p["device.api"] === "bluez5" || address !== null,
        address,
      });
    }
    if (o.type === "PipeWire:Interface:Device" && p["device.api"] === "bluez5") {
      const address = upperAddress(p["api.bluez5.address"]);
      if (!address) continue;
      const params = o.info?.params ?? {};
      const profiles = (params.EnumProfile ?? []).map((e) => ({
        index: Number(e.index),
        name: String(e.name ?? ""),
        available: e.available !== "no",
      }));
      const current = params.Profile?.[0]?.name;
      btDevices.push({ id: o.id, address, profile: typeof current === "string" ? current : null, profiles });
    }
  }
  return { sinks, btDevices, defaultName, configuredName };
}

// Where the sound goes: the default sink, or the first sink when there's no
// default yet.
export function outputFromDump(json: string): Output | null {
  const pw = parseDump(json);
  const sink = pw.sinks.find((s) => s.name === pw.defaultName) ?? (pw.defaultName === null ? pw.sinks[0] : undefined);
  return sink ? { name: sink.description, bluetooth: sink.bluetooth, address: sink.address } : null;
}

// The PipeWire node id of a Bluetooth speaker's sink, or null.
export function sinkIdFor(json: string, address: string): number | null {
  return parseDump(json).sinks.find((s) => s.address === address)?.id ?? null;
}

// The laptop's own speakers: the first sink that isn't Bluetooth.
export function computerSinkId(json: string): number | null {
  return parseDump(json).sinks.find((s) => !s.bluetooth)?.id ?? null;
}

// She picked the computer for the sound: the last set-default went to a sink
// that isn't Bluetooth. Nothing chosen yet doesn't count.
export function choseComputer(json: string): boolean {
  const pw = parseDump(json);
  return pw.configuredName !== null && !pw.configuredName.startsWith("bluez_output.");
}

// A speaker PipeWire knows but left without a sink, because its profile is
// off or hands-free: the profile to switch it to, `a2dp-sink` if it's there,
// else another A2DP one. Null when it has a sink already or no A2DP profile.
export function a2dpProfileFor(json: string, address: string): { deviceId: number; index: number } | null {
  const pw = parseDump(json);
  if (pw.sinks.some((s) => s.address === address)) return null;
  const dev = pw.btDevices.find((d) => d.address === address);
  if (!dev || (dev.profile ?? "").startsWith("a2dp-sink")) return null;
  const a2dp = dev.profiles.filter((p) => p.available && p.name.startsWith("a2dp-sink"));
  const pick = a2dp.find((p) => p.name === "a2dp-sink") ?? a2dp[0];
  return pick ? { deviceId: dev.id, index: pick.index } : null;
}

function safeJson(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

// bluetoothctl colors its output even without a terminal.
export const stripAnsi = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "").replace(/\r/g, "");

// ---- BlueZ and PipeWire ------------------------------------------------------

type Runner = (cmd: string[], opts?: Parameters<typeof run>[1]) => Promise<RunResult>;
let runner: Runner = run;
let sleep: (ms: number) => Promise<unknown> = (ms) => Bun.sleep(ms);
// For tests.
export function setRunner(r: Runner | null, s?: (ms: number) => Promise<unknown>): void {
  runner = r ?? run;
  sleep = s ?? ((ms) => Bun.sleep(ms));
}

async function objects(): Promise<{ adapters: BtAdapter[]; devices: BtDevice[] }> {
  const r = await runner(["busctl", "--json=short", "call", "org.bluez", "/", "org.freedesktop.DBus.ObjectManager", "GetManagedObjects"], {
    timeoutMs: 10_000,
  });
  if (r.code !== 0) {
    // bluetoothd isn't running: as good as no adapter.
    if (/org\.bluez|not found|ServiceUnknown|was not provided/i.test(r.stderr)) return { adapters: [], devices: [] };
    throw new SpeakerError("failed", r.stderr.trim() || `busctl exited ${r.code}`);
  }
  return parseObjects(r.stdout);
}

async function currentOutput(): Promise<Output | null> {
  try {
    const r = await runner(["pw-dump"], { timeoutMs: 10_000 });
    return r.code === 0 ? outputFromDump(r.stdout) : null;
  } catch {
    return null;
  }
}

async function busctl(args: string[], timeoutMs = 10_000): Promise<RunResult> {
  return runner(["busctl", ...args], { timeoutMs: timeoutMs + 5000 });
}

// Turn the adapter on if it's off. Returns its path.
async function readyAdapter(): Promise<string> {
  const { adapters } = await objects();
  const a = adapters[0];
  if (!a) throw new SpeakerError("no-bluetooth", "This computer has no Bluetooth.");
  if (a.powered) return a.path;
  if (a.powerState === "off-blocked") throw new SpeakerError("off", "Bluetooth is switched off (rfkill).");
  const r = await busctl(["set-property", "org.bluez", a.path, "org.bluez.Adapter1", "Powered", "b", "true"]);
  if (r.code !== 0) throw new SpeakerError("off", r.stderr.trim() || "Bluetooth wouldn't turn on.");
  await sleep(1000);
  return a.path;
}

// Look for devices for `seconds`. bluetoothctl holds discovery while it runs;
// BlueZ stops it when the client goes away. RSSI is only there during
// discovery, so the objects are read just before it ends.
async function discover(seconds: number): Promise<{ adapters: BtAdapter[]; devices: BtDevice[] }> {
  const scan = runner(["bluetoothctl", "--timeout", String(seconds), "scan", "on"], { timeoutMs: (seconds + 10) * 1000 });
  await sleep(Math.max(1, seconds - 1) * 1000);
  const found = await objects();
  await scan.catch(() => undefined);
  return found;
}

export async function status(): Promise<SpeakerStatus> {
  const [{ adapters, devices }, output] = await Promise.all([objects(), currentOutput()]);
  return {
    adapter: adapterState(adapters),
    output,
    speakers: speakerList(devices, output).filter((s) => s.paired),
  };
}

export const SCAN_SECONDS = 10;

// `momctl speaker scan [--seconds N]`. Turns Bluetooth on if it's off.
export async function scan(opts: { seconds?: number } = {}): Promise<SpeakerStatus> {
  await readyAdapter();
  const seconds = Math.min(30, Math.max(3, Math.round(opts.seconds ?? SCAN_SECONDS)));
  const { adapters, devices } = await discover(seconds);
  const output = await currentOutput();
  return { adapter: adapterState(adapters), output, speakers: speakerList(devices, output) };
}

export interface ConnectResult {
  address: string;
  name: string;
  connected: true;
  // Paired just now, rather than before.
  paired: boolean;
  // The sound now goes to it.
  output: boolean;
  // When output is false: what PipeWire had for it, for the helper.
  detail?: string;
}

async function setTrusted(path: string, on: boolean): Promise<void> {
  await busctl(["set-property", "org.bluez", path, "org.bluez.Device1", "Trusted", "b", on ? "true" : "false"]);
}

async function pwDump(): Promise<string | null> {
  const r = await runner(["pw-dump"], { timeoutMs: 10_000 }).catch(() => null);
  return r && r.code === 0 ? r.stdout : null;
}

// How long a speaker's sink may take to show up in PipeWire after the
// connection. Usually a second; some speakers take several.
export const SINK_WAIT_MS = 20_000;
const SINK_POLL_MS = 500;

// Send the sound to the speaker: wait for its sink, switching the speaker to
// its A2DP profile if PipeWire left it off or hands-free, then make the sink
// the default. WirePlumber remembers the choice by the sink's name, so the
// next time the speaker connects the sound goes there again, and back to the
// laptop's own speakers while it's away.
async function makeOutput(address: string, waitMs = SINK_WAIT_MS): Promise<boolean> {
  let profileSet = false;
  for (let waited = 0; ; waited += SINK_POLL_MS) {
    const dump = await pwDump();
    const id = dump ? sinkIdFor(dump, address) : null;
    if (id !== null) {
      const set = await runner(["wpctl", "set-default", String(id)], { timeoutMs: 5000 });
      return set.code === 0;
    }
    const profile = dump && !profileSet ? a2dpProfileFor(dump, address) : null;
    if (profile) {
      profileSet = true;
      await runner(["wpctl", "set-profile", String(profile.deviceId), String(profile.index)], { timeoutMs: 5000 });
    }
    if (waited >= waitMs) return false;
    await sleep(SINK_POLL_MS);
  }
}

// Pair with a stored key. BlueZ keeps the adapter non-bondable unless
// something sets Pairable (AlwaysPairable is off by default), and a pairing
// then asks for "no bonding": it works, but BlueZ throws the key away as soon
// as the connection drops, so the speaker is unpaired again a second later.
// Pairable goes back off afterwards, since nothing else should pair with her
// laptop.
async function pairBonded(adapter: BtAdapter, address: string): Promise<void> {
  const setPairable = (on: boolean) =>
    busctl(["set-property", "org.bluez", adapter.path, "org.bluez.Adapter1", "Pairable", "b", on ? "true" : "false"]);
  if (!adapter.pairable) await setPairable(true);
  try {
    // bluetoothctl registers an agent for the pairing. NoInputNoOutput is
    // what a speaker has anyway, and means nothing asks her for a code.
    const r = await runner(["bluetoothctl", "--agent", "NoInputNoOutput", "pair", address], { timeoutMs: 60_000 });
    const out = stripAnsi(`${r.stdout}\n${r.stderr}`);
    if (!/Pairing successful|AlreadyExists/i.test(out)) {
      const line = out.split("\n").find((l) => /Failed|Error|not available/i.test(l)) ?? `bluetoothctl exited ${r.code}`;
      throw new SpeakerError(failReason(line, "pair"), line.trim());
    }
  } finally {
    if (!adapter.pairable) await setPairable(false);
  }
}

async function firstAdapter(): Promise<BtAdapter> {
  const { adapters } = await objects();
  const a = adapters[0];
  if (!a) throw new SpeakerError("no-bluetooth", "This computer has no Bluetooth.");
  return a;
}

// Device1.Connect brings up the speaker's sound profiles. It has to be
// called even when BlueZ already says Connected: right after pairing that
// is only the pairing's own link, with no sound on it, and it drops a second
// later.
async function connectProfiles(path: string, address: string, timeoutS: number): Promise<RunResult> {
  const r = await busctl([`--timeout=${timeoutS}`, "call", "org.bluez", path, "org.bluez.Device1", "Connect"], timeoutS * 1000);
  if (r.code !== 0 && /AlreadyConnected/i.test(r.stderr)) return { ...r, code: 0 };
  if (r.code !== 0 && (await isConnected(address))) return { ...r, code: 0 };
  return r;
}

// `momctl speaker connect <address>`: find it (it has to be in pairing mode
// the first time), pair, trust, connect and make it the sound output.
export async function connect(addressArg: string): Promise<ConnectResult> {
  const address = normalizeAddress(addressArg);
  if (!address) throw new SpeakerError("failed", `"${addressArg}" isn't a Bluetooth address like 00:11:22:33:44:55`);
  const adapterPath = await readyAdapter();

  let { devices } = await objects();
  let dev = devices.find((d) => d.address === address);
  // A speaker seen in a scan is forgotten by BlueZ half a minute after the
  // scan ends. Look again.
  if (!dev) {
    const found = await discover(SCAN_SECONDS);
    dev = found.devices.find((d) => d.address === address);
  }
  if (!dev) throw new SpeakerError("not-found", "The speaker isn't answering. Is it on, with its Bluetooth light blinking?");
  const path = dev.path || devicePath(adapterPath, address);
  const name = dev.name ?? address;

  let pairedNow = false;
  if (!dev.bonded) {
    // Paired without a key (an older MomOS did that): drop that link first,
    // which ends the pairing, so the new one stores a key.
    if (dev.paired && dev.connected) {
      await busctl(["--timeout=20", "call", "org.bluez", path, "org.bluez.Device1", "Disconnect"], 20_000);
      await sleep(1000);
    }
    await pairBonded(await firstAdapter(), address);
    pairedNow = true;
  }
  await setTrusted(path, true);

  const r = await connectProfiles(path, address, 40);
  if (r.code !== 0) {
    const text = r.stderr.trim() || `busctl exited ${r.code}`;
    throw new SpeakerError(failReason(text, "connect"), text);
  }
  const output = await makeOutput(address);
  const result: ConnectResult = { address, name, connected: true, paired: pairedNow, output };
  if (!output) result.detail = await noSoundDetail(address);
  return result;
}

// For the helper, when the sound didn't move: what PipeWire had for the
// speaker. Shows up in `mom speaker connect` and the shell's log.
export function soundDetail(json: string, address: string): string {
  const pw = parseDump(json);
  const card = pw.btDevices.find((d) => d.address === address);
  const sinks = pw.sinks.map((s) => s.name).join(", ") || "none";
  if (!card) return `PipeWire has no Bluetooth card for ${address}. Sinks: ${sinks}.`;
  const profiles = card.profiles.map((p) => p.name + (p.available ? "" : " (unavailable)")).join(", ");
  return `Card ${card.id} is on profile ${card.profile ?? "unknown"} (has ${profiles || "no profiles"}). Sinks: ${sinks}.`;
}

async function noSoundDetail(address: string): Promise<string> {
  const dump = await pwDump();
  return dump ? soundDetail(dump, address) : "pw-dump failed.";
}

async function isConnected(address: string): Promise<boolean> {
  const { devices } = await objects();
  return devices.find((d) => d.address === address)?.connected === true;
}

async function known(addressArg: string): Promise<BtDevice> {
  const address = normalizeAddress(addressArg);
  if (!address) throw new SpeakerError("failed", `"${addressArg}" isn't a Bluetooth address like 00:11:22:33:44:55`);
  const { devices } = await objects();
  const dev = devices.find((d) => d.address === address && d.paired);
  if (!dev) throw new SpeakerError("unknown-speaker", `No speaker ${address} is saved.`);
  return dev;
}

// `momctl speaker output computer|<address>`: where the sound comes out.
// Nothing connects or disconnects for "computer": a connected speaker stays
// connected, so switching back is quick. A speaker that isn't connected is
// connected first, the same as `connect`. WirePlumber remembers the choice,
// and momd's reconnect leaves the speaker alone while the computer is chosen.
export async function output(target: string): Promise<SpeakerStatus> {
  if (target === "computer") {
    const dump = await pwDump();
    const id = dump ? computerSinkId(dump) : null;
    if (id === null) throw new SpeakerError("failed", "PipeWire has no output for the computer's own speakers.");
    const set = await runner(["wpctl", "set-default", String(id)], { timeoutMs: 5000 });
    if (set.code !== 0) throw new SpeakerError("failed", set.stderr.trim() || `wpctl exited ${set.code}`);
    return status();
  }
  const address = normalizeAddress(target);
  if (!address) throw new SpeakerError("failed", `"${target}" isn't "computer" or a Bluetooth address like 00:11:22:33:44:55`);
  const { devices } = await objects();
  const dev = devices.find((d) => d.address === address);
  if (!dev || !dev.connected || !dev.bonded) {
    const r = await connect(address);
    if (!r.output) throw new SpeakerError("no-sound", `${r.name} is connected, but PipeWire has no output for it. ${r.detail ?? ""}`);
    return status();
  }
  // Connected, but maybe only its hands-free side: make sure the sound
  // profiles are up before looking for its sink.
  if ((await pwDump().then((d) => (d ? sinkIdFor(d, address) : null))) === null) {
    await connectProfiles(dev.path, address, 20);
  }
  if (!(await makeOutput(address))) {
    throw new SpeakerError("no-sound", `${dev.name ?? address} is connected, but PipeWire has no output for it. ${await noSoundDetail(address)}`);
  }
  return status();
}

// `momctl speaker disconnect <address>`: the Disconnect button, which lets a
// phone have the speaker. It stays paired but not trusted, so it doesn't come
// back by itself; picking it again trusts it again. The sound goes back to
// the laptop as soon as the speaker's sink goes away.
export async function disconnect(addressArg: string): Promise<{ address: string; disconnected: true }> {
  const dev = await known(addressArg);
  await setTrusted(dev.path, false);
  if (dev.connected) {
    const r = await busctl(["--timeout=20", "call", "org.bluez", dev.path, "org.bluez.Device1", "Disconnect"], 20_000);
    if (r.code !== 0) throw new SpeakerError("failed", r.stderr.trim() || `busctl exited ${r.code}`);
  }
  return { address: dev.address, disconnected: true };
}

// `momctl speaker forget <address>`: unpair. Next time it needs pairing mode.
export async function forget(addressArg: string): Promise<{ address: string; forgotten: true }> {
  const dev = await known(addressArg);
  const r = await busctl(["call", "org.bluez", dev.adapter, "org.bluez.Adapter1", "RemoveDevice", "o", dev.path]);
  if (r.code !== 0) throw new SpeakerError("failed", r.stderr.trim() || `busctl exited ${r.code}`);
  return { address: dev.address, forgotten: true };
}

export interface ReconnectResult {
  tried: string[];
  connected: string | null;
  // Why nothing was tried, when a saved speaker is off: she chose the
  // computer for the sound.
  skipped?: "computer";
}

// `momctl speaker reconnect`: connect a saved speaker that isn't connected,
// once, and send the sound to it. Does nothing when one is already connected,
// none is saved, or she chose the computer for the sound (then a speaker that
// connects by itself still can, and she switches on the Speaker page). momd
// runs this after login and after the laptop wakes.
export async function reconnect(): Promise<ReconnectResult> {
  const { adapters, devices } = await objects();
  if (adapterState(adapters) !== "on") return { tried: [], connected: null };
  const saved = speakerList(devices, null).filter((s) => s.saved);
  const on = saved.find((s) => s.connected);
  if (on || saved.length === 0) return { tried: [], connected: on ? on.address : null };
  const dump = await pwDump();
  if (dump && choseComputer(dump)) return { tried: [], connected: null, skipped: "computer" };
  const tried: string[] = [];
  for (const s of saved) {
    tried.push(s.address);
    const dev = devices.find((d) => d.address === s.address)!;
    const r = await connectProfiles(dev.path, s.address, 20);
    if (r.code === 0) {
      await makeOutput(s.address);
      return { tried, connected: s.address };
    }
  }
  return { tried, connected: null };
}

// Everything after `momctl speaker`.
export async function command(args: string[]) {
  const sub = args[0];
  const rest = args.slice(1);
  switch (sub) {
    case undefined:
      return status();
    case "scan": {
      const i = rest.indexOf("--seconds");
      const seconds = i >= 0 ? Number(rest[i + 1]) : undefined;
      if (seconds !== undefined && !Number.isFinite(seconds)) throw new SpeakerError("failed", "--seconds must be a number");
      return scan({ seconds });
    }
    case "connect":
    case "disconnect":
    case "forget": {
      const address = rest[0];
      if (!address) throw new SpeakerError("failed", `usage: momctl speaker ${sub} <address>`);
      return sub === "connect" ? connect(address) : sub === "disconnect" ? disconnect(address) : forget(address);
    }
    case "output": {
      const target = rest[0];
      if (!target) throw new SpeakerError("failed", "usage: momctl speaker output computer|<address>");
      return output(target);
    }
    case "reconnect":
      return reconnect();
    default:
      throw new SpeakerError("failed", `unknown speaker command "${sub}": scan, connect, output, disconnect, forget or reconnect`);
  }
}
