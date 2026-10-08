import QtQuick
import qs.Common

// A banner: a deep-colored card on a soft shadow, with a small icon, large
// text and an optional button.
Surface {
  id: root

  property string text: ""
  property string icon: ""
  property color fill: Theme.message
  property color ink: Theme.bannerInk
  property string buttonText: ""
  property int fontSize: Theme.body + 4

  signal buttonClicked()

  implicitHeight: Math.max(label.implicitHeight, button.visible ? button.implicitHeight : 0, 56) + 36
  radius: Theme.radiusLarge
  elevation: 3
  color: fill

  Rectangle {
    id: badge
    visible: root.icon !== ""
    anchors.left: parent.left
    anchors.leftMargin: 22
    anchors.verticalCenter: parent.verticalCenter
    width: 56
    height: 56
    radius: 28
    color: Qt.alpha(root.ink, 0.16)

    Icon {
      anchors.centerIn: parent
      name: root.icon
      size: 32
      color: root.ink
      weight: 1.8
    }
  }

  Text {
    id: label
    anchors.left: badge.visible ? badge.right : parent.left
    anchors.leftMargin: badge.visible ? 20 : 30
    anchors.right: button.visible ? button.left : parent.right
    anchors.rightMargin: 24
    anchors.verticalCenter: parent.verticalCenter
    text: root.text
    color: root.ink
    font.family: Theme.sans
    font.pixelSize: root.fontSize
    font.weight: Font.DemiBold
    lineHeight: 1.05
    wrapMode: Text.Wrap
    maximumLineCount: 4
    elide: Text.ElideRight
  }

  BigButton {
    id: button
    visible: root.buttonText !== ""
    anchors.right: parent.right
    anchors.rightMargin: 18
    anchors.verticalCenter: parent.verticalCenter
    text: root.buttonText
    fill: Theme.surface
    fillPressed: Theme.pressed
    ink: Theme.ink
    implicitHeight: 64
    padding: 44
    onClicked: root.buttonClicked()
  }
}
