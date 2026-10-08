# 5. Install `mom`

`mom` is the command-line tool on your own machines. It reaches the laptop over SSH, runs `momctl` there as her, and adds deploys, updates, screen sharing and device setup. You can install it on as many machines as you like, for example your desktop and your laptop.

Do this step on your machine.

## Build it

`mom` compiles to a single file with Bun:

```sh
cd ~/src/mom-os
mkdir -p ~/.local/bin
bun build --compile --minify apps/mom/src/main.ts --outfile ~/.local/bin/mom
mom --version
```

Make sure `~/.local/bin` is on your `PATH`. On the machine that will run the dispatcher, `apps/dispatcher/install.sh` builds and installs `mom` for you, so you can skip this there. See [step 11](11-dispatcher.md).

You can also run it from the checkout without building: `bun apps/mom/src/main.ts status`.

## Tell it about the laptop

```sh
mom init --device mom-laptop --host mom-laptop.local --user mom --admin admin \
  --helper Sam --convex-url https://happy-animal-123.convex.cloud
```

| Flag | What it is |
|---|---|
| `--device` | a short name for this laptop, lowercase letters, digits and dashes. Use the same name for the Convex device in step 7 so the dispatcher can match them. |
| `--host` | how SSH reaches the laptop. Its LAN name or address for now, its Tailscale name after step 8. |
| `--user` | her Linux account, which `install.sh` will create |
| `--admin` | your admin account on the laptop |
| `--helper` | your name as agents should use it in reports and messages |
| `--convex-url` | `CONVEX_URL` from `packages/backend/.env.local` |

This writes `~/.config/momos/mom.json`. Open it and add two things `init` has no flags for:

- `"repoDir"`: the path to your checkout, like `"~/src/mom-os"`. `mom deploy` and `mom devices create` need it when you run them from outside the checkout.
- `"configFile"` inside the device entry: the path to her config file, which you'll write in [step 6](06-config.md).

The result looks like this:

```json
{
  "defaultDevice": "mom-laptop",
  "helperName": "Sam",
  "devices": {
    "mom-laptop": {
      "host": "mom-laptop.local",
      "sshPort": null,
      "identityFile": null,
      "user": "mom",
      "adminUser": "admin",
      "vncHost": null,
      "vncPort": 5900,
      "configFile": "~/.config/momos/mom-laptop.jsonc"
    }
  },
  "convexUrl": "https://happy-animal-123.convex.cloud",
  "dispatcherTokenFile": null,
  "repoDir": "~/src/mom-os"
}
```

Nothing in `mom.json` is secret. The dispatcher token lives in its own file, `~/.config/momos/dispatcher-token` unless `dispatcherTokenFile` says otherwise, and her settings live in her config file. Older versions defaulted to `~/.config/momos-dev/dispatcher-token`. A token still there works, with a warning, until you move it.

`mom devices` lists what `mom` knows about. With more than one laptop, pick one with `--device NAME` or `MOM_DEVICE=NAME`, or set `defaultDevice`.

## Check SSH

```sh
mom ssh true && echo ok
```

`mom` opens one SSH connection per laptop and keeps it for 10 minutes, with its control socket in `~/.ssh/momos/`. Every later command reuses it. The laptop's firewall rate-limits new SSH connections, so this matters.

Commands like `mom status` need `momctl`, which the deploy in step 7 installs. Until then they fail with "momctl isn't installed".

Next: [the config file](06-config.md).
