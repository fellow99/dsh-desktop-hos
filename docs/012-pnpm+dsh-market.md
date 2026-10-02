# 012 — pnpm 集成 + dsh-market 进程内安装插件（讨论过程与方案）

> 模块：012-pnpm+dsh-market
> 状态：**已实现并真机验证通过（2026-10-02，设备 3QC0226526001227）**
> 记录日期：2026-10-01（最后更新 2026-10-02）
> 关联文档：
> - [`docs/pnpm对接问题排查.md`](./pnpm对接问题排查.md) —— 故障排查记录（本方案的事实基础，尤其 §6 的 SIGSYS 实测与 §11 的初步分析）
> - [`specs/012-pnpm-integration/`](../specs/012-pnpm-integration/) —— **本需求的规范四件套**（spec / plan / tasks / test-cases）
> - [`specs/011-runtime-provisioning/`](../specs/011-runtime-provisioning/) —— 运行时供给模块（**路径 B = 本方案**）
> - [`specs/201-dsh-market/`](../specs/201-dsh-market/) —— dsh-market 集成模块（已更新为 `desktopProfiles`/`desktopPnpm` 契约）

> **本文件的结构说明**：§1–§11 是**设计讨论记录**（含当时的选型与 `未验证` 判断）；**§12–§15 是 as-built 结果**（规范交付、实现、真机测试、提交），其中记录了实现阶段对 §4/§5/§8 若干选型的**修正**。两者冲突时以 §12–§15 为准。

---

## 1. 背景与问题定义

### 1.1 一句话

在 DSH 鸿蒙签名包内，`spawn` 任何 node/pnpm 子进程都会被 seccomp 以 `SIGSYS` 杀死，因此「把 pnpm 装到 PATH 上让市场调用」这条路**平台级不可行**。本方案回答：能否**把 pnpm 的纯 JS 版本随包物化、由 Electron 主进程在进程内调用**，从而让 dsh-market 真正能一键安装 / 卸载插件。

### 1.2 平台根因（沿用旧排查文档的编号）

| 编号 | 根因 | 后果 |
|---|---|---|
| **B0** | HAP 内没有可运行的 `node`（`process.execPath` 指向不存在的 ELF，运行时经 Ark 子进程启动 JS，无可 spawn 的 electron 二进制） | 无法 `fork()` |
| **B1** | `symlink()` / `chmod()` 对第三方应用被禁（`13900012`）；npm 的 POSIX bin 链接依赖 `symlink`，故 `npm i -g pnpm` 无法创建 `pnpm` 入口点 | 无法建入口点；pnpm 的 isolated 布局不可用 |
| **B2** | 用户 / 可写目录的 ELF 被拒执行；所有 ELF 须代码签名 | 自带 Node ELF 需二进制证书 |
| **B3** | npm/pnpm CLI 入口 `#!/usr/bin/env node` 依赖很可能不存在的 `/usr/bin/env` | shebang 断裂 |
| **B★** | **应用域子进程一律 SIGSYS**（seccomp 按系统调用投递，含带 `PROT_EXEC` 的 `mmap`）——**决定性根因** | 任何 spawn 出的 node 脚本（npm/corepack/pnpm）一启动即死 |

**关键区分（本方案的立足点）**：B★ 只杀 **fork 出的子进程**。**Electron 主进程自身就是 Node 22.17，能正常跑 JS** —— 把 pnpm 的 JS **import 进主进程内运行**，完全绕开 seccomp。这正是「路径 B」。

### 1.3 本方案要回答的问题

1. 能否把 pnpm 的纯 JS 版本打入包中？
2. 能否让 dsh-market 调用它并顺利安装插件？
3. 若可行，插件安装的**落盘位置、清除、配置**如何设计？

另加一个集成决策问题（第二轮追加）：**dsh-market 是否需要固化版本、打补丁？**（见 §7）

---

## 2. 本轮调查过程（如何得出结论）

> 本节记录推理路径，便于复核与接手。

### 2.1 读取的仓库与文件

| 仓库 | 关键文件 | 得到什么 |
|---|---|---|
| `dsh-market`（submodule，1.66.7） | `src/dsh-cli.ts`、`src/index.ts`、`src/install.ts`、`src/pnpm-compat.ts`、`src/official-desktop.ts`、`src/dsh-install.ts`、`package.json` | 市场的 pnpm 调用链、三条运行时接缝、`desktopProfiles`/`DesktopPnpmLike` 契约 |
| `deepseek-harness`（v0.2.0-rc.2） | `packages/boot/plugin-manager/src/operations.ts`、`apps/cli/src/plugin.ts`、`apps/cli/src/profile-boot.ts`、`packages/boot/app-boot/src/profile.ts`、`packages/boot/app-boot/src/profile-plugins.ts` | 子进程边界（`execa`）、`packageManager` 接缝、插件发现机制、`dsh.profile.bundles` 维护函数 |
| `dsh-desktop-hos` | `src-main/main.js`、`src-main/market-runtime.js`、`scripts/collect-dsh.mjs`、`scripts/build-dsh.mjs`、`profiles/desktop/cordis.patch.yml`、`profiles/desktop/package.json`、`specs/011-runtime-provisioning/*` | 本工程已有的运行时供给（路径 A/B/C）、市场物化方式、profile 配置 |
| `dsh-desktop`（参考工程） | `src/main/runtime.ts`、`src/main/host.ts`、`scripts/collect-dsh.mjs`、`scripts/fetch-runtime.mjs`、`forge.config.ts` | 桌面端参考实现（结论：它仍是 spawn 方案，无进程内范例） |

### 2.2 三个并行子调查及其结论

| 调查 | 结论来源 |
|---|---|
| pnpm 程序化 API | pnpm.io 官方文档 + npm registry + release notes：v11 纯 ESM；设置从 `.npmrc` 迁到 `pnpm-workspace.yaml`；`nodeLinker`/`packageImportMethod`/`symlink`/`virtualStoreOnly`/`enableModulesDir` 等设置；`@pnpm/core` 更名 |
| dsh-desktop 参考实现 | 源码：**不用** `setHostPackageManager`/`desktopPnpm`；走「打包便携 Node + standalone pnpm + PATH 注入」的 spawn 方案 |
| dsh 插件管理器深挖 | 源码：边界是 `execa`（非 `spawnSync`）；`packageManager` 接缝只接受可执行文件；无进程内安装路径；bundles 维护可进程内调用 |

### 2.3 纠正的三个既有错误认知

| 旧认知（旧排查文档 / 旧 spec） | 实测事实 |
|---|---|
| `dsh plugin` 内部是 `spawnSync("pnpm")` | 当前 pin 的 `dsh-v0.2.0-rc.2` 用 **`execa`**（`operations.ts:357`）。旧文档引的 `plugin-D0XB2ABu.js` 是编译产物、且属更早版本 |
| 进程内调用 pnpm 用 `@pnpm/core` | `@pnpm/core` 在 pnpm **v11 起停止发布**（停在 `1016.1.12`）；v11 的安装引擎是 **`@pnpm/installing.deps-installer`** |
| dsh-desktop 有进程内 pnpm 范例可抄 | dsh-desktop（本 workspace 参考工程）**仍是 spawn 方案**；`desktopPnpm` 进程内契约只有第三方 anywhere-labs 桌面端在用 |

### 2.4 讨论轮次与产出

| 轮次 | 用户诉求 | 本轮产出 |
|---|---|---|
| 第 1 轮 | 读 3 份文档 + 分析「能否把 pnpm 纯 JS 打入包、让市场装插件、落盘/清除/配置」并回写 | `docs/pnpm对接问题排查.md` 新增 §11（深入分析） |
| 第 2 轮 | 「dsh-market 是否需要固化版本、打补丁」 | 结论：**固化版本必须（现状已坏）**；**优先不打补丁**（Route 1），备选才打（Route 2）→ 沉淀为本文件 §7 |
| 第 3 轮 | 把完整讨论过程与方案落盘到本文件 | 本文件 |

---

## 3. 关键事实（源码级证据）

### 3.1 dsh-market 的调用链：两层 spawn

```
市场 UI → POST /dsh-market/install（同源，进程内）
  → dshmarket.runDshPlugin()          spawn "dsh plugin --profile desktop add|remove <target>"
      → dsh CLI runPluginCommand()    （apps/cli/src/plugin.ts:97）
          → runProfilePnpm()          execa(options.command ?? 'pnpm', [...], { cwd: <profile> })   ← 真正的 pnpm 子进程
```

- 主安装 spawn：`deepseek-harness/packages/boot/plugin-manager/src/operations.ts:357`
- 其余 spawn：`:177`（`pnpm view` 预检）、`:507`（修复重装）、`:597`（`config get registry`）、`:626`（服务 inspect）
- 市场侧 spawn：`dsh-market/src/dsh-cli.ts` 的 `runDshPlugin`、`probePnpm`（`pnpm --version`）、`provisionPnpm`（`corepack` / `npm i -g`）、`spawnShim`
- **两层 spawn 中的任一层产出的 node/pnpm 子进程，在鸿蒙应用域都被 SIGSYS 杀掉。**

### 3.2 dsh 插件管理器：子进程边界与既有接缝

- **边界**：`runProfilePnpm` 的 `execa`（`operations.ts:357`）。CLI 与服务两条入口都汇入它。
- **退出码映射**：`exitCode = result.exitCode ?? (result.code === 'ENOENT' ? 127 : 1)`（`:451`）→ `plugin.ts:98` 打印「pnpm was not found…」。
- **exit 0 之后**：兼容性复检 → `reconcile()` 重写 `dsh.profile.bundles`（`:89-113`）；服务路径改由 `selectBundle()`（`plugin-manager/src/index.ts:715-735`）完成。
- **既有接缝**（均**仍是 spawn 一个可执行文件**）：
  - `PackageOperationOptions.command/args/env`（`operations.ts:31-55`）
  - `ProfileContext.packageManager`（launcher 事实，最高优先级；`profile-boot.ts:289` 仅在传入时发布）
  - 服务配置 `pnpmCommand`（默认 `'pnpm'`）
- **无进程内安装路径**：全仓库无 `@pnpm/core` / `mutateModules` 调用。

### 3.3 dsh-market 的三条运行时接缝（本方案的核心）

| 接缝 | 位置 | 是否进程内 | 能否用于鸿蒙 |
|---|---|---|---|
| `setHostPackageManager({command,args,env})` | `dsh-cli.ts:781`，经 `profileContext.packageManager` 注入（`index.ts:255`） | ❌ 仍 spawn 一个 command | 不够（只换可执行文件路径） |
| **`DesktopPnpmLike.runPlugin(args, invokingDir, signal)`** | `dsh-cli.ts:577-608` + `createDesktopPluginRuntime`（`:1274`），经 **`desktopProfiles` 服务**特性检测（`index.ts:183,285-292,314`） | ✅ **真进程内**：宿主实现，返回句柄（stdout/stderr 流 + `done` + `cancel`） | **← 要实现的接缝** |
| 官方 Electron 路线（`config.profile='desktop'` → `pluginManager` 服务 → `installBundle`） | `official-desktop.ts:36-37`（注释：「Never fall back to `dsh plugin --profile desktop`」） | ⚠️ 半进程内：`pluginManager` 内部**仍 spawn pnpm**（`operations.ts:357`） | 不够（spawn 仍在） |

> ⚠️ 本工程 `profiles/desktop/cordis.patch.yml:70-74` 已对 dshmarket 注入 `config: { profile: desktop }`，因此捆绑当前版本市场时会走**第三条**路线 → `pluginManager` → 内部 spawn pnpm → 依旧 SIGSYS。**spawn 问题只是搬了位置，没有消失。** 要根治必须让市场走**第二条**（`desktopPnpm`）。

`DesktopPnpmLike` 契约（`dsh-cli.ts:577-608` 摘要）：

```ts
interface DesktopPnpmLike {
  runPlugin(args: readonly string[], invokingDir: string, signal?: AbortSignal): DesktopPnpmHandleLike
  runExternalMarketPluginInstall?(args, invokingDir, signal?): DesktopPnpmHandleLike
}
// DesktopPnpmHandleLike: { stdout, stderr, done: Promise<{exitCode,signal}>, cancel() }
```

### 3.4 dsh 的插件发现与 bundles 维护：**不依赖 pnpm**

- **发现**：`packageDirFromAnchor` / `resolveBundleDir`（`packages/boot/app-boot/src/profile.ts:600-641`）用 `createRequire(anchor).resolve.paths(pkg)` 走 Node 的 node_modules 向上查找，只要求 `<dir>/<name>/package.json` 存在。**扁平拷贝即可，symlink 非必需**（`existsSync` 跟随 symlink，但不要求是链接）。
- **profile 本身就是 hoisted**：`initProfile` 写的 `pnpm-workspace.yaml` 就是 `nodeLinker: hoisted`（`profile.ts:230-235`）。
- **bundles 维护可进程内**：`writeProfileBundles` / `reconcileProfilePlugins`（`packages/boot/app-boot/src/profile-plugins.ts:86-127`）、`selectBundle`（`plugin-manager/src/index.ts:715-735`）均为导出函数，写入 `package.json` 的 `dsh.profile.bundles`。
- **结论：只有「装文件」这半程需要进程内 pnpm；「改 bundles + 热重载」这半程 wrapper 已能进程内做。**

### 3.5 本工程已有的市场运行时供给（路径 A/B/C）

`src-main/market-runtime.js` 已实现 `discoverMarketRuntime()` 的有序选路（A → B → C → 显式失败，禁跳级），并在 `main.js:501` 的 `startHost()` 内、`runProfile` 之前调用 `setupMarketRuntime()`：

- **路径 A**（随包签名 Node ELF）：⛔ 已撤回（需 AGC 二进制证书，个人开发者不可得）。
- **路径 B**（进程内 pnpm JS）：⏸ **暂缓 —— 本方案即路径 B**。物化位置常量已预留：`BUNDLED_PNPM_PACKAGE = 'dsh-market-pnpm'`、`BUNDLED_PNPM_ENTRY_REL = ['node_modules','dsh-market-pnpm','lib','index.mjs']`（`market-runtime.js:53-57`），探测分支见 `:454-468`。
- **路径 C**（复用设备第三方 Node）：机会性兜底、不作承诺；现设备 `node -e` 无输出，大概率不通过。

### 3.6 dsh-desktop（参考工程）的实现细节 —— **它仍是 spawn 方案**

- `scripts/fetch-runtime.mjs`：下载便携 Node（`NODE_VERSION = 24.11.1`）+ standalone pnpm 单文件（`PNPM_VERSION = 9.15.9`）到 `runtime/`；`.part`+`Content-Length` 防截断 + PE 结构校验 + `.versions.json` 版本戳。
- `src/main/runtime.ts::setupMarketRuntime()`：把 `dsh` shim 写到 `<userData>/runtime-bin/`；把 `runtime/pnpm`、`runtime/node`、shim 目录**前置进 PATH**；`isUsableExecutable()` 对捆绑产物做结构校验（防止损坏产物遮蔽系统可用 pnpm）；在 `startHost()` 前调用。
- `scripts/collect-dsh.mjs`：`pnpm deploy --legacy` → 物化 junction 为真实文件（`materializeJunctions`）→ 补非 hoisted 依赖 → 删 `.pnpm` → 裁非目标架构 prebuilds → 物化 `dshmarket`。
- `forge.config.ts`：`asar: true`，但 `dsh-dist`/`runtime` 走 `extraResource` 落在 `resources/`（asar 外）；`prune: false`；`derefSymlinks: true`。
- `src/main/host.ts::ensureProfilePluginLinks()`：把 `$DSH_HOME/profiles/desktop/node_modules`（含 `.pnpm/node_modules`）junction 进 dsh 根 node_modules（运行时占位；鸿蒙须改为 `cpSync`）。**注意：这是对 isolated 布局的兼容，本方案改用 hoisted 后不需要它。**
- **结论**：dsh-desktop 全程走 spawn + PATH 注入，**没有任何进程内 pnpm 范例**；本工程要走的 `desktopPnpm` 契约，在 workspace 内没有可抄的实现。

---

## 4. 问题一：pnpm 纯 JS 能否打入包中 —— **能**

### 4.1 版本选型

| 版本 | 形态 | 能否随包 / 进程内 import |
|---|---|---|
| `pnpm@12.x` | Rust 原生分发壳（`@pnpm/exe.*` 平台二进制） | ❌ 无 openharmony 产物 |
| **`pnpm@11.x`** | **纯 ESM**（`bin/pnpm.mjs`，`type: module`，无 install 脚本、无平台 optionalDependencies），`engines: node >=22.13` | ✅ 推荐 |
| `pnpm@10.x` | 纯 CJS（`bin/pnpm.cjs`），`engines: node >=18.12` | ✅ 备选 |

### 4.2 程序化 API 包的更名（版本陷阱）

进程内调用**不是** `import('@pnpm/core')`。实测：`@pnpm/core` 在 pnpm v11 起停止发布（最后 `1016.1.12`，属 10.16 线）。v11 的安装引擎是 **`@pnpm/installing.deps-installer`**（已发布 `1102.x`/`1103.x`），导出进程内所需：

- `install(manifest, opts)`
- `mutateModules(projects, opts)`
- `addDependenciesToPackage(manifest, selectors, opts)`
- `removeDependenciesFromPackage(manifest, selectors, opts)`

> ⚠️ 包名与签名为 registry 检索结论，落地前须按最终选定的 `pnpm@11.x` 精确版本再核对 —— 标 `未验证`。

### 4.3 进程内 pnpm 的可用设置清单（本轮补充，落盘时的配置依据）

pnpm v11 起，**除 auth/registry 外的设置一律写 `pnpm-workspace.yaml`（camelCase），不再读 `.npmrc`**（v11.0.0 起）。与「进程内 + 鸿蒙沙箱」相关的设置：

| 设置 | 取值 | 作用 / 为何需要 |
|---|---|---|
| `nodeLinker` | `hoisted` | **扁平 node_modules，无 symlink、无 `.pnpm` 虚拟 store**（默认 `isolated` 会建 symlink+hardlink，被 B1 禁） |
| `packageImportMethod` | `copy` | 从 store **拷贝**而非 hardlink 进 node_modules（默认 hardlink） |
| `ignoreScripts` | `true` | **禁用 lifecycle 脚本**（否则 spawn node 子进程 + 主进程内执行任意代码） |
| `storeDir` | `<userData>/.pnpm-store` | 显式指向沙箱可写目录（默认 `~/.pnpm-store` 会落到沙箱外） |
| `symlink` | `false` | 虚拟 store 不含 symlink（与 pnp 配套；hoisted 下非必需，列备查） |
| `virtualStoreDir` | 默认 `node_modules/.pnpm` | hoisted 下不产生虚拟 store |
| `virtualStoreOnly`（v11.0.0） | `true` | 仅填充虚拟 store、不写 importer symlink/hoist/bin link/lifecycle（备查） |
| `enableModulesDir` | `false` | 完全不写 node_modules（备查；本方案要 node_modules，故不用） |
| `allowBuilds` | 映射 | v11 起**取代**被移除的 `onlyBuiltDependencies`/`neverBuiltDependencies`/`ignoredBuiltDependencies`/`ignoreDepScripts` |
| `strictDepBuilds` | 默认 `true` | 对未审阅构建脚本报错；`ignoreScripts: true` 时被短路 |
| `minimumReleaseAge` | 建议 `0` | **v11 默认 1440 分钟（1 天）**——新发布的包在等待期内解析不到，是本方案的隐藏坑，须显式置 0 |

本工程需要的**最小集**：

```yaml
# $DSH_HOME/profiles/desktop/pnpm-workspace.yaml
nodeLinker: hoisted
packageImportMethod: copy
ignoreScripts: true
storeDir: <userData>/.pnpm-store
minimumReleaseAge: 0
registry: https://registry.npmmirror.com/   # 国内镜像（可选）
```

这与本工程既有产物形态、以及 dsh 自己 `initProfile` 写出的 `nodeLinker: hoisted` **完全一致**。旧 spec / 旧排查文档均未讲透这一点。

### 4.4 物化位置与方式

- 位置：`dsh-dist/node_modules/dsh-market-pnpm/lib/index.mjs`（`BUNDLED_PNPM_ENTRY_REL` 已定义）。
- 方式：`scripts/collect-dsh.mjs` 新增 `collectMarketPNPM()`（`specs/011-runtime-provisioning/plan.md` §4.2 / T2.6），把 `@pnpm/installing.deps-installer` 及其传递闭包物化进去；缺失即非零退出。
- 与既有产物形态一致：`dsh-dist` 本就是「扁平、无 junction、无 `.pnpm`」布局。

### 4.5 待核实风险

pnpm v11 store 是「SQLite 后端索引（store v11）」。需确认 `@pnpm/installing.deps-installer` 的依赖闭包是否引入 `better-sqlite3` 等**原生模块**：
- 若有 → 按 `injectBetterSqlite3()` 同法注入 aarch64 成品（主进程内 dlopen 原生模块是可行的，与「spawn 子进程 SIGSYS」无关）。
- 若走 WASM/纯 JS → 无需处理。

**此项 `未验证`，是物化阶段第一优先排查项。**

---

## 5. 问题二：dsh-market 能否进程内调用 —— **能，但 spawn 是死路**

### 5.1 为什么 spawn 必死

见 §3.1/§1.2：两层 spawn 产出的 node/pnpm 子进程在应用域一律 SIGSYS。与 pnpm 装在哪、PATH 怎么配无关（旧排查文档 §6 已实测）。

### 5.2 可用的进程内接缝

**实现 `desktopProfiles` 服务 + 其 `desktopPnpm`（`DesktopPnpmLike`）**：wrapper 在 Electron 主进程内实现 `runPlugin`，内部用 `@pnpm/installing.deps-installer` 进程内装/卸包，把结果映射回市场期望的 `InstallResult` 形状。市场通过**特性检测**（`ctx.get('desktopProfiles')`）自动采用它，**无需修改 dsh-market 源码**（`index.ts:183,285-292,314`）。

### 5.3 进程内运行的硬约束（必须一并解决）

1. **`ignore-scripts: true`（强制）** —— 否则：① pnpm 会 spawn node 跑 lifecycle 脚本 → SIGSYS；② 等于在 Electron 主进程内执行插件作者的任意代码。代价：依赖 install 脚本的插件装不了（须 UI/文档披露）。
2. **`process.exit` 拦截** —— pnpm JS 可能调 `process.exit` → **杀掉 Electron 主进程**；调用期间把它包装成抛异常。
3. **`process.argv` 保存/恢复** —— pnpm 期望独占 `process.argv`。
4. **symlink/hardlink 禁令** —— 见 §5.4。
5. **配置位置** —— pnpm **v11 起**除 auth/registry 外的设置一律写 `pnpm-workspace.yaml`（camelCase），不再读 `.npmrc`（详见 §4.3）。
6. **`git:` 源插件装不了** —— 设备无 `git`（任何路线都不行）。

### 5.4 扁平 node_modules（`node-linker=hoisted`）—— 最关键的补充

pnpm 默认 `node-linker=isolated` 会在 `node_modules/` 建 symlink、在 `.pnpm` store 建 hardlink；鸿蒙沙箱**两者都禁**（B1）。解法（pnpm 官方设置，见 §4.3）：`nodeLinker: hoisted` + `packageImportMethod: copy` + `storeDir` 指向沙箱可写目录。**这与本工程既有产物形态、以及 dsh 自己 `initProfile` 写出的 `nodeLinker: hoisted` 完全一致。**

### 5.5 好消息：装载 / bundles 全程可进程内

见 §3.4。dsh 的插件发现只要求 `node_modules/<name>/package.json` 可达（扁平拷贝即可），`dsh.profile.bundles` 的增删有导出函数可进程内调用。**因此进程内 pnpm 只需覆盖「装文件」半程。**

---

## 6. 问题三：插件落盘 / 清除 / 配置

### 6.1 落盘

| 对象 | 路径 | 说明 |
|---|---|---|
| 插件本体 | `$DSH_HOME/profiles/desktop/node_modules/<包名>/` | 扁平（hoisted）、无 `.pnpm` |
| pnpm store | `<userData>/.pnpm-store`（须显式 `storeDir`） | **不能**用默认 `~/.pnpm-store`（会解析到沙箱外） |
| 锁文件 | `$DSH_HOME/profiles/desktop/pnpm-lock.yaml` | 锁版本 |
| 包管理器状态 | `$DSH_HOME/profiles/desktop/pnpm-workspace.yaml` | nodeLinker / packageImportMethod / storeDir / ignoreScripts / allowBuilds / registry |

### 6.2 清除

- 单插件：`dsh plugin remove <pkg>` → 进程内 `removeDependenciesFromPackage` → reconcile 从 `dsh.profile.bundles` 剔除。
- 市场侧已有：`removeAndReconcile`（`dsh-market/src/install.ts`）+ 宿主桥接链接清理 `removeDanglingHostBridge`（`install.ts:583`）。
- store 级：`pnpm store prune`（或直接删 store 目录后重装）。
- 失败回滚：dsh 的 `runProfilePnpm` 已实现「快照 `package.json`+`pnpm-lock.yaml` → 失败还原 → 修复重装」（`operations.ts:303-321,504-517`）——该逻辑与 spawn 无关，进程内改造可沿用其语义。

### 6.3 配置

| 文件 | 内容 | 维护者 |
|---|---|---|
| `package.json` | `dependencies` + `dsh.profile.bundles`（**有序 = 加载序**） | 进程内 `writeProfileBundles` / `reconcileProfilePlugins` |
| `cordis.patch.yml` | 插件 disable/enable 覆写 | 市场 hot toggle |
| `compatibility.json` | 版本豁免 | dsh |
| `pnpm-workspace.yaml` | 见 §4.3 / §5.4 | 进程内 pnpm |

---

## 7. dsh-market 版本固化与补丁策略（第二轮讨论）

### 7.1 现状（实测，**不一致**）

| 项 | 实际值 | 判定 |
|---|---|---|
| `dsh-market` submodule | `d4f7a79`（`v1.62.0-129-gd4f7a79`），包版本 **1.66.7** | 唯一真源 |
| `dsh-desktop-hos/README.md` | 让克隆 **`v1.26.0`** | ❌ 陈旧 |
| `profiles/desktop/package.json:5` | `"dshmarket": "1.26.0"` | ❌ 陈旧 |
| `specs/201-dsh-market/` 记录 | **`1.29.2`** | ❌ 陈旧（第三处不一致） |
| `scripts/build-dsh.mjs` | 对 sibling 跑 `npm install` + `npm run build`，**无版本校验、无补丁** | — |
| `scripts/collect-dsh.mjs` | 盲拷 sibling，**无版本校验** | — |
| `patches/` | 只有 `dsh-v0.1.0-rc.7` / `v0.1.2-rc.1` / `v0.1.5-rc.2` / `v0.2.0-rc.2` | **无任何 dsh-market 补丁目录** |

即：**版本「固化」是坏的**（四处声明指向 `1.26.0`/`1.29.2`，实际跑 `1.66.7`，且构建期无法察觉）；**补丁目前根本不存在**。

### 7.2 是否需要固化版本 —— **需要，且要立即修**

1. **市场版本决定安装路线**：1.26 时代是纯 spawn；1.66.7 已有 `desktopProfiles` / 官方 Electron / `setHostPackageManager` 三路线分支。一次 `git submodule update --remote` 会**静默切换安装路径**（对「安装通道在鸿蒙上能不能用」是决定性的，绝不能浮动）。
2. **若走补丁路线，版本锁定是硬前提**：补丁改的是 `dsh-cli.ts` 的函数与行，跨版本必失配（`specs/011-runtime-provisioning/plan.md` R5）。
3. **可复现构建**：submodule commit、构建脚本、profile 声明三处必须一致。

**修法**：以 submodule commit 为唯一真源，在 `build-dsh.mjs`（build dsh-market 前）与 `collect-dsh.mjs`（`collectDshMarket()` 内）加**版本断言**（读 `../dsh-market/package.json` 的 `version` 与集中常量比对，不一致即 `exit 1`）；同时把 README、`profiles/desktop/package.json`、`specs/201-dsh-market/` 的陈旧版本声明改为该值。

### 7.3 是否需要打补丁 —— **优先不打（Route 1），备选才打（Route 2）**

**Route 1（推荐）：不打补丁，实现市场已内置的 `desktopProfiles` / `desktopPnpm` 契约。**
- 已核实固定版本（1.66.7）源码**确实包含**该分支（`index.ts:183,285-292`；`dsh-cli.ts:577,1274`）。
- 零 dsh-market 代码改动 → 不需要补丁目录、不需要版本化补丁。
- 契约约束为 `add name@exact.version` / `remove name`（npm-only，拒绝 `github:`）。**鸿蒙本来就无 `git`，github 源任何路线都装不了** —— 该限制在鸿蒙上**恰好可接受**。
- 唯一耦合风险：它是「Anywhere Labs 桌面端」的 vendor 契约（市场源码明言不属于官方 DSH 协议），市场未来理论上可能不再兼容。

**Route 2（备选）：打 `patches/dsh-market-v<ver>/dsh-market-in-process-pnpm.patch`。**
- 仅当 Route 1 不满足（需要市场完整 CLI 参数能力 / 未来版本移除 `desktopProfiles` 分支 / 契约行为不可接受）。
- 改写点：`dshArgv()` / `spawnShim()` / `runDshPlugin()` / `probePnpm()` / `provisionPnpm()` 加进程内分支（`plan.md` §11.2）。
- 补丁必须**版本化目录 + 幂等**（`git apply --reverse --check`），由 `build-dsh.mjs` 在 build dsh-market **之前**应用。此时「固化版本」升级为必需。

> ⚠️ 需修正旧 spec：`specs/011-runtime-provisioning/plan.md` §11.1 写的 `patches/dsh-market-v1.26.0/` ① 版本已过期（实际 1.66.7）；② 该 plan 写于市场还没有 `desktopProfiles` 契约之前。**当前应优先 Route 1（无补丁），Route 2 降为备选。**

---

## 8. 落地方案

### 8.1 总体架构（路径 B）

```
Electron 主进程（Node 22.17，可跑 JS）
  ├─ setupMarketRuntime()（已有：探测 A/B/C → 选 B）
  ├─ 注册 desktopProfiles 服务，暴露 desktopPnpm: DesktopPnpmLike   ← 新增
  │     └─ runPlugin(args, dir, signal) 内部：
  │          用 @pnpm/installing.deps-installer 进程内装/卸
  │          配置来自 profile 的 pnpm-workspace.yaml（hoisted/copy/ignore-scripts/storeDir/minimumReleaseAge=0）
  │          包裹 process.exit，保存/恢复 process.argv
  │          返回句柄 { stdout, stderr, done, cancel }
  ├─ runProfile('desktop')（市场在 mount 时特性检测到 desktopProfiles → 走进程内）
  └─ 插件落盘 $DSH_HOME/profiles/desktop/node_modules/（扁平）
```

### 8.2 工作量清单

| # | 待办 | 位置 | 性质 | 状态 |
|---|---|---|---|---|
| ① | `collectMarketPNPM()`：物化 pnpm JS 到 `dsh-dist/node_modules/dsh-market-pnpm/` | `scripts/collect-dsh.mjs` | 构建期 | 未做 |
| ② | 进程内 pnpm 实现（`runPlugin` 内部逻辑，含 `process.exit`/`argv` 防护） | `src-main/`（新模块，可单测） | 运行期 | 未做 |
| ③ | 注册 `desktopProfiles` 服务并暴露 `desktopPnpm`（在 market mount 之前） | `src-main/` | 运行期 | 未做 |
| ④ | 保证市场走 `desktopPnpm` 分支而非 spawn 分支（profile 配置 / 市场版本配合） | `profiles/desktop/` | 配置 | 待定 |
| ⑤ | 市场版本断言 + 陈旧版本声明修正 | `build-dsh.mjs` / `collect-dsh.mjs` / README / `profiles/package.json` / `specs/201-dsh-market/` | 构建期 | 未做 |
| ⑥ | （备选）dsh-market 补丁，仅当 Route 1 不满足 | `patches/dsh-market-v<ver>/` | 补丁 | 未做 |

### 8.3 分阶段实施建议

1. **Phase 0（地基）**：版本断言 ⑤ —— 无论走哪条路线都要做，消除当前版本不一致。
2. **Phase 1（可行性验证）**：在裸 Node 上验证 `@pnpm/installing.deps-installer` 能否进程内对 profile 目录完成一次 registry 包 add/remove，且产出扁平 node_modules（`nodeLinker: hoisted` + `packageImportMethod: copy`），确认无原生模块阻塞（§4.5）。
3. **Phase 2（集成）**：① + ② + ③，跑通「市场一键安装一个纯 npm 插件」。
4. **Phase 3（加固）**：失败回滚、`process.exit` 防护、store 清理、`provisionHint` 鸿蒙化文案、单测与真机用例（对应 `specs/011-runtime-provisioning/test-cases.md`）。

---

## 9. 风险与未决事项

| # | 风险 / 未决 | 影响 | 处置 |
|---|---|---|---|
| R1 | `@pnpm/installing.deps-installer` 依赖闭包含原生模块（SQLite） | 需注入 aarch64 成品 | Phase 1 核实（§4.5），`未验证` |
| R2 | pnpm 调 `process.exit` 杀主进程 | 应用崩溃 | 调用期包装拦截（§5.3） |
| R3 | `desktopProfiles` 是 vendor 契约，市场未来可能不再兼容 | Route 1 失效 | 退 Route 2；或锁市场版本 |
| R4 | 市场版本未固化（当前四处不一致） | 静默切换安装路线 / 补丁失配 | Phase 0 断言 + 修正声明 |
| R5 | 依赖 install 脚本 / `git:` 源的插件不可装 | 部分插件装不了 | UI/文档披露 |
| R6 | `dsh-dist` 就地升级不重解压（既有缺口） | 设备继续用旧产物 | 沿用 202 结论：需全新安装生效，只记录不改 |
| R7 | 路径 C 的 `node -e` 探针在现设备无输出 | 机会性兜底大概率不通过 | 不作为产品能力（沿用 011 决策） |
| R8 | pnpm v11 `minimumReleaseAge` 默认 1 天 | 新发布插件解析不到 | profile 显式置 `minimumReleaseAge: 0`（§4.3） |

---

## 10. 证据索引（文件:行）

**dsh-market（1.66.7）**
- `src/dsh-cli.ts:577-608` `DesktopPnpmLike` 契约；`:781` `setHostPackageManager`；`:1274-1275` `createDesktopPluginRuntime`
- `src/index.ts:183` `ctx.get('desktopProfiles')`；`:255` `setHostPackageManager(hostPackageManagerOf(profileContext))`；`:285-292` `desktopProfiles.current` / `desktopPnpm` / `createDesktopPluginRuntime`；`:314` `mountMarketRoutes`
- `src/official-desktop.ts:36-37` 「Never fall back to `dsh plugin --profile desktop`」
- `package.json` version `1.66.7`

**deepseek-harness（dsh-v0.2.0-rc.2）**
- `packages/boot/plugin-manager/src/operations.ts:357` 主 `execa`；`:177/:507/:597/:626` 其余 spawn；`:451` 退出码映射；`:89-113` `reconcile`；`:303-321,504-517` 快照/还原
- `packages/boot/plugin-manager/src/index.ts:715-735` `selectBundle`
- `apps/cli/src/plugin.ts:97-106`；`apps/cli/src/profile-boot.ts:78` `INSTALL_ANCHOR`、`:289` `packageManager` 发布
- `packages/boot/app-boot/src/profile.ts:230-235` `nodeLinker: hoisted`；`:600-641` `packageDirFromAnchor` / `resolveBundleDir`
- `packages/boot/app-boot/src/profile-plugins.ts:86-127` `writeProfileBundles` / `reconcileProfilePlugins`

**dsh-desktop-hos**
- `src-main/market-runtime.js:53-57` `BUNDLED_PNPM_PACKAGE` / `BUNDLED_PNPM_ENTRY_REL`；`:454-468` 路径 B 探测；`:571-655` `setupMarketRuntime`
- `src-main/main.js:501` `setupMarketRuntime({ dshRoot })` 调用；`:418-463` `ensureDshPluginsProfileLink`
- `scripts/collect-dsh.mjs` `collectDshMarket()` / `collectPlugins()` / `materializeJunctions()`
- `scripts/build-dsh.mjs:119-129` 构建 dsh-market（无版本校验）
- `profiles/desktop/cordis.patch.yml:70-74` dsh-market `config: { profile: desktop, allowRestart: false }`
- `profiles/desktop/package.json:5` `"dshmarket": "1.26.0"`（陈旧）
- `specs/011-runtime-provisioning/{spec,plan,tasks,test-cases}.md`（路径 A/B/C 完整设计；`plan.md` §11 = 进程内 pnpm 补丁组织）

**dsh-desktop（参考工程）**
- `scripts/fetch-runtime.mjs`（Node 24.11.1 + pnpm 9.15.9）
- `src/main/runtime.ts::setupMarketRuntime()`（shim + PATH 前置 + 结构校验）
- `forge.config.ts`（`asar: true`、`prune: false`、`derefSymlinks: true`、`extraResource`）
- `src/main/host.ts::ensureProfilePluginLinks()`（运行时 junction）

**pnpm 版本事实（registry/文档，非设备实测）**
- `@pnpm/core` 止于 `1016.1.12`；`@pnpm/installing.deps-installer` 为 v11 安装引擎（`未验证`）
- pnpm v11：纯 ESM、Node ≥22.13；设置自 v11.0.0 起迁入 `pnpm-workspace.yaml`（camelCase）；`minimumReleaseAge` 默认 1440
- `nodeLinker` / `packageImportMethod` / `ignoreScripts` / `storeDir` / `symlink` / `virtualStoreOnly` / `enableModulesDir` / `allowBuilds` 语义（pnpm 官方 settings 文档）

---

## 11. 结论

1. **pnpm 纯 JS 能随包**（`pnpm@11.x` 纯 ESM，无平台二进制）；进程内调用入口是 `@pnpm/installing.deps-installer`（非 `@pnpm/core`）。
2. **dsh-market 能进程内调用**，但必须实现其 `desktopProfiles` / `desktopPnpm` 契约（`DesktopPnpmLike.runPlugin`），并满足四条硬约束：`ignore-scripts`、`process.exit` 防护、`argv` 保存/恢复、`nodeLinker: hoisted`（+ `packageImportMethod: copy` + 沙箱内 `storeDir`）。**spawn 任何一层都是死路**。
3. **落盘 / 清除 / 配置有明确落点**：插件落 `$DSH_HOME/profiles/desktop/node_modules/`（扁平），store 落 `<userData>/.pnpm-store`，配置在 `pnpm-workspace.yaml` + `package.json` 的 `dsh.profile.bundles` + `cordis.patch.yml`。
4. **dsh-market 必须固化版本**（现状四处不一致、且构建期无法察觉），**优先不打补丁**（Route 1，实现内置 `desktopPnpm` 契约；鸿蒙无 `git` 恰好落在其 npm-only 边界内），仅当 Route 1 不满足才打 Route 2 的版本化补丁。
5. **这是「已有设计、待补最后一环」**：`specs/011-runtime-provisioning` 的路径 B 探测/选路/校验/诊断已实现并单测通过，缺的只是「进程内调用补丁 + 市场版本断言」。

---

*本文件由 2026-10-01 ~ 2026-10-02 的讨论沉淀；§1–§11 为设计讨论，§12–§15 为 as-built；事实以源码/真机为准。*

---

## 12. 交付的规范文档（specs）

> 按用户要求，本需求模块放在 **`dsh-desktop-hos/specs/`**（不进父工程 specs）；采用工程既有的手写 spec 格式（无 `.specify/`）。

### 12.1 新建：`specs/012-pnpm-integration/`

| 文件 | 内容 |
|---|---|
| `spec.md` | 功能规格：FR-012-001..026（物化/版本断言、profile pnpm 配置、进程内调用、市场契约、失败可见性、安全） |
| `plan.md` | 技术方案：引擎选型、worker 线程调用、文件清单、决策记录、风险、spike 清单 |
| `tasks.md` | 依赖排序任务（Phase 0 可行性 spike → Phase 1 物化 → Phase 2 引擎 → Phase 3 契约 → …→ Phase 7 回归） |
| `test-cases.md` | 20 条用例（B 构建期 6 / U 单元 5 / D 真机 9） |

关键 FR（as-built 后）：
- **FR-012-001**：物化 `pnpm` 包到 `dsh-dist/node_modules/dsh-market-pnpm/`，入口 `bin/pnpm.cjs`；**版本固定 `10.34.6`**（原因见 §14 P1）。
- **FR-012-006~009**：profile 的 `pnpm-workspace.yaml`（`nodeLinker: hoisted`、`packageImportMethod: copy`、`ignoreScripts: true`、`minimumReleaseAge: 0`、沙箱内 `storeDir`）。
- **FR-012-010~015**：进程内调用（worker 线程；不 spawn 子进程；execPath 处理；symlink 回退见 §14）。
- **FR-012-016~020**：注册 `desktopProfiles`/`desktopPnpm`（`DesktopPnpmLike.runPlugin`），**不改 dsh-market 源码**。

### 12.2 完善：`specs/201-dsh-market/{spec,plan}.md`

从「spawn 方案 + 安装通道 `[NEEDS CLARIFICATION]`」改为 **`desktopProfiles`/`desktopPnpm` 契约模型**：
- 版本由 `1.26.0`/`1.29.2` 统一为 **`1.66.7`**（并加构建期断言 FR-201-018）。
- 新增 FR-201-011~017：宿主提供 `desktopProfiles`（012 实现）→ 市场经 `desktopPnpm.runPlugin` 执行 add/remove；bundles 维护走 dsh 进程内函数。
- 数据流：`市场 UI → POST /dsh-market/install → desktopProfiles 特性检测 → desktopPnpm.runPlugin → 进程内 pnpm`。

---

## 13. 实现（as-built）

### 13.1 新增/修改文件

| 文件 | 类型 | 作用 |
|---|---|---|
| `plugins/harmony-plugin-market-runtime/` | **新增** | host-plane **bundle**：提供 `desktopProfiles` + `desktopPnpm` |
| ├ `package.json` | 新增 | `name=harmony-plugin-market-runtime`，`dsh.bundle.patch=cordis.patch.yml` |
| ├ `cordis.patch.yml` | 新增 | `insert` 自身行（列在 `dshmarket` **之前**） |
| ├ `lib/index.js` | 新增 | `apply(ctx)`：`ctx.provide('desktopProfiles', …)` + `ctx.provide('desktopPnpm', { runPlugin })` |
| ├ `lib/pnpm-inprocess.js` | 新增 | 父侧 runner：`new Worker` → `{stdout, stderr, done, cancel}` |
| ├ `lib/pnpm-worker.mjs` | 新增 | worker 入口：合成 `process.argv` → `import(引擎)`；含 **execPath 修复 + symlink→copy 回退** |
| ├ `tests/pnpm-inprocess.test.mjs` | 新增 | 7 条单测（假引擎，无网络） |
| `scripts/collect-dsh.mjs` | 改 | 新增 `collectMarketPNPM()`（物化引擎+裁剪）、`assertDshMarketVersion()`；step 0b 断言市场版本 |
| `src-main/main.js` | 改 | 设 `DSH_PNPM_ENGINE`；`ensureProfilePnpmConfig()`（**只创建不覆盖**）；`ensureDesktopProfile` 跳过回盖 `pnpm-workspace.yaml` |
| `src-main/market-runtime.js` | 改 | `BUNDLED_PNPM_PACKAGE='dsh-market-pnpm'`、`BUNDLED_PNPM_ENTRY_REL=[…,'bin','pnpm.cjs']` |
| `profiles/desktop/package.json` | 改 | dshmarket `1.66.7`；bundles 增加 `harmony-plugin-market-runtime`（在 dshmarket 前） |
| `profiles/desktop/pnpm-workspace.yaml` | 新增 | profile pnpm 配置种子 |

### 13.2 关键设计：worker 线程

spike 发现 `await import('pnpm/dist/pnpm.mjs')` **341ms 就 resolve**，但 pnpm main 火忘式异步继续、且从不调 `process.exit` —— **无法从 import/exit 得知完成**。故改为把 pnpm CLI 放进 **`worker_threads.Worker`**，一次解决四件事：

| 问题 | worker 的解法 |
|---|---|
| 完成检测 | worker 事件循环排空 → 退出 → `worker.on('exit', code)` |
| 退出码 | worker 退出码即 pnpm 退出码（成功 0 / 失败非 0） |
| `process.exit` | 只退出 worker，不杀主进程 |
| ESM 缓存 | 每次 `new Worker` 全新模块图，无需缓存击穿 |

worker 在 `import` 前做两项修补（见 §14）：`process.execPath` no-op setter；`fs`/`fs.promises.symlink` 在 `EACCES/EPERM` 时回退 copy。

### 13.3 与 §8 设计的差异（实现阶段修正）

| 项 | §8 原设计 | as-built | 原因 |
|---|---|---|---|
| 引擎 | `@pnpm/installing.deps-installer` | **`pnpm` 包本身**（`pnpm@10.34.6`） | deps-installer 独立安装被 `@yarnpkg` 的 `patch:` 依赖阻断；pnpm 包自包含 |
| 运行方式 | 直接 `import` + 包装 `process.exit` + 保存/恢复 argv | **worker 线程** + execPath no-op setter | 完成检测 + `process.exit` 隔离 + ESM 缓存（见 §13.2） |
| 引擎目录 | `dsh-dist/node_modules/dsh-market-pnpm/lib/index.mjs` | `dsh-dist/node_modules/dsh-market-pnpm/{bin,dist}` | 直接用 `pnpm` 包结构；且须避开 `pnpm deploy` 放置的 dsh 自身 `pnpm` 依赖 |
| 版本 | pnpm@11 | **pnpm@10.34.6** | pnpm@11 依赖 `node:sqlite`，运行时无该 binding（§14 P1） |
| symlink | 「hoisted 无 symlink」即够 | 额外 **symlink→copy 回退** | pnpm 仍为 `.bin` 建 symlink，鸿蒙 `EACCES`（§14 P3） |

---

## 14. 真机测试结果

> 设备 `3QC0226526001227`（HarmonyOS 6.1.0.135 / API 24）；debug 签名 HAP ≈492MB。
> 完整报告：`logs/20261002-1/TEST_REPORT.md`（gitignored）。

### 14.1 结论

**端到端打通**：市场一键**安装/卸载**插件，经宿主 `desktopPnpm` 服务在 **worker 线程内进程式运行 pnpm**；无子进程、无 symlink，安装后插件 `hot:true / live`。

### 14.2 实现阶段发现并修复的三个平台问题

| # | 问题 | 现象 | 修复 |
|---|---|---|---|
| **P1** | pnpm@11 依赖 `node:sqlite` | 引擎 import 抛 `No such binding: sqlite`（Electron/Node 运行时无该 binding） | 引擎改用 **pnpm@10.34.6**（不使用 node:sqlite）；`PNPM_VERSION` 常量 |
| **P2** | Electron `process.execPath` **只读** | pnpm `@pnpm/config#getConfig` 无条件 `process.execPath = node` → `Cannot assign to read only property 'execPath'` | worker 在 import 前把 `process.execPath` 设为 **no-op setter**（保留真实值） |
| **P3** | 鸿蒙**禁 symlink**，pnpm 仍建 `.bin` 软链 | `EACCES: symlink '../js-yaml/bin/js-yaml.js' -> '.bin/js-yaml'` → 安装失败 `exit=-13` | worker 把 `fs`/`fs.promises.symlink` 在 `EACCES/EPERM` 时**回退为 copy**；bin 落地为真实文件 |

### 14.3 用例结果

| 用例 | 项 | 结果 | 证据 |
|---|---|---|---|
| TC-D09 | 路径 B 就位 | ✅ | `__marketRuntime` path=B, ok=true |
| TC-D08 | 诊断探针 | ✅ | `__marketRuntimePnpm` = {profile:desktop, engineEntry:…/dsh-market-pnpm/bin/pnpm.cjs, engineOk:true} |
| — | 服务注册（desktopProfiles/desktopPnpm） | ✅ | 插件加载且市场 `desktopPnpm` 分支被采用 |
| TC-D01 | 市场一键安装（进程内） | ✅ | `POST /dsh-market/install` → 200 `{ok:true,hot:true,exitCode:0}`；`dsh-answer-reviewer@0.7.6` 落地 |
| TC-D07 | 安装后 live | ✅ | activation `state:"live"`（bundle patch 热加载） |
| TC-D02 | 无 node/pnpm 子进程 | ✅ | 安装 ndjson 的 `pid` = 应用主进程 PID（55779），非子进程 |
| TC-D03 | 无 symlink / bin 为真实文件 | ✅ | profile node_modules 递归扫描 symlinkCount=**0**；`.bin/{cordis,js-yaml}` 均 file |
| TC-D04 | 卸载（进程内） | ✅ | `POST /dsh-market/uninstall {name}` → 200 `{ok:true,exitCode:0}`；包目录消失、deps 移除 |
| TC-D05 | 失败不崩、不毁 profile | ✅ | 修复前的一次失败安装返回非零 + 可读错误，主进程存活、profile 可启动 |
| TC-D06 | 取消安装 | ⏭ 未专项测试 | `cancel()` = `worker.terminate()`（best-effort） |
| U | 单元测试 | ✅ | `node --test` 7/7 通过 |

市场日志实证（`.dsh/profiles/desktop/.dsh-market/log.ndjson`）：
```
{"event":"install","detail":"dsh-answer-reviewer@0.7.6 exit=0 hot=true"}
{"event":"hot-mount","detail":"dsh-answer-reviewer: live"}
```

### 14.4 构建/部署注意

- **物化引擎版本断言**：`collect-dsh.mjs` 的 `assertPnpmEngineArtifact()` 在「已物化快路径」也校验版本+入口非空。
- **部署必须 `hdc uninstall` 先清 userData**：`ensureDshExtracted` 只在 marker 缺失时解压，`install -r` 不刷新已解压的 dsh-dist（否则继续跑旧引擎/旧 worker）。
- **collect-runtime 必须跑**：它把 `src-main/{main.js,market-runtime.js}` 复制进 `resfile/resources/app/`；跳过会导致打包的 main.js 陈旧（`DSH_PNPM_ENGINE` 未设）。

---

## 15. 提交记录（Conventional Commits）

| Commit | 类型 | 说明 |
|---|---|---|
| `8b19bce` | `docs:` | 012 规范四件套 + 201 契约化 |
| `bac5c58` | `feat:` | 进程内 pnpm 引擎（插件 + 物化 + 接线） |
| `094034d` | `docs:` | spike 结论回填 012 plan/tasks |
| `d03609b` | `fix:` | 代码评审修复（reporter 冲突、配置归属、物化断言） |
| `85dfc6c` | `fix:` | 真机三修复（pnpm@10 / execPath / symlink→copy） |
| `a4bbe0f` | `build:` | 同步打包的 main.js / market-runtime.js 副本 |
| `ad2607f` | `docs:` | 012 tasks 更新 |

代码评审（`requesting-code-review` → `receiving-code-review`，审查者 = `flash` 子agent）：报告见 `logs/20261002-1/REVIEW_REPORT.md`；重要项（reporter 覆盖、配置被强制回盖、物化快路径绕过断言）均已修复。

---

## 16. 最终状态

| 项 | 状态 |
|---|---|
| 规范 | ✅ `specs/012-pnpm-integration/`（4 文件）+ `specs/201-dsh-market/`（更新） |
| 实现 | ✅ 插件 + 引擎物化 + profile 配置 + 契约注册 + 版本断言 |
| 单测 | ✅ 7/7 |
| 真机 E2E | ✅ 安装 / 卸载进程内成功，插件 live，零 symlink |
| 上架可行性 | ✅ 零 ELF / 零 symlink / 零证书 / 零 ACL（PnP 契约路线） |
| 未决 | TC-D06 取消专项测试；`git:` 源与依赖构建脚本插件不可装（已披露） |

