import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NOTICE_SCRIPT, UPDATING_FILE, noticeCommand, withUpdatingNotice, type NoticeOp } from "./notice";

function runScript(home: string, ...args: string[]) {
  return Bun.spawnSync(["sh", "-c", NOTICE_SCRIPT, "momos-notice", ...args], { env: { HOME: home, PATH: process.env.PATH ?? "/usr/bin:/bin" } });
}

function recorder(result = true) {
  const ops: string[] = [];
  return {
    ops,
    write: async (o: NoticeOp) => {
      ops.push(o.op);
      return result;
    },
  };
}
const quiet = () => {};

describe("the marker script", () => {
  test("writes the marker with the laptop's clock, and clears it", () => {
    const home = mkdtempSync(join(tmpdir(), "mom-notice-"));
    const file = join(home, UPDATING_FILE);
    const before = Date.now();
    expect(runScript(home, "updating", "900").exitCode).toBe(0);
    const m = JSON.parse(readFileSync(file, "utf8"));
    expect(m.version).toBe(1);
    expect(m.state).toBe("updating");
    expect(m.at).toBeGreaterThanOrEqual(before - 1000);
    expect(m.at).toBeLessThanOrEqual(Date.now() + 1000);
    expect(m.expiresAt - m.at).toBe(900_000);
    expect(existsSync(`${file}.tmp`)).toBe(false);

    expect(runScript(home, "done", "8").exitCode).toBe(0);
    expect(JSON.parse(readFileSync(file, "utf8")).state).toBe("done");

    expect(runScript(home, "clear").exitCode).toBe(0);
    expect(existsSync(file)).toBe(false);
    // Clearing twice is fine.
    expect(runScript(home, "clear").exitCode).toBe(0);
  });

  test("runs as the person", () => {
    const cmd = noticeCommand("mom", { op: "updating", seconds: 900 });
    expect(cmd.startsWith("sudo -n -u mom -H -- sh -c ")).toBe(true);
    expect(cmd.endsWith(" momos-notice updating 900")).toBe(true);
    expect(noticeCommand("mom", { op: "clear" }).endsWith(" momos-notice clear")).toBe(true);
  });
});

describe("withUpdatingNotice", () => {
  test("success says done; failure, exceptions and done: false clear", async () => {
    const a = recorder();
    expect(await withUpdatingNotice({ write: a.write, log: quiet, ok: (c: number) => c === 0, signals: [] }, async () => 0)).toBe(0);
    expect(a.ops).toEqual(["updating", "done"]);

    const b = recorder();
    await withUpdatingNotice({ write: b.write, log: quiet, ok: (c: number) => c === 0, signals: [] }, async () => 3);
    expect(b.ops).toEqual(["updating", "clear"]);

    const c = recorder();
    const boom = withUpdatingNotice({ write: c.write, log: quiet, ok: () => true, signals: [] }, async () => {
      throw new Error("boom");
    });
    await expect(boom).rejects.toThrow("boom");
    expect(c.ops).toEqual(["updating", "clear"]);

    const d = recorder();
    await withUpdatingNotice({ write: d.write, log: quiet, ok: () => true, done: false, signals: [] }, async () => 0);
    expect(d.ops).toEqual(["updating", "clear"]);
  });

  test("an unreachable laptop doesn't stop the command", async () => {
    const r = recorder(false);
    const logs: string[] = [];
    expect(await withUpdatingNotice({ write: r.write, log: (s) => logs.push(s), ok: () => true, signals: [] }, async () => "ran")).toBe("ran");
    expect(logs).toHaveLength(2);
  });

  test("the heartbeat renews it, and never after the end", async () => {
    const r = recorder();
    await withUpdatingNotice({ write: r.write, log: quiet, ok: () => true, heartbeatMs: 20, signals: [] }, () => Bun.sleep(75));
    const n = r.ops.length;
    expect(r.ops.filter((o) => o === "updating").length).toBeGreaterThanOrEqual(3);
    expect(r.ops[n - 1]).toBe("done");
    await Bun.sleep(60);
    expect(r.ops).toHaveLength(n);
  });

  test("a slow heartbeat can't land after the clear", async () => {
    const ops: string[] = [];
    const write = async (o: NoticeOp) => {
      // The heartbeat's write is slow; the final clear is quick.
      await Bun.sleep(o.op === "updating" && ops.length > 0 ? 40 : 0);
      ops.push(o.op);
      return true;
    };
    await withUpdatingNotice({ write, log: quiet, ok: () => false, heartbeatMs: 10, signals: [] }, () => Bun.sleep(15));
    expect(ops[ops.length - 1]).toBe("clear");
  });

  test("a signal clears it, then exits", async () => {
    const r = recorder();
    const seen = { code: -1 };
    let exited!: () => void;
    const gone = new Promise<void>((res) => (exited = res));
    const pending = withUpdatingNotice(
      {
        write: r.write,
        log: quiet,
        ok: () => true,
        signals: ["SIGUSR2"],
        exit: (c) => {
          seen.code = c;
          exited();
        },
      },
      () => Bun.sleep(150),
    );
    await Bun.sleep(20);
    process.emit("SIGUSR2", "SIGUSR2");
    await gone;
    expect(r.ops).toEqual(["updating", "clear"]);
    expect(seen.code).toBe(1);
    await pending;
    // The command finishing afterwards doesn't put anything back.
    expect(r.ops).toEqual(["updating", "clear"]);
  });
});
