import { afterEach, describe, expect, test } from "bun:test";
import type { RunResult } from "../src/lib/run";
import {
  a2dpProfileFor,
  adapterState,
  choseComputer,
  computerSinkId,
  connect,
  disconnect,
  failReason,
  isAudio,
  kindOf,
  normalizeAddress,
  output,
  outputFromDump,
  parseObjects,
  reconnect,
  setRunner,
  sinkIdFor,
  SpeakerError,
  speakerList,
  stripAnsi,
} from "../src/lib/speaker";

const SINK_UUID = "0000110b-0000-1000-8000-00805f9b34fb";
const HCI = "/org/bluez/hci0";
const pathOf = (a: string) => `${HCI}/dev_${a.replace(/:/g, "_")}`;

interface Dev {
  address: string;
  name?: string;
  icon?: string;
  cls?: number;
  uuids?: string[];
  paired?: boolean;
  // Defaults to paired, as BlueZ does for a pairing with a stored key.
  bonded?: boolean;
  trusted?: boolean;
  connected?: boolean;
  rssi?: number;
}

// What `busctl --json=short call ... GetManagedObjects` prints.
function objectsJson(devs: Dev[], adapter: { powered?: boolean; powerState?: string; pairable?: boolean } = {}): string {
  const v = (type: string, data: unknown) => ({ type, data });
  const objs: Record<string, unknown> = {
    "/org/bluez": { "org.bluez.AgentManager1": {} },
    [HCI]: {
      "org.bluez.Adapter1": {
        Address: v("s", "5C:F9:38:00:00:01"),
        Powered: v("b", adapter.powered ?? true),
        PowerState: v("s", adapter.powerState ?? (adapter.powered === false ? "off" : "on")),
        Pairable: v("b", adapter.pairable ?? false),
      },
    },
  };
  for (const d of devs) {
    const p: Record<string, unknown> = {
      Address: v("s", d.address),
      Alias: v("s", d.name ?? d.address.replace(/:/g, "-")),
      Paired: v("b", d.paired ?? false),
      Bonded: v("b", d.bonded ?? d.paired ?? false),
      Trusted: v("b", d.trusted ?? false),
      Connected: v("b", d.connected ?? false),
      UUIDs: v("as", d.uuids ?? []),
      Adapter: v("o", HCI),
    };
    if (d.name) p.Name = v("s", d.name);
    if (d.icon) p.Icon = v("s", d.icon);
    if (d.cls !== undefined) p.Class = v("u", d.cls);
    if (d.rssi !== undefined) p.RSSI = v("n", d.rssi);
    objs[pathOf(d.address)] = { "org.bluez.Device1": p };
  }
  return JSON.stringify({ type: "a{oa{sa{sv}}}", data: [objs] });
}

interface Sink {
  id: number;
  name: string;
  description: string;
  address?: string;
}

// A Bluetooth card in PipeWire, with the profiles the JBL on her laptop has.
interface Card {
  id: number;
  address: string;
  profile: string;
}

const PROFILES = [
  { index: 0, name: "off", available: "yes" },
  { index: 131073, name: "a2dp-sink-sbc", available: "yes" },
  { index: 131076, name: "a2dp-sink", available: "yes" },
  { index: 196865, name: "headset-head-unit", available: "yes" },
];

// What `pw-dump` prints, cut down to what matters.
function dumpJson(sinks: Sink[], defaultSink: string | null, opts: { configured?: string | null; cards?: Card[] } = {}): string {
  const objs: unknown[] = sinks.map((s) => ({
    id: s.id,
    type: "PipeWire:Interface:Node",
    info: {
      props: {
        "media.class": "Audio/Sink",
        "node.name": s.name,
        "node.description": s.description,
        ...(s.address ? { "api.bluez5.address": s.address, "device.api": "bluez5" } : { "device.api": "alsa" }),
      },
    },
  }));
  for (const c of opts.cards ?? []) {
    objs.push({
      id: c.id,
      type: "PipeWire:Interface:Device",
      info: {
        props: { "device.api": "bluez5", "api.bluez5.address": c.address, "media.class": "Audio/Device" },
        params: {
          EnumProfile: PROFILES,
          Profile: [PROFILES.find((p) => p.name === c.profile)],
        },
      },
    });
  }
  const metadata: unknown[] = [];
  if (defaultSink) metadata.push({ subject: 0, key: "default.audio.sink", type: "Spa:String:JSON", value: { name: defaultSink } });
  if (opts.configured)
    metadata.push({ subject: 0, key: "default.configured.audio.sink", type: "Spa:String:JSON", value: JSON.stringify({ name: opts.configured }) });
  objs.push({ id: 40, type: "PipeWire:Interface:Metadata", props: { "metadata.name": "default" }, metadata });
  return JSON.stringify(objs);
}

const KITCHEN = "11:22:33:44:55:66";
const BUDS = "AA:BB:CC:DD:EE:01";
const PHONE = "AA:BB:CC:DD:EE:02";
const BUILT_IN = { id: 61, name: "alsa_output.pci-0000_00_1b.0.analog-stereo", description: "Built-in Audio Analog Stereo" };
const KITCHEN_SINK = { id: 88, name: "bluez_output.11_22_33_44_55_66.1", description: "Kitchen Speaker", address: KITCHEN };

describe("parsing BlueZ and PipeWire", () => {
  test("addresses", () => {
    expect(normalizeAddress("11-22-33-44-55-66")).toBe(KITCHEN);
    expect(normalizeAddress(" aa:bb:cc:dd:ee:01 ")).toBe(BUDS);
    expect(normalizeAddress("11:22:33")).toBeNull();
    expect(normalizeAddress("rm -rf /")).toBeNull();
  });

  test("devices and the adapter", () => {
    const { adapters, devices } = parseObjects(
      objectsJson([{ address: KITCHEN, name: "Kitchen Speaker", icon: "audio-card", cls: 0x240414, paired: true, trusted: true, rssi: -50 }]),
    );
    expect(adapterState(adapters)).toBe("on");
    expect(devices).toEqual([
      {
        path: pathOf(KITCHEN),
        adapter: HCI,
        address: KITCHEN,
        name: "Kitchen Speaker",
        icon: "audio-card",
        cls: 0x240414,
        uuids: [],
        paired: true,
        bonded: true,
        trusted: true,
        connected: false,
        rssi: -50,
      },
    ]);
    expect(adapterState(parseObjects(objectsJson([], { powered: false, powerState: "off-blocked" })).adapters)).toBe("blocked");
    expect(adapterState(parseObjects(objectsJson([], { powered: false })).adapters)).toBe("off");
    expect(adapterState([])).toBe("none");
  });

  test("what counts as a speaker", () => {
    expect(isAudio({ icon: "audio-card", cls: null, uuids: [] })).toBe(true);
    expect(isAudio({ icon: "", cls: 0x240414, uuids: [] })).toBe(true); // loudspeaker
    expect(isAudio({ icon: "", cls: 0x240404, uuids: [] })).toBe(true); // headset
    expect(isAudio({ icon: "", cls: 0x240410, uuids: [] })).toBe(false); // microphone
    expect(isAudio({ icon: "", cls: 0x5a020c, uuids: [] })).toBe(false); // phone
    expect(isAudio({ icon: "", cls: null, uuids: [SINK_UUID] })).toBe(true);
    expect(isAudio({ icon: "phone", cls: null, uuids: [] })).toBe(false);
    expect(kindOf({ icon: "audio-headset", cls: null })).toBe("headphones");
    expect(kindOf({ icon: "", cls: 0x240418 })).toBe("headphones");
    expect(kindOf({ icon: "audio-card", cls: 0x240414 })).toBe("speaker");
  });

  test("the list: named audio devices, connected, then saved, then nearby by signal", () => {
    const { devices } = parseObjects(
      objectsJson([
        { address: PHONE, name: "Carol's iPhone", icon: "phone", cls: 0x5a020c, rssi: -40 },
        { address: "AA:BB:CC:DD:EE:03", icon: "audio-card", rssi: -30 }, // no name
        { address: "AA:BB:CC:DD:EE:04", name: "Soundbar", icon: "audio-card", rssi: -80 },
        { address: BUDS, name: "Pixel Buds", icon: "audio-headset", rssi: -60 },
        { address: "AA:BB:CC:DD:EE:05", name: "Old Speaker", icon: "audio-card", paired: true, trusted: true },
        { address: KITCHEN, name: "Kitchen Speaker", icon: "audio-card", paired: true, trusted: true, connected: true },
      ]),
    );
    const output = outputFromDump(dumpJson([BUILT_IN, KITCHEN_SINK], KITCHEN_SINK.name));
    const list = speakerList(devices, output);
    expect(list.map((s) => [s.name, s.kind, s.saved, s.connected, s.output, s.nearby])).toEqual([
      ["Kitchen Speaker", "speaker", true, true, true, false],
      ["Old Speaker", "speaker", true, false, false, false],
      ["Pixel Buds", "headphones", false, false, false, true],
      ["Soundbar", "speaker", false, false, false, true],
    ]);
  });

  test("where the sound goes", () => {
    expect(outputFromDump(dumpJson([BUILT_IN, KITCHEN_SINK], KITCHEN_SINK.name))).toEqual({
      name: "Kitchen Speaker",
      bluetooth: true,
      address: KITCHEN,
    });
    expect(outputFromDump(dumpJson([BUILT_IN], BUILT_IN.name))).toEqual({
      name: "Built-in Audio Analog Stereo",
      bluetooth: false,
      address: null,
    });
    // The metadata value sometimes comes as a JSON string.
    const asString = JSON.parse(dumpJson([BUILT_IN, KITCHEN_SINK], null));
    asString[2].metadata = [{ key: "default.audio.sink", value: JSON.stringify({ name: KITCHEN_SINK.name }) }];
    expect(outputFromDump(JSON.stringify(asString))?.address).toBe(KITCHEN);
    expect(sinkIdFor(dumpJson([BUILT_IN, KITCHEN_SINK], null), KITCHEN)).toBe(88);
    expect(sinkIdFor(dumpJson([BUILT_IN], null), KITCHEN)).toBeNull();
    expect(computerSinkId(dumpJson([KITCHEN_SINK, BUILT_IN], null))).toBe(61);
  });

  test("whether she chose the computer", () => {
    expect(choseComputer(dumpJson([BUILT_IN], BUILT_IN.name))).toBe(false); // nothing chosen yet
    expect(choseComputer(dumpJson([BUILT_IN], BUILT_IN.name, { configured: BUILT_IN.name }))).toBe(true);
    expect(choseComputer(dumpJson([BUILT_IN], BUILT_IN.name, { configured: KITCHEN_SINK.name }))).toBe(false);
  });

  test("the A2DP profile for a speaker without a sink", () => {
    const card = (profile: string) => ({ cards: [{ id: 70, address: KITCHEN, profile }] });
    expect(a2dpProfileFor(dumpJson([BUILT_IN], null, card("off")), KITCHEN)).toEqual({ deviceId: 70, index: 131076 });
    expect(a2dpProfileFor(dumpJson([BUILT_IN], null, card("headset-head-unit")), KITCHEN)).toEqual({ deviceId: 70, index: 131076 });
    // Already A2DP, or already has a sink, or PipeWire doesn't know it.
    expect(a2dpProfileFor(dumpJson([BUILT_IN], null, card("a2dp-sink")), KITCHEN)).toBeNull();
    expect(a2dpProfileFor(dumpJson([BUILT_IN, KITCHEN_SINK], null, card("off")), KITCHEN)).toBeNull();
    expect(a2dpProfileFor(dumpJson([BUILT_IN], null), KITCHEN)).toBeNull();
  });

  test("a device paired without a stored key", () => {
    const { devices } = parseObjects(
      objectsJson([{ address: KITCHEN, name: "Kitchen Speaker", icon: "audio-card", paired: true, bonded: false, trusted: true }]),
    );
    expect(devices[0]).toMatchObject({ paired: true, bonded: false });
    expect(speakerList(devices, null)[0]).toMatchObject({ paired: false, saved: false });
  });

  test("failure reasons", () => {
    expect(failReason("Device 11:22:33:44:55:66 not available", "pair")).toBe("not-found");
    expect(failReason("Failed to pair: org.bluez.Error.AuthenticationFailed", "pair")).toBe("pair");
    expect(failReason("Failed to pair: org.bluez.Error.ConnectionAttemptFailed Page Timeout", "pair")).toBe("not-found");
    expect(failReason("Call failed: br-connection-page-timeout", "connect")).toBe("connect");
    expect(failReason("Call failed: Resource Not Ready", "connect")).toBe("off");
    expect(failReason("Call failed: br-connection-profile-unavailable", "connect")).toBe("connect");
    expect(stripAnsi("\x1b[0;92mNEW\x1b[0m Device\r")).toBe("NEW Device");
  });
});


// A fake busctl, bluetoothctl, pw-dump and wpctl that answer from a small
// model of BlueZ, PipeWire and WirePlumber, and record every call. It acts
// like her laptop did on September 28: the adapter isn't pairable, so a
// pairing stores no key unless Pairable is set, and pairing leaves a bare
// link that says Connected with no sound on it until Connect is called.
interface FakeDev extends Dev {
  profilesUp?: boolean;
  profile?: string;
}

function fakeSystem(
  initial: FakeDev[],
  opts: { pairFails?: string; connectFails?: string; sinkAppears?: boolean; profile?: string; configured?: string | null } = {},
) {
  const devs = new Map<string, FakeDev>(initial.map((d) => [d.address, { ...d }]));
  const calls: string[] = [];
  const adapter = { pairable: false };
  let configured: string | null = opts.configured ?? null;
  const sinkName = (a: string) => `bluez_output.${a.replace(/:/g, "_")}.1`;
  const live = () => [...devs.values()].filter((d) => d.connected && d.profilesUp);
  const cards = (): Card[] => live().map((d, i) => ({ id: 70 + i, address: d.address, profile: d.profile ?? opts.profile ?? "a2dp-sink" }));
  const sinks = (): Sink[] => [
    BUILT_IN,
    ...live()
      .filter((d) => opts.sinkAppears !== false && (d.profile ?? opts.profile ?? "a2dp-sink").startsWith("a2dp-sink"))
      .map((d, i) => ({ id: 90 + i, name: sinkName(d.address), description: d.name ?? "", address: d.address })),
  ];
  // WirePlumber: the configured sink if it's there, else a Bluetooth one
  // (they rank higher), else the laptop's own.
  const defaultSink = () => {
    const all = sinks();
    return (all.find((s) => s.name === configured) ?? all.find((s) => s.address) ?? BUILT_IN).name;
  };
  const byPath = (p: string) => [...devs.values()].find((d) => pathOf(d.address) === p);
  const ok = (stdout = ""): RunResult => ({ code: 0, stdout, stderr: "" });
  const fail = (stderr: string): RunResult => ({ code: 1, stdout: "", stderr });
  setRunner(
    async (cmd) => {
      const line = cmd.join(" ");
      calls.push(line);
      const [bin, ...args] = cmd;
      if (bin === "busctl") {
        if (args.includes("GetManagedObjects")) return ok(objectsJson([...devs.values()], { pairable: adapter.pairable }));
        if (args[0] === "set-property") {
          if (args[2] === HCI && args[4] === "Pairable") adapter.pairable = args[6] === "true";
          const d = byPath(args[2]!);
          if (d && args[4] === "Trusted") d.trusted = args[6] === "true";
          return ok();
        }
        const callArgs = args.filter((a) => !a.startsWith("--timeout"));
        if (callArgs[0] === "call") {
          const d = byPath(callArgs[2]!);
          const method = callArgs[4];
          if (method === "Connect") {
            if (opts.connectFails) return fail(`Call failed: ${opts.connectFails}`);
            if (d!.connected && d!.profilesUp) return fail("Call failed: Already Connected (org.bluez.Error.AlreadyConnected)");
            d!.connected = true;
            d!.profilesUp = true;
            return ok();
          }
          if (method === "Disconnect") {
            d!.connected = false;
            d!.profilesUp = false;
            // A pairing without a key ends with the link.
            if (!(d!.bonded ?? d!.paired)) d!.paired = false;
            return ok();
          }
        }
        return fail("unexpected busctl call");
      }
      if (bin === "bluetoothctl") {
        if (args.includes("pair")) {
          if (opts.pairFails) return { code: 1, stdout: `Attempting to pair with X\n\x1b[0;91mFailed to pair: ${opts.pairFails}\x1b[0m\n`, stderr: "" };
          const d = devs.get(args[args.length - 1]!)!;
          d.paired = true;
          d.bonded = adapter.pairable;
          d.connected = true;
          return ok("Attempting to pair with X\n[CHG] Device X Paired: yes\nPairing successful\n");
        }
        return ok("Discovery started\n");
      }
      if (bin === "pw-dump") return ok(dumpJson(sinks(), defaultSink(), { configured, cards: cards() }));
      if (bin === "wpctl") {
        if (args[0] === "set-default") {
          const s = sinks().find((x) => String(x.id) === args[1]);
          if (!s) return fail("not found");
          configured = s.name;
          return ok();
        }
        if (args[0] === "set-profile") {
          const card = cards().find((c) => String(c.id) === args[1]);
          const profile = PROFILES.find((p) => String(p.index) === args[2]);
          if (card && profile) devs.get(card.address)!.profile = profile.name;
          return ok();
        }
      }
      return fail(`unexpected ${bin}`);
    },
    async () => undefined,
  );
  return { calls, devs, adapter, output: defaultSink, configured: () => configured };
}

afterEach(() => setRunner(null));

const KITCHEN_NAME = "bluez_output.11_22_33_44_55_66.1";

describe("connecting", () => {
  test("a new speaker: pair with a stored key, trust, connect, and send the sound to it", async () => {
    const sys = fakeSystem([{ address: KITCHEN, name: "Kitchen Speaker", icon: "audio-card", rssi: -50 }]);
    const r = await connect("11-22-33-44-55-66");
    expect(r).toEqual({ address: KITCHEN, name: "Kitchen Speaker", connected: true, paired: true, output: true });
    expect(sys.devs.get(KITCHEN)).toMatchObject({ paired: true, bonded: true, trusted: true, connected: true });
    expect(sys.output()).toBe(KITCHEN_NAME);
    expect(sys.calls.some((c) => c === `bluetoothctl --agent NoInputNoOutput pair ${KITCHEN}`)).toBe(true);
    // Pairable only for the pairing.
    const pairable = sys.calls.filter((c) => c.includes("Adapter1 Pairable"));
    expect(pairable).toEqual([
      `busctl set-property org.bluez ${HCI} org.bluez.Adapter1 Pairable b true`,
      `busctl set-property org.bluez ${HCI} org.bluez.Adapter1 Pairable b false`,
    ]);
    expect(sys.adapter.pairable).toBe(false);
  });

  test("calls Connect even though the pairing's link already says Connected", async () => {
    // The September 28 bug: the old code saw Connected, skipped Connect, and
    // waited for a sink that never came.
    const sys = fakeSystem([{ address: KITCHEN, name: "Kitchen Speaker", icon: "audio-card", rssi: -50 }]);
    await connect(KITCHEN);
    const pairAt = sys.calls.findIndex((c) => c.includes(" pair "));
    const connectAt = sys.calls.findIndex((c) => c.endsWith("org.bluez.Device1 Connect"));
    expect(connectAt).toBeGreaterThan(pairAt);
  });

  test("a speaker paired without a key is paired again", async () => {
    const sys = fakeSystem([
      { address: KITCHEN, name: "Kitchen Speaker", icon: "audio-card", paired: true, bonded: false, trusted: true, connected: true },
    ]);
    const r = await connect(KITCHEN);
    expect(r.paired).toBe(true);
    expect(sys.devs.get(KITCHEN)).toMatchObject({ bonded: true, connected: true });
    const disconnectAt = sys.calls.findIndex((c) => c.endsWith("Disconnect"));
    expect(disconnectAt).toBeGreaterThanOrEqual(0);
    expect(disconnectAt).toBeLessThan(sys.calls.findIndex((c) => c.includes(" pair ")));
  });

  test("a saved speaker doesn't pair again", async () => {
    const sys = fakeSystem([{ address: KITCHEN, name: "Kitchen Speaker", icon: "audio-card", paired: true, trusted: false }]);
    const r = await connect(KITCHEN);
    expect(r.paired).toBe(false);
    expect(sys.devs.get(KITCHEN)?.trusted).toBe(true);
    expect(sys.calls.some((c) => c.includes(" pair "))).toBe(false);
    expect(sys.calls.some((c) => c.includes("Pairable"))).toBe(false);
  });

  test("an already connected speaker counts as connected", async () => {
    const sys = fakeSystem([
      { address: KITCHEN, name: "Kitchen Speaker", icon: "audio-card", paired: true, trusted: true, connected: true, profilesUp: true },
    ]);
    expect(await connect(KITCHEN)).toMatchObject({ connected: true, output: true });
    expect(sys.output()).toBe(KITCHEN_NAME);
  });

  test("a speaker PipeWire left on hands-free or off is switched to A2DP", async () => {
    const sys = fakeSystem([{ address: KITCHEN, name: "Kitchen Speaker", icon: "audio-card", paired: true, trusted: true }], {
      profile: "off",
    });
    expect(await connect(KITCHEN)).toMatchObject({ output: true });
    expect(sys.calls).toContain("wpctl set-profile 70 131076");
    expect(sys.output()).toBe(KITCHEN_NAME);
  });

  test("connected, but no sink ever shows up", async () => {
    const sys = fakeSystem([{ address: KITCHEN, name: "Kitchen Speaker", icon: "audio-card", paired: true, trusted: true }], {
      sinkAppears: false,
    });
    const r = await connect(KITCHEN);
    expect(r).toMatchObject({ connected: true, output: false });
    expect(r.detail).toBe(`Card 70 is on profile a2dp-sink (has off, a2dp-sink-sbc, a2dp-sink, headset-head-unit). Sinks: ${BUILT_IN.name}.`);
    // It waited SINK_WAIT_MS in half-second steps, then looked once more for the detail.
    expect(sys.calls.filter((c) => c === "pw-dump").length).toBe(42);
  });

  test("a speaker that isn't there after a second look", async () => {
    const sys = fakeSystem([]);
    await expect(connect(KITCHEN)).rejects.toMatchObject({ reason: "not-found" });
    expect(sys.calls.some((c) => c.startsWith("bluetoothctl --timeout"))).toBe(true);
  });

  test("pairing refused, and Pairable goes back off", async () => {
    const sys = fakeSystem([{ address: KITCHEN, name: "Kitchen Speaker", icon: "audio-card" }], {
      pairFails: "org.bluez.Error.AuthenticationFailed",
    });
    await expect(connect(KITCHEN)).rejects.toMatchObject({ reason: "pair" });
    expect(sys.adapter.pairable).toBe(false);
  });

  test("paired but it won't connect", async () => {
    fakeSystem([{ address: KITCHEN, name: "Kitchen Speaker", icon: "audio-card", paired: true, trusted: true }], {
      connectFails: "br-connection-page-timeout",
    });
    await expect(connect(KITCHEN)).rejects.toMatchObject({ reason: "connect" });
  });

  test("not an address", async () => {
    fakeSystem([]);
    await expect(connect("Kitchen")).rejects.toBeInstanceOf(SpeakerError);
  });
});

describe("where the sound comes out", () => {
  const playing: FakeDev = {
    address: KITCHEN,
    name: "Kitchen Speaker",
    icon: "audio-card",
    paired: true,
    trusted: true,
    connected: true,
    profilesUp: true,
  };

  test("the computer, without disconnecting the speaker", async () => {
    const sys = fakeSystem([playing], { configured: KITCHEN_NAME });
    const st = await output("computer");
    expect(st.output).toEqual({ name: "Built-in Audio Analog Stereo", bluetooth: false, address: null });
    expect(st.speakers[0]).toMatchObject({ address: KITCHEN, connected: true, output: false, saved: true });
    expect(sys.devs.get(KITCHEN)).toMatchObject({ connected: true, trusted: true });
    expect(sys.calls.some((c) => c.includes("Disconnect"))).toBe(false);
    expect(sys.configured()).toBe(BUILT_IN.name);
  });

  test("back to a connected speaker", async () => {
    const sys = fakeSystem([playing], { configured: BUILT_IN.name });
    expect(sys.output()).toBe(BUILT_IN.name);
    const st = await output(KITCHEN);
    expect(st.output?.address).toBe(KITCHEN);
    expect(st.speakers[0]!.output).toBe(true);
    expect(sys.calls.some((c) => c.includes(" pair "))).toBe(false);
  });

  test("a saved speaker that isn't connected is connected first", async () => {
    const sys = fakeSystem([{ ...playing, connected: false, profilesUp: false }], { configured: BUILT_IN.name });
    const st = await output(KITCHEN);
    expect(st.output?.address).toBe(KITCHEN);
    expect(sys.devs.get(KITCHEN)?.connected).toBe(true);
  });

  test("a connected speaker with no sink says so", async () => {
    fakeSystem([playing], { sinkAppears: false });
    await expect(output(KITCHEN)).rejects.toMatchObject({ reason: "no-sound" });
  });

  test("bad targets", async () => {
    fakeSystem([]);
    await expect(output("kitchen")).rejects.toBeInstanceOf(SpeakerError);
  });
});

describe("stopping and reconnecting", () => {
  test("disconnect clears trusted, so it doesn't come back by itself", async () => {
    const sys = fakeSystem([{ address: KITCHEN, name: "Kitchen Speaker", icon: "audio-card", paired: true, trusted: true, connected: true }]);
    await disconnect(KITCHEN);
    expect(sys.devs.get(KITCHEN)).toMatchObject({ trusted: false, connected: false, paired: true });
    await expect(disconnect(PHONE)).rejects.toMatchObject({ reason: "unknown-speaker" });
  });

  test("reconnect tries saved speakers once and stops at the first that answers", async () => {
    const sys = fakeSystem([
      { address: KITCHEN, name: "Kitchen Speaker", icon: "audio-card", paired: true, trusted: true },
      { address: BUDS, name: "Pixel Buds", icon: "audio-headset", paired: true, trusted: false },
    ]);
    expect(await reconnect()).toEqual({ tried: [KITCHEN], connected: KITCHEN });
    expect(sys.output()).toBe(KITCHEN_NAME);
    // Already connected: nothing to do.
    const before = sys.calls.length;
    expect(await reconnect()).toEqual({ tried: [], connected: KITCHEN });
    expect(sys.calls.slice(before).some((c) => c.includes("Connect"))).toBe(false);
  });

  test("reconnect leaves the speaker alone when she chose the computer", async () => {
    const sys = fakeSystem([{ address: KITCHEN, name: "Kitchen Speaker", icon: "audio-card", paired: true, trusted: true }], {
      configured: BUILT_IN.name,
    });
    expect(await reconnect()).toEqual({ tried: [], connected: null, skipped: "computer" });
    expect(sys.calls.some((c) => c.includes("Connect"))).toBe(false);
  });

  test("reconnect with nothing saved does nothing", async () => {
    const sys = fakeSystem([{ address: BUDS, name: "Pixel Buds", icon: "audio-headset", rssi: -40 }]);
    expect(await reconnect()).toEqual({ tried: [], connected: null });
    expect(sys.calls.some((c) => c.includes("Connect"))).toBe(false);
  });

  test("a speaker paired without a key isn't saved", async () => {
    const sys = fakeSystem([{ address: KITCHEN, name: "Kitchen Speaker", icon: "audio-card", paired: true, bonded: false, trusted: true }]);
    expect(await reconnect()).toEqual({ tried: [], connected: null });
    expect(sys.calls.some((c) => c.includes("Connect"))).toBe(false);
  });
});
