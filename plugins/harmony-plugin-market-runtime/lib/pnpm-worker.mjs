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
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'

/** Post one captured output chunk, tolerating a closed port. */
function post(type, text) {
  try { parentPort.postMessage({ type, text }) } catch { /* port closed during teardown */ }
}

const entry = workerData.entry
const argv = Array.isArray(workerData.args) ? workerData.args : []

// Dynamic import needs a URL for an absolute Windows path.
const entryUrl = typeof entry === 'string' && entry.startsWith('file:') ? entry : pathToFileURL(String(entry)).href

// Electron's `process.execPath` is a read-only property, but pnpm's CLI assigns
// it during startup ("Cannot assign to read only property 'execPath'"). A no-op
// setter keeps the real value and lets pnpm continue. Verified on device.
try {
  const realExecPath = process.execPath
  Object.defineProperty(process, 'execPath', { configurable: true, get: () => realExecPath, set: () => {} })
} catch (error) {
  post('stderr', `\n[harmony-pnpm] execPath workaround failed: ${error && error.message ? error.message : error}\n`)
}

// pnpm's CLI reads process.argv; the second element is ignored by it.
process.argv = [process.execPath, entry, ...argv]

// HarmonyOS forbids symlink (EACCES/EPERM), but pnpm creates symlinks in
// `node_modules/.bin` for every dependency binary during install. Fall back to
// copying the (tiny) target instead. Verified on device: the bin lands as a
// real file and the install completes. Scoped to symlink only; hoisted + copy
// means no other symlinks are created.
const LINK_ERROR_CODES = new Set(['EACCES', 'EPERM', 'ENOSYS', 'EINVAL'])

/** Whether an fs error is the platform refusing a symlink. */
function isLinkError(error) {
  return Boolean(error) && LINK_ERROR_CODES.has(error.code)
}

/** Resolve a (possibly relative) link target against its link path. */
function resolveLinkTarget(target, linkPath) {
  const value = String(target)
  return path.isAbsolute(value) ? value : path.resolve(path.dirname(String(linkPath)), value)
}

/** Create a real file/dir copy where a symlink was requested. */
function copyInsteadOfLink(target, linkPath) {
  const source = resolveLinkTarget(target, linkPath)
  const stat = fs.statSync(source)
  if (stat.isDirectory()) fs.cpSync(source, linkPath, { recursive: true })
  else {
    fs.copyFileSync(source, linkPath)
    try { fs.chmodSync(linkPath, 0o755) } catch { /* executable bit is not required for plugin installs */ }
  }
}

/** Patch `fs`/`fs.promises` symlink to fall back to a copy. */
function patchSymlink() {
  const originalPromise = fsp.symlink
  const patchedPromise = async (target, linkPath, type) => {
    try { return await originalPromise(target, linkPath, type) } catch (error) {
      if (isLinkError(error)) { copyInsteadOfLink(target, linkPath); return }
      throw error
    }
  }
  const originalSync = fs.symlinkSync
  const patchedSync = (target, linkPath, type) => {
    try { return originalSync.call(fs, target, linkPath, type) } catch (error) {
      if (isLinkError(error)) { copyInsteadOfLink(target, linkPath); return }
      throw error
    }
  }
  const define = (object, name, value) => {
    if (object === undefined || object === null) return
    try { Object.defineProperty(object, name, { value, configurable: true, writable: true }) } catch {
      try { object[name] = value } catch { /* left unpatched; the install surfaces the original error */ }
    }
  }
  define(fsp, 'symlink', patchedPromise)
  if (fs.promises !== fsp) define(fs.promises, 'symlink', patchedPromise)
  define(fs, 'symlinkSync', patchedSync)
}

patchSymlink()

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
