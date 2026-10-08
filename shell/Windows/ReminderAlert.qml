import QtQuick
import Quickshell
import Quickshell.Wayland
import qs.Common
import qs.Ui

// A reminder whose time has come: a big card in the middle of the screen,
// over whatever she's doing, until she presses OK. The rest of the screen keeps
// working, so a call or a video isn't interrupted. One at a time, oldest
// first.
PanelWindow {
  id: root

  required property var modelData
  screen: modelData

  readonly property var reminder: Session.dueReminder
  readonly property int count: Session.dueReminders.length
  // Room around the card for its shadow.
  readonly property int shadow: 40

  // No anchors: centered on the screen, clear of the banners at the top.
  visible: reminder !== null && !Session.locked
  exclusionMode: ExclusionMode.Normal
  implicitWidth: Math.min(1080, (screen ? screen.width : 1366) - Theme.margin * 2) + shadow * 2
  implicitHeight: Math.max(1, card.implicitHeight + shadow * 2)
  color: "transparent"
  WlrLayershell.layer: WlrLayer.Overlay
  WlrLayershell.namespace: "momos-reminder"
  WlrLayershell.keyboardFocus: WlrKeyboardFocus.None

  Surface {
    id: card
    x: root.shadow
    y: root.shadow - 8
    width: parent.width - root.shadow * 2
    implicitHeight: kicker.height + Math.max(body.implicitHeight, okButton.implicitHeight) + 36 + 34 + 40
    radius: Theme.radiusLarge + 6
    elevation: 3

    Row {
      id: kicker
      anchors.top: parent.top
      anchors.topMargin: 34
      anchors.left: parent.left
      anchors.leftMargin: 44
      spacing: 12
      height: 40

      Icon {
        anchors.verticalCenter: parent.verticalCenter
        name: "bell"
        size: 34
        color: Theme.accent
        weight: 1.8
      }
      Text {
        anchors.verticalCenter: parent.verticalCenter
        text: "Reminder" + (root.reminder ? " for " + root.reminder.label : "")
        color: Theme.accent
        font.family: Theme.sans
        font.pixelSize: Theme.label - 6
        font.weight: Font.DemiBold
      }
    }

    Text {
      anchors.right: parent.right
      anchors.rightMargin: 44
      anchors.verticalCenter: kicker.verticalCenter
      visible: root.count > 1
      text: "1 of " + root.count
      color: Theme.inkSoft
      font.family: Theme.sans
      font.pixelSize: Theme.body
      font.weight: Font.Medium
    }

    Text {
      id: body
      anchors.top: kicker.bottom
      anchors.topMargin: 18 + Math.max(0, (okButton.implicitHeight - implicitHeight) / 2)
      anchors.left: parent.left
      anchors.leftMargin: 44
      anchors.right: okButton.left
      anchors.rightMargin: 32
      text: root.reminder ? root.reminder.text : ""
      color: Theme.ink
      font.family: Theme.serif
      font.pixelSize: Theme.huge - 2
      lineHeight: 1.02
      wrapMode: Text.Wrap
      maximumLineCount: 3
      elide: Text.ElideRight
    }

    BigButton {
      id: okButton
      anchors.right: parent.right
      anchors.rightMargin: 40
      anchors.verticalCenter: body.verticalCenter
      text: "OK"
      fontSize: Theme.huge - 12
      implicitWidth: 210
      implicitHeight: 104
      elevation: 1
      onClicked: if (root.reminder) Session.answerReminder(root.reminder.key)
    }
  }
}
