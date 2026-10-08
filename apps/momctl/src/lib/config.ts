import { readFileSync } from "node:fs";
import { ConfigFile, paths } from "@momos/shared";

export function loadConfig(path = paths.config()): ConfigFile {
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch (e) {
    throw new Error(`can't read ${path}: ${(e as Error).message}`);
  }
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch (e) {
    throw new Error(`${path} is not valid JSON: ${(e as Error).message}`);
  }
  const parsed = ConfigFile.safeParse(json);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new Error(`${path} is invalid at ${issue?.path.join(".") || "(root)"}: ${issue?.message}`);
  }
  return parsed.data;
}

// The config, or null if it's missing or broken. For callers that can carry on
// without it.
export function tryLoadConfig(path = paths.config()): ConfigFile | null {
  try {
    return loadConfig(path);
  } catch {
    return null;
  }
}
