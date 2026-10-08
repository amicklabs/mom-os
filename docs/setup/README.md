# Setting up MomOS

This guide takes a laptop from a fresh Omarchy install to a computer you can hand to your parent. Do the steps in order. Most of them you can do from your own desk once SSH works. A few change how the laptop boots or who can reach it, and those you should do with the laptop in front of you.

The guide calls the person who'll use the laptop "the person" or "she", and you "the helper". It uses these example names, which you'll replace with your own:

| Example | What it is |
|---|---|
| `mom` | the person's Linux account |
| `admin` | your admin account on the laptop, the one Omarchy's installer creates |
| `mom-laptop` | the laptop's hostname and its device name in MomOS |
| `~/src/mom-os` | your checkout of this repo |

## Before you start

You'll need:

- the laptop, on the home Wi-Fi, with a charger;
- a Linux or macOS machine of your own with `git`, `ssh`, `rsync`, [Bun](https://bun.sh), Node.js 22 or later and pnpm 10;
- accounts at Tailscale, Convex and Telegram, and optionally Vercel and Clerk;
- about two hours for a first install.

Clone the repo and install its dependencies on your machine:

```sh
git clone https://github.com/amicklabs/mom-os.git ~/src/mom-os
cd ~/src/mom-os
pnpm install
```

## The steps

| # | Step | Where | Can it cut off remote access? |
|---|---|---|---|
| 1 | [Prepare the laptop](01-laptop.md) | at the laptop | no |
| 2 | [Hardware notes](02-hardware.md) | at the laptop | no |
| 3 | [Convex backend](03-convex.md) | your machine | no |
| 4 | [Telegram bot](04-telegram.md) | your machine and phone | no |
| 5 | [Install `mom`](05-mom.md) | your machine | no |
| 6 | [The config file](06-config.md) | your machine | no |
| 7 | [Deploy and create the device](07-deploy.md) | your machine, over the LAN | no |
| 8 | [Tailscale and the firewall](08-tailscale-and-firewall.md) | laptop nearby | **yes** |
| 9 | [Disk unlock and autologin](09-startup.md) | at the laptop | **yes** |
| 10 | [Admin app on Vercel with Clerk](10-admin-app.md) | your machine | no |
| 11 | [Dispatcher and bar widget](11-dispatcher.md) | your always-on machine | no |
| 12 | [Handover checklist](12-handover.md) | with the person | no |

Steps 10 and 11 are optional. Without the admin app you manage settings with `mom` and the Convex dashboard. Without the dispatcher you have no agent jobs, and everything else works.

## Steps that need you in the room

These can leave the laptop unreachable if something goes wrong. Do them with the laptop in front of you and your own SSH session open over the network you're about to depend on.

- **`install.sh tailscale`** moves remote access onto Tailscale. If it fails, the LAN still works, so this one is low risk, but check it before the firewall step.
- **`install.sh firewall`** removes SSH from the LAN. After it, the only way in is Tailscale. The script refuses to run unless you're connected over Tailscale right now.
- **`install.sh keyfile`** changes how the disk unlocks at boot. If the keyfile isn't found, the laptop stops at a passphrase prompt that only someone at the keyboard can answer.
- **`install.sh keyfile-remove`** makes every boot stop at that prompt, on purpose.
- **`install.sh autologin`** changes which account logs in at boot. If her session is broken, the screen shows nothing useful until you SSH in and switch it back.
- **Any reboot**, including `mom update` and the Restart button, comes back only if the steps above are right.

`install.sh all`, which `mom deploy` runs by default, never runs any of these. It only adds packages and writes files.

## If you get stuck

`system/README.md` explains every install step, what it writes and how to revert it. `sudo /usr/local/src/momos/system/install.sh check` on the laptop runs read-only health checks.
