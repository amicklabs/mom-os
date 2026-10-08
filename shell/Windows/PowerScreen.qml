import QtQuick
import Quickshell
import Quickshell.Wayland
import qs.Common
import qs.Ui

// The last thing she sees before the computer turns off or restarts: one
// calm line in her theme, over everything, bar included. If the computer is
// still on long after, it says so and she can go back to it.
PanelWindow {
  id: root

  required property var modelData
  screen: modelData

  visible: Power.stage !== ""
  anchors { top: true; bottom: true; left: true; right: true }
  exclusionMode: ExclusionMode.Ignore
  color: Theme.background
  WlrLayershell.layer: WlrLayer.Overlay
  WlrLayershell.namespace: "momos-power"
  WlrLayershell.keyboardFocus: WlrKeyboardFocus.None

  readonly property bool off: Power.action === "off"
  readonly property bool failed: Power.stage === "failed"

  Backdrop {
    anchors.fill: parent
  }

  // Nothing underneath takes a tap while it's up.
  MouseArea {
    anchors.fill: parent
  }

  Column {
    anchors.centerIn: parent
    width: parent.width - Theme.margin * 4
    spacing: 14

    Text {
      width: parent.width
      horizontalAlignment: Text.AlignHCenter
      text: root.failed ? (root.off ? "The computer didn't turn off." : "The computer didn't restart.")
        : root.off ? "Turning off…" : "Restarting…"
      color: Theme.ink
      font.family: Theme.serif
      font.pixelSize: root.failed ? Theme.huge : Theme.giant
      wrapMode: Text.Wrap
    }
    Text {
      width: parent.width
      horizontalAlignment: Text.AlignHCenter
      text: root.failed ? "You can keep using it. Try again in a minute."
        : root.off ? "To turn it back on, press the button at the top right of the keyboard."
        : "It will be back in about a minute."
      color: Theme.inkSoft
      font.family: Theme.sans
      font.pixelSize: Theme.label - 6
      font.weight: Font.Medium
      wrapMode: Text.Wrap
    }

    Item { width: 1; height: 30 }

    BigButton {
      visible: root.failed
      anchors.horizontalCenter: parent.horizontalCenter
      text: "OK"
      fontSize: Theme.label - 4
      implicitWidth: 280
      implicitHeight: 100
      elevation: 1
      onClicked: Power.dismiss()
    }
  }
}
