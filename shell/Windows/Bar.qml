import QtQuick
import Quickshell
import Quickshell.Wayland
import qs.Common
import qs.Ui

// The bar across the top. It's on the overlay layer so nothing, not even a
// full-screen app, can hide the Home and help buttons, and it reserves its
// height so maximized apps sit below it.
//
// Left to right: Home, the clock, the name and icon of what she's on
// (Common/Foreground.qml), then on the right any warning in words, an eye
// while someone is looking at her screen, the status button with the Wi-Fi
// and battery icons, More and Help.
PanelWindow {
  id: root

  required property var modelData
  screen: modelData

  anchors { top: true; left: true; right: true }
  implicitHeight: Theme.barHeight
  exclusiveZone: Theme.barHeight
  color: Theme.bar
  WlrLayershell.layer: WlrLayer.Overlay
  WlrLayershell.namespace: "momos-bar"
  WlrLayershell.keyboardFocus: WlrKeyboardFocus.None

  readonly property var now: new Date(Store.now)
  readonly property int pad: 10
  readonly property bool offline: Store.online === false

  // A hairline under the bar, so it reads as the top edge of the page rather
  // than a separate toolbar.
  Rectangle {
    anchors.left: parent.left
    anchors.right: parent.right
    anchors.bottom: parent.bottom
    height: 1
    color: Theme.barLine
  }

  BigButton {
    id: homeButton
    anchors.left: parent.left
    anchors.leftMargin: root.pad
    anchors.verticalCenter: parent.verticalCenter
    height: parent.height - root.pad * 2
    text: "Home"
    icon: "home"
    fontSize: Theme.barText + 2
    padding: 22
    spacing: 10
    onClicked: Session.goHome()
  }

  Column {
    id: clock
    anchors.left: homeButton.right
    anchors.leftMargin: 28
    anchors.verticalCenter: parent.verticalCenter
    anchors.verticalCenterOffset: -1
    spacing: -4

    Text {
      text: root.now.toLocaleTimeString(Qt.locale("en_US"), "h:mm AP")
      color: Theme.ink
      font.family: Theme.serif
      font.pixelSize: Theme.barClock
      font.weight: Font.Medium
    }
    Text {
      text: root.now.toLocaleDateString(Qt.locale("en_US"), "dddd, MMM d")
      color: Theme.inkSoft
      font.family: Theme.sans
      font.pixelSize: Theme.barSmall
      font.weight: Font.Medium
    }
  }

  // What she's on: the app's icon and its name. Nothing on the home screen,
  // where a second "Home" beside the button would only be something else to
  // press. Centered on the bar when there's room, and never over the clock or
  // the buttons. When the bar is crowded (X-Large text with warnings and the
  // eye), a name that won't fit beside the icon loses the icon, and a word
  // too long for the room gets smaller rather than breaking in the middle.
  Item {
    id: showing
    readonly property var what: Foreground.current
    readonly property string label: what ? what.label : ""
    readonly property int gap: 24
    readonly property real leftEdge: clock.x + clock.width + gap
    readonly property real rightEdge: rightSide.x - gap
    readonly property real room: Math.max(0, rightEdge - leftEdge)
    readonly property real iconRoom: showingIcon.size + showingRow.spacing
    readonly property int twoLineSize: Math.min(Theme.barApp, 26)
    // A few pixels spare, since drawn text runs a little wider than measured.
    readonly property bool withIcon: oneLine.width + 6 <= room - iconRoom
      || longestWord.width + 6 <= room - iconRoom
    readonly property real space: room - (withIcon ? iconRoom : 0)

    visible: what !== null && room > 80
    height: parent.height
    width: Math.min(room, showingRow.implicitWidth)
    x: Math.max(leftEdge, Math.min((parent.width - width) / 2, rightEdge - width))

    TextMetrics {
      id: oneLine
      text: showing.label
      font.family: Theme.sans
      font.pixelSize: Theme.barApp
      font.weight: Font.DemiBold
    }

    // The longest word at the two-line size.
    TextMetrics {
      id: longestWord
      text: showing.label.split(/\s+/).reduce(function(a, b) { return b.length > a.length ? b : a }, "")
      font.family: Theme.sans
      font.pixelSize: showing.twoLineSize
      font.weight: Font.DemiBold
    }

    Row {
      id: showingRow
      anchors.verticalCenter: parent.verticalCenter
      spacing: 14

      TileIcon {
        id: showingIcon
        visible: showing.withIcon
        anchors.verticalCenter: parent.verticalCenter
        name: showing.what ? showing.what.icon : ""
        size: 56
        weight: 1.7
        // The app's own mark, whatever style her tiles use: this is where
        // she checks what she's on, and the Chrome or Telegram logo she
        // knows says it at a glance. Pages keep their line icons.
        colorful: showing.what !== null && showing.what.brand
      }

      // A name too long for one line goes on two, a little smaller.
      Text {
        readonly property bool twoLines: oneLine.width + 6 > showing.space
        anchors.verticalCenter: parent.verticalCenter
        width: Math.min(oneLine.width + 6, showing.space)
        text: showing.label
        color: Theme.ink
        font.family: Theme.sans
        font.pixelSize: !twoLines ? Theme.barApp
          : longestWord.width + 6 <= showing.space ? showing.twoLineSize
          : Math.max(18, Math.floor(showing.twoLineSize * showing.space / (longestWord.width + 6)))
        font.weight: Font.DemiBold
        lineHeight: 0.9
        wrapMode: Text.WordWrap
        maximumLineCount: 2
        elide: Text.ElideRight
      }
    }
  }

  Row {
    id: rightSide
    anchors.right: parent.right
    anchors.rightMargin: root.pad
    anchors.verticalCenter: parent.verticalCenter
    spacing: 14
    height: parent.height - root.pad * 2

    // A problem stays in words on the bar, so she doesn't have to tap to
    // find it. Tapping the words opens the same card as the status button.
    Column {
      id: warnings
      visible: root.offline || Store.batteryLow
      anchors.verticalCenter: parent.verticalCenter
      spacing: -4

      Warning { visible: root.offline; text: "No internet" }
      Warning { visible: Store.batteryLow; text: "Battery low" }
    }

    // While someone is looking at her screen: an eye on a pill in the
    // banner's color, with a mouse pointer beside it while they can use her
    // mouse. The banner said it in words when they connected; a tap says it
    // again (Session.qml). It stays through the few seconds a browser takes
    // to reconnect when control changes.
    Surface {
      id: eyeButton
      readonly property bool down: eyeMouse.pressed
      visible: Session.viewing
      height: parent.height
      width: eyeRow.implicitWidth + 30
      radius: Math.min(Theme.radius, height / 2)
      elevation: down ? 0 : 0.6
      color: down ? Qt.darker(Theme.viewer, 1.15)
        : eyeMouse.containsMouse ? Qt.darker(Theme.viewer, 1.07) : Theme.viewer
      scale: down ? 0.98 : 1
      Behavior on scale { NumberAnimation { duration: Theme.quick; easing.type: Easing.OutCubic } }

      Row {
        id: eyeRow
        anchors.centerIn: parent
        spacing: 0

        Icon {
          anchors.verticalCenter: parent.verticalCenter
          name: "eye"
          size: 36
          weight: 2
          color: Theme.bannerInk
        }
        Icon {
          visible: Session.viewerControl
          anchors.verticalCenter: parent.verticalCenter
          name: "pointer"
          size: 26
          weight: 2
          color: Theme.bannerInk
        }
      }

      MouseArea {
        id: eyeMouse
        anchors.fill: parent
        hoverEnabled: true
        cursorShape: Qt.PointingHandCursor
        onClicked: Session.showViewerNotice(Store.viewerText)
      }
    }

    // The status button: the Wi-Fi and battery icons on a light pill, like
    // More and Help. A tap opens a card with the same things in words
    // (StatusPanel.qml).
    Surface {
      id: statusButton
      readonly property bool down: statusMouse.pressed
      readonly property bool known: Store.online !== null || Store.battery !== null
      height: parent.height
      width: statusRow.implicitWidth + 44
      radius: Math.min(Theme.radius, height / 2)
      elevation: down ? 0 : 0.6
      color: down || Session.statusOpen ? Theme.pressed
        : statusMouse.containsMouse ? Qt.tint(Theme.surface, Qt.alpha(Theme.pressed, 0.45)) : Theme.surface
      scale: down ? 0.98 : 1
      Behavior on scale { NumberAnimation { duration: Theme.quick; easing.type: Easing.OutCubic } }

      function place() {
        Session.statusRight = statusButton.mapToItem(null, statusButton.width, 0).x
      }
      onXChanged: place()
      onWidthChanged: place()
      Component.onCompleted: place()

      Row {
        id: statusRow
        anchors.centerIn: parent
        spacing: 16

        Icon {
          visible: Store.online !== null
          anchors.verticalCenter: parent.verticalCenter
          name: root.offline ? "signalOff" : "signal"
          size: 34
          weight: 2
          color: root.offline ? Theme.alert : Theme.ink
        }

        Row {
          visible: Store.battery !== null
          anchors.verticalCenter: parent.verticalCenter
          spacing: 2

          BatteryIcon {
            anchors.verticalCenter: parent.verticalCenter
            size: 38
            percent: Store.battery ? Store.battery.percent : 0
            color: Store.batteryLow ? Theme.alert : Theme.ink
          }
          Icon {
            visible: Store.battery !== null && Store.battery.charging
            anchors.verticalCenter: parent.verticalCenter
            name: "bolt"
            size: 24
            color: Theme.ink
          }
        }

        // Nothing known yet: an "i", so it's still a button.
        Icon {
          visible: !statusButton.known
          anchors.verticalCenter: parent.verticalCenter
          name: "info"
          size: 34
          weight: 1.8
          color: Theme.ink
        }
      }

      MouseArea {
        id: statusMouse
        anchors.fill: parent
        hoverEnabled: true
        cursorShape: Qt.PointingHandCursor
        onClicked: {
          statusButton.place()
          Session.statusOpen = !Session.statusOpen
        }
      }
    }

    // A light pill; the volume keys on the keyboard handle sound, and a card
    // shows the level when it changes (VolumeCard.qml).
    BigButton {
      height: parent.height
      text: "More"
      icon: "more"
      padding: 24
      spacing: 10
      fontSize: Theme.barText
      fill: Theme.surface
      fillPressed: Theme.pressed
      ink: Theme.ink
      elevation: down ? 0 : 0.6
      onClicked: Session.moreOpen = !Session.moreOpen
    }

    // Opens the Help pop-up over whatever she's doing (HelpCard.qml). Styled
    // like More, so Home on the left stays the button that stands out.
    BigButton {
      id: helpButton
      height: parent.height
      text: "Help"
      icon: "help"
      padding: 24
      spacing: 10
      fontSize: Theme.barText
      fill: Theme.surface
      fillPressed: Theme.pressed
      ink: Theme.ink
      elevation: down ? 0 : 0.6
      onClicked: Session.toggleHelp()
    }
  }

  // "No internet" or "Battery low", bold in the alert color on the bar
  // itself, where the alert color is checked at 7:1.
  component Warning: Text {
    x: parent ? parent.width - width : 0
    color: Theme.alert
    font.family: Theme.sans
    font.pixelSize: Theme.barSmall
    font.weight: Font.Bold

    MouseArea {
      anchors.fill: parent
      cursorShape: Qt.PointingHandCursor
      onClicked: {
        statusButton.place()
        Session.statusOpen = !Session.statusOpen
      }
    }
  }
}
