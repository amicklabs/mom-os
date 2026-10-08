import { expect, test } from "bun:test";
import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { Core } from "../src/core";
import { viewerMonitor } from "../src/monitors";
import { EventQueue } from "../src/queue";

const newCore = () => new Core(new EventQueue(`${mkdtempSync(`${tmpdir()}/c-`)}/q.sqlite`), "test");

test("the viewer monitor reconnects after wayvnc restarts", async () => {
  // A fake wayvncctl: refuses the first client-list, then answers, and its
  // event stream reports one viewer before ending, as when wayvnc restarts.
  const dir = mkdtempSync(`${tmpdir()}/wv-`);
  const script = `#!/bin/sh
n=$(cat ${dir}/n 2>/dev/null || echo 0); echo $((n+1)) > ${dir}/n
case "$2" in
  client-list) if [ "$n" = 0 ]; then echo "Connection refused" >&2; exit 1; fi; echo "[]" ;;
  event-receive) echo '{"method":"client-connected","params":{"connection_count":1}}' ;;
esac
`;
  writeFileSync(`${dir}/wayvncctl`, script);
  chmodSync(`${dir}/wayvncctl`, 0o755);
  const oldPath = process.env.PATH;
  process.env.PATH = `${dir}:${oldPath}`;
  const core = newCore();
  const seen: boolean[] = [];
  core.onChange(() => seen.push(core.model.viewer.connected));
  const waits: number[] = [];
  try {
    await viewerMonitor(core, async (ms) => {
      waits.push(ms);
      if (waits.length >= 3) throw new Error("stop");
    }).catch((e: Error) => {
      if (e.message !== "stop") throw e;
    });
  } finally {
    process.env.PATH = oldPath;
  }
  // Refused: wait a minute. Answered, one viewer, stream ended: a short wait.
  // Then it answers again.
  expect(waits[0]).toBe(60_000);
  expect(waits[1]).toBeLessThan(60_000);
  expect(seen).toContain(true);
  expect(core.model.viewer.connected).toBe(false);
});
