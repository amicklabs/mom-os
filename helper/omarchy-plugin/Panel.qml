import QtQuick
import Quickshell
import Quickshell.Io
import qs.Commons
import qs.Ui

// MomOS bar widget for the helper's desktop. The icon shows the person's
// state; the panel shows her latest screenshot, status, help requests and
// agent jobs, with buttons to act. Everything comes from and goes to the
// dispatcher socket. This file only draws what the dispatcher says.
Panel {
  id: root
  moduleName: "momos.status"
  ipcTarget: "momos.status"
  manageIpc: false

  // From the dispatcher's `overview`; null when it isn't reachable.
  property var summary: null
  property var dispatcherInfo: null
  property bool reachable: false
  property string feedback: ""
  property bool feedbackIsError: false
  property string busyAction: ""
  property int imageNonce: 0

  readonly property color foreground: bar ? bar.foreground : Color.foreground
  readonly property color urgent: bar ? bar.urgent : Color.urgent
  readonly property color dim: Qt.darker(foreground, 1.55)
  readonly property string fontFamily: bar ? bar.fontFamily : Style.font.family
  readonly property string momState: !reachable ? "down" : (summary ? summary.state : "unknown")

  // Nerd Font glyphs: account, account-alert, robot.
  readonly property string glyphPerson: "󰀄"
  readonly property string glyphAlert: "󰀅"
  readonly property string glyphRobot: "󰚩"

  readonly property string barGlyph: momState === "help" || momState === "approval" ? glyphAlert : (momState === "working" ? glyphRobot : glyphPerson)
  readonly property color barColor: {
    if (momState === "help" || momState === "approval") return urgent
    if (momState === "working") return Color.accent
    if (momState === "online") return barForeground
    return Qt.darker(barForeground, 1.8)
  }
  readonly property string tooltip: !reachable ? "MomOS: dispatcher not running" : (summary ? "MomOS: " + summary.label : "MomOS")

  implicitWidth: button.implicitWidth
  implicitHeight: button.implicitHeight

  function refresh() {
    client.request("overview", {}, function(res) {
      root.reachable = res.ok === true
      if (res.ok) {
        root.summary = res.data.summary
        root.dispatcherInfo = res.data.dispatcher
      } else {
        root.summary = null
        root.dispatcherInfo = null
      }
    })
  }

  function act(name, cmd, args, doneText) {
    if (busyAction !== "") return
    busyAction = name
    feedback = ""
    client.request(cmd, args, function(res) {
      root.busyAction = ""
      root.feedbackIsError = res.ok !== true
      root.feedback = res.ok ? doneText : (res.error || "Something went wrong")
      if (cmd === "screenshot" && res.ok) root.imageNonce++
      root.refresh()
    })
  }

  onOpenedChanged: {
    if (opened) {
      feedback = ""
      refresh()
      if (!summary || !summary.screenshot) act("screenshot", "screenshot", { refresh: false }, "")
    }
  }

  // Overridable for testing.
  property string socketPath: Quickshell.env("XDG_RUNTIME_DIR") + "/momos-dispatcher.sock"

  DispatcherClient { id: client; path: root.socketPath }

  Timer {
    interval: root.opened ? 5000 : 20000
    running: true
    repeat: true
    triggeredOnStart: true
    onTriggered: root.refresh()
  }

  IpcHandler {
    target: root.ipcTarget
    function open(): void { root.open() }
    function close(): void { root.close() }
    function toggle(): void { root.toggle() }
    function refresh(): string { root.refresh(); return "ok" }
    function status(): string { return root.momState }
  }

  BarIconButton {
    id: button
    anchors.fill: parent
    bar: root.bar
    text: root.barGlyph
    foreground: root.barColor
    tooltipText: root.tooltip
    opacity: root.momState === "working" ? pulse.value : 1.0
    onPressed: function(buttonCode) {
      if (buttonCode === Qt.RightButton) root.refresh()
      else root.toggle()
    }
  }

  // Slow pulse while an agent works.
  QtObject {
    id: pulse
    property real value: 1.0
    property SequentialAnimation anim: SequentialAnimation {
      running: root.momState === "working"
      loops: Animation.Infinite
      onRunningChanged: if (!running) pulse.value = 1.0
      NumberAnimation { target: pulse; property: "value"; to: 0.45; duration: 900; easing.type: Easing.InOutQuad }
      NumberAnimation { target: pulse; property: "value"; to: 1.0; duration: 900; easing.type: Easing.InOutQuad }
    }
  }

  KeyboardPanel {
    id: panel
    anchorItem: button
    owner: root
    bar: root.bar
    open: root.opened
    focusTarget: content
    contentWidth: panel.fittedContentWidth(Style.space(400))
    contentHeight: panel.fittedContentHeight(content.contentHeight, Style.space(720))

    PanelContent {
      id: content
      anchors.fill: parent
      host: root
    }
  }
}
