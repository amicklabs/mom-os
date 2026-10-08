pragma Singleton
import QtQuick
import Quickshell
import Quickshell.Io

// What is on screen right now, and the things her buttons do.
//
// Environment:
//   MOMOS_MOMCTL   momctl binary to run (default "momctl" on PATH)
Singleton {
  id: root

  readonly property string momctl: Quickshell.env("MOMOS_MOMCTL") || "momctl"

  // A page tile's id ("family"), or "" when no page is open.
  property string page: ""
  property bool moreOpen: false
  property bool locked: false

  // The card under the bar's status button (Windows/StatusPanel.qml) that
  // says in words how the internet and battery are. Anything else opening
  // closes it. `statusRight` is the button's right edge, where the card lines up.
  property bool statusOpen: false
  property real statusRight: 0
  // How far the banners reach below the bar (Windows/Banners.qml), so the
  // card opens under them and never covers "Sam is looking at your screen".
  property real bannersBottom: 0
  onMoreOpenChanged: if (moreOpen) statusOpen = false
  onPageChanged: if (page !== "") statusOpen = false
  onHelpOpenChanged: if (helpOpen) statusOpen = false

  // The Help pop-up (Windows/HelpCard.qml), over whatever she's doing.
  property bool helpOpen: false
  // Where the pop-up is:
  //   compose    her words and the four ways to ask
  //   recording  a voice note is being recorded
  //   hidden     the pop-up is out of the way while the screen's picture is taken
  //   sending    momd has it
  //   sent       it reached the helper
  //   offline    it waits on the laptop and goes when the internet is back
  //   failed     it didn't go yet; momd keeps trying
  //   unreachable  momd isn't answering, so only the phone number helps
  property string helpStage: "compose"
  // What she's typed, kept if she closes the pop-up without sending.
  property string helpDraft: ""
  // What the last request asked for: "message", "screenshot", "call-me", "voice".
  property var helpKinds: []
  property real helpPressedAt: 0
  property real helpRecordingSince: 0
  property string helpVoiceProblem: ""

  // The photo screensaver, turned on by hypridle through IPC.
  property bool screensaver: false

  // Message cards waiting for her (Windows/Notifications.qml), for the lock
  // screen, which covers the cards: how many messages, and who sent the
  // newest.
  property int messagesWaiting: 0
  property string messageFrom: ""

  // Reminder keys she pressed OK on, so the card goes at once, before momd's
  // next state.json.
  property var answered: ({})
  readonly property var dueReminders: Store.remindersDue.filter(function(r) { return !root.answered[r.key] })
  readonly property var dueReminder: dueReminders.length > 0 ? dueReminders[0] : null

  function answerReminder(key) {
    var next = Object.assign({}, answered)
    next[key] = true
    answered = next
    run(["reminder-ok", key])
  }

  function setScreensaver(on) {
    // Never over the lock screen or a reminder waiting for her.
    screensaver = on && !locked && dueReminder === null
  }

  // A reminder coming due or a new message wakes her screen.
  onDueReminderChanged: if (dueReminder !== null) screensaver = false
  property string lastBannerId: ""
  Connections {
    target: Store
    // state.json is re-read often, so compare ids, not objects.
    function onBannerChanged() {
      var id = Store.banner ? Store.banner.id : ""
      if (id !== "" && id !== root.lastBannerId) root.screensaver = false
      root.lastBannerId = id
    }
  }

  // ---- Someone looking at her screen -------------------------------------------
  //
  // When someone starts looking, the full banner (Windows/Banners.qml) says
  // so for 10 seconds or until she presses OK, and again when they get her
  // mouse. After that the eye on the bar says it, for as long as anyone is
  // connected, and tapping the eye brings the words back. The countdown waits
  // while the screensaver or the lock screen is up, since both show their own
  // line and hide the banner.
  //
  // When control changes, momd restarts its side and the browser reconnects
  // within a few seconds, so a gap of up to 15 seconds is the same session:
  // the eye stays, and only getting her mouse is news.
  property bool viewing: false
  // Whether they can use her mouse, held through the gap too.
  property bool viewerControl: false
  property string viewerNotice: ""
  readonly property bool viewerNoticeShown: viewerNotice !== "" && !screensaver && !locked

  function showViewerNotice(text) {
    viewerNotice = text || Store.viewerText
    if (viewerNoticeShown) viewerNoticeTimer.restart()
  }
  // A fresh 10 seconds each time the banner comes back into view.
  onViewerNoticeShownChanged: {
    if (viewerNoticeShown) viewerNoticeTimer.restart()
    else viewerNoticeTimer.stop()
  }

  function hideViewerNotice() {
    viewerNotice = ""
  }

  function followViewer() {
    var control = Store.viewerControl
    if (!Store.viewerConnected) {
      if (viewing && !viewerGapTimer.running) viewerGapTimer.start()
      return
    }
    viewerGapTimer.stop()
    if (!viewing) {
      viewing = true
      showViewerNotice(Store.viewerText)
    } else if (control && !viewerControl) {
      // While the first banner is still up or waiting for her, say both.
      showViewerNotice(viewerNotice !== "" ? Store.viewerText : Store.helperTitle + " can move your mouse")
    }
    viewerControl = control
  }

  Connections {
    target: Store
    // Both can change in one state.json; look once both are settled.
    function onViewerConnectedChanged() { Qt.callLater(root.followViewer) }
    function onViewerControlChanged() { Qt.callLater(root.followViewer) }
  }

  Timer {
    id: viewerGapTimer
    interval: 15000
    onTriggered: {
      if (Store.viewerConnected) return
      root.viewing = false
      root.viewerControl = false
      root.hideViewerNotice()
    }
  }

  Timer {
    id: viewerNoticeTimer
    interval: 10000
    onTriggered: root.hideViewerNotice()
  }

  // Runs momctl with the given arguments. `done(exitCode, data)` is optional;
  // `data` is the `data` field of momctl's JSON, or null.
  // Wrapped in sh so a missing binary still reports an exit code (127).
  function run(args, done) {
    var proc = processComponent.createObject(root, {
      command: ["sh", "-c", "exec \"$@\"", "momos-shell", root.momctl].concat(args)
    })
    proc.done = done || null
    proc.running = true
    // Her words stay out of the journal.
    console.log("momos: momctl " + args.map(function(a, i) { return args[i - 1] === "--text" ? "…" : a }).join(" "))
  }

  function runRaw(command, done) {
    var proc = processComponent.createObject(root, { command: command })
    proc.done = done || null
    proc.running = true
  }

  Component {
    id: processComponent
    Process {
      property var done: null
      stdout: StdioCollector { id: out }
      onExited: function(exitCode) {
        if (exitCode !== 0) console.warn("momos: " + command[4] + " exited " + exitCode)
        var data = null
        try {
          var parsed = JSON.parse(String(out.text || "").trim().split("\n").pop())
          data = parsed && parsed.ok ? parsed.data : null
        } catch (e) {
          // not JSON; data stays null
        }
        if (done) done(exitCode, data)
        destroy()
      }
    }
  }

  // Close anything the shell has open on top of the home screen.
  function showHome() {
    page = ""
    moreOpen = false
    statusOpen = false
    closeHelp()
  }

  // The bar's Home button.
  function goHome() {
    showHome()
    run(["home"])
  }

  function openTile(tile) {
    moreOpen = false
    if (tile.type === "page") {
      page = tile.page
      return
    }
    page = ""
    run(["open", tile.id])
  }

  // Telegram chat for someone on the Family page. The contract has no momctl
  // command for this, so focus Telegram's workspace through momctl and then
  // hand Telegram the tg:// link. The username was checked against
  // [A-Za-z0-9_]{5,32} and is passed as an argument, never parsed by a shell.
  function openChat(member) {
    page = ""
    var url = "tg://resolve?domain=" + member.telegram
    runRaw(["sh", "-c", "\"$1\" open telegram; exec xdg-open \"$2\"", "momos-shell", root.momctl, url])
  }

  function lock() {
    moreOpen = false
    page = ""
    locked = true
    statusOpen = false
  }

  function unlock() {
    locked = false
  }

  // Tell momd, so the lock shows in her status and events. However the lock
  // changed (her PIN, the More panel, or `momctl lock/unlock` through IPC),
  // this is the one place that sees it.
  // The screensaver never sits on top of the lock screen.
  onLockedChanged: {
    run(["lock-state", locked ? "locked" : "unlocked"])
    if (locked) screensaver = false
    // The Help pop-up never sits over the lock screen.
    if (locked && helpOpen) closeHelp()
  }


  // ---- Help ------------------------------------------------------------------
  //
  // The bar's Help button opens the pop-up. Each way of asking runs
  // `momctl help` with her words and a flag, and momd answers with how it went:
  // sent, offline (waiting on the laptop) or failed (waiting, still trying).

  readonly property bool helpBusy: helpStage === "hidden" || helpStage === "sending"

  function openHelp() {
    moreOpen = false
    // A finished request's card makes way for a fresh one.
    if (helpStage !== "recording" && !helpBusy) helpStage = "compose"
    helpVoiceProblem = ""
    helpOpen = true
  }

  // "Never mind", Esc, a click outside the card, or OK after sending. A voice
  // note being recorded is thrown away. A request on its way keeps going.
  function closeHelp() {
    if (helpStage === "recording") run(["voice", "cancel"])
    helpOpen = false
    if (!helpBusy) helpStage = "compose"
  }

  function toggleHelp() {
    if (helpOpen && helpStage !== "hidden") closeHelp()
    else openHelp()
  }

  // Sends a request. `o`: { text, screenshot, callMe, voice }.
  function sendHelp(o) {
    if (helpBusy) return
    var text = String(o.text || "").trim()
    var args = ["help"]
    if (text !== "") args.push("--text", text)
    if (o.screenshot) args.push("--screenshot")
    if (o.callMe) args.push("--call-me")
    if (o.voice) args.push("--voice")
    var kinds = []
    if (text !== "") kinds.push("message")
    if (o.screenshot) kinds.push("screenshot")
    if (o.callMe) kinds.push("call-me")
    if (o.voice) kinds.push("voice")
    helpKinds = kinds
    helpPressedAt = Date.now()
    if (!Store.momdUp) {
      helpStage = "unreachable"
      return
    }
    // For a picture, the pop-up gets out of the way first. HelpCard hides
    // itself in this stage; the timer gives the compositor a moment to take
    // it off the screen.
    if (o.screenshot) {
      helpStage = "hidden"
      pendingHelpArgs = args
      helpShotTimer.restart()
      return
    }
    helpStage = "sending"
    runHelp(args)
  }

  property var pendingHelpArgs: []

  Timer {
    id: helpShotTimer
    interval: 400
    onTriggered: root.runHelp(root.pendingHelpArgs)
  }

  function runHelp(args) {
    run(args, function(code, data) {
      var status = data && data.status ? data.status : ""
      if (status === "sent") {
        root.helpDraft = ""
        root.helpStage = "sent"
      } else if (status === "offline" || status === "failed") {
        // It waits on the laptop and goes by itself later.
        root.helpDraft = ""
        root.helpStage = status
      } else {
        root.helpStage = "unreachable"
      }
      // Show the answer, even if she closed the pop-up while it was sending.
      root.helpOpen = true
    })
  }

  // momd says "sending" once the picture is taken, so the card can come back.
  // A request that waited and then went through turns "offline" into "sent".
  Connections {
    target: Store
    function onHelpStatusChanged() { root.followHelp() }
    function onHelpAtChanged() { root.followHelp() }
  }

  function followHelp() {
    var fresh = Store.helpAt !== null && Store.helpAt >= helpPressedAt - 1000
    if (helpStage === "hidden" && fresh && Store.helpStatus !== "idle") helpStage = "sending"
    else if ((helpStage === "offline" || helpStage === "failed") && Store.helpStatus === "sent" && Store.helpQueued === 0) helpStage = "sent"
  }

  // Never leave her without the pop-up: if momd doesn't say anything, bring
  // the card back after 15 seconds.
  Timer {
    interval: 15000
    running: root.helpStage === "hidden"
    onTriggered: if (root.helpStage === "hidden") root.helpStage = "sending"
  }

  // "Say it out loud".
  function startVoice() {
    helpVoiceProblem = ""
    if (!Store.momdUp) {
      helpStage = "unreachable"
      return
    }
    run(["voice", "start"], function(code, data) {
      if (code === 0 && data && data.recording) {
        root.helpRecordingSince = Date.now()
        root.helpStage = "recording"
      } else {
        root.helpVoiceProblem = "The microphone isn't working right now. You can write to " + Store.helperName + " instead."
      }
    })
  }

  function cancelVoice() {
    run(["voice", "cancel"])
    helpStage = "compose"
  }

  // "Message Sam on Telegram": her chat with the helper, then the pop-up
  // goes. The username was checked against [A-Za-z0-9_]{5,32}.
  function openHelperChat() {
    if (Store.helperTelegram === "") return
    closeHelp()
    page = ""
    var url = "tg://resolve?domain=" + Store.helperTelegram
    runRaw(["sh", "-c", "\"$1\" open telegram; exec xdg-open \"$2\"", "momos-shell", root.momctl, url])
  }

}
