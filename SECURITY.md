# Reporting a security problem

MomOS runs on computers used by older people who can't judge whether something on their screen is safe, and it gives their helper remote control. A security bug here can hurt someone who has no way to notice it. Please report privately first.

## How to report

Use GitHub's private vulnerability reporting: the **Security** tab of this repository, then **Report a vulnerability**. Only the maintainer sees the report.

Please include:

- which part is affected: the laptop, the backend, the admin app, the Telegram bot, the dispatcher or the install script;
- what an attacker needs to start with, like being on the same Wi-Fi, holding the laptop, or controlling one of the helper's accounts;
- what they can do that they shouldn't be able to;
- steps to reproduce, with any personal data removed.

You'll get an answer within a week. This is a one-person project, so a fix may take longer, and I'll tell you where it stands.

Please don't open a public issue, post details or test against someone else's installation until a fix is out.

## What counts

[docs/security.md](docs/security.md) describes what each part is meant to allow. Anything that goes past it is a security bug. In particular:

- the laptop running something it received through Convex, other than the allowlisted actions in [docs/security.md](docs/security.md);
- the laptop, or a stolen laptop, reaching the helper's machines;
- someone other than the helper using the admin app, the Telegram bot or the dispatcher;
- a way to see or control her screen without the notice on it, beyond the gap security.md already lists;
- an agent getting past its allowlist, to a shell, root, or `mom deploy`;
- a secret ending up in a log, a process list, the repo or a Telegram message.

## What doesn't

These are known and accepted, and security.md explains why:

- someone who steals the laptop can read her data, because the disk unlocks at boot;
- Chromium stores her saved passwords without a keyring;
- whoever controls the helper's Convex, Clerk or Telegram account can change her tiles, message her screen, take screenshots, lock and restart the laptop, and approve agent fixes.

Better ideas for any of these are welcome as ordinary issues.
