# dsh-market 插件市场 功能规格

> Module: 201-dsh-market
> Status: Implemented（集成已落地；安装通道随 012 演进）
> Last Updated: 2026-10-02
> 关联模块：[`012-pnpm-integration`](../012-pnpm-integration/)（提供进程内 pnpm 引擎）、[`005-build-pipeline`](../005-build-pipeline/)、[`006-runtime-profile`](../006-runtime-profile/)、[`001-host`](../001-host/)

## 1. 模块概述

### 1.1 目的 —— 为什么存在这个模块

把 [dsh-market](https://github.com/dsh-market/dsh-market)（DeepSeek Harness 的可视化插件市场，npm 包 `dshmarket`，**固定版本 `1.66.7`**）**内置**到本工程（dsh-desktop-hos，鸿蒙桌面版）封装的 dsh 环境中，使其随 Host **自动加载**，并让用户在鸿蒙设备的桌面应用内浏览插件市场目录、查看已装插件，并**安装 / 更新 / 配置 / 卸载插件**。

dsh-market 是一个前后端混合的 Cordis 插件：宿主端（`lib/`）挂载 `/dsh-market/*` HTTP 路由并读写 profile 目录，浏览器端（`client/`）注入设置页 UI。本模块负责「把它作为一个 bundle 装进 desktop profile 并打通其物化、复制与运行配置」，以及「让其插件管理操作在鸿蒙上可用」——**不改 dsh-market 与 dsh 的上游代码**。

### 1.2 解决的问题

- **零命令行逛插件市场**：鸿蒙设备用户无需自装 Node/pnpm，即可在设置页看到「插件市场」入口并浏览社区目录。
- **打包应用的插件市场可用**：普通 `dsh web` 依赖系统 Node/pnpm；打包进 HAP 的鸿蒙应用没有这些运行时，本模块通过「构建期物化 + 运行期复制」把市场产物随 dsh 部署产物一并打入，使市场的前后端 bundle 在设备上可被解析、可被服务。
- **插件安装/卸载在鸿蒙可用**：市场默认通过 spawn `pnpm`（经 `dsh plugin` 或官方 Electron 的 `pluginManager`）安装插件，而应用域 spawn 出的 node/pnpm 子进程被 `SIGSYS` 杀死。本模块**实现市场已内置的 `desktopProfiles` / `desktopPnpm` 契约**，让市场的安装/卸载走**进程内 pnpm**（引擎由 012 提供），无需改市场源码。
- **profile 正确性**：dsh-market 默认操作 `web` profile，本工程用 `desktop` profile，必须显式注入 profile 名，否则安装/删除会写错目录。
- **进程生命周期归属**：市场不能擅自在鸿蒙设备上 spawn 独立 dsh 进程重启，须由桌面壳掌控进程生命周期。

### 1.3 范围

**包含**：

- 构建期构建 dsh-market（`npm install` + `npm run build`，产出 `lib/` 与 `client/`）。
- 收集期把市场产物（`package.json` + `cordis.patch.yml` + `lib/` + `client/`，排除源码/测试/devDeps）物化到 `dsh-dist/node_modules/dshmarket`，并递归复制其运行时依赖（`@deepseek-ai` scope 从宿主解析）。
- 运行期把 dshmarket 复制到 `$DSH_HOME/profiles/node_modules/dshmarket`（复制而非 symlink）。
- desktop profile 声明 dshmarket 为 bundle 并注入运行配置（`profile: desktop`、`allowRestart: false`）。
- **插件管理通道**：市场通过宿主提供的 `desktopProfiles` / `desktopPnpm` 契约执行插件的**添加 / 更新 / 配置 / 移除**（进程内 pnpm，引擎来自 012）；市场自身的维护（启用停用、分组、备注、备份/恢复、更新检测）沿用市场既有能力。
- **市场版本固定**（`1.66.7`）与构建期断言（由 012 的 `assertDshMarketVersion()` 落实）。

**不包含**：

- 修改 dsh-market 或 dsh 的上游源码（沿用「零上游改动」宪法原则；安装通道走市场已内置的契约，不 patch 市场）。
- dsh-market 自身 UI / 目录拉取 / 备份 / WebDAV / Gist / 诊断等功能的实现（由 dsh-market 提供）。
- **进程内 pnpm 引擎本身**（物化、调用、`process.exit`/`argv` 防护、profile pnpm 配置）——属 [`012-pnpm-integration`](../012-pnpm-integration/) 的范围，本模块只**消费**其契约。
- 全局快捷键、开机自启等其它桌面能力。

## 2. 用户故事

- 作为用户，我希望打开鸿蒙桌面应用后，设置页就能看到「插件市场」，无需任何手动配置。
- 作为用户，我希望在插件市场里浏览社区插件目录、查看已安装的插件。
- 作为用户，我希望点「安装」后插件真的被装上并能使用（**不再按钮转圈/报错**），点「卸载」能真的移除。
- 作为用户，我希望已装插件能更新、能启用停用、能配置，且这些操作不会让应用崩溃。
- 作为用户，我希望插件市场不会擅自重启我的桌面应用（重启由桌面壳掌控）。
- 作为打包者，我希望只需顺序执行构建/收集脚本，市场产物即自动物化进部署包，无需手工拷贝。
- 作为打包者，当市场工程缺失或版本不符时，我应得到明确报错而非产出「能启动但市场缺失/装不了插件」的残缺产物。

## 3. 功能需求

### 3.1 构建期构建市场

- FR-201-001：系统 MUST 在构建阶段构建 dsh-market（依赖缺失时 `npm install`，随后 `npm run build`，产出 `lib/` 与 `client/`）。
- FR-201-002：当市场工程（`../dsh-market`）缺失时，构建阶段 SHOULD 警告并跳过，而不中断主构建流程。

### 3.2 收集期物化市场产物

- FR-201-003：系统 MUST 将市场产物（`package.json` + `cordis.patch.yml` + `lib/` + `client/`，排除源码/测试/devDeps）物化到 `dsh-dist/node_modules/dshmarket`。
- FR-201-004：收集阶段市场工程缺失时，系统 MUST 以明确错误终止流程（`process.exit(1)`）。
- FR-201-005：系统 MUST 递归复制市场的运行时依赖（`dependencies` 字段 + 传递依赖）到市场自身 `node_modules`；`@deepseek-ai` scope 的依赖 MUST 从宿主 dsh-dist 解析而不复制。
- FR-201-006：物化 MUST 幂等（目标 `dshmarket/package.json` 已存在则跳过）。

### 3.3 运行期复制到 profile

- FR-201-007：系统 MUST 在 Host 启动前将 dshmarket 从部署产物复制到 `$DSH_HOME/profiles/node_modules/dshmarket`（复制而非 symlink，因鸿蒙沙箱禁止 symlink）。
- FR-201-008：该复制 MUST 幂等（目标 `package.json` 已存在则跳过），且失败时 MUST NOT 阻塞 Host 启动。

### 3.4 bundle 声明与运行配置注入

- FR-201-009：系统 MUST 将 `dshmarket` 声明为 desktop profile 的 bundle（`dsh.profile.bundles`）并写入 `dependencies`（版本 `1.66.7`），使市场随组合自动加载。
- FR-201-010：系统 MUST 在 desktop profile 的 `cordis.patch.yml` 注入运行配置 `config: { profile: desktop, allowRestart: false }`，使市场操作正确的 profile 且不擅自 spawn 独立 dsh 进程重启。

### 3.5 插件管理通道（desktopProfiles / desktopPnpm 契约）

- FR-201-011：宿主系统 MUST 在 market bundle mount **之前**提供 `desktopProfiles` 服务，使市场通过**特性检测**（`ctx.get('desktopProfiles')`）采用宿主提供的进程内包管理器；该服务由 [`012-pnpm-integration`](../012-pnpm-integration/) 实现。
- FR-201-012：宿主 MUST 通过 `desktopPnpm`（实现市场 `DesktopPnpmLike` 接口）提供 `runPlugin(args, invokingDir, signal)`，市场据此执行 `add` / `remove`；实现 MUST 为**进程内**（不 spawn node/pnpm 子进程）。
- FR-201-013：市场对插件的**添加** MUST 经 `desktopPnpm.runPlugin(['add', '<spec>'], dir)` 完成，并消费返回句柄的 `stdout`/`stderr`/`done`/`cancel`。
- FR-201-014：市场对插件的**移除** MUST 经 `desktopPnpm.runPlugin(['remove', '<name>'], dir)` 完成，并同步从 `dsh.profile.bundles` 中 reconcile 掉该插件行。
- FR-201-015：插件的**配置**（`cordis.patch.yml` 的 disable/enable 覆写、`dsh.profile.bundles` 的增删）MUST 由市场经 dsh 的进程内维护函数完成，不依赖 pnpm。
- FR-201-016：插件的**更新/维护**（版本更新、启用停用、分组/备注/收藏等）MUST 沿用市场既有能力；其中涉及安装的动作同样经 FR-201-013 的进程内通道。
- FR-201-017：当宿主未提供 `desktopProfiles` 契约时（例如市场版本变化），系统 MUST 显式记录安装通道不可用（不静默）；可降级为 012 的 Route 2（市场补丁）或明确报错。
- FR-201-018：系统 MUST 在构建期断言市场版本与固定常量（`1.66.7`）一致；不一致即失败（落实于 012 的 `assertDshMarketVersion()`）。

## 4. 关键实体

| 实体 | 描述 | 关键属性 |
|------|------|----------|
| dsh-market 产物（dshmarket） | 内置的插件市场包 | `lib/`（host half）、`client/`（browser half）、`cordis.patch.yml`（insert 声明）、`package.json`（name=dshmarket） |
| 市场运行时依赖闭包 | 复制到市场自身 `node_modules` 的第三方依赖 | `undici`、`js-yaml`、`argparse` 等（`@deepseek-ai` 从宿主解析） |
| desktop profile 声明 | 加载市场所用的 profile 组合 | `dsh.profile.bundles`（含 `dshmarket`）+ `dependencies.dshmarket` |
| 市场运行配置（MarketConfig） | 注入到 market 行的配置 | `profile: 'desktop'`、`allowRestart: false` |
| 双解析锚点 | 市场 host/client 两个半体的解析位置 | ① bundle loader 锚点 `DSH_ROOT/node_modules/dshmarket`；② client 扫描锚点 `$DSH_HOME/profiles/node_modules/dshmarket` |
| desktopProfiles 服务 | 宿主提供给市场的进程内包管理器契约 | `current.dir`（profile 目录）、`desktopPnpm`（`DesktopPnpmLike`）、`pluginActivation` |
| DesktopPnpmLike | 一次安装操作的契约 | `runPlugin(args, invokingDir, signal)` → 句柄 `{stdout, stderr, done, cancel}` |

## 5. 验收场景

### 场景：构建后市场产物就位
- Given 同级市场工程 `../dsh-market` 已 checkout 且 node_modules 缺失
- When 执行构建脚本（build-dsh 阶段）
- Then 市场工程执行 `npm install` + `npm run build`，产出 `lib/` 与 `client/`

### 场景：收集期物化市场（含运行时依赖）
- Given 市场已构建，dsh 产物收集脚本执行
- When `collectDshMarket()` 运行
- Then `dsh-dist/node_modules/dshmarket` 含 `package.json`、`cordis.patch.yml`、`lib/`、`client/`；其 `node_modules` 含运行时依赖（如 `undici`），不含 `@deepseek-ai/*`

### 场景：市场工程缺失时收集硬失败
- Given `../dsh-market/package.json` 不存在
- When 收集脚本执行到物化市场步骤
- Then 脚本输出明确错误并 `process.exit(1)`

### 场景：市场版本不一致时构建失败
- Given 市场实际版本 ≠ 固定常量 `1.66.7`
- When 执行收集/构建脚本
- Then 版本断言失败并 `process.exit(1)`

### 场景：启动后市场复制到 profile
- Given 部署产物已解压到 `userData/dsh-dist`，`$DSH_HOME/profiles/node_modules/dshmarket` 不存在
- When Host 启动（`startHost()` 调用 `ensureDshMarketProfileLink`）
- Then dshmarket 被复制到 `$DSH_HOME/profiles/node_modules/dshmarket`（真实文件复制，非 symlink）；重复启动跳过

### 场景：设置页出现插件市场（自动加载）
- Given 应用启动、dsh Host 就绪、窗口加载
- When 用户打开设置页
- Then 出现「插件市场」入口，能浏览社区目录

### 场景：市场一键安装插件（进程内）
- Given 应用运行、市场打开、宿主已提供 `desktopProfiles` 契约
- When 用户点某纯 npm 插件的「安装」
- Then 市场经 `desktopPnpm.runPlugin` 进程内完成安装；插件落盘于 profile 的 `node_modules`；无 node/pnpm 子进程；UI 显示成功

### 场景：市场卸载插件
- Given 某插件已安装
- When 用户点「卸载」
- Then 进程内 `remove` 完成；`node_modules/<pkg>` 消失；`dsh.profile.bundles` 相应行移除

### 场景：市场不擅自重启
- Given 市场需要「重启生效」的场景
- When 触发变更
- Then 市场显示待重启提示，但不 spawn 独立 dsh 进程（`allowRestart: false`），由桌面壳关窗/重开完成生效

## 6. 非功能需求

- **幂等性**：构建、收集物化、运行期复制、版本断言均 MUST 可重复执行。
- **健壮性**：收集阶段市场缺失或版本不符 MUST 硬失败；运行期复制失败 MUST 不阻塞启动（warn）。
- **体积**：市场产物与其运行时依赖（`undici` 等）增加部署包体积，属可接受代价；不复制 `@deepseek-ai` scope 与源码/测试/devDeps 以控制体积。
- **安全**：`allowRestart: false` 关闭市场的进程重启能力；市场 API 仅接受同源 loopback 请求（沿用 dsh-market 既有约束）；安装通道 `ignoreScripts`（由 012 保证）。
- **可维护性**：市场作为 sibling 源码引用，随其 tag 迭代；版本集中固定并断言；安装通道走市场已内置契约（不 patch），降低升级耦合。

## 7. 假设与约束

- **假设**：dsh-market 为本工程同级目录源码引用 `../dsh-market`（submodule 固定 commit，实际版本 `1.66.7`）。`[源码]`
- **假设**：市场默认 profile 为 `web`（`config?.profile ?? argvProfile() ?? 'web'`），本工程用 `desktop`，须显式注入，否则安装/删除写错目录。`[源码]`
- **假设（已决议，替代旧 [NEEDS CLARIFICATION]）**：市场在 `config.profile: desktop` 下若宿主提供 `desktopProfiles` 服务，则走 `desktopPnpm` 进程内通道（`dsh-market/src/index.ts:183,285-292`；`dsh-cli.ts:577-608`）。宿主侧由 [`012-pnpm-integration`](../012-pnpm-integration/) 提供该契约的实现。固定版本 1.66.7 已含该分支。`[源码]`
- **约束（鸿蒙沙箱禁 symlink）**：运行期复制到 `$DSH_HOME/profiles/node_modules/dshmarket` 采用 `cpSync`（复制）而非 symlink。
- **约束（无子进程）**：市场的安装/卸载 MUST NOT 通过 spawn node/pnpm 子进程完成（应用域 SIGSYS）；由 012 的进程内引擎承担。
- **约束（功能边界）**：`git:` 源插件、依赖 lifecycle 构建脚本的插件不可安装（设备无 git；`ignoreScripts`）；须在 UI/文档披露。
- **约束（无便携 ELF 运行时）**：本工程不内置便携 Node/pnpm 的 ELF（路径 A 已撤回，需二进制证书）；安装通道依赖纯 JS 引擎（路径 B）。

## 8. 依赖

**上游（被本模块消费）**：

- dsh-market（`../dsh-market`，submodule，固定版本 **`1.66.7`**）——内置对象与契约提供方。构建前必须与本工程同级 checkout；`build-dsh.mjs` 缺失 node_modules 时 `npm install` + `npm run build`，`collect-dsh.mjs` 物化其 `lib/`+`client/`+`cordis.patch.yml`+`package.json` 为 `dsh-dist/node_modules/dshmarket`，缺失或不符版本则硬失败。
- deepseek-harness（`../deepseek-harness`）——dsh Host，提供 `dsh.client` 机制、`cordis.patch.yml` 补丁层、profile 目录约定、`dsh.profile.bundles` 维护函数、插件发现机制；市场的 `@deepseek-ai` 依赖从其物化产物解析。

**下游 / 本工程模块间依赖**：

- [`012-pnpm-integration`](../012-pnpm-integration/)：提供进程内 pnpm 引擎与 `desktopProfiles`/`desktopPnpm` 契约实现。**本模块的安装通道依赖它**。
- `005-build-pipeline`：本模块的市场构建与物化落点在 `build-dsh.mjs` / `collect-dsh.mjs`。
- `006-runtime-profile`：本模块扩展其 `profiles/desktop/package.json`（bundles + dependencies）与 `cordis.patch.yml`（market 行 config）。
- `001-host`：本模块在 `startHost()` 前经 `ensureDshMarketProfileLink()` 复制市场到 profile；并承载 012 的契约注册接线。

---

*事实以源码为准；版本固定后随变更同步。*
