# Agent jobs and the dispatcher

An agent job sends Claude Code to look at her laptop for you. It takes screenshots, reads her status and logs, and writes a short report you can read on your phone. If it thinks something needs fixing, it proposes the exact steps and waits. It carries them out only when you say "go".

The dispatcher runs the jobs, on a machine at home. [Setup step 11](../setup/11-dispatcher.md) installs it.

## Starting a job

Any of these creates a job in Convex:

- **Send an agent** under a help message on Telegram, with a note or Send without a note, or reply `look`. Her help request on its own doesn't start one, since she often uses Help just to talk to you;
- with "Send an agent on every help request" on in the admin app's Settings (`helper.autoInvestigate`), her written or spoken help request starts one on its own, with her words as the problem;
- `/run <instructions>` to the bot, for a job with no help request;
- **Send an agent** in the admin app's Help inbox, with an optional note;
- **Start a job** on the admin app's Jobs page, with a request in plain English;
- **Investigate** in the bar widget's panel. It ties the job to her latest help request from the last hour, if there is one.

The dispatcher, subscribed to Convex, sees the new job within seconds, claims it and starts the agent. It runs one job at a time.

## How a job runs

```
queued -> investigating -> awaiting_approval -> approved -> fixing -> done
                        \-> done   (nothing to fix)
any state -> failed or cancelled
```

1. **Investigate.** The agent gets her status, the help request's context, her words (marked as her description of the problem, never as instructions to follow), your note if you wrote one, whether she sent a voice note or asked for a call, and the picture she showed you, if any. It's told that she sometimes uses Help to talk to you about things that aren't the computer, and to say so and keep it short when that's the case. It may run only read-only `mom` commands. It writes a report with three parts: what she sees, the likely cause and how sure it is, and the proposed fix. When a short line on her screen would help, it adds a suggested message for her. The last line says `FIX NEEDED: yes` or `no`.
2. **Report.** With `no`, the job is done and the report comes to Telegram and the Jobs page. With `yes`, it waits for you.
3. **Approve.** Tap **Approve fix** under the report on Telegram or reply `go`, or press **Approve fix** in the admin app or the bar widget. Or do nothing, or cancel it.
4. **Fix.** The dispatcher resumes the same Claude Code session, so the agent remembers what it found. It gets a few more commands, takes a fresh screenshot first, works in small steps and checks each one. It stops after the fix or after three attempts that don't work, and reports again.

**Investigate more** under a report asks what to look into next and starts a new read-only job that resumes the same session, so the agent remembers what it found. **Send this to Mom** puts its suggested message on her screen; nothing it suggests reaches her unless you press that. **Dismiss** cancels a job that's still waiting.

An investigation stops after 10 minutes and a fix after 20, and the job fails with a note saying so. The admin app's "Fix" job kind is only a label: every job starts with an investigation.

## What the agent may do

The dispatcher starts Claude Code with only the `Bash`, `Read`, `Glob` and `Grep` tools, `--permission-mode dontAsk` so anything not allowed is refused rather than asked about, and its own settings only, so your personal Claude Code settings don't leak in.

| | Investigate | Fix |
|---|---|---|
| `mom status`, `screenshot`, `apps`, `logs`, `health`, `wifi`, `devices`, `help-requests`, `jobs` | yes | yes |
| `mom wifi connect`, `wifi forget`, `wifi portal open` | never | never |
| `mom open`, `reload`, `home`, `say`, `click`, `type`, `key`, `restart`, `volume`, `unlock` | no | yes |
| `mom ssh`, `deploy`, `update`, `init` | never | never |
| `ssh`, `sudo` | never | never |
| `mom lock`, `vnc` | no | no |
| read files | the screenshot cache and the repo checkout | same |

No shell and no root on her laptop, ever. If a fix needs either, the agent says so in its report and you do it yourself. `mom restart` restarts part of her session, not the laptop.

The agent's instructions are in `apps/dispatcher/prompts/`, along with the repo's `AGENTS.md`. The person's and helper's names come from her settings in Convex. Nothing else about her, like her age or her laptop's model, is written into them. They tell it to keep her private messages and emails out of reports, not to type passwords or log in to her accounts, to tell her with `mom say` before clicking around on her screen, and to keep anything it says to her short and calm.

## Leases

A job belongs to one dispatcher at a time, through a 5-minute lease in Convex that the dispatcher renews while the agent works. If the dispatcher dies, a cron returns the job to the queue when the lease runs out, so another dispatcher, or the same one after a restart, picks it up. A job that loses its lease three times fails, with the reason in its report.

## Watching it

```sh
journalctl --user -u momos-dispatcher -f
mom jobs
```

Each run logs the job, the laptop, how many turns it took and what it cost.

## Things to know

- **An agent sees what's on her screen.** Screenshots can show her messages and email. The instructions keep them out of reports, but the agent does read them.
- **Text on her screen can try to steer the agent.** A web page or message could contain instructions aimed at it. The allowlist is what limits the damage: investigations can't change anything, and fixes can't get a shell. Read a proposed fix before you approve it.
- **Screenshots are silent.** `mom screenshot` shows nothing on her screen, at her request, so an agent's pictures don't get in her way. The instructions still say to take only the ones it needs. See [security.md](../security.md#privacy).
