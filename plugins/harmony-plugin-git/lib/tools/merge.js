/**
 * The model-facing `git_merge` tool.
 *
 * `abortOnConflict` stays at its default `true` (see `docs/204-插件-GIT.md` §13): when a merge
 * conflicts, nothing is written to the working tree or the index, and the tool throws an error
 * that names every conflicting path plus `abort: true` as the way out. Merging is never retried
 * and conflicts are never resolved automatically.
 *
 * @module harmony-plugin-git/tools/merge
 */

import { defineTool } from '@deepseek-ai/dsh-tools'
import { loadGit } from '../runtime.js'
import { renderConflicts, renderMergeResult } from '../report.js'
import { resolveIdentity, resolveRevision } from './commit.js'

/**
 * Turn a thrown merge error into the message the model should read, keeping the conflict paths.
 * @param {unknown} error - the error the merge threw.
 * @param {object} deps - the tool dependencies (used for fence error mapping).
 * @param {object | undefined} policy - the policy stamped onto the call.
 * @param {object} args - the call's escalation arguments.
 * @param {object} exec - the tool-execution context.
 * @returns the error to throw.
 */
async function mapMergeError(error, deps, policy, args, exec) {
  const filepaths = error instanceof Error && Array.isArray(error.data?.filepaths)
    ? error.data.filepaths
    : undefined
  if (error instanceof Error && error.code === 'MergeConflictError' && filepaths !== undefined) {
    return new Error(`${renderConflicts(filepaths, {
      reason: `Merge refused: ${filepaths.length} conflicting path(s). Nothing was written to the working tree or `
        + 'the index.',
      next: 'Resolve by merging one side manually (git_checkout a ref, git_add, git_commit), or retry the merge '
        + 'with abort: true once a conflicted merge is in progress.',
    })}`)
  }
  return deps.fence.mapError(error, policy ?? await deps.fence.resolvePolicy('git_merge', args, exec))
}

/**
 * Register the `git_merge` tool.
 * @param ctx - the plugin context; `ctx.tools` receives the registration.
 * @param deps - shared collaborators.
 * @param {import('../fence.js').GitRepositoryFence} deps.fence - the repository fence.
 * @param {object} deps.config - the resolved plugin config.
 */
export function applyGitMergeTool(ctx, deps) {
  ctx.tools.register(defineTool({
    name: 'git_merge',
    description: 'Merge `theirs` (a branch, tag or commit id) into the checked-out branch. By default a '
      + 'fast-forward is taken when possible; `fastForward: false` forces a merge commit, and `fastForwardOnly: '
      + 'true` refuses anything that is not a fast-forward instead of creating one. `dryRun: true` reports what '
      + 'would happen without writing anything. A conflict makes the call fail and lists the conflicting paths: '
      + 'the working tree and index are left untouched (abortOnConflict stays on), so nothing is lost. `abort: '
      + 'true` aborts a merge in progress and restores the pre-merge state. The commit identity comes from '
      + '`authorName`/`authorEmail`, else this repository\'s user.name/user.email, else the plugin defaults. Fails '
      + 'when `theirs` cannot be resolved or `dir` is not a repository; a `dir` outside the session workspace is '
      + 'refused with an escalation hint.',
    parameters: {
      dir: {
        type: 'string',
        required: true,
        description: 'Repository root. Resolved against the session workspace; outside it the call is refused '
          + 'until a one-shot escalation is approved.',
      },
      theirs: {
        type: 'string',
        description: 'The branch, tag or commit to merge into the checked-out branch. Required unless `abort` is true.',
      },
      fastForward: {
        type: 'boolean',
        description: 'Allow a fast-forward (the default). Set false to always create a merge commit.',
      },
      fastForwardOnly: {
        type: 'boolean',
        description: 'Refuse a merge that would need a merge commit instead of taking the fast-forward path.',
      },
      dryRun: {
        type: 'boolean',
        description: 'Report the outcome without writing anything. Defaults to false.',
      },
      abort: {
        type: 'boolean',
        description: 'Abort an in-progress conflicted merge and restore the pre-merge index and working tree.',
      },
      message: { type: 'string', description: 'Overrides the auto-generated merge commit message.' },
      authorName: { type: 'string', description: 'Author/committer name for the merge commit.' },
      authorEmail: { type: 'string', description: 'Author/committer email for the merge commit.' },
      ...deps.fence.escalationFields(),
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          root: { type: 'string', required: true },
          theirs: { type: 'string', required: true },
          aborted: { type: 'boolean', required: true },
          oid: { type: 'string', required: true },
          alreadyMerged: { type: 'boolean', required: true },
          fastForward: { type: 'boolean', required: true },
          mergeCommit: { type: 'boolean', required: true },
          tree: { type: 'string', required: true },
          base: { type: 'string', required: true },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: value.aborted
          ? `Aborted the merge in progress in ${value.root}: the index and the working tree were restored, and `
            + `HEAD is back at ${value.oid}.`
          : `${renderMergeResult({
            alreadyMerged: value.alreadyMerged,
            fastForward: value.fastForward,
            oid: value.oid,
            tree: value.tree,
          })}${value.base === '' ? '' : `\nMerge base: ${value.base}`}`,
      }],
    },
    async execute(args, exec) {
      let policy
      try {
        const opened = await deps.fence.open('git_merge', args, exec, args.dir)
        policy = opened.policy
        const { git } = await loadGit()
        const fs = opened.fs
        const dir = opened.root

        if (args.abort === true) {
          await git.abortMerge({ fs, dir, signal: exec.signal })
          const oid = await git.resolveRef({ fs, dir, ref: 'HEAD' })
          return {
            root: dir,
            theirs: args.theirs ?? '',
            aborted: true,
            oid,
            alreadyMerged: false,
            fastForward: false,
            mergeCommit: false,
            tree: '',
            base: '',
          }
        }

        if (args.theirs === undefined || args.theirs.trim() === '') {
          throw new Error('git_merge: theirs is required (the branch, tag or commit to merge in)')
        }
        const identity = await resolveIdentity(git, fs, dir, deps.config, args)
        const actor = { name: identity.name, email: identity.email }
        const theirs = (await resolveRevision(git, fs, dir, args.theirs)).ref
        const result = await git.merge({
          fs,
          dir,
          theirs,
          fastForward: args.fastForward !== false,
          fastForwardOnly: args.fastForwardOnly === true,
          dryRun: args.dryRun === true,
          // Conflicts leave the working tree alone; §13 wants a report, not a polluted tree.
          abortOnConflict: true,
          author: actor,
          committer: actor,
          ...args.message === undefined ? {} : { message: args.message },
          signal: exec.signal,
        })
        let base = ''
        try {
          const theirsOid = (await resolveRevision(git, fs, dir, args.theirs)).oid
          const oursOid = await git.resolveRef({ fs, dir, ref: 'HEAD' })
          base = (await git.findMergeBase({ fs, dir, oids: [oursOid, theirsOid], signal: exec.signal })) ?? ''
        } catch {
          // A merge base is extra context; failing to find one is not a merge failure.
          base = ''
        }
        return {
          root: dir,
          theirs: args.theirs,
          aborted: false,
          oid: result.oid ?? '',
          alreadyMerged: result.alreadyMerged === true,
          fastForward: result.fastForward === true,
          mergeCommit: result.mergeCommit === true,
          tree: result.tree ?? '',
          base,
        }
      } catch (error) {
        if (exec.signal.aborted) throw error
        throw await mapMergeError(error, deps, policy, args, exec)
      }
    },
  }))
}
