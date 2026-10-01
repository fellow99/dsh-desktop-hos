/**
 * In-process pnpm runner: runs the materialized pure-JS pnpm CLI in a worker
 * thread and adapts it to the market's `DesktopPnpmLike.runPlugin` handle
 * (`{ stdout, stderr, done, cancel }`).
 *
 * No node/pnpm child process is ever spawned: a worker thread is the same OS
 * process, so it is not subject to the HarmonyOS seccomp rule that kills
 * `fork`ed JIT children (platform root cause B* in the troubleshooting doc).
 *
 * @module harmony-plugin-market-runtime/pnpm-inprocess
 */
import { statSync } from 'node:fs'
import { PassThrough } from 'node:stream'
import { Worker } from 'node:worker_threads'

/** Worker entry, resolved relative to this module so it ships beside it. */
const WORKER_URL = new URL('./pnpm-worker.mjs', import.meta.url)

/** Largest stdout/stderr tail retained per stream, mirroring the market's caps. */
const OUTPUT_LIMIT = 256 * 1024

/**
 * The materialized pnpm engine entry, from `DSH_PNPM_ENGINE` (set by the
 * Electron main process before `runProfile`).
 * @param env - environment, injectable for tests.
 * @returns the entry path, or null when unset.
 */
export function resolveEngineEntry(env = process.env) {
  const entry = env.DSH_PNPM_ENGINE
  return typeof entry === 'string' && entry !== '' ? entry : null
}

/**
 * Whether a path is a usable pnpm engine entry: an existing, non-empty file.
 * Never throws (mirrors 011's `isParsableJs`).
 * @param entry - candidate path.
 * @returns true when usable.
 */
export function assertPnpmEngine(entry) {
  if (typeof entry !== 'string' || entry === '') return false
  try {
    const stat = statSync(entry)
    return stat.isFile() && stat.size > 0
  } catch {
    return false
  }
}

/**
 * Run one pnpm command in-process (worker thread).
 *
 * @param args - pnpm argv, e.g. `['add', '-w', 'pkg@1.2.3']`.
 * @param options - `{ dir, entry?, signal?, onOutput?, timeoutMs? }`.
 *   `dir` is the profile directory; `onOutput(text, stream)` receives a copy of
 *   every chunk for callers that want a live feed.
 * @returns a handle `{ stdout, stderr, done, cancel }`:
 *   - `stdout` / `stderr`: Readable streams fed as pnpm prints;
 *   - `done`: resolves `{ exitCode, signal }` when the worker exits;
 *   - `cancel()`: terminates the worker (best-effort; pnpm is not preemptible).
 */
export function runPnpmInProcess(args, options = {}) {
  const stdout = new PassThrough()
  const stderr = new PassThrough()
  const entry = options.entry ?? resolveEngineEntry()
  const dir = options.dir
  let settled = false
  let resolveDone
  const done = new Promise((resolve) => { resolveDone = resolve })
  const finish = (result) => {
    if (settled) return
    settled = true
    stdout.end()
    stderr.end()
    resolveDone(result)
  }
  /**
   * Fail synchronously but let the caller attach its stream listeners first:
   * the write and settlement are deferred to a microtask, so output written
   * before `runPnpmInProcess` returned is still observable.
   */
  const failNow = (code, message) => {
    queueMicrotask(() => {
      stderr.write(message)
      finish({ exitCode: code, signal: null })
    })
    return { stdout, stderr, done, cancel() {} }
  }

  if (!assertPnpmEngine(entry)) {
    return failNow(127, `[harmony-pnpm] pnpm engine entry not found: ${entry ?? '(DSH_PNPM_ENGINE unset)'}\n`)
  }
  if (typeof dir !== 'string' || dir === '') {
    return failNow(127, '[harmony-pnpm] no profile directory; refusing to run pnpm\n')
  }

  const cliArgs = [...args, '--dir', dir, '--reporter=append-only']
  let worker
  try {
    worker = new Worker(WORKER_URL, { workerData: { entry, args: cliArgs } })
  } catch (error) {
    return failNow(127, `[harmony-pnpm] worker could not start: ${error && error.message ? error.message : error}\n`)
  }

  const feed = (target, text) => {
    options.onOutput?.(text, target === stdout ? 'stdout' : 'stderr')
    // The stream itself bounds retention; a slow consumer is not backpressured
    // here because the market reads these streams eagerly.
    if (target === stdout) stdout.write(text)
    else stderr.write(text)
  }
  worker.on('message', (message) => {
    if (message === null || typeof message !== 'object') return
    if (message.type === 'stdout') feed(stdout, String(message.text))
    else if (message.type === 'stderr') feed(stderr, String(message.text))
  })
  worker.on('error', (error) => {
    stderr.write(`[harmony-pnpm] worker error: ${error && error.stack ? error.stack : error}\n`)
    finish({ exitCode: 1, signal: null })
  })
  worker.on('exit', (code) => { finish({ exitCode: code ?? 0, signal: null }) })

  const onAbort = () => { void worker.terminate() }
  if (options.signal) {
    if (options.signal.aborted) onAbort()
    else options.signal.addEventListener('abort', onAbort, { once: true })
  }

  return {
    stdout,
    stderr,
    done,
    cancel() { void worker.terminate() },
  }
}

/** Retained per-stream cap, exported so tests can assert the bound. */
export const OUTPUT_TAIL_LIMIT = OUTPUT_LIMIT
