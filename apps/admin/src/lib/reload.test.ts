import { describe, expect, test } from "bun:test";
import { lastReload, RELOAD_MAX_AGE_MS, RELOAD_SHOWN_MS, RELOAD_SLOW_MS, reloadableTiles, reloadStatus } from "./reload";

const tiles = [
  { id: "family", label: "Family", type: "page", page: "family" },
  { id: "telegram", label: "Telegram", type: "app", app: "telegram" },
  { id: "youtube", label: "YouTube", type: "webapp", url: "https://www.youtube.com" },
  { id: "internet", label: "Browser", type: "app", app: "chromium" },
];

const action = (over: Partial<Parameters<typeof reloadStatus>[0] & object> = {}) => ({
  _id: "a",
  action: { type: "reload", tileId: "youtube" },
  status: "pending" as const,
  createdAt: 0,
  ...over,
});

describe("reload buttons", () => {
  test("only web pages get one", () => {
    expect(reloadableTiles(tiles).map((t) => t.id)).toEqual(["youtube", "internet"]);
  });

  test("the newest recent reload of that tile counts", () => {
    const list = [
      action({ _id: "old", createdAt: 1000 }),
      action({ _id: "new", createdAt: 2000 }),
      action({ _id: "other", createdAt: 3000, action: { type: "reload", tileId: "internet" } }),
      action({ _id: "open", createdAt: 4000, action: { type: "open", tileId: "youtube" } }),
    ];
    expect(lastReload(list, "youtube", 5000)?._id).toBe("new");
    expect(lastReload(list, "youtube", 2000 + RELOAD_SHOWN_MS)).toBeNull();
    expect(lastReload(list, "photos", 5000)).toBeNull();
  });

  test("what it says", () => {
    expect(reloadStatus(null, 0)).toBeNull();
    expect(reloadStatus(action(), 1000)).toEqual({ text: "Waiting for the laptop...", tone: "amber" });
    expect(reloadStatus(action(), RELOAD_SLOW_MS + 1)?.text).toContain("hasn't picked it up");
    expect(reloadStatus(action(), RELOAD_MAX_AGE_MS + 1)?.tone).toBe("red");
    expect(reloadStatus(action({ status: "done", result: "reloaded YouTube" }), 0)).toEqual({ text: "Reloaded", tone: "green" });
    expect(reloadStatus(action({ status: "done", result: "YouTube wasn't open, so it was opened" }), 0)?.text).toBe("It wasn't open, so it opened fresh");
    expect(reloadStatus(action({ status: "failed", result: "the screen is locked" }), 0)).toEqual({ text: "Didn't reload: the screen is locked", tone: "red" });
  });
});
