import QtQuick
import qs.Common
import qs.Ui

// The Colors page under More: a picture of the home screen in each theme,
// three to a row. A tap switches to it.
Item {
  id: root

  readonly property int columns: 3
  readonly property int rows: Math.ceil(Theme.themes.length / columns)
  readonly property int spacing: 24
  readonly property real cardWidth: (width - spacing * (columns - 1)) / columns
  readonly property real cardHeight: (height - spacing * (rows - 1)) / rows

  Grid {
    anchors.fill: parent
    columns: root.columns
    spacing: root.spacing

    Repeater {
      model: Theme.themes

      ThemePreview {
        required property var modelData
        width: root.cardWidth
        height: root.cardHeight
        look: modelData
        selected: Appearance.theme === modelData.id
        onChosen: Appearance.setTheme(modelData.id)
      }
    }
  }
}
