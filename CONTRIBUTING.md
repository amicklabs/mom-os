# Contributing to MomOS

Thanks for looking. MomOS is small and built around one person's needs, so the best contributions come from setting it up for someone and fixing what got in the way.

## Setup

You need Linux or macOS with [Bun](https://bun.sh), Node.js 22 or later and pnpm 10. Working on the shell also needs Hyprland 0.56 or later and Quickshell, which means an Omarchy or Arch desktop.

```sh
git clone <this repo> mom-os
cd mom-os
pnpm install
```

## Layout

| Path | What | Language |
|---|---|---|
| `packages/shared` | zod schemas every part checks against | TypeScript |
| `packages/backend` | Convex functions, schema, crons, Telegram webhook | TypeScript |
| `apps/momd` | daemon on the laptop | TypeScript on Bun |
| `apps/momctl` | CLI on the laptop | TypeScript on Bun |
| `apps/mom` | CLI on the helper's machines | TypeScript on Bun |
| `apps/dispatcher` | agent job runner | TypeScript on Bun |
| `apps/admin` | admin app | Next.js |
| `shell` | her screen | QML for Quickshell |
| `helper/omarchy-plugin` | bar widget for the helper's Omarchy desktop | QML |
| `system` | install script and files for the laptop | Bash |
| `dev` | nested development session | Bash |

Each has a README with how to run and test it.

## Checks

These are what CI runs on every push:

```sh
pnpm -r typecheck
pnpm -r test
pnpm --filter @momos/admin lint
pnpm --filter @momos/admin build
```

CI also runs `shellcheck` on every tracked shell script. The loop in `.github/workflows/ci.yml` finds them.

Backend tests use `convex-test` and need no deployment. The Bun apps use `bun test`. The admin app builds without any environment variables.

There's no automated check for QML. CI can't install Quickshell, and `qmllint` can't resolve the shell's imports. Test shell changes by running them.

## Running her session on your desktop

`dev/session.sh` runs her whole session in a window: a nested Hyprland with her real Hyprland config, at the laptop's 1366x768, with the repo's `shell/` in it.

```sh
dev/session.sh                  # stays in the foreground; Ctrl+C stops it
dev/session.sh screenshot       # from another terminal
eval "$(dev/session.sh env)"    # point hyprctl, grim and qs at the nested session
MOMOS_DEV_DIR=$XDG_RUNTIME_DIR/momos-session shell/dev/state.sh offline
```

momd doesn't run in it. `shell/dev/state.sh` writes a fake `state.json` for a scenario: `normal`, `offline`, `viewer`, `message`, `sending`, `sent`, `failed`, `charging`, `today`, `reminder`, `stale` or `none`. [dev/README.md](dev/README.md) has the details, including how to take screenshots when your own screen is asleep.

For the shell alone, without a nested Hyprland, `shell/dev/run.sh` runs it on your desktop against test files.

## Trying it on a real laptop

```sh
mom deploy --steps shell,binaries
mom restart shell
```

Deploy to a laptop you own before anyone's parent's. `mom deploy --dry-run` shows what it will do.

## Rules

**Contracts first.** [docs/contracts.md](docs/contracts.md) says how the parts talk: files on the laptop, `momctl` commands, shell IPC, every Convex function and its auth, the job lifecycle. If you change any of that, change contracts.md in the same commit. When code and contracts disagree, one of them is a bug.

**Every part degrades on its own.** She must be able to use the laptop with any other part down. The table at the top of contracts.md is the test. A new feature that needs momd or Convex must leave the shell working without them.

**The laptop never runs commands from Convex.** New remote abilities go in the action allowlist in `packages/shared/src/actions.ts`, and each one must be harmless if someone else sends it. Anything stronger goes over SSH.

**She's always told when someone watches her screen live.** New ways to watch or control her screen need a notice on it. Screenshots are the exception. They're silent, because a notice on each one got in her way.

**Nothing personal in the repo.** No real names beyond the examples already there, phone numbers, Telegram usernames, passwords or photos. They belong in the config file, which git ignores, or in Convex.

**Don't edit `/usr/share/omarchy/`.** Her session doesn't load Omarchy's defaults, and changes there disappear on the next Omarchy update.

**Read `~/MACHINE-NOTES.md` on the laptop** before touching power, sleep, the lid, locking, idle, the power button, the touchpad or function keys.

## Words on her screen

Everything she reads should be short and plain. "Internet: working", not a Wi-Fi icon. "It isn't your fault." Name buttons after what she wants to do. No jargon, no error codes, nothing she has to answer. If a new string would confuse someone who can't remember what they did five minutes ago, rewrite it.

## Commits

Small commits that each do one thing, with a plain subject that says what changed: "Keep Telegram running after she closes its window". The body says why, if it isn't obvious.
