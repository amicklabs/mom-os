import QtQuick
import qs.Common

// A large, plainly labeled button. It darkens a little under the pointer and
// settles when pressed, so she sees it took the press.
Surface {
  id: root

  property string text: ""
  property string icon: ""
  property int fontSize: Theme.button
  property int iconSize: Math.round(fontSize * 1.15)
  property color fill: Theme.accent
  property color fillPressed: Theme.accentPressed
  property color ink: Theme.accentInk
  property int padding: 26
  property bool bold: true
  property int spacing: 12
  readonly property bool down: mouse.pressed
  readonly property bool hovered: mouse.containsMouse

  signal clicked()

  implicitHeight: Theme.buttonHeight
  implicitWidth: row.implicitWidth + padding * 2
  radius: Math.min(Theme.radius, height / 2)
  elevation: 0
  color: down ? fillPressed : hovered ? Qt.tint(fill, Qt.alpha(fillPressed, 0.45)) : fill
  scale: down ? 0.98 : 1
  Behavior on scale { NumberAnimation { duration: Theme.quick; easing.type: Easing.OutCubic } }

  Row {
    id: row
    anchors.centerIn: parent
    spacing: root.spacing

    Icon {
      visible: root.icon !== ""
      name: root.icon
      size: root.iconSize
      color: root.ink
      weight: 1.8
      anchors.verticalCenter: parent.verticalCenter
    }

    Text {
      text: root.text
      color: root.ink
      font.family: Theme.sans
      font.pixelSize: root.fontSize
      font.weight: root.bold ? Font.DemiBold : Font.Medium
      anchors.verticalCenter: parent.verticalCenter
    }
  }

  MouseArea {
    id: mouse
    anchors.fill: parent
    hoverEnabled: true
    cursorShape: Qt.PointingHandCursor
    onClicked: root.clicked()
  }
}
