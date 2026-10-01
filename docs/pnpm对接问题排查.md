# pnpm 对接问题排查记录

> 设备：HarmonyOS / OpenHarmony arm64（`process.platform === 'openharmony'`）
> 应用：DeepSeek Harness 桌面版（HAP 包名 `org.fellow99.dsh.DshDesktop`，主进程 PID 32805）
> 排查日期：2026-09-29
> 结论一句话：**在 DSH 签名包内无法使用 pnpm。** 直接原因是本应用域禁止子进程分配 JIT 可执行内存，任何 node 脚本（npm / corepack / pnpm）一启动就被内核以 `SIGSYS` 杀死；pnpm 装在哪、PATH 怎么配都改变不了这一点。

> **补充结论（2026-10-01 深入分析后）**：上面这句只对「**spawn 子进程**」这条路成立。把 pnpm **纯 JS 版本打入包中、并让 Electron 主进程在进程内调用它**（不 spawn 任何子进程）是**可行**的 —— 本工程 `specs/011-runtime-provisioning/` 的「路径 B」正是这条路线，探测/选路/校验代码（`src-main/market-runtime.js`）已实现并单测通过，只差「进程内调用补丁」未投入。详见本文 §11。

---

## 1. 背景与目标

目标链路是「在设备上装好 pnpm → 让终端能用 → 让 DSH 应用和 dsh-market 插件市场也能用」。

最终状态：

| 环节 | 结果 |
|---|---|
| 终端（zsh）里 `pnpm -v` | ✅ 可用 |
| DSH 应用内的 shell 找到 pnpm | ❌ |
| dsh CLI（`dsh plugin …`）找到 pnpm | ❌ |
| dsh-market 一键安装组件 | ❌ |
| DSH 应用内**运行** pnpm | ❌ **平台级不可能** |

---

## 2. 环境事实（实测）

### 2.1 Node / npm 的来源

node、npm 由 HNP（Harmony Native Package）提供，不是普通安装：

- `/data/service/hnp/bin/node` → v24.13.0
- `/data/service/hnp/bin/npm`
- 真实包目录：`/data/service/hnp/node.org/node_v24.13.0`
- `/data/service/hnp/bin/` 是 HNP 依据 `hnp.json` 生成的链接目录，内容只有：
  `node  npm  npx  python  python3  python3.12`
  **没有 `corepack`，也没有 `pnpm`。**
- `hnp.json` 的 links 声明：
  ```json
  {"source": "/bin/node", "target": "node"},
  {"source": "/lib/node_modules/npm/bin/npm-cli.js", "target": "npm"},
  {"source": "/lib/node_modules/npm/bin/npx-cli.js", "target": "npx"}
  ```
- 包内 `lib/node_modules/` 只有 `corepack` 和 `npm` 两个包（corepack 在包目录里，但**没被链接进 hnp/bin**，所以不在 PATH 上）。

### 2.2 权限

```
drwxrwxr-x installs  installs  /data/service/hnp
drwxrwxr-x installs  installs  /data/service/hnp/bin
uid=20020201(pci) gid=20020201(pci_a20201) context=u:r:debug_hap:s0
touch /data/service/hnp/bin/.wtest   →  Permission denied
```

→ **应用域用户对 HNP 目录只有读+执行**，`npm i -g` 默认的全局前缀（node 安装目录）不可写。这也是为什么后来把 npm 全局前缀改到了用户可写目录。

### 2.3 DSH 应用进程的环境

```
PATH=/data/app/bin:/data/service/hnp/bin:/data/app/bin:/data/service/hnp/bin:/usr/local/bin:/bin:/usr/bin:/system/bin:/vendor/bin
HOME=/data/storage/el2/base/files
DSH_HOME=/data/storage/el2/base/files/.dsh
TMPDIR=/data/storage/el2/base/cache
HNP_PUBLIC_HOME=/data/service/hnp
HNP_PRIVATE_HOME=/data/app
DSH_EXTRA_WRITABLE_ROOTS=/storage/Users/currentUser/Desktop:/storage/Users/currentUser/Documents:/storage/Users/currentUser/Download
ELECTRON_EXEC_PATH_OHOS=/data/app/electron.org/electron_1.0/bin/electron/electron   ← 该路径实际不存在
SHELL=/bin/sh
```

要点：
- PATH 里 `/usr/local/bin`、`/usr/bin`、`/data/app/bin` **都不存在**，实际只有 `/data/service/hnp/bin` 里的 node 系工具。
- `process.execPath` 实际指向 `/system/bin/appspawn`（Electron 以 `libelectron.so` 形式被 appspawn 加载，`/proc/32805/exe` 仍是 appspawn）；`process.argv0` 是包名 `org.fellow99.dsh.DshDesktop`。这对 dsh-market 的「重新拉起 dsh CLI」逻辑是有影响的坑。
- `/data/app` 是 `root:root 0711`，其下没有 `electron.org` 目录。

---

## 3. 问题一：`npm i pnpm -g` 失败 —— pnpm 12 没有 openharmony 二进制（已解决）

### 现象

```
npm error code 1
npm error path /data/storage/el2/base/files/npm_global_modules/lib/node_modules/pnpm
npm error command sh -c node install.js
npm error pnpm does not ship a prebuilt binary for openharmony-arm64.
```

### 根因

`pnpm` 这个 npm 包从 **v12（当前 latest = 12.6.0）起已改为 Rust 原生程序的分发壳**：

- `package.json` 里 `scripts.preinstall` / `scripts.postinstall` 均为 `node install.js`
- `optionalDependencies` 只有平台二进制包：
  `@pnpm/exe.{win32-x64, win32-arm64, darwin-x64, darwin-arm64, linux-x64, linux-arm64, linux-x64-musl, linux-arm64-musl, linux-ppc64, linux-s390x, linux-riscv64, freebsd-x64, android-x64, android-arm64}`
- `install.js` 调用 `native-binary.mjs` 的 `getBinCandidates()`，而那里是**硬编码平台白名单**：
  ```js
  const PLATFORMS = { win32: {...}, darwin: {...}, linux: {...}, freebsd: {...}, android: {...} }
  const platformEntry = PLATFORMS?.[platform]?.[arch]
  if (platformEntry == null) return []          // openharmony 走到这里
  ```
  **没有 `openharmony` 键，也没有任何环境变量可以覆盖它。**
- 本机 `process.platform === 'openharmony'`、`arch === 'arm64'` → `hostTarget()` 拼出 `openharmony-arm64` → 候选为空 → `exit 1`，包根本没落地，所以 `pnpm -v` 找不到命令。

同类上游 issue：[pnpm#14679](https://github.com/pnpm/pnpm/issues/14679)（Android/Termux）、[pnpm#14431](https://github.com/pnpm/pnpm/issues/14431)（让 android 复用 linux-musl 二进制）。

### 解决

改用**仍是纯 JS 实现**的 pnpm 大版本：

| 版本 | 形态 | 是否可用 |
|---|---|---|
| `pnpm@12.x` | Rust 原生二进制分发壳 | ❌ 无 openharmony 产物 |
| `pnpm@11.28.2` | 纯 JS（`type: module`，`bin/pnpm.mjs`，**无 install 脚本、无平台 optional 依赖**），`engines: node >=22.13` | ✅ |
| `pnpm@10.34.6` | 纯 JS（`type: commonjs`，`bin/pnpm.cjs`），`engines: node >=18.12` | ✅ |

```sh
npm i -g pnpm@11
```

> 注意：不要直接 `corepack enable pnpm`（默认取 latest = 12，仍会去找 openharmony 二进制）。要指定版本：
> `corepack enable --install-directory <bin> pnpm@11.28.2`

---

## 4. 问题二：PATH 写进 `~/.profile` 不生效（已解决）

### 现象

```sh
echo 'export PATH=/data/storage/el2/base/files/npm_global_modules/bin:$PATH' >> ~/.profile
# 重启终端后 pnpm 仍然 not found
```

### 根因

**本机终端是 zsh，zsh 不读 `~/.profile`。**

| 文件 | 加载时机 |
|---|---|
| `~/.zshenv` | 每次启动 zsh（交互/非交互都读，最稳） |
| `~/.zprofile` | 登录 shell |
| `~/.zshrc` | 交互式 shell |
| `~/.zlogin` | 登录 shell，最后 |

### 解决

```sh
printf '\n# pnpm global bin\nexport PATH="/data/storage/el2/base/files/npm_global_modules/bin:$PATH"\n' >> ~/.zshenv
source ~/.zshenv
pnpm -v     # ✅ 有输出
```

若 `ZDOTDIR` 被设置，要写到 `$ZDOTDIR/.zshenv`；若只给交互终端用，写 `~/.zshrc` 也可以（但非交互场景如 DSH、脚本不会读）。

---

## 5. 问题三：DSH / dsh-market 找不到 pnpm（部分定位）

### 5.1 `dsh plugin` 是裸 spawn，只看 PATH

`@deepseek-ai/dsh/lib/plugin-D0XB2ABu.js`：

```js
const result = spawnSync("pnpm", args.map(...), { cwd: dir, stdio: "inherit", ... })
if (result.error?.code === "ENOENT") {
  process.stderr.write(`dsh: pnpm not found on PATH — install pnpm to manage profile plugins\n`)
  return 127
}
```

- 没有 `PNPM_HOME`、没有额外搜索目录，**完全依赖 app 进程的 `process.env.PATH`**。
- app 的 PATH 见 §2.3；用户的 pnpm 在 `/data/storage/el2/base/files/npm_global_modules/bin`，不在其中。
- 且从应用沙箱看，**该目录不存在**（`ls` 报 ENOENT），说明「终端的 `/data/storage/el2/base/files`」与「DSH 沙箱的 `/data/storage/el2/base/files`」很可能**不是同一个物理目录**（同一字符串、不同挂载视图）。目前 DSH 侧 `stat` 为 `Device 66662d / Inode 678368`，需在终端 `toybox stat` 对比确认（见 §8 待办）。

### 5.2 dsh-market 的搜索范围与「一键安装」路径

`dshmarket/lib/dsh-cli.js`：

```
toolSearchDirs() = [PNPM_HOME] + (win: %LOCALAPPDATA%\pnpm, %APPDATA%\npm
                                 unix: /opt/homebrew/bin, /usr/local/bin,
                                       $HOME/.local/bin, $HOME/Library/pnpm,
                                       $HOME/.local/share/pnpm)
                   + nodeBinDir + extraPathDirs(运行期学到的目录)
spawnEnv().PATH  = hostEnv.PATH + process.env.PATH + toolSearchDirs()
```

`provisionPnpm()`（一键安装）流程：

1. `corepack enable pnpm` → 本机 PATH 上没有 corepack → **`exit=127 spawn corepack ENOENT`**
2. 回退 `npm install -g pnpm` → 装的是 pnpm **12** → 又回到 §3 的 openharmony 二进制问题
3. 若 npm/corepack 退出码为 0，再 `npm prefix -g` 学会新的 bin 目录并加进 `extraPathDirs`

市场日志实证（`/data/storage/el2/base/files/.dsh/profiles/desktop/.dsh-market/log.ndjson`）：

```json
{"at":"2026-09-29T04:00:31.709Z","level":"warn","event":"setup-pnpm","detail":"corepack enable: exit=127 spawn corepack ENOENT"}
```

之后**没有** `npm -g:` 那行日志 —— 说明那一步的 npm 子进程没有正常结束（见 §6）。

### 5.3 现有 profile 是「预置」的，不是 pnpm 装的

```
/data/storage/el2/base/files/.dsh/profiles/desktop/node_modules/   ← 空
/data/storage/el2/base/files/.dsh/profiles/desktop/                ← 无 pnpm-workspace.yaml
/data/storage/el2/base/files/.dsh/profiles/node_modules/           ← 扁平目录，无 .pnpm/、无 .modules.yaml
```

插件（`dshmarket`、`harmony-plugin-*`、`@deepseek-ai/*`）是打包方预置进 `profiles/node_modules` 的，**不是 pnpm 安装产物**。也就是说这个构建里的插件管理链路从未真正跑通过。

---

## 6. 问题四（致命）：应用域内 node 子进程一律被 SIGSYS 杀死

### 6.1 实测矩阵

我的 shell 就在 DSH 应用进程（PID 32805）里，同一 SELinux 域 `u:r:debug_hap:s0`：

| 命令 | 结果 |
|---|---|
| `node -v` | ✅ `v24.13.0` |
| `node --v8-options` | ✅ 能打印 |
| `node --jitless -v` | ✅ |
| `node -e "console.log(1)"` | ❌ `Signal 31 (core dumped)`（SIGSYS） |
| `node /…/_probe.js` | ❌ SIGSYS |
| `node --jitless -e "…"` | ❌ SIGSYS |
| `npm -v` | ❌ SIGSYS |
| `python3 -c "print('py-ok')"` | ✅ |
| `python3 -c`（含 `threading` 启线程） | ✅ |
| `dmesg` | ❌ SIGSYS |

放宽文件策略（`danger-full-access`）后重测，结果不变 → **不是 DSH 的文件沙箱，也不是权限/路径问题**。

### 6.2 判读

- 不是「不能执行代码」：python3 连同多线程都正常。
- 不是「node 二进制坏了」：`node -v` / `--v8-options` 能跑。
- `dmesg` 也被 SIGSYS，说明这是本应用域的 **seccomp 策略**在按系统调用（含参数，例如带 `PROT_EXEC` 的 `mmap`）投递 SIGSYS。
- 因此：**这个 HAP 的子进程无法分配 JIT 可执行内存**，V8 一创建 isolate（真正开始编译/执行 JS）就被打死。`--jitless` 也无效（V8 仍要代码区）。

### 6.3 社区同类记录（佐证）

OHOS 移植补丁仓库 `shenjackyuanjie/dsh-ohos-patch` 的 README / `docs/ohos-install.md`：

> 沙箱：任何 **fork 出的子进程** 无法分配 JIT 可执行内存，node 进程启动即崩
> （`Check failed: 12 == (*__errno_location())` / `Signal 5`）；
> 只有"命令执行器直接启动的进程"可跑 node。
> **CodeWhale 沙箱的"子进程 JIT 限制"是沙箱特有的，真实 ohos shell 无此问题。**

以及：

> **HarmonyOS 禁用户目录 exec ELF**：用户数据分区（`/storage/Users`、el2 数据目录）不可执行 ELF（Permission denied）。

这两条正好解释了本机现象：终端（真实 shell）能跑 node/pnpm，而 DSH 这个应用域的子进程全崩；同时「塞一个 linux-arm64 原生 pnpm」也走不通 —— 用户数据目录不能 exec ELF，而可 exec 的系统目录（`/data/service/hnp/bin`、`/data/app/bin`）都不可写。

### 6.4 结论

**即使把 pnpm 放进 app PATH 让 dsh 找到它，pnpm（node 脚本）作为子进程也会立刻被 SIGSYS 杀掉。**

所以应用内的以下动作在当前构建下都是死路：

- dsh-market「一键安装组件」（corepack/npm 都是 node 脚本）
- `dsh plugin add/remove/update`（转发给 pnpm）
- 市场 UI 里安装/更新/卸载插件

顺带印证：本构建的 profile patch 已经禁用了 `subprocess / sandbox / bash-sandbox / permission / open-in-app`（原因同样是原生模块无 aarch64 产物），说明打包方是在同一类平台限制下做的裁剪。

---

## 7. 可行方案

### 7.1 终端代管插件（需先确认目录是否同一物理目录）

终端里 node 可正常跑，所以**用终端执行包管理**，再让 DSH 重启加载：

```sh
cd /data/storage/el2/base/files/.dsh/profiles/desktop
pnpm add <插件包名>            # 可加 --registry https://registry.npmmirror.com
# 把新包加进 profile package.json 的 dsh.profile.bundles（dsh plugin 会自动做，手工则需自己补）
```

前提：终端的 `/data/storage/el2/base/files` 与 DSH 沙箱的是**同一个目录**。若 §8 的标记文件测试显示不可见，则此路也不通（终端写的是它自己的沙箱）。

### 7.2 让打包方在签名包内集成 pnpm

正确做法是**在 Electron 主进程内进程式调用 pnpm**（主进程有 JIT 权限，能跑 JS），而不是 `spawn` 子进程；或把 pnpm 运行时与必要的插件直接内置进包。这属于厂商侧改动，用户侧无法绕过。

### 7.3 明确不可行的做法（避免重复踩坑）

| 尝试 | 为什么不行 |
|---|---|
| `npm i -g pnpm`（不指定版本） | 装 pnpm 12，无 openharmony 二进制 |
| `corepack enable pnpm` | corepack 不在 PATH；且默认取 12 |
| 把 pnpm 放进 `/data/service/hnp/bin` | 目录不可写 |
| 把 pnpm 放进 `/data/app/bin` | 目录不存在且 `/data/app` 是 root:root 0711 |
| 用 `PNPM_HOME` / `npm_config_prefix` 指路 | dsh CLI 不看这些，只认 PATH；且应用进程环境启动后无法改 |
| 直接从 GitHub 下载 linux-arm64 原生 pnpm 放进用户目录 | 用户数据分区禁止 exec ELF |
| `node --jitless` 跑 pnpm | JIT 之外仍需要代码区，实测同样 SIGSYS |

---

## 8. 待办 / 未闭环

1. **沙箱可见性对照**（决定 §7.1 是否可行）：DSH 侧已写入标记文件
   `/data/storage/el2/base/files/_dsh_marker.txt`，在终端执行：
   ```sh
   ls -l /data/storage/el2/base/files/_dsh_marker.txt
   toybox stat /data/storage/el2/base/files | head -4   # 对比 Device 66662d / Inode 678368
   ls -l /data/storage/el2/base/files | head -20        # 能否看到 dsh-dist、.dsh
   command -v pnpm; npm config get prefix
   ```
2. **市场一键安装的真实退出码**：在市场页点一次「一键安装组件」，再读
   `/data/storage/el2/base/files/.dsh/profiles/desktop/.dsh-market/log.ndjson`
   里有没有 `npm -g: exit=…` 那行，用于确认「主进程直接 spawn 的 node 子进程」是否同样被杀。
3. 清理排查残留：`/data/storage/el2/base/files/_dsh_marker.txt`、`_probe.js`。

---

## 9. 速查表

| 项目 | 值 |
|---|---|
| node | v24.13.0，`/data/service/hnp/bin/node` → `/data/service/hnp/node.org/node_v24.13.0` |
| npm 全局前缀（终端） | `/data/storage/el2/base/files/npm_global_modules` |
| pnpm 版本要求 | 必须 **11.x（或 10.x）**，不要 12.x |
| 终端 PATH 生效位置 | `~/.zshenv`（zsh） |
| dsh 找 pnpm 的方式 | `spawnSync("pnpm")`，只认 `process.env.PATH` |
| market 找 pnpm 的方式 | `toolSearchDirs()` + `process.env.PATH`，另有 corepack/npm 一键安装回退 |
| 应用域 node 子进程 | **一律 SIGSYS**（`Signal 31`） |
| 应用域可用运行时 | python3（含线程）；Electron 主进程自身（不能作为子进程复用） |
| 关键日志 | `.dsh/profiles/desktop/.dsh-market/log.ndjson` |

---

## 10. 参考

- [pnpm Installation](https://pnpm.io/installation)
- [pnpm#14679 — 无 Android 预编译二进制，Termux 安装失败](https://github.com/pnpm/pnpm/issues/14679)
- [pnpm#14431 — 让 android 复用 linux-musl 二进制](https://github.com/pnpm/pnpm/issues/14431)
- [pnpm CLI Distribution（DeepWiki）](https://deepwiki.com/pnpm/pnpm/3.7-cli-distribution)
- [dsh-ohos-patch（OHOS 移植补丁与实测文档）](https://github.com/shenjackyuanjie/dsh-ohos-patch)
- pnpm 包元数据：`https://registry.npmjs.org/pnpm/latest`、包内 `install.js` / `native-binary.mjs`

---

## 11. 深入分析：把 pnpm 纯 JS 打入包 + 让 dsh-market 进程内安装插件（2026-10-01）

> 本节回答三个问题：① 能否把 pnpm 纯 JS 版本打入包中；② 能否让 dsh-market 调用 pnpm 并顺利装插件；③ 若可行，插件落盘位置 / 清除 / 配置如何设计。
>
> 结论先行：**① 能；② 能，但必须走「进程内调用」而非 spawn（spawn 在鸿蒙平台级不可能）；③ 有明确落点，关键是用 `node-linker=hoisted` 规避 symlink/hardlink 禁令。**
>
> 本工程**已有一份完整设计**（`specs/011-runtime-provisioning/`，模块 011）：其中「路径 B（进程内 pnpm JS）」就是本节答案，其探测/选路/完整性校验代码（`src-main/market-runtime.js` 的 `discoverMarketRuntime()`）**已实现并通过 24 项单测**，唯独「进程内调用 pnpm」这一环被标为「暂缓 / 本版未投入」（`plan.md` §11）。因此这不是「能不能」的问题，而是「要投入多少、有哪些硬约束」的问题。本节把这些硬约束与落点一次性讲清，作为将来落地「路径 B」的决策依据。

### 11.1 问题一：pnpm 纯 JS 能否打入包中 —— 能

**版本选型（原 §3 已实测，此处补充「程序化 API」这一维）：**

| 版本 | 形态 | 能否进程内 import |
|---|---|---|
| `pnpm@12.x` | Rust 原生分发壳（`@pnpm/exe.*` 平台二进制） | ❌ 无 openharmony 产物 |
| `pnpm@11.x` | 纯 ESM（`bin/pnpm.mjs`，`type: module`，无 install 脚本、无平台 optionalDependencies），`engines: node >=22.13` | ✅ |
| `pnpm@10.x` | 纯 CJS（`bin/pnpm.cjs`），`engines: node >=18.12` | ✅ |

**关键更正（原排查文档未覆盖的版本陷阱）**：进程内调用 pnpm 用的「程序化 API 包」**不是 `@pnpm/core`**。实测 npm registry：`@pnpm/core` 在 pnpm **v11 起停止发布**（最后一个版本 `1016.1.12` 属 pnpm 10.16 线，2025-12 ~ 2026-03）。pnpm v11 把安装引擎拆分为 **`@pnpm/installing.deps-installer`**（npm 上已发布 `1102.x`/`1103.x` 线），内含进程内安装所需的：

- `install(manifest, opts)`
- `mutateModules(projects, opts)`
- `addDependenciesToPackage(manifest, selectors, opts)`
- `removeDependenciesFromPackage(manifest, selectors, opts)`

（函数名来自其 `lib/install/index.d.ts`；GitHub 源码路径 `installing/deps-installer/src/install/index.ts`。⚠️ 落地前须按最终选定的 pnpm@11.x 精确版本再次核对该包名与签名 —— 本项为 registry 检索结论，非设备实测，标 `未验证`。）

**本工程已有铺垫**：`src-main/market-runtime.js:53-57` 已预留物化位置常量：

```js
const BUNDLED_PNPM_PACKAGE = 'dsh-market-pnpm';
const BUNDLED_PNPM_ENTRY_REL = ['node_modules', BUNDLED_PNPM_PACKAGE, 'lib', 'index.mjs'];
```

即约定「把 pnpm 的 JS（含传递依赖）物化进 `dsh-dist/node_modules/dsh-market-pnpm/lib/index.mjs`」。`discoverMarketRuntime()` 的路径 B 探测（`:454-468`）只做「该入口是否随包就位」的存在性检查 —— 物化动作本身（`collect-dsh.mjs` 新增 `collectMarketPNPM()`，`plan.md` §4.2 / T2.6）**尚未写**。

**物化方式与一个待核实的风险**：pnpm v11 的 store 是「SQLite 后端的索引（store v11）」——需确认 `@pnpm/installing.deps-installer` 的依赖闭包里是否引入 `better-sqlite3` 等**原生模块**。若有，则需像本工程 `injectBetterSqlite3()` 那样注入 aarch64 成品（原生 `.node` 在主进程内 dlopen 是可行的，与「spawn 子进程 SIGSYS」不是一回事）；若走 WASM/纯 JS 则无需。此项 `未验证`，是物化阶段的第一优先级排查项。

### 11.2 问题二：dsh-market 能否进程内调用 pnpm —— 能，但 spawn 是死路

**先厘清真实的调用链（纠正原 §5.1 的 `spawnSync` 描述）**：当前 pin 的 `dsh-v0.2.0-rc.2` 里，`dsh plugin` 内部**不是裸 `spawnSync("pnpm")`，而是 `execa`**：

```
市场 UI → POST /dsh-market/install（同源，进程内）
  → dshmarket 的 runDshPlugin()           spawn "dsh plugin --profile desktop add|remove <target>"
      → dsh CLI runPluginCommand()
          → runProfilePnpm()               execa(options.command ?? 'pnpm', [...], { cwd: <profile dir> })   ← 真正的 pnpm 子进程
```

源码落点：`deepseek-harness/packages/boot/plugin-manager/src/operations.ts:357`（主安装）、`:177/:507/:597/:626`（`pnpm view` / 修复 / `config get registry`）。`probePnpm()` / `provisionPnpm()` 在 `dsh-market/src/dsh-cli.ts` 内另行 spawn `pnpm --version` / `corepack` / `npm`。**两层 spawn，任何一层 spawn 出的 node/pnpm 子进程在鸿蒙应用域都被 seccomp SIGSYS 杀掉**（原 §6 已实测），所以「把 pnpm 装到 PATH 上」这条路线彻底走不通，与 pnpm 装在哪无关。

**dsh-market 已内置三条可改造的接缝（源码级实测）：**

| 接缝 | 位置（`dsh-market/src/`） | 是否进程内 | 能否用于鸿蒙 |
|---|---|---|---|
| `setHostPackageManager({command,args,env})` | `dsh-cli.ts:781`，经 `profileContext.packageManager` 注入（`index.ts:109-124,255`） | ❌ 仍是 spawn 一个 command | 不够：只是换了可执行文件路径 |
| **`DesktopPnpmLike.runPlugin(args, invokingDir, signal)`** | `dsh-cli.ts:577-608`，经 `desktopProfiles` 服务特性检测（`index.ts:284-320`） | ✅ **真进程内**：宿主实现，返回句柄（stdout/stderr 流 + done + cancel） | **← 鸿蒙 wrapper 要实现的接缝** |
| 官方 Electron 路线（`config.profile='desktop'` → `pluginManager` 服务 → `installBundle`） | `official-desktop.ts:36-37`（注释明言「Never fall back to `dsh plugin --profile desktop`」） | ⚠️ 半进程内：`pluginManager` 内部**仍 spawn pnpm**（`operations.ts:357`） | 不够：spawn 仍在 |

**注意**：本工程 harmony profile 的 `cordis.patch.yml:70-74` 已对 dshmarket 注入 `config: { profile: desktop }`。因此若捆绑当前版本的 dshmarket，市场会走**第三条（官方 Electron）路线** → 命中 `pluginManager` → 其内部 `execa` spawn pnpm → 依旧 SIGSYS。**spawn 问题只是「搬了位置」，没有消失。** 要根治，必须让市场走**第二条（`desktopPnpm`）**：wrapper 在 Electron 主进程内实现 `runPlugin`，内部用 `@pnpm/installing.deps-installer` 的 `addDependenciesToPackage`/`removeDependenciesFromPackage`（或 `install`/`mutateModules`）**进程内**装/卸包，把结果映射回市场期望的 `InstallResult` 形状。这正是 `specs/011-runtime-provisioning/plan.md` §11.2 列出的补丁清单（`dshArgv()`/`spawnShim()`/`runDshPlugin()`/`probePnpm()`/`provisionPnpm()` 改为进程内分支）。

**进程内运行 pnpm 的硬约束（必须一并解决，否则跑不通）：**

1. **`ignore-scripts: true`（强制）** —— 禁用 lifecycle 脚本：① 否则 pnpm 会 spawn node 子进程跑脚本 → SIGSYS；② 否则等于在 Electron 主进程内执行插件作者的任意代码（社区 `dsh-ohos-patch` 已要求 `--ignore-scripts`）。代价：依赖 install/postinstall 的插件装不了（须在 UI/文档披露）。
2. **`process.exit` 拦截** —— pnpm JS 内部可能调 `process.exit`，进程内运行会**杀掉 Electron 主进程**。调用期间须把 `process.exit` 包装成抛异常。
3. **`process.argv` 保存/恢复** —— pnpm 期望独占 `process.argv`。
4. **symlink/hardlink 禁令（原 spec 与排查文档都没讲透的关键补充）** —— pnpm 默认 `node-linker=isolated` 会在 `node_modules/` 里建 symlink、在 `.pnpm` store 里建 hardlink；鸿蒙沙箱**两者都禁**（原 §2 的 B1/B2）。解法（pnpm 官方设置，已核实）：
   - `nodeLinker: hoisted` —— 生成**扁平 node_modules，无 symlink、无 `.pnpm` 虚拟 store**；
   - `packageImportMethod: copy` —— 从 store 拷贝文件而非 hardlink。
   **这恰好与本工程既有产物形态一致**：`collect-dsh.mjs` 物化出的 `dsh-dist` 就是「扁平、无 junction、无 .pnpm」的布局；而且 dsh 的 `initProfile` 写的 `pnpm-workspace.yaml` 本来就是 `nodeLinker: hoisted`（`deepseek-harness/packages/boot/app-boot/src/profile.ts:230-235`）——即 dsh 自己就不依赖 symlink 布局。
5. **配置位置** —— pnpm v11 起，**除 auth/registry 外的一切设置从 `.npmrc` 迁到 `pnpm-workspace.yaml`（camelCase）**（v11.0.0 起，见 release notes）。所以 `nodeLinker`/`packageImportMethod`/`storeDir`/`ignoreScripts` 都要写进 profile 的 `pnpm-workspace.yaml`，而不是 `.npmrc`。
6. **`git:` 源插件装不了** —— 设备无 `git`（原 §7.3 已确认），只能装 npm registry 包。

**好消息（大幅降低工作量）**：dsh 的「插件装载/发现」**完全不依赖 pnpm** —— 它只要求 `node_modules/<name>/package.json` 能被 `createRequire(...).resolve.paths()` 按 node_modules 向上走查到（`packages/boot/app-boot/src/profile.ts` 的 `packageDirFromAnchor`/`resolveBundleDir`），**扁平拷贝即可，symlink 非必需**（本工程 `ensureDshPluginsProfileLink()` 的「复制而非 symlink」已验证此点）。且 `dsh.profile.bundles` 的增删**全程可进程内调用**：`writeProfileBundles`/`reconcileProfilePlugins`（`app-boot/src/profile-plugins.ts`）、`selectBundle`（`plugin-manager/src/index.ts:715-735`）都是导出函数。**因此「装文件」这半程是唯一需要进程内 pnpm 的地方；「改 bundles + 热重载」这半程 wrapper 已经能进程内做。**

### 11.3 问题三：插件落盘 / 清除 / 配置

**落盘位置：**

| 对象 | 路径 | 说明 |
|---|---|---|
| 插件本体 | `$DSH_HOME/profiles/desktop/node_modules/<包名>/` | 扁平（hoisted）、无 `.pnpm`；由进程内 pnpm 写入 |
| pnpm store | `<userData>/.pnpm-store`（须显式 `storeDir` 指定） | **不能**用默认 `~/.pnpm-store`——`~` 须经 `ensureSandboxHome()` 指到 userData 才可写，默认路径会解析到沙箱外 |
| 锁文件 | `$DSH_HOME/profiles/desktop/pnpm-lock.yaml` | 锁版本 |
| 包管理器状态 | `$DSH_HOME/profiles/desktop/pnpm-workspace.yaml` | `nodeLinker`/`packageImportMethod`/`storeDir`/`ignoreScripts`/`allowBuilds`/registry mirror |

**清除：**

- 单个插件：`dsh plugin remove <pkg>` → 进程内 `removeDependenciesFromPackage` → reconcile 从 `dsh.profile.bundles` 剔除。市场侧已有 `removeAndReconcile`（`dsh-market/src/install.ts`）+ 宿主桥接链接清理 `removeDanglingHostBridge`（`install.ts:583`）。
- 残留 store 清理：`pnpm store prune`（进程内对应 store 管理 API；或直接删 `<userData>/.pnpm-store` 后全量重装）。
- 失败回滚：dsh 的 `runProfilePnpm` 已实现「快照 `package.json`+`pnpm-lock.yaml` → 失败还原 → 修复重装」（`operations.ts:303-321,504-517`）——**这部分逻辑与 spawn 无关，进程内改造时可直接沿用其语义**（用文件读写作快照，不需要 pnpm 子进程）。

**配置：**

| 文件 | 内容 | 维护者 |
|---|---|---|
| `package.json` | `dependencies` + `dsh.profile.bundles`（**有序 = 加载序**） | 进程内 `writeProfileBundles`/`reconcileProfilePlugins` |
| `cordis.patch.yml` | 插件 disable/enable 覆写（`- id: … disabled: true`） | 市场 hot toggle 已写此文件 |
| `compatibility.json` | 版本豁免（`setProfileVersionExemption`） | dsh |
| `pnpm-workspace.yaml` | `nodeLinker: hoisted`、`packageImportMethod: copy`、`storeDir`、`ignoreScripts: true`、`allowBuilds`、`registry: https://registry.npmmirror.com/`（国内镜像） | 进程内 pnpm |

### 11.4 与既有工程的关系 + 落地工作量清单

「路径 B」已完成的（`specs/011-runtime-provisioning` + `src-main/market-runtime.js`）：A/B/C 有序选路、ELF/JS 完整性校验、`dsh` shim 生成、PATH/PNPM_HOME 组装、失败可见性诊断 —— 均已实现并单测通过（`IMPLEMENTATION_NOTES.md` §5.2：24/24 通过）。

「路径 B」尚缺的（对应 `plan.md` §11 / T2.6 / T4.2 / T4.3）：

| 待办 | 位置 | 性质 |
|---|---|---|
| ① 物化 pnpm JS 到 `dsh-dist/node_modules/dsh-market-pnpm/` | `scripts/collect-dsh.mjs` 新增 `collectMarketPNPM()` | 构建期 |
| ② dsh-market 补丁：`runDshPlugin`/`probePnpm`/`provisionPnpm` 改为进程内分支 | `patches/dsh-market-v<ver>/dsh-market-in-process-pnpm.patch` + `build-dsh.mjs` 应用 | 补丁 |
| ③ wrapper 实现 `desktopProfiles` + `desktopPnpm.runPlugin`（进程内调 `@pnpm/installing.deps-installer`） | `src-main/`（新模块，可单测） | 运行期 |
| ④ 进程内 pnpm 配置 + `process.exit` 防护 + `argv` 保存/恢复 | 随 ③ | 运行期 |
| ⑤ 规避 dsh `pluginManager` 的 spawn：确保市场走 ② 的 `desktopPnpm` 分支而非官方 Electron 分支 | 随 ②/③ | 运行期 |

**风险与已知边界**（`plan.md` §15 R5/R6/R10 已列，此处汇总）：dsh-market 升级使补丁失配（按版本化 `patches/dsh-market-v<ver>/` 管理）；pnpm 调 `process.exit` 杀主进程（包装拦截）；`git:` 源插件与依赖 install 脚本的插件不可装（UI 披露）；`dsh-dist` 就地升级不重解压（沿用既有缺口，需全新安装生效）。

### 11.5 结论

- **唯一「证书-free 且自包含」、可支撑 AppGallery 上架承诺的路线就是「路径 B（进程内 pnpm JS）」**：路径 A（随包签名 Node ELF）需 AGC 二进制证书（个人开发者不可得，已撤回）；路径 C（复用设备 Node）是机会性兜底、不作承诺（且现设备 `node -e` 无输出、路径 C 大概率不通过）。
- 它与原 §6.4 的「应用域子进程 SIGSYS」结论**不冲突**：SIGSYS 只杀 **fork 出的子进程**，而 Electron 主进程自身就是 Node 22.17、能跑 JS —— 进程内跑 pnpm JS 完全绕开 seccomp 限制。
- 落地代价集中在「改 dsh-market 的 spawn 点 + 实现进程内 `runPlugin` + 让 pnpm 用 `node-linker=hoisted` 出扁平 node_modules」，且本工程探测/选路/校验/诊断的架子已搭好 —— 属于「已有设计、待补最后一环」，而非「另起炉灶」。
