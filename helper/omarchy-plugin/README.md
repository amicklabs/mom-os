# Omarchy bar widget

A bar widget for the helper's own Omarchy desktop. The icon shows her laptop's state at a glance: online, offline, a help request or a fix waiting for you, or an agent at work. Clicking it opens a panel with her latest screenshot, recent help requests and agent jobs, and buttons for Open screen, Investigate, Approve fix and sending her a message.

It has no logic of its own. Everything comes from the dispatcher over `$XDG_RUNTIME_DIR/momos-dispatcher.sock`, so it needs the dispatcher running on the same machine. See [apps/dispatcher](../../apps/dispatcher/README.md).

## Install

```sh
helper/omarchy-plugin/install.sh               # copy, validate, place in the bar
helper/omarchy-plugin/install.sh --uninstall
```

It copies `manifest.json` and the QML files to `~/.config/omarchy/plugins/momos.status`, runs `omarchy plugin validate`, and adds `{ "id": "momos.status" }` to the bar next to the Tailscale icon, backing up `~/.config/omarchy/shell.json` first. Run it again after changing the files.

| File | What |
|---|---|
| `Panel.qml` | the bar icon and the panel |
| `PanelContent.qml` | what's inside the panel |
| `DispatcherClient.qml` | the socket client |
| `manifest.json` | the Omarchy plugin manifest |

