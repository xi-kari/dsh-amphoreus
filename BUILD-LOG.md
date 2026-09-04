# BUILD LOG

> 任务书：`../设计文档/07_建设者任务书（Codex一口气版）.md`。验收记录按 TA1–TF12 顺序追加。

## TA1 开仓：git init、清杂物、基线提交 — 2026-09-04 15:37
- commit: 76cf15d
- 验收：
  - `git -C "$PKG" log --oneline | wc -l` → `1` PASS（pipeline exit: `0 0`）
  - `git -C "$PKG" status --porcelain | wc -l` → `0` PASS（pipeline exit: `0 0`）
  - `git -C "$PKG" ls-files | grep -c "^lib/\|^node_modules/"` → `0` PASS（pipeline exit: `0 1`；grep 以 1 表示零匹配）
  - `git -C "$PKG" ls-files reference | wc -l` → `3` PASS（pipeline exit: `0 0`）
  - `test ! -f "$PKG/.pack-dry-run.json"` → `无标准输出` PASS（exit: `0`）
- 人工断言：✓ 基线提交未包含 `lib/` 或 `node_modules/`；✓ `reference/` 三个证据文件已跟踪；✓ `.pack-dry-run.json` 已物理删除。
- 偏离与理由：验收依赖首次提交已经存在，因此 TA1 的验收记录在提交后写入，并随 TA2 提交入库；TA1 自身仍只有一次基线提交。
- 遗留：无
## TA2 G17：配置键 `workbench.host` — 2026-09-04 15:38
- commit: bf71062
- 验收：
  - `grep -n "host: z.union(\['iframe', 'native'\]).default('iframe')" "$PKG/src/host/config.ts" | wc -l` → `1` PASS（pipeline exit: `0 0`）
  - `npm run typecheck` → `> dsh-amphoreus@0.1.0 typecheck`；`node node_modules/typescript/bin/tsc -p tsconfig.json --noEmit` PASS（exit: `0`）
  - `node --test tests/webapi-firstframe.test.ts` → `tests 4; pass 4; fail 0; duration_ms 317.5616` PASS（exit: `0`）
- 人工断言：✓ 全仓 `workbench: {` 仅有配置接口与测试夹具两处，二者都已补 `host`；✓ 未实现 `native` UI；✓ `cordis.patch.yml` 未改。
- 偏离与理由：首次执行 `npm run typecheck` 因调用环境 PATH 未含 Node 而输出 `'node' is not recognized`（exit 1）；按总纲 §0.4/AGENTS 构建环境将 PATH 收敛后，以同一命令复跑通过。提交短 SHA 在提交完成后回填，并随下一任务提交入库，以避免自引用哈希悖论。
- 遗留：无

## TA3 G3/G10 宿主侧：boot/effectiveConfig、工作台状态与不可投影记录 — 2026-09-04 15:48
- commit: 31c26f1
- 验收：
  - `npm run typecheck && npm test` → `tests 61; pass 60; fail 0; skipped 1; duration_ms 601.5675` PASS（exit: `0`）
  - `npm run build` → `typecheck`、`build:types`、`build:js` 全通过；`lib/client.js 59.92 kB`、`lib/index.js 158.13 kB` PASS（exit: `0`）
  - `GET /amphoreus/api/state | node …` → `{"enabled":true,"host":"iframe","defaultView":"chat","cardTextLimit":8000,"autoProjection":true} {"kind":"ready"}` PASS（pipeline exit: `0 0`）
  - `GET /amphoreus/workbench/ | grep -o '__AMPHOREUS_BOOT__={[^<]*' | grep -c '"workbench":{'` → `1` PASS（pipeline exit: `0 0 0`）
  - `GET /amphoreus/workbench/api/workspaces | grep -c '"unprojectable":\['` → `1` PASS（pipeline exit: `0 0`）
  - 临时配置 `workbench: { enabled: false }` 后重启并 `GET /amphoreus/workbench/api/workspaces` → HTTP `503`；body `{"error":"工作台已在配置中关闭（workbench.enabled=false）"}`；原因 grep → `1` PASS（exit: `0`）
  - 还原 profile 补丁后 SHA-256 → `db10860accbab96252a33c5f62106e7834d8102f8d2543b0bfb1837cb8f7c6bc` = 原哈希，重启后 state → `workbench.status={"kind":"ready"}` PASS（exit: `0`）
- 人工断言：✓ state 与 iframe 壳均透传五字段配置；✓ 503 显示真实关闭原因；✓ 临时 profile 修改已逐字节还原并再次启动；✓ `#authorize`、会话正文与 `.lock` 逻辑未改。
- 偏离与理由：验收增加了 `npm run build`，因为本任务修改宿主源码，运行态重启必须先刷新忽略的 `lib/` 产物；提交短 SHA 按既定下一提交回填规则处理。
- 遗留：无

## TA4 G3 iframe 侧：`app.js api()` 带 nonce — 2026-09-04 15:56
- commit: 2fb2ad3
- 验收：
  - `grep -c "'x-amphoreus-nonce': BOOT.nonce" workbench/app.js` → `1` PASS（exit: `0`）；全文件头名计数 → `1`；`WORKBENCH_CONFIG` 声明计数 → `1`
  - `node --check workbench/app.js` → `无标准输出` PASS（exit: `0`）
  - 无 nonce 的不存在会话 `DELETE` → HTTP `403`，body `{"error":"invalid amphoreus nonce"}` PASS（curl exit: `0`）
  - 从 state 取 nonce 后同一不存在会话 `DELETE` → HTTP `404`，body `{"error":"节点不存在"}` PASS（curl exit: `0`，已越过 403 门）
  - 浏览器实际加载 `app.js` 的 CDP 资源检查 → `bytes=110423; exactNonceMatches=1; allNonceMatches=1; sameOrigin=true; staleMessage=true` PASS
  - 浏览器 iframe 主上下文检查 → `{"bootObject":true,"noncePresent":true,"host":"iframe","exactNonceMatches":1,"sameOrigin":true}` PASS；console errors → `[]`
  - 独立工作台全体会议点击「归档此会话」并确认 → 归档按钮数 `15→11`（所选会话及三个后续卡共同隐藏），role=alert 数 `0`，console errors `[]` PASS；DSH 原会话仍保留。
- 人工断言：✓ 归档动作未出现红条且卡片从画布消失；✓ 浏览器运行时 boot 含非空 nonce；✓ 宿主重启失效文案与 `same-origin` 代码已由浏览器加载；✓ nonce 未进 URL/postMessage。
- 偏离与理由：浏览器 Network 域未在动作前成功保持监听，但卡片重渲染消失且无 alert，结合命令行 403/404 对照与浏览器已加载代码，确认写请求越过 nonce 门；提交短 SHA 按下一提交回填规则处理。
- 遗留：无

## TA5 G4：移除 iframe 双 Tab，并用 owner props 切回对话 — 2026-09-04 16:04
- commit: PENDING-TA5
- 验收：
  - `grep -c "view-switch" workbench/app.js workbench/styles.css` → `app.js:0`、`styles.css:0` PASS（两个 grep 均以零匹配退出 `1`）
  - `grep -c 'data-action="close"' workbench/app.js` → `0` PASS（exit: `1`，零匹配为预期）
  - `grep -c "'uiConversation'" src/client/index.ts` → `0` PASS（exit: `1`，零匹配为预期）
  - `grep -c "openView('chat'" src/client/workbench.tsx` → `2` PASS（exit: `0`）
  - `npm run build` → typecheck、d.ts、client/host bundle 全通过；`lib/client.js 60.57 kB`、`lib/index.js 158.13 kB` PASS（exit: `0`）
  - 刷新浏览器后官方 role=tab 文案 → `["对话","轨迹","工作台"]`；iframe `.view-switch` → `0`、`[data-action=close]` → `0` PASS
  - iframe 主上下文执行 `post('amphoreus:close')` → 官方选中 Tab 从工作台切为 `对话` PASS
  - 重新进工作台并以当前会话执行 `post('amphoreus:open-session',{sessionId:state.currentDsh.id})` → 官方选中 Tab 切为 `对话` PASS
  - 浏览器 console errors → `[]` PASS
- 人工断言：✓ iframe 顶部已无「对话／工作台」胶囊；✓ 官方 Tab 条仍完整；✓ close 协议和当前会话卡脚 open-session 均切回对话；✓ 未用 DOM 模拟点击官方 Tab。
- 偏离与理由：无；提交短 SHA 按下一提交回填规则处理。
- 遗留：无
