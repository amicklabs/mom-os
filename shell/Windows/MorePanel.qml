import QtQuick
import Quickshell
import Quickshell.Wayland
import qs.Common
import qs.Ui

// The "More" panel: Lock, the Internet connection page, Restart and Turn off,
// then the pages for colors, text size and icons, the Speaker page, and a way
// to close it.
PanelWindow {
  id: root

  required property var modelData
  screen: modelData

  visible: Session.moreOpen && !Session.locked
  anchors { top: true; bottom: true; left: true; right: true }
  exclusionMode: ExclusionMode.Normal
  color: "transparent"
  WlrLayershell.layer: WlrLayer.Overlay
  WlrLayershell.namespace: "momos-more"
  WlrLayershell.keyboardFocus: WlrKeyboardFocus.None

  // The page behind dims a little and the card fades in.
  property real shown: 0
  onVisibleChanged: shown = 0
  Timer {
    running: root.visible
    interval: 1
    onTriggered: root.shown = 1
  }

  function openPage(id) {
    Session.moreOpen = false
    Session.page = id
  }

  Rectangle {
    anchors.fill: parent
    color: Theme.scrim
    opacity: root.shown
    Behavior on opacity { NumberAnimation { duration: 180 } }
  }

  // A tap outside the card closes it.
  MouseArea {
    anchors.fill: parent
    onClicked: Session.moreOpen = false
  }

  // One choice in the panel: an icon in a soft well and a name, with an
  // optional line under it. Without `framed` it's a plain row, for the
  // grouped list.
  component MoreItem: Surface {
    id: item
    property string icon: ""
    property string text: ""
    property string caption: ""
    property bool framed: true
    property int wellSize: 64
    signal clicked()
    readonly property bool down: tap.pressed
    width: parent.width
    height: Math.max(104, words.implicitHeight + 28)
    radius: framed ? Theme.radius : 0
    elevation: 0
    color: down ? Theme.pressed : tap.containsMouse ? Qt.tint(Theme.surface, Qt.alpha(Theme.pressed, 0.6))
      : framed ? Theme.surface : "transparent"
    outline: framed ? Theme.line : "transparent"
    outlineWidth: framed ? 1 : 0

    Rectangle {
      id: well
      anchors.left: parent.left
      anchors.leftMargin: 20
      anchors.verticalCenter: parent.verticalCenter
      width: item.wellSize
      height: item.wellSize
      radius: item.wellSize / 2
      color: Theme.accentSoft

      Icon {
        anchors.centerIn: parent
        name: item.icon
        size: Math.round(item.wellSize * 0.53)
        color: Theme.accent
        weight: 1.7
      }
    }

    Column {
      id: words
      anchors.left: well.right
      anchors.leftMargin: 20
      anchors.right: parent.right
      anchors.rightMargin: 20
      anchors.verticalCenter: parent.verticalCenter
      spacing: 0

      Text {
        width: parent.width
        text: item.text
        color: Theme.ink
        font.family: Theme.sans
        font.pixelSize: Theme.label - 4
        font.weight: Font.DemiBold
        elide: Text.ElideRight
      }
      Text {
        visible: item.caption !== ""
        width: parent.width
        text: item.caption
        color: Theme.inkSoft
        font.family: Theme.sans
        font.pixelSize: Theme.small
        wrapMode: Text.Wrap
      }
    }

    MouseArea {
      id: tap
      anchors.fill: parent
      hoverEnabled: true
      cursorShape: Qt.PointingHandCursor
      onClicked: item.clicked()
    }
  }

  // A few plain rows on one card, with a hairline between them. Each row
  // opens a page: { page, icon, text }.
  component MoreGroup: Surface {
    id: group
    property var items: []
    width: parent.width
    height: rows.height
    radius: Theme.radius
    elevation: 0
    outline: Theme.line
    outlineWidth: 1

    Column {
      id: rows
      width: parent.width

      Repeater {
        model: group.items

        Item {
          id: entry
          required property var modelData
          required property int index
          width: rows.width
          height: 84

          MoreItem {
            anchors.fill: parent
            anchors.margins: 1
            framed: false
            radius: Theme.radius - 1
            wellSize: 54
            icon: entry.modelData.icon
            text: entry.modelData.text
            onClicked: root.openPage(entry.modelData.page)
          }

          Rectangle {
            visible: entry.index > 0
            anchors.top: parent.top
            x: 20
            width: parent.width - 40
            height: 1
            color: Theme.line
          }
        }
      }
    }
  }

  Surface {
    id: card
    anchors.top: parent.top
    anchors.topMargin: 14
    anchors.right: parent.right
    anchors.rightMargin: 14
    // Two columns, Lock, Internet connection, Restart and Turn off on the
    // left and "How it looks" and Speaker on the right, with Close across
    // the bottom. One column would run off the bottom of the 768-pixel screen.
    readonly property int columnWidth: Math.round(540 * Math.max(1, Theme.textScale)) - 56
    width: columnWidth * 2 + 32 + 56
    height: content.implicitHeight + 56
    radius: Theme.radiusLarge + 2
    elevation: 3
    opacity: root.shown
    transform: Translate { y: (1 - root.shown) * -8 }
    Behavior on opacity { NumberAnimation { duration: 180; easing.type: Easing.OutCubic } }

    // Swallow taps on the card itself.
    MouseArea { anchors.fill: parent }

    Column {
      id: content
      anchors.centerIn: parent
      width: parent.width - 56
      spacing: 16

      Grid {
        columns: 2
        columnSpacing: 32
        rowSpacing: 16

        Column {
          width: card.columnWidth
          spacing: 16

          MoreItem {
            icon: "lock"
            text: "Lock the screen"
            caption: "You'll need your PIN to unlock it."
            onClicked: Session.lock()
          }

          // Joining a network away from home, when no one can help remotely.
          MoreItem {
            icon: "signal"
            text: "Internet connection"
            caption: Store.online === false ? "Not working. Pick a network here."
              : Store.wifiName !== "" ? "Connected to " + Store.wifiName
              : "Pick a network to join."
            onClicked: root.openPage("wifi")
          }

          // Restart and Turn off on a card of their own, well apart from
          // "How it looks", so neither is pressed by mistake. Each asks first.
          Item { width: 1; height: 8 }

          MoreGroup {
            items: [
              { page: "restart", icon: "refresh", text: "Restart the computer" },
              { page: "turn-off", icon: "power", text: "Turn off the computer" }
            ]
          }
        }

        // Colors, text size and icons, each on its own page, grouped under a
        // quiet heading so Lock stands apart. The Speaker page below them.
        Column {
          width: card.columnWidth
          spacing: 8

          Text {
            leftPadding: 6
            text: "How it looks"
            color: Theme.inkSoft
            font.family: Theme.serif
            font.pixelSize: Theme.body + 2
            font.italic: true
          }

          MoreGroup {
            items: [
              { page: "colors", icon: "look", text: "Colors" },
              { page: "text-size", icon: "textsize", text: "Text size" },
              { page: "icons", icon: "app", text: "Icons" }
            ]
          }

          Item { width: 1; height: 8 }

          // Playing the sound on a Bluetooth speaker. A card of its own, not
          // under "How it looks"; a heading for it wouldn't fit at X-Large.
          MoreItem {
            icon: "speaker"
            text: "Speaker"
            caption: Speaker.playingOnSpeaker ? "Playing on " + Speaker.playingOn : "Play sound on a speaker."
            onClicked: root.openPage("speaker")
          }
        }
      }

      Item { width: 1; height: 2 }

      BigButton {
        width: parent.width
        implicitHeight: Theme.bigButtonHeight - 8
        text: "Close"
        fontSize: Theme.label - 6
        fill: Theme.quiet
        fillPressed: Theme.quietPressed
        ink: Theme.ink
        onClicked: Session.moreOpen = false
      }
    }
  }
}
