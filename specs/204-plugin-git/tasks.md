# 204-plugin-git 任务清单

> Module: 204-plugin-git
> Status: Specified
> Last Updated: 2026-10-16
> 设计来源：[docs/204-插件-GIT.md](../../docs/204-插件-GIT.md)（§ 引用均指该文档的章节）
> 对应规格：[spec.md](./spec.md) / [plan.md](./plan.md) / [test-cases.md](./test-cases.md)

## 1. 开发任务

| ID | 任务 | 落点 | 依赖 | 验收 |
|---|---|---|---|---|
| T1 | 插件包骨架：`package.json`（`name` / `private` / `type` / `main` / `exports` 含 `./client` / `dsh.client` / `peerDependencies`） | `plugins/harmony-plugin-git/package.json` | — | 包名与声明校验通过（FR-1.1、FR-1.2） |
| T2 | host 面入口：命名导出 `name` / `inject` / `Config` / `apply`（无 default export） | `lib/index.js` | T1 | Loader 保留 `inject`；`Config` 含身份占位默认值（FR-1.3、FR-10） |
| T3 | 运行时装载：isomorphic-git（插件内嵌套闭包，pin `1.44.2`）与 jsdiff（**宿主闭包**，不物化）动态 `import`；断言 isomorphic-git 精确版本、jsdiff 只断言 major（`SUPPORTED_JSDIFF_MAJOR = 9`）与入口 `createTwoFilesPatch` 存在 —— 版本清单读不出来时警告而不失败 | `lib/runtime.js` | T2 | major 不符 / 入口缺失即明确报错，不静默降级（FR-8.2） |
| T4 | 仓库根围栏：`ctx.fs.resolve` → `processPath` + chroot 校验 + 提权决议（对齐 `FsMutationSandbox`） | `lib/fence.js` | T2 | 越界抛 `FS_SANDBOX_DENIED` + 共享 marker/提示（FR-4） |
| T5 | fs 适配器：isomorphic-git fs 契约 → `node:fs/promises`，**逐路径**前缀包含校验 | `lib/fs-adapter.js` | T4 | `..` 逃逸 / 绝对路径 / 软链出根一律拒绝（FR-4.2） |
| T6 | 凭据：key 名规整（`GIT_CREDENTIAL_<HOST>`）+ `ctx.credentials.resolve` + `onAuth` / `onAuthFailure` + 错误引导 + 重试上限 1 | `lib/auth.js` | T2 | 缺凭据报 key 名与设置入口；不裸抛 401（FR-5） |
| T7 | diff 封装：**宿主闭包** jsdiff 的 `createTwoFilesPatch` / `stat` 汇总 / 二进制（含 NUL）判定 | `lib/diff.js` | T3 | 二进制只报 `differ`，不做文本 diff（FR-7.2） |
| T8 | 输出渲染：status 五个分组、提交摘要、冲突列表、错误归因文案 | `lib/report.js` | T2 | 渲染可读且失败原因如实（FR-3、FR-9） |
| T9 | **21 个工具**：`lib/tools/*.js` 一文件一工具，全部经 `defineTool`；写类工具带 `sandbox_permissions` + `justification` | `lib/tools/*.js` | T3–T8 | 21 个工具全部注册成功，无 schema 拒绝（FR-3.1、FR-3.2、FR-3.3） |
| T10 | 三个自建能力工具面：`git_show` / `git_diff` / `git_revert`（含 `revert` 的父提交枚举与 fail-closed 分叉判定） | `lib/tools/git_{show,diff,revert}.js` | T7、T9 | 分叉时拒绝并列出冲突路径（FR-7.1、FR-7.3） |
| T11 | client 面：`settings.section`（id `git-credentials`，标题「Git 凭据」）保存 / `describe` 回显 / `unset`；`localStorage` 记忆 host 清单 + 限制提示；`inject` 对齐 `ui-settings-models` | `lib/client.js` | T1 | 页面可保存 / 回显状态 / 删除；不声明未提供的服务（FR-6） |
| T12 | 插件 README（中英）：配置项、凭据命名规则、围栏语义、Known Limitations（含 `rebase` 不支持） | `plugins/harmony-plugin-git/{README,README_zh}.md` | T11 | 两份文档就位（FR-2.2、FR-9） |
| T13 | 纯函数单测：key 名规整、chroot 校验、diff 渲染、status 分组、revert 冲突判定 | `plugins/harmony-plugin-git/tests/*.test.mjs` | T6–T10 | `node --test` 全通过（FR-4.2、FR-5.1、FR-7） |
| T14 | 以最终实现替换 R2 PoC 骨架：删除临时全局诊断挂钩（`globalThis.__gitPoc`）与探针工具，改由 `[dsh-harmony]` 日志自证 | `lib/index.js` | T9 | 工具表恰为 21 个 git 工具，无探针工具、无全局挂钩（FR-3.2） |

## 2. 装配任务

| ID | 任务 | 落点 | 验收 |
|---|---|---|---|
| T15 | profile patch：新增 `- insert:` 一行 `id: git` / `name: harmony-plugin-git` + 就地的例外说明注释 | `profiles/desktop/cordis.patch.yml` | host 平面一行同时交付工具与设置页（FR-2.1、FR-2.3） |
| T16 | `plugins/README.md` **原位新增一节**「需要 client 面的插件走 host 行」（§二.7 例外登记），并在「四、现有插件」增行 | `plugins/README.md` | 例外已登记（FR-2.2） |
| T17 | 文档同步：`README.md` inspector 章节改用 `process.mainModule.require`；`docs/工程规划.md` 与 `specs/README.md` 登记 204 模块与四件套 | `README.md`、`docs/工程规划.md`、`specs/README.md` | 四处口径一致（FR-2.2、plan R11） |

## 3. 构建与部署

| ID | 任务 | 命令 / 落点 | 验收 |
|---|---|---|---|
| T18 | 实现 `collectGitRuntime()`：pin 常量（**仅** `ISOMORPHIC_GIT_VERSION`；jsdiff 不 pin）+ staging `pnpm add isomorphic-git@1.44.2 --config.node-linker=hoisted --ignore-scripts`（不含 `diff`）+ 整棵闭包嵌套到**插件自己的** `dsh-dist/node_modules/harmony-plugin-git/node_modules/` + 产物断言（入口非空 / 版本一致）+ 幂等（快路径同样断言；正常构建先删 `distDir`，快路径只能在单独二次调用时验证）+ 失败**抛错**而非 `process.exit(1)`（由调用点 `try/catch` 终止进程） | `scripts/collect-dsh.mjs` | AC-11、AC-12（FR-8） |
| T19 | 跑 `collect-dsh` 全链：插件物化 + 依赖物化；既有 `assertDshMarketVersion()`（pin `1.66.7`）与 `assertPresetRowsMirrorMainJs()` 仍需通过 | `node scripts/collect-dsh.mjs` | `dsh-dist/node_modules/harmony-plugin-git/` 与 `dsh-dist/node_modules/harmony-plugin-git/node_modules/isomorphic-git/` 均存在；顶层 `dsh-dist/node_modules/diff` 仍是宿主的 `9.0.0`（插件不发 diff） |
| T20 | 重打 `dsh-dist.tar.gz` 并落到 resfile | tar 命令（工程既有步骤） | 时间戳更新；体积增量约 +8.6 MB（基线 286 MB；仅 isomorphic-git 闭包，jsdiff 复用宿主闭包） |
| T21 | HAP 编译签名（debug）：**必须显式传参** `-Hvigorw D:\oh-workspace\command-line-tools\bin\hvigorw.bat -DevEcoHome "D:\oh-workspace\DevEco Studio"`；构建环境先设 `DEVECO_SDK_HOME` | `scripts/build-debug.ps1`（前置 `scripts/collect-runtime.mjs`） | `BUILD SUCCESSFUL` + 签名 HAP 产出 + 签名自检通过 |
| T22 | **装机前置**：清设备 `$DSH_HOME/dsh-dist`（解压 marker 命中即跳过 → 会继续跑旧产物），再安装 | `hdc shell` + `hdc app install -r` | 安装成功；启动后是本次产物（T24 复核） |

## 4. 测试任务

| ID | 任务 | 验收 |
|---|---|---|
| T23 | 单测 + 静态检查：`node --test`、`node --check`、`grep` 核对包名令牌与 profile 行 | plan §8「单元 / 静态」层通过 |
| T24 | `--inspect` 通道：`hdc fport tcp:19229 tcp:9229` + CDP `Runtime.evaluate`（脚本用 `process.mainModule.require`）读插件树 / 工具表 / `.credentials.yaml`；`hilog \| grep dsh-harmony` 读插件自证 | AC-1、AC-2、AC-3 |
| T25 | 真机 UI 走查：设置页保存 / 回显 / 删除；审批面板出现与同意 | AC-3、AC-6 |
| T26 | 无账号（公开）仓库操作清单 **AN-1…AN-21** 逐项执行（test-cases.md §4.1；含 AN-17 预期失败、AN-18 `git_init`、AN-19 `git_remote` 增删、AN-20 `git_config` 设身份、AN-21 新仓库首次提交） | AC-4、AC-7、AC-13、AC-14 |
| T27 | 带账号（内网）仓库操作清单：只读 **AR-1…AR-6** + 写入 **AW-1…AW-6** 按序执行（test-cases.md §4.2）；**执行前当轮点名 AW-5 并给出回滚方式** | AC-5 |
| T28 | 明文不泄漏三处检索：对话记录 / `hilog` / `cordis.yml`（值绝不出现） | AC-8 |
| T29 | 专项两项：`rebase` 明确不支持；`revert` 构造工作区分叉场景验证 fail-closed | AC-9、AC-10 |
| T30 | 回归：fs-mutate / fs-search / exec / workspace-picker 不受影响；新建会话正常；`dshmarket` 未被牵连 | AC-1 |

## 5. 执行顺序

1. T1 → T2 → T3
2. T4 → T5；T6、T7、T8（T9 依赖 T3–T8）→ T9 → T10 → T11 → T12 → T13
3. T14（替换 PoC 骨架，须在 T9 之后、出包之前）
4. T15 → T16 → T17
5. T18 → T19 → T20 → T21 → T22
6. T23 → T24 → T25 → T26 → T27 → T28 → T29 → T30

## 6. 覆盖对照（FR 与实现落点）

| 需求 / 落点 | 覆盖任务 |
|---|---|
| FR-1 插件身份与命名 | T1、T2 |
| FR-2 挂载平面 | T2、T15、T16 |
| FR-3 工具面（21 个） | T9、T10、T14 |
| FR-4 仓库根围栏与提权审批 | T4、T5 |
| FR-5 凭据 | T6 |
| FR-6 凭据设置页 | T11 |
| FR-7 三个自建能力 | T7、T10 |
| FR-8 依赖物化 `collectGitRuntime()` | T3、T18 |
| FR-9 错误与取消语义 | T8、T10 |
| FR-10 插件配置 `Config` | T2 |
| 设计文档 §15 落点 1 插件目录 | T1 |
| §15 落点 2 包清单 | T1 |
| §15 落点 3 host 面 | T2 |
| §15 落点 4 围栏 | T4 |
| §15 落点 5 fs 适配器 | T5 |
| §15 落点 6 凭据 | T6 |
| §15 落点 7 diff / show / revert | T7、T10 |
| §15 落点 8 21 个工具 | T9、T14 |
| §15 落点 9 client 面 | T11 |
| §15 落点 10 依赖物化 | T18、T19 |
| §15 落点 11 挂载 | T15 |
| §15 落点 12 插件 README | T12 |
| §15 落点 13 文档同步 | T16、T17 |
| §15 落点 14 规格文档 | `specs/204-plugin-git/` 四件套（本文件即其一） |
