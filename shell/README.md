# shell

Her whole screen, in QML for [Quickshell](https://quickshell.org): the home screen, the bar, the Family page, the Internet connection and Speaker pages, banners, Telegram message cards, reminders, the lock screen and the photo screensaver.

![The home screen in the Morning theme](docs/screenshots/home.webp)

## How it looks

It should feel like a well-made thing for an adult, not a big-button phone. The person using it may know she struggles with computers, and a screen that looks like an accessibility aid would remind her of that every time she sat down. So the targets and type stay large, but the rest is quiet: a serif for the greeting, titles and clocks, a plain sans for everything she acts on, soft cards on a faint paper grain instead of outlined boxes, line icons in one color, and short fades instead of bounces.

The bar holds Home, the clock, the name of what she's on, an eye while someone is looking at her screen, a status button, More and Help. Home is the one filled button, so it stays the thing that stands out.

- **What she's on.** Next to the clock, the app's own mark and its name: the Telegram plane and "Telegram", Chrome's logo and "Browser" for the browser (it's Chromium, but Chrome's logo is the one she knows), YouTube's red button, and a web app tile's own label and icon. The marks are the colored ones whatever icon style her tiles use, since this is where she checks at a glance. Pages show their own name and line icon. The home screen shows nothing there. `Common/Foreground.qml` reads Hyprland's focused workspace and window, and `Common/foreground.js` matches them to tiles; `node shell/dev/foreground-test.js` tests it.
- **Status.** The status button has a Wi-Fi icon and a battery icon that fills as it charges, with a bolt while charging. A tap opens a card that says it in words: "The internet is working, connected to Smith Home", "Battery: 64%, the charger isn't plugged in". `Windows/StatusPanel.qml` draws it.
- **Problems stay in words.** "No internet" and "Battery low" (under 20%, not charging) show on the bar itself, bold in the alert color, left of the button, and its icons turn the same color. She doesn't have to tap to find out something's wrong.
- **A crowded bar.** At X-Large with both warnings and the eye, there isn't room for everything. The name of what she's on drops its icon before it wraps, and a word that still won't fit gets smaller rather than breaking in the middle.

![The bar with Telegram in front](docs/screenshots/bar-telegram.webp)

![The bar while charging, in the browser](docs/screenshots/bar-charging.webp)

![No internet and a low battery](docs/screenshots/bar-warnings.webp)

![The status card](docs/screenshots/status-card.webp)

![The status card in Evening](docs/screenshots/evening-status-card.webp)

![X-Large with both warnings and the eye](docs/screenshots/bar-viewer-crowded.webp)

### Someone looking at her screen

She's always told when someone is watching live, over VNC or the admin app's Screen page. Screenshots show nothing. A banner that stays for the whole session covers the page under it. At X-Large "Sam is looking at your screen and can move your mouse" takes two lines and hid the Back button on pages like Speaker. So:

- **When someone connects**, a purple banner says "Sam is looking at your screen", with OK. It goes after 10 seconds or when she presses OK. Over VNC, which always has control, it says "Sam is looking at your screen and can move your mouse".
- **For the rest of the session** an eye on a purple pill stays on the bar, left of the status button. It covers nothing. Tapping it shows the banner again for 10 seconds.
- **When control turns on**, the banner comes back with "Sam can move your mouse", and the eye gets a mouse pointer beside it.
- **When the session ends** the eye goes, 15 seconds after the last connection closes, since the browser reconnects for a moment whenever control changes. The next session shows the banner again.
- **The lock screen and screensaver** cover the bar, so they show the words on one line for the whole session. The banner's 10 seconds wait until she's back from either one.

`Common/Session.qml` follows `state.viewer` and decides when the banner shows. `Windows/Banners.qml` draws the banner and `Windows/Bar.qml` the eye.

![The banner when someone connects](docs/screenshots/banner-viewer.webp)

![After 10 seconds, only the eye on the bar](docs/screenshots/viewer-eye.webp)

![Control turned on](docs/screenshots/viewer-control.webp)

![The eye and pointer in Evening](docs/screenshots/evening-viewer-eye.webp)

![The screensaver while someone is looking](docs/screenshots/screensaver-viewer.webp)

 Sound is the keyboard's volume keys. When the volume changes, from the keys, `momctl volume` or an app, a card near the bottom shows the level for a second and a half, or "Off" when muted. It watches the default PipeWire speaker, so it doesn't care what changed it.

![The volume card](docs/screenshots/volume.webp)

- **Type.** Newsreader (the 16pt cut) and Source Sans 3, bundled in `fonts/` with their SIL Open Font License files. Nothing she reads is smaller than 26 px at Large, the default text size, and nothing is smaller than 20 px at Regular.
- **Themes.** Morning (warm paper, the default), Linen (sage), Rose, Evening (navy and brass), Garden (deep green) and Slate (charcoal). Each one colors the home screen, bar, pages, banners, cards, lock screen and screensaver. `node shell/dev/contrast.js` checks every text color: 7:1 for main text, 4.5:1 for the rest. In the bar the date is the 4.5:1 one, and the name of what she's on and the warnings, alert color included, are 7:1. The eye's purple pill is at least 3:1 against the bar.
- **Icons.** Simple, the default, draws each tile icon as a line in the theme's accent. Colorful uses the apps' own marks in their own colors: YouTube's red play button, Facebook's blue f, Telegram's plane, the Gmail M and the Google Photos pinwheel, plus a warm pair of people for Family and a blue globe for the Browser tile. `chrome` is Chrome's logo, which the bar always uses for the browser. They sit on a neutral well, muted off-white on the dark themes, so the brand colors read the same everywhere. Some people find a familiar red or blue quicker to spot than a label. The SVGs are in `icons/`. A tile can also name an SVG of your own in `~/.config/momos/icons/` ([06-config.md](../docs/setup/06-config.md#tiles)).
- **Text size.** Regular, Large (the default) and X-Large. Each step is about 1.25, big enough to notice: Regular scales text by 0.8 and X-Large by 1.25. In the bar only the date, the warnings (up to 30 px) and the name of what she's on (up to 34 px) follow it, so the bar still fits on one row.
- **Choosing.** More has two columns: Lock and Internet connection on the left with Restart and Turn off on a card of their own below them, and on the right, under "How it looks", three items: Colors, Text size and Icons, with Speaker on a card of its own below them. Close runs across the bottom. Each opens its own page with one choice, large previews and a Done button. Colors shows the six themes, Text size a piece of her home screen that changes as she taps, and Icons her own tiles drawn both ways. A tap applies the choice and saves it to `~/.config/momos/appearance.json`. See [contracts.md](../docs/contracts.md#appearance).

![The six themes](docs/screenshots/themes.webp)

![The More panel](docs/screenshots/more.webp)

![The Colors page](docs/screenshots/colors.webp)

![The Text size page](docs/screenshots/text-size.webp)

![The home screen at Regular, Large and X-Large](docs/screenshots/text-sizes.webp)

![The Icons page](docs/screenshots/icons.webp)

![The home screen with Colorful icons in Morning](docs/screenshots/colorful-home.webp)

![Colorful icons in Evening](docs/screenshots/evening-colorful-home.webp)

All colors, fonts and sizes live in `Common/Theme.qml` and `Common/themes.js`. Add a theme by adding an entry to `themes.js` with every key the others have, then run the contrast check.

On the laptop it's installed to `/usr/local/share/momos/shell`, linked from `/etc/xdg/quickshell/momos`, and run by `momos-shell.service` as `qs -c momos`. If it fails 5 times in 2 minutes, systemd opens Chromium full screen instead.

## Help

The Help button opens a card in the middle of the screen, over whatever she's doing. Her app stays visible around it under the theme's shade, so what she's asking about is still in front of her. The card is solid; only the shade is see-through.

![The Help pop-up over YouTube](docs/screenshots/help.webp)

- **Her words.** "Tell Sam what's happening (you can skip this)" over a three-line box that takes the keyboard while the card is up. What she types is kept if she closes the card, until it's sent.
- **Four ways to ask.** Send to Sam, the main button, stays greyed out until there are words. Show Sam my screen, Ask Sam to call me and Say it out loud work with or without words. On dark themes those three are a step lighter than the card with a hairline, since the soft accent is too close to the card.
- **Show Sam my screen** hides the whole window, card and shade, waits 400 ms, and runs `momctl help --screenshot`. momd takes the picture first and then says `sending`, which brings the card back. The picture is her app.
- **Say it out loud** runs `momctl voice start` and shows a big timer, a bar filling toward one minute, Stop and send, and Cancel. At a minute it sends by itself. If the microphone won't start, the card says so and she can write instead.
- **Message Sam on Telegram**, a smaller link, opens her chat with the helper when `helper.telegram` is set, and closes the card.
- **Never mind**, Esc, or a click on the shade closes it. A voice note being recorded is thrown away.
- **After sending** the card says "Sam has your message." and one line about what happens next ("Sam will get back to you soon.", "Sam will call you soon." or "Sam can see what was on your screen."), never anything about agents, and closes after 20 seconds or on OK. Offline it says "The internet isn't working, so this can't reach Sam right now. It will send by itself when the internet is back." with his number on a card of its own and Connect to a network. If it goes later while the card is still up, the card turns to "Sam has your message." When the helper taps Got it, a banner says "Sam saw your message."

![Recording a voice note](docs/screenshots/help-recording.webp)

![Sending](docs/screenshots/help-sending.webp)

![Sent](docs/screenshots/help-sent.webp)

![Offline](docs/screenshots/help-offline.webp)

![The pop-up in Evening](docs/screenshots/evening-help.webp)

![Sent, after asking for a call, in Evening](docs/screenshots/evening-help-sent.webp)

`Common/Session.qml` holds the pop-up's stage and runs momctl; `Windows/HelpCard.qml` draws it. See [contracts.md](../docs/contracts.md#help).

## Messages

The shell is her notification server, so a Telegram message shows as a big card near the bottom of the screen with Open and Close. Open takes her to the chat. Only one card shows at a time, and "2 more after this one" says others wait.

![Two messages from one family member, with one more waiting](docs/screenshots/message-card.webp)

- **Messages stay.** A message card waits until she presses Open or Close. It goes by itself only when Telegram takes the notification back, which it does once she's read the chat, on the laptop or her phone. More messages from the same person join the card: "2 new messages from Grace", with the newest words.
- **Anything else** closes after 20 seconds on screen. Time behind another card, under the screensaver, locked or with the screen off doesn't count, so she still gets her 20 seconds.
- **The screen wakes.** A new message ends the screensaver and turns a dark screen on, unless the lid is closed. If nobody touches the laptop, it goes dark again after 10 minutes and the card waits.
- **Locked.** The lock screen covers the cards, so it says "New message from Grace. Unlock to read it." The card is there after she unlocks.
- **The Telegram tile** shows how many messages she hasn't read, as a badge and "3 new messages" under its name. momd reads the count from Telegram.

![The Telegram tile with 3 unread messages](docs/screenshots/telegram-unread.webp)

![A message waiting on the lock screen](docs/screenshots/lock-message.webp)

`Windows/Notifications.qml` draws the cards and `Common/notify.js` keeps the queue; `node shell/dev/notify-test.js` tests it. See [contracts.md](../docs/contracts.md#notifications).

## Updating

While the helper runs `mom deploy` or `mom update`, a green banner says "Sam is updating your computer. It will be back in a minute." It shows over the home screen and apps, on the lock screen and over the screensaver, and comes back by itself when the shell restarts mid-deploy. When the job is done it says "Done. Your computer is up to date." for 8 seconds. She can't dismiss it and doesn't need to: it takes no input and goes when the deploy or update finishes, or 15 minutes after `mom` was last heard from.

`Common/Store.qml` reads `~/.local/state/momos/updating.json` and `Common/updating.js` decides what to show; `node shell/dev/updating-test.js` tests it, and `shell/dev/updating.sh on|done|off` fakes it in development. See [contracts.md](../docs/contracts.md#the-updating-notice).

## Internet connection

Away from home she has to get online by herself, since remote help needs the internet. More, then Internet connection, opens a page with the network she's on in words ("Connected to Smith Home") and the networks nearby as large rows: the name, the signal as strong, good or weak, and a lock when it needs a password. Networks the laptop joined before come first. Refresh looks again. There are no technical words: no SSID, WPA or bands.

![The Internet connection page](docs/screenshots/wifi.webp)

- **Joining.** A network joined before, or one without a password, joins with one tap. A new one opens a password page with one large field. "Show the password" is on, since people mistype passwords they read off a card, and she can turn it off. The page takes the keyboard while it's up. Connect, then "Joining Carol and Jim…", then "Connected. You're back on the internet." and Done.
- **Wrong password.** "That password didn't work. Check it with the person who gave it to you and try again." The field keeps what she typed, selected, so she can fix it or type over it. A wrong password is never saved.
- **Not listed.** "My network isn't listed" asks for a name and a password.
- **Sign-in pages.** When a hotel or cafe network wants her to sign in first (NetworkManager says `portal`), the page and the offline banner say so, with a Sign in button that opens the sign-in page in her Browser window.
- **Forget.** A small Forget button on networks joined before, for a saved password that's wrong, asks first: "The computer won't join it by itself anymore." The network in use has none.
- **Offline.** The offline banner and the Help pop-up, when a request can't go, have a "Connect to a network" button that opens the same page. The banner steps aside while the page is open.

It runs `momctl wifi scan`, `connect`, `forget` and `portal` through `Common/Wifi.qml`, passing passwords on stdin. See [contracts.md](../docs/contracts.md#wi-fi).

![The password page](docs/screenshots/wifi-password.webp)

![A wrong password](docs/screenshots/wifi-password-wrong.webp)

![Joined](docs/screenshots/wifi-connected.webp)

![A hotel network that wants a sign-in](docs/screenshots/wifi-portal.webp)

![The offline banner](docs/screenshots/offline.webp)

![The offline banner on a network that wants a sign-in](docs/screenshots/portal.webp)

![Forgetting a network](docs/screenshots/wifi-forget.webp)

## Speaker

More, then Speaker, plays the computer's sound on a Bluetooth speaker. The page starts looking as soon as it opens and looks again every few seconds while it's open. While no speaker is connected, a card at the top says where the sound plays. Once one is, the card asks "Where does the sound come out?" with a big button for "This computer" and one for each connected speaker (two at most), the chosen one filled in with a check mark. Below it are the speakers: saved ones first, then new ones nearby, each by the name it announces, with a speaker or headphones icon. Phones and nameless devices aren't listed. Under the list, and in place of it while it's empty: "Turn the speaker on. Then hold its Bluetooth button until its light blinks."

![The Speaker page](docs/screenshots/speaker.webp)

![Kitchen Speaker connected, the sound on the computer](docs/screenshots/speaker-choice.webp)

- **Connecting.** One tap on a speaker: "Connecting to Kitchen Speaker…", then "Connected. Sound plays on Kitchen Speaker." with Done. The laptop pairs with it the first time and connects to it by itself after that.
- **Playing.** The speaker's button is filled in, its row says "Connected · Playing now", and More's Speaker item says "Playing on Kitchen Speaker", which it reads from PipeWire.
- **Switching.** "This computer" moves the sound to the laptop and leaves the speaker connected. Tapping the speaker's button, or its row, moves it back. A switch takes well under a second.
- **Disconnect.** A small button on a connected speaker's row. It disconnects the speaker so a phone can have it, and it doesn't come back by itself until she taps it again.
- **Connected, no sound.** If the sound didn't move after connecting: "Connected, but the sound is still on the computer. Turn Kitchen Speaker off and on, then try again.", with Try again and Done.
- **Didn't work.** Three plain reasons, from `momctl`'s `reason`: can't find it, it refused, or it didn't answer. Try again and Back to the list.
- **Forget.** A small Forget button on saved speakers asks first.

It runs `momctl speaker`, `scan`, `connect`, `output`, `disconnect` and `forget` through `Common/Speaker.qml`. A scan that started before a switch or a connect would put the old state back when it ends ten seconds later, so the shell drops its answer and reads the list again. See [contracts.md](../docs/contracts.md#speaker) and [Her Bluetooth speaker](../docs/using/speaker.md).

![Connecting](docs/screenshots/speaker-connecting.webp)

![Connected](docs/screenshots/speaker-connected.webp)

![Playing on a speaker](docs/screenshots/speaker-playing.webp)

![Connected, but the sound didn't move](docs/screenshots/speaker-no-sound.webp)

![A speaker that didn't answer](docs/screenshots/speaker-failed.webp)

![Forgetting a speaker](docs/screenshots/speaker-forget.webp)

![The Speaker page in Evening](docs/screenshots/evening-speaker.webp)

## Restart and Turn off

More has "Restart the computer" and "Turn off the computer" on their own card, below Lock and Internet connection and away from "How it looks", so a tap meant for Colors can't land on them. Each opens a page that asks once, in her words, with Cancel on the left and the action on the right, the way her Mac did it:

- "Turn off the computer? To turn it back on, press the button at the top right of the keyboard." On the MacBook Air the power button is the last key of the top row, and the page draws the keyboard with that key picked out.
- "Restart the computer? It will be back in about a minute."

After she confirms, "Turning off…" or "Restarting…" covers the whole screen, bar included, with the same line under it. 1.5 seconds later the shell runs `momctl power off` or `momctl power restart`. If momctl fails, or the computer is still on two minutes later, the screen says "The computer didn't turn off. It isn't your fault. You can keep using it, or ask Sam for help." with an OK button. The power button itself still puts it to sleep.

![Turn off the computer?](docs/screenshots/turn-off.webp)

![Restart the computer?](docs/screenshots/restart.webp)

![Turning off](docs/screenshots/turning-off.webp)

## How it works

- It reads `~/.config/momos/config.json` for names, tiles and family, and `$XDG_RUNTIME_DIR/momos/state.json` for everything live: internet, battery, banners, the help button's state, reminders, whether someone is viewing. It re-reads both when they change.
- It owns `~/.config/momos/appearance.json`, her theme, text size and icons, and follows it if something else rewrites it.
- It acts by running `momctl`: opening tiles, going home, volume, pressing help, answering reminders, joining networks.
- It takes commands from `momctl` over Quickshell IPC: `qs -c momos ipc call shell lock`, `unlock`, `home`, `page <id>`, `screensaver on|off`.
- With momd down, tiles, Home, Lock and sound still work. The Help pop-up shows the helper's phone number.

| Folder | What |
|---|---|
| `shell.qml` | the root, one of each window per screen |
| `Windows/` | home screen, bar, pages (`WifiPage.qml` is the Internet connection page, `SpeakerPage.qml` the Speaker page, `PowerPage.qml` asks before Restart and Turn off, `PowerScreen.qml` shows "Turning off…"), banners, the status card (`StatusPanel.qml`), the Help pop-up (`HelpCard.qml`), notifications, reminder alert, More panel, volume card, lock screen, screensaver |
| `Common/` | `Store.qml` reads the files, `Session.qml` holds session state and runs `momctl`, `Foreground.qml` and `foreground.js` name what she's on for the bar, `Appearance.qml` keeps her look, `Wifi.qml` runs `momctl wifi` for the Internet connection page, `Speaker.qml` runs `momctl speaker` for the Speaker page, `Power.qml` runs `momctl power` once she confirms, `Theme.qml` and `themes.js` have colors, fonts and sizes, `validate.js` checks the config |
| `Ui/` | tiles, buttons, cards, avatars, theme previews, and the line icons in `icons.js` that tiles can name |
| `icons/` | the colorful tile icons, one SVG per name in `icons.js`'s `tileNames` |
| `fonts/` | Newsreader and Source Sans 3, with their licenses |
| `images/` | the paper grain behind pages |
| `pam/momos-lock` | the PAM service her lock screen checks her PIN with |
| `dev/` | run it on your desktop against test files; `contrast.js` checks the themes, `notify-test.js` and `foreground-test.js` test the notification queue and the bar's app names |
| `docs/screenshots/` | screenshots for the docs |

## Run it on your desktop

```sh
shell/dev/run.sh
MOMOS_DEV_DIR=/tmp/momos-dev shell/dev/state.sh offline   # switch scenario
```

`run.sh` uses test files in `/tmp/momos-dev` and a stub `momctl` that only logs, apart from made-up networks for `momctl wifi` and made-up speakers for `momctl speaker`. For her full session in a window, with her Hyprland config at 1366x768, use `dev/session.sh`. See [dev/README.md](../dev/README.md).

Environment variables for development, all optional: `MOMOS_CONFIG`, `MOMOS_STATE`, `MOMOS_APPEARANCE`, `MOMOS_PHOTOS`, `MOMOS_SLIDESHOW`, `MOMOS_UPDATING`, `MOMOS_MOMCTL`, and `MOMOS_NOTIFICATIONS=0` to leave your own notification daemon alone (`1` always takes over, as on her laptop). Without a notification server, `qs -p shell ipc call momos-dev message "Grace" "Hello"` shows a message card, `notify` a card that closes by itself, and `close` presses Close.

There's no automated test for the shell. Run it, try the scenarios, and take screenshots. In the dev session, `qs -p shell ipc call momos-dev-ui more` opens the More panel, `status` the bar's status card, `eye` taps the bar's eye and `helpCard` the Help pop-up, since there's no pointer to tap with. `helpShow <stage> "<words>" <kinds>` shows it in a stage (`compose`, `recording`, `sending`, `sent`, `offline`, `failed`, `unreachable`) with her words, and `helpPress send|screen|call|voice|stop|cancel|close` presses its buttons (only with the stub `momctl`, which answers `help` with the status in `$MOMOS_DEV_DIR/help-status`, `sent` by default). `qs -p shell ipc call shell page colors` (or `text-size`, `icons`, `wifi`, `speaker`, `restart`, `turn-off`) opens a page, `qs -p shell ipc call momos-dev-ui powerConfirm off` presses Turn off (only with the stub `momctl`), and writing `$MOMOS_DEV_DIR/appearance.json` switches the theme, text size and icons. The volume card follows your own desktop's volume, since the nested session shares its PipeWire.

The Internet connection page shows made-up networks in development. [dev/README.md](../dev/README.md#internet-connection-page) has the scenarios. The Speaker page shows made-up speakers the same way ([dev/README.md](../dev/README.md#speaker-page)).

`docs/screenshots/` has every screen in Morning, `evening-*` ones in Evening, and `colorful-*` ones with Colorful icons.

Deploy to the laptop with `mom deploy --steps shell`, then `mom restart shell`.
