# 203-plugin-workspace-picker 技术方案

> 模块：203-plugin-workspace-picker
> 对应规格：[spec.md](./spec.md)
> Last Updated: 2026-10-01

## 1. 技术上下文

### 1.1 运行时环境

- 构建期：Windows + Node 24 + pnpm 11 + DevEco/command-line-tools-6（hvigor）+ OpenHarmony SDK（API 23/24）。
- 运行期：HarmonyOS 真机（API 24），Electron-on-HarmonyOS（Electron 37 / Node 22.17.0）。
- 部署形态：插件物化进 `dsh-dist/node_modules`，随 `dsh-dist.tar.gz` 进入 resfile；运行期镜像到 `$DSH_HOME/profiles/node_modules`。

### 1.2 依赖

| 依赖 | 来源 | 用途 |
|---|---|---|
| `@deepseek-ai/dsh-host-directory-picker-browse` | dsh 包 | browse 后端：`directoryPicker` seam（list/createDirectory） |
| `dsh.client` client-modules | dsh 包 | 客户端面扫描与 `/plugins/*/client.js` 装载 |
| ui-slots / ui-renderer | dsh 包 | React 插槽注册与渲染 |
| ui-primitives | dsh 包 | 共享控件（按钮、Modal、图标） |
| locale | dsh 包 | 文案字典与 `t` |
| JSBind 权限桥 | web_engine | `CheckPermissions` / `RequestPermissionCode` / `ShowSystemSettings` |

## 2. 宪法合规检查

| 宪法原则 | 状态 | 说明 |
|---|---|---|
| §1.1 零上游改动 / 不 fork UI | ✅ | 仅经 slot 接缝替换；无 dsh 源码改动、无新补丁 |
| §1.3 只写装配代码 | ✅ | 复用 browse 原语、client-modules、JSBind |
| §1.4 同源数据面 | ✅ | Typert RPC `directoryPicker` 命名空间 |
| §2.1 安全围栏 | ✅ | 不触碰 loopback 围栏；沿用 ACL/可写根 |
| §2.2 沙箱边界 | ✅ | HOME 指向沙箱；根围栏限制越界 |
| §5.1 幂等构建 | ✅ | collect 与镜像均为可重复覆盖 |

## 3. 命名约定与身份落点

| # | 落点 | 文件 | 值 |
|---|---|---|---|
| 1 | 目录名 | `plugins/harmony-plugin-workspace-picker/` | 与包名一致 |
| 2 | npm name / Host 导出 | `package.json` / `lib/index.js` | `harmony-plugin-workspace-picker` |
| 3 | Client bundle | `package.json` exports `./client` | `lib/client.js` |
| 4 | 根 Loader 行 id | profile patch | `workspace-picker` |
| 5 | browse 后端行 id | profile patch | `directory-picker-browse` |

## 4. 实现落点清单

### 4.1 插件 Host 面

| 文件 | 职责 |
|---|---|
| `lib/index.js` | 命名导出 `name` / `inject` / `apply`（无 default export）；apply 空占位，保持 Loader roster 身份 |

### 4.2 插件 Client 面

| 符号 | 职责 |
|---|---|
| `RootTabs` | 四主目录 Tab 渲染与切换事件 |
| `RootResolver` | root id → 绝对路径；沙箱根 ensure；用户目录根解析 `DSH_EXTRA_WRITABLE_ROOTS` |
| `MillerBrowser` | Miller 列：列目录、列栈、截断面包屑、hidden 过滤、truncated |
| `NewFolderModal` | 默认名去重、createDirectory、成功后选中 |
| `PermissionGate` | EACCES/EPERM → 预检/主动申请/重试/去设置 |
| `WorkspacePickerFlow` | owner 契约适配，串联上述单元 |

### 4.3 装配

| 文件 | 改动 |
|---|---|
| `profiles/desktop/cordis.patch.yml` | 禁用 `directory-picker`；insert browse 后端行、本插件根行 |

### 4.4 复用（不改）

| 机制 | 文件 |
|---|---|
| 构建期物化 | `scripts/collect-dsh.mjs` `collectPlugins()` |
| 运行期镜像 | `src-main/main.js` `ensureDshPluginsProfileLink()` |

## 5. 数据流

```
启动期
  ensureSandboxHome()          HOME/USERPROFILE → userData
  installExtraWritableRoots()  DSH_EXTRA_WRITABLE_ROOTS = Desktop:Documents:Download
  runProfile('desktop')        profile patch：
                                 directory-picker(auto) disabled
                                 directory-picker-browse 后端行
                                 workspace-picker 本插件根行（dsh.client）
  client-modules 扫描 → /plugins/harmony-plugin-workspace-picker/client.js

交互期
  添加工作区 → flowOwner.open
  RootResolver(rootId) → 根绝对路径（sandbox 自动 ensure）
  directoryPicker/list(root) → MillerBrowser
      EACCES/EPERM → PermissionGate
  下钻/面包屑（≤root）/ 新建文件夹
  打开 → onPicked(abs) → createWorkspace → onPick / 错误 Modal
```

## 6. 根行解析（PoC 结论回填）

真机环境已实测：

- `$DSH_HOME/profiles/node_modules` 存在并含 `dshmarket` 与三个 harmony 插件（`ensureDshPluginsProfileLink` 镜像结果）。
- 因此本插件根行的裸名解析路径成立：根行 → profile 层向上 node_modules → `profiles/node_modules/harmony-plugin-workspace-picker`。
- 原设计 R1 关闭；若装机后该行未激活，回退方案为在 profile patch 显式指定解析位置（实施时无需预置）。

## 7. 风险与缓解

| # | 风险 | 影响 | 缓解 |
|---|---|---|---|
| R1 | 禁 auto 后 browse 后端行配置不全 | seam 缺失、入口消失 | 两行同事务加入；AC-10 启动断言（PoC 已验证镜像路径） |
| R2 | 桌面 ACL 在发布 Profile 缺失 | 桌面 Tab 失败 | 上架前按 ACL-v2 A2-c 复核 |
| R3 | 授权弹窗无 active context | 主动申请失败 | 明确归因 + 重试，不静默 |
| R4 | dsh 升级后 slot/owner 契约变化 | 填洞失败 | SlotMap 类型检查 + 版本随附验证 |

## 8. 验证策略

| 层 | 手段 | 覆盖 |
|---|---|---|
| 构建期 | collect 物化 + 镜像互校 | AC-11 |
| 真机 `--inspect` | 根路径、插件树激活、seam 在役 | AC-2、AC-10 |
| 真机交互 | 四主目录全流程走查 | AC-1、3-9 |
| 回归 | 两入口与采纳链路 | AC-8、AC-10 |

## 9. 关键决策记录

| # | 决策 | 备选 | 理由 |
|---|---|---|---|
| D1 | dual-face 单包 | 纯后端 + 独立页面 | 同 React/同源，slot 是官方接缝 |
| D2 | 禁 auto + 直挂 browse 后端 | slot priority shadow / 完全独立 | 无共存冲突，复用全部原语 |
| D3 | 沙箱根 = userData/workspace | userData 根 / $DSH_HOME | 与配置数据隔离、自动创建 |
| D4 | 只向下、无手输路径、无隐藏开关 | 全文件系统 | 边界清晰、错误面小 |
| D5 | 只记主目录不记子路径 | 完整路径记忆 | 失效路径容错成本低 |

## 10. 待确认

- 无。根行裸名解析已由真机 `--inspect` 实测确认（§6）。
