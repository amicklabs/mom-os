# Agent instructions for MomOS

If `private/AGENTS.md` exists, read it first. It holds the rules for the maintainer's own setup and adds to these.

MomOS turns an old laptop into an easy-mode computer for an older person, and lets a helper see and fix it remotely.

`PLAN.md` holds the original decisions and why. `docs/` describes what exists now: start with `docs/architecture.md`, and follow `docs/contracts.md` exactly, since it's how the parts fit together. When code and contracts disagree, fix one of them in the same change. Setup is in `docs/setup/`, day-to-day use and troubleshooting in `docs/using/`, and security in `docs/security.md`.

## The laptop

- Before touching power, sleep, the lid, locking, idle, the power button, the touchpad or function keys, read `~/MACHINE-NOTES.md` in the admin account on the laptop and follow it. `system/machine-notes.md` is its source. Update it when you change those areas.
- Once Tailscale is set up, reach the laptop only over Tailscale.
- The firewall rate-limits SSH. Reuse one connection with `ControlMaster` and `ControlPersist` instead of opening many. `mom` does this for you.
- Don't edit anything under `/usr/share/omarchy/`.

## Rules

- Nothing personal goes in the repo: no real names, passwords, phone numbers, Telegram usernames, hostnames or family photos. They belong in the real config file, which git ignores, or in Convex. Examples use "Mom" for the person and "Sam" for the helper.
- The laptop never runs commands it receives through Convex. Only the allowlisted actions in `docs/security.md`.
- Live screen sharing must always tell the person on the laptop: the banner, the eye on the bar and the "can move your mouse" banner stay. Screenshots are silent.
- Don't put windows on the developer's own display for tests. Run the nested session on a headless output (`dev/README.md`) and share screenshots.
- Don't deploy to a laptop someone is using without the helper's say-so.
