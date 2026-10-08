pragma Singleton
import QtQuick
import Quickshell
import Quickshell.Io
import "themes.js" as Themes

// Her chosen colors, text size and icons, kept in appearance.json next to
// config.json. The shell owns the file: momd rewrites config.json from Convex,
// so the choice lives apart from it. Anything else may write the same file
// (atomic rename) and the shell follows it. See docs/contracts.md.
//
//   { "version": 2, "theme": "morning", "textSize": "large", "icons": "simple" }
//
// Version 1 files (no "version") had two sizes, "regular" and "larger". They
// are today's "large" and "xlarge", so an old file is read that way and
// rewritten as version 2, and her text doesn't change size.
//
// Environment:
//   MOMOS_APPEARANCE  path to appearance.json (default: next to config.json)
Singleton {
  id: root

  readonly property string path: {
    var env = Quickshell.env("MOMOS_APPEARANCE")
    if (env) return env
    var config = Store.configPath
    return config.slice(0, config.lastIndexOf("/") + 1) + "appearance.json"
  }

  // A theme id from themes.js, a size from `sizes`, and "simple" (line icons
  // in the theme's color) or "colorful" (the apps' own marks).
  property string theme: Themes.fallback
  property string textSize: "large"
  property string icons: "simple"

  readonly property var sizes: ["regular", "large", "xlarge"]
  function knownSize(id) { return sizes.indexOf(id) >= 0 ? id : "large" }

  function apply(text) {
    var data = null
    try {
      data = JSON.parse(text)
    } catch (e) {
      console.warn("momos: appearance.json isn't valid JSON; using the defaults")
    }
    var parsed = data !== null && typeof data === "object"
    data = parsed ? data : {}
    theme = typeof data.theme === "string" && Themes.byId(data.theme) ? data.theme : Themes.fallback
    icons = data.icons === "colorful" ? "colorful" : "simple"
    if (data.version === 2) {
      textSize = knownSize(data.textSize)
    } else {
      textSize = data.textSize === "larger" ? "xlarge" : "large"
      if (parsed) save()
    }
  }

  function save() {
    file.setText(JSON.stringify({ version: 2, theme: theme, textSize: textSize, icons: icons }, null, 2) + "\n")
  }

  function setTheme(id) {
    if (!Themes.byId(id) || id === theme) return
    theme = id
    save()
  }

  function setTextSize(id) {
    id = knownSize(id)
    if (id === textSize) return
    textSize = id
    save()
  }

  function setIcons(style) {
    style = style === "colorful" ? "colorful" : "simple"
    if (style === icons) return
    icons = style
    save()
  }

  FileView {
    id: file
    path: root.path
    watchChanges: true
    atomicWrites: true
    printErrors: false
    onLoaded: root.apply(text())
    onFileChanged: reload()
    onSaveFailed: function(error) {
      console.warn("momos: couldn't save " + root.path + " (" + FileViewError.toString(error) + ")")
    }
  }
}
