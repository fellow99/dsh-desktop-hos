# harmony-plugin-workspace-picker

DSH Desktop (HarmonyOS) 专用插件：用四个主目录（沙箱 / 桌面 / 文档 / 下载）的
Miller 列浏览器替换内置「选择工作区目录」对话框，支持逐级进入、新建文件夹和采纳
为工作区。

本插件是 dual-face 包：Host 面运行在 Electron 主进程，Client 面运行在 renderer。

## 组成

| 文件 | 面 | 职责 |
|---|---|---|
| `lib/index.js` | Host | 注册四个原生能力 IPC 通道；沙箱根自动创建 |
| `lib/client.js` | Client | lazy-CJS factory，Miller 列 UI、样式注入、locale、slot 注册 |

## 数据面边界

目录数据仍走既有 Typert RPC，插件不承载业务数据：

- `directoryPicker/list`
- `directoryPicker/createDirectory`

Host 面的 IPC 桥只传递根路径与权限结果，属于原生能力桥，不传递工作区 / 会话数据。

四个 IPC 通道（`ipcMain.handle`，随插件 effect 注册与清理）：

| 通道 | 方向载荷 |
|---|---|
| `harmony-plugin-workspace-picker:root` | root id → 绝对根路径 |
| `harmony-plugin-workspace-picker:permission-check` | 权限类型 → boolean |
| `harmony-plugin-workspace-picker:permission-request` | 权限类型 → number（0 授权成功） |
| `harmony-plugin-workspace-picker:open-app-info` | 打开本应用系统信息页 |

## 四个主目录

| root id | 根路径 |
|---|---|
| `sandbox` | `<app.getPath('userData')>/workspace`，真机为 `/data/storage/el2/base/files/workspace` |
| `desktop` | `/storage/Users/currentUser/Desktop` |
| `documents` | `/storage/Users/currentUser/Documents` |
| `download` | `/storage/Users/currentUser/Download` |

Client 面记忆上次选择的主目录（localStorage key `wpk.lastRoot`），默认沙箱。

权限类型映射（仅三个用户目录，沙箱免授权）：

- `desktop → directory_desktop`
- `documents → directory_document`
- `download → directory_download`

## 权限机制

- 权限检查与申请通过主进程 `systemPreferences.callArkTSAsyncFunction` 调用
  `PermissionManagerAdapter`。
- callback 风格的 ArkTS 绑定必须用 async 形式（`callArkTSAsyncFunction`）；sync 形式
  返回 `{}`，不可用。
- 列表被拒时，Client 面先复查权限；已授权则自动重试，未授权则显示「请求授权 /
  去系统设置」。
- 「去系统设置」使用 `ElectronApp.OpenApplicationInfoEntry`，真机落到本应用信息页的
  「文件和文件夹」权限。不使用 `ContextPathAdapter.ShowSystemSettings`：其 `subUri`
  被 Settings 忽略，只落在设置首页。

### 真机实测：PC 模式下授权只走系统设置

在该 2-in-1 PC 模式 runtime（`currentUser` 用户目录）上实测：

- `RequestPermissionCode` 对 `directory_desktop/document/download` **返回 `0`，但
  不弹任何系统授权框，也不改变实际访问**（fs 仍 `EPERM`）。
- `CheckPermissions` 即使在系统开关已打开、fs 已可读写后**仍返回 `false`**——
  scoped-folder 授权对该检查桥不可见。
- 唯一真正生效的授权面是「去系统设置 → 文件和文件夹」里的三个文件夹开关。
- 因此授权成功的判定不能依赖 check 桥；授权后用户在列内重试或重新进入该 tab，
  触发一次全新的 `directoryPicker/list`（此时成功）即加载目录。这是预期路径，
  「请求授权」按钮在该 runtime 上属于尽力而为（best-effort）。

## Client bundle 约束

- 无构建步骤：`lib/client.js` 为手写 lazy-CJS factory，使用 `React.createElement`。
- 脚本以 classic `<script src>` 执行，顶层 `require` 即 renderer 原生 Node require；
  文件在注册前先捕获 `const nodeRequire = require`，避免 factory 参数 `require`
  （module table）遮蔽后无法解析 `electron`。
- React 从 loader module table 获取，不重复安装。
- 样式字符串注入，class 前缀 `wpk-`，token 用 `--dsw-*` 并带 fallback。
- locale namespace：`workspacePicker`，注册 zh / en。

## 装配

本插件是 root-scope UI，通过 `profiles/desktop/cordis.patch.yml` 装配，不加入
`HARMONY_ENSURED_PRESET_ROWS`：

1. 禁用 `directory-picker` auto 行；
2. insert browse host 后端 `@deepseek-ai/dsh-host-directory-picker-browse`；
3. insert 本插件行 `harmony-plugin-workspace-picker`。

## Known Limitations

- **仅四个固定主目录。** 不支持浏览其它根、枚举存储卷，也不支持路径手输；到达目标
  只能逐级进入或新建文件夹。
- **不支持搜索、多选、重命名、删除。** 插件只列目录、建目录；无隐藏项开关，
  dot-prefix 目录始终过滤（`entry.hidden`）。
- **权限拒绝靠消息文本判别。** Typert wire code `directory-picker/unreadable` 涵盖
  所有不可读原因，无法单独表达权限拒绝；Client 面以 host 消息中的
  `EACCES` / `permission denied` 判别。若上游改动错误消息文案，权限引导可能不触发。
- **依赖主进程 ArkTS 桥。** 权限能力与应用信息深链只在 Electron-on-HarmonyOS 真机
  runtime 可用；在普通 Node 或其它壳上 `ipcRenderer` 桥不可达时插件无法工作，故本
  插件不具备跨壳可移植性（这是它放在 `plugins/` 而非通用 `dsh-plugins/` 的原因）。
- **「去系统设置」离开应用。** 返回需手动切回；授权后通过列内重试或重新进入生效。
