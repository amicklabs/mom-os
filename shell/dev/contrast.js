#!/usr/bin/env node
// Checks every text color in Common/themes.js against the colors it sits on.
// Main labels want 7:1 (WCAG AAA), everything else at least 4.5:1 (AA), and
// icons 3:1. In the bar, the date is inkSoft (4.5:1), and the app name (ink)
// and the "No internet" and "Battery low" warnings (alert) are 7:1. The eye's
// pill (viewer) stands out from the bar at 3:1.
// Exits 1 if any pair falls short.
//
//   node shell/dev/contrast.js

const fs = require("fs")
const path = require("path")

const source = fs.readFileSync(path.join(__dirname, "../Common/themes.js"), "utf8")
  .replace(/^\.pragma library\s*/, "")
const themes = new Function(source + "\nreturn list")()

function rgb(hex) {
  const h = hex.replace("#", "")
  const six = h.length === 8 ? h.slice(2) : h
  return [0, 2, 4].map((i) => parseInt(six.slice(i, i + 2), 16) / 255)
}

function luminance(hex) {
  const [r, g, b] = rgb(hex).map((c) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)))
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

function ratio(a, b) {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p)
  return (x + 0.05) / (y + 0.05)
}

// [text, background, minimum]
const AAA = 7, AA = 4.5, ICON = 3
const pairs = [
  ["ink", "surface", AAA], ["ink", "background", AAA], ["ink", "backgroundTop", AAA],
  ["ink", "pressed", AAA], ["ink", "bar", AAA], ["ink", "quiet", AAA], ["ink", "quietPressed", AAA],
  ["inkSoft", "surface", AA], ["inkSoft", "background", AA], ["inkSoft", "bar", AA],
  ["accentInk", "accent", AA], ["accentInk", "accentPressed", AA],
  ["helpInk", "help", AA], ["helpInk", "helpPressed", AA], ["helpInk", "helpDone", AA],
  ["accent", "surface", AA], ["accent", "background", AA], ["accent", "accentSoft", ICON],
  ["alert", "surface", AA], ["alert", "background", AA], ["alert", "bar", AAA],
  ["bannerInk", "viewer", AA], ["bannerInk", "warning", AA], ["bannerInk", "message", AA], ["bannerInk", "info", AA],
  ["viewer", "bar", ICON],
  ["saverInk", "saver", AAA], ["saverInkSoft", "saver", AA],
]

let failed = 0
for (const t of themes) {
  const rows = []
  for (const [fg, bg, min] of pairs) {
    const r = ratio(t[fg], t[bg])
    const ok = r >= min
    if (!ok) failed++
    rows.push(`  ${ok ? "ok  " : "LOW "} ${fg.padEnd(12)} on ${bg.padEnd(14)} ${r.toFixed(2)} (want ${min})`)
  }
  console.log(`${t.name}`)
  console.log(rows.join("\n"))
}
if (failed) {
  console.log(`\n${failed} pair(s) below the minimum`)
  process.exit(1)
}
console.log("\nall pairs pass")
