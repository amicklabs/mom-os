import QtQuick
import Quickshell
import Quickshell.Wayland
import Quickshell.Services.Pipewire
import qs.Common
import qs.Ui

// A card near the bottom of the screen that shows the volume for a moment
// after it changes: from the keyboard's volume keys, `momctl volume`, or an
// app. It watches the default speaker through PipeWire, so it doesn't matter
// what changed it. It never takes clicks or focus.
PanelWindow {
  id: root

  readonly property PwNode sink: Pipewire.defaultAudioSink
  readonly property bool ready: sink !== null && sink.ready && sink.audio !== null
  readonly property real volume: ready ? sink.audio.volume : 0
  readonly property bool muted: ready ? sink.audio.muted : false
  readonly property int percent: Math.round(Math.min(1.5, volume) * 100)

  // Changes in the first moment after the speaker appears are it reporting
  // its levels, not someone changing them.
  property bool armed: false
  property bool shown: false

  function changed() {
    if (!armed) return
    shown = true
    hideTimer.restart()
  }

  onReadyChanged: {
    armed = false
    if (ready) armTimer.restart()
  }
  onVolumeChanged: changed()
  onMutedChanged: changed()

  PwObjectTracker { objects: root.sink ? [root.sink] : [] }

  Timer {
    id: armTimer
    interval: 1000
    onTriggered: root.armed = root.ready
  }

  Timer {
    id: hideTimer
    interval: 1500
    onTriggered: root.shown = false
  }

  visible: card.opacity > 0
  anchors.bottom: true
  // Room around the card for its shadow.
  margins.bottom: 30
  implicitWidth: card.width + 120
  implicitHeight: card.height + 120
  exclusionMode: ExclusionMode.Ignore
  color: "transparent"
  mask: Region {}
  WlrLayershell.layer: WlrLayer.Overlay
  WlrLayershell.namespace: "momos-volume"
  WlrLayershell.keyboardFocus: WlrKeyboardFocus.None

  Surface {
    id: card
    anchors.centerIn: parent
    width: 520
    height: 112
    radius: Theme.radiusLarge
    elevation: 3
    opacity: root.shown ? 1 : 0
    Behavior on opacity { NumberAnimation { duration: root.shown ? 120 : 400; easing.type: Easing.OutCubic } }

    Icon {
      id: speaker
      anchors.left: parent.left
      anchors.leftMargin: 30
      anchors.verticalCenter: parent.verticalCenter
      name: root.muted || root.percent === 0 ? "muted" : "louder"
      size: 52
      color: Theme.accent
      weight: 1.7
    }

    Text {
      id: amount
      anchors.right: parent.right
      anchors.rightMargin: 32
      anchors.verticalCenter: parent.verticalCenter
      width: 104
      horizontalAlignment: Text.AlignRight
      text: root.muted ? "Off" : root.percent + "%"
      color: Theme.ink
      font.family: Theme.sans
      font.pixelSize: 40
      font.weight: Font.DemiBold
    }

    // The level, as a thick rounded track.
    Rectangle {
      anchors.left: speaker.right
      anchors.leftMargin: 24
      anchors.right: amount.left
      anchors.rightMargin: 20
      anchors.verticalCenter: parent.verticalCenter
      height: 16
      radius: 8
      color: Theme.accentSoft

      Rectangle {
        width: root.muted ? 0 : parent.width * Math.min(1, root.volume)
        height: parent.height
        radius: parent.radius
        color: Theme.accent
        Behavior on width { NumberAnimation { duration: 120; easing.type: Easing.OutCubic } }
      }
    }
  }
}
