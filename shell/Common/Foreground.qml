pragma Singleton
import QtQuick
import Quickshell
import Quickshell.Hyprland
import "foreground.js" as F

// What she's looking at, for the bar: `current` is { label, icon, tileId, brand },
// or null on the home screen. A page the shell has open wins; otherwise it's
// Hyprland's focused workspace and active window, matched to her tiles in
// foreground.js. The Help pop-up and the More panel sit over whatever she's
// on, so they don't change it. Works without momd.
Singleton {
  id: root

  readonly property var toplevel: Hyprland.activeToplevel
  readonly property string windowClass: {
    var t = toplevel
    if (!t) return ""
    if (t.wayland && t.wayland.appId) return t.wayland.appId
    var ipc = t.lastIpcObject
    return ipc && ipc.class ? String(ipc.class) : ""
  }
  readonly property string windowWorkspace: toplevel && toplevel.workspace ? toplevel.workspace.name : ""
  readonly property string workspace: Hyprland.focusedWorkspace ? Hyprland.focusedWorkspace.name : ""

  readonly property var current: F.describe({
    page: Session.page,
    tiles: Store.tiles,
    workspace: workspace,
    cls: windowClass,
    windowWorkspace: windowWorkspace
  })

  // XWayland windows have no Wayland handle, so their class comes from
  // Hyprland's own list.
  onToplevelChanged: if (toplevel && !toplevel.wayland) Hyprland.refreshToplevels()
}
