# 013-branding 技术方案（As-Built）

> 本文档记录 `dsh-desktop-hos` 品牌化的实际实现。
> Module: 013-branding
> 对应规格: [spec.md](./spec.md)
> Last Updated: 2026-11-01

## 1. 技术上下文

### 1.1 运行环境

- HarmonyOS 6.1.0.135（API 24）2in1 / tablet。
- Electron-on-HarmonyOS 37 / Node 22.17.0（`harmonypc-electron`）。
- ArkTS / ArkUI Stage 模型 + `web_engine` HAR。
- 上游 dsh `dsh-v0.2.1-rc.2`，patch 目录 `patches/dsh-v0.2.1-rc.2/`。

### 1.2 依赖与物料

| 项 | 来源 | 用途 |
|----|------|------|
| `assets/logo-1024-with-bg.png` | 父工程 `assets/` | 应用图标/启动图标/通用图标/产品 logo（不透明） |
| `assets/logo.png` | 父工程 `assets/` | 窗口图标、状态栏图标（透明） |
| `dsh-rebrand.patch` | 本工程 `patches/dsh-v0.2.1-rc.2/` | 替换 Web UI 品牌位 |
| `dsh-disable-welcome-notice.patch` | 同上 | 关闭首次引导自动弹窗 |

## 2. 宪法合规

| 原则 | 状态 | 说明 |
|------|------|------|
| 零上游改动 | ⚠️ Partial | Electron 版通过 patch 修改上游 locale/组件；属既有 13 patch 策略，不是 fork |
| 源码即真理 | ✅ | 字符串/图标/patch 均来自实际文件 |
| 幂等构建 | ✅ | patch 已应用则 reverse-check 跳过 |
| 安全 | ✅ | 品牌物料为公开资源，无敏感信息 |
| 证据优先 | ✅ | 品牌位以真机截图/界面文本为判据 |

## 3. 研究结论

- HarmonyOS 应用图标（`app.json5` 的 `icon` 与 `app_icon`/`startIcon`/`icon`/`product_logo_32`）必须使用不透明底，应用市场不接受透明图层。
- 窗口图标（ability icon）与状态栏图标可使用透明底；本工程新增 `$media:window_icon` 并由 `electron/src/main/module.json5` 的 ability `icon` 引用，`app.json5` 仍保持不透明 `app_icon`。
- Web UI 品牌位写死在上游 locale 与 `EmptyHero.tsx` 中，没有官方槽位；Electron 版选择 patch 替换（与 Ark 版的零补丁 seam 路线相反）。
- 首次引导（预览提示 + DeepSeek 首次配置）是上游 `settings.onboarding` 行；通过 patch 移除注册，能力仍可从设置进入。

## 4. 数据模型

无新增数据实体；仅静态资源、字符串与 patch。

| 类型 | 说明 |
|------|------|
| 文件覆盖 | 父工程 logo → `AppScope/resources/base/media/*` |
| 字符串 | `app_name`、`EntryAbility_label`、`main.js` 标题 |
| patch | `dsh-rebrand.patch`、`dsh-disable-welcome-notice.patch` |

## 5. 接口契约

### 5.1 HarmonyOS 资源

| 文件 | 变更 |
|------|------|
| `AppScope/app.json5` | `icon: $media:app_icon`、`label: $string:app_name` |
| `AppScope/resources/base/element/string.json` | `app_name = DSH Desktop` |
| `AppScope/resources/base/media/app_icon.png` | 不透明 logo |
| `AppScope/resources/base/media/startIcon.png` | 不透明 logo |
| `AppScope/resources/base/media/icon.png` | 不透明 logo |
| `AppScope/resources/base/media/product_logo_32.png` | 不透明 logo |
| `AppScope/resources/base/media/window_icon.png` | 透明 logo |
| `electron/src/main/resources/base/element/string.json` | `EntryAbility_label = DSH Desktop` |
| `electron/src/main/resources/en_US/element/string.json` | 同上 |
| `electron/src/main/resources/zh_CN/element/string.json` | 同上 |

### 5.2 Electron 主进程

| 文件 | 变更 |
|------|------|
| `src-main/main.js` | loading 页 `<title>`/`.title`、窗口标题、about 标题 → `DSH Desktop` |
| `web_engine/src/main/resources/resfile/resources/app/main.js` | 打包副本同步 |
| `web_engine/.../resfile/resources/app/electron_white.png` | 状态栏图标（透明） |

### 5.3 上游 patch

| patch | 目标 | 行为 |
|-------|------|------|
| `dsh-rebrand.patch` | `packages/client/locale/src/locales/{en,zh}.ts` | `brand.localBuild` → `DSH Desktop` |
| 同上 | `packages/client/ui-conversation/src/client/locales.ts` | `hero.headline` 中英文 → `DSH Desktop` |
| 同上 | `packages/client/ui-conversation/src/client/skeleton/EmptyHero.tsx` | hero 品牌图标替换为本产品 logo |
| `dsh-disable-welcome-notice.patch` | `ui-settings-models/src/client/index.ts` 等 | 移除 welcome-notice / deepseek onboarding 注册 |

## 6. 实现策略

### 6.1 架构模式

“资源覆盖 + 字符串替换 + 上游 patch”：HarmonyOS 侧覆盖 PNG 与字符串；Web 侧通过 patch 修改上游品牌字符串/组件。

### 6.2 关键实现

- 应用图标：直接覆盖 PNG 字节，保持 `$media:` 引用不变。
- 窗口图标：新增 `window_icon.png`，由 `electron/src/main/module.json5` 的 ability `icon` 引用。
- 状态栏图标：覆盖 `electron_white.png` 并列入 `OVERLAY_FILES`。
- in-app 标题：`src-main/main.js` 多处字符串统一；打包副本同步。
- Web 品牌位：patch 精确锚点替换；升级 dsh tag 时按漂移情况重锚。

### 6.3 错误处理

- patch 应用幂等：`git apply --reverse --check` 已应用则跳过；锚点漂移则构建失败并提示。
- 图标缺失：构建期由物料复制脚本大声失败，避免残缺产物。

### 6.4 性能

图标为 KB–MB 级静态资源，对启动无显著影响。

## 7. 测试考虑

- 真机桌面名称/图标截图。
- 窗口图标、状态栏图标观察。
- Web UI 侧栏/hero 品牌位文本与 logo（中英文）。
- 首次启动无自动弹窗；设置中仍可打开。
- patch reverse-check 与升级 tag 后的重锚回归。

## 8. 文件清单

| 文件 | 用途 |
|------|------|
| `AppScope/app.json5` | 应用身份/图标引用 |
| `AppScope/resources/base/element/string.json` | `app_name` |
| `AppScope/resources/base/media/*.png` | 应用/启动/窗口图标 |
| `electron/src/main/resources/*/element/string.json` | `EntryAbility_label` |
| `src-main/main.js` | in-app 标题 |
| `patches/dsh-v0.2.1-rc.2/dsh-rebrand.patch` | Web 品牌位 |
| `patches/dsh-v0.2.1-rc.2/dsh-disable-welcome-notice.patch` | 首次引导 |
