.pragma library

// Loose checks that mirror packages/shared/src/config.ts and state.ts. The
// shell can't run zod, so it checks just enough to draw a screen safely: a
// bad tile is dropped, a bad config falls back to the last good one, and the
// shell never throws on odd input.

var ID = /^[a-z0-9][a-z0-9-]{0,39}$/
var TELEGRAM = /^[A-Za-z0-9_]{5,32}$/
var PHOTO = /^[A-Za-z0-9._-]+\.(jpg|jpeg|png|webp)$/
var NATIVE_APPS = ["telegram", "chromium"]

function isObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v)
}

function str(v, max) {
  return typeof v === "string" && v.length > 0 && v.length <= max
}

function tile(t) {
  if (!isObject(t) || !ID.test(String(t.id)) || !str(t.label, 24)) return null
  var out = { id: t.id, label: t.label, type: t.type, icon: typeof t.icon === "string" ? t.icon : "" }
  switch (t.type) {
  case "webapp":
    if (typeof t.url !== "string" || t.url.indexOf("https://") !== 0) return null
    out.url = t.url
    return out
  case "app":
    if (NATIVE_APPS.indexOf(t.app) < 0) return null
    out.app = t.app
    return out
  case "telegram-chat":
    if (!TELEGRAM.test(String(t.telegram))) return null
    out.telegram = t.telegram
    return out
  case "page":
    if (!ID.test(String(t.page))) return null
    out.page = t.page
    return out
  }
  return null
}

function member(m) {
  if (!isObject(m) || !ID.test(String(m.id)) || !str(m.name, 32)) return null
  if (!TELEGRAM.test(String(m.telegram))) return null
  return {
    id: m.id,
    name: m.name,
    telegram: m.telegram,
    photo: typeof m.photo === "string" && PHOTO.test(m.photo) ? m.photo : ""
  }
}

// Returns { config, error }. `config` is null when the file can't be used.
function parseConfig(text) {
  var raw
  try {
    raw = JSON.parse(text)
  } catch (e) {
    return { config: null, error: "config.json is not valid JSON: " + e }
  }
  if (!isObject(raw)) return { config: null, error: "config.json is not an object" }
  if (!isObject(raw.person) || !str(raw.person.name, 32))
    return { config: null, error: "person.name is missing" }
  if (!isObject(raw.helper) || !str(raw.helper.name, 32))
    return { config: null, error: "helper.name is missing" }
  if (!Array.isArray(raw.tiles)) return { config: null, error: "tiles is missing" }

  var tiles = []
  var seen = {}
  for (var i = 0; i < raw.tiles.length && tiles.length < 12; i++) {
    var t = tile(raw.tiles[i])
    if (t && !seen[t.id]) {
      seen[t.id] = true
      tiles.push(t)
    } else {
      console.warn("momos: skipping bad tile", JSON.stringify(raw.tiles[i]))
    }
  }
  if (tiles.length === 0) return { config: null, error: "no usable tiles" }

  var family = []
  var list = Array.isArray(raw.family) ? raw.family : []
  for (var j = 0; j < list.length && family.length < 24; j++) {
    var m = member(list[j])
    if (m) family.push(m)
    else console.warn("momos: skipping bad family member", JSON.stringify(list[j]))
  }

  return {
    config: {
      person: { name: raw.person.name },
      helper: {
        name: raw.helper.name,
        phone: typeof raw.helper.phone === "string" ? raw.helper.phone : "",
        telegram: TELEGRAM.test(String(raw.helper.telegram)) ? raw.helper.telegram : ""
      },
      tiles: tiles,
      family: family
    },
    error: ""
  }
}

// Returns a state object or null. Fields the shell doesn't understand are
// replaced with safe defaults rather than rejected.
function parseState(text) {
  var raw
  try {
    raw = JSON.parse(text)
  } catch (e) {
    return null
  }
  if (!isObject(raw) || raw.version !== 1 || typeof raw.updatedAt !== "number") return null

  var banner = null
  if (isObject(raw.banner) && typeof raw.banner.text === "string" && raw.banner.text.length > 0) {
    banner = {
      id: String(raw.banner.id || raw.banner.text),
      kind: ["message", "info", "warning"].indexOf(raw.banner.kind) >= 0 ? raw.banner.kind : "info",
      text: raw.banner.text.slice(0, 280),
      until: typeof raw.banner.until === "number" ? raw.banner.until : null
    }
  }

  var battery = null
  if (isObject(raw.battery) && typeof raw.battery.percent === "number")
    battery = { percent: raw.battery.percent, charging: raw.battery.charging === true }

  var help = isObject(raw.help) ? raw.help : {}
  var reminders = isObject(raw.reminders) ? raw.reminders : {}
  return {
    updatedAt: raw.updatedAt,
    online: raw.online === true ? true : raw.online === false ? false : null,
    battery: battery,
    wifi: isObject(raw.wifi) && typeof raw.wifi.ssid === "string" ? { ssid: raw.wifi.ssid.slice(0, 64) } : null,
    viewer: {
      connected: isObject(raw.viewer) && raw.viewer.connected === true,
      control: isObject(raw.viewer) && raw.viewer.connected === true && raw.viewer.control === true
    },
    help: {
      status: ["idle", "sending", "sent", "failed", "offline"].indexOf(help.status) >= 0 ? help.status : "idle",
      at: typeof help.at === "number" ? help.at : null,
      queued: typeof help.queued === "number" && help.queued > 0 ? Math.floor(help.queued) : 0
    },
    banner: banner,
    reminders: { today: reminderList(reminders.today), due: reminderList(reminders.due) },
    telegramUnread: isObject(raw.telegram) && typeof raw.telegram.unread === "number" && raw.telegram.unread > 0
      ? Math.min(9999, Math.floor(raw.telegram.unread)) : 0
  }
}

// Reminder items from momd: { key, at, label, text }. Bad ones are dropped.
function reminderList(list) {
  var out = []
  if (!Array.isArray(list)) return out
  for (var i = 0; i < list.length && out.length < 20; i++) {
    var r = list[i]
    if (!isObject(r) || typeof r.key !== "string" || typeof r.at !== "number") continue
    if (!str(r.label, 20) || !str(r.text, 80)) continue
    out.push({ key: r.key, at: r.at, label: r.label, text: r.text })
  }
  return out
}

function initials(name) {
  var parts = String(name || "").trim().split(/\s+/)
  var out = ""
  for (var i = 0; i < parts.length && out.length < 2; i++)
    if (parts[i].length > 0) out += parts[i][0].toUpperCase()
  return out || "?"
}

function greeting(date) {
  var h = date.getHours()
  if (h < 12) return "Good morning"
  if (h < 17) return "Good afternoon"
  return "Good evening"
}

function shorten(text, max) {
  var s = String(text || "").replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim()
  if (s.length <= max) return s
  var cut = s.slice(0, max)
  var space = cut.lastIndexOf(" ")
  if (space > max * 0.6) cut = cut.slice(0, space)
  return cut + "…"
}
