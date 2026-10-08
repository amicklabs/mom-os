import QtQuick
import QtQuick.Effects
import Qt.labs.folderlistmodel
import Quickshell
import Quickshell.Wayland
import qs.Common
import qs.Ui
import "../Common/validate.js" as Validate

// The family photo screensaver. hypridle turns it on through
// `qs -c momos ipc call shell screensaver on`. One photo at a time with a slow
// crossfade and a big clock in the corner; with no photos, a calm clock.
//
// Any input puts her back where she was. The window takes the pointer and the
// keyboard while it's up, and a click or key only dismisses it on release, so
// neither half of the press reaches the app underneath.
PanelWindow {
  id: root

  required property var modelData
  screen: modelData

  readonly property bool active: Session.screensaver && !Session.locked
  readonly property int photoMs: 12000
  readonly property int fadeMs: 2500
  // How far the pointer must travel to count as her moving it, so a bumped
  // table doesn't end the slideshow.
  readonly property int moveSlop: 24

  visible: active
  anchors { top: true; bottom: true; left: true; right: true }
  exclusionMode: ExclusionMode.Ignore
  color: Theme.saver
  WlrLayershell.layer: WlrLayer.Overlay
  WlrLayershell.namespace: "momos-screensaver"
  WlrLayershell.keyboardFocus: active ? WlrKeyboardFocus.Exclusive : WlrKeyboardFocus.None

  function dismiss() {
    Session.screensaver = false
  }

  // ---- photos ----------------------------------------------------------------

  // The folder may not exist when the shell starts (momd makes it on the
  // first sync), and the model doesn't notice it appearing, so each showing
  // points it at the folder afresh.
  readonly property string folderUrl: "file://" + Store.slideshowDir

  FolderListModel {
    id: folder
    folder: root.folderUrl
    nameFilters: ["*.jpg"]
    showDirs: false
    showDotAndDotDot: false
    showHidden: false
    sortField: FolderListModel.Name
  }

  // Shuffled once per showing, so each run starts somewhere new.
  property var order: []
  property int position: 0
  readonly property bool hasPhotos: folder.count > 0

  function shuffle() {
    var list = []
    for (var i = 0; i < folder.count; i++) list.push(String(folder.get(i, "fileUrl")))
    for (var j = list.length - 1; j > 0; j--) {
      var k = Math.floor(Math.random() * (j + 1))
      var t = list[j]; list[j] = list[k]; list[k] = t
    }
    order = list
    position = 0
  }

  // Two images; the hidden one loads the next photo, then fades in.
  property bool frontIsA: true

  function showNext() {
    if (order.length === 0) return
    var url = order[position % order.length]
    position = (position + 1) % Math.max(1, order.length)
    var back = frontIsA ? imageB : imageA
    if (String(back.source) === url && back.status === Image.Ready) {
      root.frontIsA = !root.frontIsA
      return
    }
    back.source = url
  }

  onActiveChanged: {
    if (active) {
      folder.folder = ""
      folder.folder = root.folderUrl
      shuffle()
      imageA.source = ""
      imageB.source = ""
      frontIsA = false
      showNext()
      keys.forceActiveFocus()
    }
    input.origin = null
    input.pressed = false
  }

  Connections {
    target: folder
    function onCountChanged() {
      if (!root.active) return
      var had = root.order.length
      root.shuffle()
      if (had === 0) root.showNext()
    }
  }

  Timer {
    interval: root.photoMs
    running: root.active && root.order.length > 1
    repeat: true
    onTriggered: root.showNext()
  }

  component Photo: Image {
    property bool front: false
    anchors.fill: parent
    fillMode: Image.PreserveAspectFit
    asynchronous: true
    cache: false
    smooth: true
    sourceSize.width: root.width
    sourceSize.height: root.height
    opacity: 0
    Behavior on opacity { NumberAnimation { duration: root.fadeMs; easing.type: Easing.InOutQuad } }
  }

  // Behind each photo, the same photo blurred and filling the screen, so a
  // tall photo sits in its own colors instead of black bars. A tiny decode
  // keeps it cheap on the old graphics chip.
  component Backdrop: Image {
    property Image photo
    anchors.fill: parent
    source: photo.source
    fillMode: Image.PreserveAspectCrop
    asynchronous: true
    cache: false
    smooth: true
    sourceSize.width: 96
    sourceSize.height: 96
    opacity: photo.opacity
    layer.enabled: root.active && root.hasPhotos
    layer.effect: MultiEffect {
      blurEnabled: true
      blur: 1
      blurMax: 48
      saturation: -0.1
    }
  }

  Backdrop { photo: imageA }
  Backdrop { photo: imageB }

  Rectangle {
    anchors.fill: parent
    visible: root.hasPhotos
    color: Qt.alpha(Theme.saver, 0.4)
  }

  Photo {
    id: imageA
    opacity: root.hasPhotos && root.frontIsA && status === Image.Ready ? 1 : 0
    onStatusChanged: if (status === Image.Ready && !root.frontIsA) root.frontIsA = true
  }
  Photo {
    id: imageB
    opacity: root.hasPhotos && !root.frontIsA && status === Image.Ready ? 1 : 0
    onStatusChanged: if (status === Image.Ready && root.frontIsA) root.frontIsA = false
  }

  // ---- clock -------------------------------------------------------------------

  readonly property var now: new Date(Store.now)

  // A soft shadow behind the corner clock so it reads on any photo.
  Rectangle {
    visible: root.hasPhotos
    anchors.left: parent.left
    anchors.right: parent.right
    anchors.bottom: parent.bottom
    height: cornerClock.height + 180
    gradient: Gradient {
      orientation: Gradient.Vertical
      GradientStop { position: 0.0; color: "#00000000" }
      GradientStop { position: 0.55; color: Qt.alpha(Theme.saver, 0.45) }
      GradientStop { position: 1.0; color: Qt.alpha(Theme.saver, 0.8) }
    }
  }

  Column {
    id: cornerClock
    visible: root.hasPhotos
    anchors.left: parent.left
    anchors.bottom: parent.bottom
    anchors.leftMargin: 64
    anchors.bottomMargin: 48
    spacing: -8

    Text {
      text: root.now.toLocaleTimeString(Qt.locale("en_US"), "h:mm AP")
      color: Theme.saverInk
      font.family: Theme.serif
      font.pixelSize: 128
      font.weight: Font.Medium
    }
    Text {
      text: root.now.toLocaleDateString(Qt.locale("en_US"), "dddd, MMMM d")
      color: Theme.saverInk
      font.family: Theme.sans
      font.pixelSize: Theme.title
      font.weight: Font.Medium
    }
  }

  // No photos: a calm clock in the middle.
  Column {
    visible: !root.hasPhotos
    anchors.centerIn: parent
    spacing: 0

    Text {
      anchors.horizontalCenter: parent.horizontalCenter
      text: root.now.toLocaleTimeString(Qt.locale("en_US"), "h:mm AP")
      color: Theme.saverInk
      font.family: Theme.serif
      font.pixelSize: 190
    }
    Text {
      anchors.horizontalCenter: parent.horizontalCenter
      text: root.now.toLocaleDateString(Qt.locale("en_US"), "dddd, MMMM d")
      color: Theme.saverInkSoft
      font.family: Theme.sans
      font.pixelSize: Theme.huge - 8
      font.weight: Font.Medium
    }
    Item { width: 1; height: 36 }
    Rectangle {
      visible: greetingText.text !== ""
      anchors.horizontalCenter: parent.horizontalCenter
      width: 64
      height: 2
      color: Qt.alpha(Theme.saverInk, 0.35)
    }
    Item { width: 1; height: 28 }
    Text {
      id: greetingText
      anchors.horizontalCenter: parent.horizontalCenter
      text: Store.personName ? Validate.greeting(root.now) + ", " + Store.personName + "." : ""
      color: Theme.saverInkSoft
      font.family: Theme.serif
      font.pixelSize: Theme.title
      font.italic: true
    }
  }

  // She's always told when someone is looking, screensaver or not. The bar
  // and its eye are under the screensaver, so the words stay up here the
  // whole time, on one line at every text size.
  Card {
    id: viewerCard
    visible: Store.viewerConnected
    anchors.top: parent.top
    anchors.horizontalCenter: parent.horizontalCenter
    anchors.topMargin: 24
    width: Math.min(parent.width - Theme.margin * 2, 1040)
    fill: Theme.viewer
    icon: "eye"
    fontSize: Math.min(Theme.body + 2, 32)
    text: Store.viewerText
  }

  // And while the helper updates the computer, since the banners are hidden
  // under the screensaver.
  Card {
    visible: Store.updating !== ""
    anchors.top: viewerCard.visible ? viewerCard.bottom : parent.top
    anchors.horizontalCenter: parent.horizontalCenter
    anchors.topMargin: viewerCard.visible ? 14 : 24
    width: viewerCard.width
    fill: Theme.info
    icon: Store.updating === "done" ? "check" : "refresh"
    fontSize: viewerCard.fontSize
    text: Store.updatingText
  }

  // ---- input -----------------------------------------------------------------

  MouseArea {
    id: input
    anchors.fill: parent
    hoverEnabled: true
    acceptedButtons: Qt.AllButtons
    cursorShape: Qt.BlankCursor

    property var origin: null
    property bool pressed: false

    onPressed: function(mouse) {
      mouse.accepted = true
      pressed = true
    }
    // The release ends it, so the app underneath never sees either half.
    onReleased: function(mouse) {
      mouse.accepted = true
      if (pressed) root.dismiss()
      pressed = false
    }
    onPositionChanged: function(mouse) {
      if (origin === null) {
        origin = Qt.point(mouse.x, mouse.y)
        return
      }
      if (!pressed && Math.abs(mouse.x - origin.x) + Math.abs(mouse.y - origin.y) > root.moveSlop) root.dismiss()
    }
    onWheel: function(wheel) {
      wheel.accepted = true
      root.dismiss()
    }
  }

  Item {
    id: keys
    anchors.fill: parent
    focus: true
    Keys.onPressed: function(event) { event.accepted = true }
    Keys.onReleased: function(event) {
      event.accepted = true
      if (!event.isAutoRepeat) root.dismiss()
    }
  }
}
