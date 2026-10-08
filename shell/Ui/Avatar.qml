import QtQuick
import QtQuick.Effects
import qs.Common
import "../Common/validate.js" as Validate

// A round photo of a family member, or their initials if there's no photo.
Item {
  id: root

  property string name: ""
  property string photo: ""
  property int size: 200

  width: size
  height: size

  readonly property bool hasPhoto: photo !== "" && image.status === Image.Ready

  RectangularShadow {
    anchors.fill: parent
    radius: width / 2
    offset.y: 6
    blur: 24
    spread: -2
    color: Qt.alpha(Theme.shadow, Theme.shadowStrength * 1.3)
  }

  Rectangle {
    anchors.fill: parent
    radius: width / 2
    color: Theme.accentSoft
    visible: !root.hasPhoto

    Text {
      anchors.centerIn: parent
      text: Validate.initials(root.name)
      color: Theme.accent
      font.family: Theme.serif
      font.pixelSize: Math.round(root.size * 0.36)
    }
  }

  Image {
    id: image
    anchors.fill: parent
    source: Store.photoUrl(root.photo)
    sourceSize.width: root.size * 2
    sourceSize.height: root.size * 2
    fillMode: Image.PreserveAspectCrop
    asynchronous: true
    visible: false
  }

  Rectangle {
    id: mask
    anchors.fill: parent
    radius: width / 2
    visible: false
    layer.enabled: true
  }

  MultiEffect {
    anchors.fill: parent
    source: image
    visible: root.hasPhoto
    maskEnabled: true
    maskSource: mask
    maskThresholdMin: 0.5
    maskSpreadAtMin: 1.0
  }

  Rectangle {
    anchors.fill: parent
    radius: width / 2
    color: "transparent"
    border.width: Math.max(3, Math.round(root.size / 50))
    border.color: Theme.surface
  }
}
