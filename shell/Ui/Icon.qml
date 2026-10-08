import QtQuick
import QtQuick.Shapes
import qs.Common
import "icons.js" as Icons

// A line icon from icons.js, drawn in one color so it matches the theme.
// Unknown names fall back to "app".
Item {
  id: root

  property string name: ""
  property int size: 48
  property color color: Theme.ink
  // Line weight on the 24-unit grid.
  property real weight: 1.6

  readonly property var icon: Icons.get(name)

  width: size
  height: size

  Shape {
    width: 24
    height: 24
    preferredRendererType: Shape.CurveRenderer
    transform: Scale { xScale: root.size / 24; yScale: root.size / 24 }

    ShapePath {
      strokeColor: root.icon.stroke ? root.color : "transparent"
      strokeWidth: root.weight
      fillColor: "transparent"
      capStyle: ShapePath.RoundCap
      joinStyle: ShapePath.RoundJoin
      PathSvg { path: root.icon.stroke || "" }
    }

    ShapePath {
      strokeColor: "transparent"
      strokeWidth: 0
      fillColor: root.icon.fill ? root.color : "transparent"
      PathSvg { path: root.icon.fill || "" }
    }
  }
}
