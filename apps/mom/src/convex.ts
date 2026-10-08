import { ConvexHttpClient } from "convex/browser";
import { makeFunctionReference } from "convex/server";
import { ConfigError, readDispatcherToken, type MomConfig } from "./config";

// Read-only views of Convex through the dispatcher token. The backend is
// addressed by function name (docs/contracts.md) so mom doesn't depend on its
// generated types.

export async function dispatcherOverview(config: MomConfig): Promise<Record<string, unknown>> {
  const url = process.env.MOMOS_CONVEX_URL ?? config.convexUrl;
  if (!url) throw new ConfigError("No convexUrl in mom.json.");
  const token = readDispatcherToken(config);
  const client = new ConvexHttpClient(url);
  const data = await client.query(makeFunctionReference<"query">("dispatcher:overview"), { dispatcherToken: token });
  return (data ?? {}) as Record<string, unknown>;
}

export function listFrom(overview: Record<string, unknown>, ...keys: string[]): unknown[] {
  for (const k of keys) {
    const v = overview[k];
    if (Array.isArray(v)) return v;
  }
  return [];
}
