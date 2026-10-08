import { existsSync } from "node:fs";
import { expandHome, type ResolvedDevice } from "./config";
import { parseKv } from "./update";
import { sshCapture, sshFailureMessage, sshTarget, type RunResult } from "./ssh";

// `mom doctor`: check what the first `mom deploy` needs, before running it,
// and say how to fix what's missing.

export interface Check {
  name: string;
  ok: boolean | null; // null: skipped because an earlier check failed
  detail?: string;
  fix?: string;
}

// One SSH call for everything on the laptop, to go easy on its rate limit.
export const REMOTE_CHECK_SCRIPT = [
  `if command -v rsync >/dev/null 2>&1; then echo rsync=ok; else echo rsync=missing; fi`,
  `if sudo -n true >/dev/null 2>&1; then echo sudo=ok; else echo sudo=missing; fi`,
].join("; ");

export interface DoctorInput {
  device: ResolvedDevice;
  localRsync: boolean;
  configFile: string | null;
  remote: RunResult;
}

// Pure, so it can be tested with made-up SSH results.
export function doctorChecks({ device, localRsync, configFile, remote }: DoctorInput): Check[] {
  const target = sshTarget(device);
  const checks: Check[] = [
    localRsync
      ? { name: "rsync on this machine", ok: true }
      : { name: "rsync on this machine", ok: false, fix: "Install rsync here (macOS ships one; on Arch, `sudo pacman -S rsync`)." },
  ];
  if (!configFile) {
    checks.push({
      name: "personal config file",
      ok: false,
      fix: `Set devices.${device.name}.configFile in mom.json, or pass --config FILE to mom deploy. See docs/setup/06-config.md.`,
    });
  } else if (!existsSync(expandHome(configFile))) {
    checks.push({ name: "personal config file", ok: false, detail: `${configFile} doesn't exist`, fix: "Write it from config/example.jsonc. See docs/setup/06-config.md." });
  } else {
    checks.push({ name: "personal config file", ok: true, detail: configFile });
  }

  if (remote.code !== 0) {
    checks.push({
      name: `SSH to ${target}`,
      ok: false,
      detail: sshFailureMessage(device, remote.stderr),
      fix: `Check that the laptop is on and that host "${device.host}" in mom.json is right. Copy your key with \`ssh-copy-id ${target}\`, then try \`ssh ${target}\`.`,
    });
    checks.push({ name: "rsync on the laptop", ok: null, detail: "skipped: no SSH" });
    checks.push({ name: `passwordless sudo for ${device.adminUser}`, ok: null, detail: "skipped: no SSH" });
    return checks;
  }
  checks.push({ name: `SSH to ${target}`, ok: true });
  const kv = parseKv(remote.stdout);
  checks.push(
    kv.rsync === "ok"
      ? { name: "rsync on the laptop", ok: true }
      : { name: "rsync on the laptop", ok: false, fix: "mom ssh sudo pacman -S --needed rsync" },
  );
  checks.push(
    kv.sudo === "ok"
      ? { name: `passwordless sudo for ${device.adminUser}`, ok: true }
      : {
          name: `passwordless sudo for ${device.adminUser}`,
          ok: false,
          fix: `On the laptop, as ${device.adminUser}: echo '${device.adminUser} ALL=(ALL) NOPASSWD: ALL' | sudo tee /etc/sudoers.d/${device.adminUser} && sudo chmod 440 /etc/sudoers.d/${device.adminUser}`,
        },
  );
  return checks;
}

export async function doctor(device: ResolvedDevice, configFile: string | null): Promise<Check[]> {
  const remote = await sshCapture(device, REMOTE_CHECK_SCRIPT, { connectTimeout: 10 });
  return doctorChecks({ device, localRsync: Bun.which("rsync") !== null, configFile, remote });
}

export function doctorText(checks: Check[]): string {
  const lines: string[] = [];
  for (const c of checks) {
    const mark = c.ok === true ? "ok   " : c.ok === false ? "FAIL " : "skip ";
    lines.push(`${mark} ${c.name}${c.detail ? `: ${c.detail}` : ""}`);
    if (c.ok === false && c.fix) lines.push(`      fix: ${c.fix}`);
  }
  const failed = checks.filter((c) => c.ok === false).length;
  lines.push(failed ? `${failed} problem${failed === 1 ? "" : "s"} to fix before \`mom deploy\`.` : "Ready for `mom deploy`.");
  return lines.join("\n");
}
