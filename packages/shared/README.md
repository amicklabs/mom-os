# shared

`@momos/shared`: the zod schemas and types every part checks against, so the laptop, the backend and the admin app agree on what's valid.

| File | What |
|---|---|
| `src/config.ts` | settings: person, helper, tiles, family, and the local-only block. `NATIVE_APPS` is the list of programs a tile may open. |
| `src/actions.ts` | the six actions Convex may ask momd to carry out |
| `src/events.ts` | events momd reports |
| `src/state.ts` | `state.json`, which momd writes and the shell reads |
| `src/protocol.ts` | the momd socket protocol, and file paths on the laptop |
| `src/reminders.ts` | reminders, screensaver photos and device content |

Changing a schema here changes what every part accepts. Update [docs/contracts.md](../../docs/contracts.md) in the same commit.

```sh
pnpm --filter @momos/shared test
```
