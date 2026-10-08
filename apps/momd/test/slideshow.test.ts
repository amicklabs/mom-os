import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { Core } from "../src/core";
import { EventQueue } from "../src/queue";
import { bootNeedsPassphrase, restart, RESTART_MAX_AGE_MS } from "../src/runner";
import { planSync, SlideshowSync } from "../src/slideshow";

const photo = (name: string) => ({ id: name, fileName: `${name}.jpg`, url: `https://x.convex.cloud/${name}` });

describe("slideshow sync plan", () => {
  test("downloads what's missing and removes what's gone", () => {
    const plan = planSync([photo("a"), photo("b"), photo("c")], ["a.jpg", "old.jpg", "c.jpg"]);
    expect(plan.download.map((p) => p.fileName)).toEqual(["b.jpg"]);
    expect(plan.remove).toEqual(["old.jpg"]);
  });

  test("leaves temp files and odd names alone, and ignores bad or repeated remote names", () => {
    const remote = [photo("a"), photo("a"), { id: "x", fileName: "../evil.jpg", url: "https://x/y" }];
    const plan = planSync(remote, ["a.jpg.tmp", ".index.json", "notes.txt", "b.jpg"]);
    expect(plan.download.map((p) => p.fileName)).toEqual(["a.jpg"]);
    expect(plan.remove).toEqual(["b.jpg"]);
  });

  test("an empty list clears the folder", () => {
    expect(planSync([], ["a.jpg", "b.jpg"])).toEqual({ download: [], remove: ["a.jpg", "b.jpg"] });
  });
});

describe("SlideshowSync", () => {
  test("makes the folder match, and a failed download is retried by the next list", async () => {
    const dir = `${mkdtempSync(`${tmpdir()}/ss-`)}/slideshow`;
    mkdirSync(dir);
    writeFileSync(`${dir}/gone.jpg`, "x");
    const fetched: string[] = [];
    let fail = true;
    const sync = new SlideshowSync(
      () => dir,
      async (url) => {
        fetched.push(url);
        if (url.endsWith("/b") && fail) throw new Error("HTTP 500");
        return new TextEncoder().encode(url);
      },
      0,
    );
    await sync.sync([photo("a"), photo("b")]);
    expect(readdirSync(dir).sort()).toEqual(["a.jpg"]);
    expect(readFileSync(`${dir}/a.jpg`, "utf8")).toBe("https://x.convex.cloud/a");
    fail = false;
    await sync.sync([photo("a"), photo("b")]);
    expect(readdirSync(dir).sort()).toEqual(["a.jpg", "b.jpg"]);
    expect(fetched.filter((u) => u.endsWith("/a"))).toHaveLength(1);
  });
});

describe("restart action", () => {
  function core() {
    const root = mkdtempSync(`${tmpdir()}/rs-`);
    process.env.XDG_CONFIG_HOME = `${root}/config`;
    return new Core(new EventQueue(`${root}/q.sqlite`), "test");
  }

  test("shows the banner, then reboots once", async () => {
    const c = core();
    let reboots = 0;
    const reboot = async () => void reboots++;
    const r = restart(c, "act1", Date.now() - 1000, { reboot, delayMs: 20, cmdline: "" });
    expect(r.ok).toBe(true);
    expect(c.model.banner?.text).toBe("Your helper is restarting the computer. It will be back in a minute.");
    expect(reboots).toBe(0);
    await Bun.sleep(50);
    expect(reboots).toBe(1);
    // The same action offered again after the reboot is just reported done.
    expect(restart(c, "act1", Date.now(), { reboot, delayMs: 20, cmdline: "" })).toEqual({ ok: true, result: "restarted" });
    await Bun.sleep(50);
    expect(reboots).toBe(1);
  });

  test("refuses one that waited too long", () => {
    const c = core();
    const r = restart(c, "old", 1000, { reboot: async () => {}, now: 1000 + RESTART_MAX_AGE_MS + 1, cmdline: "" });
    expect(r.ok).toBe(false);
    expect(c.model.banner).toBeNull();
  });

  test("takes the banner down if the reboot fails", async () => {
    const c = core();
    restart(c, "act2", null, { reboot: async () => Promise.reject(new Error("denied")), delayMs: 10, cmdline: "" });
    expect(c.model.banner).not.toBeNull();
    await Bun.sleep(40);
    expect(c.model.banner).toBeNull();
  });
});

describe("restart and the disk passphrase", () => {
  test("encrypted disk without a keyfile needs the passphrase", () => {
    expect(bootNeedsPassphrase("cryptdevice=PARTUUID=x:root root=/dev/mapper/root")).toBe(true);
    expect(bootNeedsPassphrase("cryptdevice=PARTUUID=x:root cryptkey=rootfs:/crypto_keyfile.bin")).toBe(false);
    expect(bootNeedsPassphrase("root=/dev/sda2 rw")).toBe(false);
  });
});
