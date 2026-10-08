# 11. Dispatcher and bar widget

The dispatcher runs agent jobs. When you reply "look" to a help message, or start a job in the admin app, it starts Claude Code headless on a machine at home, lets it investigate the laptop through `mom`, and sends you the report. A fix runs only after you approve it. [using/agents.md](../using/agents.md) explains the whole flow.

The bar widget is an Omarchy bar icon for the same machine that shows her state at a glance.

Both are optional. Do this step on a Linux machine that stays on, like a desktop at home. It needs no open ports: the dispatcher connects out to Convex, and reaches the laptop over Tailscale like any of your devices.

## What the machine needs

- systemd, Bun, pnpm and a checkout of this repo;
- [Claude Code](https://claude.com/claude-code), installed as `claude` in `~/.local/bin` or `/usr/local/bin` and logged in. Jobs run on whatever account it's logged into;
- Tailscale, logged in as you, so it can reach the laptop;
- an SSH key the laptop accepts that works without a passphrase prompt. The dispatcher runs as a service with no agent and no terminal. A dedicated key is simplest:

  ```sh
  ssh-keygen -t ed25519 -f ~/.ssh/momos -N ''
  ssh-copy-id -i ~/.ssh/momos.pub admin@mom-laptop
  ```

  Then set `"identityFile": "~/.ssh/momos"` on the device in `mom.json`.

## Install

```sh
cd ~/src/mom-os
mom init --device mom-laptop --host mom-laptop --user mom --admin admin \
  --helper Sam --convex-url https://happy-animal-123.convex.cloud   # skip if mom.json exists
apps/dispatcher/install.sh
```

`install.sh` builds `mom` and `momos-dispatcher` into `~/.local/bin`, installs the `momos-dispatcher.service` user unit, enables it and starts it. Run it again after pulling new code.

The dispatcher reads `~/.config/momos/mom.json` for the Convex URL, the laptops and the token file, and `~/.config/momos/dispatcher-token` for the token you made in [step 3](03-convex.md). A token left at the old path, `~/.config/momos-dev/dispatcher-token`, still works, with a warning in the log until you move it. It checks for both every minute, so it starts fine before they exist.

So it keeps running after a reboot without anyone logging in:

```sh
sudo loginctl enable-linger "$USER"
```

Check it connected:

```sh
journalctl --user -u momos-dispatcher -f
```

Look for "connected to Convex".

## Settings

Environment variables override the defaults. Set them with `systemctl --user edit momos-dispatcher`, as `Environment=NAME=value` lines under `[Service]`:

| Variable | Default | What it does |
|---|---|---|
| `MOMOS_CLAUDE_MODEL` | Claude Code's default | model for agent jobs |
| `MOMOS_INVESTIGATE_MINUTES` | 10 | stop an investigation after this long |
| `MOMOS_FIX_MINUTES` | 20 | stop a fix after this long |
| `MOMOS_CLAUDE_BIN` | `claude` | path to Claude Code |
| `MOMOS_MOM_BIN` | `mom` | path to `mom` |
| `MOMOS_CONVEX_URL` | `convexUrl` in `mom.json` | Convex deployment |
| `MOMOS_DISPATCHER_TOKEN_FILE` | `dispatcherTokenFile` in `mom.json` | dispatcher token file |
| `MOMOS_REPO_DIR` | `repoDir` in `mom.json` | checkout agents may read |
| `MOMOS_DISPATCHER_SOCKET` | `$XDG_RUNTIME_DIR/momos-dispatcher.sock` | socket for the bar widget |
| `MOMOS_DISPATCHER_WORKDIR` | `~/.local/state/momos/dispatcher/work` | where Claude Code runs |

## Try a job

In the admin app's Jobs page, start an investigation with "Take a look at the laptop's screen and check everything is working." Within a few minutes you get a report on Telegram and in the app.

## The bar widget

On an Omarchy desktop, the machine running the dispatcher:

```sh
helper/omarchy-plugin/install.sh
```

This copies the widget to `~/.config/omarchy/plugins/momos.status`, checks it with `omarchy plugin validate`, and places it in the bar next to the Tailscale icon. It backs up `~/.config/omarchy/shell.json` first. `--uninstall` removes it.

The icon shows whether she's online or offline, whether a help request or a fix is waiting for you, and whether an agent job is running. Click it for her latest screenshot, recent help requests and jobs, and buttons for Open screen, Investigate, Approve fix and sending her a message. The widget holds no logic. It asks the dispatcher over its local socket, and when the service is down the panel says how to start it.

Next: [handover checklist](12-handover.md).
