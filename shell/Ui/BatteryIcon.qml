import QtQuick
import qs.Common

// A battery drawn as an outline with a nub, filled as far as it's charged.
// `size` is the width; it's a little under half as tall.
Item {
  id: root

  property int size: 36
  property real percent: 100
  property color color: Theme.ink

  readonly property real line: Math.max(2, Math.round(size / 16))
  readonly property real nub: Math.round(size * 0.08)

  width: size
  height: size

  Rectangle {
    id: body
    anchors.left: parent.left
    anchors.verticalCenter: parent.verticalCenter
    width: root.size - root.nub - 1
    height: Math.round(root.size * 0.5)
    radius: Math.round(height * 0.22)
    color: "transparent"
    border.width: root.line
    border.color: root.color

    Rectangle {
      readonly property real inset: root.line + 2
      x: inset
      y: inset
      height: parent.height - inset * 2
      width: Math.max(2, (parent.width - inset * 2) * Math.max(0.06, Math.min(1, root.percent / 100)))
      radius: Math.max(1, body.radius - inset)
      color: root.color
    }
  }

  Rectangle {
    anchors.left: body.right
    anchors.leftMargin: 1
    anchors.verticalCenter: parent.verticalCenter
    width: root.nub
    height: Math.round(body.height * 0.42)
    radius: width / 2
    color: root.color
  }
}
