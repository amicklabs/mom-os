# 6. The config file

One file holds everything personal about her setup: names, your phone number, her tiles, her family, and where Convex is. Keep it on your machine, outside git. The repo's `.gitignore` ignores `config/*.jsonc` except the example, so `config/mom-laptop.jsonc` inside the checkout is safe too, but a path under `~/.config/momos/` is harder to commit by accident.

Do this step on your machine.

## Write it

Start from the example:

```sh
cp ~/src/mom-os/config/example.jsonc ~/.config/momos/mom-laptop.jsonc
chmod 600 ~/.config/momos/mom-laptop.jsonc
```

Then edit it. A full file:

```jsonc
// Whole-line // comments are fine. Comments at the end of a line are not.
{
  "person": { "name": "Mom", "user": "mom" },
  "helper": { "name": "Sam", "phone": "555-555-0100" },
  "admin": { "user": "admin" },
  "tiles": [
    { "id": "family",   "label": "Family",   "icon": "family",   "type": "page",   "page": "family" },
    { "id": "telegram", "label": "Telegram", "icon": "telegram", "type": "app",    "app": "telegram" },
    { "id": "youtube",  "label": "YouTube",  "icon": "youtube",  "type": "webapp", "url": "https://www.youtube.com" },
    { "id": "email",    "label": "Email",    "icon": "email",    "type": "webapp", "url": "https://mail.google.com" },
    { "id": "photos",   "label": "Photos",   "icon": "photos",   "type": "webapp", "url": "https://photos.google.com" },
    { "id": "internet", "label": "Browser",  "icon": "internet", "type": "app",    "app": "chromium" }
  ],
  "family": [
    { "id": "grace", "name": "Grace", "photo": "grace.jpg", "telegram": "grace_example" }
  ],
  "local": {
    // This hardware block is for the 2013 MacBook Air. See step 2 for yours.
    "convexUrl": "https://happy-animal-123.convex.cloud",
    "deviceTokenFile": null,
    "hardware": { "dkmsModules": ["wl", "facetimehd"], "lid": "flaky-macbook" }
  }
}
```

### person and helper

- `person.name` is what the home screen greets her with.
- `person.user` is her Linux account. `install.sh` creates it.
- `person.phone` and `person.telegram` are optional: her own number, the way you'd dial it, and her Telegram username without the @. Call Mom, under a help request on Telegram, shows the number and an Open Mom's Telegram chat button. The laptop doesn't use them. Put them in your real config or the admin app's Settings, never in the repo.
- `helper.name` goes in the Help pop-up ("Get help from Sam"), in "Sam is looking at your screen" and in "Sam says: ...".
- `helper.phone` is shown in large type in the Help pop-up when her request can't reach you. Write it the way she'd dial it.
- `helper.telegram` is optional: your Telegram username, without the @. With it, the Help pop-up offers "Message Sam on Telegram", which opens her chat with you.
- `helper.autoInvestigate` is optional and off unless `true`. Off, a help request just reaches you, and you tap Send an agent when you want one. On, an agent starts looking whenever she writes or records a voice note, as MomOS did before October 2026.

### admin

`admin.user` is your admin account on the laptop. Only `install.sh` reads it. You can leave it out and pass `--admin` instead.

### tiles

At most 12. The small screen fits six or seven comfortably. Every tile has an `id`, which is lowercase letters, digits and dashes, a `label` of up to 24 characters, and an optional `icon`. The bundled icons are `family`, `telegram`, `youtube`, `facebook`, `email`, `photos`, `internet`, `chrome` and `app`. Leave `icon` out for a text-only tile.

For a site with no bundled icon, put your own SVG next to `config.json` as `~/.config/momos/icons/<name>.svg` in her account and set `icon` to `<name>`, using the same characters as an `id`. A bundled name always wins. The shell draws the SVG as it is, in both icon styles, since there's no line version of it, so make it square and leave a little margin. If the file is missing or won't load, the tile shows `app`. The shell looks for the file when it starts, so run `mom restart shell` after adding one. Nothing in MomOS copies this folder to the laptop, so put it there yourself, and again after a reinstall. With `person.user` set to `mom`:

```
mom ssh 'sudo -H -u mom sh -c "mkdir -p ~/.config/momos/icons && cat > ~/.config/momos/icons/recipes.svg"' < recipes.svg
mom restart shell
```

| `type` | Also needs | Opens |
|---|---|---|
| `webapp` | `url`, https only | a Chromium app window with no tabs or address bar |
| `app` | `app`: `telegram` or `chromium` | a native app. Only these two are allowed, so a settings change can never start an arbitrary program. |
| `telegram-chat` | `telegram`: a username | that person's Telegram chat |
| `page` | `page`: `family` | a page inside the shell. `family` is the only page today. |

Web apps share one Chromium profile, so one Google login covers Gmail, YouTube and Photos.

A web app window keeps the class Chromium gave it at launch, `chrome-<host>__<path>-Default`, taken from the tile's `url`. momctl, momd and the bar match that host, so following a link to another site inside the window keeps the tile's workspace and label. A link that asks for a new window opens a plain browser window instead, and the bar calls that the Browser.

To sign her into a web app, open its tile (`mom open <id>`, or she taps it), connect with `mom vnc` and sign in inside that window. Chromium's password manager is on, so let it save the password when it offers. The login lives in the shared profile, so it survives restarts. Don't type her passwords into a terminal or a chat with an agent.

### family

At most 24 people. Each has an `id`, a `name`, a Telegram `username` in `telegram`, and an optional `photo`: a file name under `~/.config/momos/photos/` on the laptop. Without a photo the page shows their initials. It's easiest to upload photos in the admin app's Settings page, which sends them to the laptop. Without the admin app, copy them there yourself after the deploy.

Telegram opens a chat from a username. For someone she hasn't messaged before, check that the link works while you're with her.

### local

Settings that never come from Convex:

- `convexUrl` is `CONVEX_URL` from `packages/backend/.env.local`. With `null`, momd runs without Convex: no heartbeats, no help messages, no remote settings.
- `deviceTokenFile` is where momd looks for its device token. `null` means the default, `~/.config/momos/device-token`, which is where step 7 puts it.
- `hardware` describes the laptop, as in [step 2](02-hardware.md). Leave it out for a laptop with no DKMS drivers and a working lid.
  - `dkmsModules` lists kernel modules built by DKMS, like `wl` for Broadcom Wi-Fi or `facetimehd` for the MacBook camera. `mom update` won't reboot unless they're built for the new kernel, and `momctl health` reports them. `facetimehd` also makes the `packages` step install the camera driver from the AUR.
  - `lid` is `"normal"` (the default) to leave the lid to logind, `"flaky-macbook"` for momd's handling of the 2013 MacBook Air's broken lid switch, or `"ignore"` to have MomOS do nothing with it.

## What happens to this file

`mom deploy` sends it to `/etc/momos/config.json` on the laptop, readable by root only. The `session` install step copies it to her `~/.config/momos/config.json` the first time. After that, momd owns her copy: when you change settings in the admin app, momd rewrites it, keeping the `local` block.

So edits to this file after the first deploy don't reach her screen by themselves. Change tiles, family and names in the admin app. The exception is `local.hardware`: every deploy's `session` step copies it into her copy, so edit it here and run `mom deploy --steps session`. To change the rest of `local`, edit her copy on the laptop through `mom ssh`.

After the first deploy, Convex holds the live settings. `mom devices create --settings` in step 7 seeds them from this file.

Next: [deploy and create the device](07-deploy.md).
