# 012-pnpm-integration 测试用例

> 模块：012-pnpm-integration
> 对应规格：[spec.md](./spec.md) ｜ 方案：[plan.md](./plan.md)
> Last Updated: 2026-10-02

> 分三类：**B** 构建期（Windows 可执行）、**U** 单元测试（裸 Node）、**D** 真机（`hdc`，设备 `3QC0226526001227`）。
> 真机用例前置：应用已安装并启动；`DEEPSEEK_API_KEY` 已注入；市场设置页可打开。

---

## B 构建期用例

### TC-B01: pnpm 引擎随包物化
**Priority**: P1 ｜ **Type**: Functional
**Precondition**: 同级 `../dsh-market` 存在；引擎来源可用
**Steps**:
1. 执行 `node scripts/collect-dsh.mjs`
2. 检查 `dsh-dist/node_modules/dsh-market-pnpm/lib/index.mjs`

**Expected Result**: 文件存在且非空；日志含物化成功行
**Actual Result**: ｜ **Status**:

### TC-B02: 引擎缺失时构建硬失败
**Priority**: P1 ｜ **Type**: Error Handling
**Precondition**: 模拟引擎来源缺失
**Steps**:
1. 移除/改错引擎来源
2. 执行 `node scripts/collect-dsh.mjs`

**Expected Result**: 明确报错 + 非零退出；不产出残缺部署包
**Actual Result**: ｜ **Status**:

### TC-B03: pnpm 引擎版本断言
**Priority**: P1 ｜ **Type**: Functional
**Precondition**: 引擎版本常量已定义
**Steps**:
1. 执行收集脚本
2. 观察版本断言日志

**Expected Result**: 产物版本 == 常量；不一致时 `exit(1)`
**Actual Result**: ｜ **Status**:

### TC-B04: dsh-market 版本断言
**Priority**: P1 ｜ **Type**: Functional
**Precondition**: 固定版本 1.66.7
**Steps**:
1. 执行 `collect-dsh.mjs` / `build-dsh.mjs`
2. 观察市场版本断言

**Expected Result**: 与集中常量一致才通过；否则 `exit(1)`
**Actual Result**: ｜ **Status**:

### TC-B05: 物化幂等
**Priority**: P2 ｜ **Type**: Idempotence
**Steps**:
1. 连续执行两次收集脚本

**Expected Result**: 第二次打印「已物化」并跳过，不重复拷贝
**Actual Result**: ｜ **Status**:

### TC-B06: 无 symlink/hardlink 产物
**Priority**: P1 ｜ **Type**: Security/Constraint
**Steps**:
1. 检查物化后的 `dsh-dist/node_modules/dsh-market-pnpm/**`

**Expected Result**: 无 symlink（`lstat().isSymbolicLink()` 全 false）
**Actual Result**: ｜ **Status**:

---

## U 单元测试用例（裸 Node）

### TC-U01: process.exit 拦截
**Priority**: P1 ｜ **Type**: Security
**Steps**:
1. 调用 `runPnpmInProcess`，令引擎内部触发 `process.exit`

**Expected Result**: 不退出进程；转为可捕获异常；调用后 `process.exit` 恢复原状
**Actual Result**: ｜ **Status**:

### TC-U02: process.argv 保存恢复
**Priority**: P1 ｜ **Type**: Functional
**Steps**:
1. 记录调用前 argv；执行 `runPnpmInProcess`

**Expected Result**: 调用后 argv 与调用前逐元素相同
**Actual Result**: ｜ **Status**:

### TC-U03: pnpm-workspace.yaml 幂等与保留用户键
**Priority**: P1 ｜ **Type**: Functional
**Steps**:
1. 预置含用户自定义键的 `pnpm-workspace.yaml`
2. 调用 `ensureProfilePnpmConfig`
3. 再次调用

**Expected Result**: 补齐要求的键；用户键保留；重复调用无变化
**Actual Result**: ｜ **Status**:

### TC-U04: 引擎入口校验
**Priority**: P2 ｜ **Type**: Edge Case
**Steps**:
1. 对不存在/空文件调用 `assertPnpmEngine`

**Expected Result**: 返回不可用（不抛）
**Actual Result**: ｜ **Status**:

### TC-U05: storeDir 落在沙箱内
**Priority**: P1 ｜ **Type**: Security
**Steps**:
1. 调用 `ensureProfilePnpmConfig`，检查 storeDir 取值

**Expected Result**: storeDir 位于 `$DSH_HOME`/userData 之下，非 `~/.pnpm-store`
**Actual Result**: ｜ **Status**:

---

## D 真机用例

### TC-D01: 市场一键安装纯 npm 插件
**Priority**: P1 ｜ **Type**: Functional / E2E
**Precondition**: 应用运行；已注入 API key；市场可打开；安装通道日志显示路径 B 就位
**Steps**:
1. 打开 设置 → 插件市场
2. 选一个纯 npm 插件点「安装」
3. 等待完成

**Expected Result**: 安装成功；`$DSH_HOME/profiles/desktop/node_modules/<pkg>/package.json` 出现；无 node/pnpm 子进程；市场 UI 显示成功
**Actual Result**: ｜ **Status**:

### TC-D02: 不产生 node/pnpm 子进程
**Priority**: P1 ｜ **Type**: Constraint
**Steps**:
1. 在安装进行时，经 `hdc shell` 观察进程树（`ps -ef` / `toybox ps`）

**Expected Result**: 不出现新的 node/pnpm 子进程
**Actual Result**: ｜ **Status**:

### TC-D03: 扁平 node_modules（无 symlink）
**Priority**: P1 ｜ **Type**: Constraint
**Steps**:
1. 安装完成后 `hdc shell` 检查 `node_modules/<pkg>` 与 provider

**Expected Result**: 为真实目录，非 symlink
**Actual Result**: ｜ **Status**:

### TC-D04: 插件卸载
**Priority**: P1 ｜ **Type**: Functional
**Steps**:
1. 对已装插件点「卸载」

**Expected Result**: `node_modules/<pkg>` 消失；`dsh.profile.bundles` 相应行移除
**Actual Result**: ｜ **Status**:

### TC-D05: 安装不存在/网络失败的包
**Priority**: P1 ｜ **Type**: Error Handling
**Steps**:
1. 触发一次会失败的安装

**Expected Result**: 主进程不崩溃；返回非零 exitCode + 可读 stderr；profile 可启动性不受损
**Actual Result**: ｜ **Status**:

### TC-D06: 取消安装
**Priority**: P2 ｜ **Type**: Functional
**Steps**:
1. 安装进行中取消

**Expected Result**: 操作终止且 `done` 以取消结束
**Actual Result**: ｜ **Status**:

### TC-D07: 安装后刷新生效
**Priority**: P1 ｜ **Type**: E2E
**Steps**:
1. 安装一个能立即生效的插件后刷新页面

**Expected Result**: 插件可用（不需重启，或按市场提示重启生效）
**Actual Result**: ｜ **Status**:

### TC-D08: 诊断探针可读
**Priority**: P2 ｜ **Type**: Diagnostics
**Steps**:
1. `hdc fport` + CDP 读取 `globalThis.__pnpmRuntime`

**Expected Result**: 返回引擎入口/版本/config/上次结果，字段完整
**Actual Result**: ｜ **Status**:

### TC-D09: 契约未挂载时显式可见
**Priority**: P2 ｜ **Type**: Error Handling
**Steps**:
1. `hilog | grep dsh-harmony` 查看安装通道状态

**Expected Result**: 就位/不可用均有显式日志，无静默
**Actual Result**: ｜ **Status**:

---

## 汇总

| 类别 | 数量 | P1 | P2 |
|---|---|---|---|
| B 构建期 | 6 | 5 | 1 |
| U 单元 | 5 | 4 | 1 |
| D 真机 | 9 | 6 | 3 |
| **合计** | **20** | **15** | **5** |
