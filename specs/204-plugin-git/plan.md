# git 插件（工程内专用）技术方案

> Module: 204-plugin-git
> Status: Specified
> Last Updated: 2026-10-16
> 对应规格：[specs/204-plugin-git/spec.md](./spec.md)
> 设计来源：[docs/204-插件-GIT.md](../../docs/204-插件-GIT.md)（已评审通过的设计文档，唯一内容权威）

## 1. 技术上下文

### 1.1 运行时环境

- **构建期**：Windows 宿主机 Node（`node scripts/*.mjs`）；依赖物化在 `collect-dsh.mjs`（内含一次幂等的 npm/pnpm 拉取）；HAP 打包由 hvigor（DevEco 工具链）承担。
- **运行期**：Electron-on-鸿蒙（Electron 37 / Node 22.17.0）主进程内的 dsh Host。插件是 in-process Cordis 插件，不独立成进程；isomorphic-git 与 jsdiff 都是纯 JS，在主进程内动态 `import`。
- **设备现状**：设备**无 `git`**（toybox 不提供，`git:` 源也装不了）；设备在线、网络可达外网；应用已安装；主进程已带 `--inspect`（9229）。
- **部署形态**：插件源码 → `dsh-dist/node_modules/harmony-plugin-git/` + `dsh-dist/node_modules/isomorphic-git[/node_modules]/` + `dsh-dist/node_modules/diff` → `dsh-dist.tar.gz` → resfile → 首启解压到 `$DSH_HOME/dsh-dist` → 运行期镜像到 `$DSH_HOME/profiles/node_modules/`。
- **父工程改动 = 0**（D8）；ArkTS 侧零改动；不新增任何 dsh 补丁。

### 1.2 本机工具链与构建前置（实测事实，对应设计文档 §19 R12）

> 本节事实**全部来自真机/本机实测**，不是推算。忽略它们会得到「命令成功、产物未更新」这类无诊断信息的失败。

| # | 事实 | 操作要求 |
|---|---|---|
| 1 | **本机工具链路径与脚本默认值不同** | HAP 构建必须显式传参：`-Hvigorw D:\oh-workspace\command-line-tools\bin\hvigorw.bat -DevEcoHome "D:\oh-workspace\DevEco Studio"`（`scripts/build-debug.ps1` / `scripts/build-hap.ps1` 会把额外参数原样透传） |
| 2 | `scripts/collect-runtime.mjs` 需要 `DEVECO_SDK_HOME` | 未设置即 `fail('DEVECO_SDK_HOME 未设置，无法注入 libc++_shared.so')`；构建环境必须先 `export DEVECO_SDK_HOME=<sdk 根>` |
| 3 | **装机前必须清设备 `$DSH_HOME/dsh-dist`** | `ensureDshExtracted()` 只比对解压 marker，**marker 命中即跳过解压** → 不清就会继续跑旧产物（旧插件副本、旧依赖、旧 profile 行）。这是本模块最易踩的坑 |
| 4 | 签名材料已入位（2026-10-16） | `~/.ohos/config/` 下的 `default_….{cer,p12,p7b}` 三件套；`p7b` 的 `bundle-name` 与 `allowed-acls`（含 `ALLOW_WRITABLE_CODE_MEMORY`）已核对；`build-profile.json5` 内联 `signingConfigs`，`hvigorfile.ts` 在**无本地签名文件时不覆盖**它，故直接生效 |
| 5 | 交付形态全链已实测通过 | `collect-runtime` → `build-dsh` → `collect-dsh` → `tar`（286 MB 基线）→ `scripts/build-debug.ps1` = `BUILD SUCCESSFUL` + 签名 HAP 492.4 MB + 签名自检一致；`hdc app install -r` 成功 |
| 6 | `collect-dsh.mjs` **已有 dsh-market 版本断言** | `assertDshMarketVersion()`（`DSH_MARKET_VERSION = '1.66.7'`，不符即 `process.exit(1)`）；`collectGitRuntime()` 的版本断言照此形状（同文件另有 `assertPnpmEngineArtifact()` / `PNPM_VERSION = '10.34.6'` 先例） |
| 7 | **注入 harness 不是交付形态** | 直接把插件写进设备 `$DSH_HOME/dsh-dist` 只用于提前验证行为（R2 由此路径通过）；最终仍须经 `collectGitRuntime()` + `collectPlugins()` + tar + 签名出包，否则包内不含插件、重装即失效 |

### 1.3 依赖

| 依赖 | 来源 | 用途 |
|---|---|---|
| `@deepseek-ai/cordis` | 宿主 `dsh-dist/node_modules`（`peerDependencies`） | 插件框架 |
| `@deepseek-ai/dsh-tools` | 同上 | 工具注册（`defineTool`） |
| `@deepseek-ai/dsh-fs` | 同上 | `ctx.fs.resolve` / `processPath`（仓库根解析） |
| `@deepseek-ai/dsh-sandbox` | 同上 | 围栏标记与一次性提权（与 `harmony-plugin-fs-mutate/lib/sandbox.js` 同形） |
| `@deepseek-ai/dsh-credentials` | 同上 | 凭据库读取（`ctx.credentials.resolve`） |
| `@deepseek-ai/schemastery` | 同上 | `Config` schema |
| `isomorphic-git@1.44.2`（+ `isomorphic-git/http/node`） | `collectGitRuntime()` 物化 | git 原语实现 |
| `diff@8.0.2`（jsdiff） | `collectGitRuntime()` 物化 | unified diff（零依赖） |
| `node:fs/promises` | Node 内置 | 仓库根 chroot 适配器的落盘层 |
| `remote.credentials`（client 面） | 宿主设置面既有 API | 凭据设置页读写 |

> 插件为纯 ESM、**无构建步骤**（`lib/` 即发布源码）、`private: true`、不发布到 registry。`isomorphic-git` 与 jsdiff **不**写进 `peerDependencies`（它们不是宿主提供的），而由构建期物化落到 `dsh-dist/node_modules/`。

## 2. 宪法合规检查

| 宪法原则 | 状态 | 说明 |
|---|---|---|
| §1.1 零上游改动 | ✅ | 不改 dsh 源码、不加补丁；仅新增本工程插件 + 收集脚本一步 |
| §1.2 进程内 Host | ✅ | 全部工作在主进程 Node 内 |
| §1.3 只写装配代码 | ⚠️ | 工具 / 适配器 / 围栏是**插件自有业务逻辑**（同 fs-mutate 与 workspace-picker 的性质），不涉及壳装配改造 |
| §1.4 同源数据面 | ✅ | 工具经既有 tools 注册表；设置页经既有 `remote.credentials` API；**不新增 RPC 载体** |
| §2.1 安全围栏语义不可破坏 | ✅ | 不动 loopback 围栏；提权仍走既有 approval 链路 |
| §2.2 沙箱边界 | ⚠️ | git 仓内部写入不经 `fs-sandbox.checkedTarget`（spec FR-4.5 已如实声明，与 exec 同级且比它更严） |
| §3.2 类型安全 | ✅ | 纯 ESM JS（与既有插件一致），无 `any` 强转；ArkTS 侧零改动 |
| §3.3 日志规范 | ✅ | 诊断走 `[dsh-harmony]` 前缀；**凭据明文绝不进日志** |
| §5.3 产物适配集中在收集脚本 | ✅ | 依赖物化全部在 `collect-dsh.mjs` |
| §6 规格 WHAT / 方案 HOW 分离 | ✅ | 设计文档为 docs/ 单文件设计（体例同 203）；本模块派生 `specs/204-plugin-git/` 四件套 |
| §6 治理：提交前缀 | ✅ | 提交一律用 Conventional Commits 前缀，不加 AI 署名 |

> 两个 ⚠️ 是**如实登记的性质**，不是未解决的违规：它们的缓解分别是「围栏收窄为仓库根单点且比 exec 更严」与「插件自有业务逻辑不改造壳装配」。

## 3. 命名约定与身份落点

插件身份落点必须同时一致；漏一处或选错平面即表现为交付物部分失效（设置页永不出现）或装配失败。

| # | 落点 | 文件 | 取值 |
|---|---|---|---|
| 1 | 目录名 | 文件系统 | `harmony-plugin-git` |
| 2 | 包名 | `plugins/harmony-plugin-git/package.json` | `harmony-plugin-git` |
| 3 | 插件 `name` 导出 | `plugins/harmony-plugin-git/lib/index.js` | `harmony-plugin-git` |
| 4 | **profile 行 `name`（运行时导入说明符）** | `profiles/desktop/cordis.patch.yml`（`- insert:`） | `harmony-plugin-git` |
| 5 | profile 行 `id` | 同上 | `git`（稳定身份，不随包名变化） |
| 6 | client 面入口 | `package.json` 的 `exports["./client"]` | `./lib/client.js` |
| 7 | 设置页 section id | `lib/client.js` | `git-credentials` |
| 8 | 依赖落位 | `dsh-dist/node_modules/…` | `isomorphic-git/` + `isomorphic-git/node_modules/` + `diff` |

**与 202/203 的关键差异**：本插件**不**写 `HARMONY_ENSURED_PRESET_ROWS`（两处都不写），因此

- `assertPresetRowsMirrorMainJs()` **不涉及**本插件（它比对的是那两处 preset 表）；
- 该插件的可解析性**不**由 preset discovery 判定，而由 **profile Loader 相对于 profile `baseUrl` 解析裸包名**判定 —— 因此 `ensureDshPluginsProfileLink()` 的镜像仍是**必需**的（`profiles/node_modules/harmony-plugin-git/` 必须存在）；
- 装配差异必须登记（spec FR-2.2）：`plugins/README.md` 原位新增一节「需要 client 面的插件走 host 行」。

**包名令牌一致性**：`lib/*.js` 的 JSDoc `@module` 名与错误文案前缀同样是名字令牌；插件目录内每一个包名令牌都必须等于 `harmony-plugin-git`。

## 4. 实现落点清单

### 4.1 插件本体（`plugins/harmony-plugin-git/`）

| 路径 | 职责 | 覆盖 FR |
|---|---|---|
| `package.json` | `name` / `private` / `type: module` / `main` / `exports`（含 `./client`）/ `dsh.client { platform: "web", inject: [...] }` / `peerDependencies` | FR-1.1、FR-1.2、FR-6.1 |
| `lib/index.js` | host 面入口：命名导出 `name` / `inject` / `Config` / `apply`（无 default export）；`apply` 装配 runtime → fence → fs-adapter → 21 个工具 | FR-1.3、FR-3、FR-10 |
| `lib/runtime.js` | isomorphic-git 与 jsdiff 的动态 `import` + 版本断言（与脚本 pin 一致） | FR-8.2 |
| `lib/fence.js` | 仓库根解析（`ctx.fs.resolve` → `processPath`）+ chroot 校验 + 提权决议（对齐 `FsMutationSandbox`：`sandboxDenialMarker` / `escalationHintMarker` / `ESCALATION_TARGETS` / `approveEscalation`） | FR-4 |
| `lib/fs-adapter.js` | isomorphic-git 的 fs 契约 → `node:fs/promises`，**逐路径** `join` + `normalize` + 前缀包含校验，越界即拒 | FR-4.1、FR-4.2 |
| `lib/auth.js` | key 名规整（`GIT_CREDENTIAL_<HOST>`）→ `ctx.credentials.resolve(ref)` → `onAuth` / `onAuthFailure`；缺凭据时的引导文案；`onAuthFailure` 最多重试 1 次 | FR-5.1、FR-5.2、FR-5.3 |
| `lib/diff.js` | jsdiff 封装：unified diff / `stat` 汇总 / 二进制（含 NUL）判定 | FR-7.2 |
| `lib/report.js` | 输出渲染：status 矩阵、提交摘要、冲突列表、错误归因文案 | FR-3、FR-9 |
| `lib/tools/*.js` | **21 个工具，一文件一工具**；写类工具带 `sandbox_permissions` + `justification`；全部经 `defineTool` 产出 | FR-3.1、FR-3.2、FR-3.3 |
| `lib/tools/git_{diff,show,revert}.js` | 三个自建能力的工具面（算法在 `lib/diff.js` 与工具内） | FR-7.1、FR-7.2、FR-7.3 |
| `lib/client.js` | client 面：注册 `settings.section`（id `git-credentials`，标题「Git 凭据」）；保存 / `describe` 回显 / 删除；`localStorage` 记忆 host 清单 | FR-6.1、FR-6.2、FR-6.3、FR-6.4 |
| `README.md` / `README_zh.md` | 配置项、凭据命名规则、围栏语义、Known Limitations（含 `rebase` 不支持） | FR-2.2、FR-9 |
| `tests/*.test.mjs` | 纯 Node 单测：key 名规整、chroot 校验、diff 渲染、status 分组、revert 冲突判定 | FR-4.2、FR-5.1、FR-7 |

### 4.2 构建期（`scripts/collect-dsh.mjs`）

| 位置（符号） | 职责 |
|---|---|
| `ISOMORPHIC_GIT_VERSION = '1.44.2'` / `JSDIFF_VERSION = '8.0.2'` | 版本 pin 常量（对齐既有 `DSH_MARKET_VERSION` / `PNPM_VERSION` 先例） |
| `collectGitRuntime()` | staging 里 `pnpm add isomorphic-git@… diff@… --config.node-linker=hoisted --ignore-scripts`；isomorphic-git 及其整棵闭包复制到 `dsh-dist/node_modules/isomorphic-git/node_modules/`；`diff` 落顶层 `dsh-dist/node_modules/diff`；断言入口非空 + 版本与 pin 一致；幂等（目标已有 `package.json` 即走快路径，**快路径同样跑断言**）；`finally` 里清 staging |
| `collectGitRuntime()` 的调用点 | 与 `collectPlugins()` / `collectMarketPNPM()` 同段（现有末尾调用区），保证在 dsh 自身的 `pnpm deploy`、`.pnpm` 清理、非目标架构 prebuilds 剪裁**之后**执行 |
| `collectPlugins()` | **不改**：`harmony-plugin-*` 通配自动发现本插件并物化到 `dsh-dist/node_modules/harmony-plugin-git/`（排除 `node_modules`，故插件不能自带依赖 —— 这正是 `collectGitRuntime()` 存在的理由） |
| `assertPresetRowsMirrorMainJs()` | **不涉及**本插件（本插件不进 preset 表） |

### 4.3 装配（`profiles/desktop/cordis.patch.yml`）

| 位置 | 职责 |
|---|---|
| `- insert:` 段 | 新增一行 `- id: git` / `name: harmony-plugin-git`，并就地注释说明「host 平面而非 preset 行是**有意例外**，理由见 `plugins/README.md` 与设计文档 §7.1」 |

> **不改 `src-main/main.js`**：不动 preset 行，全链路自动（`collectPlugins()` 通配物化 → `ensureDshPluginsProfileLink()` 镜像到 `profiles/node_modules/` → profile 种子文件每次启动用最新版覆盖）。

### 4.4 文档与规格

| 文件 | 内容 |
|---|---|
| `plugins/README.md` | **原位新增一节**「需要 client 面的插件走 host 行」（§二.7 的例外登记）；`四、现有插件` 增加本插件行 |
| `README.md` | 修正 inspector 章节的 `require` 用法（R11）；登记 §7.1 挂载例外与 204 模块 |
| `docs/工程规划.md` / `specs/README.md` | 登记 204 模块与 `specs/204-plugin-git/` 四件套 |
| `specs/204-plugin-git/{spec,plan,tasks,test-cases}.md` | 本模块四件套 |

## 5. 数据流

```
[构建期]
  dsh-desktop-hos/plugins/harmony-plugin-git/          ← 唯一真源（入库）
        │ collectPlugins()  按 harmony-plugin-* 通配物化（落地名取自 package.json 的 name）
        ▼
  dsh-dist/node_modules/harmony-plugin-git/            （gitignored）
        │ collectGitRuntime()  一次 pnpm 拉取（幂等）
        ▼
  dsh-dist/node_modules/isomorphic-git/                ← http/node 入口
  dsh-dist/node_modules/isomorphic-git/node_modules/   ← 整棵依赖闭包（55 包 / 8.6 MB）
  dsh-dist/node_modules/diff/                          ← jsdiff（零依赖 / 800 KB）
        │ collect-dsh.mjs 阶段 8：profiles/desktop → dsh-dist/profiles/desktop
        ▼
  dsh-dist.tar.gz ──► web_engine/.../resfile/resources/app/dsh-dist.tar.gz

[启动期]
  首次启动解压 dsh-dist → $DSH_HOME/dsh-dist        （marker 命中即跳过：装机前必须清）
  main.js profile 安装：每次启动用最新版覆盖 cordis.patch.yml 等种子文件
  runProfile('desktop')  叠加 profile patch：
        └ insert 行 git = harmony-plugin-git（host 平面）
  host Loader 装载该行 → apply() 注册 21 个工具（全局可见 → agent 可用）
  client-modules 扫描 host Loader entries → 发现 dsh.client
        → client 面纳入 __DSH_BOOT__ 启动图 → 设置页「Git 凭据」出现

[交互期（模型调用）]
  工具调用(dir, …)
    ├ fence.js:    ctx.fs.resolve → processPath → 仓库根
    │               └ 越出工作区 → FsError(FS_SANDBOX_DENIED) + 提权提示
    │                              └ 模型带 sandbox_permissions + justification 重试
    │                                 → approveEscalation → 用户审批 → 继续（一次性）
    ├ runtime.js:  isomorphic-git 动态装载（版本断言）
    ├ fs-adapter.js: 全部文件 IO 在仓库根内（逐路径 chroot 校验）
    ├ auth.js:     需要认证时 → ctx.credentials.resolve(ref) → onAuth
    └ report.js:   结构化结果 → 模型可读文本

[交互期（设置页）]
  settings.section「Git 凭据」(client.js)
    ├ 输入 host / 用户名 / 密码 → ctx.remote.credentials.set(ref, "user:pass")
    ├ describe(refs) 回显 configured / source / writable（永不返回值）
    ├ unset(ref) 删除
    └ host 列表由 localStorage 记忆（凭据 API 无法枚举 ref）
```

## 6. `dsh-dist` 更新生效条件

设备只有在**重新解压 `dsh-dist`** 后才会看到新的插件与依赖集合：

1. `ensureDshExtracted()` 只比对解压 marker，不比对版本或内容 hash；新旧 tar 都含该 marker → **命中即跳过**。
2. **就地升级**（覆盖安装 / `hdc app install -r`、保留 `$DSH_HOME/dsh-dist`）因此不会重解压，设备继续用**旧** `dsh-dist` 里烘焙的旧 profile 行与旧插件 / 旧依赖副本 —— 本模块新增的 `isomorphic-git` / `diff` 都不会出现，插件 `apply()` 的版本断言会失败或工具全不可用。
3. 本模块**不改** `ensurePresetRows()` 相关语义（本插件不进 preset 表），故该既有缺口不影响本模块；但 `ensureDshPluginsProfileLink()` 的「源集合为空时不复制也不清理」提前返回仍是**安全属性**，不得「修正」。

**操作要求（强制）**：装机前**必须清设备 `$DSH_HOME/dsh-dist`**（同时清 `$DSH_HOME/profiles/node_modules/` 下的同族陈旧副本只由启动期镜像自动完成）。这是本模块构建—装机流程里的**固定一步**，写进 tasks.md（T22）与 test-cases.md（TC-B6）。

## 7. 风险与缓解

| # | 风险 | 影响 | 缓解 |
|---|---|---|---|
| R1 | ~~出网 POST 未实证~~ → **已于 2026-10-15 真机 PoC 证实可用** | 无（原风险消除） | **已完成**：公网 HTTPS POST 回显 200 且请求体送达；内网 GIT 主机 `GET /info/refs` 与 `POST /git-receive-pack` 均返回 401（Basic 认证门），证明 DNS/TCP/HTTP/POST 全通且**未产生写入**。带账号写入路线成立 |
| R2 | ~~**host 平面挂载 + 工具全局可见**未实测~~ → **已于 2026-10-16 真机 PoC 证实通过** | 无（原风险消除） | **已完成**：注入最小插件 + host 行后重启，hilog 显示「已复制 harmony-plugin-git → profiles/node_modules」与插件自报注册成功；真实会话中模型成功调用该工具。**单 host 行架构成立**，无需退回双包备选装配。**烘焙行独立复证**：以真实插件 + profile `- insert:` 行重建并装机后，`--inspect` 读到工具表含探针工具，且 host 平面 `tools` / `fs` / `sandboxPolicy` / `credentials` / `authorization` **五项全部在位** |
| R3 | clone 大仓库超时 / 内存峰值（纯 JS 解 packfile） | 操作失败或主进程卡顿 | 暴露 `depth` / `singleBranch` 参数；`signal` 全程透传；文档给建议值；作为真机测试的观察项 |
| R4 | **默认分支推送污染共享仓库**（D6 裁决，评审确认保留） | 远端默认分支多出一个提交 | 执行前当轮明确点名 AW-5 并给出回滚方式；文档登记该副作用（test-cases.md §4.2 注） |
| R5 | hmfs/hmdfs 语义差异影响 git（大小写不敏感、无硬链接；`.git` 落在工作区 hmfs） | 同名不同大小写文件可能冲突 | 作为真机测试观察项；失败如实报错，不掩盖 |
| R6 | isomorphic-git 版本升级带来行为变化 | 工具行为漂移 | 版本 pin 为脚本常量 + 装载时断言（`lib/runtime.js`）；升级需同步 `docs/` 与本模块文档 |
| R7 | 设置页 `dsh.client` 的 `inject` 声明与服务端设置面不匹配 | 启动期报错或页面空白 | `inject` 逐个对齐 `ui-settings-models` 的既有声明（`remote.credentials` 等）；AC-3 覆盖 |
| R8 | 凭据值格式（`user:pass`）在密码含 `:` 时的切分 | 认证失败 | 固定按**第一个** `:` 切分并在设置页就地说明；AC-5 覆盖 |
| R9 | dsh 上游升级改变 `ctx.fs` / tools 作用域语义 | 装配或围栏失效 | 依赖 host 平面全局注册语义（F3）在升级时重新核对；AC-1 / AC-2 作为回归门 |
| R10 | **内网仓库是明文 `http://`** —— Basic 凭据以 base64 明文过网 | 凭据可被链路中间人截获 | 如实登记并提示：生产环境应改用 HTTPS；插件侧不额外持久化明文（FR-5.4） |
| R11 | **inspector 全局作用域无 `require`**（真机实测） | 既有 `--inspect` 操作手册与脚本失效，测试期易误判为「功能不可用」 | 全部测试脚本改用 `process.mainModule.require`；同步修正 `README.md` 的 inspector 章节（落点 4.4） |
| R12 | ~~本机缺本 bundle 的签名材料~~ → **已解决（材料 2026-10-16 入位）** | 无（原风险消除） | 签名材料已入位并核对；**交付形态全链实测通过**；⚠️ **本机工具链路径与脚本默认值不同**、`collect-runtime.mjs` 需 `DEVECO_SDK_HOME`、**装机前必须清设备 `$DSH_HOME/dsh-dist`** —— 三条操作要求见 §1.2 |
| R13 | **注入 harness 不是交付形态**（插件直接被写入设备 `$DSH_HOME/dsh-dist`） | 若把它当作交付路径，包内不含插件、重装即失效 | 明确定位为**验证手段**：最终仍须经 `collectGitRuntime()` + `collectPlugins()` + tar + 签名出包；harness 仅用于提前验证行为（§1.2 #7） |

## 8. 验证策略

| 层 | 手段 | 覆盖 |
|---|---|---|
| 单元（构建机） | 插件内纯函数单测（key 名规整、chroot 校验、diff 渲染、status 分组、revert 冲突判定） | spec FR-4.2、FR-5.1、FR-7 |
| 静态 | `node --check` 校验改动过的 `.js` / `.mjs`；`grep` 核对包名令牌与 profile 行 | FR-1.4、FR-2 |
| 构建期 | `collectGitRuntime()` 产物断言 + 嵌套落位核对 | AC-11、AC-12 |
| 构建期 | `build-debug.ps1` 自带签名断言（profile type 必须匹配 `-SignMode`） | 打包 |
| 真机 `--inspect` | CDP `Runtime.evaluate` 读插件树、工具表、`ctx.credentials`、`.credentials.yaml`。**注意：inspector 全局作用域下 `require` 不可用**（Electron 37.2.0 / Node 22.17.0 实测），脚本须用 `process.mainModule.require(...)` 取模块。**此外 inspector 触达不到 `ctx`**（无全局 host 句柄），故运行期自证须由插件侧 `console.log`（落 hilog）承担 | AC-1、AC-2、AC-8、R2、R11 |
| 真机 UI | 设置页走查（保存 / 回显 / 删除）+ 审批面板走查 | AC-3、AC-6 |
| 真机注入 harness | 经 `--inspect` 把插件写入设备 `$DSH_HOME/dsh-dist/node_modules/` 并追加 host 行（**先备份、幂等、可回滚**），重启后应用自动镜像并加载。用于在**没有签名材料**时提前验证插件行为；**不是交付形态**（R13） | AC-1、AC-2、AC-4、AC-5、R2 |
| 真机对话驱动 | CDP 驱动渲染进程：`Input.insertText` 注入 composer + 按 `aria-label="发送消息"` 触发，轮询 `document.body.innerText` 取结果 | AC-4、AC-5、AC-7、AC-9、AC-10 |
| 真机对话 | 操作清单逐项执行（无账号 / 带账号两节，见 test-cases.md §4） | AC-4、AC-5、AC-7、AC-9、AC-10、AC-13、AC-14 |
| 回归 | 既有插件（fs-mutate / fs-search / exec / workspace-picker）功能不受影响；会话创建正常 | AC-1 |

## 9. 关键决策记录

| # | 决策 | 备选 | 理由 |
|---|---|---|---|
| D1 | 交付形态 = **工具集 + 凭据设置 UI** | 只交工具 / 只交 UI | 用户故事同时要求「对话里能 git」与「填一次凭据」 |
| D2 | 功能边界 = **核心链 + 高级操作** | 只做核心链 | `rebase` 不可交付（isomorphic-git 无原语），其余高级操作（merge / cherry-pick / stash / tag / reset）成本可接受 |
| D3 | 仓库位置 = **会话工作区 + 用户目录** | 仅会话工作区 | 用户目录已在 `DSH_EXTRA_WRITABLE_ROOTS` 内，审批后可用；不做整盘浏览 |
| D4 | 凭据形式 = **HTTP(S) 用户名 + 密码** | SSH 密钥 | isomorphic-git 无 SSH 客户端（全库唯一 ssh 处理是 URL 改写，且**丢弃用户名**）；`git@host:path` 转 https 后走同一路径 |
| D5 | 凭据存放 = **仅凭据库 + 设置页** | 明文入 `cordis.yml` / 环境变量 | 明文不进对话、不进日志、不进 config；设置页与手编 `.credentials.yaml` 落到同一处 |
| D6 | 带账号仓库写权限 = **完整读写，含默认分支** | 只允许测试分支 | 评审裁决保留；副作用（R4）如实登记并在执行前点名 |
| D7 | **专用插件** `dsh-desktop-hos/plugins/harmony-plugin-git/` | 放进父工程通用目录 | 依赖本壳运行期适配（工具注册面、profile、sandbox 链路），不满足通用插件判定标准 |
| D8 | 父工程改动 = **0** | 改父工程 | 全部工作在本工程内闭合 |
| D9 | `diff` 缺口 = **引入 jsdiff**（零依赖纯 JS） | 自研 diff | 零依赖、体积 800 KB；自研等于重写 Myers 与补丁格式化 |
| D10 | 依赖供给 + 文件访问 = **嵌套依赖物化 + 仓库根 chroot 适配器**（方案 A） | B 扩 `ctx.fs` seam（需 5~6 个新补丁、逐次 `resolve` 含 realpath + 围栏判定、适配 `FsTarget` 身份 / `FsWriteIntent` 版本守卫）；C 插件内 vendored 单文件 bundle（生成物入库，违反「纯 ESM 无构建步骤」） | B 被补丁链上下文约束与性能/适配成本双重否决；C 违反插件约定且升级要手工重打。A 上游改动 0、新增补丁 0、围栏单点、chroot 内直连 `node:fs` |
| D11 | 挂载平面 = **host 平面单行** | 沿用 `HARMONY_ENSURED_PRESET_ROWS` | `dsh.client` 只从 host Loader entries 扫描（preset 行扫不到），而 host 平面注册的工具对 agent 可见（`restrict()` 需 scoped context，全库仅两处调用，preset 不做 restrict）→ 一行两全。**这是对 §二.7 的有意例外**，须原位登记 |
| D12 | 工具粒度 = **一动词一工具（21 个）** | 单 `git` 工具 + `command` 枚举 | 与工程惯例一致（一工具一职责）；模型按名选工具 + 精确 schema 更可靠；**可独立验收**（一个工具一组测试用例，直接支撑 AC-13） |
| D13 | HTTP 客户端 = **`isomorphic-git/http/node`** | `http/web`（全局 `fetch`，依赖 55 → 12 包 / 6.3 MB） | Node 路径是官方推荐路径，POST/chunked 行为更可预期；体积差异不值得承担 `fetch` + 流式请求体（`duplex: 'half'`）的不确定性 |
| D14 | jsdiff **不裁剪**（保留 55 包 / 8.6 MB） | 裁 `index.cjs` + `index.umd.min.js` + map（约省 3.6 MB） | 裁剪第三方包内容属额外维护面 |
| D15 | 身份默认值 = `{ name: 'yourname', email: 'yourname@somehost' }` | 真实个人信息 | 刻意使用明显占位值；身份不是密钥，不进凭据库，由 `git_config` 写仓库本地配置 |

## 10. 待确认

设计文档 §21 的 8 项议题已于 2026-10-15 全部裁决，其中：

- #1 §17.2 带账号写入清单：**保留 AW-1…AW-6 全部**，含 AW-5 默认分支推送；AW-4 远端标签默认保留（test-cases.md §4.2 已单独标注 AW-5 的不可自动回滚副作用）。
- #3 `dsh.client` 的 `inject` 精确清单：待 R2 实测后按 `ui-settings-models` 既有声明对齐 —— R2 已于 2026-10-16 通过，实施时逐项对齐即可（FR-6.4）。
- #7 §17 覆盖缺口：已补 AN-18 / AN-19 / AN-20 / AN-21（AC-13、AC-14）。

**本模块无遗留待确认项。** 设计文档 §19 R1 / R2 / R12 已全部转为「已完成 / 已解决」，仅剩 R3 / R5 两类需在真机测试期观察的项（已列为 test-cases.md 的观察项）。
