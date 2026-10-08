pragma Singleton
import QtQuick
import Quickshell
import Quickshell.Io

// Networks for the "Internet connection" page, through `momctl wifi ...`.
// Every call prints one line of JSON; this keeps the last scan and the
// outcome of the last join, and the page (Windows/WifiPage.qml) draws them.
//
// Passwords go to momctl on stdin, never on its command line.
Singleton {
  id: root

  // The last `momctl wifi scan`: { connectivity, portal, current, networks }.
  property var scan: null
  property bool scanning: false
  property bool scanFailed: false

  // Connectivity from NetworkManager, "portal" when a hotel or cafe wants
  // her to sign in first. Checked while the internet is out, so the banner
  // can say so.
  property string connectivity: ""
  readonly property bool portal: connectivity === "portal" || (scan !== null && scan.portal === true)

  // The join in progress or just finished.
  property bool joining: false
  property string joiningName: ""
  // { ok, name, reason, portal } after a join, or null.
  property var result: null

  function refresh(fresh) {
    if (scanning) return
    scanning = true
    call(fresh ? ["wifi", "scan", "--fresh"] : ["wifi", "scan"], null, function(ok, data) {
      root.scanning = false
      if (ok && data && data.networks) {
        root.scan = data
        root.scanFailed = false
        root.connectivity = data.connectivity || ""
      } else if (root.scan === null) {
        root.scanFailed = true
      }
    })
  }

  // Join a network. `password` is a string or null. `hidden` for a network
  // she typed the name of.
  function join(name, password, hidden) {
    if (joining) return
    joining = true
    joiningName = name
    result = null
    var args = ["wifi", "connect", name]
    if (password !== null && password !== undefined) args.push("--password-stdin")
    if (hidden) args.push("--hidden")
    call(args, password, function(ok, data, reason) {
      root.joining = false
      root.result = {
        ok: ok,
        name: name,
        reason: ok ? "" : (reason || "failed"),
        portal: ok && data ? data.portal === true : false
      }
      if (ok && data) root.connectivity = data.connectivity || ""
      root.refresh(false)
    })
  }

  function forget(name, done) {
    call(["wifi", "forget", name], null, function(ok) {
      root.refresh(false)
      if (done) done(ok)
    })
  }

  function checkPortal() {
    call(["wifi", "portal"], null, function(ok, data) {
      if (ok && data) root.connectivity = data.connectivity || ""
    })
  }

  // The sign-in page opens in the Browser tile's window, over this page.
  function openSignIn() {
    Session.page = ""
    call(["wifi", "portal", "open"], null, null)
  }

  function clearResult() {
    result = null
  }

  // Development only, for screenshots without a pointer: act as if she
  // pressed a network's row ("" for "My network isn't listed").
  signal pickRequested(string name)

  // Runs momctl and hands `done(ok, data, reason)` its JSON. `input` is
  // written to stdin and then closed.
  function call(args, input, done) {
    var proc = procComponent.createObject(root, {
      command: ["sh", "-c", "exec \"$@\"", "momos-shell", Session.momctl].concat(args),
      input: input === null || input === undefined ? null : String(input),
      stdinEnabled: input !== null && input !== undefined
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
      property var input: null
      property string out: ""
      stdout: StdioCollector {
        onStreamFinished: proc.out = text
      }
      onStarted: {
        if (input !== null) {
          write(input + "\n")
          stdinEnabled = false
        }
        input = null
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

  // While the internet is out, ask every 20 seconds whether a sign-in page
  // is the reason. Cheap: it reads NetworkManager's state.
  Timer {
    interval: 20000
    running: Store.online === false
    repeat: true
    triggeredOnStart: true
    onTriggered: statusProc.running = true
  }
  Process {
    id: statusProc
    command: ["sh", "-c", "exec \"$@\"", "momos-shell", Session.momctl, "wifi"]
    stdout: StdioCollector {
      onStreamFinished: {
        try {
          var j = JSON.parse(String(text).trim().split("\n").pop())
          if (j.ok && j.data) root.connectivity = j.data.connectivity || ""
        } catch (e) {}
      }
    }
  }
  Connections {
    target: Store
    function onOnlineChanged() { if (Store.online === true) root.connectivity = "full" }
  }
}
