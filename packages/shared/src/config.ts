import { z } from "zod";

// The person's settings: names, tiles and family. The shell reads these from
// ~/.config/momos/config.json. momd rewrites that file when Convex settings
// change, so the shell keeps working from the last good copy when momd or the
// network is down.

export const Id = z.string().regex(/^[a-z0-9][a-z0-9-]{0,39}$/);

// Native apps a tile may open. Anything else is rejected, so a settings change
// can never make the laptop run an arbitrary program.
export const NATIVE_APPS = {
  telegram: { exec: ["Telegram"], windowClass: "org.telegram.desktop" },
  chromium: { exec: ["chromium"], windowClass: "chromium" },
} as const;
export type NativeApp = keyof typeof NATIVE_APPS;
export const NativeAppId = z.enum(Object.keys(NATIVE_APPS) as [NativeApp, ...NativeApp[]]);

const HttpsUrl = z.url({ protocol: /^https$/ });
const TelegramUsername = z.string().regex(/^[A-Za-z0-9_]{5,32}$/);

const TileBase = z.object({
  id: Id,
  label: z.string().min(1).max(24),
  // A built-in icon name, or an SVG in icons/ next to config.json
  // (docs/contracts.md), or null for a text-only tile.
  icon: z.string().max(40).nullish(),
});

export const Tile = z.discriminatedUnion("type", [
  TileBase.extend({ type: z.literal("webapp"), url: HttpsUrl }),
  TileBase.extend({ type: z.literal("app"), app: NativeAppId }),
  TileBase.extend({ type: z.literal("telegram-chat"), telegram: TelegramUsername }),
  TileBase.extend({ type: z.literal("page"), page: Id }),
]);
export type Tile = z.infer<typeof Tile>;

// Tiles whose window is a web page, so F5 reloads it: web apps and the
// Browser. Telegram, chats and pages have nothing to reload.
export function isReloadable(tile: { type: string; app?: unknown }): boolean {
  return tile.type === "webapp" || (tile.type === "app" && tile.app === "chromium");
}

export const FamilyMember = z.object({
  id: Id,
  name: z.string().min(1).max(32),
  // File name under ~/.config/momos/photos/, or null to show initials.
  photo: z.string().regex(/^[A-Za-z0-9._-]+\.(jpg|jpeg|png|webp)$/).nullish(),
  telegram: TelegramUsername,
});
export type FamilyMember = z.infer<typeof FamilyMember>;

export const Settings = z.object({
  person: z.object({
    name: z.string().min(1).max(32), // "Mom"
    user: z.string().regex(/^[a-z_][a-z0-9_-]{0,31}$/), // "mom"
    // Her own phone number and Telegram username, for the Call her button
    // under a help request on Telegram. Optional; the laptop doesn't use them.
    phone: z.string().max(32).nullish(),
    telegram: TelegramUsername.nullish(),
  }),
  helper: z.object({
    name: z.string().min(1).max(32), // "Sam"
    phone: z.string().max(32), // shown in large type when offline
    // Their Telegram username, for "Message Sam on Telegram" in the Help
    // pop-up. Without it the pop-up leaves that link out.
    telegram: TelegramUsername.nullish(),
    // Send an agent to investigate on its own whenever she writes or records
    // a voice note in the Help pop-up. Off unless set: the helper sends one.
    autoInvestigate: z.boolean().nullish(),
  }),
  tiles: z.array(Tile).max(12),
  family: z.array(FamilyMember).max(24),
});
export type Settings = z.infer<typeof Settings>;

// What this laptop's hardware needs. Local only: install.sh copies it from the
// deploy config into config.json, and momd keeps it when Convex settings change.
export const LidMode = z.enum(["normal", "flaky-macbook", "ignore"]);
export type LidMode = z.infer<typeof LidMode>;

export const Hardware = z.object({
  // Kernel modules built by DKMS that must exist for the kernel that boots,
  // like "wl" (Broadcom Wi-Fi) or "facetimehd" (the MacBook camera). `mom
  // update` won't reboot without them, and `momctl health` reports them.
  dkmsModules: z.array(z.string().regex(/^[A-Za-z0-9_-]{1,40}$/)).max(16).optional(),
  // "normal": logind handles the lid and momd leaves it alone.
  // "flaky-macbook": a lid switch that flickers. momd averages the switch and
  // the light sensor, and install.sh checks the MACHINE-NOTES workarounds.
  // "ignore": nothing in MomOS handles the lid.
  lid: LidMode.optional(),
});
export type Hardware = z.infer<typeof Hardware>;

type WithHardware = { local?: { hardware?: Hardware | null } | null } | null | undefined;

export function dkmsModules(config: WithHardware): string[] {
  return config?.local?.hardware?.dkmsModules ?? [];
}

export function lidMode(config: WithHardware): LidMode {
  return config?.local?.hardware?.lid ?? "normal";
}

// Local-only settings that never come from Convex.
export const LocalConfig = z.object({
  convexUrl: z.url().nullish(),
  // Path to a file holding the device token. Kept out of config.json so the
  // shell never reads it.
  deviceTokenFile: z.string().nullish(),
  hardware: Hardware.nullish(),
});
export type LocalConfig = z.infer<typeof LocalConfig>;

export const ConfigFile = Settings.extend({ local: LocalConfig.optional() });
export type ConfigFile = z.infer<typeof ConfigFile>;
