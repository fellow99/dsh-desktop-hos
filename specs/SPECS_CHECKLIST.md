# SPECS_CHECKLIST.md — 规格检查清单

> dsh-desktop-hos 规范文档完成情况追踪（2026-09-04；2026-11-01 按父工程编号规则整理）。

## 1. 项目级文档

| # | 文档 | 路径 | 状态 |
|---|---|---|---|
| P-01 | 目录结构 | [STRUCTURE.md](./STRUCTURE.md) | ✅ Done |
| P-02 | 技术选型 | [TECH.md](./TECH.md) | ✅ Done |
| P-03 | 整体架构 | [ARCHITECTURE.md](./ARCHITECTURE.md) | ✅ Done |
| P-04 | 宪法原则 | [constitution.md](./constitution.md) | ✅ Done |
| P-05 | 整体规格 | [overall-spec.md](./overall-spec.md) | ✅ Done |
| P-06 | 整体技术方案 | [overall-plan.md](./overall-plan.md) | ✅ Done |
| P-07 | 数据模型 | [overall-data-model.md](./overall-data-model.md) | ✅ Done |
| P-08 | 检查清单 | [SPECS_CHECKLIST.md](./SPECS_CHECKLIST.md) | ✅ Done |
| P-09 | 文档索引 | [README.md](./README.md) | ✅ Done |

> 注：按需求，不写 API.md、overall-api.md、overall-test-cases.md（数据面在 dsh 侧，本工程无自有 API 清单）。

## 2. 公共服务与基础模块

| # | 模块 | spec.md | plan.md | 状态 |
|---|---|---|---|---|
| M-01 | 013-branding（品牌化） | [013-branding/spec.md](./013-branding/spec.md) | [013-branding/plan.md](./013-branding/plan.md) | ✅ Done |
| M-02 | 101-runtime-launch-orchestration（运行时入口） | [101-runtime-launch-orchestration/spec.md](./101-runtime-launch-orchestration/spec.md) | [101-runtime-launch-orchestration/plan.md](./101-runtime-launch-orchestration/plan.md) | ✅ Done |
| M-03 | 102-payload-pipeline（产物解压引导） | [102-payload-pipeline/spec.md](./102-payload-pipeline/spec.md) | [102-payload-pipeline/plan.md](./102-payload-pipeline/plan.md) | ✅ Done |
| M-04 | 103-window-shell（窗口外壳） | [103-window-shell/spec.md](./103-window-shell/spec.md) | [103-window-shell/plan.md](./103-window-shell/plan.md) | ✅ Done |
| M-05 | 104-host-capability-bridge（宿主能力桥） | [104-host-capability-bridge/spec.md](./104-host-capability-bridge/spec.md) | [104-host-capability-bridge/plan.md](./104-host-capability-bridge/plan.md) | ✅ Done |
| M-06 | 105-upstream-adapter-bundle（上游适配层） | [105-upstream-adapter-bundle/spec.md](./105-upstream-adapter-bundle/spec.md) | [105-upstream-adapter-bundle/plan.md](./105-upstream-adapter-bundle/plan.md) | ✅ Done |
| M-07 | 110-pnpm-integration（pnpm 集成） | [110-pnpm-integration/spec.md](./110-pnpm-integration/spec.md) | [110-pnpm-integration/plan.md](./110-pnpm-integration/plan.md) | ✅ Done |
| M-08 | 111-build-pipeline（构建编排） | [111-build-pipeline/spec.md](./111-build-pipeline/spec.md) | [111-build-pipeline/plan.md](./111-build-pipeline/plan.md) | ✅ Done |
| M-09 | 112-tool-bash（命令执行工具） | [112-tool-bash/spec.md](./112-tool-bash/spec.md) | [112-tool-bash/plan.md](./112-tool-bash/plan.md) | ✅ Done |
| M-10 | 114-lifecycle-safety（生命周期与鸿蒙适配） | [114-lifecycle-safety/spec.md](./114-lifecycle-safety/spec.md) | [114-lifecycle-safety/plan.md](./114-lifecycle-safety/plan.md) | ✅ Done |
| M-11 | 115-host（Host 宿主） | [115-host/spec.md](./115-host/spec.md) | [115-host/plan.md](./115-host/plan.md) | ✅ Done |
| M-12 | 117-runtime-provisioning（运行时供给） | [117-runtime-provisioning/spec.md](./117-runtime-provisioning/spec.md) | [117-runtime-provisioning/plan.md](./117-runtime-provisioning/plan.md) | ✅ Done |

> M-07 另含 `tasks.md` + `test-cases.md`；M-09 另含 `tasks.md` + `test-cases.md`；M-12 另含 `tasks.md` + `test-cases.md` + `IMPLEMENTATION_NOTES.md`。

## 3. 插件与技能模块

| # | 模块 | spec.md | plan.md | 状态 |
|---|---|---|---|---|
| M-13 | 201-dsh-market（插件市场） | [201-dsh-market/spec.md](./201-dsh-market/spec.md) | [201-dsh-market/plan.md](./201-dsh-market/plan.md) | ✅ Done |
| M-14 | 202-plugin-fs-mutate（fs-mutate 专用插件） | [202-plugin-fs-mutate/spec.md](./202-plugin-fs-mutate/spec.md) | [202-plugin-fs-mutate/plan.md](./202-plugin-fs-mutate/plan.md) | ✅ Done |
| M-15 | 203-plugin-workspace-picker（工作区选择插件） | [203-plugin-workspace-picker/spec.md](./203-plugin-workspace-picker/spec.md) | [203-plugin-workspace-picker/plan.md](./203-plugin-workspace-picker/plan.md) | ✅ Done |
| M-16 | 204-plugin-git（GIT 插件） | [204-plugin-git/spec.md](./204-plugin-git/spec.md) | [204-plugin-git/plan.md](./204-plugin-git/plan.md) | ✅ Done |
| M-17 | 301-skill-runtime-capabilities（技能运行能力规范） | [301-skill-runtime-capabilities/spec.md](./301-skill-runtime-capabilities/spec.md) | [301-skill-runtime-capabilities/plan.md](./301-skill-runtime-capabilities/plan.md) | ✅ Done |

> M-14 / M-15 / M-16 / M-17 另各含 `test-cases.md`；M-15 / M-16 另含 `tasks.md`。

## 4. 完成度统计

- 项目级：9 / 9 完成
- 模块级：17 / 17 完成（1 个公共模块 + 11 个基础模块 + 4 个插件模块 + 1 个技能规范）
