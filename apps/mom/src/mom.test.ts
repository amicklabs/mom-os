import { describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseConfig, resolveDevice, resolveDispatcherTokenFile, starterConfig, MomConfig } from "./config";
import { parseSteps, planDeploy } from "./deploy";
import { doctorChecks, doctorText } from "./doctor";
import { convexRunArgv, installTokenCommand, parseRunOutput } from "./provision";
import { parseGlobals } from "./main";
import { findPngPath, findScreenWoken, parseMomctlOutput, PASSTHROUGH } from "./momctl";
import { toText } from "./output";
import { asPersonCommand, momctlCommand, shellQuote, sshArgs } from "./ssh";
import { dkmsModulesFor, healthCheckScript, healthProblems, kernelCheckScript, kernelState, missingModules, needsReboot, parseKv } from "./update";
import { findTigerVncApp, noViewerMessage, vncCommand } from "./vnc";

const config = parseConfig(
  JSON.stringify({
    defaultDevice: "mom",
    devices: {
      mom: { host: "laptop", user: "person", adminUser: "admin" },
      aunt: { host: "other", user: "p2", adminUser: "admin", vncHost: "100.64.0.9", vncPort: 5901, sshPort: 2222 },
    },
  }),
);

describe("config", () => {
  test("starter config is valid", () => {
    expect(MomConfig.safeParse(starterConfig({ device: "mom", host: "h", user: "u", admin: "a" })).success).toBe(true);
  });

  test("defaults fill in", () => {
    expect(config.dispatcherTokenFile).toBeUndefined();
    expect(config.devices.mom!.vncPort).toBe(5900);
  });

  test("dispatcher token path", () => {
    const home = "/h";
    const current = "/h/.config/momos/dispatcher-token";
    expect(resolveDispatcherTokenFile(null, home)).toBe(current);
    // The old default written into mom.json by earlier versions counts as unset.
    expect(resolveDispatcherTokenFile("~/.config/momos-dev/dispatcher-token", home)).toBe(current);
    expect(resolveDispatcherTokenFile("/h/.config/momos-dev/dispatcher-token", home)).toBe(current);
    expect(resolveDispatcherTokenFile("~/secrets/token", home)).toBe("/h/secrets/token");
  });

  test("mom help devices lists devices create", async () => {
    const proc = Bun.spawn(["bun", join(import.meta.dir, "main.ts"), "help", "devices"], { stdout: "pipe", stderr: "pipe" });
    const out = await new Response(proc.stdout).text();
    expect(out).toContain("devices create <name>");
    expect(out).toContain("--prod");
  });

  test("device resolution order", () => {
    expect(resolveDevice(config, null, {}).name).toBe("mom");
    expect(resolveDevice(config, null, { MOM_DEVICE: "aunt" }).name).toBe("aunt");
    expect(resolveDevice(config, "aunt", { MOM_DEVICE: "mom" }).name).toBe("aunt");
    expect(() => resolveDevice(config, "nobody", {})).toThrow(/Unknown device/);
  });

  test("bad config explains itself", () => {
    expect(() => parseConfig('{"devices":{"x":{"host":"h"}}}')).toThrow(/devices\.x\.user/);
    expect(() => parseConfig("{nope")).toThrow(/not valid JSON/);
  });
});

describe("argv", () => {
  test("globals are pulled out anywhere", () => {
    const { globals, rest } = parseGlobals(["--json", "logs", "--unit", "momd", "-d", "aunt"]);
    expect(globals).toMatchObject({ json: true, device: "aunt" });
    expect(rest).toEqual(["logs", "--unit", "momd"]);
  });

  test("-- stops parsing", () => {
    expect(parseGlobals(["type", "--", "--json"]).rest).toEqual(["type", "--json"]);
  });
});

describe("ssh", () => {
  test("control connection options are always there", () => {
    const args = sshArgs(resolveDevice(config, "aunt", {}), "true");
    expect(args).toContain("ControlMaster=auto");
    expect(args).toContain("ControlPersist=10m");
    expect(args.some((a) => a.startsWith("ControlPath="))).toBe(true);
    expect(args).toContain("BatchMode=yes");
    expect(args.slice(-3)).toEqual(["-T", "admin@other", "true"]);
    expect(args.join(" ")).toContain("-p 2222");
  });

  test("shellQuote survives the remote shell", async () => {
    const tricky = ["it's", "$HOME", "a b", "`x`", '"q"', "", "é"];
    const proc = Bun.spawn(["bash", "-c", `printf '%s\\n' ${tricky.map(shellQuote).join(" ")}`], { stdout: "pipe" });
    const out = await new Response(proc.stdout).text();
    expect(out.split("\n").slice(0, -1)).toEqual(tricky);
  });

  test("momctl runs as the person with argv intact", async () => {
    // A fake sudo that drops its own options and runs the rest.
    const dir = mkdtempSync(join(tmpdir(), "mom-sudo-"));
    writeFileSync(join(dir, "sudo"), '#!/bin/sh\nwhile [ "$1" != "--" ]; do shift; done\nshift\nexec "$@"\n');
    writeFileSync(join(dir, "momctl"), '#!/bin/sh\nprintf "%s\\n" "$@"\n');
    chmodSync(join(dir, "sudo"), 0o755);
    chmodSync(join(dir, "momctl"), 0o755);
    const cmd = momctlCommand("person", ["say", "Hi Mom, it's me; $(rm -rf /)"]).replace(/^sudo/, join(dir, "sudo"));
    // The env script resets PATH, so point momctl at the fake by full path.
    const withFake = cmd.replace(" momctl ", ` ${join(dir, "momctl")} `);
    const proc = Bun.spawn(["bash", "-c", withFake], { stdout: "pipe", stderr: "pipe" });
    const out = await new Response(proc.stdout).text();
    expect(out).toBe("say\nHi Mom, it's me; $(rm -rf /)\n");
  });

  test("the env script finds this session's Hyprland and Wayland", async () => {
    if (!process.env.HYPRLAND_INSTANCE_SIGNATURE) return; // only meaningful inside Hyprland
    const cmd = asPersonCommand("x", ["env"]).replace(/^sudo -n -u x -H -- /, "");
    const proc = Bun.spawn(["bash", "-c", cmd], { stdout: "pipe", env: { HOME: process.env.HOME! } });
    const env = parseKv(await new Response(proc.stdout).text());
    // The script takes the newest instance. With a nested Hyprland running
    // (dev/session.sh), that isn't this one, so only check the count then.
    const instances = (await new Response(Bun.spawn(["hyprctl", "instances"], { stdout: "pipe" }).stdout).text())
      .split("\n")
      .filter((l) => l.startsWith("instance "));
    if (instances.length > 1) {
      expect(instances.some((l) => l.includes(env.HYPRLAND_INSTANCE_SIGNATURE!))).toBe(true);
      return;
    }
    expect(env.HYPRLAND_INSTANCE_SIGNATURE).toBe(process.env.HYPRLAND_INSTANCE_SIGNATURE);
    expect(env.WAYLAND_DISPLAY).toBe(process.env.WAYLAND_DISPLAY!);
    expect(env.XDG_RUNTIME_DIR).toBe(`/run/user/${process.getuid!()}`);
  });
});

describe("passthrough", () => {
  test("mom reload runs momctl reload", () => {
    expect(PASSTHROUGH.reload).toBe("reload");
    expect(momctlCommand("mom", ["reload", "recipes"])).toContain("reload recipes");
  });
});

describe("momctl output", () => {
  test("parses JSON, tolerates noise", () => {
    expect(parseMomctlOutput('{"a":1}\n')).toEqual({ a: 1 });
    expect(parseMomctlOutput('warning: x\n{"a":2}\n')).toEqual({ a: 2 });
    expect(parseMomctlOutput("plain")).toEqual({ output: "plain" });
    expect(parseMomctlOutput("")).toBeNull();
  });

  test("finds the screenshot path in any shape", () => {
    expect(findPngPath({ path: "/tmp/a.png" })).toBe("/tmp/a.png");
    expect(findPngPath({ ok: true, data: { file: "/tmp/b.png" } })).toBe("/tmp/b.png");
    expect(findPngPath("/tmp/c.png")).toBe("/tmp/c.png");
    expect(findPngPath({ nope: 1 })).toBeNull();
  });

  test("passes screenWoken through when momctl says it", () => {
    expect(findScreenWoken({ ok: true, data: { path: "/tmp/a.png", screenWoken: true } })).toBe(true);
    expect(findScreenWoken({ ok: true, data: { path: "/tmp/a.png", screenWoken: false } })).toBe(false);
    expect(findScreenWoken({ ok: true, data: { path: "/tmp/a.png" } })).toBeNull();
    expect(findScreenWoken(null)).toBeNull();
  });

  test("text output is readable", () => {
    expect(toText({ online: true, wifi: { ssid: "Home" }, apps: ["a", "b"] })).toBe("online: true\nwifi:\n  ssid: Home\napps: a, b");
  });
});

describe("vnc", () => {
  const dev = resolveDevice(config, "aunt", {});
  test("macOS uses TigerVNC, never Screen Sharing", () => {
    const none = { exists: () => false, findApp: () => null };
    expect(vncCommand(dev, "darwin", (b) => (b === "vncviewer" ? "/opt/x/vncviewer" : null), none)!.argv).toEqual(["/opt/x/vncviewer", "100.64.0.9::5901"]);
    expect(vncCommand(dev, "darwin", () => null, { exists: (p) => p === "/opt/homebrew/bin/vncviewer", findApp: () => null })!.argv).toEqual([
      "/opt/homebrew/bin/vncviewer",
      "100.64.0.9::5901",
    ]);
    const app = "/Applications/TigerVNC Viewer 1.15.0.app/Contents/MacOS/TigerVNC Viewer";
    expect(vncCommand(dev, "darwin", () => null, { exists: () => false, findApp: () => app })!.argv).toEqual([app, "100.64.0.9::5901"]);
    expect(vncCommand(dev, "darwin", () => null, none)).toBeNull();
    expect(noViewerMessage("darwin")).toContain("brew install --cask tigervnc-viewer");
  });
  test("the TigerVNC app is found in an Applications folder", () => {
    const dir = mkdtempSync(join(tmpdir(), "apps-"));
    expect(findTigerVncApp([dir])).toBeNull();
    mkdirSync(join(dir, "TigerVNC Viewer 1.15.0.app", "Contents", "MacOS"), { recursive: true });
    writeFileSync(join(dir, "TigerVNC Viewer 1.15.0.app", "Contents", "MacOS", "TigerVNC Viewer"), "");
    expect(findTigerVncApp(["/nonexistent", dir])).toBe(join(dir, "TigerVNC Viewer 1.15.0.app", "Contents", "MacOS", "TigerVNC Viewer"));
  });
  test("Linux picks the first viewer installed", () => {
    expect(vncCommand(dev, "linux", (b) => (b === "remmina" ? "/usr/bin/remmina" : null))!.argv).toEqual(["remmina", "-c", "vnc://100.64.0.9:5901"]);
    expect(vncCommand(dev, "linux", () => "/x")!.argv).toEqual(["vncviewer", "100.64.0.9::5901"]);
    expect(vncCommand(dev, "linux", () => null)).toBeNull();
  });
});

describe("deploy", () => {
  test("plan calls install.sh by the contract and never ships personal configs", () => {
    const repo = join(import.meta.dir, "..", "..", "..");
    const plan = planDeploy(repo, resolveDevice(config, "mom", {}), { steps: "shell,binaries", configFile: "/tmp/real.json", build: false });
    expect(plan.install).toBe("sudo /usr/local/src/momos/system/install.sh --config /etc/momos/config.json shell binaries");
    const sources = plan.rsync[0]!.join(" ");
    expect(sources).toContain(`${repo}/./config/example.jsonc`);
    expect(sources).not.toMatch(/\/\.\/config(\s|$)/);
    expect(plan.configPush!.local).toBe("/tmp/real.json");
    expect(plan.configPush!.remote).toContain("-m 600");
    expect(plan.configPush!.remote).toContain("/etc/momos/config.json");
  });

  test("steps split on commas or spaces and reject anything else", () => {
    expect(parseSteps("all")).toEqual(["all"]);
    expect(parseSteps("shell, binaries session")).toEqual(["shell", "binaries", "session"]);
    expect(() => parseSteps("shell;rm")).toThrow("bad step");
    expect(() => parseSteps(" , ")).toThrow("no install steps");
  });
});

describe("update", () => {
  test("kernel state and reboot decision", () => {
    const k = kernelState(parseKv("running=7.2.3\ntarget=7.2.4\nmodule_wl=ok\nmodule_facetimehd=missing\nreboot_flag=0\n"), ["wl", "facetimehd"]);
    expect(k.modules).toEqual({ wl: true, facetimehd: false });
    expect(missingModules(k)).toEqual(["facetimehd"]);
    expect(needsReboot(k)).toBe(true);
    expect(needsReboot({ ...k, target: "7.2.3" })).toBe(false);
    expect(needsReboot({ ...k, target: "7.2.3", rebootFlag: true })).toBe(true);
  });

  test("DKMS modules come from the device's config file", () => {
    const dir = mkdtempSync(join(tmpdir(), "hw-"));
    const file = join(dir, "laptop.jsonc");
    writeFileSync(file, '// comment\n{ "local": { "hardware": { "dkmsModules": ["wl", "facetimehd"], "lid": "flaky-macbook" } } }\n');
    expect(dkmsModulesFor({ configFile: file })).toEqual(["wl", "facetimehd"]);
    writeFileSync(file, '{ "local": { "convexUrl": null } }\n');
    expect(dkmsModulesFor({ configFile: file })).toEqual([]);
    expect(dkmsModulesFor({ configFile: null })).toEqual([]);
    writeFileSync(file, '{ "local": { "hardware": { "dkmsModules": ["wl; reboot"] } } }\n');
    expect(() => dkmsModulesFor({ configFile: file })).toThrow("invalid");
  });

  test("with no DKMS modules nothing is checked", () => {
    expect(kernelCheckScript([])).toContain("for m in ; do");
    expect(kernelCheckScript(["wl", "facetimehd"])).toContain("for m in wl facetimehd; do");
    const plain = healthCheckScript("mom", []);
    expect(plain).not.toContain("lsmod");
    expect(plain).not.toContain("camera");
    expect(kernelState(parseKv("running=1\ntarget=1\n"), []).modules).toEqual({});
    expect(healthProblems({ shell: "running" }, [])).toEqual([]);
  });

  test("the MacBook's modules give the same health problems as before", () => {
    const script = healthCheckScript("mom", ["wl", "facetimehd"]);
    expect(script).toContain('lsmod | grep -qw "^wl"');
    expect(script).toContain("camera=present");
    expect(healthProblems({ wl: "loaded", facetimehd: "loaded", camera: "present", shell: "running" }, ["wl", "facetimehd"])).toEqual([]);
    expect(healthProblems({ wl: "missing", facetimehd: "loaded", camera: "missing", shell: "missing" }, ["wl", "facetimehd"])).toEqual([
      "Wi-Fi driver (wl) isn't loaded",
      "camera driver or device missing",
      "the MomOS shell isn't running",
    ]);
  });
});

describe("devices create", () => {
  test("reads convex run output and never puts the token on a command line", () => {
    expect(parseRunOutput('some log\n{\n  "deviceId": "abc",\n  "token": "momos_x"\n}\n')).toEqual({ deviceId: "abc", token: "momos_x" });
    expect(() => parseRunOutput("nothing")).toThrow("no JSON");
    const cmd = installTokenCommand("mom");
    expect(cmd).toContain("/dev/stdin");
    expect(cmd).toContain("-m 600 -o mom");
    expect(convexRunArgv("provision:createDevice", { name: "mom" })).toEqual(["npx", "convex", "run", "provision:createDevice", '{"name":"mom"}']);
    expect(convexRunArgv("provision:createDevice", { name: "mom" }, { prod: true })).toEqual([
      "npx",
      "convex",
      "run",
      "--prod",
      "provision:createDevice",
      '{"name":"mom"}',
    ]);
  });
});

describe("doctor", () => {
  const dev = resolveDevice(config, "mom", {});
  const cfg = join(mkdtempSync(join(tmpdir(), "doc-")), "laptop.jsonc");
  writeFileSync(cfg, "{}");

  test("all good", () => {
    const checks = doctorChecks({ device: dev, localRsync: true, configFile: cfg, remote: { code: 0, stdout: "rsync=ok\nsudo=ok\n", stderr: "" } });
    expect(checks.every((c) => c.ok === true)).toBe(true);
    expect(doctorText(checks)).toContain("Ready for `mom deploy`.");
  });

  test("each problem comes with a fix", () => {
    const checks = doctorChecks({ device: dev, localRsync: true, configFile: cfg, remote: { code: 0, stdout: "rsync=missing\nsudo=missing\n", stderr: "" } });
    const failed = checks.filter((c) => c.ok === false);
    expect(failed.map((c) => c.name)).toEqual(["rsync on the laptop", "passwordless sudo for admin"]);
    expect(failed[0]!.fix).toContain("pacman -S --needed rsync");
    expect(failed[1]!.fix).toContain("admin ALL=(ALL) NOPASSWD: ALL");
    expect(doctorText(checks)).toContain("2 problems to fix");
  });

  test("no SSH skips the laptop checks", () => {
    const checks = doctorChecks({ device: dev, localRsync: false, configFile: null, remote: { code: 255, stdout: "", stderr: "Connection refused" } });
    expect(checks.map((c) => c.ok)).toEqual([false, false, false, null, null]);
    expect(checks[2]!.fix).toContain("ssh-copy-id admin@laptop");
  });
});
