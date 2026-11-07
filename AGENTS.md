# AGENTS.md — dsh-desktop-hos（Electron on HarmonyOS Edition）AI Agent 工作规范

> 本文件定义了本项目（`dsh-desktop-hos`，DSH Desktop Electron on HarmonyOS Edition）中 AI Agent 必须遵守的规范和工作流程。
> 所有规范均基于本机实际已安装的技能（skills）编写，不含虚构内容。
> 总则见 `~/.agents/AGENTS.md`；工作区总纲见上级 `../AGENTS.md`；本文件为项目级规范，冲突时以本文件为准。

---

## 一、项目背景（必读）

**DSH Desktop · Electron on HarmonyOS Edition** — 在鸿蒙 2in1 / 平板（API 24）上通过 **Electron 37** 运行官方未改动的 dsh Web UI，是真正的 Electron 应用，而非 ArkUI 重写界面。

- **版本**：0.2.2（`versionCode` 1100）｜ 上游基线 `dsh-v0.2.2-rc.1` ｜ Electron 37 / Node 22.17.0（`../harmonypc-electron`）
- **运行时权限**：需 ACL 受限权限 `ohos.permission.kernel.ALLOW_WRITABLE_CODE_MEMORY`（JIT）—— **2in1 / 平板专用**
- **适配方式**：13 处 dsh 上游源码补丁（`patches/dsh-v0.2.2-rc.1/`）+ 三项鸿蒙适配（loopback 隔离、无软/硬链接、`HOME` 重定向进沙箱）

### 运行模型（单进程、单源）
```
EntryAbility (ArkTS) → Electron-on-HarmonyOS → main process (Node 22.17)
  └─ dsh Host: webserver on 0.0.0.0:<port> · apiProxy · connection
  └─ window: 官方未改动 dsh Web UI，同源加载
```

### 关键能力边界（必须如实标注，不伪造）
| 能力 | 状态 |
|---|---|
| dsh Web UI / 会话持久化 / 全文字搜索（better-sqlite3） | ✅ |
| 插件市场（`dshmarket` 内置；pnpm 10.34.6 进程内引擎） | ✅ |
| 命令执行（非 PTY 常驻 `/system/bin/sh`，哨兵行协议 + 工具层路径围栏） | ✅ ⚠️ 围栏 best-effort 可绕过，**非沙箱** |
| 图片附件（sharp 替换为纯 JS 容器解析 + ArkTS 桥转换） | ⚠️ 无桥可达时全部明确拒绝 |
| 打包自有 Node/Python ELF | ⛔ 不可能（需二进制证书，个体开发者不授予） |
| 进程沙箱（koffi / landlock） | ❌ 超出范围 |

### 仓库结构
| 路径 | 内容 |
|---|---|
| `AppScope/` | 应用级配置（图标/名称/签名） |
| `electron/` | Entry 模块（从 harmonypc-electron 拷贝，含 SO） |
| `web_engine/` | 桥 HAR（ArkTS 桥层 + 承载 dsh 产物） |
| `src-main/` | 主进程 main.js（extract + runProfile + loadURL + 鸿蒙适配） |
| `scripts/` | 四段构建：`collect-runtime → build-dsh → collect-dsh`，及 `build-debug` |
| `runtime-overlays/` | 每次运行时拷贝后重放的定制（prune + overlay） |
| `profiles/desktop/` | 自定义 desktop profile |
| `patches/dsh-v0.2.2-rc.1/` | dsh 上游 13 处补丁 |
| `plugins/` | 本工程自有插件（`harmony-plugin-XXX`，全部默认加载） |
| `skills/` | 本工程自有工具技能（kebab-case，随 HAP 内置） |
| `specs/` | as-built 规格（013、101–108、110–112、114–115、117、201、202） |
| `docs/` | 维护指南 `构建签名与上架.md`、工程规划、能力清单 |

### 关键文档
- `docs/构建签名与上架.md`（架构、构建四阶段、签名、真机调试、AppGallery 上架）——**签名材料本地文件不入库**
- `docs/鸿蒙环境能力清单-0.2.1.md`（能力清单）
- `specs/README.md`（规格索引）

---

## 二、代码地图（CodeGraph）规范 ——【核心】

### 2.1 已建索引
本项目已初始化 `.codegraph/` 代码地图（~274 文件 / ~4,527 节点）。**探索代码必须优先使用 `codegraph-cli`**。

### 2.2 索引自动更新（post-commit 钩子）——【强制】
- 本工程 git **`post-commit` 钩子**已安装：每次 commit 后自动 `codegraph sync` 增量更新 `.codegraph/`。
- 钩子非阻塞、失败只写日志（`logs/codegraph-sync.log`）。Agent 也应在大规模变更后手动 `codegraph sync`。

### 2.3 命令速查
| 场景 | 命令 |
|---|---|
| 探索功能区域 | `codegraph context "<任务描述>"` |
| 查找符号定义 | `codegraph query <符号名>` |
| 变更影响范围 | `codegraph impact <符号名>` |
| 索引状态 / 增量更新 | `codegraph status` / `codegraph sync` |

---

## 三、鸿蒙开发规范（强制使用鸿蒙技能）

- **鸿蒙应用开发**（ArkTS / ArkUI / Stage 模型 / 代码审查 / 安全审计）→ 只用 **`harmonyos-app-dev`**。
- **鸿蒙设备/模拟器操作与测试**（`hdc`、`uitest`、`hilog`、安装 `.hap`、启动、截图）→ 只用 **`harmonyos-app-testing`**。
- 两者互斥，不得混用。

---

## 四、通用规范

### 4.1 语言
- 与用户交互、编写文档、提交注释使用**中文**；代码、变量、技术术语使用**英文**。

### 4.2 安全
- **严禁**提交签名凭据、密钥、Token、口令哈希等敏感信息（`signing.*.local.json` 等须 gitignore）。
- 严禁用 `as any` / `@ts-ignore` / `@ts-expect-error` 压制类型错误；严禁空 `catch(e) {}`。

### 4.3 代码质量
- 编辑后运行 `lsp_diagnostics` 检查无新增错误；修复 Bug 只做最小改动；禁止凭空猜测未读取代码行为。

---

## 五、Git 提交规范（强制使用 `git-commit` 技能）

- 提交前先加载 **`git-commit`** 技能；提交注释**必须**用 [Conventional Commits](https://www.conventionalcommits.org/) 格式 `<type>[optional scope]: <description>`。
- 仅允许 type：`feat` / `fix` / `docs` / `style` / `refactor` / `perf` / `test` / `build` / `ci` / `chore` / `revert`。
- 本工程是**子模块**：本工程内提交后，须回到**父工程**提交新的子模块指针。
- **严禁** `--no-verify` 跳过 Git Hooks（除非用户明确要求）。

---

## 六、开发与质量流程规范

- 遵循工作区 `specs-based-devflow` 完整生命周期；规格化走 speckit 技能链；调试用 `systematic-debugging`；审查用 `requesting-code-review` / `receiving-code-review`。
- **构建四阶段**：`collect-runtime → build-dsh → collect-dsh`，然后 `powershell scripts\build-debug.ps1` 出 HAP，`hdc app install` 部署。
- 每项能力须对照 `docs/鸿蒙环境能力清单-0.2.1.md` **如实标注**（✅ / ⚠️ / ❌ / ⛔），**不伪造能力**；命令执行围栏必须注明「best-effort 可绕过，非沙箱」。

---

## 七、技能自检与快速索引

| 任务类型 | 必备技能 |
|---|---|
| Git 提交 | `git-commit` |
| 代码库探索 / 代码地图 | `codegraph-cli` |
| 鸿蒙应用开发 | `harmonyos-app-dev` |
| 鸿蒙应用测试/自动化 | `harmonyos-app-testing` |
| 开发任务（全流程） | `specs-based-devflow` |
| 代码审查 | `requesting-code-review` / `receiving-code-review` |
| 调试 | `systematic-debugging` |
| 产品/需求规划 | `brainstorming` |

---

## 八、违规处理

违反以上任何规范，Agent 必须立即停止、向用户报告、等待指示后再继续。

---

> **最后更新**：2026-11-02
> **维护者**：fellow99
