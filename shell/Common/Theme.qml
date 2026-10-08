pragma Singleton
import QtQuick
import Quickshell
import "themes.js" as Themes

// Every color, font and size the shell uses. The colors come from the theme
// she picked (themes.js, chosen through Appearance.qml) and fade to a new
// theme instead of jumping. Sizes are tuned for a 1366x768 screen read at
// arm's length; no text is smaller than 20 px.
Singleton {
  id: root

  // ---- fonts ------------------------------------------------------------------
  // Bundled in shell/fonts (SIL Open Font License), so the look doesn't depend
  // on what's installed. Newsreader for the greeting, titles and the clock,
  // Source Sans 3 for everything she reads to act.
  readonly property string serif: "Newsreader 16pt"
  readonly property string sans: "Source Sans 3"
  readonly property string font: sans

  property FontLoader serifRegular: FontLoader { source: Qt.resolvedUrl("../fonts/Newsreader16pt-Regular.ttf") }
  property FontLoader serifMedium: FontLoader { source: Qt.resolvedUrl("../fonts/Newsreader16pt-Medium.ttf") }
  property FontLoader serifItalic: FontLoader { source: Qt.resolvedUrl("../fonts/Newsreader16pt-Italic.ttf") }
  property FontLoader sansRegular: FontLoader { source: Qt.resolvedUrl("../fonts/SourceSans3-Regular.ttf") }
  property FontLoader sansMedium: FontLoader { source: Qt.resolvedUrl("../fonts/SourceSans3-Medium.ttf") }
  property FontLoader sansSemibold: FontLoader { source: Qt.resolvedUrl("../fonts/SourceSans3-Semibold.ttf") }
  property FontLoader sansBold: FontLoader { source: Qt.resolvedUrl("../fonts/SourceSans3-Bold.ttf") }

  // ---- type scale -------------------------------------------------------------
  // The sizes below are for Large, the default. Text size under More scales
  // them by a step of about 1.25, big enough to notice: Regular is 0.8 and
  // X-Large 1.25. Nothing goes below 20 px, and nothing she reads is below
  // 26 px at Large.
  readonly property var textScales: ({ regular: 0.8, large: 1, xlarge: 1.25 })
  readonly property real textScale: textScales[Appearance.textSize] || 1
  function scaled(px) { return Math.max(20, Math.round(px * textScale)) }

  readonly property int small: scaled(26)
  readonly property int body: scaled(26)
  readonly property int button: scaled(28)
  readonly property int label: scaled(38)
  readonly property int title: scaled(44)
  readonly property int huge: scaled(60)
  readonly property int giant: scaled(80)

  // Bar text. The buttons and clock keep their sizes so the bar fits on one
  // row; the date, the name of what she's on and the warnings follow her
  // text size, up to what the bar can hold.
  readonly property int barText: 28
  readonly property int barSmall: Math.min(30, scaled(26))
  readonly property int barClock: 40
  readonly property int barApp: Math.min(34, scaled(30))

  // ---- dimensions -------------------------------------------------------------
  readonly property int barHeight: 84
  readonly property int radius: 18
  readonly property int radiusLarge: 26
  readonly property int border: 2
  readonly property int gap: 20
  readonly property int margin: 40
  readonly property int buttonHeight: 68
  readonly property int bigButtonHeight: 96

  // ---- motion -----------------------------------------------------------------
  readonly property int quick: 140
  readonly property int fade: 500

  // ---- colors -----------------------------------------------------------------
  readonly property var themes: Themes.list
  readonly property string themeId: Appearance.theme
  readonly property var t: Themes.byId(themeId) || Themes.byId(Themes.fallback)
  readonly property bool dark: t.dark

  property color background: t.background
  property color backgroundTop: t.backgroundTop
  property color surface: t.surface
  property color pressed: t.pressed
  property color line: t.line
  property color ink: t.ink
  property color inkSoft: t.inkSoft
  property color shadow: t.shadow
  property color accent: t.accent
  property color accentPressed: t.accentPressed
  property color accentInk: t.accentInk
  property color accentSoft: t.accentSoft
  property color help: t.help
  property color helpPressed: t.helpPressed
  property color helpInk: t.helpInk
  property color helpDone: t.helpDone
  property color bar: t.bar
  property color barLine: t.barLine
  property color quiet: t.quiet
  property color quietPressed: t.quietPressed
  property color alert: t.alert
  property color viewer: t.viewer
  property color warning: t.warning
  property color message: t.message
  property color info: t.info
  property color bannerInk: t.bannerInk
  property color scrim: t.scrim
  property color saver: t.saver
  property color saverInk: t.saverInk
  property color saverInkSoft: t.saverInkSoft

  // Cards that float over other things (reminders, messages, More). On dark
  // themes they are a step lighter, since a shadow alone barely shows.
  readonly property color raised: dark ? Qt.lighter(surface, 1.28) : surface

  // Tile icons: "simple" line icons in the accent color on an accentSoft well,
  // or "colorful" brand marks on a soft neutral well. The neutral well keeps
  // the marks' own colors true on every theme; on dark themes it's a muted
  // off-white so it doesn't glare.
  readonly property bool colorfulIcons: Appearance.icons === "colorful"
  function brandWell(isDark) { return isDark ? "#E4E0D8" : "#F1EDE6" }

  // How strong shadows are: stronger on dark themes, where they read less.
  readonly property real shadowStrength: dark ? 0.45 : 0.14

  // A new theme fades in over half a second rather than snapping.
  component Fade: ColorAnimation { duration: root.fade; easing.type: Easing.InOutQuad }
  Behavior on background { Fade {} }
  Behavior on backgroundTop { Fade {} }
  Behavior on surface { Fade {} }
  Behavior on pressed { Fade {} }
  Behavior on line { Fade {} }
  Behavior on ink { Fade {} }
  Behavior on inkSoft { Fade {} }
  Behavior on shadow { Fade {} }
  Behavior on accent { Fade {} }
  Behavior on accentPressed { Fade {} }
  Behavior on accentInk { Fade {} }
  Behavior on accentSoft { Fade {} }
  Behavior on help { Fade {} }
  Behavior on helpPressed { Fade {} }
  Behavior on helpInk { Fade {} }
  Behavior on helpDone { Fade {} }
  Behavior on bar { Fade {} }
  Behavior on barLine { Fade {} }
  Behavior on quiet { Fade {} }
  Behavior on quietPressed { Fade {} }
  Behavior on alert { Fade {} }
  Behavior on viewer { Fade {} }
  Behavior on warning { Fade {} }
  Behavior on message { Fade {} }
  Behavior on info { Fade {} }
  Behavior on scrim { Fade {} }
  Behavior on saver { Fade {} }
  Behavior on saverInk { Fade {} }
  Behavior on saverInkSoft { Fade {} }
}
