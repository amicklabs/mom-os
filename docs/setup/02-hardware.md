# 2. Hardware notes

Old laptops have quirks, and a quirk you don't know about becomes a call from your parent. Before installing MomOS, test the hardware she'll use and write down what you find in `~/MACHINE-NOTES.md`.

## What to test

| Test | How | What you're looking for |
|---|---|---|
| Wi-Fi | Use it for a day | Drops, slow reconnects after sleep, which driver it uses (`lspci -k`) |
| Camera | Open it in Telegram's call settings, or `mpv av://v4l2:/dev/video0` | Does `/dev/video0` exist at all? |
| Speakers and mic | Telegram's call settings have a mic test | Echo, very low volume |
| Sleep | Close the lid, open it, wait a minute, open it again | Does it wake? Does Wi-Fi come back? |
| Battery | `cat /sys/class/power_supply/BAT0/capacity` over an hour | How long it really lasts |
| Screen | Look at the home screen with MomOS installed | Tiles and text big enough for her eyes |

Anything that needs a driver from the AUR is the fragile part. A kernel update can leave it unbuilt, and MomOS's `mom update` checks for exactly that before it reboots.

## Example: a 2013 MacBook Air

These are the notes from the laptop MomOS was built on, an 11-inch mid-2013 MacBook Air, to show the kind of thing to look for.

**Wi-Fi** works on Broadcom's `wl` driver, which the Omarchy ISO set up. It's a DKMS module, so it has to rebuild for every new kernel.

**The FaceTime camera** needs three AUR packages: `facetimehd-dkms`, `facetimehd-firmware` and `facetimehd-data`. With `facetimehd` in the config's `local.hardware.dkmsModules`, the `packages` install step builds them with `yay` as the admin account if any is missing. The DKMS module built cleanly against the 7.2 kernel and gives 1280x720 at 30 fps.

**The lid sensor is broken.** With the lid open, the switch reads "closed" for a single reading every few minutes. With the lid closed, it reads "closed" most of the time but bounces back to "open" about a fifth of the time. Ordinary lid handling kept waking and locking the machine. So all of logind's and Hyprland's lid handling is off on that laptop, and momd decides instead. It samples the switch and the Apple light sensor four times a second, and counts the lid as closed when more than half the readings in the last 10 seconds say closed and the light sensor reads zero. Then it turns the screen off and pauses media. After 30 minutes closed it suspends. Because the switch bounces while closed, the lid can't be allowed to wake the machine, so after a real suspend she wakes it with a key press, a click or the power button.

**The screen** is 1366x768. Six big tiles in a 3x2 grid plus the bar fit, and not much more. Chromium runs at 125% and the cursor is larger.

## What this means for your laptop

Your config file's `local.hardware` block, in [step 6](06-config.md), is where these go. For the MacBook Air above it's:

```jsonc
"hardware": { "dkmsModules": ["wl", "facetimehd"], "lid": "flaky-macbook" }
```

- **A working lid switch needs nothing from MomOS.** Leave `lid` out, or set it to `"normal"`. momd then leaves the lid to logind, which suspends on close by default. Only `"flaky-macbook"` turns on momd's averaging, which also needs the Apple light sensor at `/sys/devices/platform/applesmc.768/light`.
- **List your DKMS drivers.** `mom update` refuses to reboot unless every module in `dkmsModules` exists for the next kernel, and `momctl health` reports them. With none listed, it checks none. Only `facetimehd` makes the `packages` step install anything extra.
- **Write the rule down.** If you find a quirk and a workaround, put it in `~/MACHINE-NOTES.md` so that you, six months from now, and any agent, know not to undo it.

Next: [Convex backend](03-convex.md).
