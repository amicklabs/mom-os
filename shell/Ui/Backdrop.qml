import QtQuick
import qs.Common

// The page behind everything: a barely-there wash from top to bottom, with a
// faint paper grain that also keeps the gradient from showing bands.
Rectangle {
  gradient: Gradient {
    GradientStop { position: 0; color: Theme.backgroundTop }
    GradientStop { position: 1; color: Theme.background }
  }

  Image {
    anchors.fill: parent
    source: Qt.resolvedUrl("../images/grain.png")
    fillMode: Image.Tile
    opacity: Theme.dark ? 0.6 : 1
    smooth: false
  }
}
