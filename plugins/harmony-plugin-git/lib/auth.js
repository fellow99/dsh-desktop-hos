/**
 * Credential lookup for `git` over HTTP(S).
 *
 * The client-reachable credential API in this product exposes **references only** — the remote
 * namespace serves `describe` / `set` / `unset` over `credentialRef` names and never returns a
 * stored value (see `docs/204-插件-GIT.md` §9 and its §2 note 9). So git credentials are stored
 * as ordinary credential references under a fixed, hand-writable name:
 *
 * ```
 * GIT_CREDENTIAL_<HOST>      value = "<username>:<password>"
 * ```
 *
 * where `<HOST>` is the URL's `host[:port]` upper-cased with every non-alphanumeric character
 * replaced by `_`. Because the name is derived from the remote and printed verbatim in the
 * settings page and in every failure message, a user can also write it straight into
 * `$DSH_HOME/.credentials.yaml`.
 *
 * The cleartext therefore only ever exists in this process's memory: no tool parameter carries
 * a credential, and nothing here logs or returns the value.
 *
 * @module harmony-plugin-git/auth
 */

import { credentialRef } from '@deepseek-ai/dsh-credentials'

/** Prefix of every git credential reference owned by this plugin. */
export const CREDENTIAL_REF_PREFIX = 'GIT_CREDENTIAL_'

/**
 * Turn a remote URL into the credential reference name that stores its credentials.
 * @param url - the remote URL git is about to contact.
 * @returns the reference name, or `undefined` when the URL carries no host.
 */
export function credentialRefForUrl(url) {
  let host
  try {
    host = new URL(url).host
  } catch {
    return undefined
  }
  if (host === '') return undefined
  return CREDENTIAL_REF_PREFIX + host.toUpperCase().replace(/[^A-Z0-9]/g, '_')
}

/**
 * Split a stored value into the two fields isomorphic-git's auth callback wants. The split is
 * on the **first** colon, so a password may contain colons.
 * @param value - the stored `<username>:<password>` value.
 * @returns the parsed pair, or `undefined` when the value carries no colon.
 */
export function parseCredentialValue(value) {
  const separator = value.indexOf(':')
  if (separator <= 0) return undefined
  return { username: value.slice(0, separator), password: value.slice(separator + 1) }
}

/**
 * Resolve credentials for one host, and shape the two messages a caller needs when it cannot.
 */
export class GitCredentials {
  /** @param ctx - the plugin context; `ctx.credentials` is the store this reads. */
  constructor(ctx) {
    this.ctx = ctx
  }

  /**
   * Look up the credentials stored for a remote URL.
   * @param url - the remote URL git is about to contact.
   * @returns the resolved pair, or `undefined` when nothing is stored or the value is unusable.
   */
  async lookup(url) {
    const name = credentialRefForUrl(url)
    if (name === undefined) return undefined
    const store = this.ctx.get('credentials')
    if (store === undefined) return undefined
    const hit = await store.resolve(credentialRef(name))
    if (hit === undefined || typeof hit.value !== 'string') return undefined
    return parseCredentialValue(hit.value)
  }

  /**
   * The message shown when a server demands credentials and none are stored. It names the exact
   * reference to create, so the remedy needs no guessing.
   * @param url - the remote URL that was refused.
   * @returns the model-facing explanation.
   */
  missingMessage(url) {
    const name = credentialRefForUrl(url)
    const where = name === undefined
      ? 'the credential store'
      : `the credential store under the name "${name}" (Settings → Git 凭据, or $DSH_HOME/.credentials.yaml)`
    return `harmony-plugin-git: this remote requires authentication and no credentials are configured for `
      + `"${url}". Add them to ${where} as "<username>:<password>".`
  }

  /**
   * The message shown when stored credentials were rejected.
   * @param url - the remote URL that refused them.
   * @returns the model-facing explanation.
   */
  rejectedMessage(url) {
    const name = credentialRefForUrl(url)
    return `harmony-plugin-git: the credentials configured for "${url}"`
      + `${name === undefined ? '' : ` (${name})`} were rejected by the server. `
      + 'Update them in Settings → Git 凭据, then retry.'
  }

  /**
   * Build isomorphic-git's auth callbacks for this family of tools.
   *
   * `onAuthFailure` deliberately allows **one** re-supply of the same stored credential and then
   * cancels: a wrong password must surface as a clear rejection instead of a retry loop against
   * the server. isomorphic-git calls `onAuth` again after `onAuthFailure` returns auth, so the
   * attempt is tracked here.
   *
   * @param url - the remote URL for this operation.
   * @returns the `onAuth` / `onAuthFailure` pair to spread into a git call.
   */
  callbacks(url) {
    let retried = false
    return {
      onAuth: async () => {
        const found = await this.lookup(url)
        if (found === undefined) return { cancel: true }
        return found
      },
      onAuthFailure: async () => {
        if (retried) return { cancel: true }
        retried = true
        const found = await this.lookup(url)
        if (found === undefined) return { cancel: true }
        return found
      },
    }
  }
}
