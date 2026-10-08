import QtQuick
import Quickshell
import Quickshell.Wayland
import qs.Common
import qs.Ui

// In-shell pages: the Family page opened by its tile, and the Internet
// connection, Speaker, Colors, Text size, Icons, Restart and Turn off pages
// opened from More. Drawn on the top layer below the bar, so a page shows even if an
// app is open on the current workspace.
PanelWindow {
  id: root

  required property var modelData
  screen: modelData

  visible: Session.page !== "" && !Session.locked
  anchors { top: true; bottom: true; left: true; right: true }
  exclusionMode: ExclusionMode.Normal
  color: Theme.background
  WlrLayershell.layer: WlrLayer.Top
  WlrLayershell.namespace: "momos-page"
  // Only the Internet connection page takes the keyboard, while it asks for
  // a password or a network name.
  WlrLayershell.keyboardFocus: wifiPage.wantsKeyboard ? WlrKeyboardFocus.Exclusive : WlrKeyboardFocus.None

  readonly property bool wifi: Session.page === "wifi"
  readonly property bool speaker: Session.page === "speaker"
  // "Restart the computer?" and "Turn off the computer?"
  readonly property bool power: Session.page === "restart" || Session.page === "turn-off"

  // The pages under More: page id, title and the line under it.
  readonly property var choicePages: ({
    "colors": { title: "Colors", hint: "Tap the colors you like. You can change them any time." },
    "text-size": { title: "Text size", hint: "Tap a size. The words change right away." },
    "icons": { title: "Icons", hint: "Tap the icons you like. You can change them any time." }
  })
  readonly property var choicePage: choicePages[Session.page] || null
  readonly property bool appearance: choicePage !== null
  readonly property string title: {
    if (wifi || speaker || power) return ""
    if (appearance) return choicePage.title
    var tiles = Store.tiles
    for (var i = 0; i < tiles.length; i++)
      if (tiles[i].type === "page" && tiles[i].page === Session.page) return tiles[i].label
    return Session.page === "family" ? "Family" : ""
  }

  Backdrop {
    anchors.fill: parent
  }

  Item {
    id: header
    visible: !root.wifi && !root.speaker && !root.power
    anchors.top: parent.top
    anchors.topMargin: 22
    anchors.left: parent.left
    anchors.leftMargin: Theme.margin
    anchors.right: parent.right
    anchors.rightMargin: Theme.margin
    height: 80

    BigButton {
      id: back
      visible: !root.appearance
      anchors.left: parent.left
      anchors.verticalCenter: parent.verticalCenter
      text: "Back"
      icon: "back"
      fontSize: Theme.label - 6
      implicitHeight: 80
      padding: 30
      fill: Theme.surface
      fillPressed: Theme.pressed
      ink: Theme.ink
      elevation: down ? 0.5 : 1
      onClicked: Session.page = ""
    }

    Column {
      anchors.left: root.appearance ? parent.left : back.right
      anchors.leftMargin: root.appearance ? 4 : 32
      anchors.right: done.visible ? done.left : parent.right
      anchors.rightMargin: 24
      anchors.verticalCenter: parent.verticalCenter
      spacing: -2

      Text {
        width: parent.width
        text: root.title
        color: Theme.ink
        font.family: Theme.serif
        font.pixelSize: Theme.title + 6
        elide: Text.ElideRight
      }
      Text {
        visible: family.visible || root.appearance
        width: parent.width
        text: root.appearance ? root.choicePage.hint
          : "Tap a face to send a message or call."
        color: Theme.inkSoft
        font.family: Theme.sans
        font.pixelSize: Theme.body
        elide: Text.ElideRight
      }
    }

    BigButton {
      id: done
      visible: root.appearance
      anchors.right: parent.right
      anchors.verticalCenter: parent.verticalCenter
      text: "Done"
      icon: "check"
      fontSize: Theme.label - 6
      implicitHeight: 80
      padding: 40
      elevation: 1
      onClicked: Session.page = ""
    }
  }

  // ---- Family ------------------------------------------------------------------

  // A face and a name for each person.
  Flickable {
    id: family
    visible: Session.page === "family" && Store.family.length > 0
    anchors.top: header.bottom
    anchors.topMargin: 24
    anchors.bottom: parent.bottom
    anchors.left: parent.left
    anchors.right: parent.right
    contentHeight: grid.height + 40
    clip: true
    boundsBehavior: Flickable.StopAtBounds

    readonly property int count: Store.family.length
    readonly property int columns: Math.min(4, Math.max(1, count))
    readonly property int cellWidth: Math.min(300, (width - Theme.margin * 2) / columns)
    readonly property int photoSize: Math.min(220, cellWidth - 60, height - 110)

    Grid {
      id: grid
      anchors.horizontalCenter: parent.horizontalCenter
      y: Math.max(0, (family.height - height) / 2 - 30)
      columns: family.columns
      rowSpacing: 24

      Repeater {
        model: Store.family

        Item {
          id: person
          required property var modelData
          width: family.cellWidth
          height: family.photoSize + 84

          Column {
            anchors.horizontalCenter: parent.horizontalCenter
            spacing: 14
            scale: tap.pressed ? 0.97 : tap.containsMouse ? 1.015 : 1
            Behavior on scale { NumberAnimation { duration: Theme.quick; easing.type: Easing.OutCubic } }

            Avatar {
              anchors.horizontalCenter: parent.horizontalCenter
              size: family.photoSize
              name: person.modelData.name
              photo: person.modelData.photo
            }
            Text {
              anchors.horizontalCenter: parent.horizontalCenter
              text: person.modelData.name
              color: Theme.ink
              font.family: Theme.sans
              font.pixelSize: Theme.label
              font.weight: Font.DemiBold
            }
          }

          MouseArea {
            id: tap
            anchors.fill: parent
            hoverEnabled: true
            cursorShape: Qt.PointingHandCursor
            onClicked: Session.openChat(person.modelData)
          }
        }
      }
    }
  }

  Text {
    visible: !family.visible && !root.appearance && !root.wifi && !root.speaker && !root.power
    anchors.centerIn: parent
    width: parent.width - Theme.margin * 4
    horizontalAlignment: Text.AlignHCenter
    text: Store.helperTitle + " hasn't set this up yet."
    color: Theme.inkSoft
    font.family: Theme.serif
    font.pixelSize: Theme.title
    wrapMode: Text.Wrap
  }

  // ---- Internet connection ---------------------------------------------------

  WifiPage {
    id: wifiPage
    anchors.fill: parent
    visible: root.wifi && root.visible
  }

  // ---- Speaker ------------------------------------------------------------------

  SpeakerPage {
    anchors.fill: parent
    visible: root.speaker && root.visible
  }

  // ---- Restart and Turn off ---------------------------------------------------

  PowerPage {
    anchors.fill: parent
    visible: root.power
    action: Session.page === "turn-off" ? "off" : "restart"
  }

  // ---- Colors, text size and icons -------------------------------------------
  // One choice to a page, opened from More.

  Item {
    visible: root.appearance
    anchors.top: header.bottom
    anchors.topMargin: 24
    anchors.bottom: parent.bottom
    anchors.bottomMargin: 28
    anchors.left: parent.left
    anchors.leftMargin: Theme.margin
    anchors.right: parent.right
    anchors.rightMargin: Theme.margin

    ColorsChoice {
      anchors.fill: parent
      visible: Session.page === "colors"
    }
    TextSizeChoice {
      anchors.fill: parent
      visible: Session.page === "text-size"
    }
    IconsChoice {
      anchors.fill: parent
      visible: Session.page === "icons"
    }
  }
}
