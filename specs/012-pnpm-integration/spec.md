# 012-pnpm-integration 纯 JS pnpm 集成 功能规格

> Module: 012-pnpm-integration
> Status: Design（实现中）
> Last Updated: 2026-10-02
> 关联文档：
> - [`docs/pnpm对接问题排查.md`](../docs/pnpm对接问题排查.md) —— 故障排查记录（平台根因 + SIGSYS 实测 + §11 深入分析）
> - [`docs/012-pnpm+dsh-market.md`](../docs/012-pnpm+dsh-market.md) —— 本模块的讨论过程与方案（事实基础）
> - [`specs/011-runtime-provisioning/`](../specs/011-runtime-provisioning/) —— 运行时供给模块（**路径 B = 本模块**；探测/选路/校验已实现）
> - [`specs/201-dsh-market/`](../specs/201-dsh-market/) —— 市场集成模块（消费本模块）

---

## 1. 模块概述

### 1.1 目的 —— 为什么存在这个模块

让 dsh-market 在鸿蒙签名包内**真正能安装 / 卸载插件**。

`spawn` 任何 node/pnpm 子进程在应用域都会被 seccomp 以 `SIGSYS` 杀死（平台根因 **B★**，见排查文档 §6），因此「把 pnpm 装到 PATH 上让市场调用」**平台级不可行**。本模块提供唯一可行路线：**把 pnpm 的纯 JS 安装引擎随包物化，由 Electron 主进程在进程内调用**（不 spawn、不 symlink、不依赖任何 ELF/证书），即 011 的**路径 B**。

### 1.2 解决的问题

- **市场的安装通道在设备上不可用**：市场（dshmarket）通过 spawn `pnpm`（经 `dsh plugin` 或官方 Electron 的 `pluginManager`）安装插件，本平台必然失败。
- **需要一个进程内、零平台特权的包管理器**：Electron 主进程自身是 Node（22.17），能跑 JS；把 pnpm 的安装引擎 import 进主进程运行，即可绕过 B★。
- **需要与市场的既有扩展点对接**：市场内置 `desktopProfiles` / `desktopPnpm` 契约（特性检测），本模块实现它，无需修改市场源码。
- **需要规避鸿蒙文件系统禁令**：pnpm 默认 `isolated` 布局建 symlink + hardlink，均被 B1 禁止；必须用 hoisted 扁平布局。

### 1.3 范围

**包含**：

- 纯 JS pnpm 安装引擎的**构建期物化**（`@pnpm/installing.deps-installer` 及其传递闭包，或 `pnpm` 包的可进程内入口）到部署产物。
- **版本固定与断言**（pnpm 版本以常量固定，构建/运行期校验）。
- desktop profile 的 **pnpm 配置注入**（`pnpm-workspace.yaml`：hoisted / copy / ignore-scripts / 沙箱内 storeDir / minimumReleaseAge=0）。
- **进程内 pnpm 调用模块**（add / remove，含 `process.exit` 拦截与 `process.argv` 保存恢复）。
- **`desktopProfiles` 服务 + `desktopPnpm`（`DesktopPnpmLike`）的实现**，供市场特性检测采用。
- 运行期从物化产物解析 pnpm 引擎、失败可见性与诊断探针。

**不包含**：

- **修改 dsh-market 源码**（Route 1；仅当 Route 1 不满足才退 Route 2 打补丁，见 `docs/012-pnpm+dsh-market.md` §7.3）。
- **修改 dsh 上游源码**（零上游改动）。
- 随包携带 Node/pnpm 的 **ELF/二进制**（路径 A，已撤回，需 AGC 二进制证书）。
- 复用设备第三方 Node（路径 C，机会性兜底，本模块不依赖）。
- 支持 `git:` 源插件与需要 lifecycle 构建脚本的插件（设备无 git、`ignoreScripts: true`；须 UI/文档披露）。
- 市场自身 UI / 目录 / 备份等功能（由 dsh-market 提供）。

---

## 2. 用户故事

- 作为**鸿蒙设备用户**，我希望在插件市场里点「安装」后，插件真的被装上并能在刷新后使用，而不是按钮转圈/报错。
- 作为**鸿蒙设备用户**，我希望插件能正常「更新 / 卸载 / 启用停用 / 配置」，且不会让应用崩溃。
- 作为**打包者**，我希望纯 JS pnpm 随构建自动物化，pnpm 版本被固定并可在构建期校验，缺产物即构建失败，而非产出「能启动但装不了插件」的残缺包。
- 作为**维护者**，我希望整套方案不修改 dsh-market 与 dsh 上游源码（零上游改动），并能通过日志/诊断快速判断安装通道是否可用。
- 作为**审核方**，我希望该能力零平台特权、零 ACL、零二进制证书，具备上架可行性。

---

## 3. 功能需求

> 每条需求后的括注指向证据来源：`[源码]`（本 workspace 实测源码）、`[设计]`（本模块决策）、`[未验证]`（待真机/实现阶段核实）。

### 3.1 构建期物化与版本固定

- **FR-012-001**：收集阶段 MUST 把纯 JS pnpm 引擎（**`pnpm` 包本身**）物化到 `dsh-dist/node_modules/dsh-market-pnpm/`（独立目录，避开 `pnpm deploy` 已放置的 dsh 自身 `pnpm` 依赖），入口为 `bin/pnpm.cjs`（对齐 `src-main/market-runtime.js` 的 `BUNDLED_PNPM_ENTRY_REL`）。`[源码]`
  - **版本固定为 `pnpm@10.34.6`**：pnpm@11 的 store v11 依赖 `node:sqlite`，本 Electron/Node 运行时**无该 binding**（真机实测 `No such binding: sqlite`）；pnpm@10 不使用 `node:sqlite`。`[设备实测]`
  - 引擎选型过程见 spike：`@pnpm/installing.deps-installer` 因 `@yarnpkg` 的 `patch:` 依赖独立安装不可行；pnpm@11 因 `node:sqlite` 不可用。
- **FR-012-002**：系统 MUST 以**集中常量**固定 pnpm 版本，并在构建期（收集阶段）断言物化产物的版本与常量一致；不一致即 `process.exit(1)`。`[设计]`
- **FR-012-003**：物化 MUST 幂等（目标入口已存在则跳过）；pnpm 引擎来源缺失时 MUST 硬失败，不得产出残缺部署包。`[设计]`
- **FR-012-004**：物化后 MUST 校验入口文件存在且非空（复用 011 的 `isParsableJs`），损坏产物不得被记录为就绪。`[源码]`
- **FR-012-005**：系统 MUST 记录 pnpm 引擎的**依赖闭包是否含原生模块**（如 SQLite）的构建期事实；若含，MUST 按 `injectBetterSqlite3()` 同法注入 aarch64 成品。`[未验证]`

### 3.2 desktop profile 的 pnpm 配置

- **FR-012-006**：系统 MUST 为 desktop profile 提供 `pnpm-workspace.yaml`，至少含：`nodeLinker: hoisted`、`packageImportMethod: copy`、`ignoreScripts: true`、`minimumReleaseAge: 0`、以及位于沙箱可写目录的 `storeDir`。`[设计]`
- **FR-012-007**：`storeDir` MUST 位于沙箱可写目录（`$DSH_HOME` 或 userData 之下），MUST NOT 使用会解析到沙箱外的默认 `~/.pnpm-store`。`[源码]`
- **FR-012-008**：配置注入 MUST 幂等，且 MUST NOT 覆盖用户自定义的其它 `pnpm-workspace.yaml` 键（保留用户配置）。`[设计]`
- **FR-012-009**：SHOULD 支持可选的 registry 镜像配置（国内 `https://registry.npmmirror.com/`），但 MUST NOT 覆盖用户已显式指定的 registry。`[设计]`

### 3.3 进程内 pnpm 调用

- **FR-012-010**：系统 MUST 在 **Electron 主进程内进程内调用** pnpm 安装引擎完成插件 `add` / `remove`，MUST NOT spawn 任何 node/pnpm 子进程。`[设计]`
- **FR-012-011**：进程内调用 MUST 在 **`worker_threads` worker** 中运行 pnpm CLI，使 pnpm 的 `process.exit` 只退出 worker、不终止 Electron 主进程（无需包装 `process.exit`）。worker MUST 在 import 引擎前把 `process.execPath` 改为可写（no-op setter）——Electron 下该属性只读而 pnpm 会赋值（真机实测 `Cannot assign to read only property 'execPath'`）。`[设备实测]`
- **FR-012-012**：worker MUST 自行设置 `process.argv`（隔离），主进程 argv MUST NOT 被改动。`[设计]`
- **FR-012-013**：进程内安装 MUST 强制禁用 lifecycle 脚本（`ignoreScripts: true`），既是平台约束（否则 spawn 子进程 SIGSYS），也是安全属性（不执行插件作者任意代码）。`[设计]`
- **FR-012-014**：进程内安装 MUST 产出**扁平 node_modules**（hoisted），且 MUST 规避 symlink/hardlink（鸿蒙 B1 禁止）。pnpm 在 `node_modules/.bin` 为依赖二进制建 symlink，会被平台拒绝（`EACCES`）；worker MUST 把 `fs`/`fs.promises.symlink` 在 `EACCES`/`EPERM` 时**回退为 copy**（真机实测：bin 落地为真实文件，安装完成）。`[设备实测]`
- **FR-012-015**：进程内调用 MUST 接受来自市场的目标 spec（含 `name@version`）并写入 profile 目录，且与 dsh 的 profile 目录约定（`$DSH_HOME/profiles/desktop`）一致。`[源码]`

### 3.4 市场契约对接（desktopProfiles / desktopPnpm）

- **FR-012-016**：系统 MUST 在 market bundle mount **之前**注册 `desktopProfiles` 服务，并对外暴露 `desktopPnpm`（实现 dsh-market 的 `DesktopPnpmLike` 接口）。`[源码]`
- **FR-012-017**：`runPlugin(args, invokingDir, signal)` MUST 返回句柄，含：`stdout` / `stderr` 可读流、`done: Promise<{exitCode, signal}>`、`cancel()`。`[源码]`
- **FR-012-018**：`cancel()` MUST 终止正在进行的进程内安装并使 `done` 以「已取消」结束。`[设计]`
- **FR-012-019**：系统 MUST NOT 依赖修改 dsh-market 源码（Route 1）即可让市场走 `desktopPnpm` 分支；若市场因配置走官方 Electron（`pluginManager`）分支，MUST 通过配置/版本配合使其改走 `desktopPnpm`。`[设计]`
- **FR-012-020**：当市场未挂载 `desktopProfiles` 契约时（如未来市场版本移除该分支），系统 MUST 显式记录并可降级（Route 2 补丁或明确报错），不得静默不可用。`[设计]`

### 3.5 失败可见性与诊断

- **FR-012-021**：所有关键事件与失败 MUST 以 `[dsh-harmony]` 前缀打印（与工程日志规范一致）；**禁止静默降级**。`[源码]`
- **FR-012-022**：系统 MUST 向市场返回可读的失败信息（exitCode + stderr 文本），使市场 UI 的 `InstallResult` 分类逻辑可正常工作。`[源码]`
- **FR-012-023**：系统 SHOULD 提供可经 `--inspect`（CDP `Runtime.evaluate`）读回的诊断探针（`globalThis.__marketRuntimePnpm`），暴露：profile 名/目录、pnpm 引擎入口路径与可用性。上次安装结果字段为 SHOULD（当前未实现）。`[源码]`

### 3.6 幂等、安全与回归安全

- **FR-012-024**：运行时初始化 MUST 幂等（可重复启动）；`setupMarketRuntime()` 的失败 MUST NOT 阻塞应用启动。`[源码]`
- **FR-012-025**：本模块 MUST NOT 扩大应用的权限面（零新增受限权限、零 ACL、零二进制证书依赖）。`[设计]`
- **FR-012-026**：安装失败时 MUST NOT 使 profile 处于不可启动状态（沿用 dsh 的 `package.json` + `pnpm-lock.yaml` 快照/还原语义，或等价保证）。`[源码]`

---

## 4. 关键实体

| 实体 | 描述 | 关键属性 |
|------|------|----------|
| pnpm 引擎产物（`dsh-market-pnpm`） | 随包物化的纯 JS pnpm CLI | 入口 `dsh-dist/node_modules/dsh-market-pnpm/bin/pnpm.cjs`；版本常量 `10.34.6`；worker 线程内 import |
| profile pnpm 配置 | desktop profile 的 `pnpm-workspace.yaml` | `nodeLinker: hoisted`、`packageImportMethod: copy`、`ignoreScripts: true`、`storeDir`、`minimumReleaseAge: 0` |
| desktopPnpm 服务 | 暴露给市场的进程内包管理器 | `runPlugin(args, invokingDir, signal): DesktopPnpmHandleLike` |
| DesktopPnpmHandleLike | 一次安装操作的句柄 | `stdout`、`stderr`、`done: Promise<{exitCode,signal}>`、`cancel()` |
| 安装目标 spec | 市场传入的插件标识 | `name@exact.version` 或 `name`（npm registry）；github/file 源按市场契约处理 |
| 诊断探针 | `--inspect` 可读的运行时状态 | `globalThis.__pnpmRuntime` |

---

## 5. 验收场景

### 场景：构建后 pnpm 引擎随包就位
- Given `../dsh-market` 与 pnpm 引擎来源可用
- When 执行收集脚本
- Then `dsh-dist/node_modules/dsh-market-pnpm/lib/index.mjs` 存在且非空；版本与常量一致

### 场景：pnpm 引擎缺失时构建硬失败
- Given pnpm 引擎无法获取
- When 收集脚本执行到物化步骤
- Then 明确报错并 `process.exit(1)`，不产出残缺部署包

### 场景：profile 配置含 hoisted 扁平设置
- Given Host 启动（`setupMarketRuntime` 已运行）
- When 检查 `$DSH_HOME/profiles/desktop/pnpm-workspace.yaml`
- Then 含 `nodeLinker: hoisted`、`packageImportMethod: copy`、`ignoreScripts: true`、沙箱内 `storeDir`

### 场景：市场一键安装纯 npm 插件（真机）
- Given 应用运行、市场打开、安装通道可用
- When 用户点某个纯 npm 插件的「安装」
- Then 市场通过 `desktopPnpm.runPlugin` 进程内完成安装；`$DSH_HOME/profiles/desktop/node_modules/<pkg>/package.json` 出现；无任何 node/pnpm 子进程；市场 UI 显示成功

### 场景：市场卸载插件
- Given 某插件已安装
- When 用户点「卸载」
- Then 进程内 `remove` 完成；`node_modules/<pkg>` 消失；`dsh.profile.bundles` 中相应行被 reconcile 移除

### 场景：安装过程不产生 node/pnpm 子进程
- Given 一次安装正在进行
- When 观察进程树
- Then 不出现新的 node/pnpm 子进程（对比 spawn 方案必然出现的子进程）

### 场景：安装失败不崩应用、不破坏 profile
- Given 安装一个不存在的包 / 网络失败
- When 触发安装
- Then 主进程不崩溃；返回非零 exitCode + 可读 stderr；profile 的 `package.json`/`pnpm-lock.yaml` 未被破坏

### 场景：取消安装
- Given 一次安装正在进行
- When 市场调用 cancel
- Then 操作终止，`done` 以取消结束

### 场景：市场未提供 desktopProfiles 契约时显式可见
- Given 市场版本不含 `desktopProfiles` 分支
- When 应用启动
- Then 日志显式记录安装通道不可用（不静默）

---

## 6. 非功能需求

- **幂等性**：物化、配置注入、运行时初始化均 MUST 可重复执行。
- **健壮性**：物化来源缺失 MUST 硬失败；运行时初始化失败 MUST NOT 阻塞启动；安装失败 MUST NOT 崩溃或破坏 profile。
- **性能**：进程内安装为一次性操作，无热路径；引擎 import 应在首次安装时惰性加载（避免拖慢启动）。
- **安全**：零新增受限权限 / ACL / 二进制证书；`ignoreScripts` 关闭脚本执行；不执行 `git:` 源。
- **可维护性**：物化集中在 `collect-dsh.mjs`；进程内调用抽成可单测的纯模块（不依赖 Electron）；引擎版本以常量固定。
- **可上架性**：零平台特权、零 ACL —— 具备 AppGallery 上架可行性（区别于路径 A）。

---

## 7. 假设与约束

- **假设**：Electron 主进程可正常执行 JS（实测：主进程是 Node 22.17，能跑 JS；仅 fork 出的子进程被 SIGSYS）。
- **假设**：dsh-market 的执行逻辑会通过 `desktopProfiles` / `desktopPnpm` 特性检测采用宿主提供的进程内包管理器（Route 1）。固定市场版本 1.66.7 已含该分支。`[源码]`
- **约束（平台）**：MUST NOT spawn node/pnpm 子进程（B★）；MUST NOT 创建 symlink/hardlink（B1）；MUST NOT 依赖用户目录 ELF 执行（B2）。
- **约束（pnpm 版本陷阱）**：进程内安装引擎 MUST 来自 pnpm 11（或 10）的纯 JS 线；`@pnpm/core` 自 pnpm v11 起停止发布，应使用 `@pnpm/installing.deps-installer`。**该包的准确签名 `[未验证]`，实现阶段第一优先 spike。**
- **约束（配置位置）**：pnpm v11 起除 auth/registry 外的设置写在 `pnpm-workspace.yaml`（camelCase），不再读 `.npmrc`。
- **约束（功能边界）**：`git:` 源插件与依赖 lifecycle 构建脚本的插件不可安装（设备无 git；`ignoreScripts`）；须在 UI/文档披露。
- **约束（原生模块）**：若 pnpm 引擎依赖闭包含原生模块，须注入 aarch64 成品（与「spawn SIGSYS」无关，主进程 dlopen 可行）。

---

## 8. 依赖

**上游（被本模块消费）**：

- **pnpm 安装引擎**（`@pnpm/installing.deps-installer` 或 `pnpm` 包的进程内入口）——纯 JS，随构建物化；版本以常量固定。`[未验证]`
- **deepseek-harness**（`../deepseek-harness`）——提供 profile 目录约定、`dsh.profile.bundles` 维护函数（`writeProfileBundles` / `reconcileProfilePlugins` / `selectBundle`）、插件发现机制（`createRequire(...).resolve.paths` 走 node_modules）；本模块不改其源码。
- **dsh-market**（`../dsh-market`，固定版本 1.66.7，submodule）——提供 `desktopProfiles` / `desktopPnpm` 契约（`src/dsh-cli.ts:577-608`、`:1274`；`src/index.ts:183,285-292`）；本模块不改其源码。

**下游 / 本工程模块间依赖**：

- **011-runtime-provisioning**：本模块 = 其「路径 B」。011 已交付 `src-main/market-runtime.js` 的探测/选路/校验（含 `BUNDLED_PNPM_PACKAGE` / `BUNDLED_PNPM_ENTRY_REL` 常量与路径 B 探测分支）；本模块补上「进程内调用」这一环。
- **201-dsh-market**：市场集成模块；本模块为其安装/维护/配置/移除通道提供进程内 pnpm 引擎。201 的规范同步描述该契约的消费方式。
- **005-build-pipeline**：本模块的多化落点在 `collect-dsh.mjs`（新增 `collectMarketPNPM()`）。
- **001-host**：本模块的运行时初始化落点在 `startHost()`（`setupMarketRuntime()` 之后、`runProfile` 之前）。

---

*事实以源码为准；`[未验证]` 项在实现阶段的第一优先 spike 中核实。*
