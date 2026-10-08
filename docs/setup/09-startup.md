# 9. Disk unlock and autologin

Two changes let her press the power button and land on her home screen: the disk unlocks itself at boot, and SDDM logs straight into her account.

**Do both with the laptop in front of you.** Each one only shows whether it worked at the next boot, and a boot that stops at a prompt needs someone at the keyboard.

## Unlock the disk at boot

The disk stays encrypted. The `keyfile` step adds a random keyfile to a spare LUKS key slot and puts it in the initramfs, the standard Arch `cryptkey=rootfs:` setup. Boot and resume from hibernation then skip the passphrase. The passphrase you chose at install time still works.

The trade-off: anyone who has the laptop can boot it. [security.md](../security.md#the-keyfile-trade-off) explains why that's acceptable for her, and what to do if the laptop is stolen.

```sh
mom ssh
# on the laptop:
sudo /usr/local/src/momos/system/install.sh --dry-run keyfile
sudo /usr/local/src/momos/system/install.sh keyfile
```

It asks for the current disk passphrase, adds the key slot, checks the new key opens the disk, writes two drop-in files and rebuilds the boot image with `limine-mkinitcpio`. It never removes a key slot.

Now reboot and watch the screen:

```sh
sudo systemctl reboot
```

It should go straight to the login screen, or to your admin session if SDDM autologs into it. If it stops and asks for the passphrase, type it. Nothing is broken. The initramfs didn't find the keyfile. Check the step's output for errors, fix them and run it again.

Boot entries for snapshots taken before this change still ask for the passphrase. That's expected.

### Require the passphrase again

```sh
sudo /usr/local/src/momos/system/install.sh keyfile-remove
```

This is the admin action for a lost or stolen laptop, or before you send it off for repair. It asks for a passphrase and proves it opens the disk first, then removes the keyfile's slot, deletes both drop-ins, rebuilds and shreds the key. It refuses if the keyfile is the only way to open the disk. From the next boot on, the laptop stops at the passphrase prompt. Run `keyfile` again to reverse it.

If the laptop is stolen but still online, you can run this over Tailscale before you remove it from your tailnet.

## Log into her account at boot

```sh
sudo /usr/local/src/momos/system/install.sh autologin
sudo systemctl reboot
```

`autologin` points SDDM's autologin at her account with the `omarchy.desktop` session. It checks her Hyprland config first, and doesn't restart SDDM, so nothing changes until the reboot.

After the reboot you should see her home screen: the greeting, the date, her tiles and the bar. From your machine:

```sh
mom status
mom screenshot
```

`mom screenshot` copies a PNG of her screen to `~/.cache/momos/screenshots/` on your machine and prints its path.

If the screen stays black or shows Chromium full screen, the shell didn't start. See [troubleshooting](../using/troubleshooting.md#the-shell-keeps-crashing).

### Switch back to your account

Her session has no keyboard shortcuts and no way to log out. To use the laptop as yourself at the keyboard:

```sh
mom ssh sudo /usr/local/src/momos/system/install.sh autologin-admin
mom ssh sudo systemctl reboot
```

Run `autologin` again when you're done.

## No boot menu

Omarchy's Limine bootloader shows a menu of kernels and snapshots for 5 seconds on every boot. She shouldn't have to see it, so it's hidden. This is a manual change on the laptop, not an `install.sh` step. Two lines go near the top of `/boot/limine.conf`, under Omarchy's commented-out `#timeout: 3`:

```
timeout: 1
quiet: yes
```

With `quiet: yes`, Limine draws nothing and waits one second, then boots the default entry. A key press during that second shows the menu. `limine-entry-tool`, `limine-mkinitcpio` and `limine-snapper-sync` rewrite only the entries below these lines, so kernel updates and new snapshots keep them.

To get the menu:

- At the laptop, press the power button and tap any key over and over until the menu appears.
- Remotely, for one boot, `sudo systemctl reboot --boot-loader-menu=30` makes Limine wait 30 seconds instead of 1. Someone still has to press a key in that time.
- To boot a particular entry once without the menu, find its id with `sudo bootctl list`, then run `sudo systemctl reboot --boot-loader-entry=<id>`.

To show the menu on every boot again, delete the two lines. `~/MACHINE-NOTES.md` on the laptop has the details.

## Idle and sleep

Nothing to set up here, but it's worth knowing what her session does on its own:

- After 3 minutes untouched, the photo screensaver starts. Any touch ends it.
- After 15 minutes, the screen turns off.
- After 30 minutes on battery, the laptop suspends. Plugged in, it never suspends from idle: the screen stays off and the laptop stays awake, so you can reach it remotely whenever it's on the charger.
- A playing video or a call holds all of that off.
- The power button runs `systemctl suspend-then-hibernate`.
- There's no lock on idle or sleep.

On the MacBook Air, momd also turns the screen off when the lid closes and suspends after 30 minutes closed. See [hardware notes](02-hardware.md).

Next: [admin app](10-admin-app.md).
