import type { ConfigFile } from "@momos/shared";
import * as hypr from "./hypr";
import { tileIdForClass } from "./tiles";

export interface AppWindow {
  address: string;
  class: string;
  title: string;
  tileId: string | null;
  workspace: string;
  focused: boolean;
}

export async function apps(config: ConfigFile | null): Promise<AppWindow[]> {
  const [list, active] = await Promise.all([hypr.clients(), hypr.activeWindow().catch(() => null)]);
  return list
    .filter((c) => c.mapped !== false)
    .map((c) => ({
      address: c.address,
      class: c.class,
      title: c.title,
      tileId: config ? tileIdForClass(config.tiles, c.class) : null,
      workspace: c.workspace.name,
      focused: c.address === active?.address,
    }));
}
