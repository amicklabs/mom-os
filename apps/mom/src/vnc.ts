import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ResolvedDevice } from "./config";

export interface VncLaunch {
  viewer: string;
  argv: string[];
}

// Where TigerVNC's viewer lands on macOS: the Homebrew formula puts
// `vncviewer` in the Homebrew bin directory, and the tigervnc-viewer cask
// installs an app named like "TigerVNC Viewer 1.15.0.app".
const MAC_BIN_DIRS = ["/opt/homebrew/bin", "/usr/local/bin"];
const macAppDirs = (home = homedir()) => ["/Applications", join(home, "Applications")];

// The TigerVNC app's executable on macOS, or null.
export function findTigerVncApp(dirs = macAppDirs()): string | null {
  for (const dir of dirs) {
    let apps: string[];
    try {
      apps = readdirSync(dir).filter((f) => /^TigerVNC.*\.app$/i.test(f)).sort().reverse();
    } catch {
      continue;
    }
    for (const app of apps) {
      const macos = join(dir, app, "Contents", "MacOS");
      try {
        const exe = readdirSync(macos).find((f) => !f.startsWith("."));
        if (exe) return join(macos, exe);
      } catch {
        // not a complete app bundle
      }
    }
  }
  return null;
}

// Screen Sharing on macOS can't connect: wayvnc only offers RSA-AES
// authentication, which it doesn't speak. So on a Mac only TigerVNC will do.
export const MAC_NO_VIEWER =
  "No TigerVNC viewer found. macOS Screen Sharing can't connect to the laptop, because wayvnc only allows RSA-AES encryption. Install TigerVNC with `brew install --cask tigervnc-viewer` and run `mom vnc` again.";
export const LINUX_NO_VIEWER = "No VNC viewer found. Install one (TigerVNC: `omarchy pkg add tigervnc`, or remmina) and try again.";

export function noViewerMessage(platform: NodeJS.Platform = process.platform): string {
  return platform === "darwin" ? MAC_NO_VIEWER : LINUX_NO_VIEWER;
}

// Picks a VNC viewer for this machine. `which`, `exists` and `findApp` are
// injectable for tests.
export function vncCommand(
  device: ResolvedDevice,
  platform: NodeJS.Platform = process.platform,
  which: (bin: string) => string | null = (b) => Bun.which(b),
  mac: { exists?: (path: string) => boolean; findApp?: () => string | null } = {},
): VncLaunch | null {
  const host = device.vncHost ?? device.host;
  const port = device.vncPort ?? 5900;
  const url = `vnc://${host}:${port}`;
  // TigerVNC takes host::port for a raw port number.
  const tiger = `${host}::${port}`;

  if (platform === "darwin") {
    const exists = mac.exists ?? existsSync;
    const onPath = which("vncviewer");
    if (onPath) return { viewer: "TigerVNC", argv: [onPath, tiger] };
    for (const dir of MAC_BIN_DIRS) {
      const bin = join(dir, "vncviewer");
      if (exists(bin)) return { viewer: "TigerVNC", argv: [bin, tiger] };
    }
    const app = (mac.findApp ?? findTigerVncApp)();
    return app ? { viewer: "TigerVNC", argv: [app, tiger] } : null;
  }

  const candidates: VncLaunch[] = [
    { viewer: "vncviewer", argv: ["vncviewer", tiger] },
    { viewer: "remmina", argv: ["remmina", "-c", url] },
    { viewer: "wlvncc", argv: ["wlvncc", host, String(port)] },
    { viewer: "krdc", argv: ["krdc", url] },
    { viewer: "vinagre", argv: ["vinagre", tiger] },
  ];
  for (const c of candidates) {
    const bin = c.argv[0]!;
    if (which(bin)) return c;
  }
  return null;
}

export function launchDetached(argv: string[]): void {
  // setsid keeps the viewer open after the terminal that started it closes.
  const full = process.platform === "linux" && Bun.which("setsid") ? ["setsid", "-f", ...argv] : argv;
  const proc = Bun.spawn(full, { stdin: "ignore", stdout: "ignore", stderr: "ignore" });
  proc.unref();
}
