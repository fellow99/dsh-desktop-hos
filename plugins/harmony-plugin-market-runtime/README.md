# harmony-plugin-market-runtime

HarmonyOS DSH plugin that provides the two services `dsh-market` feature-detects — **`desktopProfiles`** and **`desktopPnpm`** — so the market runs plugin installs **in-process** instead of spawning `node`/`pnpm` children (which HarmonyOS kills with `SIGSYS`).

This is the "Route 1" wiring of `specs/012-pnpm-integration`: it consumes the market's built-in cross-environment contract without modifying the market.

## Why a plugin (not main-process code)

The market reads `ctx.get('desktopProfiles')` inside its `inject(['webServer','loader'])` callback. That callback fires during profile composition, **before** `runProfile()` returns to the Electron main process — so main-process code cannot provide the service in time. A host-plane plugin row, mounted during composition, can.

This plugin is therefore also a **bundle** (`dsh.bundle.patch` → `cordis.patch.yml`), listed in `dsh.profile.bundles` **before `dshmarket`**, so its row mounts first.

## How it runs pnpm

`pnpm`'s CLI (`dist/pnpm.mjs`) is a fire-and-forget bundle: importing it resolves long before the install finishes, and it never calls `process.exit` on success. So a direct in-process import cannot report completion.

This plugin runs the pnpm CLI in a **`worker_threads.Worker`**:

| Problem | Worker solution |
|---|---|
| Completion detection | the worker exits when pnpm's pending work drains; `worker.on('exit', code)` is the signal |
| Exit code | the worker's exit code *is* pnpm's exit code |
| `process.exit` | exits only the worker, never the Electron process |
| ESM module cache | every `new Worker(...)` is a fresh module graph — no cache-busting |
| seccomp SIGSYS | a worker is a *thread in the same process*, not a `fork`ed child |

## Services provided

- `desktopProfiles` — `{ current: { name, dir } }`.
- `desktopPnpm` — `{ runPlugin(args, invokingDir, signal) }` returning `{ stdout, stderr, done, cancel }` per `DesktopPnpmLike`.

`runPlugin` runs `pnpm <args> --dir <profileDir> --reporter=append-only` in a worker and streams output.

## Requirements

- The main process sets `DSH_PNPM_ENGINE` to the materialized pnpm CLI entry (`<DSH_ROOT>/node_modules/pnpm/dist/pnpm.mjs`), placed by `scripts/collect-dsh.mjs`'s `collectMarketPNPM()`.
- The profile's `pnpm-workspace.yaml` sets `nodeLinker: hoisted`, `packageImportMethod: copy`, `ignoreScripts: true`, `minimumReleaseAge: 0`, and a sandbox-local `storeDir`.

## Known limitations

- **`ignoreScripts: true`**: plugins that need lifecycle build scripts cannot install.
- **No `git:` sources**: the device has no `git`.
- **Cancel is best-effort**: `cancel()` terminates the worker; pnpm is not preemptible mid-operation.
- **Native modules**: only needed for `packageImportMethod: clone` (`@reflink`); the `copy` path loads none.

## Files

| File | Role |
|---|---|
| `lib/index.js` | plugin entry: provides `desktopProfiles` / `desktopPnpm` |
| `lib/pnpm-inprocess.js` | parent-side runner: worker lifecycle → `{ stdout, stderr, done, cancel }` |
| `lib/pnpm-worker.mjs` | worker entry: imports the pnpm CLI with a synthetic `process.argv` |
| `cordis.patch.yml` | bundle patch inserting the plugin row |
| `tests/pnpm-inprocess.test.mjs` | unit tests (fake engine; no network) |
