# 113 · 系统返回键行为（HOS · Electron on HarmonyOS 版，spec.md）

> 状态：⬜ Planned（规格化）｜ 依据：需求 `113-system-back`（2026-11-11）
> 源码落点：`plugins/harmony-plugin-system-back/`、`src-main/main.js`、`scripts/collect-dsh.mjs`、`profiles/desktop/`（无改动，仅说明）
> 宪法：C2 诚实降级 / C3 证据纪律 / C5 零补丁（上游源码）——seam 走 `webserver/index-inject` 一级注入口，新增插件不打上游补丁。

## 一、问题陈述

HOS 是在鸿蒙 2in1/平板（API 24）上通过 Electron 37 运行官方未改动的 dsh Web UI。「系统返回」在 Electron 桌面窗口中的到达机制**平台差异大且本机无真机**：

- 现状：`src-main/main.js` 无任何返回处理；Electron BrowserWindow 的 WebContents 不设 back 拦截；
- 若系统返回以「浏览器后退」形态进入 → 会让 WebContents 后退（可能离开 dsh SPA / 重新触发导航）；
- 若以键盘事件进入 → 无处理。

期望行为（与三壳一致）：
| 场景 | 行为 |
|---|---|
| 设置页 | 退出设置页 |
| 抽屉 | 收回抽屉 |
| 弹窗 | 关闭弹窗 |
| 首页 / 会话页 | 不做任何操作 |

> ⚠️ `[NEEDS CLARIFICATION]`：鸿蒙 2in1/平板上系统返回键具体以何种事件到达 Electron 窗口（键盘 key / WebContents 导航 / 桌面关闭），**无真机无法验证**。本文按最可能的两类（键盘返回键 + WebContents 后退）实现，交付后待真机确认定制点。详见 plan.md §二。

## 二、决策：载荷是否修改？补丁还是插件？

**需要修改载荷，采用「插件」方式（新增本工程专用插件 `harmony-plugin-system-back`）。**

- seam 与 Android/ARK 完全同源（顶层弹层 → Escape；抽屉 → 掩膜点击；否则无操作），只是注入宿主不同；
- HOS 插件约定（plugins/README.md）：本工程专用插件放 `plugins/harmony-plugin-*`，`webServer` 服务由 profile 提供；`webserver/index-inject` 为官方注入机制（`kind:'script'`，见 `packages/client/web/src/apply-injections.ts`）；
- 不新增补丁：避免扩大既有 13 处补丁面；用语义选择器抗上游重建（同 harmony-plugin-fs-search 的"纯 seam"风格）。

## 三、功能需求

### FR-113-5 · 载荷 seam 注入（插件 `harmony-plugin-system-back`）
- 新增 `plugins/harmony-plugin-system-back/`：
  - `package.json`：`name=harmony-plugin-system-back`、private、type module、main `lib/index.js`、peerDeps（cordis 等）；
  - `lib/index.js`：`export const name='harmony-plugin-system-back'`、`export const inject=['webServer']`、`apply(ctx)` → `ctx.on('webserver/index-inject', table => table.push({ kind:'script', placement:'head', text: SEAM_JS }))`；
  - SEAM_JS 与 Android/ARK 同构（幂等暴露 `window.__dshSystemBack(): boolean`；文档序语义选择器；审计标记 `DSH_HARMONY_SYSTEM_BACK`）。
- preset 行（**双写**，插件约定：漏一处即为会话创建失败）：
  - `src-main/main.js` `HARMONY_ENSURED_PRESET_ROWS`：`{ id:'system-back', name:'harmony-plugin-system-back', reason:'HarmonyOS: 系统返回 seam（设置/抽屉/弹窗关闭，首页/会话无操作；零补丁 index-inject 注入）' }`
  - `scripts/collect-dsh.mjs` 同名表镜像。

### FR-113-6 · 主进程返回拦截（src-main/main.js）
- `win.webContents.on('before-input-event')`：识别 HarmonyOS 返回键（键盘 `Escape`/`Backspace`/`BrowserBack` 等），
  - 若命中：`webContents.executeJavaScript('window.__dshSystemBack ? window.__dshSystemBack() : false')`；
  - **对 `Escape` 不 `preventDefault`**：dsh UI 本身已用 Escape 关闭弹层，避免破坏其原生快捷键语义（仅当判定为返回键时路由到 seam 的抽屉分支可替代原生行为——见 plan §二 定制点）；
- `webContents.on('will-navigate')`：既有外部导航守卫已拦非本机源；补充不因返回触发离开 SPA（见 FR-113-7）。
- 策略为 **best-effort**，如实标注 `[NEEDS CLARIFICATION]`，不伪造已适配能力（宪法 C2）。

### FR-113-7 · 返回不退出语义
- 首页/会话页：seam 返回 false → 主进程不做任何事（窗口保持、不退出、不使用 webContents 后退）；
- 不拦截窗口 `close`/关闭按钮（桌面窗口正常关闭语义保留）。

## 四、验收与测试
- 本机无鸿蒙真机 → **跳过真机测试**（按需求注）；验收以「代码审查 + 编译/装配通过 + Android 同 seam 的 L1 证据」为准；
- 门禁：`node scripts/collect-dsh.mjs` 成功（preset 行解析、插件物化）；`node src-main/main.js` 语法/require 检查；
- `[NEEDS CLARIFICATION]` 的返回键到达机制留待真机补充与「能力清单」如实标注。

## 五、边界
- 仅新增返回 seam 与主进程拦截；不改窗口管理、托盘、外部导航守卫、13 处既有补丁。
