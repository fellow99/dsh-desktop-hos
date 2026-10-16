# 204-plugin-git 测试用例

> Module: 204-plugin-git
> Status: Specified
> Last Updated: 2026-10-16
> 对应规格：[spec.md](./spec.md)
> 设计来源：[docs/204-插件-GIT.md](../../docs/204-插件-GIT.md)（§ 引用均指该文档的章节）
> 对应方案：[plan.md](./plan.md)

## 0. 测试环境与前置

| 项 | 值 |
|---|---|
| 目标设备 | `<设备 SN>`（序列号由需求方线下提供） |
| 系统 | HarmonyOS 6.1.0.135（API 24） |
| 应用 | 本应用（包名以本地签名配置为准，**不写入本文档**） |
| `hdc` | `<command-line-tools 根>/sdk/default/openharmony/toolchains/hdc.exe` |
| 构建前置 | `DEVECO_SDK_HOME=<command-line-tools 根>/sdk`（`collect-runtime.mjs` 必需）；`export MSYS_NO_PATHCONV=1` |
| HAP 构建显式传参 | `-Hvigorw D:\oh-workspace\command-line-tools\bin\hvigorw.bat -DevEcoHome "D:\oh-workspace\DevEco Studio"`（本机路径与脚本默认值不同，**不传即失败**） |
| 设备侧 `$DSH_HOME` | `<userData>/.dsh`（即 `/data/storage/el2/base/files/.dsh`） |
| 调试通道 | `hdc fport tcp:19229 tcp:9229` → CDP `Runtime.evaluate`（主进程 `--inspect`） |
| 关键坑 1 | `--inspect` 的全局作用域下 `require` **不可用**（Electron 37.2.0 / Node 22.17.0 实测）；脚本须用 `process.mainModule.require` |
| 关键坑 2 | inspector **触达不到 `ctx`**（无全局 host 句柄）；运行期自证由插件侧 `console.log`（落 hilog）承担 |
| 装机前置 | **必须清设备 `$DSH_HOME/dsh-dist`**：`ensureDshExtracted()` 只比对解压 marker，命中即跳过解压 → 否则继续跑旧产物 |
| 回归基线 | 既有 `dshmarket` 版本 pin `1.66.7`（`assertDshMarketVersion()`）仍须在 `collect-dsh` 阶段通过 |

> **本组用例的首要目的**：验证插件在**构建期**与**运行期**两个真实链路上都闭合，而不是只验证源码里的字符串写对了。原因：① `isomorphic-git` / jsdiff 是**构建期物化的依赖**，源里有 import 不代表产物里有包；② 本插件的工具是 **host 平面全局注册**，注册失败时宿主不记 `__hostError`，从 inspector 侧表现为「插件毫无痕迹、工具表为空」；③ 设置页是 client 面交付物，只有 host 平面挂载才能被扫描。

> **脱敏**：本文档不写入任何真实仓库地址、主机名 / 内网域名、账号名、口令、设备序列号与应用包名。示例一律用 RFC 2606 保留域名（`git.example.com`）与占位符。

---

## 1. 构建期用例

### TC-B1 —— 插件被自动物化，且**不**进入 preset 行

| 项 | 内容 |
|---|---|
| 目的 | 验证 `collectPlugins()` 通配物化本条插件（新增插件无需改收集脚本），并验证挂载平面是 host 行而非 preset 行（FR-2） |
| 前置 | 插件位于 `dsh-desktop-hos/plugins/harmony-plugin-git/`；`profiles/desktop/cordis.patch.yml` 已含 `insert` 行 |
| 步骤 | 1. `node scripts/collect-dsh.mjs`<br>2. 检查 `dsh-dist/node_modules/harmony-plugin-git/package.json` 是否存在，并读其 `name`<br>3. `grep -rn "harmony-plugin-git" src-main/main.js scripts/collect-dsh.mjs`（预期**零命中**）<br>4. `grep -rn "harmony-plugin-git" dsh-dist/profiles/desktop/`（预期命中 `insert` 行） |
| 期望 | 步骤 2 文件存在且 `name == "harmony-plugin-git"`；步骤 3 **无命中**（本插件不进 `HARMONY_ENSURED_PRESET_ROWS`）；步骤 4 命中 profile 行 |
| 证据 | 文件路径 + `name` 字段 + 两处 grep 输出 |
| 失败含义 | 步骤 2 失败 ⇒ 源根 / 通配改错或收集静默无操作；步骤 3 有命中 ⇒ 被误挂 preset 平面，设置页**永远不会出现**（`dsh.client` 扫不到） |

### TC-B2 —— `collectGitRuntime()` 嵌套落位、版本断言与幂等

| 项 | 内容 |
|---|---|
| 目的 | 落实 AC-11：依赖物化成功、落位正确、版本与 pin 一致、重复执行走快路径仍断言 |
| 步骤 | 1. `node scripts/collect-dsh.mjs`（首次）<br>2. 断言存在：`dsh-dist/node_modules/isomorphic-git/package.json`、`dsh-dist/node_modules/isomorphic-git/node_modules/`（非空目录）、`dsh-dist/node_modules/diff/package.json`<br>3. 读三处 `version`：`isomorphic-git` == `1.44.2`、`diff` == `8.0.2`；断言 `isomorphic-git/http/node` 入口文件非空<br>4. 再跑一次 `node scripts/collect-dsh.mjs`，观察快路径日志仍执行版本断言 |
| 期望 | 步骤 2 三项全部存在；步骤 3 版本与 pin 一致、入口非空；步骤 4 幂等（不重复拉取）且断言仍跑；闭包规模约 55 包 / 8.6 MB |
| 证据 | 目录清单 + 三个 `version` 字段 + 两次运行日志 |
| 失败含义 | 落位错 ⇒ `lib/runtime.js` 的动态 import 在设备上解析失败；版本不符未被拦 ⇒ 版本漂移会静默进入产物（R6） |
| 备注 | 刻意把版本断言放在**快路径**同样执行：若只在首次物化时断言，改 pin 后重跑不会暴露不一致（既有 `assertPnpmEngineArtifact()` 亦如此） |

### TC-B3 —— isomorphic-git 依赖闭包**不覆盖** dsh 顶层同名包（嵌套成立）

| 项 | 内容 |
|---|---|
| 目的 | 落实 AC-12：嵌套落位的关键——isomorphic-git 的依赖绝不覆盖或冲突 dsh 自己的扁平依赖树 |
| 步骤 | 1. 物化前记录顶层 `dsh-dist/node_modules/<pkg>/package.json` 的 `version`（对以下实际存在的同名包逐个记录：`buffer@5.7.1`、`readable-stream@2.3.8`、`pako@0.2.9`、`simple-get@4.0.1`、`ignore@5.3.2`）<br>2. 跑 `node scripts/collect-dsh.mjs`<br>3. 逐个复读顶层同名包的 `version` 与 `collect` 前比对<br>4. 断言 isomorphic-git 的 11 个 external 依赖（`async-lock` / `clean-git-ref` / `crc-32` / `diff3` / `ignore` / `minimisted` / `pako` / `pify` / `readable-stream` / `sha.js` / `simple-get`）都存在于 `dsh-dist/node_modules/isomorphic-git/node_modules/` 下 |
| 期望 | 步骤 3 顶层版本**逐一致**（未被覆盖）；步骤 4 嵌套层齐备 |
| 证据 | 顶层版本比对表 + 嵌套层目录清单 |
| 失败含义 | 嵌套失效 ⇒ 覆盖 dsh 自身依赖，可能连带破坏 `dsh-tool-fs` / `dsh-client-ui-*` 等既有功能（症状与 git 无关，极难定位） |
| 观察项 | dsh 自身已有顶层 `diff@9.0.0` 依赖（`dsh-tool-fs`、`dsh-workspace-changes`、`dsh-client-ui-trajectory`、`dsh-client-ui-primitives` 声明 `"diff": "^9.0.0"`），而本模块的 jsdiff pin 为 `8.0.2` 且设计上落**顶层** `node_modules/diff`。本用例的步骤 3 因此**同时**覆盖 `diff`：物化后顶层 `dsh-dist/node_modules/diff/package.json` 的版本必须与物化前一致（`9.0.0`）。若出现不一致，即为「jsdiff 覆盖了 dsh 自身的 `diff`」这一冲突态的**直接证据**，不得视为通过 |

### TC-B4 —— profile host 行随包（产物内与设备侧均生效）

| 项 | 内容 |
|---|---|
| 目的 | 验证 host 行的**装配链**完整：`profiles/desktop` → `dsh-dist/profiles/desktop` → 设备 `$DSH_HOME/profiles/desktop` |
| 步骤 | 1. `collect-dsh` 后 `grep -n -A2 "insert" dsh-dist/profiles/desktop/cordis.patch.yml`，核对 `- id: git` / `name: harmony-plugin-git`<br>2. 清设备 `$DSH_HOME/dsh-dist` 后重启应用，读设备 `$DSH_HOME/profiles/desktop/cordis.patch.yml`（经 CDP 读文件），核对同一行存在且为最新版<br>3. 核对设备 `$DSH_HOME/profiles/node_modules/harmony-plugin-git/package.json` 存在（`ensureDshPluginsProfileLink()` 镜像结果）<br>4. `hilog \| grep dsh-harmony` 应含「已复制 harmony-plugin-git → profiles/node_modules」 |
| 期望 | 三处均命中；行 `id: git`、`name: harmony-plugin-git`；镜像目录存在 |
| 证据 | 两处文件片段 + 目录存在性 + hilog 片段 |
| 失败含义 | 步骤 1 失败 ⇒ 行未随包；步骤 3 失败 ⇒ 运行期解析不到裸包名（行激活失败，工具与设置页全部缺失） |
| 备注 | 设备侧 profile 种子文件每次启动用最新版覆盖，故**不清 `dsh-dist`** 时 `cordis.patch.yml` 可能已是新版，但插件副本与依赖仍是旧 tar 的 —— 这正是 TC-B6 存在的理由 |

### TC-B5 —— HAP 构建与签名断言通过

| 项 | 内容 |
|---|---|
| 目的 | 确认改动不破坏打包链路，且签名材料在本机可用 |
| 前置 | `DEVECO_SDK_HOME` 已设；已跑过 `scripts/collect-runtime.mjs`；tar 已重打 |
| 步骤 | `powershell -ExecutionPolicy Bypass -File "scripts/build-debug.ps1" -Hvigorw D:\oh-workspace\command-line-tools\bin\hvigorw.bat -DevEcoHome "D:\oh-workspace\DevEco Studio"` |
| 期望 | 退出码 0；`BUILD SUCCESSFUL`；产物 `electron/build/default/outputs/default/electron-default-signed.hap` 生成；`build-debug.ps1` 内置的签名断言（profile type == 请求的 SignMode）通过 |
| 证据 | 构建尾部输出 + 产物大小（基线参考：签名 HAP 492.4 MB） |
| 失败含义 | 签名材料缺失或 `-Hvigorw` / `-DevEcoHome` 未显式传参（本机路径 ≠ 脚本默认值） |

### TC-B6 —— 装机前置：清设备 `$DSH_HOME/dsh-dist`

| 项 | 内容 |
|---|---|
| 目的 | 消除「命令成功但跑的是旧产物」这一无诊断信息的失败态（解压 marker 命中即跳过） |
| 步骤 | 1. 记录清空前的 `$DSH_HOME/dsh-dist/node_modules/` 是否含 `harmony-plugin-git` 与 `isomorphic-git`<br>2. 删除设备 `$DSH_HOME/dsh-dist`（整个目录）<br>3. `hdc app install -r <签名 HAP>`，启动应用<br>4. 复核 `$DSH_HOME/dsh-dist/node_modules/isomorphic-git/node_modules/` 已按新 tar 落位 |
| 期望 | 步骤 4 新产物就位；`hilog` 出现解压与复制日志 |
| 证据 | 清空前 / 后目录清单 + 安装与启动日志 |
| 失败含义 | 不清 `dsh-dist` ⇒ 设备继续用旧插件副本与旧依赖运行，本模块的**全部**验收结论都不可信 |
| 备注 | 这是本模块构建—装机流程的**固定一步**（tasks.md T22），不是可选优化 |

---

## 2. 真机用例（`--inspect` / UI / 对话）

### TC-D1 —— 启动无 boot 失败

| 项 | 内容 |
|---|---|
| 目的 | 落实 AC-1：插件树完整激活，无重复注册 |
| 前置 | TC-B6 已完成（`$DSH_HOME/dsh-dist` 已清并重解压）；应用已重启 |
| 步骤 | 1. `hdc shell "hilog -x \| grep -i dsh-harmony \| tail -60"`<br>2. 检索 `boot: 1 entry did not activate`（预期零命中）<br>3. 检索 duplicate tool / 重复注册类报错（预期零命中）<br>4. 检索 `[dsh-harmony]` 的启动行（预期含插件自报的工具计数） |
| 期望 | 无 boot 失败、无重复注册；插件自报 21 个工具注册完成 |
| 证据 | hilog 片段 |
| 失败含义 | 注册失败 ⇒ 宿主**不记** `__hostError`：从 inspector 侧只表现为「插件毫无痕迹、工具表为空」，本用例是区分「装配失败」与「假阴性」的唯一入口 |

### TC-D2 —— 21 个 git 工具在会话内可用

| 项 | 内容 |
|---|---|
| 目的 | 落实 AC-2：host 平面全局注册的工具对 agent 可见、可按名调用 |
| 前置 | TC-D1 通过 |
| 步骤 | 1. `hdc fport tcp:19229 tcp:9229`；CDP `Runtime.evaluate`（脚本用 `process.mainModule.require`）读主进程内可直达的工具视图，核对 21 个 `git_*` 工具名齐备<br>2. 在会话中要求模型**列出**它可用的全部 git 工具，随后**按名调用**其中一个无副作用工具（建议 `git_status`，目标为一个已克隆的工作区仓库）<br>3. 核对工具返回结构（非「工具不存在」类错误） |
| 期望 | 工具表含 21 个（`git_init` / `clone` / `status` / `diff` / `log` / `show` / `add` / `commit` / `branch` / `checkout` / `reset` / `merge` / `cherry_pick` / `revert` / `stash` / `tag` / `remote` / `fetch` / `pull` / `push` / `config`）；模型可按名调用并得到真实结果 |
| 证据 | 工具名清单 + 对话片段 |
| 失败含义 | 工具数 ≠ 21 ⇒ 某个工具的 schema 未经 `defineTool` 被拒（抛在 `apply()` 内时表现为整棵树「无痕迹」） |
| 备注 | R2 已实测「host 平面注册的工具可被 agent 看见并调用」；PoC 期经临时全局句柄读取，**正式实现删除该句柄**，故本用例的运行期自证由 `[dsh-harmony]` 日志 + 对话复核承担 |

### TC-D3 —— 设置页读写凭据

| 项 | 内容 |
|---|---|
| 目的 | 落实 AC-3：client 面被扫描、页面可用、凭据落到唯一存放处 |
| 前置 | TC-D1 通过 |
| 前置 | TC-D3 与 TC-D7 已产生带凭据的 git 操作（clone / fetch / pull / push） |
| 期望 | 5 步全部符合；页面**从不**显示口令明文 |
| 证据 | UI 截图 / 文本 + `.credentials.yaml` 片段（**值需打码后引用**）+ `describe` 输出 |
| 失败含义 | 页面缺失 ⇒ `dsh.client` 未被扫描（挂载平面错）或 `inject` 与服务端设置面不匹配（R7）；保存后 key 不出现 ⇒ 采用 `credentialRef` 的命名规则不一致（FR-5.1） |

### TC-D4 —— 仓库根围栏 + 提权审批

| 项 | 内容 |
|---|---|
| 目的 | 落实 AC-6：工作区外仓库根被拒 → 模型按共享 marker 申请一次性提权 → 用户审批后成功 |
| 前置 | TC-D2 通过 |
| 步骤 | 1. 让模型 clone 一个公开仓库到**会话工作区之外**的用户目录（如 `<userData>/Documents/…`）<br>2. 观察第一次调用被拒：错误含 `FS_SANDBOX_DENIED` 与提权提示标记<br>3. 模型带 `sandbox_permissions` + `justification` 重试 → 出现审批面板 → **同意** → 操作成功<br>4. 重跑同类调用并**拒绝**审批：确认如实报「用户拒绝提权」，不重试、不换路径 |
| 期望 | 拒绝发生在审批之前；同意后该次调用在批准的根下完成；拒绝被如实报告 |
| 证据 | 两次对话片段 + 审批面板截图 + 目标目录清单 |
| 失败含义 | 未拒绝即写入 ⇒ 围栏未生效；审批拒绝后仍写入 ⇒ 提权语义被绕过 |
| 观察项 | 用户目录 OS 授权由系统决定（`DSH_EXTRA_WRITABLE_ROOTS` 已含四主目录，但首次可能需要系统设置授权并重启）；未授权时应报 `EPERM` / `EACCES` 原样归因，**不得**报成「用户拒绝提权」 |

### TC-D5 —— 凭据明文不泄漏（三处检索）

| 项 | 内容 |
|---|---|
| 目的 | 落实 AC-8：明文不进对话、不进日志、不进 config |
| 前置 | TC-D3 与 TC-D6 已产生带凭据的 git 操作（clone / fetch / pull / push） |
| 步骤 | 1. 取本轮使用的口令（线下持有，**不写入本文档**），在**对话记录**全文检索（含工具参数与工具返回）<br>2. 在 `hilog` 全量（`hdc shell hilog -x`）中检索同一口令<br>3. 检索设备 `$DSH_HOME/cordis.yml` 与 `$DSH_HOME/profiles/desktop/cordis.patch.yml`<br>4. 反向核对：三处**允许**出现 key **名**（`GIT_CREDENTIAL_…`），但**不得**出现口令与「用户名:口令」组合 |
| 期望 | 三处检索口令命中数均为 **0**；失败文案里只出现 key 名 |
| 证据 | 三次检索的命令与命中数（0 / 0 / 0） |
| 失败含义 | 任一处命中 ⇒ 凭据边界失守（FR-5.4），属最高优先级缺陷 |

### TC-D6 —— 无账号（公开）仓库整链

| 项 | 内容 |
|---|---|
| 目的 | 落实 AC-4：公开仓库上 18 项操作 + 补齐的 `git_init` / `git_remote` / `git_push` 分支全部可用 |
| 前置 | TC-D2 通过；工作区内已有可写目录 |
| 步骤 | 按 §4.1 的 **AN-1…AN-21** 逐项执行（每项一行对话或一次按名调用），逐项记录工具返回 |
| 期望 | AN-1…AN-16、AN-18…AN-21 成功；**AN-17 预期失败**且失败文案符合 §13 分支（未配置凭据 + key 名） |
| 证据 | 21 项逐项记录（工具名 + 参数摘要 + 返回摘要） |
| 失败含义 | 单项失败即定位到该工具的工具面或原语问题（一工具一组用例） |

### TC-D7 —— 带账号（内网）仓库整链

| 项 | 内容 |
|---|---|
| 目的 | 落实 AC-5：认证经凭据库、读写两节全部可用 |
| 前置 | TC-D3 已保存该 host 的凭据（key 名按 §9.1 规则）；凭据值由需求方线下提供 |
| 步骤 | 按 §4.2 顺序执行：只读 **AR-1…AR-6**，再写入 **AW-1…AW-6**。**执行 AW-5 前当轮点名该操作并给出回滚方式** |
| 期望 | AR-1…AR-6 全部成功（无副作用）；AW-1…AW-6 按序成功；AW-5 造成的默认分支副作用已当场声明 |
| 证据 | 12 项逐项记录 + 远端分支 / 标签清单（操作前后各一次） |
| 失败含义 | AR-1 失败 ⇒ 连通或认证问题（401/404）；AW-3 / AW-4 / AW-5 失败 ⇒ 写入路径或凭据权限不足 |

### TC-D8 —— 缺凭据报错**指明 key 名与设置入口**

| 项 | 内容 |
|---|---|
| 目的 | 落实 AC-7：不把裸 401 抛给模型 |
| 前置 | 删除该内网 host 的凭据（或使用未配置凭据的 host） |
| 步骤 | 1. 对带账号仓库执行一次只读操作（如 `git_remote` 的 `listServerRefs`）<br>2. 读工具返回文本 |
| 期望 | 文案含：该主机未配置凭据 + 规整后的 key 名（`GIT_CREDENTIAL_<内网主机规整名>`）+ 设置入口（设置 → Git 凭据 或写入 `$DSH_HOME/.credentials.yaml`）；**不含**裸 401；不匿名重试 |
| 证据 | 工具返回原文 |
| 失败含义 | 只回裸 401 ⇒ 模型无法自救（FR-5.3 分支缺失） |

### TC-D9 —— 凭据被拒绝时最多重试 1 次

| 项 | 内容 |
|---|---|
| 目的 | 验证 `onAuthFailure` 语义与重试上限 |
| 前置 | 该 host 的凭据为**错误**口令 |
| 步骤 | 1. 执行一次需要认证的操作<br>2. 计数认证尝试次数（服务端侧或插件日志侧）<br>3. 读错误文案 |
| 期望 | 报「凭据被拒绝」并指明 key 名；尝试次数 ≤ 2（首次 + 最多 1 次重试）；**绝不**无限重试 |
| 证据 | 尝试次数 + 错误文案 |
| 失败含义 | 无限重试会打满服务端失败计数甚至触发封禁 |

### TC-D10 —— `rebase` 明确不支持

| 项 | 内容 |
|---|---|
| 目的 | 落实 AC-9 / L1：缺口如实声明，不静默降级 |
| 步骤 | 1. 在会话中要求模型「rebase 当前分支到某上游」<br>2. 读模型与工具的行为 |
| 期望 | 明确被告知「本平台不支持 `rebase`」（工具面不存在该工具，且模型能给出该结论），**不得**用 `git_merge` 冒充完成 |
| 证据 | 对话片段 |
| 失败含义 | 静默用别的方式代替 ⇒ 用户对结果产生错误认知（用户故事明确反对） |

### TC-D11 —— `revert` 在工作区分叉时 fail-closed

| 项 | 内容 |
|---|---|
| 目的 | 落实 AC-10：绝不静默覆盖用户改动 |
| 前置 | 工作区内已有一个仓库（TC-D6 的克隆仓库） |
| 步骤 | 1. 制造一个提交 A，随后**手动改动** A 触及的同一路径（不提交），使工作区该路径 blob 与 A 不一致<br>2. 要求模型 `git_revert` A<br>3. 读返回，并复核该路径内容**未变**<br>4. 对照：在干净工作区对同一提交执行 `git_revert`，应成功生成 `Revert "<原提交标题>"` 提交<br>5. 另取一个**合并提交**执行 `git_revert`，应明确拒绝（父提交不是恰好 1 个） |
| 期望 | 分叉场景拒绝并**列出冲突路径**，工作区未被改写；干净场景成功；合并提交被拒 |
| 证据 | 冲突路径清单 + 该路径内容前后哈希 + 成功场景的提交摘要 |
| 失败含义 | 覆盖了用户改动 ⇒ fail-closed 契约失守（本用例要拦的主要回归） |

### TC-D12 —— 错误与取消语义抽样

| 项 | 内容 |
|---|---|
| 目的 | 抽样验证 §13 分支的「如实归因」性质 |
| 步骤 | 1. 对一个**非仓库**目录执行 `git_status` → 应报「不是 git 仓库」并建议 `git_init` / `git_clone`，**不静默创建**<br>2. 对一个不可达的主机执行只读操作 → 应报主机名与底层错误，不假装成功<br>3. 对远端落后于本地的分支执行 `git_push`（不显式 force）→ 应原样报服务端 `PushResult.error`，**不自动 force**<br>4. 对一个大仓库发起 clone 后**取消**该调用 → 应停止执行并由注册表处理取消语义，**不当作失败报告** |
| 期望 | 四项均如实；第 3 项绝不自作主张强推 |
| 证据 | 四次返回原文 |
| 失败含义 | 静默成功或自动强推 ⇒ 破坏用户对远端状态的信任 |

### TC-D13 —— 工具面覆盖缺口已补齐

| 项 | 内容 |
|---|---|
| 目的 | 落实 AC-13：§17 操作清单覆盖全部 **21** 个工具，「一工具一组用例」成立 |
| 步骤 | 1. 文档对照：把 spec FR-3 的 21 行工具表与 §4.1 的 AN-1…AN-21 逐条映射（一个工具至少一条操作）<br>2. 真机复核三条补齐项：AN-17（`git_push` 无凭据预期失败）、AN-18（`git_init` 空目录初始化）、AN-19（`git_remote` 增删）<br>3. 真机复核 AN-20 / AN-21（见 TC-D14） |
| 期望 | 21 个工具全部有对应用例；相对 AC-4 枚举的 18 个，缺口（`git_init` / `git_remote` / `git_push`）无遗漏 |
| 证据 | 映射表（21 行）+ 三项真机记录 |
| 失败含义 | 存在无用例覆盖的工具 ⇒ 该工具的回归无门 |

### TC-D14 —— `git_config` 身份链

| 项 | 内容 |
|---|---|
| 目的 | 落实 AC-14：身份来源链「`git_config` 仓库本地配置 → `git_commit` 作者」成立 |
| 步骤 | 1. 在 TC-D13 的 AN-18 新仓库里执行 `git_config`（`setConfig`）写入 `user.name` / `user.email`（用**可辨识的占位值**，如 `yourname` / `yourname@somehost`）<br>2. `getConfig` 回读两个键，与写入值比对<br>3. 执行 AN-21：`git_add` + `git_commit` 首次提交<br>4. 读该提交的作者（`git_log` 或 `git_show`），与第 1 步设置值比对<br>5. 反向对照：在另一个**未**执行 `git_config` 的仓库提交，作者应取 `Config` 默认占位值 |
| 期望 | 回读一致；提交作者 == 配置值；未配置时作者 == `Config` 默认占位值（`{ name: 'yourname', email: 'yourname@somehost' }`） |
| 证据 | `getConfig` 输出 + 提交作者字段（两处） |
| 失败含义 | 作者取自别处（如全局配置或硬编码）⇒ 身份链断裂；真机测试首步就应执行本用例以固定可辨识身份 |
| 备注 | `user.name` / `user.email` **不是密钥、不进凭据库**；本文档只用占位值，不使用任何真实个人信息 |

---

## 3. 回归用例

### TC-R1 —— fs-mutate 插件未退化

| 项 | 内容 |
|---|---|
| 目的 | 既有 agent 平面插件不受新增 host 平面插件影响（AC-1） |
| 步骤 | 在工作区创建探针文件，要求模型用 `delete` 删除、用 `copy` 复制、用 `move` 搬移、用 `chmod` 改权限 |
| 期望 | 四个工具均可用且结果正确；工作区内操作不触发审批 |
| 证据 | 对话片段 + 文件系统复核 |

### TC-R2 —— fs-search 插件未退化

| 项 | 内容 |
|---|---|
| 目的 | 既有工具面不受影响（AC-1） |
| 步骤 | 要求模型用 `grep` 检索工作区关键字、用 `glob` 列出匹配文件 |
| 期望 | 两个工具均返回预期结果 |
| 证据 | 对话片段 |

### TC-R3 —— exec 插件未退化

| 项 | 内容 |
|---|---|
| 目的 | 既有 `bash` 工具链未被牵连（AC-1） |
| 步骤 | 要求模型用 `bash` 执行一条无副作用的命令（如打印工作目录） |
| 期望 | 正常返回；无与 git / git 插件的交互异常 |
| 证据 | 对话片段 |

### TC-R4 —— workspace-picker 插件未退化

| 项 | 内容 |
|---|---|
| 目的 | 同为 host 平面 insert 行的邻居行未被牵连（AC-1） |
| 步骤 | 打开「选择工作区目录」对话框，切换四个主目录（沙箱 / 桌面 / 文档 / 下载），列一层目录 |
| 期望 | 四 Tab 正常、列目录正常；无回归 |
| 证据 | UI 走查记录 |

### TC-R5 —— 会话创建正常

| 项 | 内容 |
|---|---|
| 目的 | 确认新插件**没有**污染 agent preset 链（AC-1） |
| 步骤 | 1. 新建一个会话（不同工作区各一次）<br>2. 读 console / hilog 错误 |
| 期望 | 会话创建成功；**无** `agent-preset/invalid`；**无** `row "<id>" names a plugin that cannot be resolved` |
| 证据 | console 输出（期望空） + 新会话出现 |
| 备注 | 本插件不进 preset 表，故该错误不应出现；若出现，说明被误写了 `HARMONY_ENSURED_PRESET_ROWS`（对照 TC-B1 步骤 3） |

### TC-R6 —— `dshmarket`（插件市场）未被牵连

| 项 | 内容 |
|---|---|
| 目的 | 物化 / 镜像链路的其他参与者未受影响（AC-1、AC-11 的旁证） |
| 步骤 | 1. `collect-dsh` 日志中 `dshmarket` 与 `assertDshMarketVersion()`（pin `1.66.7`）均通过<br>2. 读设备 `$DSH_HOME/profiles/node_modules/dshmarket` 存在<br>3. 设置页「插件市场」入口可见 |
| 期望 | 三项均正常 |
| 证据 | 构建日志 + 目录存在性 + UI 文本 |

---

## 4. 操作清单

> **脱敏声明**：本节只保留**操作类型与预期**。具体仓库地址、账号名与口令由需求方线下提供 —— 不写入本文档、不进入对话记录、不写入日志。
> 本文档内所有示例主机一律使用 RFC 2606 保留域名（`git.example.com`）或占位符（`<内网主机>`、`GIT_CREDENTIAL_<内网主机规整名>`）。

### 4.1 无账号（公开）仓库

| 编号 | 操作 | 工具 | 预期 |
|---|---|---|---|
| AN-1 | 远端 refs 探测（不落地） | `git_remote`（`listServerRefs`） | 列出服务端分支 / 标签 |
| AN-2 | 克隆到工作区 | `git_clone` | 成功，工作区出现仓库目录 |
| AN-3 | 查看状态 | `git_status` | 干净，或如实列出变动 |
| AN-4 | 查看历史 | `git_log` | 提交列表（含作者 / 时间 / 标题） |
| AN-5 | 查看某提交 | `git_show` | 元信息 + 变更清单 |
| AN-6 | 制造改动 → 产出 unified diff | `git_diff` | 标准 diff 文本；二进制文件如实标记 |
| AN-7 | 暂存 | `git_add` | 改动进入 staged |
| AN-8 | 提交 | `git_commit` | 生成新提交；身份来自 `git_config` 或 `Config` 默认 |
| AN-9 | 查看 / 新建 / 切换分支 | `git_branch` + `git_checkout` | 分支列表正确、切换成功 |
| AN-10 | 增量抓取 | `git_fetch` | 成功（无新内容时如实报无变化） |
| AN-11 | 拉取并合并 | `git_pull` | 成功 |
| AN-12 | 本地分支合并 | `git_merge` | 成功；冲突时按 §13 报冲突路径且工作区未被污染 |
| AN-13 | 储藏与恢复 | `git_stash`（push / list / pop） | 工作区改动被收起并可恢复 |
| AN-14 | 打标签、列标签、删标签 | `git_tag` | 三个动作均成功（本地） |
| AN-15 | 重置（soft / mixed / hard） | `git_reset` | 三种模式行为正确 |
| AN-16 | 摘取与反向 | `git_cherry_pick` + `git_revert` | 均成功；`revert` 结果与原提交互为逆 |
| AN-17 | 尝试推送（无凭据） | `git_push` | **预期失败**，且报「未配置凭据」+ key 名（验证错误处理分支） |
| AN-18 | 空目录初始化仓库 | `git_init` | 成功；生成 `.git`，默认分支正确 |
| AN-19 | 远端增删（不联网） | `git_remote`（`addRemote` / `deleteRemote`） | 新增后 `listRemotes` 可见，删除后消失 |
| AN-20 | 设置提交身份 | `git_config`（`setConfig`） | `user.name` / `user.email` 写入**仓库本地**配置；`getConfig` 回读一致 |
| AN-21 | 在 AN-18 的新仓库里首次提交 | `git_add` + `git_commit` | 成功；提交作者身份与 AN-20 一致（验证身份来源链） |

> **覆盖说明（AC-13）**：AN-1…AN-21 合起来覆盖 spec FR-3 的**全部 21 个工具**。相对 AC-4 枚举的 18 个，缺口由 AN-17（`git_push`）、AN-18（`git_init`）、AN-19（`git_remote`）补齐；AN-20 / AN-21 另支撑 AC-14。

### 4.2 带账号（内网）仓库

> **脱敏声明**：具体仓库地址、账号名与口令由需求方线下提供 —— 不写入本文档、不进入对话记录、不写入日志。凭据按 §9.1 规则存为 `GIT_CREDENTIAL_<内网主机规整名>`。

**远端只读（无副作用）**

| 编号 | 操作 | 工具 | 预期 |
|---|---|---|---|
| AR-1 | 远端 refs 探测（**验证连通与认证，不落地**） | `git_remote`（`listServerRefs`） | 列出服务端分支 |
| AR-2 | 克隆到工作区 | `git_clone` | 成功（认证经凭据库） |
| AR-3 | 状态 / 历史 / 差异 / 单提交查看 | `git_status` / `git_log` / `git_diff` / `git_show` | 均成功 |
| AR-4 | 增量抓取 | `git_fetch` | 成功 |
| AR-5 | 拉取并合并（默认分支） | `git_pull` | 成功 |
| AR-6 | 分支列出（本地 + 远端） | `git_branch`、`git_remote` | 正确 |

**远端写入（有副作用，按序执行）**

| 编号 | 操作 | 工具 | 预期 | 副作用 |
|---|---|---|---|---|
| AW-1 | 新建**独立测试分支**（占位名 `dsh-204-test`） | `git_branch` | 成功 | 无（本地） |
| AW-2 | 新增一个说明文件并提交 | `git_add`（或 `git_commit` 隐式暂存）+ `git_commit` | 成功 | 无（本地） |
| AW-3 | 推送测试分支 | `git_push`（`ref` / `remoteRef` = 测试分支） | 成功 | **远端新增分支** |
| AW-4 | 打附注标签并推送 | `git_tag` + `git_push`（tag ref） | 成功 | **远端新增标签** |
| AW-5 | 在默认分支上拉取 → 提交一个小改动 → 推送 | `git_pull` + `git_commit` + `git_push` | 成功 | **⚠️ 默认分支被推入一个新提交**（见下注） |
| AW-6 | 删除远端测试分支（收尾清理） | `git_push`（`delete: true`） | 成功 | **远端分支被删** |

> **⚠️ AW-5 的副作用（需求方评审确认保留执行）**：默认分支推送**不可自动回滚** —— 它会在共享仓库的默认分支上留下一个提交，影响所有下游使用者。按「完整读写，含默认分支」的裁决执行，**不再单独设确认门**；但执行前**必须当轮明确点名本项**并**预先给出回滚方式**，且本用例的执行与结果必须单独记录。AW-4 的远端标签**默认保留**；如需清理，在 AW-6 之后追加一次带 `delete` 的 tag push。

---

## 5. 用例与验收标准对照表

| 验收标准 | 覆盖用例 |
|---|---|
| AC-1 启动无 boot 失败 / 无 duplicate tool / hilog 无异常 | TC-D1、TC-R1、TC-R2、TC-R3、TC-R4、TC-R5、TC-R6 |
| AC-2 21 个 git 工具在会话内可用 | TC-D2 |
| AC-3 设置页可保存 / 查看状态 / 删除；`.credentials.yaml` 出现 key | TC-D3 |
| AC-4 无账号仓库 18 项操作全部成功 | TC-D6（AN-2…AN-16 与 AN-20 —— 对应 AC-4 枚举的 18 个工具） |
| AC-5 带账号仓库探测 + clone + fetch + pull + commit + push + tag + 删分支 | TC-D7（§4.2 AR-1…AR-6、AW-1…AW-6） |
| AC-6 工作区外 clone 被拒 → 提权重试 → 审批面板 → 成功 | TC-D4 |
| AC-7 缺凭据报错指明 key 名与设置入口（非裸 401） | TC-D6（AN-17）、TC-D8 |
| AC-8 凭据明文不出现在对话 / hilog / cordis.yml | TC-D5 |
| AC-9 `rebase` 明确报「本平台不支持」，不静默降级 | TC-D10 |
| AC-10 `revert` 工作区分叉时 fail-closed 并列出冲突路径 | TC-D11 |
| AC-11 `collectGitRuntime()` 物化成功且幂等；嵌套目录存在 | TC-B2、TC-B6 |
| AC-12 依赖不覆盖 dsh 顶层同名包（嵌套成立） | TC-B3 |
| AC-13 工具面 21 个相对 18 个的覆盖缺口已补齐 | TC-D13（AN-17 / AN-18 / AN-19）+ 本文档 §4.1 覆盖说明 |
| AC-14 `git_config` 身份链成立 | TC-D14（AN-20 + AN-21） |
| （构建期 / 装配支撑，无独立 AC） | TC-B1、TC-B4、TC-B5 |
| （错误与取消语义抽样） | TC-D9、TC-D12 |
