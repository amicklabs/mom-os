import QtQuick
import Quickshell
import Quickshell.Io
import Quickshell.Wayland
import Quickshell.Services.Pam
import qs.Common

// Her lock screen. It checks her PIN with PAM as the current user. The
// helper can release it remotely through `qs ipc call shell unlock`.
//
// Environment:
//   MOMOS_PAM_DIR     folder holding the PAM service file (default: shell/pam)
//   MOMOS_PAM_CONFIG  PAM service name (default "momos-lock")
//   MOMOS_LOCK_AUTOUNLOCK  seconds; development only, unlocks by itself
Scope {
  id: root

  readonly property string user: Quickshell.env("USER") || Quickshell.env("LOGNAME") || ""
  readonly property int autoUnlock: parseInt(Quickshell.env("MOMOS_LOCK_AUTOUNLOCK") || "0") || 0

  property string entered: ""
  property bool checking: false
  property string pending: ""
  property string message: ""
  property bool previewVisible: false

  function submit(pin) {
    if (checking || !Session.locked) return
    pending = pin
    message = ""
    checking = true
    if (!pam.start()) fail()
    else Qt.callLater(respond)
  }

  function respond() {
    if (checking && pam.active && pam.responseRequired) pam.respond(pending)
  }

  function fail() {
    checking = false
    pending = ""
    root.entered = ""
    message = "That PIN didn't work. Try again."
  }

  function reset() {
    if (pam.active) pam.abort()
    checking = false
    pending = ""
    message = ""
    root.entered = ""
  }

  Connections {
    target: Session
    function onLockedChanged() {
      root.reset()
      if (Session.locked && root.autoUnlock > 0) autoUnlockTimer.restart()
    }
  }

  Timer {
    id: autoUnlockTimer
    interval: root.autoUnlock * 1000
    onTriggered: Session.unlock()
  }

  PamContext {
    id: pam
    configDirectory: Quickshell.env("MOMOS_PAM_DIR") || Quickshell.shellDir + "/pam"
    config: Quickshell.env("MOMOS_PAM_CONFIG") || "momos-lock"
    user: root.user

    onResponseRequiredChanged: root.respond()
    onPamMessage: root.respond()
    onCompleted: function(result) {
      var ok = result === PamResult.Success
      root.checking = false
      root.pending = ""
      if (!Session.locked) return
      if (ok) Session.unlock()
      else root.fail()
    }
    onError: function(error) {
      console.warn("momos: PAM error " + PamError.toString(error))
      root.fail()
    }
  }

  WlSessionLock {
    id: sessionLock
    locked: Session.locked

    WlSessionLockSurface {
      color: Theme.background

      LockView {
        anchors.fill: parent
        controller: root
      }
    }
  }

  // Development only: the same screen in an ordinary overlay, for screenshots
  // on a machine where a real lock would be unwise.
  LazyLoader {
    active: root.previewVisible

    PanelWindow {
      anchors { top: true; bottom: true; left: true; right: true }
      exclusionMode: ExclusionMode.Ignore
      color: Theme.background
      WlrLayershell.layer: WlrLayer.Overlay
      WlrLayershell.namespace: "momos-lock-preview"
      WlrLayershell.keyboardFocus: WlrKeyboardFocus.None

      LockView {
        anchors.fill: parent
        inputEnabled: false
        controller: QtObject {
          property string entered: "12"
          property bool checking: false
          property string message: ""
        }
      }

      MouseArea {
        anchors.fill: parent
        onClicked: root.previewVisible = false
      }
    }
  }

  IpcHandler {
    target: "momos-lock-dev"
    function preview(): string { root.previewVisible = true; return "ok" }
    function hidePreview(): string { root.previewVisible = false; return "ok" }
  }
}
