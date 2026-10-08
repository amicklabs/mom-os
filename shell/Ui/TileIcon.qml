import QtQuick
import qs.Common
import "icons.js" as Icons

// A tile's icon in its round well, in the style she picked under More:
// a line icon in the theme's accent, or the app's own colored mark from
// shell/icons/. A name that isn't built in is looked up as an SVG of her
// own, icons/<name>.svg next to config.json, and drawn as it is in either
// style. If that's missing too, it falls back to "app".
Rectangle {
  id: root

  property string name: ""
  property int size: 88
  property bool colorful: Theme.colorfulIcons
  // The theme to draw in. Theme previews pass their own; tiles use hers.
  property bool dark: Theme.dark
  property color soft: Theme.accentSoft
  property color ink: Theme.accent
  property real weight: 1.5

  readonly property bool builtIn: Icons.tileNames.indexOf(name) >= 0
  readonly property string known: builtIn ? name : "app"
  // Only a plain name, so it can't reach outside the icons folder.
  readonly property string customSource: !builtIn && /^[a-z0-9][a-z0-9-]{0,39}$/.test(name)
    ? "file://" + Store.iconsDir + name + ".svg" : ""
  // A missing or broken file never gets to Ready, so "app" shows instead.
  readonly property bool custom: customImage.status === Image.Ready
  readonly property int side: Math.round(size * 0.62)

  width: size
  height: size
  radius: size / 2
  color: colorful ? Theme.brandWell(dark) : soft

  Icon {
    visible: !root.colorful && !root.custom
    anchors.centerIn: parent
    name: root.known
    size: Math.round(root.size * 0.56)
    color: root.ink
    weight: root.weight
  }

  Image {
    visible: root.colorful && !root.custom
    anchors.centerIn: parent
    width: root.side
    height: root.side
    sourceSize.width: root.side
    sourceSize.height: root.side
    smooth: true
    asynchronous: false
    source: root.colorful && !root.custom ? Qt.resolvedUrl("../icons/" + root.known + ".svg") : ""
  }

  Image {
    id: customImage
    visible: root.custom
    anchors.centerIn: parent
    width: root.side
    height: root.side
    sourceSize.width: root.side
    sourceSize.height: root.side
    smooth: true
    asynchronous: false
    source: root.customSource
  }
}
