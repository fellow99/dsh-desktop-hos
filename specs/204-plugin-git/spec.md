# git 插件（工程内专用）功能规格

> Module: 204-plugin-git
> Status: Specified
> Last Updated: 2026-10-16
> 设计来源：[docs/204-插件-GIT.md](../../docs/204-插件-GIT.md)（已评审通过的设计文档，唯一内容权威）

## 1. 模块概述

### 1.1 目的 —— 为什么存在这个模块

鸿蒙环境**没有 `git`**（toybox 不提供），`git` 全部命令不可用；本应用因此无法在设备上完成任何版本控制操作 —— 即使工作区里就有仓库。

本模块以 **dsh-desktop-hos 工程内专用插件**的身份（`plugins/harmony-plugin-git/`）把**纯 JS 的 git 实现 isomorphic-git** 嵌入应用，向模型提供一组 git 工具，并提供**凭据设置页**管理带账号仓库的用户名/密码。全部操作发生在设备侧，不依赖任何外部二进制、不需要二进制证书、不触碰父工程（父工程改动 = 0）。

本插件是 **dual-face 单包插件**（同 203 workspace-picker 的形状）：

- **host 面**（`lib/index.js`）：注册 21 个 git 工具（全局层，对 agent 可见）。
- **client 面**（`lib/client.js`）：声明 `dsh.client`，经 `client-modules` 扫描后注册 `settings.section`「Git 凭据」。
- **挂载采用 host 平面单行**（`profiles/desktop/cordis.patch.yml` 的 `- insert:` 一行）。这是对 `plugins/README.md §二.7`（preset 行）的**有意例外**，论证见 FR-2。

### 1.2 解决的问题

- **设备无 `git`**。只能装 npm registry 上的包，装不了 `git:` 源；git 能力必须由插件自带的纯 JS 实现提供。
- **`ctx.fs` seam 原语不足以承载 git**。该 seam 只有 `resolve` / `processPath` / `fileUrl` / `contains` / `stat` / `lstat` / `readText` / `streamText` / `readBytes` / `readByteRange` / `listDir` / `writeText` / `editText`（+ 本工程补丁补的 `remove` / `writeBytes` / `chmod`），**没有 `mkdir` / `rmdir` / `unlink` / `rename` / `symlink` / `readlink`**。故本模块在插件内以 `node:fs/promises` 提供 **仓库根 chroot 适配器**，而不是扩 seam（方案对比与否决见设计文档 §6.1）。
- **设置页 UI 只能由 host 平面承载**。`dsh.client` 客户端面只从 host Loader 的 entries 扫描，agent preset 的行扫不到；而 host 平面注册的工具对 agent 可见。因此必须选对装配平面（FR-2）。
- **isomorphic-git 的依赖不可省**。其发布物把 11 个依赖标为 external，故 `node_modules` 必须一并供给（FR-8）。
- **isomorphic-git 缺 `diff` / `show` / `revert` / `rebase`**。`diff` 由**宿主闭包**里的 jsdiff（`diff ^9.0.0`，插件不物化）生成 unified diff；`show` / `revert` 自建；`rebase` 明确不交付（FR-7、FR-9）。
- **凭据明文不得外泄**。明文不进对话、不进日志、不进 `cordis.yml`；凭据只经凭据库存放与读取（FR-5、FR-6）。
- **工作区外仓库必须先经用户审批**。围栏决策点是仓库根，越界即拒并复用既有提权审批链路（FR-4）。

### 1.3 范围

**包含**：

- 插件本体：`dsh-desktop-hos/plugins/harmony-plugin-git/` 下的 `package.json`、host 面 `lib/index.js`、`lib/{runtime,fence,fs-adapter,auth,diff,report}.js`、`lib/tools/*.js`（21 个工具，一文件一工具）、client 面 `lib/client.js`、`README.md` / `README_zh.md`。
- 构建期依赖物化：`scripts/collect-dsh.mjs` 新增 `collectGitRuntime()`（唯一新增构建步骤）。
- 插件物化与运行期镜像：沿用既有 `collectPlugins()` 通配物化与 `ensureDshPluginsProfileLink()` 镜像，**两者均不改**。
- 装配：`profiles/desktop/cordis.patch.yml` 的 `- insert:` 一行 `id: git` / `name: harmony-plugin-git`。
- 文档同步：`plugins/README.md`（§二.7 原位新增「需要 client 面的插件走 host 行」例外一节）、`README.md`（修正 inspector 的 `require` 用法）、`docs/工程规划.md`、`specs/README.md`。
- 本模块的 `spec.md` / `plan.md` / `tasks.md` / `test-cases.md`。

**不包含**：

- `rebase`（isomorphic-git 无此原语，自研等于重写提交重放引擎）、`blame`、`grep`（已有 `grep` 工具）、SSH 传输（isomorphic-git 无 SSH 客户端）。
- 任何 dsh 源码改动与补丁增删；`src-main/main.js` 不改（不动 preset 行，故本插件**不**写 `HARMONY_ENSURED_PRESET_ROWS`）。
- 父工程改动（**0**）；ArkTS 侧改动（零改动）。
- SHA-256 仓库（仅 SHA-1 仓库在范围内）。
- 二进制文件的**内容级** diff（只报 differ）。
- 「运行时弹窗索要凭据」的交互（客户端无 authorization 流程面；缺凭据时只给指引）。

## 2. 用户故事

- 作为用户，我希望在对话里直接让模型 clone 一个公开仓库并读懂它，不必先想办法装 git。
- 作为用户，我希望在设置里填一次带账号仓库的用户名/密码，之后模型执行 pull/push 不必知道密码。
- 作为用户，我希望模型**只在授权范围内**改动文件系统：工作区内自由操作，工作区外必须先经我审批。
- 作为用户，我希望任何失败都**如实说明原因**（缺凭据 / 认证失败 / 冲突 / 越界），而不是假装成功或静默重试。
- 作为用户，我希望知道哪些 git 操作**本平台做不到**（`rebase`），而不是让它悄悄用别的方式代替。

## 3. 功能需求

### FR-1 插件身份与命名

| 项 | 取值 |
|---|---|
| 插件目录 | `dsh-desktop-hos/plugins/harmony-plugin-git/` |
| npm `name` | `harmony-plugin-git` |
| 插件 `name` 导出 | `harmony-plugin-git` |
| profile 行 `id` | `git`（行 id 是稳定身份，不随包名或目录变化） |
| profile 行 `name` | `harmony-plugin-git`（运行时导入说明符） |

**FR-1.1** 目录名必须等于 npm 包名（在 `harmony-plugin-*` 通配下二者一致），`private: true`、`type: "module"`、纯 ESM 无构建步骤（`lib/` 即发布源码）。

**FR-1.2** `exports` 必须含 `"." → "./lib/index.js"` 与 `"./client" → "./lib/client.js"` 两项；包清单必须声明 `dsh.client { platform: "web", inject: [...] }`；dsh 依赖一律走 `peerDependencies`：`cordis`、`dsh-tools`、`dsh-fs`、`dsh-sandbox`、`dsh-credentials`、`schemastery`。

**FR-1.3** host 面必须提供**命名导出** `name` / `inject` / `Config` / `apply`，**不得**有 default export（default export 会让 Loader 丢弃 `inject`）。

**FR-1.4** 包名令牌必须一致：JSDoc `@module` 名与错误文案前缀同样算名字令牌，不得指向不存在的包名。

### FR-2 挂载平面

**FR-2.1** 插件**只**经 `profiles/desktop/cordis.patch.yml` 的 `- insert:` 一行挂载（host 平面），`id: git` / `name: harmony-plugin-git`；该行同时交付两个交付物：① 注册 21 个 git 工具（host 平面全局注册，对 agent 可见）；② 声明 `dsh.client`，被 `client-modules` 扫到后把设置页纳入启动图。

**FR-2.2（有意例外）** **不得**沿用 `HARMONY_ENSURED_PRESET_ROWS`（`plugins/README.md §二.7` 的常规做法）。把本插件挂到 preset 行会让它落在 **agent 平面**，其 `dsh.client` 声明**永远不会被扫描**，设置页交付物直接失效。该例外必须**原位**登记在 `plugins/README.md`（新增一节「需要 client 面的插件走 host 行」）与本模块规格中。

**FR-2.3** 不改 `src-main/main.js`、不改两处 `HARMONY_ENSURED_PRESET_ROWS`、不拆包；host 单行**不与**既有三行 preset 工具插件（fs-mutate / fs-search / exec）产生任何重复注册。

**FR-2.4（就绪性前提）** host 平面必需的五个服务 `tools` / `fs` / `sandboxPolicy` / `credentials` / `authorization` 均已在 base 或 web-app bundle 的 host 平面行中声明，且已实测五项全部在位（详见 plan.md §7 R2）；若上游升级改变该语义，本 FR 的装配前提需重新核对（plan.md §7 R9）。

### FR-3 工具面（21 个）

| # | 工具 | 职责 | isomorphic-git 原语 |
|---|---|---|---|
| 1 | `git_init` | 初始化仓库（默认分支可指定） | `init` |
| 2 | `git_clone` | 克隆（`ref` / `depth` / `noTags` / `singleBranch`），认证经 FR-5 | `clone` |
| 3 | `git_status` | 工作区状态，按 staged / modified / deleted / untracked / conflicted 分组渲染 | `statusMatrix`、`isIgnored` |
| 4 | `git_diff` | 统一 diff：`workdir↔index`、`index↔HEAD`、`workdir↔HEAD`、任意两 ref；支持 pathspec 过滤与 `stat` 模式 | `statusMatrix`、`readBlob`、`readTree`、`resolveRef`、`expandOid` + **jsdiff** |
| 5 | `git_log` | 提交历史（`depth` / `ref` / pathspec / `follow`） | `log`、`walk` |
| 6 | `git_show` | 展示某个 commit / tree / blob / tag 的内容与元信息 | `readCommit`、`readTree`、`readBlob`、`readTag` |
| 7 | `git_add` | 暂存路径；`remove` 语义的删除登记；取消暂存 | `add`、`remove`、`updateIndex`、`resetIndex`、`isIgnored` |
| 8 | `git_commit` | 提交（`message` / `author` / `amend` / 是否先暂存全部改动） | `commit`、`getConfig`、`resolveRef` |
| 9 | `git_branch` | 列出 / 新建 / 删除 / 重命名分支 | `listBranches`、`currentBranch`、`branch`、`deleteBranch`、`renameBranch` |
| 10 | `git_checkout` | 切换分支 / 检出 ref / 恢复指定路径（restore 语义） | `checkout`、`fastCheckout`、`resolveRef` |
| 11 | `git_reset` | `--soft` / `--mixed` / `--hard` 重置 | `resetIndex`、`writeRef`、`branch`、`checkout` |
| 12 | `git_merge` | 合并（`fastForward` / `no-ff` / `dryRun` / 中止合并） | `merge`、`abortMerge`、`findMergeBase`、`isDescendent`、`fastForward` |
| 13 | `git_cherry_pick` | 摘取指定提交 | `cherryPick`、`abortMerge` |
| 14 | `git_revert` | 反向提交（**自建**，见 FR-7.3） | `readCommit`、`readTree`、`readBlob`、`add`、`commit`（工作区文件写入经 fs 适配器） |
| 15 | `git_stash` | 压栈 / 出栈 / 应用 / 丢弃 / 列出 / 清空 | `stash`（op = push/pop/apply/drop/list/clear） |
| 16 | `git_tag` | 轻量 / 附注标签的列出、创建、删除 | `tag`、`annotatedTag`、`listTags`、`deleteTag` |
| 17 | `git_remote` | 远端列出 / 新增 / 删除；**服务端 refs 探测**（只读，不落地） | `listRemotes`、`addRemote`、`deleteRemote`、`getRemoteInfo2`、`listServerRefs` |
| 18 | `git_fetch` | 拉取对象与 refs（`depth` / `prune` / `tags`） | `fetch` |
| 19 | `git_pull` | 拉取并合并（`fastForwardOnly` 可约束） | `pull`、`fastForward` |
| 20 | `git_push` | 推送分支 / 标签；`force` / `delete` 显式开关 | `push` |
| 21 | `git_config` | 读写仓库本地与全局配置（`user.name` / `user.email` / `remote.*`） | `getConfig`、`getConfigAll`、`setConfig` |

**FR-3.1（一动词一工具）** 每个动作一个独立工具、一个独立文件（`lib/tools/*.js`），使「一个工具一组测试用例」的对应关系直接成立（工具粒度对比见设计文档 §6.2）。

**FR-3.2** **所有**工具必须经 `defineTool` 产出：`ctx.tools.register()` 会执行 `assertSupportedJsonSchema`，它不接受 `defineTool` 写法里的 `required: true` 简写，裸写 schema 会被拒并抛错；该抛错发生在 `apply()` 内时宿主**不记为 `__hostError`**，从 inspector 侧表现为「插件毫无痕迹、工具表为空」（易误判为装配失败）。

**FR-3.3（写类工具）** `git_init` / `git_clone` / `git_add` / `git_commit` / `git_checkout` / `git_reset` / `git_merge` / `git_cherry_pick` / `git_revert` / `git_stash` / `git_tag` / `git_remote` / `git_config` 的写分支额外暴露 FR-4.3 的 `sandbox_permissions` + `justification` 两个参数。

### FR-4 仓库根围栏与提权审批

围栏决策点是**仓库根**（安全属性，不是待修的 bug）：

**FR-4.1** 每个工具调用先 `ctx.fs.resolve(dir, { cwd: sessionCwd, signal })` → `ctx.fs.processPath(target)` 得到进程可见的**仓库根绝对路径**；这是后续全部路径的唯一来源。

**FR-4.2** 适配器内**每个路径** = `join(root, rel)` → `normalize` → **前缀包含校验**；越界（`..` 逃逸、绝对路径、软链指向根外）即拒，不落到 `node:fs`。

**FR-4.3** 仓库根落在会话工作区**之外**时不静默：抛 `FsError('FS_SANDBOX_DENIED')` + 复用 `@deepseek-ai/dsh-sandbox` 的 `sandboxDenialMarker` / `escalationHintMarker` / `ESCALATION_TARGETS` / `approveEscalation`，与 `harmony-plugin-fs-mutate/lib/sandbox.js` **完全同形** —— 写类工具暴露 `sandbox_permissions` + `justification`，模型据此申请**一次性**提权，经用户审批后该次操作在批准的 `workspaceRoot` 下执行。审批被拒时如实报「用户拒绝提权」。

**FR-4.4（D3 范围）** 仓库位置支持**会话工作区 + 用户目录**（Desktop / Documents / Download）；用户目录本就在 `DSH_EXTRA_WRITABLE_ROOTS` 内，批准后即可用；OS 授权是否已给由系统决定 —— **失败如实报错**，不重试、不换路径假装成功。

**FR-4.5（已知取舍，如实声明）** git 仓库**内部**的写入**不**逐次经过 `fs-sandbox.checkedTarget`，围栏收窄为「仓库根」单点。这与 `harmony-plugin-exec`（spawn shell 绕过 fs 围栏）同级，**且比它更严**（exec 完全无围栏）。

### FR-5 凭据

**FR-5.1（命名规则，固定、可手工填写）** git 凭据用**凭据 ref**存放：key 名 `GIT_CREDENTIAL_<HOST>`，其中 `<HOST>` = 目标 URL 的 `host[:port]` **大写化、非字母数字 → `_`**。

| 目标 URL | key 名 |
|---|---|
| `https://git.example.com/team/project.git` | `GIT_CREDENTIAL_GIT_EXAMPLE_COM` |
| `https://git.example.com:8443/team/project.git` | `GIT_CREDENTIAL_GIT_EXAMPLE_COM_8443` |
| `https://<内网主机>/team/project.git` | `GIT_CREDENTIAL_<内网主机规整名>` |

**FR-5.2（值格式）** 值为 `username:password`，按**第一个** `:` 切分（用户名中不含 `:`）。因此用户**既可以**在设置页填写，**也可以**直接编辑 `$DSH_HOME/.credentials.yaml` —— 两条路径落到同一处；命名规则在设置页就地展示。

**FR-5.3（运行期流程）** 需要认证时（服务端返回 401/404 且未带凭据）：从目标 URL 取 host → 规整为 key 名 → `ctx.credentials.resolve(ref)`。

- **命中** ⇒ `onAuth` 返回 `{ username, password }`；明文**仅在 host 进程内存中**流转。
- **未命中** ⇒ `onAuth` 返回 `{ cancel: true }`，工具报错：「该主机未配置凭据，请在设置 → Git 凭据 中添加，或写入 `$DSH_HOME/.credentials.yaml` 的 `<key 名>`」——**不把裸 401 抛给模型，不猜测、不匿名重试**。
- **`onAuthFailure`** ⇒ 认证被拒：报「凭据被拒绝」并**指明 key 名**，**最多重试 1 次**，绝不无限重试；`onAuthFailure` 可拒绝。

**FR-5.4（明文边界）** 工具参数里**没有**凭据字段；插件只经 `ctx.credentials` 读取。明文**进不了**对话、日志、`cordis.yml`。

**FR-5.5（无账号仓库）** 公开仓库从不触发 `onAuth`，零凭据可完成 clone / fetch / pull 与本地全部操作。

**FR-5.6（身份来源）** `user.name` / `user.email` **不是密钥，不进凭据库**：由 `git_config` 工具写仓库本地配置；`Config` 默认值为 `{ name: 'yourname', email: 'yourname@somehost' }`（**刻意使用明显的占位值，不使用任何真实个人信息**）。真机测试首步用 `git_config` 显式设置可辨识身份。

**FR-5.7（SSH 地址）** `git@host:path` / `ssh://` 地址由 isomorphic-git 改写为 `https://`（**丢弃用户名**），随后走同一路径；因此这类地址需配套的账号密码凭据（SSH 密钥不可交付）。

### FR-6 凭据设置页

**FR-6.1** client 面注册 `settings.section`（id `git-credentials`，标题「Git 凭据」），文案走**私有 locale 命名空间**；设置页只能存在于 host 平面的行上（FR-2.1 的第二个交付物）。

**FR-6.2** 页面能力：输入 host / 用户名 / 密码 → `ctx.remote.credentials.set(ref, "user:pass")`；`describe(refs)` 回显 `configured` / `source` / `writable`（**永不返回值**）；`unset(ref)` 删除。

**FR-6.3（无枚举能力，L6）** 凭据 API 只认 `credentialRef`、不暴露 ref 枚举，也无客户端可达的 authorization 命名空间；故设置页的 host 清单由 `localStorage` 记忆，且页面必须提示「直接编辑 `.credentials.yaml` 添加的 host 不会自动出现在页面上」。

**FR-6.4** `inject` 必须逐个对齐 `ui-settings-models` 的既有声明（`remote.credentials` 等），不得声明服务端设置面不提供的服务（否则启动期报错或页面空白）。

### FR-7 三个自建能力（isomorphic-git 缺口）

**FR-7.1 `show`** 读 `readCommit` / `readTree` / `readBlob` / `readTag` 拼装输出：提交元信息（作者、时间、parents、message）+ 变更清单 + 逐 blob 内容。**无需新依赖**。

**FR-7.2 `diff`** `statusMatrix` 给变动清单，`readBlob` 取两侧字节，**宿主闭包** jsdiff（`diff ^9.0.0`）的 `createTwoFilesPatch` 产出标准 unified diff。

- `stat` 模式：只汇总新增 / 删除 / 修改行数。
- `pathspec` 过滤：只对匹配路径取 blob。
- **二进制检测（fail-closed）**：含 NUL 字节即判二进制，输出 `Binary files a/… and b/… differ`，**不做文本 diff**（避免把二进制当文本吐给模型）。

**FR-7.3 `revert`（自建、fail-closed）**，因为 `cherryPick` **没有** `reversal`：

1. `readCommit({ oid })` 取目标提交；**恰好 1 个父提交**才继续，否则**明确拒绝**（不做合并提交的反向）。
2. 枚举父提交与目标提交之间的**变更路径**（两棵 tree 对比）。
3. 对每个变更路径：把**父提交**的内容物化到工作区（父无此路径 → 删除该路径）。
4. `add` 上述路径 → `commit`（消息模板 `Revert "<原提交标题>"`）。

**冲突语义（fail-closed）**：第 3 步前先比对工作区该路径的 blob oid 与目标提交是否一致。**不一致说明工作区已分叉 ⇒ 拒绝执行并明确报出冲突路径**，绝不静默覆盖用户改动。

### FR-8 依赖物化 `collectGitRuntime()`

**FR-8.1（形状）** `scripts/collect-dsh.mjs` 新增 `collectGitRuntime()`，形状照抄同文件的 `collectMarketPNPM()` 先例（收集期拉取 npm 包已有先例且证明可行）。

**FR-8.2（版本 pin）** 常量只 pin `ISOMORPHIC_GIT_VERSION = '1.44.2'`（对齐 `DSH_MARKET_VERSION = '1.66.7'` / `PNPM_VERSION` 先例）；**没有** jsdiff 的 pin 常量 —— jsdiff 复用宿主闭包，插件侧只以 `SUPPORTED_JSDIFF_MAJOR = 9` 守 major。

**FR-8.3（拉取）** 在临时 staging 里 `pnpm add isomorphic-git@1.44.2 --config.node-linker=hoisted --ignore-scripts`（命令里**不含** `diff`）。

**FR-8.4（嵌套落位，关键）** isomorphic-git 及其**整棵闭包**复制到**插件自己**的 `dsh-dist/node_modules/harmony-plugin-git/node_modules/`；`diff` **完全不物化**。落点在插件目录内部，依据是运行期镜像方式：`ensureDshPluginsProfileLink()` 每次启动把 `dsh-dist/node_modules/harmony-plugin-*` **整目录递归复制**（`cpSync`）到 `$DSH_HOME/profiles/node_modules/`，嵌套闭包随之一起过去，插件自身的裸 `import 'isomorphic-git'` 因此命中自己的嵌套层；若把闭包落在 dsh 顶层那一层（插件目录之外），那次复制反而带不上它 —— 复制源只取 `harmony-plugin-*` 目录。嵌套同时保证 Node 解析 isomorphic-git 的 `simple-get` / `readable-stream` / `buffer` 等时优先命中它自己的嵌套层，**绝不覆盖或冲突 dsh 自己的扁平依赖树**（顶层已有同名包时尤其重要）。

**FR-8.5（断言与幂等）** 断言：入口存在且非空、版本号与 pin 一致；失败一律**抛错**而不用 `process.exit(1)`（退出进程会跳过 `finally` 里的 staging 清理），终止进程由调用点 `try/catch` 统一负责；幂等（目标已有 `package.json` 即跳过快路径，**快路径同样要跑断言** —— 但正常构建每次先删 `distDir`，快路径在常规链路不可达，只能靠单独二次调用验证）。HTTP 客户端采用 `isomorphic-git/http/node`（`simple-get`，走 node `http` / `https`）。

**FR-8.6（体积）** 实测 `isomorphic-git@1.44.2` + `http/node` = 55 包 / 8.6 MB，这就是 `dsh-dist` 的**全部**增量；jsdiff **不物化** —— `diff` 由宿主闭包提供（dsh 自身 `dsh-tool-fs` / `dsh-workspace-changes` / `dsh-client-ui-trajectory` / `dsh-client-ui-primitives` 四个包声明 `diff ^9.0.0`，`app-boot` 的 profile resolution 把插件裸包名请求路由进宿主闭包，设备实测解析到 `dsh-dist/node_modules/diff@9.0.0`），故不存在第二份 diff、无 0.8 MB 增量，也无「本插件的 diff 覆盖 dsh 自身 diff」的冲突面；**不裁剪**（裁剪第三方包内容属额外维护面）。

### FR-9 错误与取消语义

| 场景 | 表现 |
|---|---|
| 目标目录不是仓库 | 明确报「不是 git 仓库」并给出 `git_init` / `git_clone` 建议，**不静默创建** |
| 缺凭据（服务端要认证） | 按 FR-5.3 指出该 host 对应的 key 名与设置入口 |
| 凭据被拒 | 报「凭据被拒绝」+ key 名，最多重试 1 次 |
| 合并 / 摘取冲突 | `abortOnConflict` 保持默认 `true`（不污染工作区），报冲突路径，提示可 `git_merge` 中止 |
| `revert` 工作区已分叉 | FR-7.3 fail-closed 拒绝并列出冲突路径 |
| 越出工作区 | `FS_SANDBOX_DENIED` + 提权提示；审批拒绝时如实报「用户拒绝提权」 |
| 用户目录 OS 未授权 | `EPERM` / `EACCES` **原样归因**，提示需系统设置授权并重启 |
| 网络不可达 / DNS 失败 | 报出主机名与底层错误，**不假装成功** |
| 远端拒绝推送（non-fast-forward） | 原样报服务端 `PushResult.error`，**不自动 force** |
| clone 体积 / 超时 | 报出已用时与建议（`depth` / `singleBranch`）；取消经 `signal` 透传 |
| 调用被取消 | 停止执行并交由注册表处理取消语义，**不当作失败报告** |
| `rebase` | 明确报「本平台不支持」，**不静默降级**（不得用 merge 冒充） |

### FR-10 插件配置 `Config`

**FR-10.1** `DEFAULT_` 前缀的常量与部署相关可调项必须来自插件 `Config`，**不得硬编码**在插件里（工程既有约定）。

**FR-10.2** `Config` 必须提供提交身份的默认值：`{ name: 'yourname', email: 'yourname@somehost' }` —— 刻意使用明显的**占位值**，不含真实个人信息（FR-5.6）。

**FR-10.3** 身份默认值只在「仓库本地配置未设置且未显式传 `author`」时生效；`git_config` 写入的仓库本地配置优先（身份来源链见 test-cases.md §4.1 的 AN-20 / AN-21）。

## 4. 目录约定

### 4.1 插件目录结构

```
plugins/harmony-plugin-git/                       ← 新专用插件（dual-face，单包）
├── package.json      name=harmony-plugin-git / private / type=module
│                     exports { ".": "./lib/index.js", "./client": "./lib/client.js" }
│                     dsh.client { platform: "web", inject: [...] }
│                     peerDeps: cordis, dsh-tools, dsh-fs, dsh-sandbox,
│                               dsh-credentials, schemastery, diff（^9.0.0，宿主闭包）
├── lib/
│   ├── index.js      host 面：命名导出 name / inject / Config / apply
│   ├── runtime.js    isomorphic-git（插件内嵌套闭包）与 jsdiff（宿主闭包）的动态 import + 版本断言
│   ├── fence.js      仓库根解析 + chroot 校验 + 提权（对齐 FsMutationSandbox）
│   ├── fs-adapter.js isomorphic-git 的 fs 适配器（node:fs/promises，chroot 内）
│   ├── auth.js       按 host 解析 ctx.credentials 凭据 → onAuth / onAuthFailure
│   ├── diff.js       宿主闭包 jsdiff 封装（unified diff / stat / 二进制检测）
│   ├── report.js     输出渲染（status 矩阵、提交摘要、冲突列表…）
│   └── tools/        21 个工具，一文件一工具
├── lib/client.js     client 面：注册 settings.section「Git 凭据」
└── README.md / README_zh.md
```

### 4.2 挂载与命名约定对照

| 维度 | `plugins/README.md §二.7` 常规（fs-mutate / fs-search / exec） | 本模块（204-plugin-git） |
|---|---|---|
| 挂载平面 | agent 平面（agent preset） | **host 平面**（`profiles/desktop/cordis.patch.yml` 的 `insert` 行） |
| 行清单落点 | `HARMONY_ENSURED_PRESET_ROWS`，`src-main/main.js` + `scripts/collect-dsh.mjs` **两处镜像** | profile patch 单处（`- insert:`），**两处 preset 表都不动** |
| 命名 | `harmony-plugin-XXX`，裸包名非 scoped | 同（`harmony-plugin-git`） |
| 目录名 = 包名 | 是 | 是 |
| `dsh.client` 可被扫描 | 否（agent 平面扫不到） | **是**（host Loader entries 才被 `client-modules` 扫描） |
| 工具对 agent 可见 | 是（scoped 层） | 是（全局层；未被 `restrict()` 时对 agent 可见） |
| 依赖供给 | 由宿主 `dsh-dist/node_modules` 提供 | 同上 + **`collectGitRuntime()` 只额外物化 isomorphic-git 闭包（嵌套在插件自己的 `node_modules/`）；`diff` 复用宿主闭包** |
| 例外登记 | — | **有意例外**，须在原位新增一节（FR-2.2） |

## 5. 验收标准

| 编号 | 验收标准 | 验证方式 |
|---|---|---|
| AC-1 | 应用可正常启动，插件树无 `boot: 1 entry did not activate`、无 duplicate tool 报错；`hilog \| grep dsh-harmony` 无异常 | 真机 + hilog |
| AC-2 | 21 个 git 工具在会话内可用（模型能列出并按名调用） | 对话调用 + `--inspect` 读 `ctx.tools` |
| AC-3 | 设置页出现「Git 凭据」区，可保存 / 查看状态 / 删除；保存后 `$DSH_HOME/.credentials.yaml` 出现对应 key | 真机 UI + `--inspect` 读文件 |
| AC-4 | 无账号仓库：clone / status / log / diff / show / add / commit / branch / checkout / fetch / pull / merge / stash / tag / reset / cherry-pick / revert / config 全部成功 | 对话逐项执行（§17.1，见 test-cases.md §4.1） |
| AC-5 | 带账号仓库：`listServerRefs` 探测 + clone + fetch + pull + commit + push（测试分支）+ tag + 删除远端分支 全部成功 | 对话逐项执行（§17.2，见 test-cases.md §4.2） |
| AC-6 | 工作区外 clone 被拒 → 模型带 `sandbox_permissions` + `justification` 重试 → 出现审批面板 → 同意后成功 | 真机操作 |
| AC-7 | 未配置凭据访问带账号仓库时，报错**指明 key 名与设置入口**，非裸 401 | 对话验证 |
| AC-8 | 凭据明文**不出现**在对话记录、`hilog`、`cordis.yml` 中 | 检索三处 |
| AC-9 | `rebase` 明确报「本平台不支持」，不静默降级 | 对话验证 |
| AC-10 | `revert` 在工作区分叉时 fail-closed 拒绝并列出冲突路径 | 构造分叉场景 |
| AC-11 | 构建期 `collectGitRuntime()` 物化成功；`dsh-dist/node_modules/harmony-plugin-git/node_modules/isomorphic-git/`（含整棵闭包）存在。幂等性须**单独二次调用**验证：正常构建每次先删 `distDir`，快路径在常规链路不可达 | 构建日志 + 一次单独二次调用 |
| AC-12 | 嵌套成立：isomorphic-git 的依赖不覆盖 dsh 顶层同名包；且本插件**根本不发 `diff`** —— 顶层 `dsh-dist/node_modules/diff` 必须仍是宿主的 `9.0.0`，插件的 `node_modules/` 内不出现 `diff` | 构建产物核对 |
| AC-13 | 工具面覆盖缺口已补齐：test-cases.md §4.1 的操作清单覆盖 FR-3 全部 **21 个工具**——相对 AC-4 枚举的 18 个，缺口由 AN-17（`git_push`）、AN-18（`git_init`）、AN-19（`git_remote`）补齐，「一工具一组用例」成立 | 文档对照（21 行工具表 ↔ 操作清单）+ 真机执行 AN-17 / AN-18 / AN-19 |
| AC-14 | `git_config` 身份链成立：`setConfig` 写**仓库本地** `user.name` / `user.email`，`getConfig` 回读一致，且随后 `git_commit` 的作者身份取自该配置（未设置时取 `Config` 默认占位值） | 真机 test-cases.md §4.1 的 AN-20 + AN-21（对话 + 读提交作者） |

## 6. 约束

- **零上游改动**（constitution §1.1）：不改 dsh 源码、不加补丁；仅新增本工程插件 + 收集脚本一步。
- **进程内 Host**（§1.2）：全部工作在主进程 Node 内；插件经既有 tools 注册表与既有 `remote.credentials` API 工作，**不新增 RPC 载体**（§1.4）。
- **只写装配代码**（§1.3）：工具 / 适配器 / 围栏是**插件自有业务逻辑**（同 fs-mutate 与 workspace-picker 的性质），不涉及壳装配改造。
- **沙箱边界**（§2.2，如实声明）：git 仓内部写入不经 `fs-sandbox.checkedTarget`；围栏收窄为「仓库根」单点，与 exec 同级且比它更严（FR-4.5）。
- **日志规范**（§3.3）：诊断走 `[dsh-harmony]` 前缀；**凭据明文绝不进日志**。
- **产物适配集中在收集脚本**（§5.3）：依赖物化全部在 `collect-dsh.mjs`。
- **幂等构建**（§5.1）：`collectGitRuntime()` 目标已有 `package.json` 即走快路径，但仍执行产物断言；**注意**正常构建每次先删 `distDir`，快路径在常规链路不可达，只能靠单独二次调用验证。
- **提交前缀**：提交一律用 Conventional Commits 前缀，不加 AI 署名。
- **已知限制**：
  - **L1 `rebase` 不支持**：工具明确报「本平台不支持」，不静默用 merge 冒充。
  - **L2 SSH 不可用**：只能 HTTPS 用户名 / 密码；`git@host:path` 与 `ssh://` 被改写为 `https://`（丢弃用户名）。
  - **L3 依赖体积**：`dsh-dist` 增加约 8.6 MB（**只有** isomorphic-git 闭包；jsdiff 复用宿主闭包，零增量）。
  - **L4 纯 JS 性能**：clone 大仓库明显慢于原生 git；用 `depth` / `singleBranch` / `noTags` 缓解，但不改变量级。
  - **L5 围栏粒度**：git 仓内部写入不经逐次 `fs-sandbox.checkedTarget`。
  - **L6 凭据页无法枚举**：host 清单由 `localStorage` 记忆，页面提示该限制。
  - **L7 无提示交互**：不交付「运行时弹窗索要凭据」；缺凭据时只给指引。
  - **L8 哈希算法**：仅 SHA-1 仓库；SHA-256 仓库不在范围。
  - **L9 二进制差异**：二进制文件只报 differ，不出内容级 diff。
- **`dsh-dist` 更新生效条件**：设备只有在**重新解压 `dsh-dist`** 后才会看到新的插件与依赖集合。`ensureDshExtracted()` 只比对解压 marker，不比对版本或内容 hash，**就地升级**因 marker 命中而**跳过重解压**。故**装机前必须清设备 `$DSH_HOME/dsh-dist`**，否则会继续跑旧产物（详见 plan.md §6）。
- **本机构建前置（实测）**：本机工具链路径与脚本默认值不同，HAP 构建必须显式传参 `-Hvigorw D:\oh-workspace\command-line-tools\bin\hvigorw.bat -DevEcoHome "D:\oh-workspace\DevEco Studio"`；`collect-runtime.mjs` 需 `DEVECO_SDK_HOME`（详见 plan.md §1.2）。
- **脱敏**：本模块全部文档**不得**写入具体仓库地址、账号名、口令、设备序列号、应用 bundle id；示例一律用 RFC 2606 保留域名（`git.example.com`）与占位符。

## 7. 术语

| 术语 | 含义 |
|---|---|
| **host 平面 / agent 平面** | 两条互不可见的装配路径：host 平面由 `profiles/desktop/cordis.patch.yml` 的行构成，agent 平面由会话创建时 cordis Include 组合出的 preset EntryTree 构成 |
| **有意例外** | 本模块不走 `HARMONY_ENSURED_PRESET_ROWS`、改挂 host 平面单行的做法；因为设置页的 `dsh.client` 只在 host Loader entries 上被扫描（FR-2.2） |
| **仓库根 chroot 适配器** | 插件内以 `node:fs/promises` 实现的 git fs 契约适配层：仓库根为唯一允许域，逐路径前缀校验，越界即拒（FR-4.1 / FR-4.2） |
| **仓库根围栏** | 围栏决策点是仓库根（单点），而非每次文件操作；git 仓内部写入不再逐次经 `fs-sandbox`（FR-4.5） |
| **依赖物化 / 嵌套落位** | 把 isomorphic-git 及其依赖闭包复制到**插件自己**的 `dsh-dist/node_modules/harmony-plugin-git/node_modules/`（而非 dsh 顶层）：让闭包随 `ensureDshPluginsProfileLink()` 的整目录复制一起进入 `$DSH_HOME/profiles/node_modules/`，且解析优先命中自带闭包、不干扰 dsh 的扁平依赖树（FR-8.4）。jsdiff 不在物化清单内 —— 复用宿主闭包 |
| **dual-face 插件** | 同一 npm 包同时提供 host 面（`./lib/index.js`）与 client 面（`./lib/client.js`）两个入口的插件 |
| **credentialRef** | 凭据库中的键名（POSIX 标识符）；客户端可达的凭据 API 只认 ref，不暴露 record，也不能枚举 |
| **提权审批（escalation）** | 越界写入被拒后，模型带 `sandbox_permissions` + `justification` 申请**一次性**更宽模式，经用户审批后该次调用在批准的根下执行 |
| **fail-closed** | 无法确证安全时选择拒绝：二进制不做文本 diff、`revert` 遇工作区分叉即拒、缺凭据即报指引而非匿名重试 |
| **unified diff** | `git_diff` 由 jsdiff 的 `createTwoFilesPatch` 产出的标准补丁文本格式 |
