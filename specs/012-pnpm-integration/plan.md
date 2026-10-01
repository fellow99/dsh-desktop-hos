# 012-pnpm-integration 技术方案

> 模块：012-pnpm-integration
> 对应规格：[spec.md](./spec.md)
> Status: Design（实现中）
> Last Updated: 2026-10-02
> 方案基础：[`docs/012-pnpm+dsh-market.md`](../docs/012-pnpm+dsh-market.md)（讨论过程与决策）、[`docs/pnpm对接问题排查.md`](../docs/pnpm对接问题排查.md)（平台事实）

## 1. 技术上下文

### 1.1 运行时环境

- **宿主**：Electron-on-鸿蒙（Electron 37 / Node 22.17.0）主进程；本模块的进程内 pnpm 在同一主进程内运行。
- **平台**：`openharmony` / `arm64`；应用域 `fork` 出的子进程被 seccomp `SIGSYS` 杀死（B★）；`symlink`/`hardlink` 被禁（B1）。
- **部署形态**：`dsh-dist.tar.gz` → resfile → 首启解压到 `userData/dsh-dist`。
- **构建期**：Windows 宿主机 Node（`node scripts/*.mjs`）；`collect-dsh.mjs` 负责物化。

### 1.2 依赖

| 依赖 | 来源 | 用途 |
|---|---|---|
| `pnpm` 包（11.28.3 线，完整 CLI bundle） | npm registry（构建期物化） | 进程内安装引擎。**spike 已证实**：物化整个 `pnpm` 包，进程内 `import('.../dist/pnpm.mjs')`。（`@pnpm/installing.deps-installer` 独立安装因 `@yarnpkg` 的 `patch:` 依赖不可行 —— 见 spike 结论） |
| deepseek-harness（`../deepseek-harness`，dsh-v0.2.0-rc.2） | sibling 源码引用 | profile 目录约定、`dsh.profile.bundles` 维护函数、插件发现（**不改源码**） |
| dsh-market（`../dsh-market`，固定 1.66.7） | sibling/submodule 源码引用 | `desktopProfiles` / `desktopPnpm` 契约（**不改源码**） |
| 011 的 `src-main/market-runtime.js` | 本工程 | `BUNDLED_PNPM_PACKAGE`/`BUNDLED_PNPM_ENTRY_REL` 常量、路径 B 探测、`isParsableJs` 校验 |

> 本模块不新增 npm 运行时依赖到工程 `package.json`：pnpm 引擎由构建脚本物化进 `dsh-dist`，不进宿主依赖树（对齐 011 决策 D15）。

## 2. 宪法合规检查

| 宪法原则 | 状态 | 说明 |
|---|---|---|
| §1.1 零上游改动 | ✅ | 不改 dsh-market / dsh 源码（Route 1，实现市场已内置契约） |
| §1.3 只写装配代码 | ✅ | 物化 + 进程内调用 + 服务注册，不新造业务逻辑 |
| §2.2 沙箱边界 | ✅ | storeDir/安装均落在沙箱内；不触碰系统目录 |
| §3.1 源码即真理 | ✅ | 所有符号/行号来自实测源码；`未验证` 项显式标注 |
| §3.3 日志规范 | ✅ | 统一 `[dsh-harmony]` 前缀 |
| §4.2 崩溃兜底 | ✅ | 运行时初始化失败不阻塞启动；`process.exit` 拦截防主进程崩溃 |
| §5.1 幂等构建 | ✅ | 物化/配置注入幂等 |
| §5.3 产物适配集中在收集脚本 | ✅ | pnpm 引擎物化集中在 `collect-dsh.mjs` |
| §6 治理规则 | ✅ | spec/plan 成对；提交用 Conventional Commits 前缀 |

## 3. 研究结论

- **为什么只能进程内**：`spawn` 出的 node/pnpm 子进程在应用域被 SIGSYS（B★）；Electron 主进程自身能跑 JS，故把 pnpm 的 JS import 进主进程是唯一可行路线（011 路径 B）。
- **进程内引擎（spike 已证实）**：采用 **`pnpm` 包本身**（`pnpm@11.28.3`，单包、纯 ESM、自带打包 CLI `dist/pnpm.mjs`）。进程内**以 CLI 方式**调用：设置 `process.argv`（`add|remove … --dir <profile> --reporter=…`）+ 缓存击穿 import（`?v=<ts>`，否则 ESM 缓存使第二次调用不重跑）。`@pnpm/installing.deps-installer` 独立安装因其 `@yarnpkg` 传递依赖携带 yarn `patch:` 规格而不可行（spike 实测）。详见 `logs/20261002-1/spike-pnpm-FINDINGS.md`。
- **symlink/hardlink 规避**：pnpm 默认 `isolated` 布局建 symlink + `.pnpm` hardlink，均被 B1 禁；改用 `nodeLinker: hoisted`（扁平、无 `.pnpm` 虚拟 store）+ `packageImportMethod: copy`。dsh 自身 `initProfile` 写出的 profile 本就是 `nodeLinker: hoisted`（`packages/boot/app-boot/src/profile.ts:230-235`），形态一致。
- **配置位置**：pnpm v11 起除 auth/registry 外设置写 `pnpm-workspace.yaml`（camelCase），不再读 `.npmrc`。
- **进程内陷阱**：pnpm 引擎可能调 `process.exit`（须包装）、期望独占 `process.argv`（须保存恢复）、lifecycle 脚本会 spawn 子进程（须 `ignoreScripts`）。
- **市场契约**：市场通过 `ctx.get('desktopProfiles')` 特性检测（`dsh-market/src/index.ts:183`），从上下文取 `desktopPnpm`（`:291`）并 `createDesktopPluginRuntime(service, current.dir)`（`:292`）；`DesktopPnpmLike.runPlugin` 契约见 `dsh-cli.ts:577-608`。**无需改市场源码**。
- **装载不依赖 pnpm**：dsh 的插件发现只要求 `node_modules/<name>/package.json` 可达（`profile.ts:600-641`）；`dsh.profile.bundles` 增删可进程内调用（`profile-plugins.ts:86-127`、`index.ts:715-735`）。故进程内 pnpm 只需覆盖「装文件」半程。
- **build 前置版本不一致（须修）**：submodule 1.66.7 vs README/profile `1.26.0` vs spec 201 `1.29.2`；`build-dsh.mjs`/`collect-dsh.mjs` 无版本校验。`[源码]`

## 4. 数据模型

### 4.1 物化产物结构（构建期，`dsh-dist/node_modules/dsh-market-pnpm/`）

```
dsh-market-pnpm/
├── package.json        # name=dsh-market-pnpm（或直接复用引擎包的 name）
├── lib/index.mjs       # 进程内入口（BUNDLED_PNPM_ENTRY_REL 约定）
└── node_modules/       # 引擎的传递依赖闭包（含任何原生模块的 aarch64 成品）
```

### 4.2 profile pnpm 配置（`$DSH_HOME/profiles/desktop/pnpm-workspace.yaml`）

```yaml
nodeLinker: hoisted
packageImportMethod: copy
ignoreScripts: true
minimumReleaseAge: 0
storeDir: <userData>/.pnpm-store
registry: https://registry.npmmirror.com/   # 可选，不覆盖用户已设值
```

### 4.3 句柄形状（`DesktopPnpmHandleLike`）

```ts
interface DesktopPnpmHandleLike {
  readonly stdout: NodeJS.ReadableStream
  readonly stderr: NodeJS.ReadableStream
  readonly done: Promise<{ exitCode: number | null; signal: NodeJS.Signals | null }>
  cancel(): void
}
```

## 5. 接口契约

### 5.1 提供的接口

| 位置 | 符号 | 说明 |
|---|---|---|
| `src-main/pnpm-inprocess.js`（新增，纯模块） | `runPnpmInProcess(args, opts)` | 进程内 add/remove，返回 `{exitCode, stdout, stderr}`；含 exit/argv 防护 |
| `src-main/pnpm-inprocess.js` | `assertPnpmEngine(entry)` | 校验引擎入口存在/非空 |
| `src-main/pnpm-runtime.js`（新增） | `ensureProfilePnpmConfig(home)` | 幂等写/合并 profile 的 `pnpm-workspace.yaml` |
| `src-main/main.js` | `registerDesktopProfiles(ctx, profileDir)` | 注册 `desktopProfiles` 服务 + `desktopPnpm`（在 market mount 前） |
| `scripts/collect-dsh.mjs` | `collectMarketPNPM()` | 物化 pnpm 引擎 + 版本断言 |
| `scripts/collect-dsh.mjs` | `assertDshMarketVersion()` | 市场版本断言（修 §3 的版本不一致） |

### 5.2 消费的接口

- dsh-market 的 `desktopProfiles` 特性检测 + `DesktopPnpmLike` 契约（`dsh-cli.ts:577-608`、`index.ts:183,285-292`）。
- dsh 的 profile 目录约定、`writeProfileBundles` / `reconcileProfilePlugins` / `selectBundle`。
- 011 的 `setupMarketRuntime()` / `BUNDLED_PNPM_ENTRY_REL` / `isParsableJs`。

### 5.3 事件协议

- 无自定义事件协议。`runPlugin` 的进度/输出经返回的 stdout/stderr 流传递给市场（市场本身解析 pnpm ndjson）。

## 6. 实现策略

### 6.1 架构模式

**物化 + 进程内引擎 + 契合适配**：构建期物化纯 JS 引擎并固定版本；运行期在主进程内实现市场契约（`desktopProfiles`/`desktopPnpm`），把市场的 add/remove 请求转发给进程内引擎。零上游改动。

### 6.2 关键算法

- **物化**（FR-012-001~004）：`collectMarketPNPM()` 从构建期获取的引擎包（构建期用宿主 pnpm/npm 安装到临时目录）复制入口与依赖闭包到 `dsh-dist/node_modules/dsh-market-pnpm/`；幂等；版本断言；`isParsableJs` 校验。
- **进程内调用**（FR-012-010~015，worker 方案）：`runPnpmInProcess(args, { dir, signal })`（父侧，`lib/pnpm-inprocess.js`）：
  1. 解析并校验引擎入口（`DSH_PNPM_ENGINE`，`assertPnpmEngine`）；缺失即返回 exit 127；
  2. `new Worker(lib/pnpm-worker.mjs, { workerData: { entry, args: [...args, '--dir', dir] } })`；
  3. worker 内设置 `process.argv`、改写 stdout/stderr 为 `postMessage`，再 `import(entry)`；
  4. pnpm 的 pending 工作耗尽 → worker 事件循环排空 → worker 退出，退出码即 pnpm 退出码；
  5. 父侧把 worker 消息写入句柄的 `stdout`/`stderr` PassThrough，`worker.on('exit', code)` 时 `done` 解析 `{ exitCode, signal: null }`；
  6. `cancel()` / `signal` 触发 `worker.terminate()`。
  - **不追加 reporter**：市场对 `add/remove` 会自行追加 `--reporter=ndjson`（`dsh-cli.ts:1145`）；runner 只追加 `--dir`。（曾误加 `--reporter=append-only`，会因 last-wins 覆盖市场的 ndjson，已修复。）
- **配置注入**（FR-012-006~009）：`ensureProfilePnpmConfig()` 读取/创建 `pnpm-workspace.yaml`，仅补齐缺失键，保留用户已有键。
- **契约注册**（FR-012-016~019）：在主进程启动流程中，market bundle mount 之前，向 cordis 根 ctx 提供 `desktopProfiles` 服务对象（含 `current.dir`），并暴露 `desktopPnpm` 实现 `DesktopPnpmLike`。**具体 cordis 服务注册/嵌套注入写法须对照市场 `index.ts` 在多化后实现阶段验证。**

### 6.3 错误处理

- **致命**（构建期）：引擎来源缺失 / 版本不符 / 入口不可解析 → `process.exit(1)`。
- **非阻塞**（运行期）：契约注册失败 → `[dsh-harmony]` 记录，市场退回其原路径（可能不可用），不阻塞应用启动。
- **安装失败**：返回非零 exitCode + stderr；不使主进程崩溃；不破坏 profile 可启动性。

### 6.4 性能

- 引擎 import 惰性加载（首次安装时），避免拖慢启动。
- 进程内安装为一次性操作，无热路径。

## 7. 测试考量

- **构建期（Windows 可执行）**：`dsh-dist/node_modules/dsh-market-pnpm/lib/index.mjs` 存在非空；版本断言通过；缺来源时 `exit(1)`。
- **单测（裸 Node，无 Electron）**：`pnpm-inprocess.js` 的 exit/argv 防护；`ensureProfilePnpmConfig` 的幂等与保留用户键；引擎入口校验。
- **真机**：市场一键安装纯 npm 插件成功；卸载成功；安装过程无 node/pnpm 子进程；失败不崩；取消生效。详见 [test-cases.md](./test-cases.md)。

## 8. 文件清单

| 文件 | 用途 | 类型 |
|---|---|---|
| `scripts/collect-dsh.mjs` | 新增 `collectMarketPNPM()`（物化 pnpm 引擎）、`assertDshMarketVersion()`（市场版本断言） | 改（构建期） |
| `plugins/harmony-plugin-market-runtime/lib/index.js` | 提供 `desktopProfiles` / `desktopPnpm`（host-plane bundle） | 新增（运行期） |
| `plugins/harmony-plugin-market-runtime/lib/pnpm-inprocess.js` | 父侧 runner：worker 生命周期 → `{stdout,stderr,done,cancel}` | 新增（运行期） |
| `plugins/harmony-plugin-market-runtime/lib/pnpm-worker.mjs` | worker 入口：import pnpm CLI（合成 argv） | 新增（运行期） |
| `plugins/harmony-plugin-market-runtime/cordis.patch.yml` | 该 bundle 的 patch（insert 自身行） | 新增 |
| `src-main/main.js` | 设 `DSH_PNPM_ENGINE`；`ensureProfilePnpmConfig()`（幂等创建 `pnpm-workspace.yaml`） | 改（运行期） |
| `src-main/market-runtime.js` | 路径 B 探测常量更新为 `pnpm/dist/pnpm.mjs` | 改（运行期） |
| `profiles/desktop/pnpm-workspace.yaml` | profile pnpm 配置种子 | 新增（配置） |
| `plugins/harmony-plugin-market-runtime/tests/pnpm-inprocess.test.mjs` | 单测（假引擎，无网络） | 新增 |
| `specs/201-dsh-market/{spec,plan}.md` | 同步描述契约消费 | 改（文档） |

## 9. 与规格的交叉引用

| 技术决策 | 对应需求 |
|---|---|
| `collectMarketPNPM()` 物化 + 幂等 + 校验 | FR-012-001/003/004 |
| 版本常量 + 构建期断言 | FR-012-002 |
| 原生模块闭包检测/注入 | FR-012-005 |
| `ensureProfilePnpmConfig()` | FR-012-006~009 |
| `runPnpmInProcess()` + exit/argv 防护 + ignoreScripts + hoisted | FR-012-010~015 |
| `registerDesktopProfiles()` + `DesktopPnpmLike` | FR-012-016~019 |
| 降级/显式可见 | FR-012-020/021/023 |
| 幂等/安全/回归安全 | FR-012-022/024/025/026 |

## 10. 关键决策记录

| # | 决策 | 备选 | 理由 |
|---|---|---|---|
| D1 | 进程内调用（011 路径 B） | spawn PATH 上的 pnpm | spawn 在应用域必死（B★） |
| D2 | 引擎用 **`pnpm` 包本身**（进程内 import 其 `dist/pnpm.mjs`，CLI 方式） | `@pnpm/installing.deps-installer` / `@pnpm/core` | spike 实测：`@pnpm/installing.deps-installer` 独立安装被 `@yarnpkg` 的 `patch:` 依赖阻断；`pnpm` 包自包含且进程内可用 |
| D3 | Route 1：实现市场内置 `desktopProfiles`/`desktopPnpm` | 打 dsh-market 补丁（Route 2） | 零上游改动；鸿蒙无 git 恰好落在其 npm-only 边界内 |
| D4 | `nodeLinker: hoisted` + `packageImportMethod: copy` | 默认 isolated | isolated 的 symlink/hardlink 被 B1 禁 |
| D5 | `ignoreScripts: true` | 允许 lifecycle 脚本 | 平台（SIGSYS）+ 安全（不执行任意代码） |
| D6 | storeDir 指向沙箱内 | 默认 `~/.pnpm-store` | 默认路径落到沙箱外 |
| D7 | 引擎随构建物化进 `dsh-dist` | 装成工程依赖 | 不进宿主依赖树；随 HAP 分发 |
| D8 | 版本以常量固定 + 构建期断言 | 浮动版本 | 市场版本决定安装路线，不能浮动 |

## 11. 风险与缓解

| # | 风险 | 影响 | 缓解 |
|---|---|---|---|
| R1 | `@pnpm/installing.deps-installer` 不可进程内调用 / 签名不符 | 方案前提不成立 | **实现阶段第一优先 spike**；失败则评估 `pnpm` 包入口或 Route 2 |
| R2 | 引擎依赖闭包含原生模块（SQLite） | 需注入 aarch64 成品 | 构建期检测 + `injectBetterSqlite3()` 同法注入 |
| R3 | pnpm 调 `process.exit` | 主进程崩溃 | 调用期包装为异常（FR-012-011） |
| R4 | 市场未走 `desktopPnpm` 分支（走 spawn） | 通道仍不可用 | 配置/版本配合使其走该分支（FR-012-019）；显式记录（FR-012-020） |
| R5 | cordis 服务注册/嵌套注入写法不明 | 契约注册失败 | 对照市场 `index.ts` 实现期验证；失败非阻塞 + 显式日志 |
| R6 | 依赖 install 脚本 / `git:` 源的插件不可装 | 部分插件装不了 | UI/文档披露 |
| R7 | `dsh-dist` 就地升级不重解压 | 设备用旧产物 | 沿用 202 结论：需全新安装生效 |
| R8 | 市场版本未固化 | 静默切换路线 | `assertDshMarketVersion()`（FR-012-002 同族） |

## 12. 待确认（实现阶段 spike 清单）

> **T0 spike 结论（2026-10-02，见 `logs/20261002-1/spike-pnpm-FINDINGS.md`）**：Q1–Q4 全部关闭，可行性成立。

| # | 事项 | 状态 / 处置 |
|---|---|---|
| Q1 | 进程内引擎入口与调用方式 | ✅ **已定**：物化 `pnpm` 包，进程内 import `dist/pnpm.mjs`，设 argv + `--dir` + 缓存击穿 |
| Q2 | hoisted + copy 下能否产出扁平 node_modules | ✅ **已验证**：递归扫描 0 symlink；真实目录 |
| Q3 | 引擎是否 spawn 子进程 | ✅ **未观察到**（add/remove 均在主进程）；`dist/worker.js` 同进程，`[未验证]` 真机确认 |
| Q4 | 引擎依赖闭包是否含原生模块 | ✅ 仅 `@reflink`（clone 用，da/win 平台）；**copy 路径不加载**，无需 aarch64 注入 |
| Q5 | `desktopProfiles` 服务的准确 cordis 注册方式与 `desktopPnpm` 暴露方式 | 实现期对照市场源码（`dsh-market/src/index.ts:183,285-292`）验证 |
| Q6 | 市场在 `config.profile: desktop` 下是否走 `desktopProfiles` 而非官方 Electron 分支 | 实现期验证；必要时调整 profile 配置 |

---

*事实以源码为准；spike 结论回填本文件与 §12。*
