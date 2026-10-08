pragma Singleton
import QtQuick
import Quickshell

// Turning the computer off or restarting it, from the pages under More.
// After she confirms, Windows/PowerScreen.qml covers the screen with
// "Turning off…" or "Restarting…", and a moment later this runs
// `momctl power off|restart`. If the computer is still up long after that,
// the screen says so and lets her go back.
Singleton {
  id: root

  // "" (nothing), "going" (the calm screen is up) or "failed".
  property string stage: ""
  // "off" or "restart".
  property string action: ""

  // How long the calm screen shows before momctl runs, so she reads it.
  readonly property int leadMs: 1500
  // Still here after this long means something stopped it.
  readonly property int giveUpMs: 120000

  function start(what) {
    if (stage === "going") return
    if (what !== "off" && what !== "restart") return
    action = what
    stage = "going"
    Session.moreOpen = false
    Session.page = ""
    lead.restart()
  }

  function dismiss() {
    lead.stop()
    giveUp.stop()
    stage = ""
  }

  Timer {
    id: lead
    interval: root.leadMs
    onTriggered: {
      giveUp.restart()
      Session.run(["power", root.action], function(code) {
        if (code !== 0 && root.stage === "going") {
          giveUp.stop()
          root.stage = "failed"
        }
      })
    }
  }

  Timer {
    id: giveUp
    interval: root.giveUpMs
    onTriggered: if (root.stage === "going") root.stage = "failed"
  }
}
