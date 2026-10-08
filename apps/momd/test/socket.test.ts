import { expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { momdRequest } from "@momos/momctl/client";
import { serveSocket } from "../src/socket";

test("socket round trip, errors included", async () => {
  process.env.XDG_RUNTIME_DIR = mkdtempSync(`${tmpdir()}/rt-`);
  void serveSocket(async (cmd, args) => {
    if (cmd === "echo") return { args };
    if (cmd === "slow") {
      await Bun.sleep(200);
      return { big: "x".repeat(200_000) };
    }
    throw new Error(`unknown command "${cmd}"`);
  });
  await Bun.sleep(100);
  expect(await momdRequest("echo", { a: 1 })).toEqual({ ok: true, data: { args: { a: 1 } } });
  const slow = await momdRequest("slow");
  expect(slow.ok && (slow.data as { big: string }).big.length).toBe(200_000);
  expect(await momdRequest("nope")).toEqual({ ok: false, error: 'unknown command "nope"' });
});
