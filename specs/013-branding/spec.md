# 品牌化 功能规格

> Module: 013-branding
> Status: Implemented（as-built；Web 品牌位经 `dsh-rebrand` patch）
> Last Updated: 2026-11-01

## 1. 模块概述

### 1.1 目的（Why this module exists）

本模块定义 `dsh-desktop-hos`（Electron on HarmonyOS Edition）的产品身份：应用名、应用图标、启动图标、窗口图标、状态栏图标、in-app 标题，以及 dsh Web UI 内部的品牌位（侧栏品牌名、会话空态 hero 标语/图标）。

### 1.2 解决的问题

- HarmonyOS 应用默认显示名为 “Electron” / “DeepSeek Harness”，不符合产品命名。
- 应用图标为占位图；应用市场要求应用图标使用不透明底色，不能带透明通道。
- 上游 Web UI 显示 “DSH Local Build” / “DSH 本地构建” 与上游鱼形 logo，与本产品身份不一致。
- 首次启动可能出现上游预览提示与 DeepSeek 首次配置弹窗（由 `dsh-disable-welcome-notice` patch 处理，属品牌体验的一部分）。

### 1.3 范围

**包含：**

- 应用名 `DSH Desktop`（AppScope `app_name` + 三 locale `EntryAbility_label`）。
- HarmonyOS 应用图标/启动图标/通用图标/产品 logo（不透明底）。
- 窗口图标（透明底，`window_icon`）与状态栏（托盘）图标（透明底）。
- in-app 标题（loading 页、窗口标题、about 等）。
- Web UI 品牌位：`brand.localBuild` 中英文、`hero.headline` 中英文、hero 品牌图标（`dsh-rebrand` patch）。
- 首次引导自动弹窗关闭（`dsh-disable-welcome-notice` patch；与本模块同一产品体验目标）。

**不包含：**

- 应用包名、签名、版本号（属 `108-compliance-release`）。
- 应用商店 listing 文案、宣传图。
- 上游源码的结构性改造（仅通过既有 patch 替换品牌字符串/组件）。

## 2. 用户故事

- 作为用户，我希望 HarmonyOS 桌面上应用名称是 “DSH Desktop”，图标是本产品 logo。
- 作为用户，我打开应用后看到的是本产品品牌（侧栏、hero、窗口标题），而不是上游 “DSH Local Build” / 鱼形 logo。
- 作为用户，我不希望第一次打开就被上游预览提示与 DeepSeek 首次配置弹窗拦住；需要时仍可从设置进入。
- 作为维护者，我希望换 logo/改产品名只改固定物料与字符串，不碰业务逻辑。

## 3. 功能需求

### 3.1 应用身份

- FR-013-001：`AppScope/resources/base/element/string.json` 的 `app_name` MUST 为 `DSH Desktop`。
- FR-013-002：`electron/src/main/resources/{base,en_US,zh_CN}/element/string.json` 的 `EntryAbility_label` MUST 为 `DSH Desktop`。
- FR-013-003：`src-main/main.js` 中 loading 页标题、页面内标题、窗口标题、about 标题 MUST 为 `DSH Desktop`。
- FR-013-004：应用 `bundleName`、`versionName`、`versionCode` MUST 由 `108-compliance-release` 管理，本模块不修改。

### 3.2 HarmonyOS 图标

- FR-013-005：`app_icon.png`、`startIcon.png`、`icon.png`、`product_logo_32.png` MUST 使用不透明底物料 `logo-1024-with-bg.png`（应用市场要求）。
- FR-013-006：窗口图标 `window_icon.png` MUST 使用透明底物料 `logo.png`，并由 `electron/src/main/module.json5` 的 ability `icon` 引用。
- FR-013-007：状态栏（托盘）图标 `web_engine/.../resfile/resources/app/electron_white.png` MUST 使用透明底 logo，并列入 `OVERLAY_FILES`。
- FR-013-008：物料 MUST 以父工程 `assets/` 为唯一来源，以复制/覆盖方式分发，不修改物料源。

### 3.3 Web UI 品牌位（`dsh-rebrand` patch）

- FR-013-009：`brand.localBuild` 的中英文文案 MUST 替换为 `DSH Desktop`。
- FR-013-010：`hero.headline` 的中英文文案 MUST 替换为 `DSH Desktop`，且 hero 品牌图标 MUST 使用本产品 logo（替换上游鱼形图标）。
- FR-013-011：品牌位替换 MUST 通过 `patches/<dsh-tag>/dsh-rebrand.patch` 幂等应用，不直接修改上游工作树。
- FR-013-012：`dsh-disable-welcome-notice.patch` MUST 关闭上游预览提示与 DeepSeek 首次配置的自动弹窗；能力本身 MUST 保留（用户可从设置显式进入）。

### 3.4 一致性

- FR-013-013：应用名、窗口标题、Web UI 侧栏/hero 品牌名 MUST 一致为 `DSH Desktop`。
- FR-013-014：品牌物料更新 MUST 按固定文件名覆盖；代码/配置引用路径 MUST 不变。

## 4. 关键实体

| 实体 | 说明 | 关键属性 |
|------|------|----------|
| 应用身份 | HarmonyOS 应用名 | `app_name`、`EntryAbility_label` |
| 应用图标 | 不透明底 | `app_icon`、`startIcon`、`icon`、`product_logo_32` |
| 窗口/状态栏图标 | 透明底 | `window_icon`、`electron_white` |
| Web 品牌位 | 上游 locale/组件 | `brand.localBuild`、`hero.headline`、hero logo |
| 首次引导 | 自动弹窗 | 预览提示、DeepSeek 首次配置 |

## 5. 验收场景

### 场景：HarmonyOS 桌面名称与图标

- Given 编译并部署到真机
- When 查看系统桌面
- Then 应用名为 `DSH Desktop`，图标为产品 logo（不透明底）

### 场景：窗口与状态栏图标

- Given 应用启动
- When 观察窗口图标与状态栏图标
- Then 窗口图标为透明底 logo，状态栏图标为白色/透明 logo

### 场景：Web UI 品牌位

- Given 应用加载 dsh Web UI
- When 查看侧栏与会话空态
- Then 品牌名为 `DSH Desktop`，hero 显示产品名与产品 logo，不显示上游 “DSH Local Build”/鱼形 logo

### 场景：首次引导

- Given 首次启动
- When 进入主界面
- Then 预览提示与 DeepSeek 首次配置不自动弹出；设置中仍可显式打开

## 6. 非功能需求

- **合规**：应用图标必须不透明底；窗口/状态栏图标可透明。
- **可维护性**：品牌物料与字符串集中，换品牌只改固定文件。
- **可重复构建**：`dsh-rebrand` / `dsh-disable-welcome-notice` patch 必须幂等（已应用则跳过）。
- **证据**：品牌位结论以真机截图/界面文本为准。

## 7. 假设与约束

- 假设上游 `brand.localBuild` / `hero.headline` / `EmptyHero` 结构在锁定的 dsh tag 上稳定；升级 tag 需重做 patch 锚点。
- 约束：不 fork 上游；只通过 patch 替换品牌字符串与组件。
- 约束：不改动应用包名与签名材料。

## 8. 依赖

- 物料：父工程 `assets/`。
- patch：`patches/dsh-v0.2.1-rc.2/dsh-rebrand.patch`、`dsh-disable-welcome-notice.patch`。
- 上游：`deepseek-harness` `dsh-v0.2.1-rc.2`。
- 下游：`111-build-pipeline`（应用 patch）、`108-compliance-release`（包名/签名/版本）。
