import { Hardware } from "@momos/shared";
import type { ResolvedDevice } from "./config";
import { runMomctl } from "./momctl";
import { readJsonc } from "./provision";
import { shellQuote, sshCapture, sshCloseMaster, sshInteractive } from "./ssh";

// `mom update`, following PLAN.md "Updates and recovery":
//   1. Omarchy's own update takes a snapper snapshot first.
//   2. Run the update unattended.
//   3. Check the DKMS modules in local.hardware.dkmsModules (wl and facetimehd
//      on the MacBook Air) exist for the kernel that will boot.
//   4. Reboot only if they do, then wait and confirm the drivers, the shell
//      and momctl came back.

// What each known module does, for the problems list.
const MODULE_ROLE: Record<string, string> = { wl: "Wi-Fi", facetimehd: "camera" };
const moduleLabel = (m: string) => (MODULE_ROLE[m] ? `${m} (${MODULE_ROLE[m]})` : m);

// The DKMS modules to check, from the device's config file in mom.json. A
// laptop with no configFile or no hardware block has none.
export function dkmsModulesFor(device: Pick<ResolvedDevice, "configFile">): string[] {
  if (!device.configFile) return [];
  const raw = readJsonc(device.configFile) as { local?: { hardware?: unknown } } | null;
  const parsed = Hardware.nullish().safeParse(raw?.local?.hardware);
  if (!parsed.success) throw new Error(`local.hardware in ${device.configFile} is invalid: ${parsed.error.issues[0]?.message}`);
  return parsed.data?.dkmsModules ?? [];
}

// The kernel that boots next: the newest pacman-owned kernel image.
export function kernelCheckScript(modules: string[]): string {
  return `
running=$(uname -r)
target=""
for k in $(ls -1t /usr/lib/modules/*/vmlinuz 2>/dev/null); do
  if pacman -Qo "$k" >/dev/null 2>&1; then target=$(basename "$(dirname "$k")"); break; fi
done
[ -n "$target" ] || target=$running
echo "running=$running"
echo "target=$target"
for m in ${modules.map(shellQuote).join(" ")}; do
  if modinfo -k "$target" -n "$m" >/dev/null 2>&1; then echo "module_$m=ok"; else echo "module_$m=missing"; fi
done
if [ -f "$HOME/.local/state/omarchy/reboot-required" ]; then echo "reboot_flag=1"; else echo "reboot_flag=0"; fi
echo "dkms=$(dkms status -k "$target" 2>/dev/null | tr '\\n' ';')"
`.trim();
}

export function healthCheckScript(person: string, modules: string[]): string {
  const lines = [`echo "kernel=$(uname -r)"`];
  for (const m of modules) {
    const q = shellQuote(m);
    lines.push(`if lsmod | grep -qw "^${m}"; then echo ${q}=loaded; else echo ${q}=missing; fi`);
  }
  if (modules.includes("facetimehd")) lines.push(`if ls /dev/video* >/dev/null 2>&1; then echo "camera=present"; else echo "camera=missing"; fi`);
  lines.push(
    `if pgrep -u ${person} -f 'qs -c momos|quickshell.*momos' >/dev/null 2>&1; then echo "shell=running"; else echo "shell=missing"; fi`,
    `if nmcli -t -f STATE general 2>/dev/null | grep -q '^connected'; then echo "network=connected"; else echo "network=down"; fi`,
  );
  return lines.join("\n");
}

export function parseKv(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split("\n")) {
    const i = line.indexOf("=");
    if (i > 0) out[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return out;
}

export interface KernelState {
  running: string;
  target: string;
  // Module name to whether it exists for the target kernel.
  modules: Record<string, boolean>;
  rebootFlag: boolean;
  dkms: string;
}

export function kernelState(kv: Record<string, string>, modules: string[]): KernelState {
  return {
    running: kv.running ?? "",
    target: kv.target ?? kv.running ?? "",
    modules: Object.fromEntries(modules.map((m) => [m, kv[`module_${m}`] === "ok"])),
    rebootFlag: kv.reboot_flag === "1",
    dkms: kv.dkms ?? "",
  };
}

export function needsReboot(k: KernelState): boolean {
  return k.target !== k.running || k.rebootFlag;
}

export const missingModules = (k: KernelState) => Object.keys(k.modules).filter((m) => !k.modules[m]);

async function kernelCheck(device: ResolvedDevice, modules: string[]): Promise<KernelState> {
  const r = await sshCapture(device, kernelCheckScript(modules));
  if (r.code !== 0) throw new Error(`kernel check failed: ${r.stderr.trim()}`);
  return kernelState(parseKv(r.stdout), modules);
}

// Problems in the health check after the update, for the given modules.
export function healthProblems(health: Record<string, string>, modules: string[]): string[] {
  const problems: string[] = [];
  for (const m of modules) {
    if (m === "facetimehd") {
      if (health.facetimehd !== "loaded" || health.camera !== "present") problems.push("camera driver or device missing");
    } else if (m === "wl") {
      if (health.wl !== "loaded") problems.push("Wi-Fi driver (wl) isn't loaded");
    } else if (health[m] !== "loaded") {
      problems.push(`${m} driver isn't loaded`);
    }
  }
  if (health.shell !== "running") problems.push("the MomOS shell isn't running");
  return problems;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface UpdateOptions {
  reboot: boolean;
  log: (s: string) => void;
}

export interface UpdateReport {
  ok: boolean;
  kernelBefore: string;
  kernelAfter: string | null;
  rebooted: boolean;
  modules: KernelState["modules"];
  health: Record<string, string> | null;
  momctlHealthy: boolean | null;
  problems: string[];
}

export async function update(device: ResolvedDevice, o: UpdateOptions): Promise<UpdateReport> {
  const log = o.log;
  const problems: string[] = [];
  const modules = dkmsModulesFor(device);
  const before = await kernelCheck(device, modules);
  log(`${device.name} runs kernel ${before.running}. Starting the update.`);

  // -y makes omarchy update unattended and skips its own reboot prompt.
  const code = await sshInteractive(device, "omarchy update -y </dev/null", { tty: false });
  if (code !== 0) {
    problems.push(`omarchy update exited with ${code}`);
    return { ok: false, kernelBefore: before.running, kernelAfter: null, rebooted: false, modules: before.modules, health: null, momctlHealthy: null, problems };
  }

  let k = await kernelCheck(device, modules);
  if (missingModules(k).length) {
    const list = modules.map((m) => `${m}: ${k.modules[m] ? "ok" : "missing"}`).join(", ");
    log(`Modules missing for ${k.target} (${list}). Trying dkms autoinstall.`);
    await sshInteractive(device, `sudo -n dkms autoinstall -k '${k.target.replace(/'/g, "")}'`, { tty: false });
    k = await kernelCheck(device, modules);
  }
  const missing = missingModules(k);
  if (missing.length) {
    for (const m of missing) problems.push(`${moduleLabel(m)} module missing for ${k.target}`);
    problems.push("Not rebooting. The running kernel still has working drivers. Fix DKMS, then run mom update again.");
    log(`dkms status: ${k.dkms || "(none)"}`);
    return { ok: false, kernelBefore: before.running, kernelAfter: null, rebooted: false, modules: k.modules, health: null, momctlHealthy: null, problems };
  }

  let rebooted = false;
  if (needsReboot(k) && o.reboot) {
    log(modules.length ? `Drivers are built for ${k.target}. Rebooting ${device.name}.` : `Rebooting ${device.name} into ${k.target}.`);
    await sshCapture(device, "sudo -n systemctl reboot");
    await sshCloseMaster(device);
    rebooted = true;
    // Wait for it to go down, then poll gently: the firewall rate-limits new
    // SSH connections, so one attempt every 20 s.
    await sleep(45_000);
    const deadline = Date.now() + 8 * 60_000;
    let up = false;
    while (Date.now() < deadline) {
      const r = await sshCapture(device, "true", { connectTimeout: 10 });
      if (r.code === 0) {
        up = true;
        break;
      }
      log("Still waiting for it to come back...");
      await sleep(20_000);
    }
    if (!up) {
      problems.push("The laptop didn't come back within 9 minutes. Pick the previous snapshot from the Limine boot menu if it doesn't boot.");
      return { ok: false, kernelBefore: before.running, kernelAfter: null, rebooted, modules: k.modules, health: null, momctlHealthy: null, problems };
    }
    // Give the session a moment to start the shell and momd.
    await sleep(30_000);
  } else if (needsReboot(k)) {
    log(`A reboot is needed for ${k.target}, but --no-reboot was given.`);
  } else {
    log("No reboot needed.");
  }

  const hr = await sshCapture(device, healthCheckScript(device.user, modules));
  const health = parseKv(hr.stdout);
  if (rebooted && health.kernel !== k.target) problems.push(`booted ${health.kernel}, expected ${k.target}`);
  problems.push(...healthProblems(health, modules));

  let momctlHealthy: boolean | null = null;
  try {
    const m = await runMomctl(device, ["health"]);
    momctlHealthy = m.code === 0;
    if (!momctlHealthy) problems.push("momctl health failed");
  } catch (e) {
    momctlHealthy = false;
    problems.push(`momctl health: ${(e as Error).message}`);
  }

  return {
    ok: problems.length === 0,
    kernelBefore: before.running,
    kernelAfter: health.kernel ?? null,
    rebooted,
    modules: k.modules,
    health,
    momctlHealthy,
    problems,
  };
}
