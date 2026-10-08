# Why MomOS works this way

My mom is in her 70s. She can follow instructions while I'm standing next to her, and five minutes later they're gone. The Mac Finder lost her. So did overlapping windows, and "where did my file go". Every time I left after helping, she felt lost again.

A lot of older people are in the same spot. They don't need a simpler Mac or a tablet with fewer icons. They need a computer that never asks them to hold a picture of how it works in their head, and a person who can see what went wrong without asking them to describe it.

These rules came out of that. If you set MomOS up for your own parent, most of them will apply, and the admin app lets you change the parts that don't.

## Her screen

**One thing on screen at a time, always full screen.** Overlapping windows are the first thing that goes wrong. A window slides behind another and to her it's gone. So every app opens on its own workspace and fills the screen under the bar, and there's no way to see two at once. When the thing she's looking at closes, she lands on her home screen, not on some other app.

**A bar that never goes away, with Home and Help.** Whatever happens, those two buttons are in the same place. Home always gets her back to the tiles. Help always reaches me.

**Buttons are named after what she wants to do, not after apps.** She uses an iPhone too, and part of her confusion there is not knowing which app does what. "Email" is clearer than "Gmail". The Family page is a set of faces, not a contacts app. Tapping a face opens a chat with that person.

**No files, folders or save dialogs.** Photos is a place. Email is a place. She never has to decide where something goes, so she never has to remember where it went.

**No keyboard shortcuts.** Every one is off except volume and brightness. A stray key press can't send her somewhere strange.

**No prompts she has to answer.** No update notices, no settings, no "allow notifications?" popups. The helper handles all of that remotely. Websites can't ask to send notifications at all, since those popups are a common scam route.

**Plain words when something needs her.** A healthy connection and battery are two small icons on the bar, because she only needs them when something is wrong, and a tap on them says it in words. When something is wrong, the bar says "No internet" or "Battery low" in words she doesn't have to tap for. "The internet isn't working. It isn't your fault." instead of an error code.

**The day and date, in words, at the top.** "Good morning, Mom. Thursday, September 25." Knowing what day it is helps her.

**Pressing a tile twice doesn't open two copies.** It brings back the one that's already open. Home doesn't close anything either. Nothing she does loses what she was doing.

**No password to start it.** She presses the power button and lands on her home screen. There's no idle lock and no lock on sleep. She can lock it herself from the More button, for example when the grandkids visit, with the four-digit PIN she's used for years. [security.md](security.md) covers what that costs.

## Getting help

**One button, and she's done.** She presses Help and can tell me in her own words, show me her screen right where it is, ask me to call, or just say it out loud. Her screen says "Sam has your message", and later "Sam saw your message" when I tap Got it. She doesn't have to find a phone number or wait on hold. If I need more, I can ask for her last ten minutes, and she's told when I look.

**If the internet is down, the button shows my phone number in large type.** The one time she can't reach me through the laptop is the time she most needs a way to reach me.

**She's always told when I'm looking at her screen.** A banner says "Sam is looking at your screen" when I connect, and an eye stays on her bar until I leave. It says "Sam can move your mouse" if I take control. The banner used to stay up the whole time, and at her biggest text size it covered the Back button on the page she was on, so now it steps aside after ten seconds and the eye does the reminding. Screen sharing is always available to me, and telling her is what makes that fair. She shouldn't have to wonder. Screenshots used to say "Sam took a picture of your screen" too. It got in her way and showed up in the pictures, so at her request screenshots are silent now. Watching live still tells her.

**Screenshots stay on the laptop unless she asks for help.** The laptop keeps the last ten, one a minute, so I can see what led up to a problem. They leave only inside a help request she started.

## Keeping it working

**Nothing updates by itself.** An Omarchy update can change the kernel, and on an old MacBook a new kernel can leave the Wi-Fi or camera driver unbuilt. So updates only happen when the helper runs `mom update`, which checks the drivers built before it reboots.

**Her session doesn't depend on Omarchy's defaults.** Her Hyprland config is written from scratch. The home screen launches apps with its own code instead of Omarchy's scripts. An Omarchy update can't change what she sees.

**Every part degrades on its own.** If the backend is down, the tiles still work. If the daemon is down, the shell reads its config file directly. If the shell keeps crashing, Chromium opens full screen so she still has the web. [contracts.md](contracts.md) has the full table.

**Settings are data.** Tiles, family members, names and the phone number live in one settings file and in the admin app. Adding a tile or a face is an edit, not a deploy.

## Remote access

**Two channels, kept apart.** Tailscale carries real control: SSH and screen sharing, from the helper's devices only. The backend carries data: heartbeats, events, settings, help requests. The laptop only makes outbound connections to the backend, and it never runs a command it receives there. It accepts six harmless actions, like "show this message" or "go home", and checks every setting against a strict schema. If someone took over the backend account, the worst they could do is change her tiles, put a message on her screen, take a screenshot, lock it or restart it. [security.md](security.md) spells that out.

**The laptop can't reach the helper's network.** It joins the tailnet with a tag. The helper's devices can reach its SSH and screen-sharing ports, and it can reach nothing of theirs. A stolen laptop isn't a way in.

**Agents look first and fix only with approval.** An AI agent can investigate a problem with read-only commands and write a report. It carries out a fix only after the helper says "go", and even then it can't get a shell or root on the laptop.

## Start small

Watch how your parent uses it before adding anything. We started with seven tiles and add buttons only after seeing where she hesitates. A tile she never presses is one more thing on the screen to think about.
