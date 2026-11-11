# harmony-plugin-system-back —— 系统返回 seam（HOS · Electron on HarmonyOS 版）

> 需求：`specs/113-system-back/` ｜ 审计标记：`DSH_HARMONY_SYSTEM_BACK`

## 是什么

本工程专用 dsh 插件：经 [`webserver/index-inject`](../../../deepseek-harness/packages/client/web/src/apply-injections.ts) 下发 `kind:'script'` 页面脚本身，让系统「返回」键在 Web UI 内按上下文执行：

| 场景 | seam 行为 |
|---|---|
| 顶层弹层（设置页 / 通用对话框 / 菜单） | 派发 `Escape` → dsh `useModalLayer` 关闭最上层 |
| 窄屏侧栏抽屉展开 | 点击 `[data-sidebar-mask]` 掩膜收回（防御回退）|
| 首页 / 会话页 | 无操作（返回 `false`）|

页面只暴露 `window.__dshSystemBack(): boolean`。主进程路由见 [`src-main/main.js`](../src-main/main.js) 的 `before-input-event`（113-system-back）。

## 接线（插件 5 处落点约定，见 plugins/README.md）

1. 本目录 `harmony-plugin-system-back/`（目录名 = 包名 = `name` 导出）；
2. preset 行**双写**：
   - `src-main/main.js` → `HARMONY_ENSURED_PRESET_ROWS`：`{ id:'system-back', name:'harmony-plugin-system-back' }`
   - `scripts/collect-dsh.mjs` → 同名表镜像。
3. 编译期由 `collect-dsh.mjs` 的 `collectPlugins()` 自动物化到 `dsh-dist/node_modules/`；运行期 `ensureDshPluginsProfileLink()` 镜像到 profile 的 `node_modules/`。

## ⚠️ 待真机澄清
鸿蒙 2in1/平板上系统返回键到 Electron 窗口的确切事件形态无真机验证（本机无鸿蒙设备）。详见 `specs/113-system-back/plan.md §二`，不伪造已适配能力（宪法 C2 诚实降级）。
