# 113 · 系统返回键行为（HOS 版，tasks.md）

> 对应：`spec.md` / `plan.md` ｜ 状态：⬜
> 真机：无（跳过测试，需求注）。

- [ ] T1. `plugins/harmony-plugin-system-back/package.json`（bare 名、private、ESM、peerDeps）
- [ ] T2. `plugins/harmony-plugin-system-back/lib/index.js`（`name`/`inject:['webServer']`/`apply` → `webserver/index-inject` kind script；SEAM_JS 同 android 同源、标记 `DSH_HARMONY_SYSTEM_BACK`）
- [ ] T3. `plugins/harmony-plugin-system-back/README.md`
- [ ] T4. `src-main/main.js`：preset 行（`system-back` / `harmony-plugin-system-back`）＋ `before-input-event` 返回键拦截（`Escape`/`Backspace`/`BrowserBack`，`Escape` 不 preventDefault，审计日志）
- [ ] T5. `scripts/collect-dsh.mjs`：preset 行镜像
- [ ] T6. 装配验证：`node scripts/collect-dsh.mjs` 通过；`node --check src-main/main.js`
- [ ] T7. 代码审查（Step 3.5）＋ 文档 `[NEEDS CLARIFICATION]` 标注核对
