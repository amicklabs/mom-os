# Using MomOS

For the helper, once the laptop is set up.

## Day to day

Most days you do nothing. When she presses Help, she can write to you, show you her screen, ask you to call, or say it out loud, and your phone buzzes. Tap Got it so she knows you saw it, then answer her, call her or use the buttons. Tap Send an agent when it looks like the laptop needs one.

![Her home screen just after you connect: a purple banner near the top reads "Sam is looking at your screen", with an OK button, and a purple eye sits on her bar](../../shell/docs/screenshots/banner-viewer.webp)

- [The admin app](admin-app.md): status, help inbox, timeline, settings, actions.
- [When she asks for help](help.md): the Help pop-up and what reaches you.
- [The Telegram bot](telegram.md): every button, command and reply.
- [Reminders and photos](reminders-and-photos.md): reminders on her screen, screensaver photos, family faces.
- [The weekly report](weekly-report.md): what it says and how to read it.
- [Agent jobs](agents.md): investigate, approve, fix, and what agents may do.
- [Her Bluetooth speaker](speaker.md): connecting it from More, reconnecting by itself, pairing it remotely.
- [Restarting and updating](updates.md): the Restart button, `mom update` and updating MomOS itself.
- [Troubleshooting](troubleshooting.md): momd down, shell crashing, no internet, [when she's away from home](troubleshooting.md#when-shes-away-from-home), VNC, calls, the lid.

## Reference

- [`mom`](mom.md), the command-line tool on your machines.
- [`momctl`](momctl.md), the command-line tool on her laptop.
- [contracts.md](../contracts.md), how the parts talk, precisely.

## Where to do what

| I want to | Use |
|---|---|
| see if she's OK | admin app Home, or `/status` to the bot |
| see her screen | `mom vnc`, or `mom screenshot` |
| tell her something | Message Mom's screen under a help request, a reply to it, the admin app message box, or `mom say "..."` |
| see what she was doing | Last 10 minutes under a help request |
| send an agent without a help request | `/run <instructions>` to the bot |
| change her tiles or family | admin app Settings, or `npx convex run provision:saveSettings` in `packages/backend` with her whole settings object |
| add a reminder | admin app Reminders |
| unlock her screen | `mom unlock` |
| add a Wi-Fi network for her | `mom wifi connect "<name>" --password-stdin --save-only`, or she does it under More, Internet connection |
| connect her Bluetooth speaker | she does it under More, Speaker, or `mom speaker scan` then `mom speaker connect <address>` |
| restart the laptop | admin app Restart, or `/restart` to the bot |
| update the system | `mom update` |
| deploy new MomOS code | `mom deploy` |
| get a shell | `mom ssh` |
