# 203-plugin-workspace-picker 任务清单

> 模块：203-plugin-workspace-picker
> Last Updated: 2026-10-01

## 1. 开发任务

| ID | 任务 | 落点 | 依赖 | 验收 |
|---|---|---|---|---|
| T1 | 插件包骨架：`package.json`（name、exports、dsh.client、peerDependencies） | `plugins/harmony-plugin-workspace-picker/` | — | 包名/声明校验通过 |
| T2 | Host 面：命名导出，apply 注册插件自有原生能力 IPC 桥（根解析 + 权限三动作） | `lib/index.js` | T1 | 无 default export；桥经 ipcMain/ipcRenderer 往返成立 |
| T3 | Client 构建：打包配置（tsdown/等价）输出 lazy-CJS factory `lib/client.js` | 构建配置 | T1 | `window.__ModuleLoader__.load` 形态 |
| T4 | `RootResolver`：四主目录路径解析 + 沙箱根自动创建 | client | T2 | FR-2 |
| T5 | `RootTabs`：四 Tab 切换 | client | T4 | FR-1 |
| T6 | `MillerBrowser`：列目录/列栈/截断面包屑/hidden 过滤/truncated | client | T4 | FR-3 |
| T7 | `NewFolderModal`：默认名去重 + 建目录 + 选中 | client | T6 | FR-4 |
| T8 | `PermissionGate`：预检/主动申请/重试/去设置 | client | T6 | FR-6 |
| T9 | `WorkspacePickerFlow`：owner 契约 + 两 slot 事务注册 | client | T5-T8 | FR-5/FR-8 |
| T10 | README | 插件目录 | T9 | 含 Known Limitations |

## 2. 装配任务

| ID | 任务 | 落点 | 验收 |
|---|---|---|---|
| T11 | profile patch：禁用 `directory-picker`，insert browse 后端行与本插件根行 | `profiles/desktop/cordis.patch.yml` | FR-8 |

## 3. 构建与部署

| ID | 任务 | 命令 / 落点 | 验收 |
|---|---|---|---|
| T12 | collect-dsh 物化插件 | `node scripts/collect-dsh.mjs` | dsh-dist/node_modules/harmony-plugin-workspace-picker |
| T13 | 重打 dsh-dist.tar.gz | tar 命令（resfile） | 时间戳更新、体积合理 |
| T14 | HAP 编译签名 debug | `scripts/build-debug.ps1` | electron-default-signed.hap 产出、签名断言通过 |
| T15 | 真机安装 | `hdc app install -r` | install 成功 |

## 4. 测试任务

| ID | 任务 | 验收 |
|---|---|---|
| T16 | `--inspect` fport + 根路径/seam/插件树检查 | AC-2、AC-10 |
| T17 | 真机四主目录交互走查 | AC-1、3-9 |
| T18 | 回归：两入口、采纳链路 | AC-8、AC-10 |

## 5. 执行顺序

1. T1 → T2 → T3
2. T4 → T5、T6（T7、T8 依赖 T6）→ T9 → T10
3. T11
4. T12 → T13 → T14 → T15
5. T16 → T17 → T18
