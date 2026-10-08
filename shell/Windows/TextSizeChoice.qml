import QtQuick
import qs.Common
import qs.Ui
import "../Common/validate.js" as Validate

// The Text size page under More: Regular, Large and X-Large, and under them a
// piece of her home screen that changes size as soon as she taps one.
Item {
  id: root

  readonly property int spacing: 24
  readonly property var sizes: [
    { id: "regular", name: "Regular" },
    { id: "large", name: "Large" },
    { id: "xlarge", name: "X-Large" }
  ]
  readonly property real cardWidth: (width - spacing * (sizes.length - 1)) / sizes.length

  Row {
    id: choices
    anchors.top: parent.top
    anchors.left: parent.left
    anchors.right: parent.right
    height: 156
    spacing: root.spacing

    Repeater {
      model: root.sizes

      ChoiceCard {
        id: choice
        required property var modelData
        width: root.cardWidth
        height: choices.height
        name: modelData.name
        selected: Appearance.textSize === modelData.id
        onChosen: Appearance.setTextSize(modelData.id)

        Text {
          anchors.centerIn: parent
          anchors.verticalCenterOffset: 2
          text: "Aa"
          color: Theme.accent
          font.family: Theme.serif
          font.pixelSize: Math.round(52 * Theme.textScales[choice.modelData.id])
        }
      }
    }
  }

  // The sample: her greeting, the date and her first tile, drawn at the
  // chosen size.
  Rectangle {
    id: sample
    anchors.top: choices.bottom
    anchors.topMargin: 26
    anchors.bottom: parent.bottom
    anchors.left: parent.left
    anchors.right: parent.right
    radius: Theme.radiusLarge
    color: Theme.backgroundTop
    border.width: 1
    border.color: Theme.line
    clip: true

    readonly property var today: new Date(Store.now)

    Column {
      id: greeting
      anchors.top: parent.top
      anchors.topMargin: 18
      anchors.left: parent.left
      anchors.leftMargin: 32
      anchors.right: parent.right
      anchors.rightMargin: 32
      spacing: 0

      Text {
        width: parent.width
        text: Validate.greeting(sample.today) + ", " + Store.personName
        color: Theme.ink
        font.family: Theme.serif
        font.pixelSize: Theme.scaled(54)
        elide: Text.ElideRight
      }
      Text {
        width: parent.width
        text: sample.today.toLocaleDateString(Qt.locale("en_US"), "dddd, MMMM d")
        color: Theme.inkSoft
        font.family: Theme.sans
        font.pixelSize: Theme.scaled(28)
        font.weight: Font.Medium
      }
    }

    Tile {
      id: tile
      anchors.top: greeting.bottom
      anchors.topMargin: 18
      anchors.bottom: parent.bottom
      anchors.bottomMargin: 26
      anchors.left: parent.left
      anchors.leftMargin: 28
      width: (sample.width - 28 * 2 - 26 * 2) / 3
      tile: Store.tiles.length ? Store.tiles[0] : null

      // Only a sample: a tap here does nothing.
      MouseArea { anchors.fill: parent }
    }

    Text {
      anchors.left: tile.right
      anchors.leftMargin: 40
      anchors.right: parent.right
      anchors.rightMargin: 40
      anchors.verticalCenter: tile.verticalCenter
      text: "Words and buttons everywhere will be this size."
      color: Theme.ink
      font.family: Theme.sans
      font.pixelSize: Theme.body + 4
      wrapMode: Text.Wrap
    }
  }
}
