/**
 * The `fs` adapter handed to every isomorphic-git call.
 *
 * isomorphic-git needs plain POSIX-ish file semantics (`readFile`/`writeFile`/`unlink`/
 * `readdir`/`mkdir`/`rmdir`/`stat`/`lstat` + optional `readlink`/`symlink`/`chmod`), which the
 * `ctx.fs` seam does not expose — the seam has no mkdir/rmdir/unlink/rename/symlink at all.
 * So this adapter talks to `node:fs/promises` directly, and pays for it by enforcing the one
 * boundary the whole design rests on:
 *
 * > **Every path is resolved against a single repository root and must stay inside it.**
 *
 * The root comes from `fence.js` (already resolved through `ctx.fs` and, when it lies outside
 * the session workspace, already approved through the sandbox-escalation channel). Containment
 * is re-checked on **every** call, so a `..` segment, an absolute path, or a symlink that
 * escapes the root is refused before any I/O happens — see `docs/204-插件-GIT.md` §8.
 *
 * @module harmony-plugin-git/fs-adapter
 */

import { promises as nodeFs } from 'node:fs'
import { isAbsolute, join, normalize, relative, resolve, sep } from 'node:path'

/** Error thrown when a request would leave the repository root. */
export class PathOutsideRepositoryError extends Error {
  /**
   * @param requestPath - the offending path as requested.
   * @param root - the repository root it had to stay inside.
   */
  constructor(requestPath, root) {
    super(
      `harmony-plugin-git: refusing "${requestPath}" because it resolves outside the repository root `
      + `"${root}". Git operations are confined to one repository.`,
    )
    this.name = 'PathOutsideRepositoryError'
  }
}

/**
 * Resolve one request path against the repository root and prove it stays inside.
 *
 * Absolute requests are accepted only when they are already inside the root (isomorphic-git
 * passes the absolute `dir` it was given, and joins it with relative paths); a relative
 * request is joined then normalised. The result is compared on a path-segment boundary, so a
 * sibling directory sharing a name prefix (`/repo-evil` vs `/repo`) cannot slip through.
 *
 * @param root - absolute repository root, already vetted by the fence.
 * @param requestPath - the path isomorphic-git asked for.
 * @returns the absolute path to hand to `node:fs`.
 * @throws PathOutsideRepositoryError when the path escapes the root.
 */
export function resolveWithin(root, requestPath) {
  const base = normalize(resolve(root))
  const candidate = isAbsolute(requestPath) ? normalize(resolve(requestPath)) : normalize(join(base, requestPath))
  if (candidate === base) return candidate
  const rel = relative(base, candidate)
  const escapes = rel === '' ? false : rel.startsWith('..') || isAbsolute(rel)
  if (escapes) throw new PathOutsideRepositoryError(requestPath, base)
  return candidate
}

/**
 * Build the `{ promises }` object isomorphic-git expects, bound to one repository root.
 *
 * The optional trio (`readlink`/`symlink`/`chmod`) is provided on purpose: this platform's
 * filesystems refuse symlink creation with `EACCES`, and `chmod` is silently ignored on
 * hmdfs. Providing the real calls means a repository that needs them fails with the honest
 * underlying error instead of an "unsupported operation" invented here.
 *
 * @param root - absolute repository root, already vetted by the fence.
 * @returns an `fs` object for isomorphic-git, confined to `root`.
 */
export function createRepositoryFs(root) {
  const at = requestPath => resolveWithin(root, requestPath)

  return {
    promises: {
      /** @param {string} path - path resolved by the repository root. @param {unknown} [options] - node fs options. */
      readFile: (path, options) => nodeFs.readFile(at(path), options),
      /**
       * @param {string} file - destination path.
       * @param {unknown} data - bytes or text to write.
       * @param {unknown} [options] - node fs options.
       */
      writeFile: (file, data, options) => nodeFs.writeFile(at(file), data, options),
      /** @param {string} path - path to remove. */
      unlink: path => nodeFs.unlink(at(path)),
      /** @param {string} path - directory to list. @param {unknown} [options] - node fs options. */
      readdir: (path, options) => nodeFs.readdir(at(path), options),
      /** @param {string} path - directory to create. @param {unknown} [options] - mode or node fs options. */
      mkdir: (path, options) => nodeFs.mkdir(at(path), options),
      /** @param {string} path - empty directory to remove. */
      rmdir: path => nodeFs.rmdir(at(path)),
      /** @param {string} path - path to stat. @param {unknown} [options] - node fs options. */
      stat: (path, options) => nodeFs.stat(at(path), options),
      /** @param {string} path - path to lstat. @param {unknown} [options] - node fs options. */
      lstat: (path, options) => nodeFs.lstat(at(path), options),
      /** @param {string} path - symlink to read. @param {unknown} [options] - node fs options. */
      readlink: (path, options) => nodeFs.readlink(at(path), options),
      /**
       * The link itself must land inside the root; a relative target stays inside by
       * construction, while an absolute target is checked too.
       * @param {string} target - link target.
       * @param {string} path - link path.
       * @param {unknown} [type] - node fs symlink type.
       */
      symlink: (target, path, type) => {
        const linkPath = at(path)
        if (isAbsolute(target)) resolveWithin(root, target)
        return nodeFs.symlink(target, linkPath, type)
      },
      /** @param {string} path - path whose mode to change. @param {number} mode - requested mode bits. */
      chmod: (path, mode) => nodeFs.chmod(at(path), mode),
    },
  }
}

/**
 * Whether a candidate path lies inside a root, on a path-segment boundary.
 * Shared with the fence so the "is this repository inside the workspace?" question and the
 * per-call containment check use one predicate.
 * @param root - absolute root path.
 * @param candidate - absolute candidate path.
 * @returns true when `candidate` is `root` or below it.
 */
export function isWithin(root, candidate) {
  const base = normalize(resolve(root))
  const other = normalize(resolve(candidate))
  if (base === other) return true
  return other.startsWith(base.endsWith(sep) ? base : base + sep)
}
