import QtQuick
import Quickshell
import Quickshell.Wayland
import qs.Common
import qs.Ui

// Big banners at the top center, just under the bar.
PanelWindow {
  id: root

  required property var modelData
  screen: modelData

  // Banner ids she has pressed OK on.
  property var dismissed: ({})

  readonly property var banner: Store.banner && !dismissed[Store.banner.id] ? Store.banner : null
  // The Internet connection page shows the same thing itself, and the card
  // would cover its Back button.
  readonly property bool offlineCard: Store.online === false && Session.page !== "wifi"
  readonly property bool viewerCard: Session.viewing && Session.viewerNotice !== ""
  readonly property bool any: viewerCard || offlineCard || banner !== null
    || Store.updating !== ""

  // Room around the cards for their shadows.
  readonly property int shadowRoom: 28

  // The screensaver shows its own "looking at your screen" notice, and a new
  // message ends the screensaver (Session.qml).
  visible: any && !Session.screensaver
  anchors { top: true }
  margins.top: 0
  exclusionMode: ExclusionMode.Normal
  implicitWidth: Math.min(1100, (screen ? screen.width : 1366) - Theme.margin * 2) + shadowRoom * 2
  implicitHeight: Math.max(1, column.implicitHeight + shadowRoom + 14)
  color: "transparent"
  WlrLayershell.layer: WlrLayer.Overlay
  WlrLayershell.namespace: "momos-banners"
  WlrLayershell.keyboardFocus: WlrKeyboardFocus.None

  // The bar's status card opens below the banners (StatusPanel.qml).
  Binding {
    target: Session
    property: "bannersBottom"
    value: root.visible ? 14 + column.implicitHeight + 14 : 0
  }

  // momd writes the whole text, "Sam says: …" included.
  function bannerText(b) {
    return b ? b.text : ""
  }

  function bannerColor(b) {
    if (!b) return Theme.message
    if (b.kind === "warning") return Theme.warning
    if (b.kind === "info") return Theme.info
    return Theme.message
  }

  function bannerIcon(b) {
    if (b && b.kind === "warning") return "offline"
    if (b && b.kind === "info") return "bell"
    return "message"
  }

  Column {
    id: column
    x: root.shadowRoom
    y: 14
    width: parent.width - root.shadowRoom * 2
    spacing: 14

    // When someone starts looking, or gets her mouse, for 10 seconds or
    // until OK. The eye on the bar stays while they're connected, and
    // tapping it brings this back (Session.qml).
    Card {
      width: parent.width
      visible: root.viewerCard
      fill: Theme.viewer
      icon: "eye"
      fontSize: Theme.body + 6
      text: Session.viewerNotice
      buttonText: "OK"
      onButtonClicked: Session.hideViewerNotice()
    }

    // A hotel or cafe network that wants her to sign in says so, with a way
    // to the sign-in page. Otherwise she can pick another network herself,
    // since the helper can't reach her without the internet.
    Card {
      width: parent.width
      visible: root.offlineCard
      fill: Theme.warning
      icon: "offline"
      text: Wifi.portal ? "This network needs you to sign in before the internet works."
        : "The internet isn't working right now."
      buttonText: Wifi.portal ? "Sign in" : "Connect to a network"
      onButtonClicked: {
        if (Wifi.portal) {
          Wifi.openSignIn()
        } else {
          Session.moreOpen = false
          Session.closeHelp()
          Session.page = "wifi"
        }
      }
    }

    Card {
      width: parent.width
      visible: root.banner !== null
      fill: root.bannerColor(root.banner)
      icon: root.bannerIcon(root.banner)
      fontSize: Theme.body + 6
      text: root.bannerText(root.banner)
      buttonText: "OK"
      onButtonClicked: {
        var next = Object.assign({}, root.dismissed)
        next[root.banner.id] = true
        root.dismissed = next
      }
    }

    // While the helper deploys or updates, so a blink or restart doesn't
    // surprise her. It goes when he's done. See Common/updating.js.
    Card {
      width: parent.width
      visible: Store.updating !== ""
      fill: Theme.info
      icon: Store.updating === "done" ? "check" : "refresh"
      fontSize: Theme.body + 6
      text: Store.updatingText
    }
  }
}
