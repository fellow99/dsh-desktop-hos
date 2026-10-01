# 012-pnpm-integration 任务清单

> 模块：012-pnpm-integration
> 对应规格：[spec.md](./spec.md) ｜ 方案：[plan.md](./plan.md)
> Last Updated: 2026-10-02
> 执行模式：连续执行（阶段间自动推进）

> 约定：`[P]` = 可并行；任务按阶段依赖排序。文件路径对齐工程实际结构。

## Phase 0 — Setup（可行性 spike，阻塞全部实现）

- [ ] **T0.1** 核实 `@pnpm/installing.deps-installer` 的入口、导出与调用签名（plan §12 Q1）
  - 位置：`logs/20261002-1/spike-pnpm/`（临时脚本，不入库）
  - 断言：能在裸 Node 上 `import` 成功并识别 `addDependenciesToPackage`/`removeDependenciesFromPackage`（或等价入口）
- [ ] **T0.2** 验证进程内安装产出扁平 node_modules（plan §12 Q2）
  - 断言：临时目录内 `pnpm add <小包>`（进程内）成功；`node_modules/<pkg>/package.json` 存在；无 symlink（`lstat().isSymbolicLink()===false`）
- [ ] **T0.3** 检测引擎是否 spawn 子进程 / 依赖闭包是否含原生模块（plan §12 Q3/Q4）
  - 断言：记录子进程行为与 `.node` 文件清单；据此决定是否需 aarch64 注入
- [ ] **T0.4** 回填 spike 结论到 plan.md §12 与 §3

## Phase 1 — Foundational（构建期物化与版本固定）

- [ ] **T1.1** `collect-dsh.mjs`：新增 `collectMarketPNPM()`，物化 pnpm 引擎到 `dsh-dist/node_modules/dsh-market-pnpm/`（FR-012-001/003/004）
  - 依赖：T0.*
- [ ] **T1.2** `collect-dsh.mjs`：新增 pnpm 引擎版本常量 + 构建期断言（FR-012-002）
- [ ] **T1.3** `collect-dsh.mjs`：新增 `assertDshMarketVersion()`（修 1.26.0/1.29.2/1.66.7 不一致；FR-012-002 同族 / plan R8）
- [ ] **T1.4** 修正陈旧版本声明：`README.md`、`README_zh.md`、`profiles/desktop/package.json`、`specs/201-dsh-market/*`（对齐 1.66.7）
- [ ] **T1.5** 原生模块闭包检测/注入（FR-012-005，仅当 T0.3 判定需要）

## Phase 2 — User Story 1：进程内安装/卸载引擎（P1）

- [ ] **T2.1** 新增 `src-main/pnpm-inprocess.js`：`runPnpmInProcess(args, opts)`（FR-012-010~015）
  - 含 `process.exit` 拦截、`process.argv` 保存恢复、惰性 import、`ignoreScripts`
- [ ] **T2.2** 新增 `src-main/pnpm-runtime.js`：`ensureProfilePnpmConfig(home)` 幂等写/合并 `pnpm-workspace.yaml`（FR-012-006~009）
- [ ] **T2.3** 单测 `scripts/tests/pnpm-inprocess.test.mjs`：exit/argv 防护、配置幂等与保留用户键、引擎入口校验
- [ ] **T2.4** `main.js` 接线：`setupMarketRuntime()` 之后调用 `ensureProfilePnpmConfig()`（FR-012-006）

## Phase 3 — User Story 2：市场契约对接（P1）

- [ ] **T3.1** 验证 `desktopProfiles` / `desktopPnpm` 的 cordis 注册方式（plan §12 Q5/Q6）
- [ ] **T3.2** `src-main/pnpm-runtime.js` / `main.js`：在 market mount 前注册 `desktopProfiles` + `desktopPnpm`（FR-012-016~019）
- [ ] **T3.3** `runPlugin` 句柄映射：stdout/stderr 流 + `done` + `cancel()`（FR-012-017/018）
- [ ] **T3.4** 降级/显式可见：市场未提供契约时记录且不静默（FR-012-020/021）
- [ ] **T3.5** 诊断探针 `globalThis.__pnpmRuntime`（FR-012-023）

## Phase 4 — Development 收尾

- [ ] **T4.1** 语法/单测全绿（`node --check` + `node --test`）
- [ ] **T4.2** 提交实现（Conventional Commits：`feat: ...`）

## Phase 5 — Code Review

- [ ] **T5.1** `requesting-code-review`：派发 reviewer 子agent（`flash`），产出 `REVIEW_REPORT.md`
- [ ] **T5.2** `receiving-code-review`：逐条核验、修复 Critical/Important、必要时 push back
- [ ] **T5.3** 提交修复（`fix: ...`）

## Phase 6 — Testing（构建 + 真机）

- [ ] **T6.1** 构建：`collect-runtime` → `build-dsh` → `collect-dsh` → tar → HAP
- [ ] **T6.2** 部署到真机 `3QC0226526001227`（`hdc`）；设置 `DEEPSEEK_API_KEY`
- [ ] **T6.3** 执行 [test-cases.md](./test-cases.md) 真机用例，产出 `TEST_REPORT.md`
- [ ] **T6.4** 提交测试产物（`test: ...`）

## Phase 7 — Bug Fix / Regression

- [ ] **T7.1** 修复测试暴露的缺陷（`fix: ...`）
- [ ] **T7.2** 回归重测已修复项 + 抽查通过项
- [ ] **T7.3** 最终报告

## 依赖与阻塞关系

```
T0.1─┬─T0.2─┐
     ├─T0.3─┴─→ T1.* ─→ T2.* ─→ T3.* ─→ T4.* ─→ T5.* ─→ T6.* ─→ T7.*
     └─T0.4
```

- T0.*（spike）**阻塞** T1.*（物化）与 T2.*（进程内调用）：若引擎不可进程内调用，需回到 plan D2/D3 重新选型。
- T1.* 与 T2.2 可部分并行；T3.* 须在多化完成（T1.1）与进程内引擎（T2.1）之后。

## MVP 范围

**User Story 1（Phase 2 + Phase 1）= MVP**：能把一个纯 npm 插件进程内装进 profile。Phase 3（市场契约）是其对外可用形态。
