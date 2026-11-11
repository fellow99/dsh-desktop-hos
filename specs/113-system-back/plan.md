# 113 · 系统返回键行为（HOS 版，plan.md）

> 对应：`spec.md` ｜ 状态：⬜ Planned

## 一、方案要点

1. **插件 `harmony-plugin-system-back`**
   - `plugins/harmony-plugin-system-back/{package.json, lib/index.js, README.md}`；
   - `lib/index.js` 内联 SEAM_JS（从 android seam 同源复制，改标记前缀）；
   - preset 行双写 `src-main/main.js` 与 `scripts/collect-dsh.mjs`（`HARMONY_ENSURED_PRESET_ROWS`）。
2. **主进程拦截**（`src-main/main.js` `app.whenReady()` 窗口创建处）
   - 装 `before-input-event`：返回键（`Escape`/`Backspace`/`BrowserBack` 白名单）→ `executeJavaScript('__dshSystemBack()')`；`Escape` 不 preventDefault（保持 dsh 原生关闭语义）；
   - 审计日志前缀 `[dsh-harmony]`。
3. **构建/装配验证**：`node scripts/collect-dsh.mjs`（preset 行解析 → 插件物化到 dsh-dist）；Node `--check` 语法校验。
4. **真机**：无设备，跳过；文档 `[NEEDS CLARIFICATION]` 待真机。

## 二、`[NEEDS CLARIFICATION]` 定制点（无真机确认前，明确标注）

Electron-on-鸿蒙中系统返回的实际到达形态未知，可能为：
1. **键盘 key**（`Escape`/`Backspace`/厂商自定义 `BrowserBack` 等）→ `before-input-event` 已覆盖；
2. **WebContents 后退**（OS 触发 `goBack` 语义）→ 通过 `did-navigate`/`will-navigate` 观察，返回键分支拦截；
3. **窗口关闭/最小化**（鸿蒙桌面 back 直接关窗）→ 本轮**不**拦截窗口 close（避免破坏正常关闭），若真机证实 back=关窗，再按需求把「首页/会话不退出」改为「阻止 window close 并路由 seam」。

交付口径：实现 1 + 2 的保守子集，其余在文档与「鸿蒙环境能力清单」如实标注"待真机"。

## 三、改动文件清单

| 文件 | 动作 |
|---|---|
| `plugins/harmony-plugin-system-back/package.json` | 新增 |
| `plugins/harmony-plugin-system-back/lib/index.js` | 新增（host 半边 + SEAM_JS 内联）|
| `plugins/harmony-plugin-system-back/README.md` | 新增 |
| `src-main/main.js` | preset 行 + `before-input-event` 拦截 |
| `scripts/collect-dsh.mjs` | preset 行镜像 |
