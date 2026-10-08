import QtQuick
import qs.Common
import qs.Ui

// "Turn off the computer?" and "Restart the computer?", opened from More.
// One question, what happens next in plain words, and two large buttons:
// Cancel on the left and the action on the right, the way her Mac did it.
// Turning off also shows where the power key is, since that's what she'll
// need to turn it back on.
Item {
  id: root

  // "off" or "restart".
  property string action: "off"
  readonly property bool off: action === "off"

  Column {
    anchors.centerIn: parent
    width: parent.width - Theme.margin * 4
    spacing: 14

    Text {
      width: parent.width
      horizontalAlignment: Text.AlignHCenter
      text: root.off ? "Turn off the computer?" : "Restart the computer?"
      color: Theme.ink
      font.family: Theme.serif
      font.pixelSize: Theme.huge
      wrapMode: Text.Wrap
    }
    Text {
      width: parent.width
      horizontalAlignment: Text.AlignHCenter
      text: root.off ? "To turn it back on, press the button at the top right of the keyboard."
        : "It will be back in about a minute."
      color: Theme.inkSoft
      font.family: Theme.sans
      font.pixelSize: Theme.label - 6
      font.weight: Font.Medium
      wrapMode: Text.Wrap
    }

    Item { width: 1; height: root.off ? 12 : 30 }

    PowerKey {
      visible: root.off
      anchors.horizontalCenter: parent.horizontalCenter
    }

    Item { visible: root.off; width: 1; height: 18 }

    Row {
      anchors.horizontalCenter: parent.horizontalCenter
      spacing: 40

      BigButton {
        text: "Cancel"
        fontSize: Theme.label - 4
        width: Math.max(280, implicitWidth)
        implicitHeight: 100
        fill: Theme.surface
        fillPressed: Theme.pressed
        ink: Theme.ink
        elevation: down ? 0.5 : 1
        onClicked: Session.page = ""
      }

      BigButton {
        text: root.off ? "Turn off" : "Restart"
        icon: root.off ? "power" : "refresh"
        fontSize: Theme.label - 4
        width: Math.max(280, implicitWidth)
        implicitHeight: 100
        elevation: down ? 0.5 : 1
        onClicked: Power.start(root.action)
      }
    }
  }
}
