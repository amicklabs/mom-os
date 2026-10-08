pragma Singleton
import QtQuick
import Quickshell
import Quickshell.Io
import Quickshell.Services.Pipewire

// Bluetooth speakers for the Speaker page (Windows/SpeakerPage.qml), through
// `momctl speaker ...`. Every call prints one line of JSON; this keeps the
// last list and the outcome of the last connect, and the page draws them.
Singleton {
  id: root

  // The last `momctl speaker` or `momctl speaker scan`:
  // { adapter, output: { name, bluetooth, address } | null, speakers }.
  property var info: null
  property bool scanning: false
  property bool loadFailed: false

  // The connect in progress or just finished.
  property bool connecting: false
  property string connectingName: ""
  // { ok, address, name, reason, output } after a connect, or null.
  property var result: null

  // Where the sound goes right now, from PipeWire, so More can say so
  // without asking momctl. Bluetooth sinks are named bluez_output.<address>.
  readonly property var sink: Pipewire.defaultAudioSink
  readonly property bool playingOnSpeaker: sink !== null && String(sink.name).indexOf("bluez_output.") === 0
  readonly property string playingOn: playingOnSpeaker ? (sink.description || sink.nickname || "") : ""

  // Counts switches, connects, disconnects and forgets. A scan takes ten
  // seconds, and one that started before a change would put the old state
  // back when it ends, so its answer is dropped instead.
  property int changes: 0
  property int scanChanges: 0
  property int scansDone: 0

  // A fresh answer without a scan lists saved speakers only. Keep the new
  // ones the last scan found, so they don't blink off the list.
  function keepNearby(d) {
    var old = root.info && root.info.speakers && d.adapter === "on" ? root.info.speakers : []
    var have = {}
    for (var i = 0; i < d.speakers.length; i++) have[d.speakers[i].address] = true
    var extra = old.filter(function(s) { return !s.paired && s.nearby && !have[s.address] })
    return { adapter: d.adapter, output: d.output, speakers: d.speakers.concat(extra) }
  }

  // Saved speakers, quickly, without looking for new ones.
  function load() {
    var scansBefore = root.scansDone
    call(["speaker"], function(ok, d) {
      if (ok && d && d.speakers) {
        // A scan that finished meanwhile knows more.
        if (root.scansDone === scansBefore) root.info = root.keepNearby(d)
        root.loadFailed = false
      } else if (root.info === null) {
        root.loadFailed = true
      }
    })
  }

  // Look for speakers nearby, about ten seconds.
  function scan() {
    if (scanning) return
    scanning = true
    scanChanges = changes
    call(["speaker", "scan"], function(ok, d) {
      root.scanning = false
      if (root.scanChanges !== root.changes) {
        root.load()
        return
      }
      if (ok && d && d.speakers) {
        root.info = d
        root.scansDone++
        root.loadFailed = false
      } else if (root.info === null) {
        root.loadFailed = true
      }
    })
  }

  function connectTo(s) {
    if (connecting) return
    connecting = true
    connectingName = s.name
    result = null
    call(["speaker", "connect", s.address], function(ok, d, reason) {
      root.connecting = false
      root.changes++
      if (ok && d && d.detail) console.log("momos: speaker: no sound on " + s.name + ": " + d.detail)
      root.result = {
        ok: ok,
        address: s.address,
        name: s.name,
        reason: ok ? "" : (reason || "failed"),
        output: ok && d ? d.output === true : false
      }
      root.load()
    })
  }

  // Where the sound comes out: "computer" or a connected speaker's address.
  // Nothing disconnects. `done(ok, reason)` after the list is fresh again.
  property bool switching: false
  function useOutput(target, done) {
    if (switching) return
    switching = true
    call(["speaker", "output", target], function(ok, d, reason) {
      root.switching = false
      root.changes++
      if (ok && d && d.speakers) root.info = root.keepNearby(d)
      else root.load()
      if (done) done(ok, ok ? "" : (reason || "failed"))
    })
  }

  function disconnect(address, done) {
    call(["speaker", "disconnect", address], function(ok) {
      root.changes++
      root.load()
      if (done) done(ok)
    })
  }

  function forget(address, done) {
    call(["speaker", "forget", address], function(ok) {
      root.changes++
      root.load()
      if (done) done(ok)
    })
  }

  function clearResult() {
    result = null
  }

  // Development only, for screenshots without a pointer: act as if she
  // pressed a speaker's row, or "forget:<name>" for its Forget button.
  signal pickRequested(string name)

  // Runs momctl and hands `done(ok, data, reason)` its JSON.
  function call(args, done) {
    var proc = procComponent.createObject(root, {
      command: ["sh", "-c", "exec \"$@\"", "momos-shell", Session.momctl].concat(args)
    })
    proc.done = done
    proc.running = true
    console.log("momos: momctl " + args.join(" "))
  }

  Component {
    id: procComponent
    Process {
      id: proc
      property var done: null
      property string out: ""
      stdout: StdioCollector {
        onStreamFinished: proc.out = text
      }
      onExited: function(exitCode) {
        // The collector may finish just after exit; read it on the next turn.
        Qt.callLater(function() {
          var parsed = null
          var lines = String(proc.out || "").trim().split("\n")
          for (var i = lines.length - 1; i >= 0 && parsed === null; i--) {
            try { parsed = JSON.parse(lines[i]) } catch (e) {}
          }
          var ok = exitCode === 0 && parsed !== null && parsed.ok === true
          if (proc.done) proc.done(ok, parsed ? parsed.data : null, parsed ? parsed.reason : "")
          proc.destroy()
        })
      }
    }
  }
}
