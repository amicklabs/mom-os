# MomOS

MomOS turns an old laptop into an easy computer for an older parent, and lets you, the helper, see and fix it from wherever you are.

It's for someone who can follow instructions while you're in the room and loses them five minutes after you leave. Everything they want to do is a big button with a plain name. Nothing asks them to find a file, answer an update prompt or remember a shortcut. When something does go wrong, they press one button and you get a message on your phone with a picture of their screen.

A son built it for his mom, on her 2013 MacBook Air. It's written so another family can set it up for their own parent. The website is at [mom-os.amicklabs.com](https://mom-os.amicklabs.com).

![The MomOS home screen in the warm Morning theme: a bar with Home, the time, Wi-Fi and battery icons, More and Help, then "Good evening, Mom" in a serif face, the date, and seven large tiles with line icons](shell/docs/screenshots/home.webp)

## What the person sees

- A home screen of big tiles: Family, Telegram, YouTube, Facebook, Email, Photos, Browser. You choose the tiles.
- A bar that never goes away, with **Home**, the time and date, the name and icon of the app they're in, Wi-Fi and battery icons that turn into "No internet" or "Battery low" in words when there's a problem, and **Help**, which opens a card where they can write to you, show you their screen, ask you to call or record a voice note. The keyboard's volume keys work, and a card shows the level when it changes.
- Line icons in the theme's color, or the apps' own colorful marks if they find those easier to spot. They pick under More, along with six color themes and three text sizes.
- One app on screen at a time, always full screen. Pressing Home goes back to the tiles without closing anything.
- A Family page of faces. Tapping a face opens that person's Telegram chat.
- A greeting with the day and date, and today's reminders under it.
- A banner saying "Sam is looking at your screen" whenever you're connected to it, and "and can move your mouse" when you can.
- A photo screensaver with a big clock when the laptop sits idle.
- No keyboard shortcuts, no notifications to act on, no settings, no update prompts.

## What the helper gets

- **A Telegram bot.** A help request arrives as their words, their screen or their voice note. Nothing else happens until you choose a button: Send an agent, Message Mom's screen, Screenshot, Last 10 minutes, Reload a page, Watch Mom's screen, Call Mom, Got it, Restart Mom's laptop or Done. Plenty of help requests aren't about the computer at all, so agents don't start on their own unless you turn that on in Settings.
- **An admin app** on your phone and computer: whether the laptop is online, what's open, a help inbox, a timeline, tiles and family settings, reminders, screensaver photos, weekly reports, buttons to message, lock, screenshot or restart, and their screen live in the browser, view-only unless you turn on control. With Tailscale on your phone, that works there too.
- **`mom`, a command-line tool** that reaches the laptop over Tailscale: status, screenshots, screen sharing, logs, restarts, deploys and safe system updates.
- **A dispatcher** on an always-on machine at home. It runs Claude Code agents that look into problems read-only and write you a report. A fix happens only after you press Approve fix.
- **A weekly report** every Sunday evening: how much they used it, what they opened, help presses, outages and anything worth a look.

## What you need

- A laptop that runs [Omarchy](https://omarchy.org), the Arch Linux and Hyprland setup. MomOS installs on top of it.
- A [Tailscale](https://tailscale.com) account. The free plan is enough.
- A [Convex](https://convex.dev) account for the backend. The free plan is enough for one family.
- A Telegram bot, made with BotFather, and Telegram on your phone.
- For the admin app, optionally: a [Vercel](https://vercel.com) account and a [Clerk](https://clerk.com) application.
- For agents and the bar widget, optionally: a Linux machine at home that stays on, with [Bun](https://bun.sh) and [Claude Code](https://claude.com/claude-code) installed and signed in.
- An hour or two with the laptop in front of you for the steps that change how it boots or who can reach it.

## Limits

- **Omarchy only.** The install script expects Omarchy's packages, Limine boot setup, SDDM, ufw and Hyprland 0.56 with its Lua config. It won't work on plain Arch or another distribution without changes.
- **Built for one family first.** It grew around one person and one laptop. Another family will hit rough edges. Issues about them are welcome.
- **English only.** Every word on the screen is in the code.
- **Tested on one laptop.** A 2013 11-inch MacBook Air with a broken lid sensor, at 1366x768. The hardware notes cover that machine. Other laptops will have their own quirks, and the shell hasn't been tried at other screen sizes.
- **The helper needs to be comfortable in a terminal.** Setup is a series of shell commands, and some fixes need `mom ssh`.

## Where to start

Read [docs/setup/README.md](docs/setup/README.md). It goes step by step from a fresh Omarchy install to handing the laptop over, and marks the steps that can cut off remote access.

The rest of the docs:

- [Why it works this way](docs/why.md): the design rules and the reasons behind them.
- [Using MomOS](docs/using/README.md): the admin app, the bot, `mom`, agents, updates and troubleshooting.
- [Architecture](docs/architecture.md): the parts and how they talk. [docs/contracts.md](docs/contracts.md) is the precise reference.
- [Security and privacy](docs/security.md): what each part can do, and what a stolen laptop exposes.
- [Contributing](CONTRIBUTING.md) and [reporting a security problem](SECURITY.md).

## Repository layout

```
apps/momd/              daemon on the laptop
apps/momctl/            command-line tool on the laptop
apps/mom/               command-line tool on the helper's machines
apps/dispatcher/        agent job runner on the helper's always-on machine
apps/admin/             Next.js admin app
packages/backend/       Convex backend
packages/shared/        schemas and types every part shares
shell/                  the home screen, bar and banners, in Quickshell
system/                 install script and system files for the laptop
helper/omarchy-plugin/  bar widget for the helper's Omarchy desktop
dev/                    run the whole session in a window for development
config/example.jsonc    the settings file, with example values
```

## License

MIT. See [LICENSE](LICENSE).
