.pragma library

// The notification cards' queue, kept apart from QML so it can be tested with
// node (shell/dev/notify-test.js).
//
// A card is { key, created, summary, body, app, message, count }. The list is
// newest first and only the first card shows. Message cards (Telegram, or
// anything that says it's a chat or an email) stay until she presses Open or
// Close. Other cards close by themselves after LIFETIME_MS of being on
// screen; time spent waiting behind another card, locked, under the
// screensaver or with the screen off doesn't count.

var LIFETIME_MS = 20000
var MAX_CARDS = 20

// `n`: { appName, desktopEntry, category, urgency } from the notification.
// `urgency` is 2 for critical.
function isMessage(n) {
  var app = String(n.appName || "") + " " + String(n.desktopEntry || "")
  if (/telegram/i.test(app)) return true
  if (/^(im|email)(\.|$)/.test(String(n.category || ""))) return true
  return n.urgency === 2
}

function sameChat(a, b) {
  return a.message && b.message && a.app === b.app && a.summary === b.summary
}

// Adds `card` at the front. A message from a chat that already has a card
// joins that card instead: the newest words, a count, and the card moves to
// the front. Over MAX_CARDS the oldest card that closes by itself goes first,
// even the new one, and only when every card is a message the oldest message.
//
// Returns { cards, into, dropped }: `into` is the key of the card it joined
// (its own key when it didn't), `dropped` the keys taken off the end.
function add(cards, card, max) {
  var limit = max || MAX_CARDS
  var into = card.key
  var rest = []
  var joined = null
  for (var i = 0; i < cards.length; i++) {
    if (!joined && sameChat(cards[i], card)) joined = cards[i]
    else rest.push(cards[i])
  }
  var front = card
  if (joined) {
    into = joined.key
    front = {
      key: joined.key,
      created: card.created,
      summary: joined.summary,
      body: card.body,
      app: joined.app,
      message: true,
      count: (joined.count || 1) + 1
    }
  }
  var next = [front].concat(rest)
  var dropped = []
  while (next.length > limit) {
    var victim = -1
    for (var j = next.length - 1; j >= 0 && victim < 0; j--) if (!next[j].message) victim = j
    if (victim < 0) victim = next.length - 1
    dropped.push(next[victim].key)
    next.splice(victim, 1)
  }
  return { cards: next, into: into, dropped: dropped }
}

// One tick of the clock. `shown` maps a key to the ms it has been on screen.
// `onScreen` says whether the front card can be seen right now.
// Returns { shown, expired }: the updated map and the keys whose time is up.
function tick(cards, shown, onScreen, elapsed, lifetime) {
  var life = lifetime || LIFETIME_MS
  var next = {}
  for (var i = 0; i < cards.length; i++) {
    if (shown[cards[i].key] !== undefined) next[cards[i].key] = shown[cards[i].key]
  }
  var expired = []
  var front = cards.length > 0 ? cards[0] : null
  if (front && !front.message && onScreen && elapsed > 0) {
    // A long gap (the laptop asleep) counts as one tick at most.
    var t = (next[front.key] || 0) + Math.min(elapsed, 2000)
    next[front.key] = t
    if (t >= life) expired.push(front.key)
  }
  return { shown: next, expired: expired }
}

// The card's first line.
function title(card) {
  var who = card.summary || "someone"
  if (card.message && card.count > 1) return card.count + " new messages from " + who
  return "New message from " + who
}

// A line under it when more cards wait.
function waiting(cards) {
  var n = cards.length - 1
  if (n <= 0) return ""
  return n === 1 ? "1 more after this one" : n + " more after this one"
}
