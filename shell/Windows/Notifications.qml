import QtQuick
import Quickshell
import Quickshell.Io
import Quickshell.Wayland
import Quickshell.Services.Notifications
import qs.Common
import qs.Ui
import "../Common/validate.js" as Validate
import "../Common/notify.js" as Notify

// The shell is her notification server. Each notification is a big card with
// Open and Close, one at a time, newest first. No sounds of our own.
//
// - Messages (Telegram, or a notification that says it's a chat or an email)
//   stay until she presses Open or Close, or until the sender takes them back
//   (Telegram does when she reads the chat, here or on her phone). Several
//   from one chat share a card: "3 new messages from Lucy".
// - Anything else closes by itself after 20 seconds on screen. Time spent
//   waiting behind another card, locked, under the screensaver or with the
//   screen off doesn't count.
// - A new message ends the screensaver and turns a dark screen on, unless the
//   lid is closed (momctl screen on refuses then). If nobody touches the
//   laptop, the screen goes dark again after 10 minutes. The lock screen
//   covers the cards, so it says who wrote instead.
// - At most 20 cards wait. Past that, cards that would close by themselves
//   go first; a message goes only when all 20 are messages, and Telegram's
//   unread badge on the tile still counts it.
// The queue itself is in Common/notify.js.
//
// Environment:
//   MOMOS_NOTIFICATIONS  "1" always serve, "0" never, unset: serve only when
//                        no other notification server is running (so testing
//                        on a desktop that has one doesn't take it over).
//                        momos-shell.service sets "1".
Scope {
  id: root

  readonly property string mode: Quickshell.env("MOMOS_NOTIFICATIONS") || "auto"
  property bool serve: mode === "1"
  // After waking the screen for a message, how long it stays on if nobody
  // touches the laptop.
  readonly property int wakeMs: 10 * 60 * 1000

  // Plain snapshots for the view, newest first (Common/notify.js). Live
  // Notification objects stay in a JS map, key to a list, so a server-side
  // close can't leave a dangling pointer in the model.
  property var cards: []
  property var liveRefs: ({})
  // Key to ms on screen, for cards that close by themselves.
  property var shown: ({})
  property int nextKey: 1

  readonly property var front: cards.length > 0 ? cards[0] : null
  // Whether any monitor is lit, from hyprctl. Assumed lit until known.
  property bool screenLit: true
  readonly property bool onScreen: front !== null && !Session.locked && !Session.screensaver && screenLit

  // Tell the lock screen what's waiting.
  onCardsChanged: {
    var count = 0
    var from = ""
    for (var i = 0; i < cards.length; i++) {
      if (!cards[i].message) continue
      count += cards[i].count || 1
      if (from === "") from = cards[i].summary
    }
    Session.messagesWaiting = count
    Session.messageFrom = from
  }

  function add(summary, body, info, ref) {
    var message = Notify.isMessage(info)
    var card = {
      key: nextKey++,
      created: Date.now(),
      summary: Validate.shorten(summary, 40) || Validate.shorten(info.appName, 40) || "someone",
      body: Validate.shorten(body, 110),
      app: String(info.appName || info.desktopEntry || ""),
      message: message,
      count: 1
    }
    var r = Notify.add(cards, card)
    if (ref) {
      var refs = Object.assign({}, liveRefs)
      refs[r.into] = (refs[r.into] || []).concat([ref])
      liveRefs = refs
      var key = r.into
      ref.closed.connect(function(reason) { root.senderClosed(key, ref, reason) })
    }
    for (var i = 0; i < r.dropped.length; i++) {
      console.warn("momos: too many notifications waiting; dropping one" + (r.dropped[i] === card.key ? ", the newest" : ""))
      release(r.dropped[i], "expire")
    }
    cards = r.cards
    if (message) wakeForMessage()
  }

  // Close the card's notifications with the sender: "dismiss" (she closed or
  // opened it), "expire" (its time ran out), or "none".
  function release(key, how) {
    var refs = liveRefs[key] || []
    var next = Object.assign({}, liveRefs)
    delete next[key]
    liveRefs = next
    for (var i = 0; i < refs.length; i++) {
      try {
        if (how === "dismiss") refs[i].dismiss()
        else if (how === "expire") refs[i].expire()
      } catch (e) {
        // Already closed by the sender.
      }
    }
  }

  function drop(key, how) {
    release(key, how)
    cards = cards.filter(function(c) { return c.key !== key })
  }

  // The sender took a notification back, as Telegram does once she has read
  // the chat. The card goes when all of its notifications are gone.
  function senderClosed(key, ref, reason) {
    if (reason !== NotificationCloseReason.CloseRequested) return
    var refs = liveRefs[key]
    if (!refs) return
    var left = refs.filter(function(r) { return r !== ref })
    if (left.length > 0) {
      var next = Object.assign({}, liveRefs)
      next[key] = left
      liveRefs = next
    } else {
      drop(key, "none")
    }
  }

  function open(card) {
    var refs = liveRefs[card.key] || []
    var ref = refs.length > 0 ? refs[refs.length - 1] : null
    var invoked = false
    try {
      if (ref && ref.actions) {
        for (var i = 0; i < ref.actions.length && !invoked; i++) {
          if (ref.actions[i].identifier === "default") {
            ref.actions[i].invoke()
            invoked = true
          }
        }
        if (!invoked && ref.actions.length > 0) {
          ref.actions[0].invoke()
          invoked = true
        }
      }
    } catch (e) {
      console.warn("momos: notification action failed:", e)
    }
    // Telegram lives on its own workspace; bring it forward either way.
    if (/telegram/i.test(card.app)) Session.run(["open", "telegram"])
    drop(card.key, "dismiss")
  }

  // ---- the clock for cards that close by themselves ---------------------------

  property real lastTick: Date.now()
  Timer {
    interval: 1000
    repeat: true
    running: root.front !== null && !root.front.message
    onRunningChanged: root.lastTick = Date.now()
    onTriggered: {
      var now = Date.now()
      var r = Notify.tick(root.cards, root.shown, root.onScreen, now - root.lastTick)
      root.lastTick = now
      root.shown = r.shown
      for (var i = 0; i < r.expired.length; i++) root.drop(r.expired[i], "expire")
    }
  }

  // ---- is the screen lit? ------------------------------------------------------

  property var afterScreenCheck: []

  function checkScreen(done) {
    if (done) afterScreenCheck = afterScreenCheck.concat([done])
    if (!screenCheck.running) screenCheck.running = true
  }

  Process {
    id: screenCheck
    command: ["hyprctl", "-j", "monitors"]
    stdout: StdioCollector { id: monitorsOut }
    onExited: function(exitCode) {
      var lit = null
      try {
        var mons = JSON.parse(String(monitorsOut.text || ""))
        if (Array.isArray(mons) && mons.length > 0) lit = mons.some(function(m) { return m.dpmsStatus !== false })
      } catch (e) {
        // Hyprland didn't answer; leave it as it was.
      }
      if (lit !== null) root.screenLit = lit
      var waiting = root.afterScreenCheck
      root.afterScreenCheck = []
      for (var i = 0; i < waiting.length; i++) waiting[i](lit)
    }
  }

  // Only while a card is counting down, or while the screen is on because of
  // a message.
  Timer {
    interval: 5000
    repeat: true
    running: (root.front !== null && !root.front.message) || root.wokeScreen
    triggeredOnStart: true
    onTriggered: root.checkScreen(null)
  }

  // ---- waking the screen for a message -----------------------------------------

  // True from turning the screen on for a message until she touches the
  // laptop or it goes dark again.
  property bool wokeScreen: false

  function wakeForMessage() {
    // Like a new banner, a message ends the screensaver so the card shows.
    Session.screensaver = false
    checkScreen(function(lit) {
      if (lit !== false) return
      Session.run(["screen", "on"], function(code, data) {
        if (code !== 0 || !data || data.screen !== "on") return
        root.screenLit = true
        root.wokeScreen = true
        wakeTimer.restart()
      })
    })
  }

  // Any input from her: hypridle takes over again from here.
  IdleMonitor {
    id: idle
    timeout: 5
    respectInhibitors: false
    onIsIdleChanged: if (!isIdle) root.wokeScreen = false
  }

  Timer {
    id: wakeTimer
    interval: root.wakeMs
    onTriggered: {
      if (!root.wokeScreen) return
      root.wokeScreen = false
      if (idle.isIdle) {
        Session.run(["screen", "off"])
        root.screenLit = false
      }
    }
  }

  // ---- the server ----------------------------------------------------------------

  Process {
    running: root.mode === "auto"
    command: ["busctl", "--user", "status", "org.freedesktop.Notifications"]
    onExited: function(exitCode) {
      root.serve = exitCode !== 0
      console.log("momos: notification server " + (root.serve ? "on" : "off; another one is running"))
    }
  }

  LazyLoader {
    active: root.serve
    NotificationServer {
      keepOnReload: false
      actionsSupported: true
      bodySupported: true
      imageSupported: true
      onNotification: function(n) {
        n.tracked = true
        var hints = n.hints || {}
        root.add(n.summary, n.body, {
          appName: n.appName,
          desktopEntry: n.desktopEntry,
          category: hints.category,
          urgency: n.urgency === NotificationUrgency.Critical ? 2 : 1
        }, n)
      }
    }
  }

  // Development only: show a card without a notification server. `notify`
  // closes by itself; `message` is a Telegram message and stays.
  IpcHandler {
    target: "momos-dev"
    function notify(summary: string, body: string): string {
      root.add(summary, body, { appName: "test" }, null)
      return "ok"
    }
    function message(summary: string, body: string): string {
      root.add(summary, body, { appName: "Telegram Desktop" }, null)
      return "ok"
    }
    // Press Close on the card showing.
    function close(): string {
      if (root.front === null) return "none"
      root.drop(root.front.key, "dismiss")
      return String(root.cards.length)
    }
  }

  Variants {
    model: Quickshell.screens

    PanelWindow {
      id: window
      required property var modelData
      screen: modelData

      visible: root.cards.length > 0 && !Session.locked
      anchors { bottom: true }
      margins.bottom: 0
      exclusionMode: ExclusionMode.Normal
      // Room around the card for its shadow.
      readonly property int shadowRoom: 32
      implicitWidth: Math.min(1000, (screen ? screen.width : 1366) - Theme.margin * 2) + shadowRoom * 2
      implicitHeight: Math.max(1, stack.implicitHeight + shadowRoom * 2)
      color: "transparent"
      WlrLayershell.layer: WlrLayer.Overlay
      WlrLayershell.namespace: "momos-notifications"
      WlrLayershell.keyboardFocus: WlrKeyboardFocus.None

      Column {
        id: stack
        x: window.shadowRoom
        y: window.shadowRoom - 6
        width: parent.width - window.shadowRoom * 2
        spacing: 14

        Repeater {
          // One at a time, newest first. The rest wait their turn.
          model: root.cards.slice(0, 1)

          Surface {
            id: card
            required property var modelData
            width: stack.width
            height: Math.max(176, words.implicitHeight + 48)
            radius: Theme.radiusLarge + 4
            elevation: 3

            Rectangle {
              id: well
              anchors.left: parent.left
              anchors.leftMargin: 28
              anchors.verticalCenter: parent.verticalCenter
              width: 76
              height: 76
              radius: 38
              color: Theme.accentSoft

              Icon {
                anchors.centerIn: parent
                name: "message"
                size: 40
                color: Theme.accent
                weight: 1.7
              }
            }

            Column {
              id: words
              anchors.left: well.right
              anchors.leftMargin: 24
              anchors.right: buttons.left
              anchors.rightMargin: 24
              anchors.verticalCenter: parent.verticalCenter
              spacing: 2

              Text {
                width: parent.width
                text: Notify.title(card.modelData)
                color: Theme.ink
                font.family: Theme.sans
                font.pixelSize: Theme.label - 4
                font.weight: Font.DemiBold
                elide: Text.ElideRight
              }
              Text {
                width: parent.width
                visible: text !== ""
                text: card.modelData.body
                color: Theme.inkSoft
                font.family: Theme.sans
                font.pixelSize: Theme.body
                wrapMode: Text.Wrap
                maximumLineCount: 2
                elide: Text.ElideRight
              }
              Text {
                width: parent.width
                visible: text !== ""
                topPadding: 4
                text: Notify.waiting(root.cards)
                color: Theme.accent
                font.family: Theme.sans
                font.pixelSize: Theme.body
                font.weight: Font.DemiBold
                elide: Text.ElideRight
              }
            }

            Row {
              id: buttons
              anchors.right: parent.right
              anchors.rightMargin: 24
              anchors.verticalCenter: parent.verticalCenter
              spacing: 16

              BigButton {
                text: "Open"
                implicitWidth: 170
                implicitHeight: 96
                fontSize: Theme.label - 4
                elevation: 1
                onClicked: root.open(card.modelData)
              }
              BigButton {
                text: "Close"
                implicitWidth: 170
                implicitHeight: 96
                fontSize: Theme.label - 4
                fill: Theme.quiet
                fillPressed: Theme.quietPressed
                ink: Theme.ink
                onClicked: root.drop(card.modelData.key, "dismiss")
              }
            }
          }
        }
      }
    }
  }
}
