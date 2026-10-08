# Her Bluetooth speaker

The laptop's own speakers are small. Under More, Speaker lets her play its sound on a Bluetooth speaker, such as the one the family already has. After the first time, the laptop connects to that speaker again by itself.

![The Speaker page with three speakers nearby](../../shell/docs/screenshots/speaker.webp)

## What she does

1. She turns the speaker on. The first time only, she holds its Bluetooth button until its light blinks. That's pairing mode, and most speakers have it. Check the speaker's manual once so you can tell her which button it is.
2. She presses More, then Speaker. The page starts looking right away and keeps looking while it's open. Speakers appear by the names they announce, like "JBL Flip 5", about ten seconds after she opens the page.
3. She taps the speaker's name. The page says "Connecting to JBL Flip 5…", then "Connected. Sound plays on JBL Flip 5." The laptop pairs with it, remembers it, connects, and sends all its sound there.

## Choosing where the sound comes out

Once a speaker is connected, the top of the page asks "Where does the sound come out?" and has two big buttons: "This computer" and the speaker's name. The one in use is filled in and has a check mark. Tapping the other moves the sound in well under a second. The speaker stays connected either way, so she can switch back and forth as often as she likes. More shows the same thing under Speaker ("Playing on JBL Flip 5").

![Playing on Kitchen Speaker](../../shell/docs/screenshots/speaker-playing.webp)

A connected speaker's row also has a small Disconnect button. That one lets the speaker go, so someone's phone can have it, and the sound comes back to the laptop.

While no speaker is connected, the top card just says "Sound is playing on the computer".

Only speakers and headphones show up. Phones, watches, the neighbor's TV and nameless devices don't. A speaker used before says "Used before · Tap to connect" and has a small Forget button, which asks first.

When it doesn't work, the page says why in her words and what to try: it can't find the speaker (off, too far, or not in pairing mode the first time), the speaker refused, or the speaker didn't answer, which usually means it's off or playing for someone's phone. Each has Try again. None of them tells her to call you. She knows Help does that.

![Porch Speaker didn't answer](../../shell/docs/screenshots/speaker-failed.webp)

## Connecting again by itself

After the first time the speaker is saved: paired and trusted.

- **The speaker reconnects.** Most speakers connect to the last device they played for when they're turned on, and the laptop accepts a trusted one.
- **The laptop tries once.** momd tries to connect a saved speaker about 20 seconds after she logs in and 20 seconds after the laptop wakes from sleep. It tries once, never on a timer, so the laptop doesn't keep pulling a family speaker away from someone's phone.
- **The sound follows her choice.** WirePlumber remembers where she last sent the sound. If that was the speaker, the sound goes to it whenever it connects and comes back to the laptop while it's away. If she chose "This computer", the sound stays on the laptop even when the speaker connects, and momd doesn't pull the speaker in after login or wake.

Disconnect stops all of this for that speaker until she taps it again. It clears trusted, but the pairing stays.

If the speaker is playing for a phone when the laptop wants it, most speakers refuse the laptop. She turns Bluetooth off on the phone, or has whoever's using it disconnect, then taps the speaker on the page.

## Doing the first pairing yourself

You can pair it over SSH while she holds the speaker's button, on the phone with you:

```sh
mom speaker scan            # about 10 seconds; the speaker appears by name with its address
mom speaker connect 11:22:33:44:55:66
mom speaker                 # saved speakers and where the sound goes
```

`connect` pairs, trusts, connects and sends her sound to the speaker, the same as her tap. If the speaker has left pairing mode by then, `connect` looks for it again for 10 seconds before giving up. `mom speaker output computer` and `mom speaker output <address>` are her two buttons. `mom speaker disconnect <address>` is her Disconnect, and `mom speaker forget <address>` unpairs it.

There's no Telegram or admin-app button for this, and no Convex action. Pairing needs someone next to the speaker anyway, and you're on the phone with her for it. The dispatcher's agents can't run `mom speaker` either.

## Testing it without her

With a speaker on your desk, next to the laptop:

1. Put it in pairing mode. `mom speaker scan` should list it with `"nearby": true`.
2. `mom speaker connect <address>` should answer `"connected": true, "output": true`, and `mom ssh bluetoothctl info <address>` should say `Bonded: yes`. Play a YouTube video on her laptop and listen.
3. `mom speaker output computer`, then `mom speaker output <address>`. The sound should move each time, and the speaker should stay connected.
4. Turn the speaker off. The sound should come back to the laptop within a few seconds. Turn it on again. Most speakers reconnect by themselves within half a minute.
5. Sleep the laptop with the power button, wake it, and check `mom logs --unit momd` for a `[speaker] wake:` line.

## When it goes wrong

- **The page says "Bluetooth isn't working".** BlueZ has no adapter, or it's blocked. `mom ssh rfkill` shows a block, and `mom ssh sudo rfkill unblock bluetooth` lifts it. `mom ssh systemctl status bluetooth` should say active. `install.sh packages` enables it, and `install.sh check` checks it.
- **The speaker doesn't show up.** It isn't in pairing mode, or it's paired and connected to a phone, so it doesn't answer scans. Only the first time needs pairing mode. A saved speaker never shows as nearby; it's on the list anyway.
- **Connected, but the sound is still on the laptop.** The page says "Connected, but the sound is still on the computer." PipeWire didn't make an output for it within 20 seconds, even after `connect` tried switching the speaker to its A2DP profile. The shell's log has a `no sound on` line with the speaker's PipeWire card, its profile and the outputs there were (`mom logs --unit shell`). `mom ssh sudo -u mom XDG_RUNTIME_DIR=/run/user/$(id -u mom) wpctl status` lists the outputs.
- **It pairs, then forgets the speaker a second later.** `bluetoothctl info` says `Paired: no` and `Bonded: no` after a connect. That was the September 28 bug: BlueZ keeps the adapter non-bondable unless something sets `Pairable`, so the pairing stored no key. `connect` now sets `Pairable` for the pairing. If you pair by hand with `bluetoothctl`, run `pairable on` first.
- **Sound gets worse during a Telegram call.** WirePlumber switches a speaker with a microphone to its hands-free profile when an app opens the microphone. The call then uses the speaker's microphone, in lower quality. That's WirePlumber's default and MomOS leaves it.

The commands and their JSON are in [contracts.md](../contracts.md#speaker).
