import QtQuick
import qs.Common
import qs.Ui

// The lock screen's face: a greeting, dots for the digits typed so far, and
// a big keypad. Keyboard typing works too.
Rectangle {
  id: root

  // Holds `entered`, `checking` and `message`, and has submit(pin). Shared by
  // every screen's lock surface.
  property var controller: null
  property bool inputEnabled: true

  readonly property string entered: controller ? controller.entered : ""
  readonly property bool checking: controller ? controller.checking : false
  readonly property string message: controller ? controller.message : ""

  color: Theme.background

  function type(ch) {
    if (!inputEnabled || checking || entered.length >= 32) return
    controller.message = ""
    controller.entered = entered + ch
  }

  function backspace() {
    if (!inputEnabled || checking) return
    controller.entered = entered.slice(0, -1)
  }

  function clear() {
    if (!inputEnabled || checking) return
    controller.entered = ""
    controller.message = ""
  }

  function go() {
    if (!inputEnabled || checking || entered.length === 0) return
    controller.submit(entered)
  }

  function takeFocus() {
    keys.forceActiveFocus()
  }

  Component.onCompleted: Qt.callLater(takeFocus)

  Item {
    id: keys
    anchors.fill: parent
    focus: true
    Keys.onPressed: function(event) {
      if (event.key === Qt.Key_Return || event.key === Qt.Key_Enter) root.go()
      else if (event.key === Qt.Key_Backspace) root.backspace()
      else if (event.key === Qt.Key_Escape) root.clear()
      else if (event.text && event.text.length === 1 && event.text >= " ") root.type(event.text)
      event.accepted = true
    }
  }

  MouseArea {
    anchors.fill: parent
    onClicked: root.takeFocus()
  }

  Backdrop {
    anchors.fill: parent
  }

  readonly property var now: new Date(Store.now)

  Column {
    anchors.left: parent.left
    anchors.leftMargin: 76
    anchors.right: keypad.left
    anchors.rightMargin: 60
    anchors.verticalCenter: parent.verticalCenter
    spacing: 0

    Text {
      width: parent.width
      text: root.now.toLocaleTimeString(Qt.locale("en_US"), "h:mm AP")
        + "  ·  " + root.now.toLocaleDateString(Qt.locale("en_US"), "dddd, MMMM d")
      color: Theme.inkSoft
      font.family: Theme.sans
      font.pixelSize: Theme.body
      font.weight: Font.Medium
      elide: Text.ElideRight
    }
    Item { width: 1; height: 10 }
    Text {
      width: parent.width
      text: "Hello " + (Store.personName || "there") + "."
      color: Theme.ink
      font.family: Theme.serif
      font.pixelSize: Theme.huge + 12
      wrapMode: Text.Wrap
    }
    Text {
      width: parent.width
      text: "Type your PIN to unlock."
      color: Theme.ink
      font.family: Theme.sans
      font.pixelSize: Theme.label - 2
      wrapMode: Text.Wrap
    }
    Item { width: 1; height: 28 }

    Surface {
      width: parent.width
      height: 104
      radius: Theme.radiusLarge
      elevation: 1
      outline: root.message !== "" ? Theme.alert : "transparent"
      outlineWidth: root.message !== "" ? 3 : 0

      Row {
        anchors.centerIn: parent
        spacing: 22
        visible: root.entered.length > 0

        Repeater {
          model: Math.min(root.entered.length, 10)
          Rectangle {
            width: 30
            height: 30
            radius: 15
            color: Theme.ink
          }
        }
      }

      Text {
        anchors.centerIn: parent
        visible: root.entered.length === 0
        text: "Your PIN goes here"
        color: Theme.inkSoft
        font.family: Theme.sans
        font.pixelSize: Theme.body
      }
    }

    Item { width: 1; height: 16 }

    Text {
      width: parent.width
      height: Theme.label * 2 + 10
      text: root.checking ? "Checking…" : root.message
      color: root.checking ? Theme.inkSoft : Theme.alert
      font.family: Theme.sans
      font.pixelSize: Theme.label - 6
      font.weight: Font.DemiBold
      wrapMode: Text.Wrap
    }

    // Message cards can't show over the lock screen, so it says who wrote.
    // The card itself waits for her after she unlocks.
    Card {
      visible: Session.messagesWaiting > 0
      width: parent.width
      fill: Theme.message
      icon: "message"
      elevation: 1
      fontSize: Theme.body + 2
      text: Session.messagesWaiting === 1
        ? "New message from " + Session.messageFrom + ". Unlock to read it."
        : Session.messagesWaiting + " new messages. Unlock to read them."
    }

    Item { width: 1; height: 14; visible: Session.messagesWaiting > 0 && Store.viewerConnected }

    Card {
      visible: Store.viewerConnected
      width: parent.width
      fill: Theme.viewer
      icon: "eye"
      elevation: 1
      fontSize: Theme.body + 2
      text: Store.viewerText
    }

    Item {
      width: 1
      height: 14
      visible: Store.updating !== "" && (Session.messagesWaiting > 0 || Store.viewerConnected)
    }

    Card {
      visible: Store.updating !== ""
      width: parent.width
      fill: Theme.info
      icon: Store.updating === "done" ? "check" : "refresh"
      elevation: 1
      fontSize: Theme.body + 2
      text: Store.updatingText
    }
  }

  Grid {
    id: keypad
    anchors.right: parent.right
    anchors.rightMargin: 76
    anchors.verticalCenter: parent.verticalCenter
    columns: 3
    spacing: 16

    Repeater {
      model: ["1", "2", "3", "4", "5", "6", "7", "8", "9", "Clear", "0", "Unlock"]

      BigButton {
        required property string modelData
        readonly property bool digit: modelData.length === 1
        readonly property bool unlock: modelData === "Unlock"
        width: 140
        height: 118
        radius: Theme.radiusLarge
        text: modelData
        fontSize: digit ? Theme.huge - 8 : Theme.button
        bold: !digit
        fill: unlock ? Theme.accent : Theme.surface
        fillPressed: unlock ? Theme.accentPressed : Theme.pressed
        ink: unlock ? Theme.accentInk : Theme.ink
        elevation: down ? 0.5 : 1
        onClicked: {
          if (digit) root.type(modelData)
          else if (modelData === "Clear") root.clear()
          else root.go()
          root.takeFocus()
        }
      }
    }
  }
}
