# Troubleshooting

Start with these two, from your machine:

```sh
mom status
mom screenshot
```

`status` tells you whether momd answers, how fresh its state is, what's open, the network and the battery. The screenshot tells you what she's looking at. Between them you can usually see which part is broken. If `mom` itself can't connect, start at [Can't reach the laptop](#cant-reach-the-laptop).

Logs, from your machine:

```sh
mom logs --unit momd --lines 200
mom logs --unit shell
mom logs --unit wayvnc
mom ssh sudo journalctl -b -p warning    # the whole system since boot
```

On the laptop as her, everything MomOS logs is in `journalctl --user -u 'momos-*' -u momd`.

## momd is down

**What she notices:** almost nothing. Tiles, Home, Lock and sound still work, because the shell reads `config.json` directly. The Help pop-up shows your phone number instead of sending a message. No reminders come up. The admin app shows the laptop as offline.

**Check:** `mom status` shows `momd.running: false`, or `file.stale: true` because `state.json` hasn't been written for a while.

**Fix:**

```sh
mom logs --unit momd --lines 200
mom restart momd
```

systemd restarts momd by itself when it exits, so a momd that stays down is usually crashing at startup. The log says why. Common causes: a hand-edited `~/.config/momos/config.json` that no longer parses, or a full disk.

## The shell keeps crashing

**What she notices:** a flicker while systemd restarts it. If it fails 5 times in 2 minutes, systemd gives up and Chromium opens full screen so she still has the web. The bar and tiles are gone.

**Check:** a screenshot showing plain Chromium, and `mom logs --unit shell`.

**Fix:** find the error in the log. It's usually a QML error from a recent `mom deploy --steps shell`. Deploy a working shell again, then:

```sh
mom restart shell
```

If that says the start request repeated too quickly, wait two minutes for systemd's limit to reset and run it again. When the shell starts, it closes the fallback Chromium.

To try a shell change safely first, run it on your own machine with `dev/session.sh`. See [CONTRIBUTING.md](../../CONTRIBUTING.md).

## No internet

**What she notices:** the bar says "No internet" in red and a banner says "The internet isn't working. It isn't your fault. Call Sam at" your number, with a "Connect to a network" button. Help still takes her message, says it will send by itself when the internet is back, and shows your phone number in large type, with the same button. Her tiles still open, though web pages won't load, and reminders still come up.

**What you notice:** the admin app shows the laptop offline, `/status` says when it was last seen, and `mom` can't connect, since Tailscale needs the internet too.

**Fix:** you can't reach it, so it's a phone call. The usual causes:

- The router is down, or restarted and came back slowly. Everyone in the house is offline.
- The Wi-Fi password changed. She joins again herself: More, then Internet connection, then Forget on the old network and a tap on it to type the new password. Talk her through it on the phone.
- The laptop moved somewhere with weak signal. The weekly report shows weak Wi-Fi.
- She's away from home. See the next section.

When it reconnects, momd uploads the events it queued, so the timeline fills in what happened.

## When she's away from home

At a relative's house, a hotel or on her iPhone's hotspot, the laptop needs a new network, and you can't help remotely until it has one. She can do it herself, from the "Connect to a network" button on the offline banner, or More, then Internet connection.

![The Internet connection page](../../shell/docs/screenshots/wifi.webp)

- The page lists the networks nearby by name, with the signal in words and a lock on ones that need a password. Networks the laptop joined before come first and join with one tap.
- For a new network she types the password on a large field, shown as she types so she can check it. A wrong one says "That password didn't work. Check it with the person who gave it to you and try again." A network she joins is saved, and the laptop joins it by itself next time.
- Her iPhone's hotspot shows under the phone's name, like "Mom's iPhone". The password is under Settings, Personal Hotspot on the phone, and "Allow Others to Join" must be on.
- Hotels and cafes often want a sign-in page first. The banner and the page then say "This network needs you to sign in", and Sign in opens the page in her Browser window. After that "No internet" goes away from the bar.
- A network that isn't listed can be typed in by name under "My network isn't listed".
- Networks that need a username as well as a password, like some offices, can't be joined from the page.

On the phone, have her read you the screen. Every page has Back, and Home always gets her out.

**Before she travels,** load the network while the laptop is home and online, so it joins by itself when she arrives:

```sh
mom wifi connect "Carol and Jim" --password-stdin --save-only
```

`mom` asks for the password without showing it. `mom wifi scan` shows what's in range now, and `mom wifi forget "<name>"` deletes a saved network. Leave out `--save-only` only for a network that's in range, since joining drops the one she's on. See [mom.md](mom.md#notes-on-some-commands).

## Screen sharing doesn't connect

**Check, in order:**

1. `mom status` works, so Tailscale and SSH do.
2. `mom logs --unit wayvnc`. It should say "listening on Tailscale address". "Tailscale is down; listening on 127.0.0.1" means wayvnc started before Tailscale and hasn't moved yet. It checks every 30 seconds, or run `mom restart wayvnc`.
3. Your viewer supports RSA-AES. TigerVNC 1.13 or later does. macOS Screen Sharing doesn't, and can't connect.
4. The password is right: `mom ssh sudo grep ^password= /home/mom/.config/wayvnc/config`.
5. The Tailscale policy grants your device port 5900 on `tag:momos`.

When VNC is down, `mom screenshot` still works, and `mom click`, `mom type` and `mom key` still control her screen.

## The Screen page doesn't connect

**"This device can't reach the laptop."** The phone or computer can't reach `https://<laptop>.<your-tailnet>.ts.net/`. Turn Tailscale on there, signed in as you, with MagicDNS on. The tailnet policy must grant `tcp:443` on `tag:momos`. Chrome may ask to let the site reach devices on your local network the first time; allow it.

**"The laptop isn't set up for this yet."** Tailscale Serve isn't passing port 443 to momd. Run `mom ssh sudo /usr/local/src/momos/system/install.sh web-screen`, then Stop and Start again. `mom ssh tailscale serve status` should show `https://<laptop>.<your-tailnet>.ts.net` proxying to `http://127.0.0.1:5901`.

**Start does nothing.** The page waits 20 seconds for the laptop to answer. Recent actions on Home shows the `screen-share` action and, if it failed, momd's reason, such as "Tailscale isn't up" or "wayvnc didn't start". `mom logs --unit momd` has `[screen-share]` lines for every start, stop, refusal and viewer.

**It connects, then keeps reconnecting.** momd restarts the session's wayvnc when control changes, and up to 3 times if it exits by itself. After that the session ends. `mom logs --unit momd` shows why.

## Windows

Her screen shows one window at a time, filling the space under the bar. Closing it shows the window she was on before, if one is on the same workspace, or else her home screen. A link that opens a new browser window puts it on top of what she was looking at, and closing it brings that back. Tapping a tile twice while the app starts opens it once. [contracts.md](../contracts.md#tiles-and-windows) has the rules.

**She's looking at the wrong app, or at two.** `mom apps` lists every window and its workspace. Each web app belongs on `tile-<id>`. `mom open <tile>` moves a stray window back to its own workspace, and `mom home` leaves whatever is open. Two windows side by side would mean her Hyprland config isn't loaded: check `mom ssh` and `hyprctl getoption general:layout` as her, which should say `monocle`.

**A page still asks her to sign in after she signed in somewhere else.** Her web app tiles and the Browser share one Chromium profile, so the sign-in counts in all of them, but a page that was already open keeps showing what it loaded. Reload it: Reload in the admin app, `/reload <page>` in Telegram, or `mom reload <tile>`. If it still asks, the site itself doesn't think she's signed in there, so check it in the Browser tile at the same address. A members-only site often shows its members area only when she's signed in, and a sign-in form otherwise, at the same address.

**A page is stuck or blank.** Reload it the same way. `mom reload` fails with a reason when the screen is locked or ydotool isn't running (`momos-ydotoold.service`).

**Closing a window didn't send her home.** `mom logs --unit momd` should show a "windows" line like `tile-youtube is empty; going home`. If momd is down, nothing sends her home; see "momd is down" above.

## A Telegram call didn't come to the front

When Telegram opens a window whose title isn't "Telegram" or "Media viewer", momd moves it to the workspace she's looking at and focuses it. A call window is titled with the caller's name. When the call ends and its window closes, she's back where she was: the app she had open, or her home screen. This rule came from reading Telegram Desktop's source and may miss a case.

**Check:** `mom apps` during a call lists the call window and its workspace. `mom logs --unit momd` shows "calls" lines if moving it failed.

**Fix:** have her press the Telegram tile, which brings Telegram forward, or run `mom open telegram`.

If Telegram isn't running at all, `mom ssh` in and check `momos-telegram.service` in her session. It restarts Telegram if she closes the window.

## She didn't see a Telegram message

Her Telegram messages show as cards near the bottom of her screen, and they stay until she presses Open or Close. A new one turns a dark screen on and ends the screensaver; if nobody touches the laptop, the screen goes dark again after 10 minutes and the card waits. While the screen is locked, the lock screen says who wrote. The Telegram tile counts what she hasn't read. [contracts.md](../contracts.md#notifications) has the details.

**Check:** `mom status` shows `telegram.unread` in her state, which is Telegram's own count. `mom logs --unit shell` shows the shell's warnings, such as "too many notifications waiting". As the admin, `mom ssh` and `sudo -u mom XDG_RUNTIME_DIR=/run/user/$(id -u mom) busctl --user status org.freedesktop.Notifications` should name `qs` as the owner. Anything else means another notification daemon took the name and the shell isn't showing cards.

**Nothing when the lid is closed.** The screen stays off with the lid closed, whatever arrives. The card is there when she opens it.

**Telegram isn't sending notifications.** Telegram's own settings (Settings, Notifications and Sounds) can turn desktop notifications off. They need to be on, and "Use native notifications" too, if Telegram shows that option.

## The lid

On the 2013 MacBook Air, with `"lid": "flaky-macbook"` in the config's `local.hardware`, momd decides whether the lid is closed from the flaky switch and the light sensor.

**The screen stays black after opening the lid.** If the laptop had been closed more than 30 minutes, it suspended and needs a key press, a trackpad click or the power button to wake. The lid can't wake it. If it hadn't, momd should turn the screen on within a couple of seconds. `mom status --json | jq .data.file.state.lid` shows what momd thinks.

**The screen turns off with the lid open.** momd thinks the lid is closed. That needs most of the last 10 seconds of switch readings to say closed and the light sensor to read zero, so it shouldn't happen from a dim room alone. `mom logs --unit momd` shows lid decisions. `mom screen on` does nothing while momd thinks the lid is closed.

On other laptops, with `lid` left out or set to `"normal"`, momd leaves the lid to logind and logs `lid mode is "normal"`. Read `~/MACHINE-NOTES.md` on the laptop before changing any of this.

## She's locked out

She locked the screen from More and forgot her PIN:

```sh
mom unlock
```

To change the PIN, `mom ssh sudo passwd mom`.

## Help requests don't reach Telegram

**Check:** the help request is in the admin app's Help page. If it is, Convex got it and Telegram is the problem. Look at the Convex dashboard's logs for "Sending help request ... failed" or "Telegram not configured", and check the three `TELEGRAM_` variables.

If the request isn't there, momd couldn't send it yet and she saw your phone number. It waits in momd's outbox and goes by itself; `mom status` shows `help.queued`, and `mom logs --unit momd` shows why it hasn't gone.

## Can't reach the laptop

`mom` says it can't connect:

- **Is it on and online?** The admin app's last-seen time tells you. If it's offline, see [No internet](#no-internet).
- **Is Tailscale up on your side?** `tailscale status` on your machine should list the laptop.
- **Is key expiry off?** An expired node drops off the tailnet. Someone at the laptop has to log it back in.
- **Did you hit the SSH rate limit?** Many new connections in a short time get blocked for a while. `mom` reuses one connection, but plain `ssh` loops don't. Wait a minute.
- **Stale control socket?** If `mom` hangs, remove `~/.ssh/momos/*` on your machine and try again.
