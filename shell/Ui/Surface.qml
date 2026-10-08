import QtQuick
import QtQuick.Effects
import qs.Common

// A rounded card that sits a little above the page on a soft shadow, instead
// of being outlined. `elevation` 0 is flat, 1 a tile, 2 a raised card, 3 a
// card over other things (reminders, the More panel).
Item {
  id: root

  default property alias content: face.data
  property color color: elevation >= 3 ? Theme.raised : Theme.surface
  property int radius: Theme.radiusLarge
  property real elevation: 1
  property color outline: "transparent"
  property int outlineWidth: 0

  RectangularShadow {
    anchors.fill: face
    visible: root.elevation > 0
    radius: root.radius
    offset.y: 2 + root.elevation * 3
    blur: 8 + root.elevation * 12
    spread: -2
    color: Qt.alpha(Theme.shadow, Math.min(0.9, Theme.shadowStrength * (0.7 + root.elevation * 0.5)))
    Behavior on offset.y { NumberAnimation { duration: Theme.quick; easing.type: Easing.OutCubic } }
    Behavior on blur { NumberAnimation { duration: Theme.quick; easing.type: Easing.OutCubic } }
  }

  Rectangle {
    id: face
    anchors.fill: parent
    radius: root.radius
    color: root.color
    border.width: root.outlineWidth
    border.color: root.outline
  }
}
