/**
 * `harmony-plugin-system-back` —— DSH Desktop（HOS · Electron on HarmonyOS 版）系统返回 seam。
 *
 * 作用：经 dsh 一等注入口 `webserver/index-inject` 下发一条 `kind:'script'` 页面脚本身，
 * 让系统「返回」键在 Web UI 内按上下文执行（specs/113-system-back）：
 *   - 顶层弹层（设置页 / 通用对话框 / 菜单）→ 关闭；
 *   - 否则窄屏侧栏抽屉展开 → 收回；
 *   - 否则（首页 / 会话页）→ 不做任何操作。
 *
 * 与同工程 `harmony-plugin-fs-search` 等一致：纯 seam、零上游源码补丁；页面只暴露
 * `window.__dshSystemBack(): boolean`。主进程侧由 `src-main/main.js` 的
 * `before-input-event` 把返回键路由到这里（见该文件 113-system-back 说明）。
 *
 * ⚠️ `[NEEDS CLARIFICATION]`：鸿蒙 2in1/平板上系统返回键到 Electron 窗口的**确切到达形态**
 * 无真机验证（本机无设备）。本插件 + 主进程拦截实现「键盘返回键 / WebContents 后退」保守子集，
 * 待真机确认后按能力清单补齐（specs/113-system-back/plan.md §二）。
 */

/** Plugin name used by the preset row (must equal package name, 5-place convention). */
export const name = 'harmony-plugin-system-back'

/** Services required before the plugin activates: the web server's index injection seam. */
export const inject = ['webServer']

/** Audit marker: found in the injected script for reconciliation. */
export const BACK_MARKER = 'DSH_HARMONY_SYSTEM_BACK'

/**
 * Page seam script (inline string, served with index.html). No DOM-timing dependency:
 * it only defines `window.__dshSystemBack`; state is evaluated at call time.
 */
export const SEAM_JS = `/* ${BACK_MARKER}: system-back seam (settings/drawer/modal close; home/conversation no-op) */
(function () {
  'use strict';
  if (typeof window.__dshSystemBack === 'function') return;
  function topModal() {
    var nodes = document.querySelectorAll('[role="dialog"][aria-modal="true"], [role="menu"]');
    return nodes.length > 0 ? nodes[nodes.length - 1] : null;
  }
  function drawerOpen() {
    var frame = document.querySelector('[data-sidebar-drawer]');
    if (!frame) return false;
    var center = frame.querySelector('[class*="_centerCol"]');
    var sidebar = frame.querySelector('[class*="_sidebarCol"]');
    return !!center && center.hasAttribute('inert') && !!sidebar && !sidebar.hasAttribute('inert');
  }
  function closeTopModal() {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    return true;
  }
  function closeDrawer() {
    var mask = document.querySelector('[data-sidebar-mask]');
    if (mask) mask.click();
    return true;
  }
  function systemBack() {
    if (topModal()) return closeTopModal();
    if (drawerOpen()) return closeDrawer();
    return false;
  }
  window.__dshSystemBack = systemBack;
})();
`

/**
 * Install the injection: push the seam as a `script` row into the index.html injection table.
 * @param {import('@deepseek-ai/cordis').Context} ctx - plugin context with the `webServer` service.
 * @returns {void}
 */
export function apply(ctx) {
  ctx.on('webserver/index-inject', (table) => {
    table.push({ kind: 'script', placement: 'head', text: SEAM_JS })
  })
}
