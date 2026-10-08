pragma Singleton
import QtQuick
import Quickshell
import Quickshell.Io
import Quickshell.Services.UPower
import "validate.js" as Validate
import "updating.js" as Updating

// Reads config.json and state.json and turns them into what the screen shows.
//
// Environment (all optional; defaults are the contract paths):
//   MOMOS_CONFIG   path to config.json   (~/.config/momos/config.json)
//   MOMOS_STATE    path to state.json    ($XDG_RUNTIME_DIR/momos/state.json)
//   MOMOS_PHOTOS   family photo folder   (~/.config/momos/photos)
//   MOMOS_SLIDESHOW  screensaver photos  (~/.local/share/momos/slideshow)
//   MOMOS_UPDATING   the helper's updating marker (~/.local/state/momos/updating.json)
Singleton {
  id: root

  readonly property string home: Quickshell.env("HOME") || ""
  readonly property string runtimeDir: Quickshell.env("XDG_RUNTIME_DIR") || "/tmp"
  readonly property string configPath: Quickshell.env("MOMOS_CONFIG") || home + "/.config/momos/config.json"
  // Tile icons of her own, <name>.svg, next to config.json (TileIcon.qml).
  readonly property string iconsDir: configPath.slice(0, configPath.lastIndexOf("/") + 1) + "icons/"
  readonly property string statePath: Quickshell.env("MOMOS_STATE") || runtimeDir + "/momos/state.json"
  readonly property string photosDir: Quickshell.env("MOMOS_PHOTOS") || home + "/.config/momos/photos"
  readonly property string slideshowDir: Quickshell.env("MOMOS_SLIDESHOW")
    || (Quickshell.env("XDG_DATA_HOME") || home + "/.local/share") + "/momos/slideshow"
  // Always under ~/.local/state, where `mom` writes it over SSH.
  readonly property string updatingPath: Quickshell.env("MOMOS_UPDATING") || home + "/.local/state/momos/updating.json"

  // Last good config. It stays when the file later goes bad, so a broken
  // write never takes her tiles away.
  property var config: null
  property bool configLoaded: false
  property string configError: ""

  property var state: null
  property real now: Date.now()

  readonly property int staleMs: 30000
  readonly property bool stateFresh: state !== null && Math.abs(now - state.updatedAt) <= staleMs
  // momd is up when state.json is fresh. Everything below falls back when it isn't.
  readonly property bool momdUp: stateFresh

  readonly property string personName: config ? config.person.name : ""
  // "your helper" only shows before the config has loaded.
  readonly property string helperName: config ? config.helper.name : "your helper"
  // helperName at the start of a sentence.
  readonly property string helperTitle: helperName.charAt(0).toUpperCase() + helperName.slice(1)
  readonly property string helperPhone: config ? config.helper.phone : ""
  // Their Telegram username, for "Message Sam on Telegram" in the Help pop-up.
  readonly property string helperTelegram: config && config.helper.telegram ? config.helper.telegram : ""
  readonly property var tiles: config ? config.tiles : []
  readonly property var family: config ? config.family : []

  // true, false, or null when unknown.
  readonly property var online: stateFresh ? state.online : fallbackOnline
  property var fallbackOnline: null

  // The Wi-Fi network momd last saw, or "" when none or unknown.
  readonly property string wifiName: stateFresh && state.wifi && state.wifi.ssid ? state.wifi.ssid : ""

  readonly property bool viewerConnected: stateFresh && state.viewer.connected
  // Someone looking can also use her mouse and keyboard: always over VNC, and
  // in the browser only when the helper turned control on.
  readonly property bool viewerControl: viewerConnected && state.viewer.control
  // What someone looking means for her, in words: the banner when they
  // connect, the lock screen and screensaver line, and a tap on the bar's eye.
  readonly property string viewerText: helperTitle + (viewerControl
    ? " is looking at your screen and can move your mouse"
    : " is looking at your screen")
  readonly property string helpStatus: stateFresh ? state.help.status : "idle"
  readonly property var helpAt: stateFresh ? state.help.at : null
  // Help requests waiting on the laptop for the internet.
  readonly property int helpQueued: stateFresh ? state.help.queued : 0
  readonly property var banner: {
    if (!stateFresh || !state.banner) return null
    if (state.banner.until !== null && state.banner.until < now) return null
    return state.banner
  }

  // Reminders from momd. Nothing shows while momd is down.
  readonly property var remindersToday: stateFresh
    ? state.reminders.today.filter(function(r) { return r.at > now }) : []
  readonly property var remindersDue: stateFresh ? state.reminders.due : []

  // "updating" while the helper deploys or updates, "done" for a few seconds
  // after, else "". Works with momd down. See Common/updating.js.
  property var updatingMarker: null
  readonly property string updating: Updating.current(updatingMarker, now)
  readonly property string updatingText: Updating.text(updating, helperTitle)

  // Unread messages in Telegram, for the badge on its tile. 0 while momd is down.
  readonly property int telegramUnread: stateFresh ? state.telegramUnread : 0

  readonly property var battery: {
    if (stateFresh && state.battery) return state.battery
    var d = UPower.displayDevice
    if (!d || !d.ready || !d.isPresent || !d.isLaptopBattery) return null
    var p = d.percentage <= 1 ? d.percentage * 100 : d.percentage
    return {
      percent: Math.round(p),
      charging: d.state === UPowerDeviceState.Charging || d.state === UPowerDeviceState.PendingCharge
    }
  }

  // Low enough that she should plug in: under 20% and not charging. The bar
  // says so in words.
  readonly property bool batteryLow: battery !== null && !battery.charging && battery.percent < 20

  function photoUrl(photo) {
    if (!photo) return ""
    return "file://" + String(photosDir + "/" + photo).split("/").map(encodeURIComponent).join("/")
  }

  function loadConfig(text) {
    var result = Validate.parseConfig(text)
    configLoaded = true
    if (result.config) {
      config = result.config
      configError = ""
    } else {
      configError = result.error
      console.warn("momos: " + result.error + (config ? "; keeping the last good config" : ""))
    }
  }

  Timer {
    interval: 1000
    running: true
    repeat: true
    triggeredOnStart: true
    onTriggered: root.now = Date.now()
  }

  FileView {
    id: configFile
    path: root.configPath
    watchChanges: true
    printErrors: false
    onLoaded: root.loadConfig(text())
    onLoadFailed: function(error) {
      root.configLoaded = true
      root.configError = "config.json could not be read (" + root.configPath + ")"
      if (!root.config) console.warn("momos: " + root.configError)
    }
    onFileChanged: reload()
  }

  FileView {
    id: stateFile
    path: root.statePath
    watchChanges: true
    printErrors: false
    onLoaded: root.state = Validate.parseState(text())
    onLoadFailed: function(error) { root.state = null }
    onFileChanged: reload()
  }

  FileView {
    id: updatingFile
    path: root.updatingPath
    watchChanges: true
    printErrors: false
    onLoaded: root.updatingMarker = Updating.parse(text())
    onLoadFailed: function(error) { root.updatingMarker = null }
    onFileChanged: reload()
  }

  // momd replaces state.json by rename, and either file may not exist yet.
  // A slow poll backs up the file watch so neither case is missed.
  Timer {
    interval: 3000
    running: true
    repeat: true
    onTriggered: {
      stateFile.reload()
      updatingFile.reload()
      if (!root.config) configFile.reload()
    }
  }
  Timer {
    interval: 20000
    running: true
    repeat: true
    onTriggered: configFile.reload()
  }

  // Without momd, ask NetworkManager whether the internet works.
  Process {
    id: connectivity
    command: ["nmcli", "networking", "connectivity"]
    stdout: StdioCollector {
      onStreamFinished: {
        var v = String(text || "").trim()
        root.fallbackOnline = v === "full" ? true : (v === "none" || v === "limited" || v === "portal") ? false : null
      }
    }
  }
  Timer {
    interval: 30000
    running: !root.stateFresh
    repeat: true
    triggeredOnStart: true
    onTriggered: if (!connectivity.running) connectivity.running = true
  }
}
