# workspace-picker 插件（工程内专用）功能规格

> Module: 203-plugin-workspace-picker
> Status: In Development
> Last Updated: 2026-10-01

## 1. 模块概述

### 1.1 目的 —— 为什么存在这个模块

把「选择工作区目录」对话框以 **dsh-desktop-hos 工程内专用插件**的身份（`plugins/harmony-plugin-workspace-picker/`）替换：对话框顶部可切换四个主目录（沙箱 / 桌面 / 文档 / 下载），切换后在对应目录内完成列目录、新建文件夹、选择等操作。

本插件是 **dual-face 装配式插件**：

- Host 面为空 apply，仅使包进入 Loader roster（对齐 browse 包 node 半写法）。
- Client 面声明 `dsh.client`，经 `ctx.slots.register` 把自定义对话框组件填进 ui-workspace 的两个 directory-flow single slot。
- 目录数据复用 browse 后端 Typert RPC（命名空间 `directoryPicker`，方法 `list` / `createDirectory`），不自实现文件系统。

完整设计来源：[`docs/203-插件-选择工作区目录.md`](../../docs/203-插件-选择工作区目录.md)。

### 1.2 解决的问题

- **已授权用户目录无法用于添加工作区**。ACL 已可访问桌面/文档/下载，主进程已把它们写入 `DSH_EXTRA_WRITABLE_ROOTS`，但选择对话框起点被重定向 HOME 后落在沙箱内，用户目录中的文件夹无法注册为工作区。
- **替换必须走官方接缝**。dsh 前端不 fork（constitution §1.1）；两个 directory-flow slot 是文档化的 swap point，插件填同两个洞即可完成替换。
- **浏览边界必须显式锁定**。四主目录互为隔离浏览域：只向下、不上溯、无手动路径输入，避免对话框触碰未授权或系统敏感目录。
- **授权要在交互内闭环**。未授权时在对话框内主动申请系统权限，同意后自动续列，不必跳到系统设置再返回。

### 1.3 范围

**包含**：

- 插件本体：`dsh-desktop-hos/plugins/harmony-plugin-workspace-picker/` 下 Host 面（`lib/index.js`）、Client 面（`lib/client.js` 及其源结构）、`package.json`、README。
- Profile 装配：`profiles/desktop/cordis.patch.yml` 禁用 `directory-picker`（auto）行，静态直挂 browse 后端行与本插件根 Loader 行。
- 构建期物化：沿用 `collectPlugins()` 的 `harmony-plugin-*` 通配自动发现，物化到 `dsh-dist/node_modules/<包名>/`。
- 运行期镜像：沿用 `ensureDshPluginsProfileLink()` 复制到 `$DSH_HOME/profiles/node_modules/` 并清理同族陈旧目录。
- 真机编译、部署与 `--inspect` 功能测试。
- 本模块的 `spec.md` / `plan.md` / `tasks.md` / `test-cases.md`。

**不包含**：

- dsh 源码改动与新增补丁。
- ArkTS `ContextPathAdapter.getUser*Dir` 的补全（当前为空实现；路径从 `DSH_EXTRA_WRITABLE_ROOTS` 解析）。
- 文件选择、多选、整盘浏览、手动路径输入、隐藏文件开关。
- 父工程 `specs/` 登记（本模块规格仅落在 `dsh-desktop-hos/specs/`）。
- Git 分支改动。

## 2. 用户故事

- 作为用户，我希望在选择对话框中切换到桌面/文档/下载，以便把这些已授权目录中的文件夹注册为工作区。
- 作为用户，我希望选定主目录后能进入子文件夹、新建文件夹并选中，以精确指定工作区位置。
- 作为用户，当某用户目录尚未授权时，我希望在对话框内直接完成授权并继续，不必跳出应用。
- 作为用户，我希望下次打开对话框时默认停留在上次使用的主目录，减少重复切换。
- 作为设备上的排障者，我希望从 hilog 与 `--inspect` 即可确认根行解析、seam 在役与四个主目录路径正确。

## 3. 功能需求

### FR-1 主目录切换

- FR-1.1 对话框顶部渲染四个主目录 Tab：沙箱 / 桌面 / 文档 / 下载。
- FR-1.2 切换主目录时重置浏览栈为该主目录根、清空选中列、重新列目录。
- FR-1.3 默认主目录取上次使用值（FR-7）；首次使用默认为沙箱。

### FR-2 主目录解析

- FR-2.1 沙箱主目录 = `join(app.getPath('userData'), 'workspace')`（真机 `/data/storage/el2/base/files/workspace`）；打开对话框时检查，不存在则 `mkdir { recursive: true }` 自动创建。
- FR-2.2 桌面/文档/下载从 `DSH_EXTRA_WRITABLE_ROOTS` 按固定顺序解析：Desktop、Documents、Download。
- FR-2.3 解析失败时对应 Tab 内容区显示不可用说明与重试入口，不回退其他主目录。

### FR-3 目录浏览（Miller 列）

- FR-3.1 沿用 680×500 Miller 列视图：未选中单列全宽，选中文件夹后向右展开子级新列。
- FR-3.2 只列目录、名称排序；不渲染宿主标记的 hidden 项，不提供隐藏文件开关。
- FR-3.3 面包屑截断为当前主目录根：最高可点击到主目录根，不显示根之上层级。
- FR-3.4 移除手动路径输入，UI 中不存在任意路径提交入口。
- FR-3.5 entries 超 1000 时展示后端 `truncated` 提示。

### FR-4 新建文件夹

- FR-4.1 「新建文件夹」弹出嵌套 Modal，输入单个目录段名称（后端 zod 校验）。
- FR-4.2 默认名 `未命名文件夹` / `Untitled folder`，同级冲突追加序号。
- FR-4.3 创建成功后重新列目录并选中新文件夹。

### FR-5 选择与采纳

- FR-5.1 「打开」采纳当前选中文件夹；无选中时采纳当前列所在目录。
- FR-5.2 经 owner 契约 `onPicked(绝对路径)` 回传，复用 ui-workspace `createWorkspace({ path })` 采纳链路。
- FR-5.3 「取消」或关闭对话框触发 `onCancel`。

### FR-6 授权处理

- FR-6.1 列目录返回 `EACCES`/`EPERM` 时先经 `PermissionManagerAdapter.CheckPermissions` 预检；未授权则在对话框内经 `RequestPermissionCode` 主动弹系统授权窗，按钮 loading。
- FR-6.2 授权成功（回调 0）自动重试列目录；拒绝时展示原因 + 「去系统设置」（`ShowSystemSettings`），返回后手动重试。
- FR-6.3 授权桥不可用或无 active context 时明确归因提示，不静默失败。

### FR-7 主目录记忆

- FR-7.1 主目录选择持久化到浏览器 `localStorage`（插件私有键）。
- FR-7.2 只记主目录、不记子路径；再次打开停在该主目录根。
- FR-7.3 存储值非法时回退沙箱。

### FR-8 装配与加载

- FR-8.1 本插件为 root 作用域 UI，**不**加入 `HARMONY_ENSURED_PRESET_ROWS`；其根 Loader 行由 profile patch 提供。
- FR-8.2 profile patch 禁用 `directory-picker`（auto）行，并静态直挂 browse 后端行与本插件行。
- FR-8.3 包名匹配 `harmony-plugin-workspace-picker`，目录名 = npm 包名 = 插件 `name` 导出。

## 4. 根围栏（安全属性）

| # | 约束 |
|---|---|
| 1 | 浏览栈第一列锁定主目录根的 `list` 结果；下钻只接受当前列条目产生的子路径 |
| 2 | 面包屑点击最高为主目录根，根之上 crumb 不渲染 |
| 3 | 无手动路径输入，UI 不存在任意绝对路径提交入口 |
| 4 | `RootResolver` 返回值是后续操作唯一路径来源；切换主目录必须重置整栈 |

这是安全属性，不是待修的 bug。

## 5. 验收标准

| 编号 | 验收标准 | 验证方式 |
|---|---|---|
| AC-1 | 顶部出现四个主目录 Tab，可切换且切换后列对应根、浏览栈重置 | 真机操作 |
| AC-2 | 沙箱主目录为 userData/workspace；删除后打开可自动重建 | 真机 + `--inspect` |
| AC-3 | 桌面/文档/下载可列出其下文件夹，路径为 `/storage/Users/currentUser/{...}` | 真机操作 + hilog |
| AC-4 | 可逐级下钻；面包屑最高只到主目录根 | 真机操作 |
| AC-5 | 无手动路径输入、无隐藏文件入口；hidden 条目不展示 | UI 检查 |
| AC-6 | 未授权时对话框内弹系统授权窗；同意自动列出，拒绝有去设置入口 | 真机（清授权） |
| AC-7 | 可新建文件夹、默认名去重、创建后自动选中 | 真机操作 |
| AC-8 | 「打开」回传绝对路径并成功创建工作区；采纳失败出现可重试错误框 | 真机操作 |
| AC-9 | 再次打开默认停留上次主目录根（不恢复子路径）；非法值回退沙箱 | 真机操作 |
| AC-10 | 插件树无 duplicate slot/service 报错；auto 已禁用、browse 后端在役 | hilog + `--inspect` |
| AC-11 | 构建期 collect 物化本插件且断言通过；无收集脚本改动 | 构建日志 |

## 6. 约束

- 零上游改动（constitution §1.1）：不改 dsh 源码，不新增补丁，不 fork Web UI。
- 只写装配代码（constitution §1.3）：复用 browse 后端、client-modules、JSBind 权限桥。
- 同源数据面（constitution §1.4）：数据走 Typert RPC，无新 IPC/CORS/自定义协议。
- 沙箱边界（constitution §2.2）：HOME 仍指向沙箱；用户目录仅经既有授权访问。
- 禁 symlink；插件目录与包名一致。
- 提交信息遵循 Conventional Commits，经 git-commit 技能流程生成。

## 7. 术语

| 术语 | 含义 |
|---|---|
| dual-face 插件 | 同一包内提供 Host 面与 Client（`dsh.client`）面 |
| directory-flow slot | ui-workspace 声明的两个 single 洞，由选择对话框填充 |
| 主目录 | 沙箱 / 桌面 / 文档 / 下载四个隔离浏览域之一 |
| 根围栏 | 将浏览操作限制在选定主目录内向下穿越的安全约束 |
| 物化 / 运行期镜像 | 复制到 `dsh-dist/node_modules` / `$DSH_HOME/profiles/node_modules` |
