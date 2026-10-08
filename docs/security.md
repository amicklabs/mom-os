# Security and privacy

MomOS gives the helper a lot of reach into someone else's computer, and it makes that computer easy to use by taking away passwords. This page says what each part can do, what it can't, and what we accepted on purpose.

## Threat model

The laptop holds family photos and her logins to Gmail, Facebook and Telegram. There's no banking on it. The risks we plan for:

1. **Someone steals the laptop.**
2. **Someone on the same Wi-Fi tries to get in.**
3. **A stolen laptop gets used as a way into the helper's network.**
4. **Someone takes over one of the helper's online accounts**: Convex, Clerk, Telegram or Vercel.

We accept that a thief gets her data. We don't accept the laptop becoming a way into the helper's machines, or an online account becoming a way to run commands on her laptop.

## Two channels

**Tailscale carries control.** SSH and screen sharing, only from the helper's devices. Anything that needs real control, like deploys, updates, logs or a shell, goes this way, from a machine the helper holds.

**Convex carries data.** Heartbeats, events, settings, help requests and job records. The laptop only makes outbound connections to Convex, and treats what comes back as data to check, never as commands to run.

Vercel and Convex never connect to the laptop.

## Tailscale, one way

The laptop joins the tailnet with `tag:momos`. A tagged device belongs to the tag, not to a user, so it inherits none of the helper's access. `system/tailscale-policy.hujson` grants:

- the helper's devices, `autogroup:member`, access to `tag:momos` on TCP 22, 5900 and 443 (443 is screen sharing in the admin app);
- the helper's devices access to each other.

Nothing grants `tag:momos` access to anything. The default allow-all grant has to go when you paste the policy in, or the laptop could reach every device on the tailnet.

On the laptop:

- `ufw` allows SSH and VNC on `tailscale0` only. The LAN SSH rule and LocalSend's port are removed.
- sshd takes keys only.
- wayvnc binds to the laptop's Tailscale address, or to `127.0.0.1` while Tailscale is down. Never `0.0.0.0`. It uses RSA-AES with its own random password.
- OpenSSH, not Tailscale SSH, so agents don't hit Tailscale's browser check.
- Tailscale Serve answers `https://<laptop>.<your-tailnet>.ts.net/` on port 443, to the tailnet only, never Funnel. It passes requests to `127.0.0.1:5901`, where nothing listens unless the helper started screen sharing in the admin app. See [below](#screen-sharing-in-a-browser).

If the laptop is stolen, delete its node in the Tailscale admin console and it's cut off.

## What Convex can make the laptop do

The laptop's link to Convex is a device token. With it, momd reads its own settings, content and pending actions, and writes its own heartbeats, events, help requests and screenshots. Nothing else.

**Actions.** momd carries out exactly ten, defined in `packages/shared/src/actions.ts` and checked with the same schema on both ends:

| Action | What it does |
|---|---|
| `say` | a banner, up to 280 characters, for 5 seconds to an hour |
| `home` | shows the home screen |
| `open` | opens a tile by id. Only tiles already in her settings. |
| `reload` | brings one of her web app tiles or the Browser to the front and presses F5, or opens it if it's closed. Convex takes only a tile in her settings that is a web page, and momd checks again. Refused if it waited more than 10 minutes or the screen is locked. Her screen says "Sam refreshed YouTube." for 6 seconds. |
| `lock` | locks the screen |
| `screenshot` | takes one and uploads it. Nothing shows on her screen. |
| `restart` | shows "Sam is restarting the computer", then reboots. Refused if it waited more than 10 minutes. |
| `recent-screens` | shows "Sam is looking at your last few minutes", then uploads the ring buffer's pictures |
| `help-seen` | shows "Sam saw your message." |
| `screen-share` | starts or stops screen sharing to the admin app for up to an hour, view-only unless it says control. Only the admin app can queue it. Refused if it waited more than 2 minutes. |

Anything else is refused and reported back as failed. There's no unlock, no shell command, no file write and no install.

**Settings.** Tiles, family and names are checked against a strict schema in Convex and again on the laptop. Web tiles must be `https://`. Native app tiles can only be `telegram` or `chromium`. Telegram usernames and photo file names have fixed formats. A settings change can't make the laptop run a program.

**So if someone took over the Convex account**, or an admin's Clerk login, they could:

- read her status history, help screenshots and settings, including the helper's phone number, her own phone number and Telegram username if they're set, and family members' Telegram usernames;
- put messages on her screen, take screenshots, reload her pages, lock it or restart it;
- change her tiles, which includes pointing a tile labeled "Email" at any `https://` site, or changing whose Telegram chat a family face opens;
- create and approve agent jobs, which lets an agent click and type on her screen with the fix allowlist below;
- start screen sharing, with control, and read the session's token. The token only works from a device on the helper's tailnet, so on its own it shows them nothing.

They couldn't get a shell on her laptop, read her files, unlock her screen, or reach the helper's machines. The tile and family risk is real, since it's a way to phish her, and it's why the admin app's sign-in and the Convex account deserve a strong password and two-factor authentication.

## Screen sharing in a browser

The admin app's Screen page shows her screen on the helper's phone. It's built so that a stolen Convex or Clerk login can't turn it into a way in:

- **Tailnet only.** The browser connects to `wss://<laptop>.<your-tailnet>.ts.net/`, which only resolves and answers on the helper's tailnet. The helper's phone needs Tailscale on. Tailscale Serve terminates TLS with a Let's Encrypt certificate for the laptop's name, so the admin app's HTTPS page can use it without mixed-content errors. Nothing is exposed to the internet. Funnel and relays were ruled out for that reason. The laptop's name is in public certificate-transparency logs once the certificate exists; the name alone reaches nothing.
- **Nothing listens until the helper starts it.** momd opens `127.0.0.1:5901` and a second wayvnc only after the `screen-share` action, which only the admin app can queue. They close when the time is up (15 minutes by default, an hour at most), when he presses Stop, or when momd stops.
- **A token per session.** momd makes a random token for each session and checks it, as a WebSocket subprotocol, on every connection. It also wants Tailscale Serve's user header, so the connection came through Serve from a person's device. The long-lived VNC password never leaves the laptop.
- **View-only on the laptop.** Unless the helper turned control on, the session's wayvnc runs with input disabled. No browser, modified or not, can move her mouse then.
- **She's told.** A banner says so when a browser connects, and again when control turns on ("Sam can move your mouse"). An eye stays on her bar for the whole session, with a mouse pointer beside it while control is on. The lock screen and screensaver say it in words the whole time.
- **The laptop still runs no commands from Convex.** The action only starts, changes or stops this one session, with fields the schema limits.

## Tokens and secrets

| Secret | Where it lives | What it can do |
|---|---|---|
| Device token | her `~/.config/momos/device-token`, mode 600. Convex stores only its SHA-256. | act as that one laptop. Revoke it in the admin app's Devices page. |
| Dispatcher token | `~/.config/momos/dispatcher-token` on the dispatcher machine, mode 600 (the old `~/.config/momos-dev/` path still works, with a warning), and `DISPATCHER_TOKEN` on Convex | list devices, help requests and jobs; create, claim, update and approve jobs. Compared in constant time. |
| Telegram bot token | `TELEGRAM_BOT_TOKEN` on Convex | send messages as the bot |
| Telegram webhook secret | `TELEGRAM_WEBHOOK_SECRET` on Convex, and at Telegram | lets Convex tell Telegram's requests from anyone else's |
| Clerk keys | Vercel | sign-in for the admin app. Convex also checks the email against `ADMIN_EMAILS` and that it's verified. |
| VNC password | her `~/.config/wayvnc/config`, mode 600 | view and control her screen, from the tailnet only. Never sent anywhere; the admin app doesn't use it. |
| Screen-sharing token | momd's memory, and the `screenShares` row in Convex while a session runs | view her screen from a tailnet device, and use her mouse and keyboard if the session allows it, until the session ends (an hour at most). Random for each session. |
| Disk keyfile | `/etc/cryptsetup-keys.d/momos-root.key` and inside the initramfs | unlock her disk |

No secret is in the repo. `mom devices create --install` sends the device token over SSH's stdin, and the `tailscale` step passes its auth key through a mode 600 file, so neither shows up in a process list.

## The Telegram webhook

Every request to `/telegram/webhook` must carry the `X-Telegram-Bot-Api-Secret-Token` header matching `TELEGRAM_WEBHOOK_SECRET`, compared in constant time, or it gets a 401. Every message must come from a user ID in `TELEGRAM_ADMIN_IDS`. Anything else gets an empty 200, so Telegram doesn't retry and a stranger learns nothing. If the webhook secret or admin list is missing, the webhook refuses everything with a 503.

Button taps (`callback_query`) go through the same checks: the secret header, and the tapping user's ID in `TELEGRAM_ADMIN_IDS`. A tap only names a help request, job or device by id; the server looks up what the button may do, the same as for a reply. A restart from Telegram needs `/restart` or the Restart button, then the Yes button or a `yes` reply to the bot's question within 5 minutes. Questions the bot asks with ForceReply only accept a reply to that exact message.

Anyone who takes over the helper's Telegram account can do what the helper can do through the bot: message her screen, send agents, approve fixes, restart the laptop, see her screen and her last ten minutes, which she's told about, and see her phone number through Call Mom.

## Her account

Her account has no sudo and isn't in `wheel`. Two polkit rules give it exactly what MomOS needs without a password: rebooting and turning off, for the helper's Restart action and her own Restart and Turn off under More, and joining and saving Wi-Fi networks, so she can get online away from home. The Wi-Fi rule covers only NetworkManager's network-control, settings, Wi-Fi scan and Wi-Fi on/off actions, for her user only. So anything running as her can change which network the laptop uses, and read back saved Wi-Fi passwords through NetworkManager. The files that hold them, in `/etc/NetworkManager/system-connections/`, are root's.

Bluetooth needs no rule. BlueZ lets any local user pair, connect and scan over D-Bus, so anything running as her can too. The laptop is never discoverable, and MomOS pairs only outward, with the speaker she picks, as a device with no keyboard or screen, so no code is shown or checked. MomOS turns on `Pairable` only while it pairs with that speaker, and off again right after. A speaker that's paired and trusted may connect by itself. Disconnect clears trusted.

## Agents

The dispatcher runs Claude Code with a narrow allowlist. Investigations may only look. Fixes may also open and reload tiles, click, type, press keys, restart her session's services, change the volume and unlock. Neither may use `mom ssh`, `mom deploy`, `mom update`, `ssh` or `sudo`, so an agent never has a shell or root on her laptop. Neither may join or forget a Wi-Fi network, since either could cut the laptop off. [using/agents.md](using/agents.md) has the full table.

Her words in a help request reach the agent too, marked as her description and not as instructions, along with the helper's note, if there is one. Text on her screen reaches the agent through screenshots. A web page or message could contain instructions aimed at it. The allowlist limits what that could achieve, and a fix needs the helper's approval first. Read proposed fixes before you approve them.

## A stolen laptop

With the keyfile on, the disk unlocks at boot and autologin opens her session. A thief who powers it on has her session, which means:

- **her logged-in accounts**: Gmail, Facebook, Google Photos and Telegram, in Chromium and Telegram Desktop;
- **her saved passwords**, which Chromium stores with `--password-store=basic`, because autologin never unlocks a keyring. Anyone with her files can read them;
- **her family photos** and settings, including the helper's phone number and her own if it's set;
- **the device token**, until you revoke it;
- **the VNC password** and the Tailscale node key, useless once you delete the node;
- **root**, with some effort, since they have the hardware and an unlocked disk.

They don't get anything on the helper's machines. The laptop has no SSH keys or credentials for them, and the tailnet policy gives it no route there.

What to do, in order:

1. If it's still online, `mom ssh sudo /usr/local/src/momos/system/install.sh keyfile-remove`, so the next boot needs the disk passphrase.
2. Delete the node in the Tailscale admin console.
3. Revoke the device in the admin app's Devices page.
4. Sign her out of everything from another device: Google's security page, Facebook's "Where you're logged in", and Telegram's Settings, Devices, "Terminate all other sessions".
5. Change her passwords.

## The keyfile trade-off

She can't be asked for a disk passphrase at every boot. She'd forget it, or write it on the laptop. The keyfile trades protection against theft for a laptop she can use. The disk is still encrypted, so a pulled SSD read in another machine shows nothing, but a thief with the whole laptop gets in.

We accept that because her laptop has no banking and her accounts can be signed out remotely. If your parent's laptop holds more, skip the keyfile and teach the passphrase, or keep a sticky note in a drawer, not on the laptop.

`keyfile-remove` puts the passphrase back whenever you need it, like before a repair shop.

## Privacy

Live screen sharing always tells her. Screenshots don't. A banner for each one got in her way and showed up in the pictures, so they're silent. Here's exactly what she sees:

| How | Does she see a notice? |
|---|---|
| VNC, from `mom vnc` or any viewer | yes. A banner says "Sam is looking at your screen and can move your mouse" when the viewer connects, since VNC on port 5900 always has control, and goes after 10 seconds or when she presses OK. An eye with a mouse pointer stays on her bar for as long as the connection lasts, and tapping it shows the words again. The screensaver and lock screen show the words the whole time. |
| The admin app's Screen page | yes, the same way. The banner says "Sam is looking at your screen" when the page connects and "Sam can move your mouse" when control turns on, and the eye on her bar gets a mouse pointer while control is on. |
| Screenshot button in the admin app, or Screenshot and `/screenshot` in Telegram | no. The action and its picture are on record in Convex. |
| The picture in a help request | she pressed Show Sam my screen herself |
| `mom screenshot` or `momctl screenshot`, including agents' screenshots and the bar widget's | no. It takes the picture at once, with no delay. |
| The ten-screenshot ring buffer | no, and they stay on the laptop until the helper asks for them |
| Last 10 minutes, the `recent-screens` action | yes, "Sam is looking at your last few minutes", before the upload |

The ring buffer takes one screenshot a minute, keeps the last ten in `~/.local/share/momos/screenshots/`, and skips while the screen is locked, off or the lid is closed. Those pictures leave the laptop only through the `recent-screens` action, after her screen says so. They're no longer sent with help requests.

What leaves the laptop otherwise:

- **Heartbeats and events**: which tile or app is in front, by tile id or window class, never window titles. Internet state, Wi-Fi network name and signal, battery, lid, lock, viewer, help presses, reminders answered, errors, and a daily health report.
- **Help requests**: her words, a picture of her screen when she asks for it, a voice note when she records one, plus the same status. An agent reads them only when the helper sends one (or always, with `helper.autoInvestigate` on), and then only looks. Voice notes go to Convex and Telegram only; nothing sends them to a transcription service.

Convex deletes events, help screenshots and voice notes after 60 days. Her typed words stay with the help request.

Agents see screenshots, which can include her messages and email. Their instructions keep that content out of reports.
