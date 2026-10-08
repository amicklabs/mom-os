"use client";

import { api } from "@momos/backend/convex/_generated/api";
import type { Id } from "@momos/backend/convex/_generated/dataModel";
import { useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

export type DeviceSummary = FunctionReturnType<typeof api.admin.overview>[number];

type Ctx = {
  devices: DeviceSummary[] | undefined;
  device: DeviceSummary | null;
  select: (id: Id<"devices">) => void;
};

const DeviceContext = createContext<Ctx>({ devices: undefined, device: null, select: () => {} });
const KEY = "momos.selectedDevice";

export function DeviceProvider({ children }: { children: ReactNode }) {
  const devices = useQuery(api.admin.overview);
  const [selected, setSelected] = useState<string | null>(null);

  useEffect(() => {
    // Restore the last choice after mount, since localStorage isn't there during SSR.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSelected(window.localStorage.getItem(KEY));
  }, []);

  const live = devices?.filter((d) => d.revokedAt === null) ?? [];
  const device = live.find((d) => d._id === selected) ?? live[0] ?? null;

  function select(id: Id<"devices">) {
    window.localStorage.setItem(KEY, id);
    setSelected(id);
  }

  return <DeviceContext.Provider value={{ devices, device, select }}>{children}</DeviceContext.Provider>;
}

export function useDevices() {
  return useContext(DeviceContext);
}

export function displayName(d: DeviceSummary): string {
  return d.personName ? `${d.personName} (${d.name})` : d.name;
}
