/**
 * Unit tests for the in-process pnpm runner.
 *
 * Uses a fake "engine" module (no network, no real pnpm) to exercise the
 * worker plumbing: output capture, exit-code propagation, missing-entry and
 * missing-directory handling. Real pnpm behavior is covered by the live spike
 * and the on-device test cases.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { runPnpmInProcess, resolveEngineEntry, assertPnpmEngine } from '../lib/pnpm-inprocess.js'

function makeTmp() {
  return mkdtempSync(join(tmpdir(), 'harmony-pnpm-test-'))
}

test('resolveEngineEntry reads DSH_PNPM_ENGINE or returns null', () => {
  assert.equal(resolveEngineEntry({ DSH_PNPM_ENGINE: '/x/y.mjs' }), '/x/y.mjs')
  assert.equal(resolveEngineEntry({}), null)
  assert.equal(resolveEngineEntry({ DSH_PNPM_ENGINE: '' }), null)
})

test('assertPnpmEngine is false for missing / empty and true for a real file', () => {
  const dir = makeTmp()
  try {
    assert.equal(assertPnpmEngine(join(dir, 'nope.mjs')), false)
    const empty = join(dir, 'empty.mjs')
    writeFileSync(empty, '')
    assert.equal(assertPnpmEngine(empty), false)
    const ok = join(dir, 'ok.mjs')
    writeFileSync(ok, 'export default 1\n')
    assert.equal(assertPnpmEngine(ok), true)
    assert.equal(assertPnpmEngine(null), false)
    assert.equal(assertPnpmEngine(123), false)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('runPnpmInProcess reports 127 when the engine entry is missing', async () => {
  const dir = makeTmp()
  try {
    const handle = runPnpmInProcess(['add', 'x'], { dir, entry: join(dir, 'missing.mjs') })
    let err = ''
    handle.stderr.on('data', (c) => { err += c.toString() })
    const result = await handle.done
    assert.equal(result.exitCode, 127)
    assert.match(err, /engine entry not found/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('runPnpmInProcess reports 127 when no directory is given', async () => {
  const dir = makeTmp()
  try {
    const engine = join(dir, 'engine.mjs')
    writeFileSync(engine, 'process.exitCode = 0\n')
    const handle = runPnpmInProcess(['add', 'x'], { entry: engine })
    const result = await handle.done
    assert.equal(result.exitCode, 127)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('runPnpmInProcess captures stdout/stderr and the worker exit code', async () => {
  const dir = makeTmp()
  try {
    const engine = join(dir, 'engine.mjs')
    writeFileSync(engine, [
      "process.stdout.write('fake-out\\n')",
      "process.stderr.write('fake-err\\n')",
      'process.exitCode = 0',
      '',
    ].join('\n'))
    const seen = []
    const handle = runPnpmInProcess(['add', 'x'], { dir, entry: engine, onOutput: (t, s) => seen.push([s, t]) })
    let out = ''
    let err = ''
    handle.stdout.on('data', (c) => { out += c.toString() })
    handle.stderr.on('data', (c) => { err += c.toString() })
    const result = await handle.done
    assert.equal(result.exitCode, 0)
    assert.match(out, /fake-out/)
    assert.match(err, /fake-err/)
    assert.ok(seen.some(([stream]) => stream === 'stdout'))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('runPnpmInProcess propagates a non-zero exit code', async () => {
  const dir = makeTmp()
  try {
    const engine = join(dir, 'engine.mjs')
    writeFileSync(engine, "process.stderr.write('boom\\n'); process.exitCode = 2\n")
    const handle = runPnpmInProcess(['add', 'x'], { dir, entry: engine })
    const result = await handle.done
    assert.equal(result.exitCode, 2)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('runPnpmInProcess forwards args and appends only --dir (never a reporter)', async () => {
  const dir = makeTmp()
  try {
    const engine = join(dir, 'engine.mjs')
    writeFileSync(engine, "process.stdout.write(JSON.stringify(process.argv.slice(2)) + '\\n'); process.exitCode = 0\n")
    // The market appends --reporter=ndjson itself; the runner must not override it.
    const handle = runPnpmInProcess(['add', '-w', 'pkg@1.2.3', '--reporter=ndjson'], { dir, entry: engine })
    let out = ''
    handle.stdout.on('data', (c) => { out += c.toString() })
    const result = await handle.done
    assert.equal(result.exitCode, 0)
    const argv = JSON.parse(out.trim().split(/\r?\n/).filter(Boolean).pop())
    assert.deepEqual(argv, ['add', '-w', 'pkg@1.2.3', '--reporter=ndjson', '--dir', dir])
    assert.equal(argv.filter((a) => a.startsWith('--reporter')).length, 1)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
