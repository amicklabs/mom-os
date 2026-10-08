# mom

The command-line tool on the helper's machines. It reaches the laptop over SSH, reusing one connection, and runs `momctl` there as the person. It also deploys, updates, opens VNC and creates devices in Convex.

```sh
bun build --compile --minify src/main.ts --outfile ~/.local/bin/mom
mom init --device mom-laptop --host mom-laptop --user mom --admin admin
mom status
```

Its config is `~/.config/momos/mom.json`. The dispatcher reads the same file.

## Source

| File | What |
|---|---|
| `src/main.ts` | commands and help text |
| `src/config.ts` | `mom.json` |
| `src/ssh.ts` | SSH with a shared control connection, and running commands as the person |
| `src/momctl.ts` | running `momctl`, and fetching screenshots |
| `src/deploy.ts` | `mom deploy` |
| `src/doctor.ts` | `mom doctor`, the first-deploy checks |
| `src/update.ts` | `mom update` |
| `src/provision.ts` | `mom devices create` |
| `src/vnc.ts` | finding a VNC viewer |
| `src/convex.ts` | `help-requests` and `jobs`, read with the dispatcher token |

## Develop

```sh
pnpm --filter @momos/mom test
pnpm --filter @momos/mom typecheck
bun src/main.ts --help
```

Reference: [docs/using/mom.md](../../docs/using/mom.md).
