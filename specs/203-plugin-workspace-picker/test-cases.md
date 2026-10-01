# 203-plugin-workspace-picker 测试用例

> 模块：203-plugin-workspace-picker
> 对应规格：[spec.md](./spec.md)
> 对应方案：[plan.md](./plan.md)
> Last Updated: 2026-10-01

## 0. 测试环境与前置

| 项 | 值 |
|---|---|
| 设备 | 真机（hdc target `3QC0226526001227`） |
| 系统 | HarmonyOS API 24 |
| 调试通道 | `hdc fport tcp:19229 tcp:9229`；CDP 脚本 `logs/20261001-1/cdp.mjs` |
| 应用 | `org.fellow99.dsh.DshDesktop`，debug 签名 HAP |
| 关键路径 | `/data/storage/el2/base/files/workspace`、`/storage/Users/currentUser/{Desktop,Documents,Download}` |

## 1. 构建期用例

### TC-B1 — collect 物化

| 项 | 内容 |
|---|---|
| 目的 | 确认插件被 collect-dsh 自动物化 |
| 前置 | 插件源目录与 package.json 就位 |
| 步骤 | 运行 `node scripts/collect-dsh.mjs` |
| 期望 | `dsh-dist/node_modules/harmony-plugin-workspace-picker/package.json` 存在 |
| 证据 | 构建日志 + 文件存在性 |
| 失败含义 | 包名/目录不符或 collect 逻辑被破坏 |

### TC-B2 — HAP 编译签名

| 项 | 内容 |
|---|---|
| 目的 | 确认 HAP 产出且签名断言通过 |
| 步骤 | 运行 `scripts/build-debug.ps1` |
| 期望 | `electron/build/default/outputs/default/electron-default-signed.hap` 存在；签名工具断言 exit 0 |
| 失败含义 | profile patch 或签名配置错误 |

## 2. 真机用例（--inspect）

### TC-D1 — 根环境与镜像

| 项 | 内容 |
|---|---|
| 目的 | 确认启动环境与根行解析 |
| 步骤 | fport 后经 CDP 读取 `process.env`（HOME、DSH_HOME、DSH_EXTRA_WRITABLE_ROOTS）与 `profiles/node_modules` |
| 期望 | HOME=`/data/storage/el2/base/files`；镜像目录含 `harmony-plugin-workspace-picker` |
| 覆盖 | AC-10；plan §6 |

### TC-D2 — 沙箱根自动创建

| 项 | 内容 |
|---|---|
| 目的 | 确认沙箱主目录自动创建 |
| 步骤 | 删除 userData/workspace（如存在）→ 打开对话框切到沙箱 → stat 该路径 |
| 期望 | 目录存在（mode 0777/可写），列表正常 |
| 覆盖 | AC-2 |

### TC-D3 — 四 Tab 切换

| 项 | 内容 |
|---|---|
| 目的 | 确认切换与栈重置 |
| 步骤 | 依次切换四个 Tab；在某 Tab 下钻一层后切走再切回 |
| 期望 | 每次列对应根；切回后停在根、无子级残留 |
| 覆盖 | AC-1 |

### TC-D4 — 用户目录列举

| 项 | 内容 |
|---|---|
| 目的 | 确认三用户目录可列且路径正确 |
| 步骤 | 切换到桌面/文档/下载，读取首列条目与当前路径 |
| 期望 | 路径前缀 `/storage/Users/currentUser/{...}`；仅目录、排序 |
| 覆盖 | AC-3 |

### TC-D5 — 下钻与面包屑围栏

| 项 | 内容 |
|---|---|
| 目的 | 确认只向下、面包屑最高到根 |
| 步骤 | 连续下钻多层；逐级点面包屑；检查根之上 crumb |
| 期望 | 可下钻；面包屑首项为主目录根且无其上层级 |
| 覆盖 | AC-4 |

### TC-D6 — 入口精简检查

| 项 | 内容 |
|---|---|
| 目的 | 确认无手输路径、无隐藏开关 |
| 步骤 | 检查对话框 header/footer 控件与 hidden 条目 |
| 期望 | 无铅笔/路径输入框、无「显示隐藏文件」；hidden 条目不渲染 |
| 覆盖 | AC-5 |

### TC-D7 — 授权主动申请

| 项 | 内容 |
|---|---|
| 目的 | 确认未授权在对话框内闭环 |
| 前置 | 清除对应用户目录授权 |
| 步骤 | 切到该 Tab；观察系统授权窗；同意 → 看列表；另清一次后拒绝 |
| 期望 | 同意自动列目录；拒绝展示原因 + 去设置入口 |
| 覆盖 | AC-6 |

### TC-D8 — 新建文件夹

| 项 | 内容 |
|---|---|
| 目的 | 确认新建、去重、选中 |
| 步骤 | 连续新建两个默认名文件夹；stat 路径 |
| 期望 | `未命名文件夹`、`未命名文件夹 2`；创建后自动选中 |
| 覆盖 | AC-7 |

### TC-D9 — 采纳工作区

| 项 | 内容 |
|---|---|
| 目的 | 确认打开回传与工作区创建 |
| 步骤 | 选中文件夹 → 打开；侧栏确认工作区出现；再对一个无权限/无效场景触发失败 |
| 期望 | 成功创建并切换；失败出现可重试错误框 |
| 覆盖 | AC-8 |

### TC-D10 — 主目录记忆

| 项 | 内容 |
|---|---|
| 目的 | 确认只记主目录 |
| 步骤 | 选桌面并下钻 → 关闭对话框重开；改 localStorage 为非法值再开 |
| 期望 | 重开停在桌面根（不恢复子路径）；非法值回退沙箱 |
| 覆盖 | AC-9 |

## 3. 回归用例

### TC-R1 — 两入口可用

| 项 | 内容 |
|---|---|
| 目的 | 确认侧栏与 hero 两入口的添加工作区均可用 |
| 期望 | 两处都打开同一对话框，采纳行为一致 |
| 覆盖 | AC-1、AC-8 |

### TC-R2 — 无重复注册

| 项 | 内容 |
|---|---|
| 目的 | 确认 auto 禁用后无 duplicate slot/service |
| 步骤 | 读启动 hilog 与插件树状态 |
| 期望 | 无 duplicate 报错；browse 后端在役 |
| 覆盖 | AC-10 |

## 4. 用例与验收标准对照

| 验收标准 | 覆盖用例 |
|---|---|
| AC-1 | TC-D3、TC-R1 |
| AC-2 | TC-D2 |
| AC-3 | TC-D4 |
| AC-4 | TC-D5 |
| AC-5 | TC-D6 |
| AC-6 | TC-D7 |
| AC-7 | TC-D8 |
| AC-8 | TC-D9、TC-R1 |
| AC-9 | TC-D10 |
| AC-10 | TC-D1、TC-R2 |
| AC-11 | TC-B1、TC-B2 |
