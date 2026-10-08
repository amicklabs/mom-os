# Restarting and updating her laptop

## Restart

A restart fixes most things that a `mom restart shell` doesn't. There are four ways:

- the **Restart** button on the admin app's Home page, which asks first;
- `/restart` to the Telegram bot, then reply `yes` within 5 minutes;
- `mom ssh sudo systemctl reboot`;
- asking her to hold the power button, as a last resort.

The first two go through Convex as the `restart` action. Her screen says "Sam is restarting the computer. It will be back in a minute." and about 10 seconds later momd reboots it. polkit lets her account reboot without a password for exactly this. A restart that reaches the laptop more than 10 minutes after you sent it is refused, so a laptop that was off doesn't reboot by surprise when it comes back. momd remembers which restart it already did, so a lost acknowledgement can't reboot it twice.

With the keyfile and autologin from setup step 9, it comes back to her home screen by itself. Allow a minute or two.

## Updates

Nothing on her laptop updates by itself. Omarchy doesn't nag her, and she never sees an update prompt. You update it when you choose, with:

```sh
mom update
```

It asks before starting. `--yes` skips the question, and `--no-reboot` stops before rebooting.

Once you say yes, her screen says "Sam is updating your computer. It will be back in a minute." until it's finished, even across the reboot: the shell shows it again as soon as her session comes back. When everything came back she sees "Done. Your computer is up to date." for a few seconds. If the update fails or you stop it, the notice goes away; if `mom` loses the connection, it goes by itself within 15 minutes. `--no-notice` skips it.

What it does:

1. Notes the running kernel.
2. Runs `omarchy update -y` on the laptop. Omarchy takes a snapper snapshot first, and limine-snapper-sync adds it to the boot menu.
3. Checks that the DKMS drivers listed in `local.hardware.dkmsModules` of her config file exist for the kernel that will boot next. On the MacBook Air that's the Wi-Fi driver, `wl`, and the camera driver, `facetimehd`. If one is missing, it tries `dkms autoinstall` once. With no drivers listed, it skips this.
4. **If a driver is still missing, it stops without rebooting.** The running kernel still has working drivers, so she notices nothing. Fix DKMS, then run `mom update` again.
5. If the drivers are there and a reboot is needed, it reboots, waits up to 9 minutes for SSH to come back, checking every 20 seconds so it doesn't trip the firewall's rate limit, then gives her session 30 seconds to start.
6. Checks the new kernel booted, the listed drivers loaded, the camera exists when `facetimehd` is listed, the shell runs, the network is up and `momctl health` passes.

It prints "Update finished and everything came back." or a list of problems.

`mom update` reads the driver list from the config file set as `configFile` for the device in `mom.json`. See [hardware notes](../setup/02-hardware.md).

### When to update

When you have time to fix things, and not right before a trip. Once a month is plenty. The daily `health` event in the timeline shows how many days it's been.

### If an update breaks the boot

Boot the snapshot from before the update. It has the old kernel and drivers. Boot entries for snapshots older than the disk keyfile ask for the disk passphrase.

The Limine boot menu is hidden (see [disk unlock and autologin](../setup/09-startup.md#no-boot-menu)), so there are two ways in:

- If the laptop still answers over SSH, `sudo bootctl list` shows the snapshot entry ids, and `sudo systemctl reboot --boot-loader-entry=<id>` boots that one once.
- Otherwise someone at the laptop presses the power button, then taps any key over and over until the menu appears, and picks the snapshot.

## Updating MomOS itself

After you pull new MomOS code:

```sh
cd packages/backend && npx convex dev --once   # if the backend changed
mom deploy                                    # or --steps shell,binaries
apps/dispatcher/install.sh                    # on the dispatcher machine, if it changed
```

Vercel redeploys the admin app from your repo on every push.

`mom deploy` restarts momd if its binary changed, and her shell if its files changed. A shell restart flickers her screen for a second, so do it when she isn't mid-call. She sees "Sam is updating your computer" while the deploy runs, so the flicker doesn't come out of nowhere. `mom restart shell` shows the same notice.
