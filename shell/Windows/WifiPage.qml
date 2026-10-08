import QtQuick
import qs.Common
import qs.Ui

// The "Internet connection" page, opened from More or from the "Connect to a
// network" button on the offline card. She can join a network at a friend's
// house, a hotel or her phone's hotspot on her own, since remote help needs
// the internet. No jargon: networks have names, signals are strong, good or
// weak, and a lock means it needs a password.
//
// Steps: the list, a password, a network that isn't listed, joining, joined,
// didn't work, and forgetting a saved network.
Item {
  id: root

  property string step: "list"
  // The network she picked: { name, kind, known, inUse }.
  property var target: null
  // A line in the alert color on the password step, after a failed try.
  property string problem: ""
  // After forgetting: "Smith Home was forgotten."
  property string notice: ""

  readonly property bool wantsKeyboard: visible && (step === "password" || step === "hidden")

  readonly property var scan: Wifi.scan
  readonly property var networks: scan && scan.networks ? scan.networks : []
  readonly property var current: scan ? scan.current : null
  readonly property string currentName: current ? current.name : Store.wifiName

  function start() {
    step = "list"
    target = null
    problem = ""
    notice = ""
    Wifi.clearResult()
    Wifi.refresh(false)
  }

  function back() {
    if (step === "list" || step === "done") {
      Session.page = ""
      return
    }
    problem = ""
    step = "list"
    Wifi.refresh(false)
  }

  function choose(n) {
    notice = ""
    problem = ""
    target = n
    if (n.inUse) return
    if (n.kind === "enterprise" || n.kind === "old") {
      step = "failed"
      Wifi.result = { ok: false, name: n.name, reason: "unsupported", portal: false }
      return
    }
    if (n.known || n.kind === "open") {
      step = "joining"
      Wifi.join(n.name, null, false)
      return
    }
    step = "password"
  }

  function connectWithPassword() {
    if (!target || passwordField.text === "") return
    problem = ""
    step = "joining"
    Wifi.join(target.name, passwordField.text, false)
  }

  function connectHidden() {
    var name = hiddenName.text.trim()
    if (name === "") return
    problem = ""
    target = { name: name, kind: hiddenPassword.text === "" ? "open" : "password", known: false, inUse: false, hidden: true }
    step = "joining"
    Wifi.join(name, hiddenPassword.text === "" ? null : hiddenPassword.text, true)
  }

  function failText(reason, name) {
    switch (reason) {
    case "password":
      return "That password didn't work. Check it with the person who gave it to you and try again."
    case "short":
      return "That password is too short. These passwords have at least 8 letters, numbers or signs."
    case "not-found":
      return "The computer can't find " + name + " right now. Move closer to it, then try again."
    case "unsupported":
      return name + " needs a kind of sign-in this computer can't do. Pick another network."
    default:
      return "That didn't work. Try again in a moment."
    }
  }

  // A join finished.
  Connections {
    target: Wifi
    function onResultChanged() {
      var r = Wifi.result
      if (!r || root.step !== "joining") return
      if (r.ok) {
        passwordField.text = ""
        hiddenPassword.text = ""
        root.step = "done"
      } else if (r.reason === "password" || r.reason === "short") {
        root.problem = root.failText(r.reason, r.name)
        root.step = root.target && root.target.hidden ? "hidden" : "password"
      } else {
        root.step = "failed"
      }
    }
  }

  onVisibleChanged: if (visible) start()

  // The dev session's stand-in for a press (shell.qml, momos-dev-ui).
  Connections {
    target: Wifi
    function onPickRequested(name) {
      if (!root.visible) return
      if (name === "") {
        root.problem = ""
        root.target = null
        root.step = "hidden"
        return
      }
      // "forget:<name>" presses that row's Forget button.
      var forgetting = name.indexOf("forget:") === 0
      if (forgetting) name = name.slice(7)
      for (var i = 0; i < root.networks.length; i++) {
        if (root.networks[i].name !== name) continue
        if (forgetting) {
          root.target = root.networks[i]
          root.step = "forget"
        } else {
          root.choose(root.networks[i])
        }
      }
    }
  }

  // Keep the list fresh while she looks at it.
  Timer {
    interval: 15000
    repeat: true
    running: root.visible && root.step === "list"
    onTriggered: Wifi.refresh(false)
  }

  onStepChanged: {
    if (step === "password") {
      passwordField.selectAllText()
      passwordField.focusInput()
    } else if (step === "hidden") {
      hiddenName.focusInput()
    }
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
      visible: root.step !== "joining" && root.step !== "done"
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
        text: {
          if (root.step === "password" && root.target) return "Join " + root.target.name
          if (root.step === "hidden") return "A network that isn't listed"
          return "Internet connection"
        }
        color: Theme.ink
        font.family: Theme.serif
        font.pixelSize: Theme.title + 6
        elide: Text.ElideRight
      }
      Text {
        width: parent.width
        visible: text !== ""
        text: {
          if (root.step === "list") return "Pick a network to join it."
          if (root.step === "password") return "Type the password for this network."
          if (root.step === "hidden") return "Type the network's name and its password."
          return ""
        }
        color: Theme.inkSoft
        font.family: Theme.sans
        font.pixelSize: Theme.body
        elide: Text.ElideRight
      }
    }

    BigButton {
      id: refreshButton
      visible: root.step === "list"
      anchors.right: parent.right
      anchors.verticalCenter: parent.verticalCenter
      text: Wifi.scanning ? "Looking…" : "Refresh"
      icon: "refresh"
      fontSize: Theme.label - 6
      implicitHeight: 80
      padding: 30
      fill: Theme.surface
      fillPressed: Theme.pressed
      ink: Theme.ink
      elevation: down ? 0.5 : 1
      onClicked: Wifi.refresh(true)
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

    // Where she is now, in words.
    Surface {
      id: statusCard
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
        color: Wifi.portal || Store.online === false ? Qt.alpha(Theme.alert, 0.12) : Theme.accentSoft

        Icon {
          anchors.centerIn: parent
          name: Wifi.portal || Store.online === false ? "offline" : "signal"
          size: 36
          color: Wifi.portal || Store.online === false ? Theme.alert : Theme.accent
          weight: 1.8
        }
      }

      Column {
        id: statusWords
        anchors.left: statusWell.right
        anchors.leftMargin: 22
        anchors.right: signIn.visible ? signIn.left : parent.right
        anchors.rightMargin: 24
        anchors.verticalCenter: parent.verticalCenter
        spacing: 0

        Text {
          width: parent.width
          text: root.currentName !== "" ? "Connected to " + root.currentName : "Not connected to a network"
          color: Theme.ink
          font.family: Theme.sans
          font.pixelSize: Theme.label - 4
          font.weight: Font.DemiBold
          elide: Text.ElideRight
        }
        Text {
          width: parent.width
          text: {
            if (Wifi.portal) return "This network needs you to sign in."
            if (root.notice !== "") return root.notice
            if (Store.online === true) return "The internet is working."
            if (root.currentName !== "") return "The internet isn't working on this network."
            return "Pick a network below to join it."
          }
          color: Wifi.portal ? Theme.alert : Theme.inkSoft
          font.family: Theme.sans
          font.pixelSize: Theme.body
          font.weight: Wifi.portal ? Font.DemiBold : Font.Normal
          wrapMode: Text.Wrap
        }
      }

      BigButton {
        id: signIn
        visible: Wifi.portal
        anchors.right: parent.right
        anchors.rightMargin: 22
        anchors.verticalCenter: parent.verticalCenter
        text: "Sign in"
        fontSize: Theme.label - 6
        implicitHeight: 76
        padding: 34
        elevation: 1
        onClicked: Wifi.openSignIn()
      }
    }

    Text {
      id: nearbyHeading
      anchors.top: statusCard.bottom
      anchors.topMargin: 20
      leftPadding: 6
      text: "Networks nearby"
      color: Theme.inkSoft
      font.family: Theme.serif
      font.pixelSize: Theme.body + 2
      font.italic: true
    }

    Surface {
      id: listCard
      anchors.top: nearbyHeading.bottom
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
        model: root.networks
        delegate: networkRow
        footer: notListed

        Text {
          visible: list.count === 0
          anchors.centerIn: parent
          anchors.verticalCenterOffset: -30
          width: parent.width - 60
          horizontalAlignment: Text.AlignHCenter
          text: Wifi.scanning ? "Looking for networks…"
            : Wifi.scanFailed ? "The computer can't look for networks right now."
            : "No networks nearby. Press Refresh to look again."
          color: Theme.inkSoft
          font.family: Theme.sans
          font.pixelSize: Theme.body
          wrapMode: Text.Wrap
        }
      }
    }
  }

  Component {
    id: networkRow

    Item {
      id: row
      required property var modelData
      required property int index
      readonly property var n: modelData
      readonly property bool canJoin: n.kind !== "enterprise" && n.kind !== "old"
      width: ListView.view.width
      height: Math.max(92, rowWords.implicitHeight + 24)

      Rectangle {
        anchors.fill: parent
        color: rowTap.pressed ? Theme.pressed
          : rowTap.containsMouse && !row.n.inUse ? Qt.tint(Theme.surface, Qt.alpha(Theme.pressed, 0.6)) : "transparent"
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
        cursorShape: row.n.inUse ? Qt.ArrowCursor : Qt.PointingHandCursor
        onClicked: root.choose(row.n)
      }

      // The signal: the whole fan faint, the arcs it has strong.
      Item {
        id: fan
        anchors.left: parent.left
        anchors.leftMargin: 26
        anchors.verticalCenter: parent.verticalCenter
        width: 44
        height: 44

        Icon {
          anchors.fill: parent
          size: 44
          name: "signal"
          color: Qt.alpha(Theme.inkSoft, 0.3)
          weight: 2.2
        }
        Icon {
          anchors.fill: parent
          size: 44
          name: row.n.strength === "strong" ? "signal3" : row.n.strength === "good" ? "signal2" : "signal1"
          color: Theme.accent
          weight: 2.2
        }
      }

      Column {
        id: rowWords
        anchors.left: fan.right
        anchors.leftMargin: 22
        anchors.right: rowRight.left
        anchors.rightMargin: 20
        anchors.verticalCenter: parent.verticalCenter
        spacing: -2

        Text {
          width: parent.width
          text: row.n.name
          color: Theme.ink
          font.family: Theme.sans
          font.pixelSize: Theme.label - 6
          font.weight: Font.DemiBold
          elide: Text.ElideRight
        }
        Text {
          width: parent.width
          text: {
            var words = row.n.strength === "strong" ? "Strong signal" : row.n.strength === "good" ? "Good signal" : "Weak signal"
            if (row.n.inUse) return "Connected · " + words
            if (!row.canJoin) return "Can't be joined from here · " + words
            if (row.n.known) return "Joined before · " + words
            return words
          }
          color: row.n.inUse ? Theme.accent : Theme.inkSoft
          font.family: Theme.sans
          font.pixelSize: Theme.small
          font.weight: row.n.inUse ? Font.DemiBold : Font.Normal
          elide: Text.ElideRight
        }
      }

      Row {
        id: rowRight
        anchors.right: parent.right
        anchors.rightMargin: 24
        anchors.verticalCenter: parent.verticalCenter
        spacing: 20

        // Small and quiet, so it isn't pressed by mistake; it asks first.
        BigButton {
          visible: row.n.known && !row.n.inUse
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
            root.target = row.n
            root.notice = ""
            root.step = "forget"
          }
        }

        Icon {
          visible: row.n.inUse
          anchors.verticalCenter: parent.verticalCenter
          name: "check"
          size: 36
          color: Theme.accent
          weight: 2.2
        }

        Icon {
          visible: row.n.secure
          anchors.verticalCenter: parent.verticalCenter
          name: "lock"
          size: 34
          color: Theme.inkSoft
          weight: 1.8
        }
      }
    }
  }

  Component {
    id: notListed

    Item {
      width: ListView.view ? ListView.view.width : 0
      height: 92

      Rectangle {
        visible: list.count > 0
        anchors.top: parent.top
        x: 24
        width: parent.width - 48
        height: 1
        color: Theme.line
      }

      BigButton {
        anchors.left: parent.left
        anchors.leftMargin: 20
        anchors.verticalCenter: parent.verticalCenter
        text: "My network isn't listed"
        fontSize: Theme.small
        implicitHeight: 58
        padding: 22
        bold: false
        fill: Theme.quiet
        fillPressed: Theme.quietPressed
        ink: Theme.ink
        onClicked: {
          hiddenName.text = ""
          hiddenPassword.text = ""
          root.problem = ""
          root.target = null
          root.step = "hidden"
        }
      }
    }
  }

  // ---- typing a password -------------------------------------------------------

  // Shown by default: people mistype passwords they read off a card, and she
  // can turn it off.
  property bool showPassword: true

  component Field: Surface {
    id: field
    property alias text: input.text
    property alias input: input
    property bool secret: false
    property string placeholder: ""
    signal accepted()
    property Item tabTarget: null
    function selectAllText() { input.selectAll() }
    function focusInput() { input.forceActiveFocus() }

    height: 96
    radius: Theme.radius
    elevation: 0
    color: Theme.surface
    outline: input.activeFocus ? Theme.accent : Theme.line
    outlineWidth: input.activeFocus ? 3 : 2

    TextInput {
      id: input
      anchors.left: parent.left
      anchors.leftMargin: 26
      anchors.right: parent.right
      anchors.rightMargin: 26
      anchors.verticalCenter: parent.verticalCenter
      color: Theme.ink
      font.family: Theme.sans
      font.pixelSize: Theme.label
      font.weight: Font.Medium
      echoMode: field.secret && !root.showPassword ? TextInput.Password : TextInput.Normal
      passwordCharacter: "•"
      selectByMouse: true
      selectionColor: Theme.accentSoft
      selectedTextColor: Theme.ink
      clip: true
      cursorDelegate: Rectangle {
        width: 3
        color: Theme.accent
        visible: input.activeFocus
      }
      onAccepted: field.accepted()
      KeyNavigation.tab: field.tabTarget
    }

    Text {
      visible: input.text === ""
      anchors.left: parent.left
      anchors.leftMargin: 26
      anchors.verticalCenter: parent.verticalCenter
      text: field.placeholder
      color: Theme.inkSoft
      font.family: Theme.sans
      font.pixelSize: Theme.label - 6
    }

    MouseArea {
      anchors.fill: parent
      cursorShape: Qt.IBeamCursor
      onPressed: function(mouse) {
        input.forceActiveFocus()
        mouse.accepted = false
      }
    }
  }

  // A plain check box with its words, big enough to hit.
  component ShowToggle: Item {
    width: toggleRow.implicitWidth + 16
    height: 64

    Row {
      id: toggleRow
      anchors.verticalCenter: parent.verticalCenter
      spacing: 16

      Rectangle {
        width: 40
        height: 40
        radius: 8
        anchors.verticalCenter: parent.verticalCenter
        color: root.showPassword ? Theme.accent : Theme.surface
        border.width: root.showPassword ? 0 : 2
        border.color: Theme.inkSoft

        Icon {
          visible: root.showPassword
          anchors.centerIn: parent
          name: "check"
          size: 30
          color: Theme.accentInk
          weight: 2.6
        }
      }
      Text {
        anchors.verticalCenter: parent.verticalCenter
        text: "Show the password"
        color: Theme.ink
        font.family: Theme.sans
        font.pixelSize: Theme.body
        font.weight: Font.Medium
      }
    }

    MouseArea {
      anchors.fill: parent
      cursorShape: Qt.PointingHandCursor
      onClicked: root.showPassword = !root.showPassword
    }
  }

  Column {
    id: passwordStep
    visible: root.step === "password"
    anchors.top: header.bottom
    anchors.topMargin: 40
    anchors.horizontalCenter: parent.horizontalCenter
    width: Math.min(860, parent.width - Theme.margin * 2)
    spacing: 18

    Text {
      width: parent.width
      text: "Password"
      color: Theme.inkSoft
      font.family: Theme.sans
      font.pixelSize: Theme.body
      font.weight: Font.DemiBold
    }

    Field {
      id: passwordField
      width: parent.width
      secret: true
      onAccepted: root.connectWithPassword()
    }

    ShowToggle {}

    Text {
      visible: root.problem !== ""
      width: parent.width
      text: root.problem
      color: Theme.alert
      font.family: Theme.sans
      font.pixelSize: Theme.body
      font.weight: Font.DemiBold
      wrapMode: Text.Wrap
    }

    BigButton {
      width: parent.width
      implicitHeight: Theme.bigButtonHeight
      text: "Connect"
      fontSize: Theme.label - 2
      elevation: 1
      onClicked: root.connectWithPassword()
    }
  }

  // ---- a network that isn't listed ---------------------------------------------

  Column {
    id: hiddenStep
    visible: root.step === "hidden"
    anchors.top: header.bottom
    anchors.topMargin: 24
    anchors.horizontalCenter: parent.horizontalCenter
    width: Math.min(860, parent.width - Theme.margin * 2)
    spacing: 12

    Text {
      text: "Network name"
      color: Theme.inkSoft
      font.family: Theme.sans
      font.pixelSize: Theme.body
      font.weight: Font.DemiBold
    }
    Field {
      id: hiddenName
      width: parent.width
      height: 84
      onAccepted: hiddenPassword.focusInput()
      tabTarget: hiddenPassword.input
    }
    Text {
      text: "Password, if it has one"
      color: Theme.inkSoft
      font.family: Theme.sans
      font.pixelSize: Theme.body
      font.weight: Font.DemiBold
    }
    Row {
      width: parent.width
      spacing: 24
      Field {
        id: hiddenPassword
        width: parent.width - hiddenToggle.width - 24
        height: 84
        secret: true
        onAccepted: root.connectHidden()
      }
      ShowToggle {
        id: hiddenToggle
        anchors.verticalCenter: parent.verticalCenter
      }
    }

    Text {
      visible: root.problem !== ""
      width: parent.width
      text: root.problem
      color: Theme.alert
      font.family: Theme.sans
      font.pixelSize: Theme.body
      font.weight: Font.DemiBold
      wrapMode: Text.Wrap
    }

    BigButton {
      width: parent.width
      implicitHeight: Theme.bigButtonHeight - 8
      text: "Connect"
      fontSize: Theme.label - 2
      elevation: 1
      onClicked: root.connectHidden()
    }
  }

  // ---- joining, joined, didn't work, forget --------------------------------------

  Column {
    id: messageStep
    visible: root.step === "joining" || root.step === "done" || root.step === "failed" || root.step === "forget"
    anchors.centerIn: parent
    anchors.verticalCenterOffset: 30
    width: Math.min(1000, parent.width - Theme.margin * 4)
    spacing: 14

    readonly property string name: root.target ? root.target.name : Wifi.joiningName
    readonly property bool portal: Wifi.result !== null && Wifi.result.portal === true

    Rectangle {
      anchors.horizontalCenter: parent.horizontalCenter
      visible: root.step === "done"
      width: 110
      height: 110
      radius: 55
      color: Theme.accentSoft

      Icon {
        anchors.centerIn: parent
        name: messageStep.portal ? "offline" : "check"
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
        case "joining": return "Joining " + messageStep.name + "…"
        case "done": return messageStep.portal ? "Connected. One more step." : "Connected. You're back on the internet."
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
        case "joining": return "This can take up to a minute."
        case "done":
          return messageStep.portal ? "This network needs you to sign in. The sign-in page opens in the Browser window."
            : "The computer will join " + messageStep.name + " by itself next time."
        case "failed":
          return Wifi.result ? root.failText(Wifi.result.reason, messageStep.name) : ""
        case "forget":
          return "The computer won't join it by itself anymore. To join it again, you'll need its password."
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
      visible: root.step !== "joining"
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
          var name = root.target.name
          Wifi.forget(name, function(ok) {
            root.notice = ok ? name + " was forgotten." : ""
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
        visible: root.step === "done" && messageStep.portal
        text: "Open the sign-in page"
        fontSize: Theme.label - 6
        implicitHeight: 90
        padding: 40
        elevation: 1
        onClicked: Wifi.openSignIn()
      }
      BigButton {
        visible: root.step === "done" && !messageStep.portal
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
        elevation: 1
        onClicked: root.back()
      }
    }
  }
}
