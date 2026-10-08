# dispatcher

Runs agent jobs on the helper's always-on machine. It subscribes to pending jobs in Convex, claims one with a lease, runs Claude Code headless with an allowlist of `mom` commands, and writes the report back. Investigations only look. Fixes run after the helper approves, resuming the same Claude session.

It also serves `$XDG_RUNTIME_DIR/momos-dispatcher.sock` for the Omarchy bar widget.

## Install

```sh
apps/dispatcher/install.sh
journalctl --user -u momos-dispatcher -f
```

`install.sh` builds `mom` and `momos-dispatcher` into `~/.local/bin`, and installs and starts the `momos-dispatcher` user service. It reads `~/.config/momos/mom.json` and the dispatcher token file. [docs/setup/11-dispatcher.md](../../docs/setup/11-dispatcher.md) has the full setup and the environment variables.

## Source

| File | What |
|---|---|
| `src/main.ts` | the service and its socket handlers |
| `src/runner.ts` | claiming, leases, running one job |
| `src/claude.ts` | the `claude` command line and the tool allowlists |
| `src/prompts.ts`, `prompts/*.md` | the agent's instructions. `AGENTS.md` from the repo root is bundled in too. |
| `src/jobs.ts` | job phases and parsing Claude's output |
| `src/convex.ts` | the Convex link |
| `src/summary.ts` | the bar widget's summary |

## Develop

```sh
pnpm --filter @momos/dispatcher test
pnpm --filter @momos/dispatcher start    # run from source
```

Tests use `test/fake-claude.ts` in place of Claude Code.

How jobs work: [docs/using/agents.md](../../docs/using/agents.md).
