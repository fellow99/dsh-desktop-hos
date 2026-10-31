# 规格文档索引

**项目名称：** dsh-desktop-hos（Electron on HarmonyOS Edition）
**版本：** 0.2.1
**技术栈：** Electron-on-HarmonyOS（Electron 37 / Node 22.17.0）+ ArkTS + HarmonyOS（封装 deepseek-harness）
**文档生成时间：** 2026-09-04
**最后更新：** 2026-11-01（按父工程编号规则整理：0XX 公共 / 1XX 基础 / 2XX 插件）

---

## 一、文档总览

| 层级 | 分类 | 文档数量 | 说明 |
|------|------|---------|------|
| 整体 | 项目级顶层文档 | 9 | 索引、清单、结构、技术、架构、宪法、overall-* |
| 模块 | 公共需求模块（0XX） | 2 | 013-branding（spec + plan）；鸿蒙工程暂无 012-building-workflow |
| 模块 | 基础功能模块（1XX） | 29 | 101/102/103/104/105/110/111/112/114/115/117 |
| 模块 | 插件模块（2XX） | 13 | 201/202/203/204 |
| 模块 | 技能规范（3XX） | 3 | 301-skill-runtime-capabilities |
| **合计** | **9 根文件 / 17 模块目录 / 47 模块文件 / 56 文件** | | |

> 注：本项目级规格文档集不含 `API.md`、`overall-api.md`、`overall-test-cases.md`——数据面在 dsh 侧，本工程无自有 API 清单，这些文档尚未生成（对齐 sibling desktop 规范集）。
> 编号规则见父工程 [`../../specs/constitution.md`](../../specs/constitution.md)：`0XX` = 各子工程公共需求，`1XX` = 本工程基础功能，`2XX` = 补丁/插件。本工程基础模块编号以 `dsh-desktop-android` 为基准对齐。

---

## 二、项目级顶层文档

全局性的架构、技术、宪法等文档，定义项目基线和开发准则。

| 文档 | 路径 | 说明 |
|------|------|------|
| **方案总纲** | [ARCHITECTURE.md](./ARCHITECTURE.md) | 系统整体架构设计（进程模型、分层、数据流、关键决策） |
| **宪法原则** | [constitution.md](./constitution.md) | 项目开发原则、编码规范、治理规则、编号规则 |
| **整体规格** | [overall-spec.md](./overall-spec.md) | 系统级功能规格（技术无关） |
| **整体方案** | [overall-plan.md](./overall-plan.md) | 系统级技术方案（各模块 plan 总纲） |
| **技术选型** | [TECH.md](./TECH.md) | 核心技术栈选型理由、版本、依赖说明 |
| **项目结构** | [STRUCTURE.md](./STRUCTURE.md) | 源码目录结构、模块清单、关键配置 |
| **数据模型** | [overall-data-model.md](./overall-data-model.md) | 全局数据实体、状态机、目录布局定义 |
| **检查清单** | [SPECS_CHECKLIST.md](./SPECS_CHECKLIST.md) | 规格文档完成度追踪 |

---

## 三、公共需求模块（0XX）

### 013 — 品牌化（branding）

> 应用名 / 应用图标 / 启动图标 / 窗口图标 / 状态栏图标 / in-app 标题，以及 `dsh-rebrand` patch 对 Web UI 品牌位的替换；物料源为父工程 `assets/`。

| 文档 | 链接 | 说明 |
|------|------|------|
| 功能规格 | [013-branding/spec.md](./013-branding/spec.md) | 品牌化功能规格 |
| 技术方案 | [013-branding/plan.md](./013-branding/plan.md) | 品牌化技术实现方案 |

> `012-building-workflow` 在鸿蒙工程暂无对应实现（构建/签名经 DevEco Studio / hvigor 本地完成，无 GitHub Actions 流水线）；整体规范见父工程 `specs/012-building-workflow/`。

---

## 四、基础功能模块（1XX）

### 101 — 运行时入口（runtime-launch-orchestration）

> electron 入口模块：EntryAbility 启动 Electron-on-HarmonyOS 运行时，承载原生 SO。

| 文档 | 链接 | 说明 |
|------|------|------|
| 功能规格 | [101-runtime-launch-orchestration/spec.md](./101-runtime-launch-orchestration/spec.md) | 运行时入口功能规格 |
| 技术方案 | [101-runtime-launch-orchestration/plan.md](./101-runtime-launch-orchestration/plan.md) | 运行时入口技术实现方案 |

### 102 — 产物解压引导（payload-pipeline）

> `dsh-dist.tar.gz` 流式解压与产物就位（首次启动，幂等跳过）。

| 文档 | 链接 | 说明 |
|------|------|------|
| 功能规格 | [102-payload-pipeline/spec.md](./102-payload-pipeline/spec.md) | 产物解压引导功能规格 |
| 技术方案 | [102-payload-pipeline/plan.md](./102-payload-pipeline/plan.md) | 产物解压引导技术实现方案 |

### 103 — 窗口外壳（window-shell）

> BrowserWindow 创建、内联 loading 页、loadURL(同源)/兜底页、crypto.randomUUID polyfill、关窗即退出。

| 文档 | 链接 | 说明 |
|------|------|------|
| 功能规格 | [103-window-shell/spec.md](./103-window-shell/spec.md) | 窗口外壳功能规格 |
| 技术方案 | [103-window-shell/plan.md](./103-window-shell/plan.md) | 窗口外壳技术实现方案 |

### 104 — 宿主能力桥（host-capability-bridge）

> `web_engine` 桥接 HAR：ArkUI Web 组件承载渲染 + 系统能力 Adapter + Node 侧 AdapterBind + resfile 承载 dsh 产物。

| 文档 | 链接 | 说明 |
|------|------|------|
| 功能规格 | [104-host-capability-bridge/spec.md](./104-host-capability-bridge/spec.md) | 宿主能力桥功能规格 |
| 技术方案 | [104-host-capability-bridge/plan.md](./104-host-capability-bridge/plan.md) | 宿主能力桥技术实现方案 |

### 105 — 上游适配层（upstream-adapter-bundle）

> 自定义 desktop profile（`cordis.patch.yml` + `package.json`）+ dsh 上游 patch（symlink→copy / allow-all-interfaces / disable-hmr / disable-native-picker 等）。

| 文档 | 链接 | 说明 |
|------|------|------|
| 功能规格 | [105-upstream-adapter-bundle/spec.md](./105-upstream-adapter-bundle/spec.md) | 上游适配层功能规格 |
| 技术方案 | [105-upstream-adapter-bundle/plan.md](./105-upstream-adapter-bundle/plan.md) | 上游适配层技术实现方案 |

### 110 — pnpm 集成（pnpm-integration）

> 随包物化纯 JS `pnpm`，在 Electron 主进程内调用；为插件市场提供 `desktopProfiles` / `desktopPnpm` 契约，绕开鸿蒙无法 spawn node/pnpm 的限制。

| 文档 | 链接 | 说明 |
|------|------|------|
| 功能规格 | [110-pnpm-integration/spec.md](./110-pnpm-integration/spec.md) | pnpm 集成功能规格 |
| 技术方案 | [110-pnpm-integration/plan.md](./110-pnpm-integration/plan.md) | pnpm 集成技术实现方案 |
| 任务拆解 | [110-pnpm-integration/tasks.md](./110-pnpm-integration/tasks.md) | 开发任务 |
| 测试用例 | [110-pnpm-integration/test-cases.md](./110-pnpm-integration/test-cases.md) | 功能/真机用例 |

### 111 — 构建编排（build-pipeline）

> 三阶段构建编排：collect-runtime（copy 运行时）→ build-dsh（patch + build）→ collect-dsh（物化 + 产物适配）。

| 文档 | 链接 | 说明 |
|------|------|------|
| 功能规格 | [111-build-pipeline/spec.md](./111-build-pipeline/spec.md) | 构建编排功能规格 |
| 技术方案 | [111-build-pipeline/plan.md](./111-build-pipeline/plan.md) | 构建编排技术实现方案 |

### 112 — 命令执行工具 bash（tool-bash）

> 非 PTY exec 后端：常驻 `/system/bin/sh` + 哨兵行协议 + 工具层路径围栏（best-effort，非沙箱）。

| 文档 | 链接 | 说明 |
|------|------|------|
| 功能规格 | [112-tool-bash/spec.md](./112-tool-bash/spec.md) | 命令执行工具功能规格 |
| 技术方案 | [112-tool-bash/plan.md](./112-tool-bash/plan.md) | 命令执行工具技术实现方案 |
| 任务拆解 | [112-tool-bash/tasks.md](./112-tool-bash/tasks.md) | 开发任务 |
| 测试用例 | [112-tool-bash/test-cases.md](./112-tool-bash/test-cases.md) | 真机用例 |

### 114 — 生命周期与鸿蒙适配（lifecycle-safety）

> HOME 沙箱修正、loopback 头改写、NO_PROXY 并入、崩溃兜底、优雅关闭。

| 文档 | 链接 | 说明 |
|------|------|------|
| 功能规格 | [114-lifecycle-safety/spec.md](./114-lifecycle-safety/spec.md) | 生命周期与鸿蒙适配功能规格 |
| 技术方案 | [114-lifecycle-safety/plan.md](./114-lifecycle-safety/plan.md) | 生命周期与鸿蒙适配技术实现方案 |

### 115 — Host 宿主（host）

> 在主进程内 `runProfile('desktop')` 挂起 dsh Host（含 webserver），返回宿主句柄（ctx/shutdown/port/url）；就绪判定 + agent preset 运行时补丁。

| 文档 | 链接 | 说明 |
|------|------|------|
| 功能规格 | [115-host/spec.md](./115-host/spec.md) | Host 宿主功能规格 |
| 技术方案 | [115-host/plan.md](./115-host/plan.md) | Host 宿主技术实现方案 |

### 117 — 运行时供给（runtime-provisioning）

> 为插件市场提供可运行的 node/pnpm 安装通道；记录 HNP/path 方案的平台根因与历史设计（HNP 已整体移除，现由 110 的进程内 pnpm 路径承接）。

| 文档 | 链接 | 说明 |
|------|------|------|
| 功能规格 | [117-runtime-provisioning/spec.md](./117-runtime-provisioning/spec.md) | 运行时供给功能规格 |
| 技术方案 | [117-runtime-provisioning/plan.md](./117-runtime-provisioning/plan.md) | 运行时供给技术实现方案 |
| 任务拆解 | [117-runtime-provisioning/tasks.md](./117-runtime-provisioning/tasks.md) | 开发任务 |
| 测试用例 | [117-runtime-provisioning/test-cases.md](./117-runtime-provisioning/test-cases.md) | 真机用例 |
| 实现说明 | [117-runtime-provisioning/IMPLEMENTATION_NOTES.md](./117-runtime-provisioning/IMPLEMENTATION_NOTES.md) | 实现备注 |

### 编号迁移映射（001-012 → 1XX）

| 旧编号 | 新编号 | 模块 |
|--------|--------|------|
| 001-host | 115-host | Host 宿主 |
| 002-window | 103-window-shell | 窗口外壳 |
| 003-lifecycle | 114-lifecycle-safety | 生命周期与鸿蒙适配 |
| 004-artifact-bootstrap | 102-payload-pipeline | 产物解压引导 |
| 005-build-pipeline | 111-build-pipeline | 构建编排 |
| 006-runtime-profile | 105-upstream-adapter-bundle | 上游适配层 |
| 007-runtime-entry | 101-runtime-launch-orchestration | 运行时入口 |
| 008-web-bridge | 104-host-capability-bridge | 宿主能力桥 |
| 010-tool-bash | 112-tool-bash | 命令执行工具 |
| 011-runtime-provisioning | 117-runtime-provisioning | 运行时供给 |
| 012-pnpm-integration | 110-pnpm-integration | pnpm 集成 |

---

## 五、插件模块（2XX）

### 201 — dsh-market 插件市场（dsh-market）

> 把 dsh-market（可视化插件市场）集成到本工程：构建期 npm build + 物化进 `dsh-dist/node_modules/dshmarket` + 运行时复制到 `$DSH_HOME` + 配置注入（profile: desktop、allowRestart: false）。

| 文档 | 链接 | 说明 |
|------|------|------|
| 功能规格 | [201-dsh-market/spec.md](./201-dsh-market/spec.md) | dsh-market 集成功能规格 |
| 技术方案 | [201-dsh-market/plan.md](./201-dsh-market/plan.md) | dsh-market 集成技术实现方案 |

### 202 — fs-mutate 插件（工程内专用）（plugin-fs-mutate）

> 交付 `delete` / `move` / `copy` / `chmod` 四个模型可见的文件变更工具，以本工程专用插件形态集成到 `plugins/harmony-plugin-fs-mutate/`。

| 文档 | 链接 | 说明 |
|------|------|------|
| 功能规格 | [202-plugin-fs-mutate/spec.md](./202-plugin-fs-mutate/spec.md) | fs-mutate 插件功能规格 |
| 技术方案 | [202-plugin-fs-mutate/plan.md](./202-plugin-fs-mutate/plan.md) | fs-mutate 插件技术实现方案 |
| 测试用例 | [202-plugin-fs-mutate/test-cases.md](./202-plugin-fs-mutate/test-cases.md) | 构建期断言 + 真机用例 |

### 203 — 工作区选择插件（plugin-workspace-picker）

> 工作区目录选择与授权门；与本工程 `106-workspace-picker` 需求对应。

| 文档 | 链接 | 说明 |
|------|------|------|
| 功能规格 | [203-plugin-workspace-picker/spec.md](./203-plugin-workspace-picker/spec.md) | 工作区选择插件功能规格 |
| 技术方案 | [203-plugin-workspace-picker/plan.md](./203-plugin-workspace-picker/plan.md) | 工作区选择插件技术实现方案 |
| 任务拆解 | [203-plugin-workspace-picker/tasks.md](./203-plugin-workspace-picker/tasks.md) | 开发任务 |
| 测试用例 | [203-plugin-workspace-picker/test-cases.md](./203-plugin-workspace-picker/test-cases.md) | 真机用例 |

### 204 — GIT 插件（plugin-git）

> 设备没有 `git` 二进制：把纯 JS 的 isomorphic-git 嵌入宿主进程，交付 21 个 git 工具 + 「Git 凭据」设置页。

| 文档 | 链接 | 说明 |
|------|------|------|
| 功能规格 | [204-plugin-git/spec.md](./204-plugin-git/spec.md) | GIT 插件功能规格 |
| 技术方案 | [204-plugin-git/plan.md](./204-plugin-git/plan.md) | GIT 插件技术实现方案 |
| 任务拆解 | [204-plugin-git/tasks.md](./204-plugin-git/tasks.md) | 开发任务 |
| 测试用例 | [204-plugin-git/test-cases.md](./204-plugin-git/test-cases.md) | 真机用例 |

---

## 六、技能规范（3XX）

### 301 — 技能运行能力规范（skill-runtime-capabilities）

> 把本壳内置技能 `harmony-runtime-capabilities` 描述的功能与限制沉淀为规范源：能力 × 状态 × 根因层 × 是否可修的完整边界表，并固化文件围栏与提权审批的安全语义。

| 文档 | 链接 | 说明 |
|------|------|------|
| 功能规格 | [301-skill-runtime-capabilities/spec.md](./301-skill-runtime-capabilities/spec.md) | 技能运行能力规范 |
| 技术方案 | [301-skill-runtime-capabilities/plan.md](./301-skill-runtime-capabilities/plan.md) | 能力 ↔ 实现落点映射 |
| 测试用例 | [301-skill-runtime-capabilities/test-cases.md](./301-skill-runtime-capabilities/test-cases.md) | 构建期 + 真机核验用例 |

---

## 七、模块编号一览

| 编号 | 模块名 | 英文名 | 分类 |
|------|--------|--------|------|
| 013 | 品牌化 | branding | 公共需求 |
| 101 | 运行时入口 | runtime-launch-orchestration | 基础功能 |
| 102 | 产物解压引导 | payload-pipeline | 基础功能 |
| 103 | 窗口外壳 | window-shell | 基础功能 |
| 104 | 宿主能力桥 | host-capability-bridge | 基础功能 |
| 105 | 上游适配层 | upstream-adapter-bundle | 基础功能 |
| 110 | pnpm 集成 | pnpm-integration | 基础功能 |
| 111 | 构建编排 | build-pipeline | 基础功能 |
| 112 | 命令执行工具 bash | tool-bash | 基础功能 |
| 114 | 生命周期与鸿蒙适配 | lifecycle-safety | 基础功能 |
| 115 | Host 宿主 | host | 基础功能 |
| 117 | 运行时供给 | runtime-provisioning | 基础功能 |
| 201 | dsh-market 插件市场 | dsh-market | 插件 |
| 202 | fs-mutate 插件（工程内专用） | plugin-fs-mutate | 插件 |
| 203 | 工作区选择插件 | plugin-workspace-picker | 插件 |
| 204 | GIT 插件 | plugin-git | 插件 |
| 301 | 技能运行能力规范 | skill-runtime-capabilities | 技能规范 |

---

## 八、模块文档结构规范

每个模块目录 `NNN-name/` 下包含以下标准文档：

| 文件 | 命名 | 说明 |
|------|------|------|
| 功能规格 | `spec.md` | 定义模块的功能需求、用户故事、验收标准 |
| 技术方案 | `plan.md` | 模块的技术实现方案、架构决策、组件设计 |

> 如项目需要，模块目录还可扩展以下文档：
> - `tasks.md` — 开发任务拆解、依赖关系、里程碑
> - `api.md` — 模块涉及的 API 接口定义
> - `data-model.md` — 模块所需的实体、类型、枚举定义
> - `pages.md` — 模块包含的页面路由、组件树、交互流程
> - `test-cases.md` — 模块 UI 功能测试用例

---

## 九、快速导航

| 目标读者 | 推荐阅读顺序 |
|---------|-------------|
| **新加入开发者** | constitution.md → STRUCTURE.md → overall-spec.md → 具体模块 spec.md |
| **架构师 / Tech Lead** | ARCHITECTURE.md → TECH.md → overall-plan.md → overall-data-model.md |
| **主进程/外壳开发** | 101 → 103 → 104 → 115 |
| **构建/发布** | 111 → 105 → 117 |
| **测试 / QA** | SPECS_CHECKLIST.md → 各模块 spec.md 验收场景 |

---

**文档维护者：** dsh-desktop-hos 开发团队
