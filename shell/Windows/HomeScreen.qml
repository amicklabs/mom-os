import QtQuick
import Quickshell
import Quickshell.Wayland
import qs.Common
import qs.Ui
import "../Common/validate.js" as Validate

// The home screen. It sits on the bottom layer, so app windows cover it and
// it shows through on the empty `home` workspace.
PanelWindow {
  id: root

  required property var modelData
  screen: modelData

  anchors { top: true; bottom: true; left: true; right: true }
  exclusionMode: ExclusionMode.Normal
  color: Theme.background
  WlrLayershell.layer: WlrLayer.Bottom
  WlrLayershell.namespace: "momos-home"
  WlrLayershell.keyboardFocus: WlrKeyboardFocus.None

  readonly property var today: new Date(Store.now)

  Backdrop {
    anchors.fill: parent
  }

  // Greeting: "Good morning, Mom" and "Thursday, September 25".
  Column {
    id: greeting
    anchors.top: parent.top
    anchors.topMargin: 22
    anchors.left: parent.left
    anchors.leftMargin: Theme.margin + 4
    spacing: 0
    visible: Store.config !== null

    Text {
      text: Validate.greeting(root.today) + ", " + Store.personName
      color: Theme.ink
      font.family: Theme.serif
      font.pixelSize: Theme.scaled(54)
    }
    Text {
      text: root.today.toLocaleDateString(Qt.locale("en_US"), "dddd, MMMM d")
      color: Theme.inkSoft
      font.family: Theme.sans
      font.pixelSize: Theme.scaled(28)
      font.weight: Font.Medium
    }
  }

  // Today's reminders still to come: "2:00 PM  Doctor appointment". One line,
  // so the tiles keep their room at 1366x768.
  Surface {
    id: todayCard

    readonly property var items: Store.remindersToday
    readonly property int shown: 2

    function htmlEscape(s) {
      return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    }

    visible: Store.config !== null && items.length > 0
    anchors.top: greeting.bottom
    anchors.topMargin: 14
    anchors.left: parent.left
    anchors.leftMargin: Theme.margin
    anchors.right: parent.right
    anchors.rightMargin: Theme.margin
    height: 72
    radius: Theme.radius
    elevation: 1

    Row {
      id: todayLabel
      anchors.left: parent.left
      anchors.leftMargin: 24
      anchors.verticalCenter: parent.verticalCenter
      spacing: 10

      Icon {
        anchors.verticalCenter: parent.verticalCenter
        name: "bell"
        size: 30
        color: Theme.accent
      }
      Text {
        anchors.verticalCenter: parent.verticalCenter
        text: "Today"
        color: Theme.accent
        font.family: Theme.serif
        font.pixelSize: Theme.body + 6
        font.italic: true
      }
    }

    Rectangle {
      id: todayRule
      anchors.left: todayLabel.right
      anchors.leftMargin: 22
      anchors.verticalCenter: parent.verticalCenter
      width: 1
      height: parent.height - 30
      color: Theme.line
    }

    Text {
      anchors.left: todayRule.right
      anchors.leftMargin: 22
      anchors.right: parent.right
      anchors.rightMargin: 24
      anchors.verticalCenter: parent.verticalCenter
      textFormat: Text.StyledText
      text: {
        var parts = []
        var list = todayCard.items
        for (var i = 0; i < list.length && i < todayCard.shown; i++)
          parts.push("<b>" + todayCard.htmlEscape(list[i].label) + "</b>&nbsp;&nbsp;" + todayCard.htmlEscape(list[i].text))
        var more = list.length - todayCard.shown
        if (more > 0) parts.push("and " + more + " more later")
        return parts.join("&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;")
      }
      color: Theme.ink
      font.family: Theme.sans
      font.pixelSize: Theme.body + 4
      elide: Text.ElideRight
      maximumLineCount: 1
    }
  }

  // Tiles, three to a row. A short last row is centered.
  Item {
    id: tileArea
    visible: Store.config !== null
    anchors.top: todayCard.visible ? todayCard.bottom : greeting.bottom
    anchors.topMargin: todayCard.visible ? 20 : 26
    anchors.bottom: parent.bottom
    anchors.bottomMargin: 32
    anchors.left: parent.left
    anchors.leftMargin: Theme.margin
    anchors.right: parent.right
    anchors.rightMargin: Theme.margin

    readonly property int columns: 3
    readonly property int count: Store.tiles.length
    readonly property int rows: Math.max(1, Math.ceil(count / columns))
    readonly property int spacing: Theme.gap + 6
    readonly property real tileWidth: (width - spacing * (columns - 1)) / columns
    readonly property real tileHeight: Math.min(220, (height - spacing * (rows - 1)) / rows)

    Column {
      anchors.horizontalCenter: parent.horizontalCenter
      spacing: tileArea.spacing

      Repeater {
        model: tileArea.rows

        Row {
          required property int index
          readonly property int first: index * tileArea.columns
          anchors.horizontalCenter: parent.horizontalCenter
          spacing: tileArea.spacing

          Repeater {
            model: Store.tiles.slice(parent.first, parent.first + tileArea.columns)

            Tile {
              required property var modelData
              tile: modelData
              width: tileArea.tileWidth
              height: tileArea.tileHeight
            }
          }
        }
      }
    }
  }

  // No usable config: a friendly screen instead of a blank one.
  Column {
    visible: Store.config === null && Store.configLoaded
    anchors.centerIn: parent
    width: parent.width - Theme.margin * 6
    spacing: 26

    Text {
      width: parent.width
      horizontalAlignment: Text.AlignHCenter
      text: Store.helperTitle + " needs to finish setting up this computer."
      color: Theme.ink
      font.family: Theme.serif
      font.pixelSize: Theme.huge
      lineHeight: 1.05
      wrapMode: Text.Wrap
    }
    Rectangle {
      anchors.horizontalCenter: parent.horizontalCenter
      width: 64
      height: 2
      color: Theme.accent
    }
    Text {
      width: parent.width
      horizontalAlignment: Text.AlignHCenter
      text: "It isn't your fault. Nothing is broken."
      color: Theme.inkSoft
      font.family: Theme.sans
      font.pixelSize: Theme.label - 2
      wrapMode: Text.Wrap
    }
  }
}
