# The Telegram bot

The bot sends you her help requests, agent reports and the weekly report. Most of what you do is a button under a message. The rest is replying to a message, which in Telegram means swiping left on it or long-pressing it and choosing Reply, or one of the commands below.

It only listens to the user IDs in `TELEGRAM_ADMIN_IDS`, for messages and button taps alike. Anyone else gets no answer at all.

## A help request

When she uses the Help pop-up you get one message, with her screenshot or voice note replying to it:

- The headline says what she asked for: "Mom needs help", "Mom asked you to call", or "Mom sent a voice note".
- Her words, in quotes, if she typed any.
- "Mom's screen is below." when she pressed Show Sam my screen. The picture is her screen with the pop-up out of the way.
- Her voice note, as a Telegram voice message you can play. There's no transcript: nothing on the laptop can make one, and her voice isn't sent to anyone else to do it.
- "Mom asked 25 min ago, while the laptop was offline." when the request waited on the laptop for the internet.
- One line of context: what she was using, the internet and the battery.

Nothing else happens until you decide. She often uses Help to ask you something that has nothing to do with the laptop, so no agent starts by itself. (To have one start whenever she writes or speaks, as before, turn on "Send an agent on every help request" in the admin app's Settings. The message then says "An agent is looking into it.")

The buttons:

| Button | What happens |
|---|---|
| Send an agent | The bot asks "Anything to tell the agent? Reply to this message with a note, or tap Send without a note." Swipe to reply with a note, like "She means the sound on YouTube", and the agent gets your note with her request. Or tap Send without a note. The agent only looks, and its report comes back as a reply to her message. Without a note, it won't send a second agent while one is already looking. |
| Message Mom's screen | The bot asks "What should Mom's screen say?" Type your answer; Telegram has already opened the reply for you. It shows as "Sam says: ..." Long messages are cut to 280 characters. |
| Screenshot | A picture of her screen comes here. Nothing shows on her screen. |
| Last 10 minutes | Her screen says "Sam is looking at your last few minutes", then the laptop's pictures from the last ten minutes, one a minute, come here as an album, oldest first. They never leave the laptop any other way. |
| Reload a page | A button for each of her web pages, as with `/reload`. |
| Watch Mom's screen | Opens the admin app's Screen page. It shows only when `ADMIN_APP_URL` is set on the Convex deployment. |
| Call Mom | Her phone number, which you tap to call, and an "Open Mom's Telegram chat" button if her Telegram username is set. Telegram buttons can't dial a number themselves. Both come from Settings in the admin app (Names); without them the bot says so. |
| Got it | Her screen says "Sam saw your message." for half an hour or until she presses OK, so she isn't left wondering. Once per request. |
| Restart Mom's laptop | The bot asks "Restart Mom's laptop (mom-laptop)?" with Yes, restart and No. Yes only works within 5 minutes. |
| Done | Marks the request handled, as Done does in the admin app's Help inbox, and takes the buttons off. A reply to the message still reaches her screen. |

Older help messages still have Investigate, Investigate with instructions and Send her a message. They keep working.

When something you asked for doesn't happen, the bot tells you: "The restart didn't happen on Mom's laptop: refused: ..." with the laptop's reason, or, after a minute and a half with no answer, "The screenshot hasn't reached Mom's laptop yet. It looks offline; it was last heard from 20 min ago." A request that waits stays queued and happens when the laptop is back, except a restart, which the laptop refuses once it's more than 10 minutes old.

## An agent report

Reports come as a reply to her help request, or to the message that started the job. A report may end with "Suggested message for Mom: ..." when the agent thinks a line on her screen would help while you decide. Buttons:

| Button | What happens |
|---|---|
| Approve fix | Only on a report that proposes a fix. The agent carries it out and reports again. |
| Investigate more | The bot asks what to look into next. The same agent session picks up with your instructions, still only looking, and writes a new report. A fix waiting for approval on the old report is cancelled. |
| Send this to Mom | Puts the suggested message on her screen as "Sam says: ...". Nothing reaches her screen unless you press it. |
| Dismiss | Cancels a job that hasn't finished and takes the buttons off. |

## Commands

| Send | What happens |
|---|---|
| `/status` | every laptop: online or when last seen, what she's using, internet and battery |
| `/run <instructions>` | an agent looks at her laptop with your instructions, with no help request. It only looks. The report comes back as a reply. |
| `/look <instructions>` | the same as `/run` |
| `/screenshot` | a picture of her screen. She sees nothing. |
| `/restart` | asks "Restart Mom's laptop (mom-laptop)?" with Yes, restart and No. Replying `yes` within 5 minutes also works. |
| `/reload` | a button for each of her web pages. Tap one and it comes to the front on her screen and reloads, or opens if it was closed. Her screen says "Sam refreshed YouTube." for 6 seconds. The bot tells you when it's done, or why not. |
| `/reload <page>` | reloads that page straight away, by its name or tile id: `/reload youtube`. An unknown name gets the menu. |
| `/start` or `/help` | a short list of what the bot understands |

With more than one laptop, name it: `/restart desk`, `/screenshot desk`, `/reload desk youtube`, `/run desk: check the sound`. The device name or her name both work.

## Replies

Buttons do most of this, but typed replies still work:

| Reply to | With | What happens |
|---|---|---|
| a help message, its picture or voice note | any text | it shows on her screen as "Sam says: ..." |
| a help message | `look` or `/look` | an agent investigates, the same as Send without a note |
| a help message | `/look <instructions>` or `/run <instructions>` | an agent investigates with your instructions |
| Send an agent's question | any text | an agent investigates, with your text as its note |
| a job report | `/look <instructions>` | the same as Investigate more |
| a job report that proposes a fix | `go`, `fix` or `/fix` | approves the fix |
| a restart question | `yes` | queues the restart, if the question is less than 5 minutes old |
| one of the bot's questions | your answer | answers it |

Anything else as a reply to a restart question cancels it. A reply to a job report other than `go` gets a reminder of how to approve.

## Weekly report

Sunday evening. See [weekly report](weekly-report.md).

Messages are plain text, so nothing breaks on odd characters in a report.

## Adding someone

To let a sibling use the bot too, have them start a chat with it, find their user ID as in [setup step 4](../setup/04-telegram.md#find-your-user-id), and add it to `TELEGRAM_ADMIN_IDS`, comma-separated. `getUpdates` doesn't work while the webhook is set, so they can ask [@userinfobot](https://t.me/userinfobot) for their ID instead. Every ID gets every message, and anyone on the list can press every button.

## Your own account on her laptop

If you're logged in to Telegram on her laptop under your own account, the bot's messages to you pop up on her screen as notifications. Log your account out there before handover ([setup step 12](../setup/12-handover.md)).
