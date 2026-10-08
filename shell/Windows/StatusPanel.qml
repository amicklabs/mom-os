import QtQuick
import Quickshell
import Quickshell.Wayland
import qs.Common
import qs.Ui

// The card under the bar's status button: the internet and the battery in
// words. A tap outside it, Close, or 30 seconds closes it. It sits below any
// banner, so "Sam is looking at your screen" stays in sight.
PanelWindow {
  id: root

  required property var modelData
  screen: modelData

  visible: Session.statusOpen && !Session.locked && !Session.screensaver
  anchors { top: true; bottom: true; left: true; right: true }
  exclusionMode: ExclusionMode.Normal
  color: "transparent"
  WlrLayershell.layer: WlrLayer.Overlay
  WlrLayershell.namespace: "momos-status"
  WlrLayershell.keyboardFocus: WlrKeyboardFocus.None

  readonly property var battery: Store.battery
  readonly property int percent: battery ? Math.round(battery.percent) : 0

  readonly property string internetTitle: Store.online === true ? "The internet is working"
    : Store.online === false ? "The internet isn't working" : "Checking the internet"
  readonly property string internetLine: {
    if (Store.online === true) return Store.wifiName !== "" ? "Connected to " + Store.wifiName : ""
    if (Store.online === false) return "It isn't your fault."
    return ""
  }
  readonly property string batteryTitle: !battery ? ""
    : battery.charging && percent >= 100 ? "Battery: full" : "Battery: " + percent + "%"
  readonly property string batteryLine: {
    if (!battery) return ""
    if (battery.charging) return percent >= 100 ? "The charger is plugged in." : "Charging"
    if (Store.batteryLow) return "Low. Plug in the charger soon."
    if (percent >= 95) return "Full"
    return "The charger isn't plugged in."
  }

  property real shown: 0
  onVisibleChanged: shown = 0
  Timer {
    running: root.visible
    interval: 1
    onTriggered: root.shown = 1
  }
  Timer {
    running: root.visible
    interval: 30000
    onTriggered: Session.statusOpen = false
  }

  // A tap outside the card closes it.
  MouseArea {
    anchors.fill: parent
    onClicked: Session.statusOpen = false
  }

  Surface {
    id: card
    elevation: 3
    radius: Theme.radiusLarge
    width: Math.min(640, root.width - 2 * Theme.gap)
    height: column.implicitHeight + 56
    x: Math.max(Theme.gap, Math.min(root.width - width - 10, Session.statusRight - width))
    // Below the banners when it fits there; a long offline card may be
    // partly covered rather than the status card running off the screen.
    y: Math.max(12, Math.min(Session.bannersBottom, root.height - height - 12))
    opacity: root.shown
    Behavior on opacity { NumberAnimation { duration: 180 } }

    // Taps on the card stay on the card.
    MouseArea { anchors.fill: parent }

    Column {
      id: column
      anchors.left: parent.left
      anchors.right: parent.right
      anchors.top: parent.top
      anchors.margins: 28
      spacing: 22

      StatusRow {
        title: root.internetTitle
        line: root.internetLine
        alert: Store.online === false

        Icon {
          anchors.centerIn: parent
          name: Store.online === false ? "signalOff" : "signal"
          size: 38
          weight: 1.8
          color: Store.online === false ? Theme.alert : Theme.accent
        }
      }

      BigButton {
        visible: Store.online === false
        x: 92
        text: "Connect to a network"
        icon: "signal"
        fontSize: Theme.button
        fill: Theme.surface
        fillPressed: Theme.pressed
        ink: Theme.ink
        elevation: down ? 0.5 : 1
        onClicked: Session.page = "wifi"
      }

      StatusRow {
        visible: root.battery !== null
        title: root.batteryTitle
        line: root.batteryLine
        alert: Store.batteryLow

        BatteryIcon {
          anchors.centerIn: parent
          size: 40
          percent: root.percent
          color: Store.batteryLow ? Theme.alert : Theme.accent
        }
      }

      BigButton {
        anchors.right: parent.right
        text: "Close"
        fontSize: Theme.button
        fill: Theme.accent
        fillPressed: Theme.accentPressed
        ink: Theme.accentInk
        onClicked: Session.statusOpen = false
      }
    }
  }

  // An icon in a soft well, a title and a line under it.
  component StatusRow: Item {
    id: row
    default property alias icon: well.data
    property string title: ""
    property string line: ""
    property bool alert: false
    width: parent ? parent.width : 0
    height: Math.max(well.height, words.implicitHeight)

    Rectangle {
      id: well
      anchors.left: parent.left
      anchors.verticalCenter: parent.verticalCenter
      width: 72
      height: 72
      radius: 36
      color: Theme.accentSoft
    }

    Column {
      id: words
      anchors.left: well.right
      anchors.leftMargin: 20
      anchors.right: parent.right
      anchors.verticalCenter: parent.verticalCenter
      spacing: 2

      Text {
        width: parent.width
        text: row.title
        color: Theme.ink
        font.family: Theme.sans
        font.pixelSize: Theme.label - 6
        font.weight: row.alert ? Font.Bold : Font.DemiBold
        wrapMode: Text.Wrap
      }
      Text {
        visible: row.line !== ""
        width: parent.width
        text: row.line
        color: Theme.ink
        font.family: Theme.sans
        font.pixelSize: Theme.body
        wrapMode: Text.Wrap
      }
    }
  }
}
