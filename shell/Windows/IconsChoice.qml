import QtQuick
import qs.Common
import qs.Ui

// The Icons page under More: Simple and Colorful side by side, each showing
// her own tiles the way they would look.
Item {
  id: root

  readonly property int spacing: 28
  readonly property var styles: [
    { id: "simple", name: "Simple" },
    { id: "colorful", name: "Colorful" }
  ]
  // Up to six of her tiles, the ones on her home screen.
  readonly property var tiles: Store.tiles.slice(0, 6)

  Row {
    anchors.fill: parent
    spacing: root.spacing

    Repeater {
      model: root.styles

      ChoiceCard {
        id: choice
        required property var modelData
        width: (root.width - root.spacing) / 2
        height: root.height
        name: modelData.name
        selected: Appearance.icons === modelData.id
        onChosen: Appearance.setIcons(modelData.id)

        Grid {
          id: grid
          anchors.fill: parent
          anchors.leftMargin: 22
          anchors.rightMargin: 22
          anchors.topMargin: 10
          anchors.bottomMargin: 12
          columns: 2
          spacing: 16

          readonly property int rows: Math.max(1, Math.ceil(root.tiles.length / columns))
          readonly property real cellWidth: (width - spacing) / 2
          readonly property real cellHeight: Math.min(130, (height - spacing * (rows - 1)) / rows)

          Repeater {
            model: root.tiles

            Rectangle {
              id: mini
              required property var modelData
              width: grid.cellWidth
              height: grid.cellHeight
              radius: Theme.radius
              color: Theme.background

              TileIcon {
                id: icon
                x: 16
                anchors.verticalCenter: parent.verticalCenter
                size: Math.min(76, parent.height - 24)
                name: mini.modelData.icon || mini.modelData.id
                colorful: choice.modelData.id === "colorful"
                weight: 1.7
              }
              Text {
                anchors.left: icon.right
                anchors.leftMargin: 14
                anchors.right: parent.right
                anchors.rightMargin: 10
                anchors.verticalCenter: parent.verticalCenter
                text: mini.modelData.label
                color: Theme.ink
                font.family: Theme.sans
                font.pixelSize: Theme.label - 8
                font.weight: Font.DemiBold
                elide: Text.ElideRight
              }
            }
          }
        }
      }
    }
  }
}
