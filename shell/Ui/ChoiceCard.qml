import QtQuick
import qs.Common

// A choice on the Text size and Icons pages, like the theme cards: a sample
// on top, the name underneath, and a ring and check mark when it's the
// chosen one. Put the sample inside it.
Surface {
  id: root

  default property alias sample: sampleArea.data
  property string name: ""
  property bool selected: false

  signal chosen()

  readonly property bool down: mouse.pressed
  readonly property bool hovered: mouse.containsMouse
  readonly property int inset: 12

  radius: Theme.radiusLarge
  elevation: down ? 0.5 : hovered || selected ? 2 : 1
  outline: selected ? Theme.accent : "transparent"
  outlineWidth: selected ? 4 : 0
  scale: down ? 0.985 : 1
  Behavior on scale { NumberAnimation { duration: Theme.quick; easing.type: Easing.OutCubic } }

  Item {
    id: sampleArea
    anchors.top: parent.top
    anchors.left: parent.left
    anchors.right: parent.right
    anchors.bottom: nameRow.top
    anchors.topMargin: root.inset + 4
  }

  Item {
    id: nameRow
    anchors.bottom: parent.bottom
    anchors.left: parent.left
    anchors.right: parent.right
    height: Math.round(Theme.button * 1.8)

    Text {
      anchors.left: parent.left
      anchors.leftMargin: root.inset + 10
      anchors.verticalCenter: parent.verticalCenter
      anchors.verticalCenterOffset: -3
      text: root.name
      color: Theme.ink
      font.family: Theme.sans
      font.pixelSize: Theme.button
      font.weight: Font.DemiBold
    }

    Rectangle {
      visible: root.selected
      anchors.right: parent.right
      anchors.rightMargin: root.inset + 4
      anchors.verticalCenter: parent.verticalCenter
      anchors.verticalCenterOffset: -3
      width: 34
      height: 34
      radius: 17
      color: Theme.accent

      Icon {
        anchors.centerIn: parent
        name: "check"
        size: 22
        weight: 2.6
        color: Theme.accentInk
      }
    }
  }

  MouseArea {
    id: mouse
    anchors.fill: parent
    hoverEnabled: true
    cursorShape: Qt.PointingHandCursor
    onClicked: root.chosen()
  }
}
