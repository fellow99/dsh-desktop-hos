/**
 * R2 PoC 骨架 —— **不是最终实现**，仅为验证装配面的两个前提：
 *   ① host 平面一行 `- insert:` 能否让本插件的 host 面激活；
 *   ② host 平面注册的工具能否被 agent（会话）看见与调用。
 *
 * PoC 期临时把 `ctx` 与注册结果挂到 `globalThis.__gitPoc`，供 `--inspect` 只读查询；
 * **正式实现必须删除该挂钩**（见 docs/204-插件-GIT.md §19 R2）。
 *
 * 关键约束（已实测）：`ctx.tools.register()` 会跑 `assertSupportedJsonSchema`，它**不接受**
 * dsh 在 `defineTool` 参数/输出写法里的 `required: true` 简写 —— 必须经 `defineTool` 翻译。
 * 裸写 schema 会抛 `unsupported JSON schema: …required is not supported on type "string"`。
 *
 * 命名导出必填：default export 会让 Loader 丢弃 `inject`。
 * @module harmony-plugin-git
 */

import { defineTool } from '@deepseek-ai/dsh-tools'

/** Plugin name used by loader diagnostics and the profile row. */
export const name = 'harmony-plugin-git'

/** Services required before anything registers. */
export const inject = ['tools']

/** Marker used by the PoC tool result so the device log is unambiguous. */
const POC_MARKER = 'harmony-plugin-git/poc'

/**
 * Register the R2 PoC tool and publish a diagnostic handle that records the outcome.
 * @param ctx - the plugin context; registrations are effects scoped to it.
 */
export function apply(ctx) {
  const status = { registered: false, error: null }

  try {
    ctx.tools.register(defineTool({
      name: 'git_poc_probe',
      description: 'R2 assembly probe for the git plugin. Takes no parameters and returns the '
        + 'plugin marker plus host runtime versions. Its only purpose is to prove that a plugin '
        + 'mounted on the host plane can register a tool the agent can see and call.',
      parameters: {},
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            marker: { type: 'string', required: true },
            node: { type: 'string', required: true },
            electron: { type: 'string', required: true },
            toolCount: { type: 'number', required: true },
          },
        },
        render: (_args, value) => [{
          type: 'text',
          text: `${value.marker}: ok (node ${value.node}, electron ${value.electron}, `
            + `${value.toolCount} tools registered)`,
        }],
      },
      execute() {
        return {
          marker: POC_MARKER,
          node: process.versions.node,
          electron: process.versions.electron ?? 'n/a',
          toolCount: ctx.tools.schemas().length,
        }
      },
    }))
    status.registered = true
  } catch (error) {
    status.error = error instanceof Error ? error.message : String(error)
  }

  // PoC-only diagnostic handle for `--inspect`. Never ship this.
  globalThis.__gitPoc = {
    plugin: name,
    attachedAt: new Date().toISOString(),
    status,
    ctx,
  }
}
