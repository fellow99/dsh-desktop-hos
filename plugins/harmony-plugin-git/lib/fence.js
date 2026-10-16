/**
 * The repository fence: the single decision point that decides whether one git operation may
 * touch a given repository, and the escalation ladder that lets a user approve an exception.
 *
 * The vocabulary, the strictly-wider ladder, and the fail-closed approval sequence belong to
 * `@deepseek-ai/dsh-sandbox`; this module only adapts them to the git tool family, mirroring
 * `harmony-plugin-fs-mutate`'s `FsMutationSandbox` so every file-effect family in this shell
 * escalates identically and a denial reads the same to the model.
 *
 * Why the fence is needed at all: the vendored git implementation writes through
 * `node:fs`, so `fs-sandbox`'s per-call `checkedTarget` never sees those writes. The
 * containment check therefore happens once, on the repository root, before any I/O:
 *
 * > a repository inside the session workspace runs freely; a repository outside it is refused
 * > with the shared denial marker until the user approves a one-shot escalation.
 *
 * See `docs/204-插件-GIT.md` §8 — the narrowed fence is an accepted, documented trade-off.
 *
 * @module harmony-plugin-git/fence
 */

import { FsError } from '@deepseek-ai/dsh-fs'
import {
  ESCALATION_TARGETS,
  approveEscalation,
  canonicalPath,
  escalationHintMarker,
  sandboxDenialMarker,
  validateEscalationArgs,
} from '@deepseek-ai/dsh-sandbox'
import { createRepositoryFs, isWithin } from './fs-adapter.js'

/** A path segment that traverses to a parent, in either separator dialect. */
const PARENT_PATH_SEGMENT = /(?:^|[\\/])\.\.(?:[\\/]|$)/

/**
 * The calling agent's per-session workspace cwd, or `undefined` for an agent-less call (the
 * backend then applies its own default).
 * @param exec - the tool-execution context; only its optional `agent` is read.
 * @param requestedPath - the path the provider will resolve; parent traversal makes a
 *   symlinked cwd's filesystem identity observable.
 * @returns the session cwd, canonicalized only on that traversal case.
 */
function sessionCwd(exec, requestedPath) {
  const cwd = exec.agent?.session.header.cwd
  if (cwd === undefined || (!PARENT_PATH_SEGMENT.test(cwd) && !PARENT_PATH_SEGMENT.test(requestedPath))) return cwd
  return canonicalPath(cwd)
}

/**
 * An opened repository: its root, the policy the call runs under, and the confined `fs`
 * adapter every isomorphic-git call for this tool invocation must use.
 * @typedef {object} OpenedRepository
 * @property {string} root - absolute repository root in the host process's filesystem.
 * @property {object} fs - the `fs` object handed to isomorphic-git, confined to `root`.
 * @property {object | undefined} policy - the sandbox policy stamped on the call, when a confining backend is mounted.
 */

/**
 * The escalation API for the git tools: advertisement gating, per-call policy resolution, the
 * one-approved wider retry, denial-marker mapping, and repository-root vetting.
 */
export class GitRepositoryFence {
  /** @param ctx - the plugin context; `ctx.fs` decides whether escalation is advertised. */
  constructor(ctx) {
    this.ctx = ctx
    const defaultMode = ctx.fs.sandboxMode
    // The targets are the closed vocabulary, not "what is wider than the deployment default":
    // a session switched below that default would otherwise be confined with no advertised lever.
    this.escalationModes = defaultMode === undefined ? [] : ESCALATION_TARGETS
    // `ctx.get` rather than the property proxy: this plugin does not inject `sandboxPolicy`,
    // and the proxy is topology-sensitive.
    this.policy = defaultMode === undefined ? undefined : ctx.get('sandboxPolicy')
    if (defaultMode !== undefined && this.policy === undefined) {
      throw new Error('harmony-plugin-git: the mounted filesystem confines but ctx.sandboxPolicy is missing')
    }
  }

  /**
   * The escalation parameter specs, or `{}` when no confining backend is mounted.
   *
   * Advertised on **every** repository-touching tool rather than on a hand-picked "write" list:
   * read-shaped operations (`status` refreshes the index, `fetch` writes objects) mutate `.git`
   * too, and a per-tool judgment call that misses one would leave a tool that can never be
   * granted the access it needs.
   * @returns the two parameter specs to spread into a tool's `parameters`.
   */
  escalationFields() {
    if (this.escalationModes.length === 0) return {}
    return {
      sandbox_permissions: {
        type: 'string',
        enum: [...this.escalationModes],
        description: 'The wider sandbox mode this git operation needs. Only valid as a one-shot retry '
          + 'of an operation the sandbox just denied; requires justification and user approval.',
      },
      justification: {
        type: 'string',
        description: 'Required with sandbox_permissions: one sentence for the user explaining '
          + 'why this git operation needs a repository outside the session workspace.',
      },
    }
  }

  /**
   * The policy to stamp onto this call: an approved escalation grant (a strictly wider mode
   * resolved through the approval channel BEFORE anything executes), else the session's
   * standing mode.
   * @param toolName - the calling tool's name, for the approval audit trail.
   * @param args - the call's escalation arguments.
   * @param exec - the tool-execution context (agent, callId, signal).
   * @returns the policy for this call, or `undefined` for an unsandboxed backend.
   */
  async resolvePolicy(toolName, args, exec) {
    validateEscalationArgs(args.sandbox_permissions, args.justification)
    const standingPolicy = this.policy?.resolve(exec.agent === undefined ? {} : { session: exec.agent.session })
    if (args.sandbox_permissions === undefined || args.justification === undefined) return standingPolicy
    if (this.escalationModes.length === 0) {
      throw new Error('sandbox_permissions is not available in this composition (no sandboxing filesystem to escalate)')
    }
    const approvedMode = await approveEscalation(
      {
        requestedMode: args.sandbox_permissions,
        justification: args.justification,
        effectiveMode: standingPolicy.mode,
        subject: 'operation',
      },
      {
        approver: this.ctx.get('approval'),
        agent: exec.agent,
        callId: exec.callId,
        toolName,
        signal: exec.signal,
      },
    )
    return { ...standingPolicy, mode: approvedMode }
  }

  /**
   * Map a thrown provider error for the model. A `FS_SANDBOX_DENIED` becomes an `FsError`
   * whose text is the shared `[sandbox: …]` denial marker plus the same-turn escalation hint,
   * so the model can retry with the fields the tools advertise; the structured code is
   * preserved because `ToolRuntime` populates `result.error` only for `HarnessError` instances.
   * @param error - the error thrown by an operation.
   * @param policy - the policy stamped onto the call; names the mode in the marker.
   * @returns the marker `FsError` for a sandbox denial, else the original error.
   */
  mapError(error, policy) {
    if (!(error instanceof FsError) || error.code !== 'FS_SANDBOX_DENIED') return error
    return new FsError(
      `${sandboxDenialMarker(policy.mode)}\n${escalationHintMarker('operation')}`,
      'FS_SANDBOX_DENIED',
      { cause: error },
    )
  }

  /**
   * Vet a requested repository directory and open it for this call.
   *
   * Resolution goes through `ctx.fs` so the path means the same thing it means everywhere else
   * in dsh (session cwd, backend identity), and `processPath` yields the absolute path
   * `node:fs` can open in this process. Containment is then decided against the workspace root
   * the policy names — or skipped entirely under `danger-full-access`, which is exactly what an
   * approved escalation grants.
   *
   * @param toolName - the calling tool's name, for the approval audit trail.
   * @param args - the call's escalation arguments.
   * @param exec - the tool-execution context.
   * @param requestedDir - the directory the model named.
   * @returns the opened repository.
   * @throws FsError with code `FS_SANDBOX_DENIED` when a confining backend denies the root.
   */
  async open(toolName, args, exec, requestedDir) {
    const policy = await this.resolvePolicy(toolName, args, exec)
    const cwd = policy?.workspaceRoot ?? sessionCwd(exec, requestedDir)
    const target = await this.ctx.fs.resolve(requestedDir, {
      ...cwd === undefined ? {} : { cwd },
      signal: exec.signal,
    })
    const root = this.ctx.fs.processPath(target)

    if (policy !== undefined && policy.mode !== 'danger-full-access' && !isWithin(policy.workspaceRoot, root)) {
      throw new FsError(
        `harmony-plugin-git: the repository "${root}" is outside the session workspace `
        + `"${policy.workspaceRoot}", so this git operation was refused.`,
        'FS_SANDBOX_DENIED',
      )
    }

    return { root, fs: createRepositoryFs(root), policy }
  }
}
