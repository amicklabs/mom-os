#!/usr/bin/env bun
// Stands in for `claude` in tests. Records its argv and env, then acts out
// FAKE_CLAUDE_MODE.
import { appendFileSync } from "node:fs";

const argv = process.argv.slice(2);
if (process.env.FAKE_CLAUDE_LOG) {
  appendFileSync(process.env.FAKE_CLAUDE_LOG, JSON.stringify({ argv, cwd: process.cwd(), momDevice: process.env.MOM_DEVICE ?? null }) + "\n");
}
const flag = (name: string) => {
  const i = argv.indexOf(name);
  return i === -1 ? null : argv[i + 1] ?? null;
};
const sessionId = flag("--session-id") ?? flag("--resume") ?? "none";
const result = (text: string, isError = false) =>
  JSON.stringify({ type: "result", subtype: isError ? "error_during_execution" : "success", is_error: isError, result: text, session_id: sessionId, num_turns: 3, total_cost_usd: 0.12 });

switch (process.env.FAKE_CLAUDE_MODE) {
  case "fix-yes":
    console.log(result("**What she sees.** YouTube is frozen.\n**Likely cause.** Chromium hung.\n**Proposed fix.** mom restart shell\n\nFIX NEEDED: yes"));
    break;
  case "fix-yes-message":
    console.log(result("**Likely cause.** Signed out of YouTube.\n\nMESSAGE FOR Mom: I can see YouTube signed you out. I'll fix it soon.\n\nFIX NEEDED: yes"));
    break;
  case "fix-no":
    console.log(result("Everything looks fine.\n\nFIX NEEDED: no"));
    break;
  case "fixed":
    console.log(result("Restarted the shell. YouTube is back."));
    break;
  case "error":
    console.log(result("Hit max turns", true));
    process.exit(1);
  case "garbage":
    console.error("something broke");
    process.exit(2);
  case "sleep":
    await Bun.sleep(60_000);
    break;
  default:
    console.log(result("ok"));
}
