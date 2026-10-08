import QtQuick
import qs.Common

// One choice on the Colors page: a small picture of the home screen in
// that theme's colors, with its name underneath. The chosen one has a ring
// and a check mark. The small tiles follow her icon style.
Surface {
  id: root

  // An entry from themes.js.
  property var look: null
  property bool selected: false

  signal chosen()

  // Her first six tiles, so the colorful previews show her own apps.
  readonly property var iconNames: {
    var names = []
    var tiles = Store.tiles
    for (var i = 0; i < tiles.length && names.length < 6; i++)
      names.push(tiles[i].icon || tiles[i].id)
    return names.length ? names : ["family", "telegram", "youtube", "facebook", "email", "photos"]
  }

  readonly property bool down: mouse.pressed
  readonly property bool hovered: mouse.containsMouse
  readonly property int inset: 12

  radius: Theme.radiusLarge
  elevation: down ? 0.5 : hovered || selected ? 2 : 1
  outline: selected ? Theme.accent : "transparent"
  outlineWidth: selected ? 4 : 0
  scale: down ? 0.985 : 1
  Behavior on scale { NumberAnimation { duration: Theme.quick; easing.type: Easing.OutCubic } }

  // The picture.
  Rectangle {
    id: picture
    anchors.top: parent.top
    anchors.left: parent.left
    anchors.right: parent.right
    anchors.margins: root.inset
    height: parent.height - nameRow.height - root.inset * 2
    radius: Theme.radius - 4
    clip: true
    gradient: Gradient {
      GradientStop { position: 0; color: root.look.backgroundTop }
      GradientStop { position: 1; color: root.look.background }
    }

    // The bar.
    Rectangle {
      id: miniBar
      width: parent.width
      height: Math.round(parent.height * 0.16)
      color: root.look.bar

      Rectangle {
        x: 8
        anchors.verticalCenter: parent.verticalCenter
        width: parent.width * 0.13
        height: parent.height - 8
        radius: height / 2
        color: root.look.accent
      }
      Rectangle {
        anchors.right: parent.right
        anchors.rightMargin: 8
        anchors.verticalCenter: parent.verticalCenter
        width: parent.width * 0.2
        height: parent.height - 8
        radius: height / 2
        color: root.look.help
      }
    }

    Text {
      id: miniGreeting
      anchors.top: miniBar.bottom
      anchors.topMargin: 6
      anchors.left: parent.left
      anchors.leftMargin: 14
      text: "Good morning"
      color: root.look.ink
      font.family: Theme.serif
      font.pixelSize: 22
    }

    // Two rows of three tiles, like her home screen.
    Grid {
      anchors.top: miniGreeting.bottom
      anchors.topMargin: 8
      anchors.left: parent.left
      anchors.leftMargin: 14
      anchors.right: parent.right
      anchors.rightMargin: 14
      anchors.bottom: parent.bottom
      anchors.bottomMargin: 12
      columns: 3
      spacing: 8

      Repeater {
        model: root.iconNames.length
        Rectangle {
          required property int index
          width: (parent.width - 16) / 3
          height: Math.min((parent.height - 8) / 2, 56)
          radius: 6
          color: root.look.surface

          TileIcon {
            x: 6
            anchors.verticalCenter: parent.verticalCenter
            size: parent.height - 10
            name: root.iconNames[index] || ""
            dark: root.look.dark
            soft: root.look.accentSoft
            ink: root.look.accent
            weight: 2
          }
          Rectangle {
            x: parent.height + 4
            anchors.verticalCenter: parent.verticalCenter
            width: parent.width * 0.4
            height: 5
            radius: 2.5
            color: root.look.ink
            opacity: 0.8
          }
        }
      }
    }
  }

  Item {
    id: nameRow
    anchors.bottom: parent.bottom
    anchors.left: parent.left
    anchors.right: parent.right
    height: 54

    Text {
      anchors.left: parent.left
      anchors.leftMargin: root.inset + 10
      anchors.verticalCenter: parent.verticalCenter
      anchors.verticalCenterOffset: -3
      text: root.look ? root.look.name : ""
      color: Theme.ink
      font.family: Theme.sans
      font.pixelSize: Theme.scaled(30)
      font.weight: Font.DemiBold
    }

    Rectangle {
      visible: root.selected
      anchors.right: parent.right
      anchors.rightMargin: root.inset + 6
      anchors.verticalCenter: parent.verticalCenter
      anchors.verticalCenterOffset: -3
      width: 40
      height: 40
      radius: 20
      color: Theme.accent

      Icon {
        anchors.centerIn: parent
        name: "check"
        size: 26
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
