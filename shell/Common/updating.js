.pragma library

// The helper's "updating" marker, ~/.local/state/momos/updating.json, written
// by `mom deploy`, `mom update` and `mom restart shell` (apps/mom/src/notice.ts):
//
//   { "version": 1, "state": "updating" | "done", "at": ms, "expiresAt": ms }
//
// It must never get stuck on her screen, so anything odd means no notice: an
// expired marker, one that claims to last longer than it could have been
// written for, or one written in the future (the clock went backwards).

var MAX_UPDATING_MS = 20 * 60 * 1000
var MAX_DONE_MS = 60 * 1000
var CLOCK_SLACK_MS = 60 * 1000

// Returns the marker, or null when the text isn't one.
function parse(text) {
  var raw
  try {
    raw = JSON.parse(text)
  } catch (e) {
    return null
  }
  if (raw === null || typeof raw !== "object") return null
  if (raw.state !== "updating" && raw.state !== "done") return null
  if (typeof raw.at !== "number" || typeof raw.expiresAt !== "number") return null
  if (!isFinite(raw.at) || !isFinite(raw.expiresAt)) return null
  return { state: raw.state, at: raw.at, expiresAt: raw.expiresAt }
}

// "updating", "done" or "" for what to show now.
function current(marker, now) {
  if (!marker) return ""
  if (marker.expiresAt <= now) return ""
  if (marker.at > now + CLOCK_SLACK_MS) return ""
  var max = marker.state === "done" ? MAX_DONE_MS : MAX_UPDATING_MS
  if (marker.expiresAt - now > max) return ""
  return marker.state
}

function text(state, helper) {
  if (state === "updating") return (helper || "Your helper") + " is updating your computer. It will be back in a minute."
  if (state === "done") return "Done. Your computer is up to date."
  return ""
}
