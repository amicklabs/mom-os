#!/usr/bin/env node
// Checks the notification queue in Common/notify.js: message cards stay,
// other cards count down only while on screen, the cap drops the right card.
// Exits 1 on the first failure.
//
//   node shell/dev/notify-test.js

const fs = require("fs")
const path = require("path")
const assert = require("assert")

const source = fs.readFileSync(path.join(__dirname, "../Common/notify.js"), "utf8")
  .replace(/^\.pragma library\s*/, "")
const N = new Function(source + "\nreturn { isMessage, add, tick, title, waiting, LIFETIME_MS, MAX_CARDS }")()

let key = 1
const card = (summary, message, app) => ({
  key: key++, created: key, summary, body: "hi " + summary, app: app || (message ? "Telegram Desktop" : "Chromium"), message, count: 1,
})

const tests = {
  "Telegram and chat categories are messages"() {
    assert.ok(N.isMessage({ appName: "Telegram Desktop" }))
    assert.ok(N.isMessage({ appName: "", desktopEntry: "org.telegram.desktop" }))
    assert.ok(N.isMessage({ appName: "Chromium", category: "im.received" }))
    assert.ok(N.isMessage({ appName: "Chromium", category: "email.arrived" }))
    assert.ok(N.isMessage({ appName: "x", urgency: 2 }))
    assert.ok(!N.isMessage({ appName: "Chromium", category: "transfer.complete", urgency: 1 }))
  },

  "messages from one chat join one card"() {
    let cards = []
    const a = card("Grace", true)
    cards = N.add(cards, a).cards
    const b = card("Bob", true)
    cards = N.add(cards, b).cards
    const a2 = card("Grace", true)
    const r = N.add(cards, a2)
    assert.strictEqual(r.into, a.key)
    assert.deepStrictEqual(r.cards.map((c) => c.summary), ["Grace", "Bob"])
    assert.strictEqual(r.cards[0].count, 2)
    assert.strictEqual(r.cards[0].body, a2.body)
    assert.strictEqual(N.title(r.cards[0]), "2 new messages from Grace")
    assert.strictEqual(N.title(r.cards[1]), "New message from Bob")
    assert.strictEqual(N.waiting(r.cards), "1 more after this one")
    // A non-message with the same summary stays its own card.
    const c = card("Grace", false)
    assert.strictEqual(N.add(r.cards, c).cards.length, 3)
  },

  "message cards never time out"() {
    const cards = [card("Grace", true)]
    let shown = {}
    for (let i = 0; i < 100; i++) {
      const r = N.tick(cards, shown, true, 1000)
      assert.deepStrictEqual(r.expired, [])
      shown = r.shown
    }
  },

  "other cards count only while on screen and at the front"() {
    const other = card("Update ready", false)
    const msg = card("Grace", true)
    let cards = [msg, other]
    let shown = {}
    // Waiting behind a message: no time passes for it.
    for (let i = 0; i < 60; i++) shown = N.tick(cards, shown, true, 1000).shown
    assert.strictEqual(shown[other.key], undefined)
    cards = [other]
    // Off screen (locked, screensaver, screen off): no time passes.
    for (let i = 0; i < 60; i++) shown = N.tick(cards, shown, false, 1000).shown
    assert.strictEqual(shown[other.key], undefined)
    let expired = []
    let ticks = 0
    while (expired.length === 0 && ticks < 100) {
      const r = N.tick(cards, shown, true, 1000)
      shown = r.shown
      expired = r.expired
      ticks++
    }
    assert.strictEqual(ticks, N.LIFETIME_MS / 1000)
    assert.deepStrictEqual(expired, [other.key])
  },

  "a long gap counts as one short tick"() {
    const cards = [card("Update ready", false)]
    const r = N.tick(cards, {}, true, 60 * 60 * 1000)
    assert.deepStrictEqual(r.expired, [])
  },

  "the cap drops cards that close by themselves before messages"() {
    let cards = []
    const first = card("Old notice", false)
    cards = N.add(cards, first, 3).cards
    const m1 = card("Grace", true)
    cards = N.add(cards, m1, 3).cards
    const m2 = card("Bob", true)
    cards = N.add(cards, m2, 3).cards
    const m3 = card("Ann", true)
    let r = N.add(cards, m3, 3)
    assert.deepStrictEqual(r.dropped, [first.key])
    assert.deepStrictEqual(r.cards.map((c) => c.summary), ["Ann", "Bob", "Grace"])
    // Only messages left: the oldest goes.
    const m4 = card("Joe", true)
    r = N.add(r.cards, m4, 3)
    assert.deepStrictEqual(r.dropped, [m1.key])
    // A notice never pushes out a message, so with only messages waiting
    // the new notice is the one that goes.
    const n = card("Notice", false)
    const before = r.cards.map((c) => c.key)
    r = N.add(r.cards, n, 3)
    assert.deepStrictEqual(r.dropped, [n.key])
    assert.deepStrictEqual(r.cards.map((c) => c.key), before)
  },
}

let failed = 0
for (const [name, fn] of Object.entries(tests)) {
  try {
    fn()
    console.log(`ok   ${name}`)
  } catch (e) {
    failed++
    console.log(`FAIL ${name}\n     ${e.message}`)
  }
}
if (failed) {
  console.log(`\n${failed} failed`)
  process.exit(1)
}
