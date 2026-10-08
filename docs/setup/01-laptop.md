# 1. Prepare the laptop

Do this step at the laptop.

## Install Omarchy

Install [Omarchy](https://omarchy.org) from its ISO. MomOS was built on Omarchy 4.0.4 with the `linux-omarchy` 7.2 kernel and Hyprland 0.56. Newer versions will probably work. Older ones won't, because her session uses Hyprland's Lua config.

During the install:

- **Keep disk encryption on.** Omarchy's installer sets up LUKS. MomOS later adds a keyfile so the laptop boots without the passphrase, and you can turn that off again if the laptop is stolen. Write the passphrase down somewhere safe. You'll need it for step 9.
- **The account you create is your admin account**, not hers. MomOS creates her account later. This guide calls yours `admin`.
- **Pick a hostname you'll recognize**, like `mom-laptop`. It becomes the laptop's name on your tailnet.

Connect to the home Wi-Fi and let the first boot finish.

## Turn on SSH from the LAN

For now you reach the laptop over the home network. `mom deploy` also needs `rsync` on the laptop. Step 8 moves that onto Tailscale and closes the LAN.

On the laptop:

```sh
sudo pacman -S --needed openssh rsync
sudo systemctl enable --now sshd
sudo ufw limit 22/tcp
ip -4 addr show   # note the laptop's LAN address
```

`ufw limit` rate-limits new connections. `mom` reuses one SSH connection for everything, so the limit never gets in its way, but a loop of plain `ssh` commands will.

From your machine, copy your key across and check you get in:

```sh
ssh-copy-id admin@mom-laptop.local    # or admin@<LAN address>
ssh admin@mom-laptop.local true
```

Then turn off password logins. On the laptop:

```sh
echo 'PasswordAuthentication no' | sudo tee /etc/ssh/sshd_config.d/10-momos-keys-only.conf
sudo systemctl reload sshd
```

## Give the admin account passwordless sudo

`mom` logs in as the admin account. `mom deploy` and `mom update` use `sudo` to install and reboot, and every other command runs `momctl` as her through `sudo`. None of them has a terminal to type a password into. On the laptop:

```sh
echo 'admin ALL=(ALL) NOPASSWD: ALL' | sudo tee /etc/sudoers.d/admin
sudo chmod 440 /etc/sudoers.d/admin
sudo visudo -c
```

Use your real admin account name in place of `admin`, both in the line and the file name. The `sudoers` install step keeps this file correct from then on.

Check from your machine:

```sh
ssh admin@mom-laptop.local 'sudo -n true && echo sudo works'
```

## Start a notes file

Make `~/MACHINE-NOTES.md` in the admin account's home on the laptop. Write down anything you change on this particular machine: driver packages, sleep and lid settings, input settings, anything you had to work around. The install script later adds a MomOS section to it, between marker comments, and leaves the rest alone.

This file is for you and for agents working on the laptop. `AGENTS.md` tells agents to read it before touching power, sleep, the lid, locking or input.

Next: [hardware notes](02-hardware.md).
