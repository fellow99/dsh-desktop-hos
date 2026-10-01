/**
 * Worker entry: import the materialized pnpm CLI bundle with a synthetic
 * `process.argv`, in a worker thread.
 *
 * Why a worker (see `docs/pnpm对接问题排查.md` §11 and the 012 spike findings):
 * pnpm's `dist/pnpm.mjs` is a fire-and-forget CLI - importing it resolves long
 * before the install finishes and it never calls `process.exit` on success, so
 * a direct in-process import cannot report completion. In a worker thread the
 * pnpm operation's pending work keeps the worker alive; when it drains the
 * worker exits with pnpm's exit code, which is the completion signal.
 *
 * The worker also isolates pnpm's global mutations (`process.argv`,
 * `process.exit`, cwd) from the Electron main process.
 *
 * @module harmony-plugin-market-runtime/pnpm-worker
 */
import { parentPort, workerData } from 'node:worker_threads'
import { pathToFileURL } from 'node:url'

/** Post one captured output chunk, tolerating a closed port. */
function post(type, text) {
  try { parentPort.postMessage({ type, text }) } catch { /* port closed during teardown */ }
}

const entry = workerData.entry
const argv = Array.isArray(workerData.args) ? workerData.args : []

// Dynamic import needs a URL for an absolute Windows path.
const entryUrl = typeof entry === 'string' && entry.startsWith('file:') ? entry : pathToFileURL(String(entry)).href

// pnpm's CLI reads process.argv; the second element is ignored by it.
process.argv = [process.execPath, entry, ...argv]

// Tee stdout/stderr into messages so the parent can stream them to the market.
process.stdout.write = (chunk, encoding, callback) => {
  post('stdout', String(chunk))
  const cb = typeof encoding === 'function' ? encoding : callback
  if (typeof cb === 'function') cb()
  return true
}
process.stderr.write = (chunk, encoding, callback) => {
  post('stderr', String(chunk))
  const cb = typeof encoding === 'function' ? encoding : callback
  if (typeof cb === 'function') cb()
  return true
}

try {
  await import(entryUrl)
} catch (error) {
  post('stderr', `\n[harmony-pnpm] pnpm engine import failed: ${error && error.stack ? error.stack : error}\n`)
  process.exitCode = 1
}
// Falling off the end lets the worker exit once pnpm's own pending work drains;
// a pnpm `process.exit()` exits only this worker, never the Electron process.
