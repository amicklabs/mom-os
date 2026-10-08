# momctl

The command-line tool on her laptop. Every command prints one line of JSON, `{"ok":true,"data":...}` or `{"ok":false,"error":"..."}`, and exits 0 on success. The shell, `mom` and agents all act through it.

Most commands work without momd: opening tiles, going home, locking, volume, screenshots, input, Wi-Fi, Bluetooth speakers, logs and restarts. `say`, `help`, `reminder-ok` and `lock-state` need it.

```sh
momctl --help
momctl status
momctl open youtube
```

From the helper's machine, `mom <command>` runs it as her over SSH.

The code in `src/lib/` is also imported by momd, through the package's `exports`.

## Develop

```sh
pnpm --filter @momos/momctl test
pnpm --filter @momos/momctl typecheck
pnpm --filter @momos/momctl build     # dist/momctl
```

`dev/session.sh` uses `dist/momctl` when it's built.

Reference: [docs/using/momctl.md](../../docs/using/momctl.md) and [docs/contracts.md](../../docs/contracts.md#momctl-commands).
