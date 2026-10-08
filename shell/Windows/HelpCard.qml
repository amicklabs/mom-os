import QtQuick
import Quickshell
import Quickshell.Wayland
import qs.Common
import qs.Ui

// The Help pop-up: a card in the middle of the screen, over whatever she's
// doing, with the app still there around it under a soft shade. She can write
// to the helper, show the screen, ask for a call, or say it out loud, and the
// card then says plainly what happened. Session.qml does the sending.
//
// While the screen's picture is taken the whole window is hidden, so neither
// the card nor the shade is in it.
PanelWindow {
  id: root

  required property var modelData
  screen: modelData

  readonly property string stage: Session.helpStage
  readonly property string helper: Store.helperName
  readonly property string helperTitle: Store.helperTitle
  readonly property bool asked: Session.helpKinds.indexOf("call-me") >= 0
  readonly property bool showed: Session.helpKinds.indexOf("screenshot") >= 0
  readonly property real elapsed: stage === "recording" ? Math.max(0, (clock.now - Session.helpRecordingSince) / 1000) : 0
  readonly property int maxSeconds: 60

  visible: Session.helpOpen && !Session.locked && stage !== "hidden"
  anchors { top: true; bottom: true; left: true; right: true }
  exclusionMode: ExclusionMode.Ignore
  color: "transparent"
  WlrLayershell.layer: WlrLayer.Overlay
  WlrLayershell.namespace: "momos-help"
  // The keyboard comes here while it's up, for her words and for Esc.
  WlrLayershell.keyboardFocus: visible ? WlrKeyboardFocus.Exclusive : WlrKeyboardFocus.None

  onVisibleChanged: if (visible) focusTimer.restart()
  onStageChanged: if (visible) focusTimer.restart()

  Timer {
    id: focusTimer
    interval: 50
    onTriggered: {
      if (root.stage === "compose") words.forceActiveFocus()
      else keys.forceActiveFocus()
    }
  }

  // A clock for the recording timer, finer than Store.now.
  Item {
    id: clock
    property real now: Date.now()
    Timer {
      interval: 200
      repeat: true
      running: root.stage === "recording"
      onTriggered: {
        clock.now = Date.now()
        // A minute is the most; then it goes by itself.
        if (root.elapsed >= root.maxSeconds) Session.sendHelp({ text: Session.helpDraft, voice: true })
      }
    }
  }

  // "Sam has your message." fades after 20 seconds unless she's already
  // pressed OK.
  Timer {
    interval: 20000
    running: root.visible && root.stage === "sent"
    onTriggered: Session.closeHelp()
  }

  // The shade over her app. A click on it closes the pop-up, as Esc does.
  Rectangle {
    anchors.fill: parent
    color: Theme.scrim
    MouseArea {
      anchors.fill: parent
      onClicked: Session.closeHelp()
    }
  }

  Item {
    id: keys
    anchors.fill: parent
    focus: true
    Keys.onEscapePressed: Session.closeHelp()
  }

  Surface {
    id: card
    // Centered in the space under the bar.
    anchors.centerIn: parent
    anchors.verticalCenterOffset: Math.min(Theme.barHeight / 2, (parent.height - height) / 2 - 12)
    width: Math.min(1060, parent.width - Theme.margin * 2)
    height: Math.min(parent.height - 24, body.implicitHeight + 76)
    radius: Theme.radiusLarge + 6
    elevation: 3

    // Clicks on the card stay on the card.
    MouseArea { anchors.fill: parent }

    Item {
      id: body
      anchors.fill: parent
      anchors.margins: 38
      implicitHeight: compose.visible ? compose.implicitHeight
        : recording.visible ? recording.implicitHeight
        : result.implicitHeight
      Keys.onEscapePressed: Session.closeHelp()

      // ---- her words and the four ways to ask -------------------------------
      Column {
        id: compose
        visible: root.stage === "compose"
        width: parent.width
        spacing: 16

        Text {
          width: parent.width
          text: "Get help from " + root.helper
          color: Theme.ink
          font.family: Theme.serif
          font.pixelSize: Theme.title + 4
          font.weight: Font.Medium
          wrapMode: Text.Wrap
        }

        Text {
          visible: Store.online === false
          width: parent.width
          text: "The internet isn't working right now. What you send will go by itself when it's back."
          color: Theme.alert
          font.family: Theme.sans
          font.pixelSize: Theme.body
          font.weight: Font.Medium
          wrapMode: Text.Wrap
        }

        Column {
          width: parent.width
          spacing: 8

          Text {
            width: parent.width
            text: "Tell " + root.helper + " what's happening (you can skip this)"
            color: Theme.inkSoft
            font.family: Theme.sans
            font.pixelSize: Theme.body
            font.weight: Font.Medium
            wrapMode: Text.Wrap
          }

          Rectangle {
            id: box
            width: parent.width
            height: Math.round(words.font.pixelSize * 1.3 * 3 + 30)
            radius: Theme.radius
            color: Theme.dark ? Qt.darker(Theme.raised, 1.25) : Theme.background
            border.width: words.activeFocus ? 3 : 2
            border.color: words.activeFocus ? Theme.accent : Theme.line

            Flickable {
              id: flick
              anchors.fill: parent
              anchors.margins: 14
              contentWidth: width
              contentHeight: words.implicitHeight
              clip: true
              boundsBehavior: Flickable.StopAtBounds

              function ensureVisible(r) {
                if (contentY >= r.y) contentY = r.y
                else if (contentY + height <= r.y + r.height) contentY = r.y + r.height - height
              }

              TextEdit {
                id: words
                width: flick.width
                text: Session.helpDraft
                color: Theme.ink
                font.family: Theme.sans
                font.pixelSize: Theme.body + 4
                wrapMode: TextEdit.Wrap
                selectByMouse: true
                selectionColor: Theme.accentSoft
                selectedTextColor: Theme.ink
                cursorDelegate: Rectangle { width: 3; color: Theme.accent }
                onCursorRectangleChanged: flick.ensureVisible(cursorRectangle)
                onTextChanged: {
                  if (text.length > 1000) text = text.slice(0, 1000)
                  if (Session.helpDraft !== text) Session.helpDraft = text
                }
                Keys.onEscapePressed: Session.closeHelp()
                Connections {
                  target: Session
                  function onHelpDraftChanged() { if (words.text !== Session.helpDraft) words.text = Session.helpDraft }
                }
              }
            }

            // Clicking anywhere in the box puts the cursor there.
            MouseArea {
              anchors.fill: parent
              z: -1
              cursorShape: Qt.IBeamCursor
              onClicked: words.forceActiveFocus()
            }
          }
        }

        Grid {
          id: ways
          width: parent.width
          columns: 2
          columnSpacing: 16
          rowSpacing: 16
          readonly property int cell: (width - columnSpacing) / 2
          readonly property bool hasWords: Session.helpDraft.trim() !== ""

          BigButton {
            width: ways.cell
            height: 84
            text: "Send to " + root.helper
            icon: "send"
            fontSize: Theme.button + 2
            enabled: ways.hasWords
            fill: enabled ? Theme.accent : Theme.quiet
            fillPressed: enabled ? Theme.accentPressed : Theme.quiet
            ink: enabled ? Theme.accentInk : Theme.inkSoft
            elevation: enabled ? 1 : 0
            opacity: enabled ? 1 : 0.75
            onClicked: Session.sendHelp({ text: Session.helpDraft })
          }
          Way {
            width: ways.cell
            text: "Show " + root.helper + " my screen"
            icon: "screen"
            onClicked: Session.sendHelp({ text: Session.helpDraft, screenshot: true })
          }
          Way {
            width: ways.cell
            text: "Ask " + root.helper + " to call me"
            icon: "phone"
            onClicked: Session.sendHelp({ text: Session.helpDraft, callMe: true })
          }
          Way {
            width: ways.cell
            text: "Say it out loud"
            icon: "mic"
            onClicked: Session.startVoice()
          }
        }

        Text {
          visible: Session.helpVoiceProblem !== ""
          width: parent.width
          text: Session.helpVoiceProblem
          color: Theme.alert
          font.family: Theme.sans
          font.pixelSize: Theme.body
          font.weight: Font.Medium
          wrapMode: Text.Wrap
        }

        Item {
          width: parent.width
          height: 68

          // Her own Telegram chat with the helper, for when she'd rather.
          Row {
            id: chatLink
            visible: Store.helperTelegram !== ""
            anchors.left: parent.left
            anchors.verticalCenter: parent.verticalCenter
            spacing: 12
            Icon {
              anchors.verticalCenter: parent.verticalCenter
              name: "message"
              size: 34
              color: Theme.accent
              weight: 1.8
            }
            Text {
              anchors.verticalCenter: parent.verticalCenter
              text: "Message " + root.helper + " on Telegram"
              color: Theme.accent
              font.family: Theme.sans
              font.pixelSize: Theme.body + 2
              font.weight: Font.DemiBold
              font.underline: chatMouse.containsMouse
            }
          }
          MouseArea {
            id: chatMouse
            visible: chatLink.visible
            anchors.fill: chatLink
            anchors.margins: -10
            hoverEnabled: true
            cursorShape: Qt.PointingHandCursor
            onClicked: Session.openHelperChat()
          }

          BigButton {
            anchors.right: parent.right
            anchors.verticalCenter: parent.verticalCenter
            height: 68
            text: "Never mind"
            fontSize: Theme.button
            fill: Theme.quiet
            fillPressed: Theme.quietPressed
            ink: Theme.ink
            onClicked: Session.closeHelp()
          }
        }
      }

      // ---- a voice note being recorded ---------------------------------------
      Column {
        id: recording
        visible: root.stage === "recording"
        width: parent.width
        spacing: 14

        Row {
          anchors.horizontalCenter: parent.horizontalCenter
          spacing: 14
          Rectangle {
            anchors.verticalCenter: parent.verticalCenter
            width: 22
            height: 22
            radius: 11
            color: Theme.help
            // A slow glow, so she can see it's listening.
            SequentialAnimation on opacity {
              running: recording.visible
              loops: Animation.Infinite
              NumberAnimation { from: 1; to: 0.35; duration: 900; easing.type: Easing.InOutSine }
              NumberAnimation { from: 0.35; to: 1; duration: 900; easing.type: Easing.InOutSine }
            }
          }
          Text {
            anchors.verticalCenter: parent.verticalCenter
            text: "Recording"
            color: Theme.ink
            font.family: Theme.sans
            font.pixelSize: Theme.label - 4
            font.weight: Font.DemiBold
          }
        }

        Text {
          anchors.horizontalCenter: parent.horizontalCenter
          readonly property int secs: Math.min(root.maxSeconds, Math.floor(root.elapsed))
          text: Math.floor(secs / 60) + ":" + (secs % 60 < 10 ? "0" : "") + secs % 60
          color: Theme.ink
          font.family: Theme.serif
          font.pixelSize: Theme.giant + 20
          font.weight: Font.Medium
          font.features: { "tnum": 1 }
        }

        // How much of the minute is used.
        Rectangle {
          anchors.horizontalCenter: parent.horizontalCenter
          width: Math.min(parent.width, 620)
          height: 14
          radius: 7
          color: Theme.accentSoft
          Rectangle {
            width: parent.width * Math.min(1, root.elapsed / root.maxSeconds)
            height: parent.height
            radius: parent.radius
            color: Theme.accent
          }
        }

        Text {
          width: parent.width
          horizontalAlignment: Text.AlignHCenter
          text: "Say what's happening. Press Stop and send when you're done. It stops by itself after one minute."
          color: Theme.inkSoft
          font.family: Theme.sans
          font.pixelSize: Theme.body + 2
          font.weight: Font.Medium
          wrapMode: Text.Wrap
        }

        Item { width: 1; height: 6 }

        Row {
          anchors.horizontalCenter: parent.horizontalCenter
          spacing: 24
          BigButton {
            height: 96
            text: "Stop and send"
            icon: "send"
            fontSize: Theme.label - 6
            padding: 44
            elevation: 1
            onClicked: Session.sendHelp({ text: Session.helpDraft, voice: true })
          }
          BigButton {
            height: 96
            text: "Cancel"
            fontSize: Theme.label - 6
            padding: 44
            fill: Theme.quiet
            fillPressed: Theme.quietPressed
            ink: Theme.ink
            onClicked: Session.cancelVoice()
          }
        }
      }

      // ---- what happened -----------------------------------------------------
      Column {
        id: result
        visible: !compose.visible && !recording.visible
        width: parent.width
        spacing: 16

        readonly property bool good: root.stage === "sent"
        readonly property bool waiting: root.stage === "sending"
        readonly property bool needsPhone: root.stage === "offline" || root.stage === "failed" || root.stage === "unreachable"

        Rectangle {
          visible: result.good || result.needsPhone
          anchors.horizontalCenter: parent.horizontalCenter
          width: 76
          height: 76
          radius: 38
          color: result.good ? Theme.info : Theme.warning
          Icon {
            anchors.centerIn: parent
            name: result.good ? "check" : "offline"
            size: 44
            color: Theme.bannerInk
            weight: 2.2
          }
        }

        Text {
          width: parent.width
          horizontalAlignment: Text.AlignHCenter
          text: {
            switch (root.stage) {
            case "sending": return "Sending to " + root.helper + "…"
            case "sent": return root.helperTitle + " has your message."
            case "offline": return "The internet isn't working, so this can't reach " + root.helper + " right now."
            case "failed": return "This hasn't reached " + root.helper + " yet."
            default: return "This can't reach " + root.helper + " right now."
            }
          }
          color: Theme.ink
          font.family: Theme.serif
          font.pixelSize: Theme.title + 4
          font.weight: Font.Medium
          wrapMode: Text.Wrap
        }

        Text {
          width: parent.width
          horizontalAlignment: Text.AlignHCenter
          text: {
            switch (root.stage) {
            case "sending": return root.showed ? root.helperTitle + " will see what was on your screen." : "This takes a moment."
            case "sent":
              return (root.asked ? root.helperTitle + " will call you soon."
                : root.showed ? root.helperTitle + " can see what was on your screen."
                : root.helperTitle + " will get back to you soon.")
                + " You can keep using the computer."
            case "offline": return "It will send by itself when the internet is back."
            case "failed": return "The computer will keep trying by itself. It isn't your fault."
            default: return "It isn't your fault."
            }
          }
          color: Theme.inkSoft
          font.family: Theme.sans
          font.pixelSize: Theme.body + 4
          font.weight: Font.Medium
          wrapMode: Text.Wrap
        }

        // The phone number, on a card of its own, when the message can't go.
        Surface {
          visible: result.needsPhone && Store.helperPhone !== ""
          anchors.horizontalCenter: parent.horizontalCenter
          width: Math.min(parent.width, phoneRow.implicitWidth + 100)
          height: phoneRow.implicitHeight + 40
          radius: Theme.radiusLarge
          elevation: 0
          color: Theme.dark ? Qt.darker(Theme.raised, 1.25) : Theme.background

          Column {
            id: phoneRow
            anchors.centerIn: parent
            spacing: 0
            Text {
              anchors.horizontalCenter: parent.horizontalCenter
              text: "You can call " + root.helper + ":"
              color: Theme.ink
              font.family: Theme.sans
              font.pixelSize: Theme.label - 6
              font.weight: Font.DemiBold
            }
            Text {
              anchors.horizontalCenter: parent.horizontalCenter
              text: Store.helperPhone
              color: Theme.accent
              font.family: Theme.sans
              font.pixelSize: Theme.giant
              font.weight: Font.DemiBold
              font.features: { "tnum": 1 }
            }
          }
        }

        Item { width: 1; height: 4 }

        Row {
          anchors.horizontalCenter: parent.horizontalCenter
          spacing: 24
          BigButton {
            height: 96
            implicitWidth: 240
            text: result.waiting ? "Close" : "OK"
            fontSize: Theme.label - 4
            fill: result.waiting ? Theme.quiet : Theme.accent
            fillPressed: result.waiting ? Theme.quietPressed : Theme.accentPressed
            ink: result.waiting ? Theme.ink : Theme.accentInk
            elevation: result.waiting ? 0 : 1
            onClicked: Session.closeHelp()
          }
          // Away from home, the fix may be a network she can join herself.
          BigButton {
            visible: root.stage === "offline" && Store.online === false
            height: 96
            text: "Connect to a network"
            fontSize: Theme.label - 8
            padding: 40
            fill: Theme.quiet
            fillPressed: Theme.quietPressed
            ink: Theme.ink
            onClicked: {
              Session.closeHelp()
              Session.page = "wifi"
            }
          }
        }
      }
    }
  }

  // One of the three plainer ways to ask, beside Send.
  // On dark themes accentSoft is too close to the card, so they're a step
  // lighter with a hairline instead.
  component Way: BigButton {
    height: 84
    fontSize: Theme.button + 2
    fill: Theme.dark ? Qt.lighter(Theme.raised, 1.3) : Theme.accentSoft
    fillPressed: Theme.dark ? Qt.lighter(Theme.raised, 1.5) : Qt.darker(Theme.accentSoft, 1.08)
    ink: Theme.dark ? Theme.ink : Theme.accent
    outline: Theme.dark ? Theme.line : "transparent"
    outlineWidth: Theme.dark ? 1 : 0
    elevation: 0
  }
}
