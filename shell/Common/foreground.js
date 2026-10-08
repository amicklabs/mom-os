.pragma library

// What she's looking at, for the bar: a name and an icon, or null on the home
// screen. Pure, so shell/dev/foreground-test.js can check it with node.
//
// It matches windows to tiles the way momctl does (apps/momctl/src/lib/tiles.ts):
// web app classes first, since they're the most specific, then native apps.
// A window that matches no tile, like a file picker, takes the tile of the
// workspace it's on. See docs/contracts.md, "The bar".

var HOME_WORKSPACE = "home"

// NATIVE_APPS in packages/shared/src/config.ts, by window class.
var NATIVE_CLASSES = { telegram: "org.telegram.desktop", chromium: "chromium" }
var TELEGRAM_CLASSES = ["org.telegram.desktop", "telegram-desktop", "telegramdesktop"]

// The bar draws the browser with Chrome's mark, whatever the tile's icon is:
// Chromium is the browser, but the Chrome logo is the one she knows.
var BROWSER_ICON = "chrome"

// The shell's own pages, opened from More.
var PAGES = {
  "wifi": { label: "Internet connection", icon: "signal" },
  "speaker": { label: "Speaker", icon: "speaker" },
  "colors": { label: "Colors", icon: "look" },
  "text-size": { label: "Text size", icon: "textsize" },
  "icons": { label: "Icons", icon: "app" },
  "restart": { label: "Restart", icon: "power" },
  "turn-off": { label: "Turn off", icon: "power" }
}

function webappPrefix(url) {
  var m = /^https:\/\/([^\/?#]+)/i.exec(String(url || ""))
  return m ? ("chrome-" + m[1] + "__").toLowerCase() : null
}

function isTelegram(cls) {
  return TELEGRAM_CLASSES.indexOf(String(cls || "").toLowerCase()) >= 0
}

function matches(tile, cls) {
  var c = String(cls || "").toLowerCase()
  if (c === "") return false
  if (tile.type === "webapp") {
    var prefix = webappPrefix(tile.url)
    return prefix !== null && c.indexOf(prefix) === 0
  }
  if (tile.type === "app") {
    if (tile.app === "telegram") return isTelegram(c)
    return c === NATIVE_CLASSES[tile.app]
  }
  if (tile.type === "telegram-chat") return isTelegram(c)
  return false
}

function rank(t) {
  return t.type === "webapp" ? 0 : t.type === "app" ? 1 : 2
}

// The tile a window class belongs to, or null.
function tileForClass(tiles, cls) {
  var order = (tiles || []).slice().sort(function(a, b) { return rank(a) - rank(b) })
  for (var i = 0; i < order.length; i++)
    if (matches(order[i], cls)) return order[i]
  return null
}

function tileForWorkspace(tiles, workspace) {
  var name = String(workspace || "")
  if (name.indexOf("tile-") !== 0) return null
  var id = name.slice(5)
  for (var i = 0; i < (tiles || []).length; i++)
    if (tiles[i].id === id) return tiles[i]
  return null
}

function fromTile(tile) {
  var browser = tile.type === "app" && tile.app === "chromium"
  return { label: tile.label, icon: browser ? BROWSER_ICON : (tile.icon || "app"), tileId: tile.id, brand: true }
}

// `o`:
//   page       Session.page, "" when no page is open
//   tiles      the config's tiles
//   workspace  Hyprland's focused workspace name
//   cls        the active window's class, "" when there's none
//   windowWorkspace  the workspace that window is on
// Returns { label, icon, tileId, brand } or null for home or nothing to name.
// `brand` is true when the icon is a tile icon with a colored mark in
// shell/icons/, false for the line icons of the shell's own pages.
function describe(o) {
  var tiles = o.tiles || []
  if (o.page) {
    for (var i = 0; i < tiles.length; i++)
      if (tiles[i].type === "page" && tiles[i].page === o.page) return fromTile(tiles[i])
    var p = PAGES[o.page]
    if (p) return { label: p.label, icon: p.icon, tileId: "", brand: false }
    if (o.page === "family") return { label: "Family", icon: "family", tileId: "", brand: true }
    return null
  }
  var ws = String(o.workspace || "")
  if (ws === "" || ws === HOME_WORKSPACE) return null
  // Only a window on the workspace she's looking at counts.
  var cls = o.cls && (!o.windowWorkspace || o.windowWorkspace === ws) ? o.cls : ""
  var tile = cls ? tileForClass(tiles, cls) : null
  if (tile) return fromTile(tile)
  // Telegram without a tile of its own still reads as Telegram.
  if (isTelegram(cls)) return { label: "Telegram", icon: "telegram", tileId: "", brand: true }
  if (String(cls).toLowerCase() === NATIVE_CLASSES.chromium) return { label: "Browser", icon: BROWSER_ICON, tileId: "", brand: true }
  // A dialog, or an app still starting on its tile's workspace.
  tile = tileForWorkspace(tiles, ws)
  return tile ? fromTile(tile) : null
}
