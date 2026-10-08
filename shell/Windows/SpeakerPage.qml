import QtQuick
import qs.Common
import qs.Ui

// The "Speaker" page, opened from More. She can play the computer's sound on
// a Bluetooth speaker: the one the family already has, or a new one. No
// jargon: speakers have names, a saved one connects with one tap, and a new
// one only needs its Bluetooth button held until its light blinks.
//
// At the top, once a speaker is connected, she picks where the sound comes
// out: "This computer" or the speaker. Switching never disconnects anything;
// the small Disconnect button on the speaker's row does that.
//
// Steps: the list, connecting, connected, didn't work, and forgetting a
// saved speaker.
Item {
  id: root

  property string step: "list"
  // The speaker she picked: { address, name, kind, saved, paired, connected, output }.
  property var target: null
  // After disconnecting, forgetting or a switch that didn't work.
  property string notice: ""

  readonly property var info: Speaker.info
  readonly property var speakers: info && info.speakers ? info.speakers : []
  readonly property string adapter: info ? info.adapter : ""
  readonly property var output: info ? info.output : null
  readonly property bool onSpeaker: output !== null && output.bluetooth === true
  readonly property var playing: {
    for (var i = 0; i < speakers.length; i++) if (speakers[i].output) return speakers[i]
    return null
  }
  readonly property string playingName: playing ? playing.name : onSpeaker ? output.name : ""
  // Speakers the sound can move to right now.
  readonly property var connectedSpeakers: speakers.filter(function(s) { return s.connected })
  readonly property bool noBluetooth: adapter === "none" || adapter === "blocked"

  function start() {
    step = "list"
    target = null
    notice = ""
    Speaker.clearResult()
    Speaker.load()
    Speaker.scan()
  }

  function back() {
    if (step === "list" || step === "done") {
      Session.page = ""
      return
    }
    step = "list"
    Speaker.scan()
  }

  function choose(s) {
    notice = ""
    target = s
    if (s.output) return
    // Connected already: only the sound moves.
    if (s.connected) {
      useOutput(s)
      return
    }
    step = "connecting"
    Speaker.connectTo(s)
  }

  // s is a speaker, or null for the computer.
  function useOutput(s) {
    notice = ""
    Speaker.useOutput(s ? s.address : "computer", function(ok, reason) {
      if (ok) return
      root.notice = s ? "The sound didn't move to " + s.name + ". Turn it off and on, then try again."
        : "The sound didn't move. Try again."
    })
  }

  function disconnectSpeaker(s) {
    notice = ""
    Speaker.disconnect(s.address, function(ok) {
      root.notice = ok ? s.name + " is disconnected. The sound is back on the computer."
        : s.name + " didn't disconnect. Try again."
    })
  }

  function failText(reason, name) {
    switch (reason) {
    case "not-found":
      return "The computer can't find " + name + ". Make sure it's turned on and close by. "
        + "If it's new to this computer, hold its Bluetooth button until its light blinks, then try again."
    case "pair":
      return name + " didn't let the computer connect. Hold its Bluetooth button until its light blinks, then try again."
    case "connect":
      return name + " didn't answer. It may be turned off, or playing for someone's phone. "
        + "Turn it on, or turn off Bluetooth on the phone, then try again."
    case "off":
    case "no-bluetooth":
      return "Bluetooth isn't working on this computer. Restarting the computer may fix it."
    default:
      return "That didn't work. Turn " + name + " off and on, then try again."
    }
  }

  // A connect finished.
  Connections {
    target: Speaker
    function onResultChanged() {
      var r = Speaker.result
      if (!r || root.step !== "connecting") return
      root.step = r.ok ? "done" : "failed"
    }
  }

  onVisibleChanged: if (visible) start()

  // The sound moved by itself: a speaker was turned off or came back.
  Connections {
    target: Speaker
    function onSinkChanged() {
      if (root.visible && root.step === "list") Speaker.load()
    }
  }

  // The dev session's stand-in for a press (shell.qml, momos-dev-ui).
  Connections {
    target: Speaker
    function onPickRequested(name) {
      if (!root.visible) return
      if (name === "output:computer") {
        root.useOutput(null)
        return
      }
      var forgetting = name.indexOf("forget:") === 0
      var disconnecting = name.indexOf("disconnect:") === 0
      if (forgetting) name = name.slice(7)
      if (disconnecting) name = name.slice(11)
      if (name.indexOf("output:") === 0) name = name.slice(7)
      for (var i = 0; i < root.speakers.length; i++) {
        if (root.speakers[i].name !== name) continue
        if (disconnecting) {
          root.disconnectSpeaker(root.speakers[i])
        } else if (forgetting) {
          root.target = root.speakers[i]
          root.step = "forget"
        } else {
          root.choose(root.speakers[i])
        }
      }
    }
  }

  // Keep looking while she reads the list, so a speaker she just put in
  // pairing mode shows up without a press. Each look takes about ten seconds.
  Timer {
    interval: 8000
    repeat: true
    running: root.visible && root.step === "list" && !Speaker.scanning
    onTriggered: Speaker.scan()
  }

  // ---- header ------------------------------------------------------------------

  Item {
    id: header
    anchors.top: parent.top
    anchors.topMargin: 22
    anchors.left: parent.left
    anchors.leftMargin: Theme.margin
    anchors.right: parent.right
    anchors.rightMargin: Theme.margin
    height: 80

    BigButton {
      id: backButton
      visible: root.step !== "connecting" && root.step !== "done"
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
      onClicked: root.back()
    }

    Column {
      anchors.left: backButton.visible ? backButton.right : parent.left
      anchors.leftMargin: backButton.visible ? 32 : 4
      anchors.right: refreshButton.visible ? refreshButton.left : parent.right
      anchors.rightMargin: 24
      anchors.verticalCenter: parent.verticalCenter
      spacing: -2

      Text {
        width: parent.width
        text: "Speaker"
        color: Theme.ink
        font.family: Theme.serif
        font.pixelSize: Theme.title + 6
        elide: Text.ElideRight
      }
      Text {
        width: parent.width
        visible: root.step === "list"
        text: "Play the computer's sound on a speaker."
        color: Theme.inkSoft
        font.family: Theme.sans
        font.pixelSize: Theme.body
        elide: Text.ElideRight
      }
    }

    BigButton {
      id: refreshButton
      visible: root.step === "list" && !root.noBluetooth
      anchors.right: parent.right
      anchors.verticalCenter: parent.verticalCenter
      text: Speaker.scanning ? "Looking…" : "Look again"
      icon: "refresh"
      fontSize: Theme.label - 6
      implicitHeight: 80
      padding: 30
      fill: Theme.surface
      fillPressed: Theme.pressed
      ink: Theme.ink
      elevation: down ? 0.5 : 1
      onClicked: Speaker.scan()
    }
  }

  // ---- the list ----------------------------------------------------------------

  Item {
    id: listStep
    visible: root.step === "list"
    anchors.top: header.bottom
    anchors.topMargin: 24
    anchors.bottom: parent.bottom
    anchors.bottomMargin: 24
    anchors.left: parent.left
    anchors.leftMargin: Theme.margin
    anchors.right: parent.right
    anchors.rightMargin: Theme.margin

    // Where the sound plays now, in words, while no speaker is connected.
    Surface {
      id: statusCard
      visible: !outputCard.visible
      anchors.top: parent.top
      width: parent.width
      height: Math.max(112, statusWords.implicitHeight + 36)
      radius: Theme.radiusLarge
      elevation: 1

      Rectangle {
        id: statusWell
        anchors.left: parent.left
        anchors.leftMargin: 24
        anchors.verticalCenter: parent.verticalCenter
        width: 64
        height: 64
        radius: 32
        color: root.noBluetooth ? Qt.alpha(Theme.alert, 0.12) : Theme.accentSoft

        Icon {
          anchors.centerIn: parent
          name: root.noBluetooth ? "offline" : root.onSpeaker ? "speaker" : "louder"
          size: 36
          color: root.noBluetooth ? Theme.alert : Theme.accent
          weight: 1.8
        }
      }

      Column {
        id: statusWords
        anchors.left: statusWell.right
        anchors.leftMargin: 22
        anchors.right: parent.right
        anchors.rightMargin: 24
        anchors.verticalCenter: parent.verticalCenter
        spacing: 0

        Text {
          width: parent.width
          text: root.noBluetooth ? "Bluetooth isn't working"
            : root.onSpeaker ? "Sound is playing on " + root.playingName
            : "Sound is playing on the computer"
          color: Theme.ink
          font.family: Theme.sans
          font.pixelSize: Theme.label - 4
          font.weight: Font.DemiBold
          elide: Text.ElideRight
        }
        Text {
          width: parent.width
          text: {
            if (root.noBluetooth) return "Restarting the computer may fix it."
            if (root.notice !== "") return root.notice
            return "Turn your speaker on, then pick it below."
          }
          color: root.noBluetooth ? Theme.alert : Theme.inkSoft
          font.family: Theme.sans
          font.pixelSize: Theme.body
          wrapMode: Text.Wrap
        }
      }
    }

    // Once a speaker is connected: where the sound comes out, as big
    // choices. The chosen one is filled and has a check mark.
    Surface {
      id: outputCard
      visible: !root.noBluetooth && root.connectedSpeakers.length > 0
      anchors.top: parent.top
      width: parent.width
      height: outputWords.implicitHeight + choices.height + 58
      radius: Theme.radiusLarge
      elevation: 1

      Column {
        id: outputWords
        anchors.top: parent.top
        anchors.topMargin: 18
        anchors.left: parent.left
        anchors.leftMargin: 26
        anchors.right: parent.right
        anchors.rightMargin: 26
        spacing: 0

        Text {
          width: parent.width
          text: "Where does the sound come out?"
          color: Theme.ink
          font.family: Theme.sans
          font.pixelSize: Theme.label - 4
          font.weight: Font.DemiBold
          elide: Text.ElideRight
        }
        Text {
          width: parent.width
          visible: root.notice !== ""
          text: root.notice
          color: Theme.inkSoft
          font.family: Theme.sans
          font.pixelSize: Theme.body
          wrapMode: Text.Wrap
        }
      }

      Row {
        id: choices
        anchors.top: outputWords.bottom
        anchors.topMargin: 14
        anchors.left: parent.left
        anchors.leftMargin: 18
        anchors.right: parent.right
        anchors.rightMargin: 18
        height: 96
        spacing: 16

        readonly property int count: 1 + Math.min(2, root.connectedSpeakers.length)
        readonly property int choiceWidth: Math.floor((width - spacing * (count - 1)) / count)

        OutputChoice {
          width: choices.choiceWidth
          icon: "laptop"
          label: "This computer"
          selected: !root.onSpeaker
          onChosen: root.useOutput(null)
        }

        Repeater {
          model: root.connectedSpeakers.slice(0, 2)
          delegate: OutputChoice {
            required property var modelData
            width: choices.choiceWidth
            icon: modelData.kind === "headphones" ? "headphones" : "speaker"
            label: modelData.name
            selected: modelData.output
            onChosen: root.choose(modelData)
          }
        }
      }
    }

    // One place for the sound: a big button with an icon and a name. The
    // chosen one is filled with the accent color and has a check mark.
    component OutputChoice: Surface {
      id: choice
      property string icon: ""
      property string label: ""
      property bool selected: false
      signal chosen()

      height: parent ? parent.height : 96
      radius: Theme.radius
      elevation: selected ? 0 : choiceTap.pressed ? 0.5 : 1
      color: selected ? Theme.accent
        : choiceTap.pressed ? Theme.pressed
        : choiceTap.containsMouse ? Qt.tint(Theme.surface, Qt.alpha(Theme.pressed, 0.6)) : Theme.surface
      outline: selected ? "transparent" : Theme.line
      outlineWidth: selected ? 0 : 1
      scale: choiceTap.pressed ? 0.98 : 1
      Behavior on scale { NumberAnimation { duration: Theme.quick; easing.type: Easing.OutCubic } }

      Icon {
        id: choiceIcon
        anchors.left: parent.left
        anchors.leftMargin: 22
        anchors.verticalCenter: parent.verticalCenter
        name: choice.icon
        size: 42
        color: choice.selected ? Theme.accentInk : Theme.accent
        weight: 1.9
      }

      Text {
        anchors.left: choiceIcon.right
        anchors.leftMargin: 16
        anchors.right: choiceCheck.visible ? choiceCheck.left : parent.right
        anchors.rightMargin: 14
        anchors.verticalCenter: parent.verticalCenter
        text: choice.label
        color: choice.selected ? Theme.accentInk : Theme.ink
        font.family: Theme.sans
        font.pixelSize: Theme.label - 6
        font.weight: Font.DemiBold
        elide: Text.ElideRight
      }

      Icon {
        id: choiceCheck
        visible: choice.selected
        anchors.right: parent.right
        anchors.rightMargin: 22
        anchors.verticalCenter: parent.verticalCenter
        name: "check"
        size: 34
        color: Theme.accentInk
        weight: 2.4
      }

      MouseArea {
        id: choiceTap
        anchors.fill: parent
        hoverEnabled: true
        enabled: !Speaker.switching
        cursorShape: choice.selected ? Qt.ArrowCursor : Qt.PointingHandCursor
        onClicked: if (!choice.selected) choice.chosen()
      }
    }

    Text {
      id: listHeading
      anchors.top: outputCard.visible ? outputCard.bottom : statusCard.bottom
      anchors.topMargin: 20
      leftPadding: 6
      text: "Speakers"
      color: Theme.inkSoft
      font.family: Theme.serif
      font.pixelSize: Theme.body + 2
      font.italic: true
    }

    Surface {
      id: listCard
      anchors.top: listHeading.bottom
      anchors.topMargin: 8
      anchors.bottom: parent.bottom
      width: parent.width
      radius: Theme.radius
      elevation: 0
      outline: Theme.line
      outlineWidth: 1

      ListView {
        id: list
        anchors.fill: parent
        anchors.margins: 1
        clip: true
        boundsBehavior: Flickable.StopAtBounds
        model: root.speakers
        delegate: speakerRow
        footer: pairingTip

        Column {
          visible: list.count === 0
          anchors.centerIn: parent
          width: parent.width - 80
          spacing: 12

          Text {
            width: parent.width
            horizontalAlignment: Text.AlignHCenter
            text: Speaker.scanning ? "Looking for speakers…"
              : Speaker.loadFailed ? "The computer can't look for speakers right now."
              : "No speakers found yet."
            color: Theme.ink
            font.family: Theme.sans
            font.pixelSize: Theme.label - 6
            font.weight: Font.DemiBold
            wrapMode: Text.Wrap
          }
          Text {
            width: parent.width
            horizontalAlignment: Text.AlignHCenter
            text: "Turn the speaker on. Then hold its Bluetooth button until its light blinks. "
              + "It shows up here in a few seconds."
            color: Theme.inkSoft
            font.family: Theme.sans
            font.pixelSize: Theme.body
            wrapMode: Text.Wrap
          }
        }
      }
    }
  }

  Component {
    id: speakerRow

    Item {
      id: row
      required property var modelData
      required property int index
      readonly property var s: modelData
      width: ListView.view.width
      height: Math.max(92, rowWords.implicitHeight + 24)

      Rectangle {
        anchors.fill: parent
        color: rowTap.pressed ? Theme.pressed
          : rowTap.containsMouse && !row.s.output ? Qt.tint(Theme.surface, Qt.alpha(Theme.pressed, 0.6)) : "transparent"
      }

      Rectangle {
        visible: row.index > 0
        anchors.top: parent.top
        x: 24
        width: parent.width - 48
        height: 1
        color: Theme.line
      }

      MouseArea {
        id: rowTap
        anchors.fill: parent
        hoverEnabled: true
        cursorShape: row.s.output ? Qt.ArrowCursor : Qt.PointingHandCursor
        onClicked: root.choose(row.s)
      }

      Icon {
        id: rowIcon
        anchors.left: parent.left
        anchors.leftMargin: 26
        anchors.verticalCenter: parent.verticalCenter
        size: 44
        name: row.s.kind === "headphones" ? "headphones" : "speaker"
        color: Theme.accent
        weight: 1.9
      }

      Column {
        id: rowWords
        anchors.left: rowIcon.right
        anchors.leftMargin: 22
        anchors.right: rowRight.left
        anchors.rightMargin: 20
        anchors.verticalCenter: parent.verticalCenter
        spacing: -2

        Text {
          width: parent.width
          text: row.s.name
          color: Theme.ink
          font.family: Theme.sans
          font.pixelSize: Theme.label - 6
          font.weight: Font.DemiBold
          elide: Text.ElideRight
        }
        Text {
          width: parent.width
          text: {
            if (row.s.output) return "Connected · Playing now"
            if (row.s.connected) return "Connected · Tap to play here"
            if (row.s.paired) return "Used before · Tap to connect"
            return (row.s.kind === "headphones" ? "Headphones" : "New") + " · Tap to connect"
          }
          color: row.s.output ? Theme.accent : Theme.inkSoft
          font.family: Theme.sans
          font.pixelSize: Theme.small
          font.weight: row.s.output ? Font.DemiBold : Font.Normal
          elide: Text.ElideRight
        }
      }

      Row {
        id: rowRight
        anchors.right: parent.right
        anchors.rightMargin: 24
        anchors.verticalCenter: parent.verticalCenter
        spacing: 20

        // Small and quiet. Lets a phone have the speaker; the sound comes
        // back to the computer.
        BigButton {
          visible: row.s.connected
          anchors.verticalCenter: parent.verticalCenter
          text: "Disconnect"
          fontSize: Theme.small
          implicitHeight: 54
          padding: 20
          bold: false
          fill: Theme.quiet
          fillPressed: Theme.quietPressed
          ink: Theme.ink
          onClicked: root.disconnectSpeaker(row.s)
        }

        // Small and quiet, so it isn't pressed by mistake; it asks first.
        BigButton {
          visible: row.s.paired && !row.s.connected
          anchors.verticalCenter: parent.verticalCenter
          text: "Forget"
          fontSize: Theme.small
          implicitHeight: 54
          padding: 20
          bold: false
          fill: Theme.quiet
          fillPressed: Theme.quietPressed
          ink: Theme.ink
          onClicked: {
            root.target = row.s
            root.notice = ""
            root.step = "forget"
          }
        }
      }
    }
  }

  // Under a list that has speakers: how to make a new one show up.
  Component {
    id: pairingTip

    Item {
      width: ListView.view ? ListView.view.width : 0
      height: list.count > 0 ? tipText.implicitHeight + 36 : 0
      visible: list.count > 0

      Rectangle {
        anchors.top: parent.top
        x: 24
        width: parent.width - 48
        height: 1
        color: Theme.line
      }

      Text {
        id: tipText
        anchors.left: parent.left
        anchors.leftMargin: 26
        anchors.right: parent.right
        anchors.rightMargin: 26
        anchors.verticalCenter: parent.verticalCenter
        text: "Don't see yours? Turn it on and hold its Bluetooth button until its light blinks."
        color: Theme.inkSoft
        font.family: Theme.sans
        font.pixelSize: Theme.small
        wrapMode: Text.Wrap
      }
    }
  }

  // ---- connecting, connected, didn't work, forget ------------------------------

  Column {
    id: messageStep
    visible: root.step === "connecting" || root.step === "done" || root.step === "failed" || root.step === "forget"
    anchors.centerIn: parent
    anchors.verticalCenterOffset: 30
    width: Math.min(1000, parent.width - Theme.margin * 4)
    spacing: 14

    readonly property string name: root.target ? root.target.name : Speaker.connectingName
    // Connected, but PipeWire didn't offer it as a place for sound.
    readonly property bool silent: Speaker.result !== null && Speaker.result.ok && !Speaker.result.output

    Rectangle {
      anchors.horizontalCenter: parent.horizontalCenter
      visible: root.step === "done" || root.step === "connecting"
      width: 110
      height: 110
      radius: 55
      color: Theme.accentSoft

      Icon {
        anchors.centerIn: parent
        name: root.step === "done" && !messageStep.silent ? "check"
          : root.target && root.target.kind === "headphones" ? "headphones" : "speaker"
        size: 64
        color: Theme.accent
        weight: 2.2
      }
    }

    Text {
      width: parent.width
      horizontalAlignment: Text.AlignHCenter
      text: {
        switch (root.step) {
        case "connecting": return "Connecting to " + messageStep.name + "…"
        case "done": return messageStep.silent ? "Connected, but the sound is still on the computer." : "Connected. Sound plays on " + messageStep.name + "."
        case "failed": return "That didn't work."
        case "forget": return "Forget " + messageStep.name + "?"
        }
        return ""
      }
      color: Theme.ink
      font.family: Theme.serif
      font.pixelSize: Theme.huge - 8
      wrapMode: Text.Wrap
    }

    Text {
      width: parent.width
      horizontalAlignment: Text.AlignHCenter
      text: {
        switch (root.step) {
        case "connecting": return "Keep the speaker on and close by. This can take up to a minute."
        case "done":
          return messageStep.silent ? "Turn " + messageStep.name + " off and on, then try again."
            : "Next time, turn " + messageStep.name + " on and the computer connects to it by itself. If it doesn't, tap it here."
        case "failed":
          return Speaker.result ? root.failText(Speaker.result.reason, messageStep.name) : ""
        case "forget":
          return "The computer won't connect to it by itself anymore. To use it again, you'll need to hold its Bluetooth button until its light blinks."
        }
        return ""
      }
      color: Theme.inkSoft
      font.family: Theme.sans
      font.pixelSize: Theme.label - 6
      wrapMode: Text.Wrap
    }

    Item { width: 1; height: 24 }

    Row {
      anchors.horizontalCenter: parent.horizontalCenter
      visible: root.step !== "connecting"
      spacing: 60

      // Forgetting: the safe choice is the big accent one; the other stands apart.
      BigButton {
        visible: root.step === "forget"
        text: "Forget it"
        fontSize: Theme.label - 6
        implicitHeight: 90
        padding: 40
        fill: Theme.surface
        fillPressed: Theme.pressed
        ink: Theme.ink
        onClicked: {
          var s = root.target
          Speaker.forget(s.address, function(ok) {
            root.notice = ok ? s.name + " was forgotten." : ""
          })
          root.step = "list"
        }
      }
      BigButton {
        visible: root.step === "forget"
        text: "Keep it"
        fontSize: Theme.label - 6
        implicitHeight: 90
        implicitWidth: 260
        elevation: 1
        onClicked: root.back()
      }

      BigButton {
        visible: root.step === "done" && messageStep.silent && root.target !== null
        text: "Try again"
        icon: "refresh"
        fontSize: Theme.label - 6
        implicitHeight: 90
        padding: 40
        fill: Theme.surface
        fillPressed: Theme.pressed
        ink: Theme.ink
        onClicked: {
          root.step = "connecting"
          Speaker.connectTo(root.target)
        }
      }

      BigButton {
        visible: root.step === "done"
        text: "Done"
        icon: "check"
        fontSize: Theme.label - 6
        implicitHeight: 90
        implicitWidth: 260
        elevation: 1
        onClicked: Session.page = ""
      }

      BigButton {
        visible: root.step === "failed"
        text: "Back to the list"
        fontSize: Theme.label - 6
        implicitHeight: 90
        padding: 40
        fill: Theme.surface
        fillPressed: Theme.pressed
        ink: Theme.ink
        onClicked: root.back()
      }
      BigButton {
        visible: root.step === "failed" && root.target !== null
        text: "Try again"
        icon: "refresh"
        fontSize: Theme.label - 6
        implicitHeight: 90
        padding: 40
        elevation: 1
        onClicked: root.choose(root.target)
      }
    }
  }
}
