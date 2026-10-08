# The admin app

The admin app is where you look after her laptop from your phone or computer. It reads and writes Convex, so everything you do here reaches her through momd's short list of allowed actions and settings. The one exception is the Screen page, where your browser connects to the laptop itself, over Tailscale.

With more than one laptop, pick which one in the menu at the top. The Help tab shows a count when a help request is open.

## Home

What the laptop is doing now: online, or when it was last heard from; what she's using; internet and Wi-Fi signal; battery; whether the screen is locked or the lid is closed; whether someone is viewing the screen, and whether they have control; and the MomOS version. Tap the viewer to open the Screen page.

**Do something on the laptop** has the allowed actions:

| Button | What she sees |
|---|---|
| Message box | "Sam says: ..." across the top of her screen |
| Home | her home screen |
| Open a tile | that tile's app, opened or brought forward |
| Screenshot | nothing. The picture shows up under Recent actions. |
| Lock | the lock screen. She needs her PIN to get back in, so the button asks first. |
| Restart | "Sam is restarting the computer. It will be back in a minute." About 10 seconds later it reboots. |

The laptop picks each action up within a second or two while it's online. If it's offline, actions wait in Convex. A restart that waited more than 10 minutes is refused, so a laptop that was off doesn't reboot by surprise later.

**Reload a page**, under it, has a Reload button beside each of her web pages (the web app tiles and the Browser). Use it when a page is stuck, or still shows a sign-in form after she signed in in another window. The page comes to the front on her screen and reloads, or opens if it was closed, and her screen says "Sam refreshed YouTube." for 6 seconds. The note doesn't replace a message you put up. Next to each button you see how the last reload went: waiting, Reloaded, "It wasn't open, so it opened fresh", or why it didn't happen, such as a locked screen. Reloads you send from Telegram show there too. The Screen page has the same card, so you can watch it happen. A reload that waited more than 10 minutes is refused, like a restart.

There's no Unlock button. Unlocking isn't one of the allowed actions, so someone who got into your Convex account couldn't unlock her screen. Use `mom unlock`.

## Screen

Her screen, live, for when you're on the phone with her. Your phone or computer needs Tailscale on, signed in as you. The laptop needs [Tailscale Serve set up](../setup/08-tailscale-and-firewall.md#screen-sharing-in-the-admin-app) once.

- **Start screen sharing** asks the laptop to open a session for 15 minutes, view-only. It connects within a few seconds. She doesn't have to do anything.
- **Use Mom's mouse and keyboard** turns control on, after you confirm. The laptop restarts its side without input disabled and the picture reconnects. Turn it off the same way. View-only is enforced on the laptop, so nothing you tap reaches her screen while it's off.
- With control on: tap to click, drag to move, two-finger tap to right-click. The box under the picture types text on her screen, with keys for Enter, Delete, Tab, Esc and the arrows.
- **Add 15 minutes** extends it, up to an hour from now. **Full screen** fills your phone, with Close and Stop at the top. **Stop** ends it at once. Otherwise it ends by itself when the time runs out.

When the page connects, her screen says "Sam is looking at your screen" for 10 seconds, and then an eye stays on her bar until you leave. Turning control on shows "Sam can move your mouse" the same way and adds a mouse pointer beside the eye. She can tap the eye to see the words again. Leaving the page disconnects you, but the session stays open until Stop or the time runs out.

Sound isn't there yet.

## Help

Every help request, newest first: when she asked, what she asked for (Wrote, Showed the screen, Asked you to call, Voice note), her words in a quote, what she was using with the internet and battery at that moment, a player for her voice note, and her screen when she showed it. When she asked for a picture and there isn't one, a note says why, such as the screen being off. A request that waited on the laptop for the internet says so.

No agent starts on its own when she asks. **Got it** puts "Sam saw your message." on her screen, once. **Send an agent** opens a box for an optional note to the agent, then sends a read-only agent with her request and your note; without a note it won't send a second while one is already looking. Follow it on the Jobs page. Type a reply and it shows on her screen as "Sam says: ...". **Done** marks a request handled, the same as Done on Telegram. Screenshots and voice notes are deleted after 60 days, and the request stays with her words.

Settings has an optional **Helper's Telegram username**. With it, the Help pop-up offers "Message Sam on Telegram".

## Reminders

Reminders show on her home screen and pop up when they're due. See [reminders and photos](reminders-and-photos.md).

## Photos

Screensaver photos. See [reminders and photos](reminders-and-photos.md).

## Timeline

Everything the laptop reported, newest first: startups, what she opened, internet going up and down, battery, lid, locks, someone viewing the screen, help presses, actions, reminders and errors. When the laptop was offline, events queue on it and arrive in a batch when it reconnects, so the timeline still shows what happened while you couldn't reach it.

Window titles never leave the laptop. The timeline shows which tile she used, not which page or chat.

## Jobs

Agent jobs from the dispatcher. **Start a job** takes a plain-English request, like "The camera stopped working in Telegram calls." Each job shows its status, its report and buttons to approve or cancel. See [agent jobs](agents.md).

## Reports

The weekly report for each week, and **This week so far**, which shows what Sunday's report would say right now. See [weekly report](weekly-report.md).

## Settings

Her names, tiles and family, as in the [config file](../setup/06-config.md):

- **Names**: her name, her Linux user, her phone number and Telegram username (optional, for Call Mom on Telegram), your name, your phone number and Telegram username.
- **Send an agent on every help request**: off by default. Off, her help requests just reach you and you send an agent when you want one. On, an agent starts looking whenever a help request comes with writing or a voice note.
- **Tiles**: add, remove, reorder with Move up and Move down, and change each tile's label, icon and type. At most 12.
- **Family**: add people with a name and Telegram username, and upload a photo for each. At most 24.

Nothing changes on the laptop until you press **Save settings**. Convex checks the whole thing against the same schema momd uses, and refuses anything invalid, like a tile with an `http://` URL or a duplicate id. After a save, momd gets the new settings within seconds, checks them again against the schema, rewrites her config file, and her screen updates.

Family photos upload here and download to the laptop on their own. Save a new person first, then add their photo.

## Devices

Each laptop and whether it's online. **Add a device** creates one and shows its token once. Put it in `~/.config/momos/device-token` in her home on the laptop, mode 600. `mom devices create --install` does the same from the command line.

**Revoke** stops a device's token at once. Do it if the laptop is lost, then make a new device and token when you get it back.
