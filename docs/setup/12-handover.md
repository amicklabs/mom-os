# 12. Handover checklist

Go through this with the laptop in front of you, then again with her.

## Before you sit down with her

Remote access:

- [ ] `mom status` works from each of your machines, over Tailscale.
- [ ] `mom vnc` shows her screen, and her screen says "Sam is looking at your screen and can move your mouse" for 10 seconds when you connect, then an eye with a mouse pointer stays on her bar until you disconnect. Check the bar at her text size.
- [ ] On your phone, with Tailscale on, the admin app's Screen page starts view-only and shows her screen. Her screen says "Sam is looking at your screen", then shows the eye on her bar. Tapping her screen in the page does nothing on the laptop. With control on, it says "Sam can move your mouse", the eye gets a mouse pointer, and a tap clicks. Stop ends it, and so does waiting out the time.
- [ ] `mom screenshot` shows nothing on her screen and comes back without a delay. Screenshots are silent; only live viewing tells her.
- [ ] `sudo ufw status numbered` on the laptop shows SSH and VNC on `tailscale0` only.
- [ ] Key expiry is off for the laptop in the Tailscale admin console.
- [ ] From the laptop, `timeout 3 bash -c '</dev/tcp/your-desktop/22'` fails, with your desktop's Tailscale name. The policy only lets your devices reach the laptop, not the other way.

Startup:

- [ ] A cold boot goes from the power button to her home screen with no passphrase and no login.
- [ ] Closing the lid turns the screen off, and opening it brings her screen back. Left closed for 30 minutes it suspends, and a key press wakes it. Left open and untouched on battery, it also suspends after 30 minutes; plugged in, it only turns the screen off.
- [ ] You wrote down the disk passphrase, her PIN and the VNC password somewhere safe.

Help and messages:

- [ ] **Help**, then **Show Sam my screen**, sends you a Telegram message with her screen, and the card says "Sam has your message." **Got it** on Telegram puts "Sam saw your message." on her screen.
- [ ] Replying to that message shows "Sam says: ..." on her screen.
- [ ] With Wi-Fi turned off, **Help** then **Send to Sam** says it will send by itself when the internet is back and shows your phone number in large type. Turn Wi-Fi on and the message arrives.
- [ ] `/status` to the bot shows her laptop online.
- [ ] If you set up the dispatcher, replying "look" to a help message brings back a report.

Her accounts:

- [ ] Log her into Google once in the Email tile. Gmail, YouTube and Photos share the login.
- [ ] Log her into Facebook.
- [ ] Log her into Telegram with her own account. Log your own Telegram account out of the laptop if you used it for testing.
- [ ] Make a real Telegram video call with her account and check the call window comes to the front, with camera and sound.
- [ ] Leave the laptop until the screen goes dark, then send her a Telegram message from your phone. The screen comes on with the card, the card stays until she presses Open or Close, and the Telegram tile counts unread messages. Reading the chat on her phone takes the card away.
- [ ] Tap each face on the Family page and check it opens the right chat.

Loose ends:

- [ ] `mom ssh sudo /usr/local/src/momos/system/install.sh check` passes.
- [ ] `~/MACHINE-NOTES.md` on the laptop describes anything you changed by hand.
- [ ] LocalSend's port and LAN SSH are closed. The `firewall` step does both.
- [ ] Nothing on the laptop asks for an update, a keyring password or a notification permission.

## With her

Show her three things, and only three:

1. **The tiles.** Each one does what it says.
2. **Home.** Whatever happens, Home brings her back here, and nothing she was doing is lost.
3. **Help.** She presses it and can write to you, show you her screen, ask you to call, or just say it out loud. She doesn't need to explain anything.

Let her try each one while you watch. Don't explain the bar's other buttons unless she asks. The More button holds Lock, which she can use when she wants the laptop locked. Show that separately, on another day, if at all.

Then leave, and see what happens. The first week's [weekly report](../using/weekly-report.md) and the help requests will tell you what to change.
