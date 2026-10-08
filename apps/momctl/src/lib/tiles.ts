import { NATIVE_APPS, type Tile } from "@momos/shared";

// How to recognise and start the app behind a tile. Pure, so it can be tested
// without Hyprland.

export const HOME_WORKSPACE = "home";
export const tileWorkspace = (tileId: string) => `tile-${tileId}`;

const TELEGRAM_CLASS = NATIVE_APPS.telegram.windowClass.toLowerCase();

export interface TileTarget {
  // True if a window with this class belongs to the tile.
  matches: (windowClass: string) => boolean;
  // The program to start, or to hand a link to.
  command: string[];
  // Telegram chat tiles always hand the link over, even when Telegram is open,
  // so the right chat shows.
  alwaysLaunch: boolean;
}

export function webappClassPrefix(url: string): string {
  // Chromium names --app windows "chrome-<host>__<path>-Default".
  return `chrome-${new URL(url).host}__`.toLowerCase();
}

export function tileTarget(tile: Tile): TileTarget | null {
  switch (tile.type) {
    case "webapp": {
      const prefix = webappClassPrefix(tile.url);
      return {
        matches: (c) => c.toLowerCase().startsWith(prefix),
        command: ["chromium", `--app=${tile.url}`],
        alwaysLaunch: false,
      };
    }
    case "app": {
      const app = NATIVE_APPS[tile.app];
      const cls = app.windowClass.toLowerCase();
      return { matches: (c) => c.toLowerCase() === cls, command: [...app.exec], alwaysLaunch: false };
    }
    case "telegram-chat":
      return {
        matches: (c) => c.toLowerCase() === TELEGRAM_CLASS,
        command: [...NATIVE_APPS.telegram.exec, "--", `tg://resolve?domain=${tile.telegram}`],
        alwaysLaunch: true,
      };
    case "page":
      return null;
  }
}

// The tile a window belongs to, by class. Webapps first, since their classes
// are the most specific.
export function tileIdForClass(tiles: readonly Tile[], windowClass: string | null | undefined): string | null {
  if (!windowClass) return null;
  const order = [...tiles].sort((a, b) => rank(a) - rank(b));
  for (const t of order) {
    const target = tileTarget(t);
    if (target && target.matches(windowClass)) return t.id;
  }
  return null;
}

const rank = (t: Tile) => (t.type === "webapp" ? 0 : t.type === "app" ? 1 : 2);
