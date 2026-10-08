# MomOS plan

MomOS turns an old laptop into an easy-mode computer for someone who can't hold on to a new mental model. The first user is my mom. She's in her 70s. She can follow instructions in the moment, but five minutes later they're gone. The Mac Finder, windows, and "where did my file go" all lose her, and when I leave after helping, she feels lost again.

The goal is a computer where everything she wants to do is a large button on the screen, nothing asks her to remember anything, and I can see and fix her screen from wherever I am.

Status: built through phase 5, with handover to her still ahead. This file is the original plan and the reasoning behind it, kept as written except for names. Like the rest of the repo, it calls her Mom and me Sam. [docs/](docs/) describes MomOS as it is now.

## What's built

As of September 25:

- **Base system.** `system/install.sh`, run by `mom deploy`, sets up her account, her own Hyprland config, the systemd user units for her session, the Chromium policy, wayvnc, Tailscale with `tag:momos`, the Tailscale-only firewall, the disk keyfile and SDDM autologin. Each step can be rerun and reverted. wayvnc works on Hyprland 0.56.
- **Her shell.** Home screen, bar, Family page, banners including "Sam is looking at your screen", Telegram message cards, the offline help card with the phone number, lock screen with her PIN, reminders, a photo screensaver, a volume card, and pages under More for six color themes, three text sizes, and simple or colorful icons.
- **momd and momctl.** Heartbeats, the offline event queue, settings sync, the Help pop-up with an offline outbox and voice notes, a ten-screenshot ring buffer the helper can ask for, the ten allowlisted actions, lid detection by averaging, idle rules with hypridle, bringing Telegram calls forward, and a daily health report.
- **Convex.** Device, admin and dispatcher functions, the Telegram bot in both directions, reminders, screensaver photos, a weekly report every Sunday evening, remote restart, and cleanup after 60 days.
- **Admin app.** Next.js with Clerk: status, help inbox, timeline, settings, reminders, photos, jobs, reports and devices, plus a Screen page that shows her screen in the browser over Tailscale, view-only unless the helper turns control on. It's started with a ninth action, `screen-share`, which only the admin app can queue.
- **My desktop.** The `mom` CLI with deploy, update and device creation; the dispatcher with investigate and fix jobs and tool allowlists; and the Omarchy bar widget.
- **Docs.** Setup, daily use, troubleshooting, security and architecture in `docs/`.

Not done yet: handover (phase 6), a real Telegram call with her account, and the open questions below. Some things differ from the plan below. The idle rules are 3 minutes to the screensaver, 15 to screen off and 30 to sleep. The backend lives in `packages/backend`. The slideshow uses photos uploaded in the admin app rather than Google Photos.

## What she does

- Browses the web, watches YouTube, uses Facebook.
- Reads some Gmail.
- Looks at family photos. They come from her iPhone through Google Photos.
- Talks to family on Telegram, including voice and video calls.
- No banking or bill paying. Someone else in the family handles that.

She does most of this on her iPhone too, and part of her confusion there is not knowing which app does what. So MomOS names buttons after what she wants to do, and the Family page is a set of faces, not an app.

We'll add buttons as I watch how she uses it.

## Design rules for her screen

- One thing on screen at a time, always full screen. No overlapping windows.
- A bar that never goes away, with a **Home** button and a **Get help from Sam** button.
- No files, folders, or save dialogs. Photos is a place. Email is a place.
- Every keyboard shortcut is off, so a stray key can't send her somewhere strange.
- No update prompts, no settings, no notifications she has to act on. I handle all of that remotely.
- Plain words wherever something needs her. "No internet" on the bar, not only a crossed-out Wi-Fi icon.
- A greeting with the day and date at the top: "Good morning, Mom. Thursday, September 25." Knowing what day it is helps her.
- She's always told when I'm watching her screen live, and she can always see when I'm not. Screenshots are silent. She asked for that.

## The laptop

It's her old 11-inch mid-2013 MacBook Air (MacBookAir6,1): Core i7-4650U, 8 GB RAM, 512 GB SSD, 1366x768 screen, battery at 84% of design capacity. It runs Omarchy 4.0.4 on the `linux-omarchy` 7.2 kernel. She's used this laptop for years and likes it.

The screen is small. Six big tiles in a 3x2 grid plus a tall bar fit, but not much more. Fonts and the cursor get bigger, and Chromium zoom sits around 110 to 125%.

`~/MACHINE-NOTES.md` on the laptop records every workaround for its broken lid sensor, plus sleep, hibernate, input and SSH settings. Anything we change in those areas gets written there too.

### Hardware tests, September 25

| Test | Result |
|---|---|
| Camera | Works. Needs `facetimehd-dkms`, `facetimehd-firmware` and `facetimehd-data` from the AUR. DKMS built cleanly against 7.2. 1280x720 at 30 fps, good color. |
| Speakers and mic | Work. A 1 kHz tone played through the speakers showed up on the mic 38 dB above background. |
| Telegram | Installed from the official repos. Camera and mic tests in Telegram's call settings pass. A real call with her account comes later. |
| Wi-Fi | Works on Broadcom's `wl` driver, which the Omarchy ISO set up. |
| Lid switch | Unreliable alone, but usable with averaging. See [Lid and sleep](#lid-and-sleep). |
| Light sensor | Readable at `/sys/devices/platform/applesmc.768/light`. Often reads zero in a normal room, so it can only confirm, not decide. |
| Screen sharing | Not tested yet. wayvnc on Hyprland 0.56 is the next test. |

## How it fits together

```
 Her laptop                             My desktop (always on)
 ┌───────────────────────────┐           ┌──────────────────────────────┐
 │ MomOS shell (Quickshell)  │           │ dispatcher daemon            │
 │ momd  (daemon)            │──SSH/VNC──│ mom CLI                      │
 │ momctl (CLI)              │ Tailscale │ Omarchy bar plugin           │
 │ Chromium, Telegram,       │           │ headless Claude Code agents  │
 │ wayvnc                    │           └──────────────┬───────────────┘
 └─────────────┬─────────────┘                          │
               │ outbound only                          │ outbound only
               ▼                                        ▼
        ┌─────────────────────────────────────────────────────┐
        │ Convex: status, events, settings, help requests,    │
        │ agent jobs, Telegram bot webhook                    │
        └───────────────┬─────────────────────┬───────────────┘
                        │                     │
                 Admin app (Next.js,     Telegram bot
                 Vercel, phone-friendly) (my phone)
```

Two channels, kept separate on purpose:

- **Tailscale carries live control.** SSH and screen sharing. Only my devices can reach her laptop, and her laptop can reach none of mine.
- **Convex carries data.** Heartbeats, events, settings, help requests, and agent job records. Her laptop only makes outbound connections to it. The laptop never runs a command it receives through Convex. It accepts a short allowlist of harmless actions and checks every setting against a strict schema. If someone took over my Convex account, the worst they could do is rearrange her buttons, put a message on her screen, or lock it.

Anything that needs real control goes through SSH from my machines. Vercel never SSHes anywhere.

## Her session

### Accounts

- **`mom`**: her account. No sudo. SDDM logs into it automatically.
- **`admin`**: my admin account, with passwordless sudo so agents can fix things. Reachable only over Tailscale with my SSH key. She never sees it.

Names come from the config file, so none of this is hardcoded.

### Startup and locking

- The disk stays LUKS-encrypted, but a keyfile in the initramfs unlocks it at boot. That's the standard Arch `cryptkey=rootfs:` setup with the `encrypt` hook Omarchy already uses. She presses the power button and lands on her home screen, including after hibernation.
- **Require password at startup** is an admin action that removes the keyfile and rebuilds the boot image. If the laptop is ever stolen, I run it and the disk needs a passphrase from the next boot on. Adding the keyfile back reverses it.
- No idle lock and no lock on sleep. An unlocked computer stays unlocked.
- She can lock it herself, for example when the grandkids visit. **Lock** sits behind a small "More" button. Her password is the four-digit PIN she's used for years. It stays out of this repo.
- `mom unlock` unlocks her screen remotely in case she forgets.

### Her own Hyprland config

Her `~/.config/hypr/hyprland.lua` is written from scratch. It doesn't source Omarchy's defaults, so an Omarchy update can't change what she sees. It:

- binds no keys, except the media keys for volume and brightness and the power button for sleep;
- opens every app full screen, one app per workspace;
- keeps an empty workspace for the home screen;
- starts the MomOS shell, momd, Telegram (hidden in the background), and wayvnc.

Omarchy's own shell, launcher and menus don't run in her session.

## Her screen: the MomOS shell

Built in Quickshell (QML), the same toolkit Omarchy's shell uses.

### Home screen

Big labeled tiles. The first set:

| Tile | Opens |
|---|---|
| Family | A page of large photos, one per person. Tapping a face opens that person's Telegram chat through a `tg://` link. |
| Telegram | Telegram itself, for everything the Family page doesn't cover. |
| YouTube | A Chromium app window. No tabs, no address bar. |
| Facebook | Same. |
| Email | Gmail, same. |
| Photos | Google Photos, same. |
| Browser | Regular Chromium, locked down by policy. |

Web apps work the way Omarchy's do: `chromium --app=URL`. They share one Chromium profile, so one Google login covers Gmail, YouTube and Photos. Each app window gets its own class, so Hyprland can give it its own workspace. MomOS has its own launch-or-focus code in `momctl` instead of calling Omarchy's scripts, so her session keeps working if Omarchy changes them.

Tiles are data. Each has a type:

- `webapp`: a URL
- `app`: a native app from an allowlist of what's installed
- `telegram-chat`: a person
- `page`: a sub-screen, like Family

Adding a tile is a settings change in the admin app, with no redeploy. Only a new tile type needs code.

### The bar

Always on top, on every screen:

- **Home.** Switches to the empty workspace so the home screen shows. Apps keep running behind it. Pressing a tile for an app that's already open brings it back instead of starting a second copy.
- **Get help from Sam.** See [Getting help](#getting-help).
- A large clock and date.
- Sound from the keyboard's volume keys, with a card that shows the level. The first version had Louder and Quieter buttons on the bar, and they came off in September.
- The name and icon of the app she's on, next to the clock.
- Internet and battery as two small icons on a button that opens a card saying the same in words. "No internet" and "Battery low" stay on the bar in words. The first version wrote both out in full ("Internet: working", "Battery: 64%"), which took a quarter of the bar; that changed in September.
- **More**, holding Lock and little else.

### Banners and notifications

Her session doesn't run Omarchy's notification daemon, so the shell includes its own:

- **"Sam is looking at your screen"** whenever a VNC client connects, then an eye on her bar for as long as it stays. momd follows wayvnc's connect and disconnect events through `wayvncctl`.
- **"The internet isn't working. It isn't your fault. Call Sam at …"** when she's offline.
- **"Sam says: …"** when I send her a message.
- New Telegram messages show as big cards: "New message from Grace. Open."
- An incoming Telegram call always comes to the front, full screen, whatever she's doing.

### Chromium policy

Managed policies in `/etc/chromium/policies/managed/`:

- uBlock Origin installed and locked on. Scam ads target people her age.
- Sites can't ask to send notifications. Those popups are a common scam route.
- No developer tools, no other extension installs.
- Safe Browsing on.
- Passwords saved. I log her into everything once and she never sees a login screen.

Chromium's managed policies apply to every account on the machine, including `admin`. That's fine.

## Getting help

She presses **Get help from Sam**. Then:

1. momd takes a screenshot with `grim`.
2. momd writes a help request to Convex with the screenshot and her recent screenshots. It keeps the last ten, one a minute, on the laptop only. They leave the laptop only when she asks for help, so I can see what happened just before something went wrong.
3. Convex sends me a Telegram message from the MomOS bot with the screenshots.
4. Her screen says "Sam has been told."
5. If she's offline, the button shows my phone number instead, in large type.

From there I can:

- **Reply to the bot.** My reply shows on her screen as "Sam says: I'll call you in five minutes."
- **Look at her screen** over VNC from any of my devices.
- **Send an agent.** Reply "look into it" and the dispatcher on my desktop starts an agent. See [The dispatcher](#the-dispatcher-on-my-desktop).

Screen sharing is always available. The banner is what makes that fair to her. She always knows when I'm watching.

## momd and momctl (on her laptop)

**momd** is a user service in her session. It:

- sends heartbeats, the current app, Wi-Fi state, signal, DNS health and battery to Convex;
- queues events in a local SQLite file while she's offline and uploads them when the connection returns, so I can see what happened while I couldn't reach her;
- follows her settings in Convex live and checks them against the schema before applying;
- carries out the allowlisted actions: show a message, open a tile, reload a tile's page, go home, lock, take a screenshot. Screenshots show nothing on her screen, at her request. A reload says "Sam refreshed YouTube." for a few seconds, since the page blinks and she may be taken to it;
- handles the help button;
- runs lid and idle detection;
- posts a daily health report: battery health, disk space, whether DKMS modules built, days since the last update.

**momctl** is the command-line interface on her laptop, with JSON output. It's everything an agent can do there:

```
momctl status            momctl open youtube        momctl lock / unlock
momctl screenshot        momctl home                momctl wifi
momctl apps              momctl say "..."           momctl logs
momctl click X Y         momctl type "..."          momctl restart shell
```

`click` and `type` use `ydotool`, so an agent can work in a loop: take a screenshot, look at it, click, take another.

## Remote access and security

### Threat model

Her laptop holds family photos and her logins to Gmail, Facebook and Telegram. No banking. The realistic risks are:

1. Someone steals the laptop.
2. Someone on the same Wi-Fi tries to get in.
3. A stolen laptop gets used as a way into my network.

Physical theft exposes the disk and her logged-in accounts. We accept that for a computer she can use without a password. The thing we won't accept is the laptop becoming a way into my machines.

### Tailscale

Her laptop joins my tailnet with a tag, not as one of my devices. A tagged node belongs to the tag, so it gets none of my user's access. The policy has one rule in each direction that matters:

```jsonc
{
  "tagOwners": { "tag:momos": ["autogroup:admin"] },
  "grants": [
    // My devices can reach her SSH and VNC ports.
    { "src": ["autogroup:member"], "dst": ["tag:momos"], "ip": ["tcp:22", "tcp:5900"] }
    // Nothing lets tag:momos reach anything.
  ]
}
```

Key expiry is off for her node so it doesn't drop off after six months. If the laptop is stolen, I delete the node in the Tailscale admin console and it's cut off.

I'm using OpenSSH over Tailscale rather than Tailscale SSH. Tailscale SSH's "check" mode asks for a browser login now and then, which would block agents running headless on my desktop.

### On the laptop

- The firewall allows SSH and VNC only on `tailscale0`. The LAN SSH rule comes out before she gets the laptop, and so does LocalSend's open port.
- sshd takes keys only. That's already the case.
- wayvnc listens only on her Tailscale address and has its own password.
- `mom` has no sudo.
- The laptop's Convex credential is a device token that can write only its own events and read only its own settings. I can revoke it from the admin app.
- The Telegram bot accepts commands only from my Telegram user ID and checks Telegram's secret-token header on every webhook call.

## Convex and the admin app

Convex is the shared backend. Tables, roughly:

- `devices`: one row per laptop, with its token hash and last heartbeat
- `events`: heartbeats, app changes, network changes, help presses
- `settings`: tiles, family, names, phone number
- `helpRequests`: with screenshots in Convex file storage
- `actions`: allowlisted actions for momd to carry out
- `jobs`: agent jobs from the dispatcher, with their reports
- `telegram`: bot message threads, so a reply maps to the right help request

The admin app is Next.js on Vercel, sign-in limited to me. It has:

- a dashboard: online or last seen, current app, internet, battery;
- a help inbox with screenshots;
- an event timeline;
- a settings editor for tiles, family, names and phone number;
- buttons for the allowlisted actions;
- the agent job list and reports.

It works from my phone and my Mac. It never touches her laptop directly.

## The dispatcher on my desktop

My desktop is always on and comes back up after a reboot, so it acts as the home server. The dispatcher is a daemon there.

It subscribes to Convex, which is an outbound connection, so nothing at home is exposed. When a job appears, it starts Claude Code headless (`claude -p`) on my subscription, with the MomOS skill and the `mom` CLI.

- **Investigate** jobs are read-only: status, screenshots, logs. The agent writes a report, which goes to Convex and to me through the bot.
- **Fix** jobs run only after I approve. The dispatcher resumes the same Claude session (`claude --resume`), so the agent keeps what it learned, and reports again when done.

Jobs can start from the Telegram bot, the admin app, or the bar plugin. A short lease in Convex means only one machine takes each job, if I ever run the dispatcher on more than one.

### mom, the CLI on my machines

`mom` wraps SSH over Tailscale to `momctl`, using one persistent connection. It adds:

- `mom vnc`: open her screen in a VNC viewer
- `mom ssh`: a shell as `admin`
- `mom deploy`: sync MomOS to her laptop and rerun the install script
- `mom update`: update her system safely (see [Updates and recovery](#updates-and-recovery))
- `mom unlock`, `mom lock`, `mom say`, `mom screenshot`, and the rest of `momctl`

It runs on my desktop and on my Mac. The repo's `AGENTS.md` and a MomOS skill tell agents how to help her with it.

### The bar plugin on my desktop

An Omarchy shell plugin in `~/.config/omarchy/plugins/`. The icon shows her state at a glance: online, offline, help waiting, or an agent job running. Clicking it opens a panel with her latest screenshot, recent events, and the dispatcher's jobs, plus buttons for Open screen, Investigate, Approve fix and Send her a message. It talks to the dispatcher over a local socket and holds no logic of its own.

## Lid and sleep

The lid sensor is broken. `MACHINE-NOTES.md` covers the history. All lid handling is off today, so closing the lid does nothing and the battery drains with the screen on.

The test on September 25 logged the switch and the light sensor four times a second, with the lid open for 30 minutes and then closed for 60 seconds, open for 30 and closed for 2 minutes:

| 10-second windows | Switch reads "closed" | Light sensor reads 0 |
|---|---|---|
| Lid open, worst window of the afternoon | at most 2.6% | anywhere from 0 to 100% |
| Lid closed | 66 to 87% in every window | 97 to 100% |

With the lid open, the switch flickers "closed" for a single reading every few minutes. With the lid really closed, it reads "closed" most of the time but bounces back to "open" about a fifth of the time. That bouncing is why ordinary lid handling kept waking and locking the machine.

Averaged over 10 seconds, the two cases don't come close. So momd uses this rule: **more than half the readings in the last 10 seconds say closed, and the light sensor reads zero.** The light sensor alone is useless, since it reads zero in a dim room.

We can't let the lid wake the machine, because the switch bounces while closed. That leaves two stages:

1. **Lid closed.** The screen turns off at once and audio and video pause. The machine stays awake, so opening the lid brings the screen back within a couple of seconds. To her it looks like normal sleep.
2. **Closed for 30 minutes.** It really suspends. After that, opening the lid shows a black screen until she presses a key, clicks, or presses the power button. Staying awake with the screen off costs a couple of percent of battery per half hour.

Idle rules as well: the screen turns off after 10 minutes untouched and the machine sleeps after 30, unless a video or call is playing. The power button keeps sleeping the machine. Hibernation after an hour asleep stays as it is.

## Updates and recovery

Nothing updates by itself. `mom update`:

1. relies on the snapper snapshot that Omarchy takes before updating;
2. runs the update on her laptop;
3. checks that the `wl` Wi-Fi driver and the `facetimehd` camera driver built for the new kernel;
4. reboots only if they did, and confirms Wi-Fi, camera and the shell come back.

If an update breaks something anyway, limine-snapper-sync already puts bootable snapshots in the boot menu. The Wi-Fi driver shipped on the Omarchy ISO and has worked since install. The camera driver is the fragile one, since it comes from the AUR.

## Configuration

One file holds everything personal, so the code can be open-sourced later without edits:

```jsonc
{
  "person": { "name": "Mom", "user": "mom" },
  "helper": { "name": "Sam", "phone": "+1 ..." },
  "admin":  { "user": "admin" },
  "tiles": [
    { "id": "family",   "label": "Family",   "type": "page", "page": "family" },
    { "id": "telegram", "label": "Telegram", "type": "app",  "app": "telegram" },
    { "id": "youtube",  "label": "YouTube",  "type": "webapp", "url": "https://youtube.com" },
    { "id": "facebook", "label": "Facebook", "type": "webapp", "url": "https://facebook.com" },
    { "id": "email",    "label": "Email",    "type": "webapp", "url": "https://mail.google.com" },
    { "id": "photos",   "label": "Photos",   "type": "webapp", "url": "https://photos.google.com" },
    { "id": "internet", "label": "Browser",  "type": "app",    "app": "chromium" }
  ],
  "family": [
    { "name": "Grace", "photo": "grace.jpg", "telegram": "grace_username" }
  ]
}
```

The file in the repo is `config/example.jsonc`. The real one lives outside git. After first setup, Convex holds the live copy.

## Repo and tools

A private GitHub repo for now. A monorepo:

```
mom-os/
  config/example.jsonc
  shell/                  Quickshell: home screen, bar, banners, notifications
  apps/
    momd/                 daemon on her laptop
    momctl/               CLI on her laptop
    mom/                  CLI on my machines
    dispatcher/           daemon on my desktop
    admin/                Next.js admin app
  convex/                 backend and schema
  helper/omarchy-plugin/  bar plugin for my desktop
  system/                 install script, Hyprland config, Chromium policy,
                          systemd units, sudoers
  AGENTS.md
  PLAN.md
```

- **TypeScript on Bun** for momd, momctl, mom and the dispatcher. They share Convex types. `bun build --compile` makes single binaries, so her laptop needs no Node or Bun install.
- **QML** for her shell and the bar plugin on my desktop.
- **Next.js on Vercel** for the admin app, since it has to work on my Mac and phone.
- **Convex** for the backend.

Native where it makes sense, web where it has to reach my Mac and phone.

## Build phases

**0. Hardware tests.** Camera, audio, Telegram and lid are done. Left: wayvnc on Hyprland 0.56, and Tailscale.

**1. Base system.**
- `mom` account and SDDM auto-login.
- Keyfile unlock.
- Tailscale with the tag and policy.
- Firewall, wayvnc and SSH over Tailscale only.
- Chromium policy and packages.
- The install script in `system/`, run with `mom deploy`.
- `MACHINE-NOTES.md` updated.

**2. Her shell, first version.** Home screen, bar, launching and Home behavior, the "Sam is looking" banner, Lock. Enough `momctl` to drive it. Built and tried on my desktop first with `qs -p shell/`.

**3. Convex, momd and the admin app.** Built alongside phase 2. Heartbeats, events and the offline queue, settings sync, the help button, the Telegram bot in both directions, the allowlisted actions.

**4. My desktop.** The `mom` CLI, the dispatcher with investigate and fix jobs, the bar plugin, `AGENTS.md` and the MomOS skill.

**5. Polish.** Family page with photos, Telegram message cards, incoming calls full screen, lid and idle handling, sound controls, daily health report, `mom update`.

**6. Handover.**
- Log her into Google, Facebook and Telegram.
- Log my Telegram account out of the laptop.
- Make a real video call with her account.
- Remove LAN SSH and LocalSend's port.
- Update `MACHINE-NOTES.md`.
- Sit with her and show her three things: the tiles, Home, and Get help from Sam.

## Open questions

- The full list of family members for the Family page, with a photo and Telegram username for each.
- Whether wayvnc works with Hyprland 0.56's screen capture. If it doesn't, the fallback needs research.
- How the Family page should behave for someone she hasn't messaged before. Telegram links need a username or a phone number that's in her contacts.

## Ideas for later

- A photo slideshow from Google Photos when the laptop sits idle.
- A voice button: she says what she wants, and an agent opens it or asks me.
- A second laptop profile, if MomOS becomes useful to other families.
