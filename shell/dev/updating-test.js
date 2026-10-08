#!/usr/bin/env node
// Checks Common/updating.js, which decides whether the "updating" notice
// shows. Exits 1 on the first failure.
//
//   node shell/dev/updating-test.js

const fs = require("fs")
const path = require("path")
const assert = require("assert")

const source = fs.readFileSync(path.join(__dirname, "../Common/updating.js"), "utf8")
  .replace(/^\.pragma library\s*/, "")
const U = new Function(source + "\nreturn { parse, current, text }")()

const now = 1_800_000_000_000
const min = 60 * 1000
const marker = (state, at, expiresAt) => JSON.stringify({ version: 1, state, at, expiresAt })
const show = (text, t) => U.current(U.parse(text), t === undefined ? now : t)

const tests = {
  "a fresh marker shows"() {
    assert.strictEqual(show(marker("updating", now - min, now + 14 * min)), "updating")
    assert.strictEqual(show(marker("done", now, now + 8000)), "done")
  },
  "an expired marker shows nothing"() {
    assert.strictEqual(show(marker("updating", now - 15 * min, now)), "")
    assert.strictEqual(show(marker("done", now - 9000, now - 1000)), "")
  },
  "a marker that claims too long shows nothing"() {
    assert.strictEqual(show(marker("updating", now, now + 21 * min)), "")
    assert.strictEqual(show(marker("done", now, now + 2 * min)), "")
  },
  "a clock that went backwards shows nothing"() {
    // Written with the right time, read after the clock fell back to 2023.
    const written = marker("updating", now, now + 15 * min)
    assert.strictEqual(show(written, now - 3 * 365 * 24 * 60 * min), "")
  },
  "junk shows nothing"() {
    for (const t of ["", "{", "null", "[]", "{}", '{"state":"updating"}', marker("working", now, now + min),
      JSON.stringify({ state: "updating", at: "now", expiresAt: now + min })]) {
      assert.strictEqual(show(t), "", t)
    }
    assert.strictEqual(U.current(null, now), "")
  },
  "the words"() {
    assert.strictEqual(U.text("updating", "Sam"), "Sam is updating your computer. It will be back in a minute.")
    assert.strictEqual(U.text("done", "Sam"), "Done. Your computer is up to date.")
    assert.strictEqual(U.text("", "Sam"), "")
  },
}

let failed = 0
for (const [name, fn] of Object.entries(tests)) {
  try {
    fn()
    console.log("ok   " + name)
  } catch (e) {
    failed++
    console.log("FAIL " + name + "\n     " + e.message)
  }
}
process.exit(failed ? 1 : 0)
