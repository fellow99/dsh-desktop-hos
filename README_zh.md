[English](./README.md) | 中文

# DSH Desktop · Electron on HarmonyOS Edition

> **Electron on HarmonyOS Edition** —— 官方 DeepSeek Harness（DSH）Web UI，**零改动**，通过 Electron 37 跑在鸿蒙 2in1 / 平板上：这是一个真正的 Electron 应用，而不是把界面用 ArkUI 重写一遍。鸿蒙端的另一个 edition 是 [HarmonyOS Edition](https://github.com/fellow99/dsh-desktop-ark)：完全不含 Electron —— 系统 ArkWeb + 进程内 Node 运行时。

<p align="center">
  <img src="docs/images/home-light.png" alt="DSH Desktop（Electron on HarmonyOS Edition）——官方 dsh Web UI 的新会话页" width="100%">
</p>
<p align="center"><sub><b>真机实拍，不是效果图</b> —— HarmonyOS 6.1.0.135（API 24），2in1。界面就是官方 dsh Web UI，由进程内 dsh Host 同源加载。</sub></p>

<p align="center">
  <img src="https://img.shields.io/badge/release-0.2.1-4D6BFE" alt="版本">
  <img src="https://img.shields.io/badge/dsh-dsh--v0.2.1--rc.2-7C5CFF" alt="dsh 版本">
  <img src="https://img.shields.io/badge/HarmonyOS-API%2024-0A59F7" alt="HarmonyOS API 24">
  <img src="https://img.shields.io/badge/Electron-37-47848F" alt="Electron 37">
  <img src="https://img.shields.io/badge/license-MIT-2EA44F" alt="MIT">
</p>

**状态** `0.2.1`（`versionCode` 1009）—— 已构建并签名。核心链路（对话、Agent 循环、工具调用、会话持久化、插件市场、窗口状态）的 HarmonyOS 6.1.0.135（API 24）真机验证是在 **0.2.0** 上完成的；**0.2.1** 尚未重新做真机验证（目前仅验证构建与签名）。先把分发现实说清楚：**debug 签名的 HAP 绑定签名账号/设备**，**release 签名的包只能经 AppGallery 分发** —— 见[怎么获取](#怎么获取)。

## 为什么这条路线不一样

把 DSH 搬到鸿蒙不止一条路，取舍本身就是这个仓库的全部内容：

| | 本工程（Electron 路线） | 原生宿主路线（Node 运行时 + ArkUI 宿主） |
|---|---|---|
| 界面 | **官方 Web UI，逐字节复用**，界面零重写 | 同一份 Web 内容外面套原生宿主，平台外壳需重写 |
| 与桌面端一致性 | 语义完全一致：同一渲染器、同一套 Node API、同一条数据面 | 观感好，但宿主层是重实现，必须持续跟上游 |
| 运行时权限 | 需要 ACL 受限权限 `ohos.permission.kernel.ALLOW_WRITABLE_CODE_MEMORY`（JIT）——**仅 2in1 / 平板** | 无 JIT，因此不需要该权限 |
| 设备覆盖 | 鸿蒙 2in1 / 平板 | 可延伸到手机 |

两者不存在谁更好，只是优化目标不同。本工程存在的意义是把 Electron 路线端到端跑通——包括它撞到的每一处沙箱冲突。另外两个 edition 共用同一套外壳架构与同一条数据面：[dsh-desktop](https://github.com/fellow99/dsh-desktop)（Windows / Linux / macOS），以及 [dsh-desktop-ark](https://github.com/fellow99/dsh-desktop-ark) 的 **HarmonyOS Edition**（系统 ArkWeb + 进程内 Node 运行时，不用 Electron）。

## 现在能用的

| 能力 | 状态 |
|---|---|
| dsh Web UI 在窗口内运行（100% 复用 dsh 前端） | ✅ |
| 会话持久化 + 全文检索（`better-sqlite3`，aarch64 ABI 138） | ✅ |
| 插件市场（内置 `dshmarket`） | ✅ |
| 窗口状态记忆（最大化 / 位置尺寸）+ F11 全屏 | ✅ |
| 命令执行：非 PTY 的常驻 `/system/bin/sh`，哨兵行协议驱动，工具层路径围栏 | ✅ ⚠️ 围栏是 **best-effort，可被绕过，不是沙箱** |
| 图片附件：`sharp` 由纯 JS 容器头解析替代，做不了的转换经 ArkTS 桥交给平台图像框架（解码 / EXIF / 缩放 / 重编码） | ⚠️ 干净的 8-bit sRGB 文件按字节原样通过；取不到桥时每次转换都如实拒绝；无缩略图 |
| 随包自带 Node / pnpm / Python 运行时 | ⛔ **不可实现** —— 分发 ELF 需要二进制证书（AGC `certType: 4`），华为不授予个人开发者。用户自行在系统终端安装 `pnpm` 属**可选依赖，绝不作产品能力宣传** |
| 进程沙箱（`koffi` / landlock） | ❌ 不在范围内 |

### 限制的具体原因

- **命令执行。** 上游 `tool-bash` 行保持 disabled：`node-pty` 无 aarch64 产物，且 PTY 被 SELinux 拒绝。替代方案是常驻 `/system/bin/sh` + 哨兵行读取；路径围栏在工具层，**设计上就是可绕过的**。
- **自带运行时。** 应用已能在 `PATH` 上看到 `/data/service/hnp/bin`，那里有结构校验通过的 `node`，只缺 `pnpm`。用户在**系统终端**装好 `pnpm` 后（symlink 禁令仅限应用域，故**不得**在应用内安装），市场 `probePnpm()` 即通过，插件安装/卸载可用。其余能力都不依赖自带运行时：命令执行 spawn 系统自带 `sh`/`toybox`，文件 / 搜索 / 技能 / 子 agent / workflow / 图片均为纯 JS。分析见 [`docs/鸿蒙环境能力清单-v0.1.5.md`](docs/鸿蒙环境能力清单-v0.1.5.md) §C.8。
- **图片。** stub 解析 PNG/JPEG/GIF/WebP 容器头；无法自行完成的转换交给 ArkTS 桥（解码、EXIF 方向、缩放、重编码为 JPEG/WebP/PNG）。限额内且本就干净的 8-bit sRGB 输入按字节原样通过、零转换成本。取不到桥时（纯 Node），每次转换都如实拒绝并注明边界。无缩略图。

二期被评估后**主动放弃**：无边框窗口（把窗口控制移进渲染层，代价与收益不成比例）与开机自启（`autoStartupManager` 只有只读查询）。系统托盘已交付——状态栏图标 + 右键菜单。

## 界面

| | 浅色 | 深色 |
|---|---|---|
| **Agent 对话** —— 工具调用、会话轨迹、模型与缓存遥测 | <img src="docs/images/chat-light.png" width="420" alt="Agent 对话，浅色"> | <img src="docs/images/chat-dark.png" width="420" alt="Agent 对话，深色"> |
| **设置** —— 模型、插件、Agent 预设、插件市场、外观 | <img src="docs/images/settings-light.png" width="420" alt="设置，浅色"> | <img src="docs/images/settings-dark.png" width="420" alt="设置，深色"> |

## 怎么获取

三条路，按省事程度排序：

1. **AppGallery（计划中）。** release 签名的 App Pack 只能从应用市场安装。上架被两件事卡住：ACL 受限权限（约 3 个工作日审核，仅中国大陆开发者账号）与 AI 合规三件套（算法备案 / 大模型登记 / 安全评估）。见[维护者指南](docs/构建签名与上架-zh.md)。
2. **自己构建** —— 目前唯一受支持的路径。四阶段后本地出 HAP：`collect-runtime → build-dsh → collect-dsh → tar`，再跑 `scripts/build-debug.ps1`。见[维护者指南](docs/构建签名与上架-zh.md)。环境要求：DevEco Studio 4.0+、HarmonyOS SDK API 17+（targetSdk 6.1.1(24)）、Node 18+、pnpm@11、HDC。
3. **用自己的账号重签一个 debug 包。** debug profile 绑定设备，别人的 debug HAP 装不到你的机器上；在 DevEco（`File → Project Structure → Signing Configs`）重新生成 profile 后重建即可。见[维护者指南](docs/构建签名与上架-zh.md)。

> ⚠️ 对**release** 签名包执行 `hdc app install` 会失败：`code:9568322 ... not trusted app source`。真机回归请用 `-BuildMode release -SignMode debug`。

## 兼容矩阵

| 外壳版本 | dsh（上游 tag） | 运行时 | 设备 / API | 验证程度 |
|---|---|---|---|---|
| `0.2.1` · `versionCode` 1009 | `dsh-v0.2.1-rc.2` | Electron 37 / Node 22.17.0（`harmonypc-electron`） | HarmonyOS 6.1.0.135 · API 24 · 2in1 / 平板 | 已构建并签名；真机复验待做（0.2.0 已验证） |

`versionCode` 必须为数字，且每次向 AppGallery 提交都必须**严格递增**。上游 dsh 处于 developer preview：一个外壳钉一个 tag，`patches/<dsh-tag>/` 随之迁移。

## 架构

设备上只有一个进程、一个源：Electron 主进程**承载 dsh Host**（webserver + API + WebSocket），窗口从它加载标准 dsh Web UI —— 没有 CORS、没有鉴权、没有自定义协议、没有额外 IPC 通道。

```
EntryAbility（ArkTS）→ Electron-on-HarmonyOS → 主进程（Node 22.17）
  └─ dsh Host：webserver 绑 0.0.0.0:<port> · apiProxy · connection
  └─ 窗口：未修改的 dsh Web UI，同源加载该端口
```

让它跑起来的三处鸿蒙适配：**回环隔离**（绑通配地址，再在会话内把 `Host`/`Origin` 改回回环）、**无符号链接/硬链接**（profile 用复制发布、原子写用同目录 `rename`）、**`HOME` 重定向**到沙箱。由于监听的是通配地址，请把它当作单用户本地应用，不要在不可信网络上使用。补丁清单、安全说明与完整论证见[维护者指南](docs/构建签名与上架.md)。

## 技术栈

- **Electron-on-HarmonyOS** 运行时（[`harmonypc-electron`](https://atomgit.com/jianguoxu/harmonypc-electron)）—— Electron 37 / Node 22.17.0
- **ArkTS / ArkUI**（Stage 模型）+ `web_engine` 桥接 HAR
- 上游 [`deepseek-harness`](https://github.com/deepseek-ai/deepseek-harness) 锁定 `dsh-v0.2.1-rc.2`；本壳的补丁在 `patches/dsh-v0.2.1-rc.2/`

## 构建、签名与安装

前置：DevEco Studio 4.0+ 或 Command Line Tools、HarmonyOS SDK API 17+（target 6.1.1 / API 24）、Node 18+、pnpm、`hdc`。

```
node scripts/collect-runtime.mjs    # ⓪ 同步运行时并重新施加应用定制
node scripts/build-dsh.mjs          # ① 应用 13 个补丁，构建 dsh + dsh-market
node scripts/collect-dsh.mjs        # ② 物化 dsh-dist
powershell scripts\build-debug.ps1  # ③ 构建 + 签名 HAP
hdc app install -r entry/build/default/outputs/default/entry-default-signed.hap
```

签名材料不入库（`signing.<mode>.local.json`，已 gitignore）。正式签名、受限权限（ACL）、应用市场上架、真机调试与四阶段管线见[维护者指南](docs/构建签名与上架.md)。

## 目录结构

本工程与 3 个被消费工程、1 个架构参考工程**同级目录**存放（非 submodule）：

```
（同级目录）
├── dsh-desktop-hos/      # 本工程（鸿蒙 HAP，桌面版鸿蒙移植）
│   ├── AppScope/                  # 应用 scope（图标/名称/签名）
│   ├── electron/                  # 入口模块（copy 自 harmonypc-electron，含 SO）
│   ├── web_engine/                # 桥接 HAR（ArkTS 桥接层 + resfile 承载 dsh 产物）
│   ├── src-main/                  # 主进程 main.js（解压 + runProfile + loadURL + 鸿蒙适配）
│   ├── scripts/                   # 四阶段构建：collect-runtime → build-dsh → collect-dsh，外加 build-debug / build-release
│   ├── runtime-overlays/          # 每次运行时 copy 后重新施加的应用定制（prune + overlay）
│   ├── profiles/desktop/          # 自定义 desktop profile（cordis.patch.yml + package.json）
│   ├── patches/                   # dsh 上游 patch（14 个）
│   ├── docs/                      # 工程规划与最终实现记录
│   ├── plugins/                   # 本工程专用插件（harmony-plugin-XXX；编译期打入 HAP，运行期全部默认加载）
│   ├── skills/                    # 本工程专用工具技能（功能性 kebab-case、无前缀；随 HAP 分发，作为 bundled 技能根提供）
│   └── specs/                     # 规范文档（as-built；见 specs/README.md 索引）
│
├── harmonypc-electron/            # Electron-on-HarmonyOS 运行时（Electron 37 / Node 22.17.0）
│   └── ohos_hap/                  # electron + web_engine 模块 + SO 源（collect-runtime copy 源）
│
├── deepseek-harness/              # 被封装宿主（dsh，源码引用，非 submodule）
│   ├── apps/                      # cli（dsh bin / profile-boot）、web（前端，build:web 产 dist）
│   ├── packages/                  # host / client / core / session 等 workspace 包
│   ├── vendor/                    # vendored cordis 框架包（cordis / loader / hmr / …）
│   └── native/                    # landlock-run 原生模块（Linux 沙箱，MVP 裁掉）
│
└── dsh-market/                    # 插件市场（源码引用，npm 包 dshmarket）
    ├── src/                       # host 半（挂 /dsh-market/* 路由）
    ├── client/                    # 浏览器半（设置页 UI）
    ├── lib/                       # 编译产物（物化进 dsh-dist/node_modules/dshmarket）
    └── cordis.patch.yml           # loader insert 声明（{ id: dsh-market, name: dshmarket }）
```

> `../dsh-desktop` 为**架构设计参考**（复用其架构决策 + patch + 主进程编排逻辑），不参与本工程构建/打包。

## 相关文档

- [docs/鸿蒙环境能力清单-0.2.1.md](docs/鸿蒙环境能力清单-0.2.1.md) —— 0.2.1 能力清单：本版能做什么、不能做什么，以及与 ArkWeb 版的对标
- [docs/构建签名与上架.md](docs/构建签名与上架.md) —— 维护者指南：架构、技术栈、构建阶段、签名、真机调试、应用市场上架
- [docs/工程规划.md](docs/工程规划.md) —— 完整工程规划 + 最终实现记录（Electron 37 落地、关键适配改动、MVP 取舍、交叉编译优化路径）
- [specs/README.md](specs/README.md) — 规范文档索引（项目级 + 9 模块 spec/plan，as-built）

## 参考资料

- [deepseek-harness](https://github.com/deepseek-ai/deepseek-harness)（同级目录 `../deepseek-harness`）—— 被封装宿主；其 `docs/` 目录含完整架构文档
- [dsh-market](https://github.com/dsh-market/dsh-market)（同级目录 `../dsh-market`）—— 内置插件市场（npm 包 `dshmarket`），经 `collect-dsh.mjs` 物化
- [harmonypc-electron](https://atomgit.com/jianguoxu/harmonypc-electron)（同级目录 `../harmonypc-electron`）—— Electron-on-HarmonyOS 运行时
- [dsh-desktop](https://github.com/fellow99/dsh-desktop)（同级目录 `../dsh-desktop`）—— 架构设计参考（Electron 桌面壳）
- [dsh-desktop-ark](https://github.com/fellow99/dsh-desktop-ark)（同级目录 `../dsh-desktop-ark`）—— **HarmonyOS Edition**：同一个 dsh Host 跑在 `ohos-node-bridge`（进程内 Node v24.2.0）上，由系统 ArkWeb 渲染，不含 Electron
- [DSH Desktop 官网](https://fellow99.github.io/dsh-desktop-website/) —— 各 edition 的说明、真机实拍与架构讲解

## 许可证

[MIT](LICENSE) © 2026 fellow99
