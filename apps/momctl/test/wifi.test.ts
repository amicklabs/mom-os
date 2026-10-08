import { afterEach, describe, expect, test } from "bun:test";
import type { RunResult } from "../src/lib/run";
import {
  connect,
  failReason,
  forget,
  keyMgmtFor,
  kindOf,
  mergeNetworks,
  parseConnectionFields,
  parseScan,
  passwdFile,
  setRunner,
  strength,
  WifiError,
} from "../src/lib/wifi";

describe("parsing nmcli", () => {
  test("scan rows, with escaped colons and hidden networks skipped", () => {
    const out = [
      " :Smith Home:82:WPA2",
      "*:Cafe\\:Guest:55:",
      " ::40:WPA2",
      " :--:30:WPA2",
      " :Smith Home:60:WPA2",
      " :Office:35:WPA2 802.1X",
      " :DIRECT-64-HP Smart Tank 5100:60:WPA2",
      "",
    ].join("\n");
    expect(parseScan(out)).toEqual([
      { inUse: false, ssid: "Smith Home", signal: 82, security: "WPA2" },
      { inUse: true, ssid: "Cafe:Guest", signal: 55, security: "" },
      { inUse: false, ssid: "Smith Home", signal: 60, security: "WPA2" },
      { inUse: false, ssid: "Office", signal: 35, security: "WPA2 802.1X" },
    ]);
  });

  test("connection fields, one block per profile", () => {
    const out = [
      "connection.uuid:1111",
      "connection.id:Smith Home",
      "802-11-wireless.ssid:Smith Home",
      "connection.uuid:2222",
      "connection.id:A",
      "802-11-wireless.ssid:Net:with colon",
    ].join("\n");
    expect(parseConnectionFields(out)).toEqual([
      { uuid: "1111", name: "Smith Home", ssid: "Smith Home" },
      { uuid: "2222", name: "A", ssid: "Net:with colon" },
    ]);
  });

  test("security kinds and key management", () => {
    expect(kindOf("")).toBe("open");
    expect(kindOf("--")).toBe("open");
    expect(kindOf("WPA1 WPA2")).toBe("password");
    expect(kindOf("WPA3")).toBe("password");
    expect(kindOf("WPA2 802.1X")).toBe("enterprise");
    expect(kindOf("WEP")).toBe("old");
    expect(kindOf("OWE")).toBe("open");
    expect(keyMgmtFor("")).toBeNull();
    expect(keyMgmtFor("WPA2")).toBe("wpa-psk");
    expect(keyMgmtFor("WPA2 WPA3")).toBe("wpa-psk");
    expect(keyMgmtFor("WPA3")).toBe("sae");
    expect(keyMgmtFor("OWE")).toBe("owe");
  });

  test("signal in words", () => {
    expect(strength(90)).toBe("strong");
    expect(strength(70)).toBe("strong");
    expect(strength(55)).toBe("good");
    expect(strength(39)).toBe("weak");
  });

  test("failure reasons", () => {
    expect(failReason("Error: Connection activation failed: Secrets were required, but not provided.")).toBe("password");
    expect(failReason("Error: No network with SSID 'X' found.")).toBe("not-found");
    expect(failReason("Error: Timeout expired (45 seconds)")).toBe("timeout");
    expect(failReason("Error: Not authorized to control networking.")).toBe("not-allowed");
    expect(failReason("something else")).toBe("failed");
  });

  test("passwd-file keeps only the first line", () => {
    expect(passwdFile("pa:ss word\nextra")).toBe("802-11-wireless-security.psk:pa:ss word\n");
  });
});

describe("the network list", () => {
  test("one row per name, the one in use first, then known, then by signal", () => {
    const rows = parseScan([" :Neighbor:90:WPA2", " :Smith Home:50:WPA2", "*:Hotel:45:", " :Smith Home:75:WPA2", " :Old:20:WPA2"].join("\n"));
    const list = mergeNetworks(rows, [
      { uuid: "1", name: "Smith Home", ssid: "Smith Home", active: false },
      { uuid: "2", name: "Old", ssid: "Old", active: false },
    ]);
    expect(list.map((n) => [n.name, n.inUse, n.known, n.signal, n.strength, n.secure])).toEqual([
      ["Hotel", true, false, 45, "good", false],
      ["Smith Home", false, true, 75, "strong", true],
      ["Old", false, true, 20, "weak", true],
      ["Neighbor", false, false, 90, "strong", true],
    ]);
  });
});

// A fake nmcli that answers from a script and records every call.
function fakeNmcli(answers: (args: string[]) => Partial<RunResult>) {
  const calls: { args: string[]; stdin?: string }[] = [];
  setRunner(async (cmd, opts) => {
    const args = cmd.slice(1);
    calls.push({ args, stdin: opts?.stdin });
    return { code: 0, stdout: "", stderr: "", ...answers(args) };
  });
  return calls;
}

const joined = (a: string[]) => a.join(" ");

function baseAnswers(extra: (args: string[]) => Partial<RunResult> | undefined) {
  return (args: string[]): Partial<RunResult> => {
    const hit = extra(args);
    if (hit) return hit;
    const s = joined(args);
    if (s === "-t -f DEVICE,TYPE device") return { stdout: "wlp3s0:wifi\nlo:loopback\n" };
    if (s === "radio wifi") return { stdout: "enabled\n" };
    if (s === "-t -f UUID,TYPE,ACTIVE connection show") return { stdout: "aaaa:802-11-wireless:yes\n" };
    if (s.startsWith("-t -f connection.uuid,connection.id,802-11-wireless.ssid"))
      return { stdout: "connection.uuid:aaaa\nconnection.id:A\n802-11-wireless.ssid:Smith Home\n" };
    if (s === "-t -f SSID,SECURITY device wifi list --rescan no") return { stdout: "Smith Home:WPA2\nHotel:\nFriend:WPA2\n" };
    if (s.startsWith("networking connectivity")) return { stdout: "full\n" };
    if (s.startsWith("connection add")) return { stdout: "Connection 'Friend' (bbbbbbbb-0000-0000-0000-000000000000) successfully added.\n" };
    if (s.startsWith("-s -g")) return { stdout: "secret\n" };
    if (s.startsWith("connection edit")) return { stdout: "nmcli> Connection 'Friend' (bbbb) successfully updated.\nnmcli> " };
    return {};
  };
}

describe("connect and forget", () => {
  afterEach(() => setRunner(null));

  test("the network in use is left alone", async () => {
    const calls = fakeNmcli(baseAnswers(() => undefined));
    const r = await connect("Smith Home");
    expect(r).toMatchObject({ connected: true, already: true });
    expect(calls.some((c) => c.args.includes("up"))).toBe(false);
  });

  test("a new network gets the password through stdin, never argv", async () => {
    const calls = fakeNmcli(baseAnswers(() => undefined));
    const r = await connect("Friend", { password: "correct horse" });
    expect(r).toMatchObject({ connected: true, name: "Friend", saved: true });
    for (const c of calls) expect(c.args.join(" ")).not.toContain("correct horse");
    const edit = calls.find((c) => c.args[1] === "edit")!;
    expect(edit.stdin).toBe("set 802-11-wireless-security.psk correct horse\nsave\nquit\n");
    const up = calls.find((c) => c.args.includes("up"))!;
    expect(up.args).not.toContain("passwd-file");
    const add = calls.find((c) => c.args[1] === "add")!;
    expect(joined(add.args)).toContain("wifi-sec.key-mgmt wpa-psk");
    expect(joined(add.args)).toContain("connection.autoconnect no");
    expect(calls.some((c) => joined(c.args).includes("connection.autoconnect yes"))).toBe(true);
  });

  test("spaces at the ends of a password go through passwd-file instead", async () => {
    const calls = fakeNmcli(baseAnswers(() => undefined));
    await connect("Friend", { password: " padded pass " });
    expect(calls.some((c) => c.args[1] === "edit")).toBe(false);
    const up = calls.find((c) => c.args.includes("up"))!;
    expect(up.args).toContain("passwd-file");
    expect(up.stdin).toBe("802-11-wireless-security.psk: padded pass \n");
  });

  test("save-only makes a profile that joins by itself, without joining now", async () => {
    const calls = fakeNmcli(baseAnswers(() => undefined));
    const r = await connect("Daughter's House", { password: "correct horse", saveOnly: true });
    expect(r).toMatchObject({ connected: false, saved: true });
    expect(calls.some((c) => c.args.includes("up"))).toBe(false);
    const add = calls.find((c) => c.args[1] === "add")!;
    expect(joined(add.args)).toContain("connection.autoconnect yes");
    expect(joined(add.args)).toContain("wifi-sec.key-mgmt wpa-psk");
  });

  test("a password the editor refuses drops the profile", async () => {
    const calls = fakeNmcli(
      baseAnswers((args) =>
        args[1] === "edit" ? { stdout: "Error: Failed to save 'Friend': 802-11-wireless-security.psk: property is invalid\n" } : undefined,
      ),
    );
    const err = await connect("Friend", { password: "correct horse" }).catch((e) => e);
    expect((err as WifiError).reason).toBe("short");
    expect(calls.some((c) => c.args.includes("up"))).toBe(false);
    expect(calls.some((c) => joined(c.args).startsWith("connection delete uuid bbbbbbbb"))).toBe(true);
  });

  test("a wrong password deletes the new profile and says why", async () => {
    const calls = fakeNmcli(
      baseAnswers((args) =>
        args.includes("up") ? { code: 4, stderr: "Error: Connection activation failed: Secrets were required, but not provided.\n" } : undefined,
      ),
    );
    const err = await connect("Friend", { password: "wrong password" }).catch((e) => e);
    expect(err).toBeInstanceOf(WifiError);
    expect((err as WifiError).reason).toBe("password");
    expect(calls.some((c) => joined(c.args) === "connection delete uuid bbbbbbbb-0000-0000-0000-000000000000")).toBe(true);
  });

  test("short passwords never reach NetworkManager", async () => {
    const calls = fakeNmcli(baseAnswers(() => undefined));
    const err = await connect("Friend", { password: "short" }).catch((e) => e);
    expect((err as WifiError).reason).toBe("short");
    expect(calls.some((c) => c.args[1] === "add")).toBe(false);
  });

  test("an open network needs no password", async () => {
    const calls = fakeNmcli(baseAnswers(() => undefined));
    await connect("Hotel");
    const up = calls.find((c) => c.args.includes("up"))!;
    expect(up.args).not.toContain("passwd-file");
    const add = calls.find((c) => c.args[1] === "add")!;
    expect(joined(add.args)).not.toContain("key-mgmt");
  });

  test("forget refuses the network in use", async () => {
    fakeNmcli(baseAnswers(() => undefined));
    const err = await forget("Smith Home").catch((e) => e);
    expect((err as WifiError).reason).toBe("in-use");
    const missing = await forget("Nowhere").catch((e) => e);
    expect((missing as WifiError).reason).toBe("unknown-network");
  });
});
