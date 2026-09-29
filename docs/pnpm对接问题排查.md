# pnpm 对接问题排查记录

> 设备：HarmonyOS / OpenHarmony arm64（`process.platform === 'openharmony'`）
> 应用：DeepSeek Harness 桌面版（HAP 包名 `org.fellow99.dsh.DshDesktop`，主进程 PID 32805）
> 排查日期：2026-09-29
> 结论一句话：**在 DSH 签名包内无法使用 pnpm。** 直接原因是本应用域禁止子进程分配 JIT 可执行内存，任何 node 脚本（npm / corepack / pnpm）一启动就被内核以 `SIGSYS` 杀死；pnpm 装在哪、PATH 怎么配都改变不了这一点。

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
