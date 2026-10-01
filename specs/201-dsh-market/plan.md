# 201-dsh-market 技术方案

> 模块：201-dsh-market
> 对应规格：[spec.md](./spec.md)
> Status: Implemented（集成已落地；安装通道路径随 012 演进）
> Last Updated: 2026-10-02
> 关联模块：[`012-pnpm-integration`](../012-pnpm-integration/)（安装通道的进程内引擎与契约实现）

## 1. 技术上下文

### 1.1 运行时环境

- **构建期**：Windows 宿主机 Node（`node scripts/*.mjs` 直接调用），dsh-market 的 `npm install` / `npm run build` 由 `build-dsh.mjs` 用 `execSync` 执行。
- **运行期**：Electron-on-鸿蒙（Electron 37 / Node 22.17.0）主进程内。dshmarket 是 dsh Host 的 in-process Cordis 插件，不独立成进程。安装通道由 012 的进程内 pnpm 引擎承担（同主进程）。
- **部署形态**：市场产物随 `dsh-dist/` 打包进 `dsh-dist.tar.gz` → 打入 resfile → 首次启动解压到 `userData/dsh-dist`。

### 1.2 依赖

| 依赖 | 版本/来源 | 用途 |
|------|-----------|------|
| dsh-market | 同级源码引用（`../dsh-market`，submodule；包名 `dshmarket`，固定 **`1.66.7`**） | 内置插件市场（构建 `lib/` + `client/`）；提供 `desktopProfiles`/`desktopPnpm` 契约 |
| deepseek-harness（dsh） | 同级源码引用（`../deepseek-harness`，dsh-v0.2.0-rc.2） | 提供 `dsh.client` 机制、`cordis.patch.yml` 补丁层、profile 目录与 bundles 维护函数；市场的 `@deepseek-ai/*` 依赖从宿主物化产物解析 |
| 市场运行时依赖 | `undici`、`js-yaml`、`argparse` 等（`dependencies` + 传递依赖） | 由 `copyMarketRuntimeDeps()` 从市场 `node_modules` 复制进物化目录 |
| [`012-pnpm-integration`](../012-pnpm-integration/) | 本工程 | 提供安装/卸载的进程内 pnpm 引擎与 `desktopProfiles`/`desktopPnpm` 契约实现 |

> **构建前置**：`../dsh-market` 必须在编译前存在于本工程同级目录。`build-dsh.mjs` 缺失时警告跳过；`collect-dsh.mjs` 物化时缺失或版本不符则 `process.exit(1)` 硬失败。

## 2. 宪法合规检查

| 宪法原则（constitution.md） | 状态 | 说明 |
|---|---|---|
| §1.1 零上游改动 | ✅ | 不改 dsh-market 与 dsh 源码；安装通道走市场**已内置**的 `desktopProfiles`/`desktopPnpm` 契约 |
| §1.3 只写装配代码 | ✅ | 内置 = 构建 + 收集物化 + 运行期复制 + patch 注入 + 契约实现（由 012 承担），无业务逻辑 |
| §1.5 sibling 源码引用 + 构建期 copy | ✅ | `../dsh-market` 同级源码引用，构建期收集产物 |
| §5.1 幂等构建 | ✅ | 物化/复制均以「目标 package.json 已存在则跳过」保证幂等 |
| §5.3 产物适配集中在收集脚本 | ✅ | 市场物化集中在 `collect-dsh.mjs` 的 `collectDshMarket()` |
| §2.2 沙箱边界 | ✅ | 运行期复制而非 symlink；安装不 spawn 子进程 |
| §4.2 崩溃兜底 | ✅ | `ensureDshMarketProfileLink` 失败不阻塞 Host 启动 |

> 合规结论：全部 ✅。

## 3. 研究结论

- **双解析锚点**（市场前后端两个半体须在两个位置均可解析）：
  1. **bundle loader 锚点 = `DSH_ROOT/node_modules`**：`cordis-plugin-loader` 用裸 `import('<plugin>')` 加载 bundle，Node 沿 dsh 根目录树向上查 node_modules，故市场须物化到 `dsh-dist/node_modules/dshmarket`。
  2. **client 扫描锚点 = profile 目录**：`dsh-client-modules` 以 profile 目录为 baseUrl 扫描 `dsh.client` 声明来服务 `/plugins/<pkg>/client.js`，故运行期须复制到 `$DSH_HOME/profiles/node_modules/dshmarket`。
- **复制而非 symlink**：鸿蒙沙箱禁止 `symlinkSync`（抛 `EACCES`），故 `ensureDshMarketProfileLink()` 用 `cpSync(..., {recursive, dereference:true})` 物理复制（FR-201-007）。
- **运行时依赖须显式复制**：npm 扁平布局下市场的传递依赖（`undici` 等）不在 dsh 根 node_modules，不复制则市场 host 端 import 失败；`copyMarketRuntimeDeps()` 用 BFS 沿 `dependencies` 字段复制 + 传递依赖，`@deepseek-ai/*` scope 跳过（FR-201-005）。
- **profile 注入 desktop + allowRestart:false**：市场默认 profile 为 `web`，桌面用 `desktop`，须显式注入避免写错目录；桌面壳拥有进程生命周期，市场不得 spawn 独立 dsh 进程（FR-201-010）。
- **安装通道的三条运行时路线**（`dsh-market/src/index.ts:180-322`）：
  1. **官方 Electron**（`config.profile='desktop'` → `pluginManager` 服务）：`pluginManager` 内部**仍 spawn pnpm** → 鸿蒙 SIGSYS，**不可用**。
  2. **`desktopProfiles` 服务存在**：市场取上下文 `desktopPnpm`（`:291`）并 `createDesktopPluginRuntime(service, current.dir)`（`:292`），走 `DesktopPnpmLike.runPlugin` **进程内** → **本工程采用**。
  3. **普通宿主**：`setHostPackageManager(profileContext.packageManager)` / PATH → spawn，**不可用**。
  - 结论：本工程 MUST 提供**路线 2** 的 `desktopProfiles` 服务（由 012 实现），使市场特性检测后走进程内通道。
- **契约形状**（市场侧，`dsh-cli.ts:577-608`）：`runPlugin(args, invokingDir, signal): {stdout, stderr, done: Promise<{exitCode,signal}>, cancel()}`。市场另有可选 `runExternalMarketPluginInstall`（官方桌面专用，本工程不实现）。
- **版本不一致（已修）**：submodule `4f7a79`（1.66.7）、README/profile 旧 `1.26.0`、spec 旧 `1.29.2`；现统一为 `1.66.7` 并在构建期断言（FR-201-018，落于 012 的 `assertDshMarketVersion()`）。

## 4. 数据模型

### 4.1 物化产物结构（构建期，`dsh-dist/node_modules/dshmarket/`）

```
dshmarket/
├── package.json        # name=dshmarket
├── cordis.patch.yml    # insert 声明（- insert: [{id: dsh-market, name: dshmarket}]）
├── lib/                # host half
├── client/             # browser half
└── node_modules/       # 运行时依赖（undici/js-yaml 等，无 @deepseek-ai/*）
```

### 4.2 运行期双锚点

| 锚点 | 路径 | 用途 |
|------|------|------|
| bundle loader 锚点 | `userData/dsh-dist/node_modules/dshmarket` | 裸名 `import('dshmarket')` 解析 |
| client 扫描锚点 | `$DSH_HOME/profiles/node_modules/dshmarket` | 服务 `/plugins/dshmarket/client.js` |

### 4.3 profile 声明与配置

- `profiles/desktop/package.json`：`dependencies.dshmarket = "1.66.7"`；`dsh.profile.bundles = ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app", "dshmarket"]`。
- `profiles/desktop/cordis.patch.yml`（dsh-market 段）：

```yaml
- id: dsh-market
  name: dshmarket
  config:
    profile: desktop
    allowRestart: false
```

- `profiles/desktop/pnpm-workspace.yaml`（由 012 注入）：`nodeLinker: hoisted`、`packageImportMethod: copy`、`ignoreScripts: true`、`storeDir`（沙箱内）、`minimumReleaseAge: 0`。

### 4.4 安装通道数据流

```
市场 UI → POST /dsh-market/install（同源，进程内）
  → 市场 apply() 特性检测 ctx.get('desktopProfiles')   ← 012 提供
      → createDesktopPluginRuntime(desktopPnpm, profileDir)
          → desktopPnpm.runPlugin(['add', '<spec>'], dir, signal)
              → 012 的进程内 pnpm 引擎（主进程内，无 spawn）
                  → 写入 profile 的 node_modules（扁平）
          → 句柄 {stdout, stderr, done, cancel} 回传市场
  → 市场据 done.exitCode 更新 UI；bundles 由市场经 dsh 进程内函数 reconcile
```

### 4.5 状态与幂等

- 物化幂等判定：`dsh-dist/node_modules/dshmarket/package.json` 存在即跳过（`collectDshMarket()`）。
- 复制幂等判定：`$DSH_HOME/profiles/node_modules/dshmarket/package.json` 存在即跳过（`ensureDshMarketProfileLink()`）。

## 5. 接口契约

### 5.1 提供的接口

| 位置 | 符号 | 说明 |
|------|------|------|
| `scripts/build-dsh.mjs` | dsh-market 构建段 | `npm install`（node_modules 缺失时）+ `npm run build`，缺失 warn 跳过 |
| `scripts/collect-dsh.mjs` | `collectDshMarket()` | 物化市场到 `dsh-dist/node_modules/dshmarket`；缺失 `process.exit(1)` |
| `scripts/collect-dsh.mjs` | `copyMarketRuntimeDeps(srcNm, destNm, marketRoot)` | BFS 复制运行时依赖（跳过 `@deepseek-ai` scope） |
| `scripts/collect-dsh.mjs` | `assertDshMarketVersion()`（012 新增） | 市场版本断言（FR-201-018） |
| `src-main/main.js` | `ensureDshMarketProfileLink(home)` | 复制 dshmarket 到 `$DSH_HOME/profiles/node_modules/dshmarket`（幂等、非阻塞） |
| `src-main/*`（012） | `desktopProfiles` / `desktopPnpm` | 提供给市场的进程内包管理器契约（FR-201-011/012） |
| `profiles/desktop/package.json` | manifest | `dshmarket@1.66.7` 依赖 + bundles 声明 |
| `profiles/desktop/cordis.patch.yml` | dsh-market 段 | 注入 `config: { profile: desktop, allowRestart: false }` |

### 5.2 消费的接口

- dshmarket 自身 `cordis.patch.yml` 的 `- insert: [{id: dsh-market, name: dshmarket}]` 行（由 profile 声明为 bundle 后随组合应用）。
- dsh 的 `dsh.client` 机制与 `cordis-plugin-loader`（裸名 import）。
- 市场自身的 `desktopProfiles` 特性检测 + `DesktopPnpmLike.runPlugin`（`dsh-cli.ts:577-608`、`index.ts:183,285-292`）。
- dsh 的 `writeProfileBundles` / `reconcileProfilePlugins` / `selectBundle`（bundles 维护）。

### 5.3 事件协议

- 无自定义事件协议。构建/收集为同步 `execSync` 编排；运行期复制为一次性 `cpSync`；安装通道经 `runPlugin` 的 stdout/stderr 流传递进度（市场自身解析 pnpm ndjson）。日志带 `[dsh-harmony]` / `[collect-dsh]` 前缀。

## 6. 实现策略

### 6.1 架构模式

**装配 + 物化 + 引导 + 契约实现**：构建期（`build-dsh.mjs` + `collect-dsh.mjs`）准备并物化产物；运行期（`main.js`）复制到 profile + profile patch 注入配置 + 注册 `desktopProfiles` 契约（012）；不修改上游。

### 6.2 关键算法

- **市场物化**（FR-201-003/004/006）：`collectDshMarket()` 校验 `../dsh-market/package.json` 存在，否则 `process.exit(1)`；`cpSync(marketRoot, dest, {filter})` 只保留顶层 `package.json`、`cordis.patch.yml`、`lib`、`client`。
- **运行时依赖复制**（FR-201-005）：`copyMarketRuntimeDeps()` BFS——`seen` 去重、`@deepseek-ai/` 跳过、源/目标 `package.json` 任一已存在则跳过。
- **运行期复制**（FR-201-007/008）：`ensureDshMarketProfileLink(home)` 校验源与目标 `package.json`；`mkdirSync` 后 `cpSync(...)`；`catch` 仅 `console.error` 不抛出。
- **安装通道**（FR-201-011~016）：不实现算法，由市场经 `desktopPnpm.runPlugin` 调用 012 的进程内引擎；本模块只保证契约可达（服务注册时机早于 market mount）。

### 6.3 错误处理

- **致命**（`process.exit(1)` + `console.error`）：收集阶段 `../dsh-market/package.json` 缺失或版本不符。
- **可跳过**（`console.warn`）：构建阶段市场缺失。
- **非阻塞**（`console.error` 后返回）：运行期 `ensureDshMarketProfileLink` 复制失败；`desktopProfiles` 契约注册失败（市场退回原路径，日志显式记录）。

### 6.4 性能

- 均为一次性构建/首次启动操作，无热路径；安装为进程内一次性操作。体积可控（排除源码/测试/devDeps 与 `@deepseek-ai` scope）。

## 7. 测试考量

- **产物结构检查**（Windows 可执行）：`dsh-dist/node_modules/dshmarket/{package.json,lib,client,cordis.patch.yml}` 均存在；`node_modules` 含运行时依赖且不含 `@deepseek-ai`。
- **版本断言**：市场版本 ≠ `1.66.7` 时构建失败。
- **幂等验证**：重复执行收集脚本断言「已物化」；重复启动断言「已复制」仅一次。
- **边界**：`../dsh-market` 缺失 → `collect-dsh.mjs` `process.exit(1)`；`build-dsh.mjs` 缺失 → warn 跳过；运行时复制失败 → 不阻塞启动。
- **真机验证**（Electron 37 真机）：设置页出现「插件市场」入口；`/plugins/dshmarket/client.js` → 200；`/dsh-market/installed` 返回 `dshmarket` 且 `bundle=true`；**一键安装/卸载走进程内通道成功**（详细用例见 [012 test-cases](../../012-pnpm-integration/test-cases.md) 的 D 类）。

## 8. 文件清单

| 文件 | 用途 | 类型 |
|------|------|------|
| `scripts/build-dsh.mjs` | 构建 dsh-market（`npm install` + `npm run build`） | 改 |
| `scripts/collect-dsh.mjs` | `copyMarketRuntimeDeps()` + `collectDshMarket()` + `assertDshMarketVersion()` | 改 |
| `src-main/main.js` | `ensureDshMarketProfileLink()` + 契约注册接线（012） | 改 |
| `profiles/desktop/cordis.patch.yml` | dsh-market 行 `config: { profile: desktop, allowRestart: false }` | 改 |
| `profiles/desktop/package.json` | `dshmarket@1.66.7` 依赖 + bundles 声明 | 改 |
| `src-main/pnpm-*.js`（012） | 进程内引擎 + 契约实现 | 新增（012 交付） |

## 9. 与规格的交叉引用

| 技术决策 | 对应规格需求 |
|---|---|
| `build-dsh.mjs` 市场构建段 | FR-201-001 |
| 市场缺失 `console.warn` 跳过 | FR-201-002 |
| `collectDshMarket()` 复制产物 | FR-201-003 |
| `collectDshMarket()` 缺失 `process.exit(1)` | FR-201-004 |
| `copyMarketRuntimeDeps()` BFS | FR-201-005 |
| `existsSync(dest/package.json)` 跳过 | FR-201-006 |
| `ensureDshMarketProfileLink()` `cpSync` | FR-201-007 |
| 复制幂等 + `catch` 非阻塞 | FR-201-008 |
| `profiles/desktop/package.json` bundles + dependencies | FR-201-009 |
| `cordis.patch.yml` 段 | FR-201-010 |
| `desktopProfiles` 服务（012） | FR-201-011 |
| `desktopPnpm.runPlugin`（012） | FR-201-012/013/014 |
| 市场经 dsh 进程内 bundles 维护 | FR-201-015/016 |
| 契约缺失显式记录 | FR-201-017 |
| `assertDshMarketVersion()` | FR-201-018 |

## 10. 关键决策记录

| # | 决策 | 备选 | 理由 |
|---|---|---|---|
| D1 | 安装通道走市场的 `desktopProfiles`/`desktopPnpm` 契约（进程内） | 打市场补丁改 spawn 点 | 零上游改动；成本低、可审计 |
| D2 | 版本固定 `1.66.7` + 构建期断言 | 浮动版本 | 市场版本决定安装路线，不能浮动；且消除既有三处不一致 |
| D3 | 运行期复制而非 symlink | symlink | 鸿蒙沙箱禁 symlink（B1） |
| D4 | 不内置便携 ELF（路径 A 撤回） | 随包 Node/pnpm ELF | 需二进制证书，个人开发者不可得 |
| D5 | 进程内引擎由 012 提供 | 本模块内联 | 职责分离；012 可独立演进与测试 |

## 11. 风险与缓解

| # | 风险 | 影响 | 缓解 |
|---|---|---|---|
| R1 | 市场版本变化移除/改变 `desktopProfiles` 契约 | 安装通道失效 | 版本固定 + 断言；契约缺失显式记录；可退 012 Route 2 |
| R2 | 契约注册时机晚于 market mount | 市场走回 spawn 路线 | 注册须在 bundle mount 前；真机验证日志 |
| R3 | `git:` 源 / 依赖构建脚本的插件不可装 | 部分插件装不了 | UI/文档披露 |
| R4 | `dsh-dist` 就地升级不重解压 | 设备用旧产物 | 沿用 202 结论：需全新安装生效 |
| R5 | 市场运行时依赖闭包变化 | 复制不全导致 import 失败 | 收集期 BFS 复制；真机验证市场可加载 |

---

*事实以源码为准；版本固定后随变更同步。*
