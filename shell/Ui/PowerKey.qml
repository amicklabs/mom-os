import QtQuick
import qs.Common

// A plain drawing of her keyboard with the power key, the last key of the top
// row on a MacBook Air, picked out in the accent color. Not every key is
// drawn, only enough rows for it to read as a keyboard.
Item {
  id: root

  property int keyWidth: 26
  property int gap: 5
  // The top row: Escape, F1 to F12 and the power key.
  readonly property int topKeys: 14
  readonly property int rowWidth: topKeys * keyWidth + (topKeys - 1) * gap
  readonly property color keyColor: Qt.alpha(Theme.inkSoft, 0.16)

  implicitWidth: rowWidth + 36
  implicitHeight: body.height

  Rectangle {
    id: body
    width: root.implicitWidth
    height: rows.implicitHeight + 36
    radius: 16
    color: Theme.surface
    border.width: 1
    border.color: Theme.line

    Column {
      id: rows
      anchors.centerIn: parent
      spacing: root.gap

      // The short top row, ending in the power key.
      Row {
        spacing: root.gap
        Repeater {
          model: root.topKeys
          Rectangle {
            required property int index
            readonly property bool power: index === root.topKeys - 1
            width: root.keyWidth
            height: 20
            radius: 4
            color: power ? Theme.accent : root.keyColor

            // A soft ring, so the key stands out at a glance.
            Rectangle {
              visible: parent.power
              anchors.fill: parent
              anchors.margins: -5
              radius: 8
              color: "transparent"
              border.width: 2
              border.color: Qt.alpha(Theme.accent, 0.45)
            }

            Icon {
              visible: parent.power
              anchors.centerIn: parent
              name: "power"
              size: 16
              color: Theme.accentInk
              weight: 2.2
            }
          }
        }
      }

      // The letter rows and the bottom row, as relative key widths.
      Repeater {
        model: [
          [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1.6],
          [1.6, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
          [1.9, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1.9],
          [2.4, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 2.4],
          [1, 1, 1, 1.25, 5.2, 1.25, 1, 1, 1, 1]
        ]
        Row {
          id: keyRow
          required property var modelData
          spacing: root.gap
          readonly property real total: modelData.reduce(function(a, b) { return a + b }, 0)
          readonly property real unit: (root.rowWidth - (modelData.length - 1) * root.gap) / total
          Repeater {
            model: keyRow.modelData
            Rectangle {
              required property var modelData
              width: Math.round(keyRow.unit * modelData)
              height: root.keyWidth
              radius: 4
              color: root.keyColor
            }
          }
        }
      }
    }
  }
}
