#!/usr/bin/env node
// Checks Common/foreground.js, which names what she's looking at for the bar.
// Exits 1 on the first failure.
//
//   node shell/dev/foreground-test.js

const fs = require("fs")
const path = require("path")
const assert = require("assert")

const source = fs.readFileSync(path.join(__dirname, "../Common/foreground.js"), "utf8")
  .replace(/^\.pragma library\s*/, "")
const F = new Function(source + "\nreturn { describe, tileForClass }")()

const tiles = JSON.parse(fs.readFileSync(path.join(__dirname, "config.json"), "utf8")).tiles
  .concat([{ id: "church", label: "Church", icon: null, type: "webapp", url: "https://www.example.org/live" }])

const on = (workspace, cls, extra) => F.describe(Object.assign({ page: "", tiles, workspace, cls, windowWorkspace: workspace }, extra))
const name = (d) => (d ? `${d.label}/${d.icon}` : null)

const tests = {
  "home shows nothing"() {
    assert.strictEqual(on("home", ""), null)
    assert.strictEqual(on("", ""), null)
  },
  "Telegram, and its call windows, read as the Telegram tile"() {
    assert.strictEqual(name(on("tile-telegram", "org.telegram.desktop")), "Telegram/telegram")
    assert.strictEqual(name(on("tile-youtube", "telegram-desktop")), "Telegram/telegram")
  },
  "Telegram without a tile still reads as Telegram"() {
    const d = F.describe({ page: "", tiles: [], workspace: "3", cls: "org.telegram.desktop" })
    assert.strictEqual(name(d), "Telegram/telegram")
  },
  "the browser gets Chrome's mark and the tile's name"() {
    assert.strictEqual(name(on("tile-internet", "chromium")), "Browser/chrome")
    // A link opened over YouTube is still the browser.
    assert.strictEqual(name(on("tile-youtube", "chromium")), "Browser/chrome")
  },
  "web apps get their tile's label and icon"() {
    assert.strictEqual(name(on("tile-youtube", "chrome-www.youtube.com__-Default")), "YouTube/youtube")
    assert.strictEqual(name(on("tile-email", "chrome-mail.google.com__mail_u_0_-Default")), "Email/email")
    assert.strictEqual(name(on("tile-photos", "chrome-photos.google.com__-Default")), "Photos/photos")
    assert.strictEqual(name(on("tile-church", "chrome-www.example.org__live-Default")), "Church/app")
  },
  "an unknown window takes its workspace's tile"() {
    assert.strictEqual(name(on("tile-internet", "xdg-desktop-portal-gtk")), "Browser/chrome")
    assert.strictEqual(name(on("tile-facebook", "")), "Facebook/facebook")
    assert.strictEqual(on("7", "foot"), null)
  },
  "a window on another workspace doesn't count"() {
    const d = F.describe({ page: "", tiles, workspace: "tile-youtube", cls: "org.telegram.desktop", windowWorkspace: "tile-telegram" })
    assert.strictEqual(name(d), "YouTube/youtube")
  },
  "pages win over windows"() {
    assert.strictEqual(name(on("tile-youtube", "chrome-www.youtube.com__-Default", { page: "family" })), "Family/family")
    assert.strictEqual(name(on("home", "", { page: "wifi" })), "Internet connection/signal")
    assert.strictEqual(name(on("home", "", { page: "speaker" })), "Speaker/speaker")
    assert.strictEqual(name(on("home", "", { page: "text-size" })), "Text size/textsize")
    assert.strictEqual(on("home", "", { page: "nope" }), null)
  },
}

let failed = 0
for (const [title, fn] of Object.entries(tests)) {
  try {
    fn()
    console.log(`ok   ${title}`)
  } catch (e) {
    failed++
    console.log(`FAIL ${title}\n     ${e.message}`)
  }
}
if (failed) process.exit(1)
console.log("\nall passed")
