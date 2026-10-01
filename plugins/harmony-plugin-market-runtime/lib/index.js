/**
 * HarmonyOS market runtime plugin: provides the two services dsh-market
 * feature-detects - `desktopProfiles` and `desktopPnpm` - so the market runs
 * plugin installs **in-process** (via a worker-thread pure-JS pnpm engine)
 * instead of spawning node/pnpm children, which HarmonyOS kills with SIGSYS.
 *
 * This is the "Route 1" wiring of 012-pnpm-integration: it consumes the
 * market's built-in cross-environment contract without modifying the market
 * (see `specs/012-pnpm-integration/plan.md` §6).
 *
 * Named exports only: a default export makes the Loader discard `inject`.
 *
 * @module harmony-plugin-market-runtime
 */
import { join } from 'node:path'
import { runPnpmInProcess, resolveEngineEntry, assertPnpmEngine } from './pnpm-inprocess.js'

/** Plugin name used by loader diagnostics. */
export const name = 'harmony-plugin-market-runtime'

/** Log prefix, matching the wrapper's hilog convention. */
const LOG_PREFIX = '[dsh-harmony]'

/**
 * The directory of the profile this process booted.
 * @param profileContext - the launcher's `profileContext` service, if present.
 * @returns an absolute-ish profile directory, or null when it cannot be derived.
 */
function resolveProfileDir(profileContext) {
  const fromContext = profileContext && typeof profileContext.dir === 'string' ? profileContext.dir.trim() : ''
  if (fromContext !== '') return fromContext
  const home = typeof process.env.DSH_HOME === 'string' ? process.env.DSH_HOME.trim() : ''
  const profileName = typeof process.env.DSH_PROFILE_NAME === 'string' && process.env.DSH_PROFILE_NAME.trim() !== ''
    ? process.env.DSH_PROFILE_NAME.trim()
    : 'desktop'
  return home === '' ? null : join(home, 'profiles', profileName)
}

/**
 * Provide `desktopProfiles` and `desktopPnpm` on the host context before the
 * market mounts. The market reads `desktopProfiles` inside its
 * `inject(['webServer','loader'])` callback and, when present, injects
 * `desktopPnpm` and routes every add/remove through it.
 * @param ctx - the plugin context (host plane).
 */
export function apply(ctx) {
  const profileContext = ctx.get('profileContext')
  const dir = resolveProfileDir(profileContext)
  if (dir === null) {
    console.warn(`${LOG_PREFIX} harmony-plugin-market-runtime: no profile directory; market install channel unavailable`)
    return
  }
  const profileName = profileContext && typeof profileContext.name === 'string' && profileContext.name.trim() !== ''
    ? profileContext.name.trim()
    : 'desktop'

  ctx.provide('desktopProfiles', { current: { name: profileName, dir } })

  ctx.provide('desktopPnpm', {
    /**
     * Run one pnpm command in-process, per the market's `DesktopPnpmLike`.
     * @param args - pnpm argv, e.g. `['add', '-w', 'pkg@1.2.3']`.
     * @param _invokingDir - the market's invoking directory (unused; the profile dir is authoritative).
     * @param signal - the market's abort signal.
     * @returns `{ stdout, stderr, done, cancel }`.
     */
    runPlugin(args, _invokingDir, signal) {
      const argv = Array.isArray(args) ? args.map(value => String(value)) : []
      return runPnpmInProcess(argv, { dir, signal })
    },
  })

  const engine = resolveEngineEntry()
  console.warn(`${LOG_PREFIX} harmony-plugin-market-runtime: desktopProfiles/desktopPnpm provided (profile=${profileName} dir=${dir} engine=${engine ?? '(unset)'} engineOk=${assertPnpmEngine(engine)})`)

  // --inspect (CDP Runtime.evaluate) diagnostic probe (FR-012-023).
  try {
    globalThis.__marketRuntimePnpm = {
      profile: profileName,
      profileDir: dir,
      engineEntry: engine,
      engineOk: assertPnpmEngine(engine),
    }
  } catch {
    // A frozen global object is not worth failing startup over.
  }
}
