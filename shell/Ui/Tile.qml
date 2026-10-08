import QtQuick
import qs.Common

// One home screen tile: its icon in a soft round well and a large label.
// Says "Opening…" for a few seconds after a press, since apps take a moment to
// appear.
Surface {
  id: root

  property var tile: null
  property bool opening: false
  // Unread Telegram messages, from momd.
  readonly property int unread: tile && tile.type === "app" && tile.app === "telegram" ? Store.telegramUnread : 0

  readonly property bool down: mouse.pressed
  readonly property bool hovered: mouse.containsMouse
  readonly property int wellSize: Math.min(height - 40, 88)

  radius: Theme.radiusLarge
  elevation: down ? 0.5 : hovered ? 2 : 1
  color: down ? Theme.pressed : Theme.surface
  scale: down ? 0.985 : 1
  Behavior on scale { NumberAnimation { duration: Theme.quick; easing.type: Easing.OutCubic } }

  Row {
    anchors.left: parent.left
    anchors.leftMargin: 30
    anchors.right: parent.right
    anchors.rightMargin: 20
    anchors.verticalCenter: parent.verticalCenter
    spacing: 26

    TileIcon {
      id: well
      size: root.wellSize
      anchors.verticalCenter: parent.verticalCenter
      name: root.tile ? (root.tile.icon || root.tile.id) : ""

      // Unread messages, on the Telegram tile only.
      Rectangle {
        visible: root.unread > 0
        anchors.right: parent.right
        anchors.top: parent.top
        anchors.rightMargin: -10
        anchors.topMargin: -8
        width: Math.max(height, count.implicitWidth + 20)
        height: 44
        radius: height / 2
        color: Theme.accent
        border.width: 3
        border.color: root.color

        Text {
          id: count
          anchors.centerIn: parent
          text: root.unread > 99 ? "99+" : String(root.unread)
          color: Theme.accentInk
          font.family: Theme.sans
          font.pixelSize: 26
          font.weight: Font.Bold
        }
      }
    }

    Column {
      anchors.verticalCenter: parent.verticalCenter
      width: parent.width - well.width - parent.spacing
      spacing: 0

      Text {
        width: parent.width
        text: root.tile ? root.tile.label : ""
        color: Theme.ink
        font.family: Theme.sans
        font.pixelSize: Theme.scaled(40)
        font.weight: Font.DemiBold
        elide: Text.ElideRight
      }

      Text {
        text: "Opening…"
        color: Theme.inkSoft
        font.family: Theme.sans
        font.pixelSize: Theme.body
        opacity: root.opening ? 1 : 0
        height: root.opening ? implicitHeight : 0
        Behavior on opacity { NumberAnimation { duration: 200 } }
      }

      Text {
        width: parent.width
        visible: root.unread > 0 && !root.opening
        text: root.unread === 1 ? "1 new message" : root.unread + " new messages"
        color: Theme.accent
        font.family: Theme.sans
        font.pixelSize: Theme.body
        font.weight: Font.DemiBold
        elide: Text.ElideRight
      }
    }
  }

  Timer {
    id: openingTimer
    interval: 4000
    onTriggered: root.opening = false
  }

  MouseArea {
    id: mouse
    anchors.fill: parent
    hoverEnabled: true
    cursorShape: Qt.PointingHandCursor
    onClicked: {
      if (!root.tile) return
      if (root.tile.type !== "page") {
        root.opening = true
        openingTimer.restart()
      }
      Session.openTile(root.tile)
    }
  }
}
