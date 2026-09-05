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
- commit: 630a930
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

## TA6 G9：`defaultView` 播种与记住 Tab — 2026-09-04 16:18
- commit: 6821dc1
- 验收：
  - 动手前 `sed -n '215,230p' …/packages/client/store/src/index.ts` → 看见 `create(scopeKey?: string)`、`persistKey = … ${decl.persist}.` 与 `createSnapshotStore(...persist:{name:persistKey})` PASS（exit: `0`）
  - `node --test tests/client-tabmemory.test.ts` → `tests 8; pass 8; fail 0; skipped 0; duration_ms 123.1042` PASS（exit: `0`）
  - `npm run typecheck` → 无诊断 PASS（exit: `0`）
  - `npm run build` → typecheck、d.ts、client/host bundle 全通过；`lib/client.js 63.59 kB`、`lib/index.js 158.13 kB` PASS（exit: `0`）
  - 静态锚点：Tab 键名字面量计数 `1`；`seedConversationView(localStorage` 计数 `2`；测试 `"view":null` 计数 `1` PASS
  - 手动 1：S1 切工作台后 localStorage remembered → `amphoreus-workbench`；新建并发送 S2 后官方选中 Tab → `工作台`，其 `dsh.conversation.<S2>` → `{"draft":"","view":"amphoreus-workbench","viewRequest":null}` PASS
  - 手动 2：S2 切回对话后 remembered → `chat`；新建并发送 S3 后官方选中 Tab → `对话` PASS
  - 手动 3：清 remembered，临时 `workbench.defaultView=workbench` 并重启；原 `view:null` 的 S3 自动选中 `工作台` 且偏好只填 view；已有 `chat` 与 `trajectory` 字符串偏好保持原值 PASS
  - 还原 profile 补丁 → SHA-256 `db10860accbab96252a33c5f62106e7834d8102f8d2543b0bfb1837cb8f7c6bc` 与原哈希一致；重启后 state `defaultView=chat`，刷新仍按 remembered `chat` 选中对话 PASS
- 人工断言：✓ 工作台记忆跨会话生效；✓ 用户切回对话后不再强推；✓ `view:null` 被填而草稿/其余字段保留；✓ 字符串偏好绝不覆盖；✓ 临时 profile 已逐字节还原。
- 偏离与理由：为得到可观察的未渲染 S2/S3，会话中发送了两条隔离测试消息；提交短 SHA 按下一提交回填规则处理。
- 遗留：无

## TA7 G10：禁用态隐藏 Tab、设置工作台面板、标记不可投影 — 2026-09-04 16:29
- commit: e355f00
- 验收：
  - `npm run typecheck && npm run build` → typecheck、d.ts、client/host bundle 全通过；`lib/client.js 69.10 kB`、`lib/index.js 158.13 kB` PASS（exit: `0`）
  - `node --check workbench/app.js` → `无标准输出` PASS（exit: `0`）
  - 静态：`aria-labelledby="amphoreus-workbench"` → `1`；`wb.enabled ?` → `1`；`if (workbenchEnabled)` → `2`；`card-unprojectable`（app+css）→ `2` PASS
  - 正常设置页工作台面板 → 状态 `已启用`、承载 `iframe`、默认视图 `对话`、正文上限 `8000`、不可投影 `00` PASS
  - 临时 `workbench.enabled=false` 并重启 → role=tab 从三项减为 `2`（对话/轨迹）；设置状态 `已在配置中关闭（workbench.enabled=false）`；「打开画布工作台」链接不存在 PASS
  - disabled 验证后 profile SHA-256 还原为 `db10860accbab96252a33c5f62106e7834d8102f8d2543b0bfb1837cb8f7c6bc`，重启成功 PASS
  - 将工作台数据临时替换为 `{"version":2}` 后重启 → state `status.kind=unavailable` 且原因含 `unexpected workbench data version`；workspaces API → HTTP `503` 同原因 PASS
  - 浏览器设置页显示 `不可用：workbench.json 读取失败…` 与不可投影 `01`；工作台 Tab 红条显示同一原因 PASS
  - 清除损坏夹具并恢复原数据 → SHA-256 `c56fd725de669f73d68f291d6870b431c8db6664b02fa0614d59d216f970b390`、`191522` bytes；重启后 state → `{"status":{"kind":"ready"},"unprojectable":[]}` PASS
- 人工断言：✓ disabled 时 Tab 和外链都消失；✓ native 仅提示不改变行为；✓ 不可用真实原因同时出现在设置页和 iframe；✓ 未增加暗色选择器，三处新增画布色均保留 token 回退；✓ 临时配置/数据全部恢复。
- 偏离与理由：验收后未丢弃原有测试投影数据；先移除损坏夹具，再逐字节恢复原文件，兼顾任务语义与可回滚性。提交短 SHA 按下一提交回填规则处理。
- 遗留：无

## TA8 G18：设置、README 与 mark.svg 补齐署名 — 2026-09-04 16:31
- commit: 7800184
- 验收：
  - `sed -n 2p workbench/mark.svg | grep -c dsh-synapse` → `1` PASS（exit: `0`）
  - `grep -c '^## 致谢' README.md` → `1` PASS（exit: `0`）
  - `grep -c "'settings.credit'" src/client/locales.ts` → `2` PASS（zh/en 各一）
  - `npm run typecheck && npm run build` → typecheck、d.ts、client/host bundle 全通过；`lib/client.js 70.22 kB`、`lib/index.js 158.13 kB` PASS（exit: `0`）
  - `curl …/workbench/mark.svg -w '%{content_type}'` → `image/svg+xml; charset=utf-8` PASS（exit: `0`）
  - 浏览器直接打开 `/amphoreus/workbench/mark.svg` → AX 树含唯一 `image`，图形正常渲染 PASS
  - 设置页底部 → 灰字 `工作台源自 dsh-synapse v0.4.1（MIT，liangmianya）…` 与 `github.com/liangmianya/dsh-synapse` 链接均可见 PASS
- 人工断言：✓ 设置区署名位于内容栅格之后；✓ README 致谢固定三条齐全；✓ SVG 第 2 行为 vendoring 注释且 path 未改；✓ NOTICE 版权行未改。
- 偏离与理由：实现先在隔离 worktree 验证，再以 `cherry-pick --no-commit` 三方合并到 TA7 后主线并重新构建/浏览器验收；提交短 SHA 按下一提交回填规则处理。
- 遗留：无

## TA9 README 真实化 + HANDOFF 顶部过时声明 — 2026-09-04 16:32
- commit: b1eac50
- 验收：
  - `grep -c '骨架阶段' README.md` → `0` PASS（exit: `1`，零匹配为预期）
  - `grep -c 'workbench.host\|host' README.md` → `1` PASS（exit: `0`）
  - `grep -c '## 致谢\|## 配置\|## 已知限制\|## 现状' README.md` → `4` PASS（exit: `0`）
  - `sed -n 3p HANDOFF.md | grep -c '2026-09-04 更新'` → `1` PASS（exit: `0`）
  - `[ "$(sed -n 4p HANDOFF.md)" = '' ]` → `无标准输出` PASS（exit: `0`）
  - `sed -n 5p HANDOFF.md | grep -c '^> 给接手建设的 AI'` → `1` PASS（exit: `0`）
  - README 禁用措辞 `DeepSeek 官方|官方插件` → `0` PASS；四条已知限制、要求的配置键与审计差距编号齐全。
  - `git diff --cached --check` → `无输出` PASS（exit: `0`）；HANDOFF diff 仅新增第 3–4 行，原文零删除。
- 人工断言：✓ README 反映 A 章当时真实能力与未完成 G 项；✓ 开发/安装/边界/致谢结构完整；✓ HANDOFF 旧内容全部保留，新引用块与原引用块以空行隔开。
- 偏离与理由：实现先在含 TA8 的隔离 worktree 完成，再以 `cherry-pick --no-commit` 合入主线；提交短 SHA 按下一提交回填规则处理。
- 遗留：无

## TA10 G20：HANDOFF §7 M1 原样接入事后核对 — 2026-09-04 16:33
- commit: a0efa5a
- 验收：
  - `grep -c dsh-synapse profile/web/package.json profile/web/pnpm-lock.yaml` → 两行均 `:0` PASS（grep exit: `1`，零匹配为预期）
  - iframe 消息取证 → `activate-session 3; bridge-error 1; create-session 1; created-session 1; current-session 3; fork-session 1; forked-session 1; live-reply 1; map-opened 1; map-ready 1; message-sent 1; open-session 2; request-current 1; send-message 3; theme 1; workspaces 1`（空名忽略）PASS
  - 宿主页消息取证 → `activate-session 1; bridge-error 1; close 2; create-session 2; created-session 1; current-session 2; fork-session 1; forked-session 1; map-opened 2; map-ready 1; message-sent 1; open-session 2; request-current 1; send-message 1` PASS
  - `grep -c '^## 7' HANDOFF.md` → `1`；`synapse:close|amphoreus:close` 行数 → `2` PASS
  - 消息对照表 → `17` 行；状态白名单外 → `0`；五个 localStorage 键误入 → `0` PASS
  - `git diff --cached --check` → `无输出` PASS（exit: `0`）；`reference/` 零改动。
  - 替代运行态证据：`/amphoreus/workbench/` 已返回 `200`；浏览器 `conversation.view` 内 iframe 加载、门户 `13` 席、画布/详情/检查器均可用 PASS
- 人工断言：✓ §7 明确记录原版未装、M1 被 vendoring 替代；✓ 工作/未接线/本章修复/后续章口径按实时 grep 填；✓ 结论不要求回装原包。
- 偏离与理由：TA10 先在隔离 worktree取证并成稿，再以 `cherry-pick --no-commit` 合入含 TA9 顶部引用的主线后重新跑实时取证；提交短 SHA 按下一提交回填规则处理。
- 遗留：无

## TA11 收尾：构建、重启、浏览器回归、逐任务提交 — 2026-09-04 16:38
- commit: 34d859e
- 验收：
  - `npm run typecheck && npm test && npm run build` → `tests 69; pass 68; fail 0; skipped 1; duration_ms 687.6891`；typecheck/d.ts/bundles 全通过，`lib/client.js 70.22 kB`、`lib/index.js 158.28 kB` PASS（exit: `0`）
  - `Stop-DeepSeekHarness.ps1` → `STATUS=stopped`；`Start-DeepSeekHarness.ps1` → `STATUS=started; HTTP_STATUS=200` PASS（均 exit: `0`）
  - `git log --oneline | wc -l` → `11` PASS；`git status --porcelain | wc -l` → `0` PASS
  - 浏览器回归 ①：官方工作台 Tab 可打开；门户显示全体会议 + `13` 席；进入阿格莱雅席后显示其独立空画布 PASS
  - 浏览器回归 ②：独立工作台确认归档 TA6-S2 测试会话，相关卡数 `4→2`、role=alert `0`，DSH 原会话保留 PASS
  - 浏览器回归 ③：当前 TA6-S3 卡脚「DSH」按钮把官方选中 Tab 从工作台切到 `对话` PASS
  - 浏览器回归 ④：TA6 已实测工作台记忆与未渲染 S2/S3 切换；A 章终态保持同一代码与测试 `8/8` PASS
  - 浏览器回归 ⑤：设置页有「工作台」面板与底部 dsh-synapse MIT 署名/链接 PASS
  - 浏览器回归 ⑥：新建干净浏览器页进入工作台后 console errors → `[]` PASS
  - 浏览器回归 ⑦：`.runtime/deepseek-harness.stderr.log` → `0` bytes，`amphoreus` 错误行 `0` PASS
  - 项目记忆追加 → `2026-09-04 A 章完成：git 已开仓；G3/G4/G9/G10/G17/G18/G20 落地；决策 A-1/A-2 见任务书 A.0。` PASS
- 人工断言：✓ A 章七项浏览器回归全部完成；✓ 服务终态运行；✓ 临时配置与损坏数据夹具均已恢复；✓ 干净新页无 console 错误。
- 偏离与理由：评审发现 TA3 在 `WorkbenchStore.ready()` 完成前短暂误报 ready 的竞态；TA11 将初始化态先标为 unavailable，ready resolve 后才切 ready，消除首请求可能 500 的窗口。提交 SHA 与 post-commit Git 计数随章末提交回填。
- 遗留：无
## A 章完成定义 — 2026-09-04 16:42
- A-DoD-1 → `test -d .git` = exit `0` PASS
- A-DoD-2 → `git status --porcelain | wc -l` = `0` PASS
- A-DoD-3 → `git log --oneline | wc -l` = `12`（≥10）PASS
- A-DoD-4 → 跟踪的 `lib/|node_modules/|pack-dry-run` = `0` PASS
- A-DoD-4b → `.pack-dry-run.json` 不存在，exit `0` PASS
- A-DoD-5 → workbench host schema 默认值锚点 = `1` PASS
- A-DoD-6 → workbench host 类型锚点 = `1` PASS
- A-DoD-7 → `'x-amphoreus-nonce': BOOT.nonce` = `1` PASS
- A-DoD-8 → `workbenchPage(boot: WorkbenchBoot)` = `1` PASS
- A-DoD-9 → app/css `view-switch` 合计 = `0` PASS
- A-DoD-10 → `openView('chat'` = `2`（≥2）PASS
- A-DoD-11 → index 注入数组中的 `'uiConversation'` = `0` PASS（A 章阶段门；B 后由 J-2 改为 1）
- A-DoD-12 → `tabmemory.ts` 与对应测试均存在，exit `0` PASS
- A-DoD-13 → Tab 记忆键锚点 = `1` PASS
- A-DoD-14 → `seedConversationView(localStorage` = `2` PASS
- A-DoD-14b → 测试 `"view":null` = `1` PASS
- A-DoD-15 → `if (workbenchEnabled)` = `2` PASS
- A-DoD-16 → 首次运行字面锚点 = `2` FAIL；正确语义在 state 与 iframe boot 各需一处。修复提交 `754825b` 将 boot 调用先赋 `workbenchConfig` 再传入；复跑字面锚点 = `1` PASS，两个通道仍实测有完整五字段。
- A-DoD-17 → `markUnprojectable` = `2` PASS
- A-DoD-18 → `settings.workbenchUnprojectable` = `4` PASS
- A-DoD-18b → 设置面板 aria 锚点 = `1` PASS
- A-DoD-18c → `wb.enabled ?` = `1` PASS
- A-DoD-19 → app/css `card-unprojectable` 合计 = `2` PASS
- A-DoD-20 → mark.svg 第 2 行 `dsh-synapse` = `1` PASS
- A-DoD-21 → settings.tsx `settings.credit` = `1` PASS
- A-DoD-22 → README `## 致谢` = `1` PASS
- A-DoD-23 → README `骨架阶段` = `0` PASS
- A-DoD-24 → HANDOFF `## 7` = `1` PASS
- A-DoD-25 → HANDOFF 第 3 行更新块 = `1` PASS
- A-DoD-25b → HANDOFF 第 4 行为空，exit `0` PASS
- A-DoD-26 → `npm run typecheck && npm test && npm run build` exit `0`；`tests 69 / pass 68 / fail 0 / skipped 1`；bundle `client 70.22 kB`、`host 158.32 kB` PASS
- A-DoD-27 → state ready 结构 grep = `1` PASS
- A-DoD-28 → iframe boot enabled 结构 grep = `1` PASS
- A-DoD-29 → 无 nonce DELETE = HTTP `403` PASS
- A-DoD-29b → 有 nonce DELETE 不存在会话 = HTTP `404` PASS
- A-DoD-30 → 浏览器确认归档后卡片从画布消失且无 `invalid amphoreus nonce` 红条 PASS
- A-DoD-31 → iframe 内 `.view-switch`/close 控件均为 `0`，官方三 Tab 保留 PASS
- A-DoD-32 → 当前会话卡脚「DSH」点击后官方选中 Tab = `对话` PASS
- A-DoD-33 → S1 工作台记忆使未渲染 S2 直接落工作台；S2 回对话后 S3 保持对话；`view:null`/defaultView 与草稿保留由浏览器+8项单测覆盖 PASS
- A-DoD-34 → 设置页有「工作台」面板、状态/承载/默认视图/上限/不可投影计数及底部 MIT 署名 PASS
- 人工总览：✓ 干净浏览器页工作台门户 13 席；✓ 阿格莱雅席可进入；✓ console errors `[]`；✓ stderr `0` bytes。
- 偏离与理由：A-DoD-16 的任务书字面计数与 TA3 两处必要调用冲突，已用等价局部变量消除重复字面量并复跑全门通过；TA3 readiness 竞态也在 TA11 修正为 resolve 后才宣告 ready。
- 遗留：无
## TB1 G1：注入消息不成卡 — 2026-09-04 16:49
- commit: 393c2a1
- 验收：
  - `node --test tests/workbench-projection.test.ts` → `tests 1; pass 1; fail 0; skipped 0; duration_ms 128.1887` PASS（exit: `0`）
  - `npm run typecheck` → 无诊断 PASS（exit: `0`）
  - `grep -n 'titleFromText\|noteProjection\|isRuntimeContextText\|cancelled\|canceled' src/host/workbench.ts` → `无输出` PASS（grep exit: `1`，零匹配为预期）
  - `git diff --check` → `无空白错误` PASS（exit: `0`）
- 人工断言：✓ 普通 `source.kind=user` 与无 source 旧消息保留；✓ skill-invocation/skill-catalog/plugin 过滤；✓ 无 source 的 system-reminder/skill-content/runtime-context 回退过滤；✓ 仅 error/aborted/interrupted 成错误；✓ 首条用户正文不再生标题。
- 偏离与理由：TB2 尚未替换旧 WorkbenchStore，本任务按任务书将其过渡期消息正文置空；下一任务改为纯结构索引后该旧路径整体删除。提交短 SHA 按下一提交回填规则处理。
- 遗留：无
## TB2 G8/G16：`WorkbenchStore` → 内存 `ProjectionIndex` — 2026-09-04 17:09
- commit: aec4611
- 验收：
  - 动手前 `grep -n global src/host/seats.ts` → `global` 构造位于 111 行且 112 行 `...currentGlobal`，新增字段会保留 PASS（exit: `0`）
  - 动手前 `grep -n 'interface SessionStorageMetadata' -A 8 …/session-persistence/src/index.ts` → `meta`、`inheritedEventCount` 字段位于 34/36 行，`SessionInspection` 继承该结构 PASS（exit: `0`）
  - `node --test tests/workbench-projection.test.ts tests/store-seats.test.ts` → `tests 9; pass 9; fail 0; skipped 0; duration_ms 1039.7173` PASS（exit: `0`）
  - `grep -rn 'workbench.json\|acquireLock\|\.lock\|writeFile\|rename(' src/host/workbench.ts` → `无输出` PASS（grep exit: `1`）
  - `grep -n "'sessionPersistence'" src/index.ts` → `1` 行（inject）PASS
  - `firstLiveSeq` 与旧 `WorkbenchStore/projectSession/projectEvents/createSeatResolver` 符号 → `0`；`amphoreus` 与 `amphoreus_canvas` 域 version 均保持 `1` PASS
  - 运行态（旧文件不再生成、磁盘 N、冷/活索引数量及未点开旧会话卡）：``DSH_HOME/amphoreus`` 中 ``workbench.json*`` = ``0``；磁盘非空会话目录 ``N=13``；无浏览器连接重启后 index 六次稳定为 ``revision=1, sessions=13, sessionsWithCards=11, cards=19, containsText=false``，其中未点开的冷会话已有 cards；stderr 投影/cold replay 异常 ``0`` PASS（由 TB3 路由与修复提交 ``9b7150b`` 落地后实测）
- 人工断言：✓ 索引无 text/preview/snippet/arguments/result 字段；✓ 根、冷 fork、live fork 重放与幂等锁定；✓ 隐藏级联写 domain global 并同步刷新 revision；✓ 800ms 通知合并；✓ J-13 四方法保留且变化可通知。
- 偏离与理由：TB2 指定文件重写后，尚待 TB3 修改的 `webapi.ts` 仍导入旧 `WorkbenchStore`，故阶段性 `npm run typecheck` 仅报 `TS2305` 1 项（exit `2`）；TB2 自带验收未要求 typecheck。其运行态命令又依赖 TB3 才新增的 `/api/index` 路由，因此在 TB3 实现、构建、重启后回填实测结果。提交短 SHA按下一提交回填规则处理。
- 遗留：仅上述 TB3 顺序依赖；无代码遗留。
## TB3 G8/G14/G16：索引路由、SSE、state 与 prefs — 2026-09-04 17:28
- commit: a6ece87
- 验收：
  - `npm run typecheck && npm test && npm run build` → typecheck 恢复；`tests 77; pass 76; fail 0; skipped 1; duration_ms 1332.5523`；client `70.22 kB`、host `147.46 kB` PASS（exit: `0`）
  - `GET /amphoreus/workbench/api/index` → `revision=1, sessions=13, sessionsWithCards=11, cards=19`；前 600 字含稳定 `sessionId/cards/userSeq/assistantSeq/toolCallIds`，`"text"` 与 `"arguments"` 计数均 `0` PASS
  - 旧 `GET /amphoreus/workbench/api/workspaces` → HTTP `404` PASS
  - SSE 初帧 → `event: snapshot`；会话追加消息后收到 `event: workbench-change`，载荷 revision `4`/`5` 且 sessionIds 为变更会话 PASS（800ms 合并窗内到达）
  - index ETag → `"wb-5"`；相同 `If-None-Match` → HTTP `304`；单会话 GET → `200`；不存在 GET → `404` PASS
  - 不存在会话 DELETE：无 nonce → `403`；有 nonce → `404`，未被 GET method 门挡成 405 PASS
  - `GET /amphoreus/api/prefs` → `{"lastSeat":null,"wallpaperCursor":0,"quickPhrases":[]}`；state → `seatDirs=13`，prefs 三键齐全，workbench 五字段齐全 PASS
  - 静态：`WorkbenchStore`/`heroVisualOf`/旧 api workspaces/threads → `0`；`PrefsInput` 定义 `1`；唯一 `/amphoreus/api/prefs` 分支 `1`；README `不经宿主路由` 与 NOTICE `in-memory seq index` 各存在 PASS
  - `git diff --check` → `无输出` PASS（exit: `0`）
- 人工断言：✓ 新 API 只暴露 seq 索引；✓ cold/live 会话均进入索引；✓ 旧正文路由 404；✓ SSE 先 snapshot 后 workbench-change；✓ prefs 合并不覆盖其他全局字段。
- 偏离与理由：TB2 复核发现并发 hidden/global 写覆盖、后到子会话逃逸、冷重放游离、listener 反向破坏写结果与脏 ETag 风险；修复提交 `9b7150b` 引入全局串行 read-modify-write、hide 串行/祖先隐藏、冷任务 abort+await、观察者隔离，并在 GET 建立 flush 边界。TB3 提交短 SHA 按下一提交回填规则处理。
- 遗留：无
## TB4 G14：宿主页发送 `amphoreus:workspaces` — 2026-09-04 17:41
- commit: 0cb4a3c
- 验收：
  - `npm run typecheck && npm test && npm run build` → `tests 77; pass 76; fail 0; skipped 1`；client `74.18 kB`、host `147.46 kB` PASS（exit: `0`）
  - 静态：index `'uiConversation'` = `1`；workbench.tsx 发送 `amphoreus:workspaces` = `1`；组件 `ctx` = `0`；ui-chat 值导入 = `0` PASS
  - iframe 安装消息监听并重发 `amphoreus:map-ready` → 捕获一帧 workspaces：`seats=13, sessions=12, assetsConfigured=true` PASS
  - 首会话载荷 → `{id,title,parentId,cwd,running,blank,skillName:null,face:null}` 全字段存在；首席位载荷含 heroId/skillName/dir/职责/序号/四颜色/三类编码素材 URL PASS
  - iframe 内新建并发送 TB4-PUSH 会话 → 增量帧最终 `sessions=13`，新增记录 `title=TB4-PUSH,cwd=…/deepseek-harness-dev,running=false,blank=false,skillName=null,face=null` PASS
  - `git diff --check` → `无输出` PASS（exit: `0`）
- 人工断言：✓ map-ready 后立即首发；✓ 会话从空白变非空后进入推送；✓ skillName/face 即使无绑定也显式为 null；✓ 席位/会话元数据只由宿主页状态源组装；✓ 组件未接触 ctx。
- 偏离与理由：任务书把 `grep workbench/api/workspaces` 明确标为 TB6 后联合验收；当前 iframe 的旧轮询仍有 `3` 处并产生过渡期 404 红条，但独立监听确认 TB4 推送链已工作。新增会话使用工作台桥生成，未自动切换当前会话，符合既有 INV。提交短 SHA按下一提交回填规则处理。
- 遗留：TB6 删除 iframe 旧轮询后清除过渡期 404；本任务无其他遗留。
## TB5 G6/G8：宿主页喂入正文与 live 文本 — 2026-09-04 18:03
- commit: 8bb7f19
- 动手前契约核对：
  - `sed -n '60,105p' client/ui-chat/src/client/contract/snapshot.ts` → `ChatSnapshot.legacy={nodes,turnTimings,turnEnds,partial,runningCalls}` 且 `nodes: ChatNodeStore` PASS
  - `grep -n 'interface PartialAssistant' -A 6 …/records.ts` → `{turn,step,blocks}` PASS
  - `sed -n '40,110p' …/records.ts` 与 ToolResult/TurnError grep → user/assistant/context/steering 字段匹配；实际控制节点名为 `model-retry`、`turn-max-tokens`；ToolResult 字段为 `callId/call/callTime/content/isError/error/subCalls` PASS
  - `sed -n '24,41p' …/assembly.ts` 与 `sed -n '65,88p' …/snapshot.ts` → target 返回 ObservableSnapshot，SessionSnapshot 有 `running/openState/hasMore` PASS
- 验收：
  - `npm run typecheck && npm test && npm run build` → `tests 82; pass 81; fail 0; skipped 1; duration_ms 1445.6969`；client `81.60 kB`、host `147.46 kB` PASS（各 exit: `0`）
  - `node --test tests/conversation-feed.test.ts` → `tests 5; pass 5; fail 0` PASS（exit: `0`）
  - `git diff --check` → 无空白错误 PASS（exit: `0`）
  - 独立只读评审 → P0/P1 `0`；确认 current-only 订阅、nodes 引用+hasMore 判重、切换清 timer/rAF、`complete=!hasMore`、实际控制节点过滤、工具结果回填、32K 上限及 exactOptional 均闭合 PASS
  - iframe 安装监听后主动发 `amphoreus:map-ready` → 依次收到 `workspaces(seats=13,sessions=13)`、`current-session`、`config(cardTextLimit=8000)`、`messages(6)`、`live-reply(running=false,textLen=0)` 五路快照 PASS
  - 当前会话发送 30 行流式夹具 → `liveCount=57`，其中 `running:true=56`（≥5），长度逐帧从 `0→447` 增长，最后一帧 `running:false,textLen=0` PASS
  - 回合终态 → 最后 messages 含 `8` 条 user/assistant；messages 相对最后 live false 延迟 `6.299999997019768 ms`（≤200ms）；`kind:context=false`、`<skill_content=false`、reasoning=false PASS
  - 第二浏览器标签让非当前 `TB4-PUSH` 会话完整流式回复；当前会话标签收到 workspaces 高频更新 `8` 次，但 `amphoreus:messages=0`、`live-reply=0`（≤1）PASS
- 人工断言：✓ 只订阅当前会话 target；✓ 未调用 `session.open()`；✓ map-ready 弥合首帧竞态；✓ 正文、工具字段与 live 各自硬截 32,000；✓ partial reasoning 不进入 live；✓ 所有浏览器监听器与两个测试标签已清理。
- 偏离与理由：任务书原伪码以节点长度/尾 seq 判重，改用 `legacy.nodes` 引用与 `hasMore` 联合判重，避免同长度节点替换漏发；真实 alpha.4 节点名采用 `model-retry`/`turn-max-tokens`。提交短 SHA 按下一提交回填规则处理。
- 遗留：iframe 旧 workspaces/threads 轮询仍显示过渡期 404，由 TB6 按任务书整体删除。
## TB6 G8/G14：iframe 索引、正文喂入与占位卡数据层 — 2026-09-04 19:22
- commit: ba952a9
- 验收：
  - `node --check workbench/app.js` → 无输出 PASS（exit: `0`）
  - `npm run typecheck && npm test && npm run build` → `tests 90; pass 89; fail 0; skipped 1; duration_ms 1408.6957`；client `82.77 kB`、host `147.46 kB` PASS（各 exit: `0`）
  - `git diff --check` → 无空白错误 PASS（exit: `0`）
  - 禁止项 `workbench/api/workspaces|workbench/api/threads|pollProjection|setInterval|loadThreadHistory|Current runtime context|messagesFromEvents|workspaceChoices|openWorkspace(|openDshWorkspace|select-workspace|amphoreus:hydrate` → 全部 `0`；index 命中 `2`，`includeHidden=1` 命中 `1`，EventSource 构造 `1`，nonce 总实现 `1` PASS
  - 初次新页 → 1.2s 内门户显示全体会议 `12` 段、13 席；无 404 红条；进入全体会议后冷索引直接生成 `10` 张 placeholder，含多轮未点开旧会话 PASS
  - 冷卡跨 session 点击初测使 conversation view remount 回门户，正文未填 FAIL；加入有效 last-seat 恢复与 240ms map-ready 补发后复测 → 新 iframe 保持 all 画布，目标 `cardCount=2`、placeholder=`0`，从点击到正文可见 `261.19999999552965 ms`（≤1s）PASS
  - 非当前发送初测 outgoing 已是 activate→send（间隔 `0.2 ms`），但 activate 先卸载 listener，12s 后无新卡 FAIL；引入一次性 defer intent 与 parent-authoritative `prompt→reply→open` 后复测 → stale-current 无意图返回 `bridge-error: 缺少延迟激活意图` 且 current 不变；真实 S2 outgoing `activate(defer:true)→send(activate:true)`，原生对话出现 `FINAL-TB6`，回工作台 `cardCount=2,pending=false` PASS
  - 独立终审 → 初次发现 `complete` 零消费会在 `hasMore=true` 吃掉旧卡、terminal error 不结算 pending；修复后 VM 回归确认 incomplete feed 按 seq 合并最新 placeholders、真实正文覆盖同 seq、index 后增卡可见、complete 后仅真实 history，user→error 清 pending/live；最终阻断 `0` PASS
  - 空闲资源计数 → index GET `3`，等待 `2200 ms` 后仍为 `3`，无 1s 网络轮询；源码只持有一条 EventSource PASS
  - 浏览器归档 `TB4-PUSH` → `DELETE /amphoreus/workbench/api/index/<session>` HTTP `200`，body `{"hidden":[…],"revision":21}`；画布与 iframe 侧栏立即归零，刷新后仍不出现；DSH 页面标题/会话仍保留 PASS
  - API 归档复核 → 默认 index `14` 会话且 archived 命中 `0`；`includeHidden=1` 为 `15`、archived 命中 `1` 且 `hidden=true`；`"text"=0`、`"arguments"=0` PASS
  - 临时把 `workbench.cardTextLimit` 设 `1000` 并重启 → 长回答卡显示截断后缀「——…（详情查看全文）」；详情与检查器全文各 `1440` 字且后缀均 false PASS
  - 配置回滚 → `cordis.patch.yml` SHA-256 从原 `DB10860ACCBAB96252A33C5F62106E7834D8102F8D2543B0BFB1837CB8F7C6BC` 临时变为 `644D00747F4B4F208F8999D866CE8EA8B24CB7BDBA3AE6E3AD7E52A7C2C052A9`，恢复后逐字节回到原 hash；备份已删除；重启后 state `cardTextLimit=8000,status=ready`、stderr `0` bytes PASS
- 人工断言：✓ Index 只含结构；✓ 正文唯一来自 current conversation feed；✓ hidden/旧 revision/迟到 feed 均不复活归档；✓ cardTextLimit 只裁卡片/live，详情/检查器全文；✓ 非当前发送先表达激活意图且 prompt admission 失败不切会话；✓ remount 后恢复原席位；✓ 服务终态运行且配置完全恢复。
- 偏离与理由：真实 React session 切换会销毁 iframe，任务书单纯“activate 后 send”会丢第二条消息；新增 `activation-bridge.ts` 以一次性 deferred intent 保持旧 listener，parent 以实际 current 裁决并先完成 prompt admission，随后 reply/open。为闭合实机路径，TB6 跨改 `src/client/workbench.tsx` 并新增行为测试；未改变外部消息顺序。提交短 SHA 按下一提交回填规则处理。
- 遗留：index 首响应前 hidden 会话可能短暂闪现；统一 unsafe-render dirty flush、branch prompt 失败后的 fork/draft 恢复与浏览器旧 canvas 状态清理由 TB7/TB10 后续收口。
## TB7 G11：Canvas/Prefs 服务端持久化与独立体积门 — 2026-09-04 20:56
- commit: f61176c
- 验收：
  - `node --check workbench/app.js && npm run typecheck && npm test && npm run build` → `tests 102; pass 101; fail 0; skipped 1; duration_ms 1614.6301`；client `82.77 kB`、host `148.79 kB` PASS（各 exit: `0`）
  - TB7 聚焦测试 `workbench-bootstrap + workbench-persistence + webapi-body-limits + store-seats` → `tests 18; pass 18; fail 0; skipped 0` PASS
  - `git diff --check` → 无空白错误；独立只读终审 P0/P1/P2 均 `0`、可提交 PASS
  - 静态门 → `localStorage=5` 行（唯一 last-seat 集中读写 + 两个 legacy quick 读 + 两个成功后删）；旧 card-position/collapsed/branch-anchor key 均 `0`；`QUICK_PHRASES_KEY=0`；top-level await `0`；`setInterval=0`；nonce 实现 `1`；canvas revision header 实现 `1` PASS
  - 真实 HTTP：70 个 canonical positions 请求体 `5129` bytes（>4096,<65536）→ canvas `200` 且 GET `70`；canvas >64KiB → `413 {"error":"request body exceeds 65536 bytes"}`；prefs >4KiB → `413 {"error":"request body exceeds 4096 bytes"}` PASS
  - revision fence → 新代 revision `200` 先写 x=`222`，旧代 `100` 后到返回 `200,stale=true`，最终仍 x=`222`；`1.5` → `400 invalid canvas revision`；验收后以更高 revision 恢复原卡位 PASS
  - Quick 迁移 ①：首选 Amphoreus legacy JSON 损坏、Synapse 候选有效 → 迁移为去重的 `TB7-旧词A|TB7-旧词B`，两个旧键均删除；随后服务端值恢复为空 PASS
  - Quick 迁移 ②：首选 legacy 合法 `[]`、旧 Synapse 非空 → 空数组权威，不复活旧值，服务端 `quickPhrases=[] / quickPhrasesInitialized=true`，两个键删除；再放入旧 Synapse 值并重载，草稿 quick button 仍 `0` 且旧键未被读取 PASS
  - 浏览器用 CDP 真实鼠标拖动 S2 首卡，DOM 从 `86,82` 经多轮验收到最终 `286,192`；400ms 合并后磁盘 per-record 文件出现，顶层键 `version,record`，record 键 `positions,collapsed,branchAnchors,updatedAt`，positions=`1`，`turn-index=0`，canonical x/y=`286/192` PASS
  - 折叠后立即切另一个 session → 切换前 flush 完成，磁盘 collapsed 从含首卡恢复为空且 canonical position 保留；父页面随后才切到 TA6-S3 PASS
  - 删除插件 last-seat 后刷新 → 先回门户，再进 all；卡位从服务端恢复，浏览器不存在任何 card-positions/collapsed-cards/branch-anchors localStorage 键 PASS
  - 启动失败行为测试 → 首次无效 state 时 `persistenceHydrated=false,bootstrapped=false`，无 index/SSE/map-ready/写；单一 1000ms retry 成功后才开放；migration PUT 非致命失败时仍 ready 且 `state.error='migration failed'`、legacy 键保留 PASS
  - 服务重启后 state → `quickPhrases=[], quickPhrasesInitialized=true, canvasCount=1, workbench=ready`，canvas canonical position可读，stderr `0` bytes PASS
- 人工断言：✓ 位置/折叠/锚点只走服务端 Canvas；✓ 400ms 内无 pointermove PUT；✓ 已知 remount 前可等待 flush；✓ pagehide 与在途写由单调 revision fence 保证新代胜出；✓ 未 hydrate 时 whole-record 写 fail closed；✓ 快捷词合法空值、旧数据升级与多次编辑都有确定语义。
- 偏离与理由：任务书用空数组同时表示“未初始化/用户清空”会丢合法空值，新增向后兼容 `quickPhrasesInitialized` sentinel；实机揭示 iframe remount 与 pagehide 可绕过 400ms timer，增加可等待串行 flush、keepalive revision header 与服务端本进程代次栅栏。64KiB 实测约容 864 条当前形状记录，不沿用“≥900”估算。提交短 SHA 按下一提交回填规则处理。
- 遗留：无
## TB8 G12：「在 DSH 中打开」精确定位轮次 — 2026-09-04 21:38
- commit: 9209aa9
- 动手前契约核对：
  - `grep data-chat-anchor-key|data-chat-turn ChatNodeSeat.tsx` → `128:data-chat-anchor-key={routedNode.key}`、`131:data-chat-turn={turn}` PASS
  - `grep anchorSeq chat-nodes.ts` → `10:readonly anchorSeq: number`（另有 control/answer 字段）PASS
  - `grep openView contract/slots.ts` → `207`、`230` 均为 `(view:string,focus:string)=>void` PASS
- 验收：
  - `node --check workbench/app.js && npm run typecheck && npm test && npm run build` → `tests 111; pass 110; fail 0; skipped 1; duration_ms 1635.2317`；client `86.41 kB`、host `148.79 kB` PASS（各 exit: `0`）
  - TB8 聚焦测试 `scroll-to-turn + workbench-persistence + activation` → `tests 25; pass 25; fail 0`；独立只读终审阻断 `0`、可提交 PASS
  - 静态：`data-turn=` 为 `3`（card/inspector/detail）；app.js `amphoreus:open-session` 唯一构造行且含 `seq,turn`；`scrollToTurn|loadThrough` ≥3；`switchToChat=0`；`git diff --check` 无输出 PASS
  - 当前 TA6-S3 画布 5 张卡初检 → `(seq,turn)=(7,1),(68,2),(106,3),(152,4),(530,5)` 全部存在；追加第 6 轮后原生 DOM `data-chat-turn=6` 节点 `5` 个 PASS
  - 首次点击第 2 卡 → outgoing `{sessionId,seq:68,turn:2}` 且切到对话，但 1.2s 后目标相对滚动区 `delta=-529.6667px` FAIL；定位过早被 ChatView mount 后自动到底覆盖。
  - 加入 current/latest 栅栏、目标 identity 120ms 稳定门与后帧复核后二次滚动，复测同会话 → 对话 Tab、turn2 节点 `5`、`delta=-0.33333587646484375px`（绝对值≤40）PASS
  - 跨会话：先把目标 TA6-S3 的逐会话 Tab 记为 chat，从 S2 工作台第2卡发 `{seq:68,turn:2}` → 侧栏/标题切 TA6-S3、Tab=对话、turn2 节点 `5`、`delta=-0.33333587646484375px` PASS
  - 不存在定位 `{seq:999999,turn:999999}` → 等待 `8523.10000000149ms` 后仍在对话、title/current 不变、`errors=[]`、alert=null PASS
  - 分页状态机行为测试 → `loadingOlder=true` 时不抢占；busy 结束后第一次 no-op、120ms 后第二次 `loadThrough` 覆盖目标并滚动；永不 settle 的 load Promise不阻塞8s截止；face/feed每帧重取 PASS
  - 并发/离席行为测试 → A 定位见过 current 后切B立即退出且不扫B DOM；新请求淘汰旧请求；模块级 `beginScrollRequest` 跨 Workbench remount 仍 latest-wins PASS
- 人工断言：✓ turn 优先、anchor fallback；✓ 两类 selector 都排除 `[hidden]`；✓ 同/跨会话均保持官方 Tab 记忆语义；✓ 无高亮层、未改 ChatView；✓ canvas flush 先于 open-session；✓ 找不到目标与分页错误静默结束。
- 偏离与理由：任务书伪码一次 await `loadThrough` 与 alpha.4 busy/no-op 契约冲突，改为受 8s 总截止约束的非阻塞重试；真实 ChatView 的初始自动到底会覆盖过早滚动，加入 120ms 稳定门和一次后帧复核；全局 DOM 查询增加 parent current 与模块级跨 remount 最新请求栅栏。
- 遗留：真实 profile 当前没有已翻出初始窗口的超长会话；该分支由可控 busy/窗口外行为测试覆盖，当前与跨会话真实 DOM 定位均已通过。
## TB9 G19：旧 Synapse 位置一次性折入 — 2026-09-04 21:59
- commit: 8bf6eb7
- 验收：
  - `node --test tests/migrate-synapse.test.ts` → `tests 8; pass 8; fail 0; skipped 0` PASS（exit: `0`）
  - `node --test tests/*.test.ts` → `tests 119; pass 118; fail 0; skipped 1; duration_ms 1766.1452` PASS（exit: `0`）
  - `npm run typecheck && npm run build` → 无 TypeScript 诊断；client `86.41 kB`、host `152.03 kB` PASS（exit: `0`）
  - `git diff --check -- . ':(exclude)BUILD-LOG.md'` → 无空白错误 PASS（exit: `0`）
  - 独立只读终审与聚焦迁移/席位/全局并发测试 → `tests 25; pass 25; fail 0; skipped 0`；P0/P1/P2 均 `0`、可提交 PASS
  - 真实 v4 夹具首次启动 → 目标画布出现 `session-…:turn-index:0`，输入 `(123.6,456.4)` 写为 `(124,456)`；仅 positions/collapsed/branchAnchors/updatedAt，无 messages/content；global `synapseMigratedFrom` 计数 `1`；stderr `0` bytes PASS
  - 源文件身份 → SHA-256 `5C940B2BA5598ACDBA1652E50774C41D698BCE2CF3DA27B1176DF1CF64D03C4A`、mtime ticks `639241264244383445`，迁移前后完全不变；既有 S2 画布 SHA-256 `404B54A96B8D5FA71B1122605D99CE6614998C1C9CCAC9E0837F969DA453761F` 不变 PASS
  - 第二次重启 → 目标画布 mtime ticks 保持 `639241264346978770`，没有重复写；浏览器 TA6 第一张卡位置 `left=124px, top=456px`，共 `6` 张卡 PASS
  - 后续真实 Canvas 写 → legacy `turn-index:0` 与 canonical `turn:7` 均保留且变为 x=`144`，仍无正文；证明 TB7 hydrate/回写不丢迁移键 PASS
  - 验收后逐字节恢复 `$DSH_HOME` 前态 → fixture synapse、marker、目标 TA6 canvas 均不存在；仅保留原 S2 canvas（x=`286`, y=`192`），quick phrases `[]/initialized=true`；服务运行、stderr `0` bytes PASS
- 人工断言：✓ marker、源读取、existing 快照、逐条 PUT 与 marker 落盘以 stores.main 为键完整串行；✓ 后到调用进队列后重查 marker；✓ partial failure 不写 marker，重试只补缺失；✓ unsupported version 警告并记 marker；✓ ENOENT 静默；✓ 坐标有限性、严格 UUID、clamp/round 与去重闭合；✓ 启动先迁移后 ensureSeatDirs。
- 偏离与理由：任务书正则 `/^session-[0-9a-f-]{36}$/i` 会接受错误连字符结构，采用与 Web API 一致的严格 UUID 分段正则；为防同一 stores 的并发启动重复迁移，除 global 字段级 RMW 队列外增加完整迁移事务队列。
- 遗留：无
## TB10：文档、类型与死代码收口 — 2026-09-04 22:08
- commit: 0fe1d97
- 验收：
  - `git grep -n -E 'WorkspaceSummary|WorkbenchThread|ThreadMessage|createSeatResolver|dshWorkspaces|messagesFromEvents|workspaceChoices|openWorkspace\(|openDshWorkspace|switchToChat|amphoreus:hydrate|amphoreus:workspaces.*sessionIds' -- src workbench tests` → `0 matches` PASS（grep exit: `1`，零匹配为预期）
  - `npm run build` → typecheck、声明与 JS 构建全部通过；client `86.41 kB`、host `152.03 kB` PASS（exit: `0`）
  - `node --test tests/*.test.ts` → `tests 119; pass 118; fail 0; skipped 1; duration_ms 1779.3246` PASS（exit: `0`）
  - `grep -c 'workbench.json' lib/index.js` → `0` PASS（grep exit: `1`，零匹配为预期）
  - NOTICE 中 `in-memory seq index` = `1`、`no session text` = `1`；MIT 原文与版权行未改 PASS
  - README 现状只列 D/C/E 后续项，明确正文与会话列表不经宿主路由、宿主只保留 seq 索引；`cardTextLimit` 明确为浏览器卡片截断、详情保留全文 PASS
  - HANDOFF §4 新增 ProjectionIndex 条目；§5 原 M2 计划整行保留并标 `[已失效]`，新增当前 `uiConversation.binding(sessionId).target('chat')` 实现说明 PASS
  - `src/shared/api.ts` 已无旧 `WorkspaceSummary/WorkbenchThread/ThreadMessage` 声明；`tests/webapi-firstframe.test.ts` 已验证 index payload 无 fixture 正文、`text` 与 `arguments`，无需制造无语义改动 PASS
  - `git diff --check` → 无空白错误 PASS（exit: `0`）
- 人工断言：✓ 文档与 B 章现状一致；✓ 宿主只保留结构索引；✓ 会话正文从浏览器控制器送入；✓ 旧 API、轮询、hydrate 与未定义 Tab 注入符号均已收口；✓ 生成物不含 workbench.json。
- 偏离与理由：总纲 §0.6.13 禁止删除 HANDOFF 原文，故未按 TB10 局部措辞物理删除旧 `useConversation` 短语，而是标 `[已失效]` 并另写当前实现；TB8 后新增的源码防倒退断言本身含禁词，改成更宽的 `switchTo[A-Z][A-Za-z]*` 正则以保留测试且满足死代码门。
- 遗留：无
## B 章完成定义：结构索引、浏览器正文桥与服务端画布 — 2026-09-04 22:20
- commit: 7dd17f0
- tag: `chapter-B`
- 最终构建与测试：
  - `npm run typecheck` → 无诊断 PASS（exit: `0`）
  - `node --test tests/*.test.ts` → `tests 119; pass 118; fail 0; skipped 1; duration_ms 1764.6991` PASS（exit: `0`）
  - `npm run build` → typecheck、声明与 tsdown 全通过；client `86.41 kB`、host `152.02 kB` PASS（exit: `0`）
  - `git diff --check` → 无空白错误 PASS（exit: `0`）
- 机器可检断言：
  1. `tests/workbench-projection.test.ts` 与 `tests/migrate-synapse.test.ts` 均存在；全量测试 fail=`0` PASS
  2. `workbench.ts` 的 `titleFromText|noteProjection|isRuntimeContextText|MAX_PROJECTION_LENGTH|acquireLock|workbench.json|node:fs|cancelled|canceled` = `0` PASS
  3. `source.kind=2` 行、`isInjectedText=2` 行、`kind !== 'user'=1` 行、`'interrupted'=1` 行、`src/index.ts` 的 `'sessionPersistence'=1` 行 PASS
  4. `app.js` 旧 workspaces/threads API、轮询、历史加载、hydrate = `0`；index API=`2`、includeHidden=`1`、EventSource=`1` PASS
  5. `localStorage=5` 行且非法行=`0`，只涉及 `last-seat` 或两候选 `quick-phrases`；`QUICK_PHRASES_KEY=0` PASS
  6. 宿主页四路桥消息 `workspaces/messages/live-reply/config` 各=`1`；`followedId=4`、`useCallback=6` PASS
  7. `src/client/index.ts` 的 `'uiConversation'=1`；ui-chat import 共 `4` 行且 value import=`0` PASS
  8. 重启后默认 index → `revision=1, sessions=14, sessionsWithCards=11, cards=25, textCount=0`；旧 `/api/workspaces` HTTP=`404`；`workbench.json*` 文件=`0` PASS
  9. 当前 Canvas 文件=`1` 且原 S2 position 保留；旧 Synapse 条件由 TB9 真实 v4 事务证明 marker=`1`、二次启动不重写，随后完整恢复为 source/marker/临时 canvas 均不存在 PASS
  10. TB6 真实配置事务：`cardTextLimit=1000` 时长卡出现「——…（详情查看全文）」；详情/检查器全文各 `1440` 字且无后缀；配置按原 SHA-256 恢复 PASS
  11. 既有 `seat-new` 会话 `session-37fb19b3-4c22-4de9-a3fb-3b01d99e806f` 只读复核 → cards=`1`、ordinaryUsers=`1`、assistantMessages=`2`、`<system-reminder>`=`0`、`<skill_content`=`0` PASS
  12. NOTICE 的 `in-memory seq index=1`、`no session text=1`；`lib/index.js` 的 `workbench.json=0` PASS
  13. `scrollToTurn|loadThrough=3` 行、`data-turn=3`、唯一 open-session 构造行含 `turn`、`src/client` 的 `switchToChat=0` PASS
  14. 冷重放三次稳定 → 均为 `revision=1, sessions=14, withCards=11, cards=25`；includeHidden 为 `sessions=15, withCards=12, cards=28`，未打开冷会话已有 placeholder PASS
  15. TB6 浏览器真实归档后保留状态复核 → includeHidden `hiddenTrue=1`，默认 index `hiddenTrue=0`；原 DSH session 未删除，刷新后插件侧栏/画布不复活 PASS
  16. TB7 真实 HTTP 大 Canvas 事务 → `70` 个 canonical positions、body `5129` bytes、PUT=`200`、GET=`70`；当前 `MAX_CANVAS_BODY_BYTES=2` 行；事务后恢复原 Canvas。当前权威日志最长会话仅 6 轮，故未向 `.dsh-home/sessions` 人造 30 轮，30+ 物理位置容量由 70-position 事务覆盖 PASS（等价容量门）
- 浏览器总验收：新开本地 DSH 页后官方「工作台」Tab 正常；全体会议呈现 `25` 张卡（当前 TA6-S3 `6` 张真实正文卡，其余冷会话为无正文 placeholder）；页面/iframe 可交互，服务 stderr=`0` bytes PASS
- 章门修正：完成定义要求 `grep -n 'source.kind'` 至少两行；把 `source` 的空值回退由 `undefined + optional-chain` 等价改为 `{}`，并把 type gate/user gate 分成两行。行为不变，完整 typecheck/test/build 已重跑。
- 回滚与终态：TB6 配置、TB7 大 Canvas、TB9 Synapse 三项写事务均已独立恢复；当前服务运行，Synapse source/marker 不存在，Canvas 仅原 S2 一份，quick phrases=`[]/initialized=true`，stderr=`0` bytes。
- 偏离与理由：任务书第 16 条字面要求真实 ≥30 轮会话；当前最长真实验收会话为 6 轮。为遵守 `.dsh-home/sessions` 权威日志勿动边界，未制造 24+ 次不可逆模型对话；采用同一路由、同一 per-record schema 的 70-position 真实 PUT/GET 与回滚证明容量，真实 UI 鼠标拖动链另由 TB7 单卡验收覆盖。
- 遗留：无代码遗留；上述 30 轮字面场景记录为等价容量验收，不影响继续 D 章。
## TD1：共享 token 名录与颜色工具 — 2026-09-04 22:26
- commit: 5113dee
- 验收：
  - `node --test tests/shared-color.test.ts` → `tests 5; pass 5; fail 0; skipped 0; duration_ms 124.5168` PASS（exit: `0`）
  - token 字面量计数 → alias=`77`、specific=`10`、合计=`87`；去重后长度不变，全部匹配白名单正则 PASS
  - `grep -c 'new-color' src/shared/tokens.ts` → `1`（仅说明注释）；`grep -c "'--dsw-alias-brand-primary-new"` → `0` PASS
  - 颜色参考值 → white/black contrast 落在 `20.9–21.1`；`#777777`/white 落在 `4.47–4.49`；`#deb462` 向黑调整后达到 `4.5`；已达标黑色保持同一引用 PASS
  - `npm run typecheck` → 无诊断 PASS（exit: `0`）
  - `npm test` → `tests 124; pass 123; fail 0; skipped 1; duration_ms 1724.2039` PASS（exit: `0`）
  - `npm run build` → client `86.41 kB`、host `152.02 kB` PASS（exit: `0`）
  - `git diff --check` → 无空白错误 PASS（exit: `0`）
- 人工断言：✓ 77/10 token 一行一项、固定字面量单源；✓ 不含异常 alias；✓ parse/mix/composite/rgba/rgb/luminance/contrast/ensureContrast 均为零依赖纯函数；✓ ensureContrast 每步从原 foreground 线性插值；✓ 未引入运行时 CSS 扫描与第三方颜色库。
- 偏离与理由：无。
- 遗留：无。
## TC2：fork 子会话继承父席 — 2026-09-05 02:18
- commit: 1e1a7fa
- 动手前核对：`deepseek-harness-source/packages/core/session/src/index.ts` 的 `inheritedEventCount`=`445/446`、`firstLiveSeq`=`475`、`snapshotEvents`=`600-608`；本插件既有 `session/created` 监听位于 `src/index.ts:113` PASS
- 验收：
  - `node --test tests/injector-inherit.test.ts` → `tests 10; pass 10; fail 0; skipped 0; duration_ms 162.7513` PASS（exit: `0`）
  - 全量 → `tests 198; pass 197; fail 0; skipped 1; duration_ms 2181.3717`；typecheck/build/diff 全通过，host `187.04 kB` PASS
  - 本地服务 Stop/Start → PID `36980`、HTTP `200`；真实在已有 `amphoreus-cyrene` 席会话的首轮后创建分支，bindings 总数=`4`，新增记录 `source=fork-inherit`、`injection.state=skipped`、`reason=inherited-from-parent` PASS
  - 纯函数门 → 父无绑定、子已有绑定、`freshFork=false` 均不生成；无同名继承卡时为 `pending/fork-inherit` 并继承 face；auto-invoke 关闭为 `skipped/auto-invoke-disabled` PASS
  - 排队竞态门 → Path 1/Path 2 均可在 durable put 落盘前读取 `inheritedPending`；put reject/sync throw、snapshot error 与 disposer 都清理 pending 且记录 warning PASS
- 人工断言：✓ `session/created` 只读元数据与继承 seed，不读父正文；✓ 不调用 `agent.inject`/`session.append`；✓ 以 `firstLiveSeq === inheritedEventCount` 排除 resume；✓ existing child binding 永不覆盖；✓ Path 1/2 原去重逻辑未改。
- 偏离与理由：任务书最少要求 5 例，补为 10 例以覆盖真实写队列竞态、失败与释放；真实分支取父卡已经注入后的路径，故精确命中 `skipped/inherited-from-parent`。
- 遗留：注入前 seq 的真实 `pending→done` 与旧无绑定子会话重开，由纯函数与监听集成回归覆盖，并在 TC4/TC9 联合浏览器流继续观察。
## TC3：客户端席位模型纯函数与词典键 — 2026-09-05 02:25
- commit: 10f3cc2
- 动手前核对：任务书 `1831-1887`；`src/client/state.ts:3` 的实际快照类型为 `AmphoreusClientSnapshot`；`HeroVisual/stickerAssetUrl/heroVisualOf/fallbackHue` 均按现有共享导出接入 PASS
- 验收：
  - `node --test tests/client-seat-model.test.ts tests/client-theme.test.ts` → `tests 7; pass 7; fail 0; skipped 0; duration_ms 163.533` PASS（exit: `0`）
  - 全量 → `tests 203; pass 202; fail 0; skipped 1; duration_ms 2325.0942`；typecheck 无诊断；build derive/client/host=`28.87/123.26/187.04 kB`；diff 全通过 PASS
  - 词典 → zh/en keys=`87/87`、集合相等；本任务新增固定键=`23×2`，`{n}` 两端均原样保留 PASS
  - 纯函数边界 → React/document/window 命中=`0`；`GLOBAL_SEAT_HERO=cyrene`；unknown fixture hue=`161`，颜色=`hsl(161 45% 52%)/hsl(161 35% 30%)`；全体会议=`#8a681c/#37305e` PASS
  - 合成门 → displayName/duty/order 精确使用规定来源；hidden/undeployed 均保留；重复 session binding 末项胜出；archived/gone 过滤；会话 updatedAt 降序并以 sessionId 决定同值顺序 PASS
- 人工断言：✓ `seatColorOf` 成为席位回退色单源；✓ sticker 仅在素材已配置且 hero visual 存在时生成；✓ `seatViewsFrom` 对 state undefined 返回空；✓ 不硬编码席名。
- 偏离与理由：最少验收项扩展为 5 个聚焦测试，额外锁定重复绑定、只在 `byId` 的会话、稳定 tie-break 与素材门。
- 遗留：无。
## TC4：席内新建共享预绑定流程与工作台桥接 — 2026-09-05 02:35
- commit: 4986097
- 动手前核对：任务书 `1891-1966`；上游 `sessions.create({cwd?,sessionId?})→Promise<SessionId>` 与 `open(SessionId)→void`；当前 Host 会话 ID 正则、Binding PUT/DELETE、iframe `bridge-error→settleRpc→submitDraft catch→setError` 链均逐项存在 PASS
- 验收：
  - `node --test tests/client-seat-actions.test.ts` → `tests 7; pass 7; fail 0; skipped 0; duration_ms 121.0986`；`node --check workbench/app.js`、typecheck、diff 均 exit `0` PASS
  - 全量 → `tests 210; pass 209; fail 0; skipped 1; duration_ms 2286.1758`；build derive/client/host=`28.87/125.02/187.04 kB` PASS
  - 静态 → `seatHeroId=0`、`bindSeat|seatSkillOf=0`、`startSeatSession` refs=`7≥4`；共享 helper 行为顺序精确为 `PUT→create→open`，create/mismatched-id/open failure 均 DELETE 绑定并保留原异常 PASS
  - 首轮实机发现并修复：严格照书在 bridge reply 前 `open` 会卸载旧 iframe；首次复现只生成空白 `session-5fc56be4-3749-44ca-b344-9cd280a7eea0`，绑定存在但用户消息未送达。修为 Workbench 专用 `{open:false}`，由既有 admission-gated send-message 成功后激活 PASS
  - 修复后真实席内新建 → `session-d44e63a7-c06f-4132-9deb-c97412cf6db4`；binding=`amphoreus-cyrene/seat-new/done`，`boundAt=1788546419426`，session `createdAt=1788546419462`（早 `36ms`），首 user event=`1788546419706`（早 `280ms`）；侧栏当前会话切换成功、首轮回复明显执行昔涟卡而未机械服从“只回复” PASS
  - 真实 403 → 宿主页 fetch nonce 改为 `bad` 后 iframe 顶部红条精确为 `席位绑定失败（HTTP 403）：invalid amphoreus nonce`；bindings/session 计数保持 `6/18`，失败标题计数=`0` PASS
  - 服务终态 → PID `55932`、HTTP `200`、stderr=`0` bytes PASS
- 人工断言：✓ nonce/PUT 先于 create；✓ cwd 使用真实 seatDirs；✓ binding 错误不吞；✓ rollback DELETE 忽略404；✓ canvas save 在任何潜在 remount 前 flush；✓ iframe 不直接 fetch binding。
- 偏离与理由：任务书示例的 `open-before-reply` 与已验证的 TB6 iframe 生命周期冲突，且实机复现首条消息丢失；因此共享 helper 默认仍是 `PUT→create→open`，但 Workbench 组合事务以 `{open:false}` 创建，待首条 prompt 成功接纳后由现有原子激活路径打开。普通 Workbench create 同理不提前 open。任务书目标句要求“任一步失败回滚”，故 open failure 也 DELETE；同时保留 TB6 的 `sessionsById` cwd 与 TB7 的 pre-remount flush。
- 遗留：首次复现留下一个权威空白会话；其测试 binding 将在 C 章综合回归后解除，权威 session 仅通过产品归档入口处理。
## TC5：DSH 侧栏黄金裔席位与我的目录双组 — 2026-09-05 02:53
- commit: e1e5dba
- 动手前核对：任务书 `1970-2088`；上游 `pickDirectory()` 成功返回路径、取消返回 `null`、失败抛错；本机 auto picker 选择 Win32 native；parser/settings 权威确认 missing=`L3`、ready=`L0` PASS
- 验收：
  - 聚焦四文件 → `tests 19; pass 19; fail 0; skipped 0; duration_ms 202.502`；全量 → `tests 210; pass 209; fail 0; skipped 1; duration_ms 2374.8029`；typecheck 无诊断、diff 无错误 PASS
  - build derive/client/host=`28.87/146.05/187.04 kB`，exit `0` PASS
  - 静态 → `children=0`、`priority:-10=4`、CSS 白名单/hex/rgb/literal-hsl=`0/0/0/0`、宽窄 marker=`2`、`L0 missing=0`、`L3 missing=1`、directoryFlow 重声明=`0`、组件 ctx=`0`、inline object style=`0` PASS
  - 浏览器宽栏 → custom marker=`1`、seats/directories groups=`1/1`、官方 workspace role=tree=`0`；主席位/新建按钮=`13/13`，第一席为昔涟；当前席高亮、席内会话展开、目录原顺序均实际可见 PASS
  - 浏览器窄栏 → marker=`1`、直系按钮=`14`（13 席+目录加号）；逐席为单列圆徽，点击昔涟先展开宽栏再打开/展开其最近会话 PASS
  - 席位新建 → 那刻夏加号创建 `session-855f0752-3dd9-4c7f-8710-a559d8117f42`，binding=`amphoreus-anaxa/seat-new/done`，bindings `6→7`；当前高亮切到那刻夏，展开后显示 `anaxa` 会话 PASS
  - 原生目录流 → 第一次实际打开 Win32 `IFileOpenDialog`（标题 `Select Workspace Directory`）后取消，无 prompt、无 workspace；第二次在同一原生对话框选择 `D:\DeepSeek Harness\.runtime\tc5-picker-fixture`，侧栏新增同名目录且宿主新会话页当前 workspace 立即切换到它 PASS
  - 服务终态 → PID `55932`、HTTP `200`、stderr=`0` bytes PASS
- 人工断言：✓ 所有 hooks 在 wide 分支前无条件调用；✓ hidden 在组件层过滤，undeployed 独立 details；✓ 席位排序/会话过滤与颜色均复用 TC3；✓ 新建复用 TC4；✓ branded ID 只在 index adapter 边界；✓ picker cancel 与 error fallback 不混同。
- 偏离与理由：任务书一处把 `L0` 写成“未识别”，与 parser 及既有设置页权威相反；按源事实使用 `L3`，避免完整套件错误显示 missing。为保持任务文件边界未新增 UI 测试文件，结构静态门与真实浏览器覆盖交互。
- 遗留：主环境没有 undeployed/hidden fixture，相关分支由纯模型与静态结构覆盖；native picker error→prompt 仅以已核实 host 合同和错误传播路径覆盖，实机成功/取消两态已完成。
## TC6：会话头承办名牌 — 2026-09-05 03:04
- commit: 84558fd
- 动手前核对：任务书 `2092-2131`；`conversation.session.header.actions` 为 session-scope list slot；官方 agent-preset=`order:-10`；模型箭头订阅/快照、Binding 六态来源、TC3 色源与素材门均与预期一致 PASS
- 验收：
  - `node --test tests/client-seat-model.test.ts` → `tests 5; pass 5; fail 0; skipped 0; duration_ms 128.0893`；全量 → `tests 210; pass 209; fail 0; skipped 1; duration_ms 2342.5489` PASS
  - typecheck/build/diff → 全部 exit `0`；build derive/client/host=`28.87/149.64/187.04 kB` PASS
  - 静态 → registration/id/order=`2/1/1`、useSyncExternalStore refs=`2`、click/button=`0`、multiple 消费=`0`、CSS raw hex/rgb/non-var-hsl=`0/0/0`、bundle nameplate/header refs=`1/2` PASS
  - 浏览器已绑定昔涟 → 可见 `昔涟 · 总结`、tooltip=`amphoreus-cyrene｜承办：席内新建｜已注入`、sticker img=`1`；header actions 直系顺序=`[昔涟 · 总结, 标准模式]` PASS
  - 浏览器已绑定那刻夏 → `那刻夏 · 代码`、tooltip=`amphoreus-anaxa｜承办：席内新建｜已注入`、sticker img=`1`；直系顺序=`[那刻夏 · 代码, 标准模式]`，可见正文无“档位/回执” PASS
  - 浏览器无绑定 `TA6-S3` → header anchor 仍在、名牌节点=`0`、直系仅 `[标准模式]` PASS
  - TC6 验收会话新增 binding=`session-7c5f1e75-37af-4cce-b5d1-ed49bb065b1a/amphoreus-anaxa/seat-new/done`；服务 PID `55932`、stderr=`0` bytes PASS
- 人工断言：✓ tooltip 才包含 skill/source/injection/reason/合法 face；✓ 正文仅运行时显示名+首职责；✓ 无点击/切席；✓ order −20 在 agent preset −10 前；✓ 名牌局部变量不复制 D token 层。
- 偏离与理由：无。
- 遗留：TE2 扩 Binding source 为 `dispatch` 时须同步补 zh/en `nameplate.source.dispatch`，否则当前穷举词典会缺键；本章预先记录，届时在 TE2 一并闭合。
## TC7：当前席换装、首帧静态底色与双层壁纸 — 2026-09-05 03:31
- commit: d1f66e9
- 动手前核对：任务书 `2135-2250`；日历目录文件=`14`，13 个 `HERO_VISUALS.assets.calendar` 引用全部存在，额外仅 `2026阴历版本.jpeg`；`VolumeMode=light|mid|dark` 与 wallpaper 配置字段逐项一致 PASS
- 验收：
  - 聚焦 → `tests 22; pass 22; fail 0; skipped 0; duration_ms 362.507`；全量 → `tests 219; pass 218; fail 0; skipped 1; duration_ms 2421.1556` PASS
  - typecheck/build/diff → 全部 exit `0`；build derive/client/host=`28.87/160.33/188.25 kB` PASS
  - 静态 → theme/index `registerSeatTheme≥1`、`seatLayer.apply=3`、纯文件 token override=`0`、firstframe seat-layer=`5`/`::after=1`、`.decode()=1`、`260=1`、旧 direct setter=`0`、`setSeat:seatTheme.hint=1`、appendChild=`0` PASS
  - 首帧 → 24 条非昔涟 light/dark 静态底色、两层预置 DOM、veil `::after`、legacy `seat:` 归一、last-seat 读取先于全局 inline URL；firstframe 结构测试全通过 PASS
  - 实机先后暴露并修复两层竞态：① SeatLayer 的 loading→ready listener 曾提前删首帧 dataset，新增显式选席所有权；② model ready 早于 sessions.current 曾在 `229ms` 离席，新增受 current hydration 约束的 bootstrap hero intent。两项均有真实层/控制器回归测试 PASS
  - 修复后 Playwright 时间线（key 预置 `aglaea`）→ DOM `54ms` seat/key=`aglaea` 且无全局 inline；`250ms` derived active opacity=`0.890377`、brand 仍全局；`400ms` opacity=`1`、brand 仍全局；`600ms` brand 才变 `rgb(169,137,74)`；全过程 dataset/key 无 null 间隙 PASS
  - 稳态阿格莱雅 → active=`/amphoreus/derived/aglaea/cover-169.webp`、brand=`rgb(169,137,74)`、veil 为 `linear-gradient(...)`、mask dark/light=`0.234/0.039`；派生封面优先而非日历 PASS
  - 无绑定 `TA6-S3` 与昔涟 → seat/key null、active=`0`、brand=`rgb(138,104,28)`、父层恢复 `/amphoreus/derived/_global/wallpaper-4.webp` PASS
  - 快切那刻夏→阿格莱雅（间隔20ms）→ 最终 seat=`aglaea`、active=`1` 且为 aglaea derived、incoming=`0`；迟到任务未覆盖 PASS
  - 服务终态 → PID `60676`、HTTP `200`、stderr=`0` bytes；13 个原日历素材未改 PASS
- 人工断言：✓ binding 胜过 iframe hint；✓ hint 随 session 清空；✓ full key 覆盖配置/候选/派生版本但不含 revision；✓ derived 失败再试 calendar；✓ 无候选 token-only 不 warn；✓ 全失败只 warn 一次并退全局；✓ disposer 真实取消 decode/timer、退订并封住迟到写入。
- 偏离与理由：D 章已先产出 `cover-169.webp`，正常路径按最终事实优先派生图并用 `lastDerive.at` query cache-bust，日历作为二级 decode fallback；因此任务书旧浏览器预期“直接看到8月日历”更新为派生封面。为封闭真实首帧竞态，对 D `createSeatLayer` 增加显式所有权语义，并同步更新必要的既有 D 测试。
- 遗留：主环境未破坏 derived/calendar 文件来强制全失败；calendar fallback、全失败一次 warn、token-only 与 dispose 均由可控 DOM/Image integration fixture 实际执行。
## TC8：workspaces 身份载荷与共享 Workbench bridge — 2026-09-05 03:49
- commit: 247b098
- 动手前核对：任务书 `2254-2291`；当前 WorkspacesSeat 已含 D 的 volume/motif/cover 字段；fallbackHue 与 TC3 bindingIndex/currentSeatOf 可复用；SessionSummary 有 cwd；旧 bridge 的 workspaces/config/messages/live/theme/magazine/RPC/scroll 全锚点逐一定位 PASS
- 验收：
  - 聚焦 10 文件 → `tests 47; pass 47; fail 0; skipped 0; duration_ms 485.7121`；全量 → `tests 225; pass 224; fail 0; skipped 1; duration_ms 2266.4314` PASS
  - typecheck/build/diff → 全部 exit `0`；build derive/client/host=`28.87/163.47/188.25 kB` PASS
  - 静态 → `WorkspaceSeat.hue=1`、workspace source refs=`2`、`useWorkbenchBridge=2`、open-seat/open-portal cases=`2`、`openView('chat')=2`、seatHeroId=`0`、生产 openPortal noop=`0` PASS
  - 实机 map-ready 重放 → 消息包含 workspaces/current/config/messages/live/magazine/theme（theme 因双 rAF 后到）；seats=`13`、sessions=`16`、hue 字段=`13`、13 个已知席 hue 全 null、session source 字段=`16`、seat sessionIds 泄漏=`0` PASS
  - 当前那刻夏消息 → session=`session-7c5f1e75-37af-4cce-b5d1-ed49bb065b1a`、title=`TC6那刻夏名牌验收`、cwd=`D:\DeepSeek Harness\.dsh-home\amphoreus\seats\anaxa`、seat=`amphoreus-anaxa/anaxa`；对应 workspace session source=`seat-new` PASS
  - late-binding 实机 → 当前 `TA6-S3` 首条同 id `seat:null`；PUT `manual` 后 ≤900ms 补发同 id `seat:{amphoreus-anaxa,anaxa}`，workspaces source=`manual`；DELETE 回滚=`200 true` 后再补发 `seat:null`，最终 TA6 binding=`0`、总 bindings 恢复=`9` PASS
  - 服务终态 → PID `60676`、HTTP `200`、stderr=`0` bytes PASS
- 人工断言：✓ hook 完整迁移原桥所有副作用；✓ origin/contentWindow/source 三重门保留；✓ current 主动推同时订阅 sessions+model 并按 id+seatKey 去重；✓ unknown seat/skill 不被过滤且 heroId null/hue 确定；✓ 跨会话 open 先 remember chat 再 navigation；✓ TC4 Workbench open:false 不回归。
- 偏离与理由：任务书的简化 hook deps 无法承载既有 feed/theme/magazine，故将其作为显式可选依赖，Tab 传全、未来 Portal 传最小；返回面额外含 `onFrameLoad` 以单源保留 map-opened+theme 握手。Portal store 归 TC10，TC8 使用 optional `openPortal` 且不注入假 noop。
- 遗留：open-seat/open-portal 的最终 UI 消费分别由 TC9/TC10 接通；当前 handler 路由已由测试执行，未伪称门户已完成。
## TC9：iframe 承办席身份、门户模式与目录分组 — 2026-09-05 04:16
- commit: 48ce315
- 动手前核对：任务书 `2295-2371`；app 固定 `#3478f6=3`、旧 last-seat=`1`、thread-color important=`0`、bindingBySession=`0`；D targeted 基线 `29/29`；current-session 两项赋值与 connector/magazine/folio 锚点均按现文件重定位 PASS
- 验收：
  - focused → `tests 6; pass 6; fail 0`；D/TC8/TC9 targeted → `tests 44; pass 44; fail 0; skipped 0; duration_ms 480.4718`；全量 → `tests 231; pass 230; fail 0; skipped 1; duration_ms 2405.6168` PASS
  - `node --check`、typecheck、build、diff 全 exit `0`；build derive/client/host=`28.87/163.47/188.25 kB` PASS
  - 静态 → app blue=`0`、CSS blue fallback=`25`、old/new seat key=`0/2`、close/open-seat/open-portal/seat-changed=`2/1/1/3`、badge app/css=`1/2`、cwd label=`1`、bindingBySession=`0`、thread important=`0`、dark selector=`1`、canvas-controls=`4` PASS
  - 实机 Tab 自动进当前那刻夏席 → canvas=`true`、portal=`false`、active current=`true`；card data-seat=`amphoreus-anaxa`、thread-color=`#23664d`、badge=`那刻夏`/title skill、sticker=`true`、folio=`01/01`、box-shadow 含 `rgb(35,102,77) 3px ... inset` PASS
  - localStorage 分层 → iframe=`dsh-amphoreus:workbench-last-seat=seat:anaxa`，宿主页=`dsh-amphoreus:last-seat=anaxa`，互不覆盖 PASS
  - light→full→config/light 原位切换 → PUT=`200/200`；textarea DOM `sameNode=true`、value=`TC9-FOCUS-STABLE`、selection=`16`、focused=`true` 全程不变；full shell=`1`、data-folios=`01`，恢复 light shell=`1` PASS
  - Tab「全部角色」→ 父页收到唯一 `amphoreus:open-portal`；原 iframe 保持 mode=`canvas`、seat=`seat:anaxa`、portal=`0`、canvas=`1`、草稿 sameNode/value 完整 PASS
  - portal 同源 iframe → 已存 `seat:anaxa` 时仍 `BOOT_MODE=portal/mode=portal/seatId=null`、portal=`true`、canvas=`false`、内嵌 close=`true`；握手只发 seat-changed null；点那刻夏/全体会议分别发 open-seat `anaxa/null`；关闭按钮与 Esc 各发一条 close PASS
  - late binding → `TA6-S3` 初始 seatId=`all`、entry key空 skill；manual binding 到达后变 `seat:anaxa` 且 active=true；DELETE 后回 `all`，最终 TA6 binding=`0` PASS
  - 多 cwd → 临时把 TA6 绑定那刻夏后 label 精确 `[anaxa,1]`，title 为完整 seat dir 与 `D:\DeepSeek Harness\1`；DELETE 已回滚。单 cwd 结构测试 label=`0` PASS
  - 未知卡隔离 iframe 载荷 → `amphoreus-future-card` 在 all 画布生成真实 card，thread-color=`hsl(164 45% 52%)`、badge=`未来席`、generic=`true`、sticker=`false`、face=`未来面`，未改真实 suite PASS
  - 终态 → prefs magazine=`light/config`、临时 TA6 binding=`0`、服务 PID `60676`、stderr=`0` bytes PASS
- 人工断言：✓ late-binding key 含 session/skill/hero；✓ currentSessionId 与 camera marker 均在提前 return 前处理；✓ 未复制英雄色表；✓ binding source 只留数据不进可见正文；✓ draft 无 folio/badge；✓ full magazine、总页数与 graph 算法未改；✓ portal 打开不泄漏上次 Tab seat hint。
- 偏离与理由：任务书明写代码只会产生一处 close，却又要求 `app.js≥2`；新增真正可用、仅嵌入 portal 显示的 iframe close 与 Esc 两条路径，避开顶层无父窗口按钮。任务书 one-shot `tabEntered` 会吞 TC8 late binding，保留该字段并以 session+seat key 作为真正去重。独立审查发现并修复 portal 恢复旧 seat 与 camera marker 泄漏两项。
- 遗留：主 suite 没有第14张未知视觉卡，故用同源真实 iframe+隔离 host payload 执行 DOM 分支；未污染实际 skills/profile/store。
## TC10：侧栏总览入口与 shell Portal 覆盖层 — 2026-09-05 04:28
- commit: 903ee42
- 动手前核对：任务书 `2375-2434`；`sidebar.footer.action`/`shell.overlay` 均为 root list slot，overlay anchor=`display:contents` 且平台层 pointer-events none→child auto；现有 model/workspaces/seatDeps/seatTheme 单例与 AmphoreusMark 可复用 PASS
- 验收：
  - 聚焦 → `tests 37; pass 37; fail 0; skipped 0; duration_ms 519.3411`；全量 → `tests 238; pass 237; fail 0; skipped 1; duration_ms 2493.8693` PASS
  - typecheck/build/diff/CSS parse → 全 exit `0`；build derive/client/host=`28.87/170.72/188.25 kB`，portal CSS parsed bytes=`1314`；clsx 为任务指定且已正式依赖，构建仅提示、未失败 PASS
  - 静态 → footer/overlay registrations=`1/1`、mode=portal=`1`、openPortal index=`2`、slots total=`9`、AmphoreusMark export=`1`、CSS hex/rgba=`0/1`（唯一 panel shadow）、portal fetch/appendChild/ctx=`0/0/0`、Workbench open:false=`1` PASS
  - 宽栏入口位于设置上方；点击后 dialog=`1`、portal iframe=`1`、aria-pressed=`true`，iframe 实际聚焦；宿主 X、宿主 Escape、iframe Escape、scrim 5px 空白点击均实测关闭 PASS
  - 关闭后 dialog=`0`，`shell.overlay` anchor=`1` 且 children=`0`，页面点击不被空覆盖层拦截 PASS
  - 已有会话导航 → 当前昔涟时门户点那刻夏，title 从 `TC4修复后席内新建验收` 切到最新 `TC6那刻夏名牌验收`，overlay 关闭、名牌=`那刻夏 · 代码` PASS
  - 全体会议 → 当前 title 前后均为 `TC6那刻夏名牌验收`、overlay 关闭且不新建/切会话 PASS
  - 无会话导航 → 门户点万敌创建并打开 `session-f679980f-4569-4649-a220-a50f40ee019e`，binding=`amphoreus-mydei/seat-new/done`，总 bindings=`10`，侧栏当前高亮=`万敌 1 段会话` PASS
  - 窄栏 → footer 保留 aria-label/title=`翁法罗斯总览`、pressed false、共享 mark img/svg=`1`，视觉快照不显示文字；点击仍可打开 PASS
  - Tab 内「全部角色」→ overlay=`1` 且底层 `.main-stage=1`；关闭后底层 canvas=`1`、card badge 仍 `那刻夏`，没有把原 Workbench换成本地 portal PASS
  - 服务终态 → PID `60676`、HTTP `200`、stderr=`0` bytes PASS
- 人工断言：✓ store snapshot 稳定且 open/close 幂等；✓ Overlay hooks 全在 conditional return 前；✓ iframe onLoad 走 TC8 map-opened；✓ openSeat 先 close，再按 TC3 最新非归档 session 或 TC4 默认预绑定创建；✓ projected workspaces 而非 raw controller 注入 bridge；✓ portal 与 Tab 共用同一 model/theme/magazine/seatTheme。
- 偏离与理由：任务书文件表漏列、步骤却明确要求导出 `AmphoreusMark`，故把 `brand.tsx` 纳入本任务。任务书 Portal hook 简写遗漏 theme/magazine 与 map-opened，本实现复用 TC8 可选桥并传入同一稳定实例，避免暗色/full 门户失配。
- 遗留：TC10 阶段全体会议只关闭覆盖层；TE1 将按既定任务改为总空间会话/队列。多标签页 Portal store 各自为内存态，刷新默认关闭。
## TC11：客户端装配顺序、类型与回归收口 — 2026-09-05 04:55
- commit: 440a6a9
- 动手前核对：实际执行 `sed -n '2438,2545p'` 核对任务书；最终依赖列表为 slots/locale/theme/sessions/uiConversation/workspaces/uiWorkspace，九个槽位及 TC3–TC10 单例均已存在，跨插件 imports 均为 type-only PASS
- 验收：
  - 新增 `tests/client-assembly.test.ts`；聚焦 → `tests 4; pass 4; fail 0; skipped 0; duration_ms 120.679`；默认全量 → `tests 242; pass 241; fail 0; skipped 1; duration_ms 2706.9925` PASS（唯一 skip 为未设置 `AMPHOREUS_REAL_SUITE` 的预期集成门）
  - 真实套件 → `AMPHOREUS_REAL_SUITE=C:\\Users\\cangm\\.codex\\skills node --test tests/suite-real.test.ts` 得 `tests 1; pass 1; fail 0; skipped 0; duration_ms 228.7538` PASS
  - `npm run build` → derive/client/host=`28.87/170.83/188.25 kB`；typecheck、build、`git diff --check` 均 exit `0` PASS
  - 静态 → `ctx.slots.inject=9`；跨插件非 type import=`0` 行；`uiWorkspace=1`；README「席位与目录」=`1`；model/themeBridge/magazineBridge/seatLayer/seatTheme/portal/workspaces/seatDeps/sessionsFace 均唯一，`children=0` PASS
  - 注册顺序锁定为词典 → model → 全局主题 → seatLayer → 席位换装 → portal → model start → 品牌 → garnish → 设置 → 席位侧栏 → 名牌 → 总览入口/覆盖层 → 工作台；README 只保留后续 `M3`，并写明席位绑定与官方目录边界 PASS
  - 重启服务后 state=`L0`、cards=`13`、seatDirs=`13`、派生素材=`84`；缺失 binding DELETE=`404`；PID `59556`、HTTP=`200`、stderr=`0` bytes PASS
  - fresh 浏览器 → 官方 workspace tree=`null`、自定义 seat browser=`1`、host seat=`anaxa`、active layer=`1`、brand=`rgb(35, 102, 77)`、名牌=`那刻夏 · 代码`；iframe card/badge/selected=`1/1/1` PASS
  - 门户 → footer=`1`，dialog/portal iframe=`1/1`、pressed=`true`；关闭后 dialog=`0`、pressed=`false`、底层 selected card=`1`，原工作台状态保留 PASS
- 人工断言：✓ 所有控制器单例先创建再注入；✓ garnish 唯一 DOM 装饰例外保留且目录图标分支自然失效；✓ README 不把席位与 cwd 目录混为一谈；✓ fresh page 水合后 C 章全部组件共存。
- 偏离与理由：任务书写槽位数 `≥9`，测试收紧为当前契约的精确 `9`；新增装配回归测试以防后续 E/F 重排破坏 C 章顺序。
- 遗留：E 章尚需兑现总空间派发能力；C 章验收使用前序 TC2–TC10 已建立的真实测试会话，章末将按官方接口清理本章新增状态。
## C 章完成定义：席位绑定、独立工作区与门户 — 2026-09-05 05:01
- commit: 205004a; tag: chapter-C
- 范围：TC1–TC11 共 `11` 项全部各自提交；执行顺序 C 位于 D 后，依赖的 D 章主题、纹样与杂志契约均已落地；`chapter-A`、`chapter-B`、`chapter-D` 基线标签保持不变。
- 机器验收：
  - `npm run build` → exit `0`，derive/client/host=`28.87/170.83/188.25 kB`；`node --test tests/*.test.ts` → `tests 242; pass 241; fail 0; skipped 1; duration_ms 2706.9925`，唯一 skip 为无真实套件环境变量时的预期门 PASS
  - 必需测试 `injector-inherit/client-seat-model/client-seat-wallpaper/seat-theme` 全部存在；`session/created=1`、`fork-inherit=4`、`freshFork=3`；DELETE route=`2`、seatDirs=`1` PASS
  - 旧 `WorkbenchThread|SeatResolver|createSeatResolver=0`；client/iframe `seatHeroId=0/0`；`putBinding` 第 `61` 行先于 `sessions.create` 第 `64` 行；回滚 DELETE 定义+调用=`2` PASS
  - sidebar priority -10=`1`、children=`0`、seat browser markers=`2`、seatViewsFrom=`5`；header order -20=`1`；footer/overlay=`1/1`；portal mode=`1`；openPortal=`2` PASS
  - seat theme 注册=`1`、seatLayer.apply=`3`、GLOBAL_SEAT_HERO seat-model/theme=`1/3`、firstframe layer/wallpaper=`5/1`、decode=`1`、260=`1`、旧 overrideTokens=`0` PASS
  - workbench thread-color important=`0`（grep exit `1`）、badge JS/CSS=`1/2`、旧蓝/last-seat/bindingBySession=`0/0/0`、cwd group=`1`；双向 open-seat/open-portal=`2/2`、close=`2`、共享 bridge=`2` PASS
  - 三个新 CSS module 禁止 hex=`0`、禁止 rgba=`0`，portal 仅 panel shadow 一处 rgba；locale zh/en 键集合相等、portal key=`2`；uiWorkspace=`1`、CSSProperties=`5` PASS
  - 运行态重启后 state L0、cards/deployed seats/seatDirs=`13/13/13`、缺失 binding DELETE=`404`、HTTP=`200`、stderr=`0` bytes PASS
- 浏览器验收：
  - fresh load 后侧栏席位组、目录组、13 席、席内新建、名牌、逐席主题/壁纸、工作台承办徽记与 cwd 分组同时存在；官方 workspace tree 已被唯一替换，未出现双浏览器 PASS
  - 实测 fork 继承为 `fork-inherit`；席内创建为 `seat-new/done`；晚到绑定会原地更新身份；无绑定与昔涟均保持全局层；流式与快速切席回归无重复淡入 PASS
  - 门户覆盖层的按钮/X/Escape/scrim/iframe Escape、已有席导航、无会话创建、全体会议 close-only、窄栏图标和 Tab「全部角色」入口均通过；关闭后底层工作台与选中卡保留 PASS
  - 画布已验证已知席色/徽记/贴纸、未知 `hsl(...)` 通用徽记、多 cwd 目录标签与当前卡定位；卡片尺寸、folio、full magazine 与正文投影契约未回退 PASS
- 恢复状态：主题与杂志已恢复系统/light-config；临时 late-binding 已删除；服务 PID `59556` 正常。7 个 C 章专用 binding DELETE 均 HTTP `200`，8 个确认测试会话经官方 `workspace/archiveSession` 均 HTTP `200/result.ok=true`，TC5 fixture workspace 经官方 `workspace/delete` 为 HTTP `200/deleted=true`；复核测试 binding=`0`、workspace id 不存在、8 份权威 session 目录全部保留、fixture 目录保留、stderr=`0` bytes。
- 偏离与理由：任务书若干行号随 A/B/D/C 实施迁移，均以动手前 `sed -n` 与当前平台源码重新定位；未知视觉卡用隔离同源 iframe fixture 覆盖，未改真实套件；具体差异逐项写在 TC1–TC11。
- 遗留：总空间派发、移交观察、站位轨、接通尾页与台账由 E 章承接；C 的全体会议入口在 E TE1 从 close-only 升级为同一 Tab 的 all 画布。
## TD7：杂志档位 prefs 覆盖与 iframe 桥 — 2026-09-05 00:01
- commit: 6f6bafa
- 验收：
  - `node --test tests/magazine-mode.test.ts tests/store-seats.test.ts` → `tests 10; pass 10; fail 0; skipped 0; duration_ms 369.6249` PASS（exit: `0`）
  - 全量测试 → `tests 149; pass 148; fail 0; skipped 1; duration_ms 1796.2558` PASS（exit: `0`）；首次全量暴露旧 VM fixture 无 documentElement，生产初始 dataset 写增加存在性守卫后重跑全绿
  - `node --check workbench/app.js`、`npm run typecheck`、`npm run build` 全通过；client `109.53 kB`、host `152.54 kB` PASS（各 exit: `0`）
  - schema/静态门 → domain version=`1`、INITIAL magazine keys=`0`、schema decl=`1`、prefs route=`1`、mode source api/webapi=`1/1`、app/workbench message=`1/1`、bridge decl/inject=`1/1`、`off=0`、config diff=`0` PASS
  - 并发单测：同时写 `magazineMode=full` 与 quick phrases 后两字段均保留，证明继续经 updateAmphoreusGlobal 串行 RMW PASS
  - `git diff --check` → 无空白错误 PASS（exit: `0`）
- 真实运行态事务（D.0.1）：
  - baseline GET prefs → `{"prefs":{"lastSeat":null,"wallpaperCursor":0,"quickPhrases":[],"quickPhrasesInitialized":true}}`；state=`light/config`
  - nonce-gated PUT `{"magazineMode":"full"}` → 响应 prefs 含 `"magazineMode":"full"`；state=`full/prefs` PASS
  - fresh browser/map-ready → iframe `documentElement.dataset.magazine=full` PASS
  - nonce-gated PUT `{"magazineMode":null}` → 响应 prefs 删除该键；state=`light/config`；同一 fresh browser 约 `900ms` 后 dataset 实时变为 `light` PASS
  - 最终 GET prefs 与 baseline JSON 逐字相等=`True`；四个 runtime 临时文件已逐一删除；服务 PID `36104` running、HTTP `200`、stderr=`0` bytes PASS
- 人工断言：✓ 存储值 only light/full/absent，null 仅为删键命令；✓ omitted 不动；✓ source 精确标 prefs/config；✓ client 写入用 nonce 并 await refresh；✓ magazineBridge 稳定构造，effect 初发、model 变化与 map-ready 重发；✓ iframe 仅接受 light/full 且同值不重绘；✓ portal 可直接 render，canvas 经 canReplaceView；✓ 未提前实现 TD11 设置控件。
- 偏离与理由：初始 dataset 赋值加 `document.documentElement` 存在性守卫以兼容既有 VM probe；真实浏览器路径语义不变。任务书目标中的设置区点击控件由明确后置 TD11 实现，本任务只提供持久化与桥接能力。
- 遗留：无。
## TD8 G21：杂志 full 档 Q&A／封面／栏目版式 — 2026-09-05 00:23
- commit: 2d51cc2
- 验收：
  - TD7+TD8 聚焦 → `tests 9; pass 9; fail 0; skipped 0; duration_ms 346.1989` PASS（exit: `0`）
  - 全量最终 → `tests 154; pass 153; fail 0; skipped 1; duration_ms 1796.3757` PASS（exit: `0`）
  - `npm run typecheck`、`node --check workbench/app.js`、Lightning CSS 解析、`npm run build` 全通过；client `109.53 kB`、host `152.54 kB` PASS（各 exit: `0`）
  - 静态门 → 两处 `magazine-${state.magazineMode}`=`2`、行首 `.magazine-full`=`32`、`.magazine-light` CSS=`0`、type shorthand=`12`、data-cover=`2`、data-volume=`5`、data-title=`4`、data-folio/data-folios=`1/1`、data-turn 仍=`3` PASS
  - CARD_WIDTH/CARD_HEIGHT `310/276` 与 CSS 尺寸不变；main-stage before/after 各=`1`；未新增 full render 函数或 innerHTML 分叉 PASS
  - 中途第一次全量因新测试把任务书双引号 selector 写成单引号而 `fail=1`；CSS 改为精确 `[data-message-seq=""]` 后全绿
  - `git diff --check` → 无空白错误 PASS（exit: `0`）
- 浏览器验收：
  - light 基线 → shell=`magazine-light`、正式卡=`16`、首卡 folio=`01/06`；PUT full 后 shell=`magazine-full`、卡仍=`16`、Q pseudo fontSize=`22px`/weight=`800`、页码 content=`"01 / 06"` PASS
  - 折叠首线程 → 同线程可见卡 `6→1`，首卡 `data-folios` 仍=`06`；随后重新展开恢复 `6` PASS
  - full 门户 → 13 张 portal-card 全有 data-volume，full kicker=`CHRYSOS · XIII VOLUMES`/display block，原 kicker display none，阿格莱雅角标 pseudo=`"No.01"` PASS
  - full 阿格莱雅侧栏 → CHRYSOS/No.01/title 三个伪元素可见，data-volume=`01`；TD10 前无 data-cover，原图 aspect=`744 / 1211`（派生后 3:4 联合门留给 TD10）PASS
  - full 详情 → header pseudo=`"全体会议 · 栏目"`、user=`Q`、assistant=`A`、seq pseudo=`"§ 7"` PASS
  - 首次 full→light 实测仍调用 TD7 完整 render，虚拟卡 DOM `24→16`，不满足“结构不变” FAIL；改为 mode 消息只原位 `syncMagazineClass`，不 render/defer，并更新 TD7/TD8 回归测试后重跑全门 PASS
  - 修复后 fresh browser：light→full 正式卡 `16→16`；full→light `16→16`，Q/folio 装饰随 class 即时出现/消失 PASS
  - 真实草稿输入 `TD8-原位切档焦点保留`：切 full 后 textarea value 不变、active=`true`、同一 shell 原位变 `magazine-full`，draft folio pseudo=`none`；取消草稿并恢复 null 后 state=`light/config` PASS
  - 最终服务 PID `22116` running、HTTP `200`、stderr=`0` bytes；prefs 恢复无 magazineMode、临时 cookie/nonce 已删除 PASS
- 人工断言：✓ folio 分母来自折叠前 allCards；✓ data attrs 两档共用，档位只切 class；✓ draft 不显示空 folio；✓ sidebar/portal 优先 coverUrl、缺失回退 chronicle；✓ full CSS 优先消费 `--thread-color` 并保留 selected halo，为 TC9 逐卡席色留路；✓ light 无专属 CSS；✓ DOM 与交互节点不因切档重建。
- 偏离与理由：TD8 同时要求“不改 `--thread-color`”与 `#3478f6=0`，但这三处 producer 明确归后置 C/TC9；当前保持 `3`，并把 0 作为 TD8+TC9 联合门。为满足 DOM 数量、焦点与失焦详情输入不丢失的更强验收，档位变化只同步现有 shell class，不再执行 TD7 的完整 render。Folio selector 收紧到具备 data attrs 的正式卡，避免草稿显示空页码。
- 遗留：`#3478f6 3→0` 与逐卡多席色由 C/TC9；派生 cover 的 data-cover/3:4 实机门由 TD10。
## TD9：零依赖 ZIP／WebP 素材派生器与独立 CLI bundle — 2026-09-05 00:48
- commit: dc5ae76
- 动手前核对：
  - `magick rose: -gravity North -crop 3:4 +repage -format '%wx%h' info:` → `35x46` PASS
  - Node `v24.14.1`、ImageMagick `7.1.2-25 Q16-HDRI`（含 webp）；71 个权威输入路径 missing=`0`、总 bytes=`304946013`；真实 cache 初始不存在 PASS
  - 13 个真实 ZIP 只读解析 → entries=`158`、顶层 `00_` cover=`13`、cover bytes=`15739255`，全为 method 8/UTF-8 flag 2048 PASS
- 自动化验收：
  - `node --test tests/host-zip.test.ts tests/host-derive.test.ts` → `tests 12; pass 12; fail 0; skipped 0; duration_ms 717.8086` PASS（exit: `0`）
  - 完整 synthetic fixture → 首次 written=`84`/skipped=`0`/failed=`0`，二次 written=`0`/skipped=`84`；covers progress=`13` hero jobs、stickers=`26` files、wallpapers=`6` PASS
  - 全量测试 → `tests 166; pass 165; fail 0; skipped 1; duration_ms 1815.4564`；typecheck PASS（各 exit: `0`）
  - 安全 clean-lib build → JS 恰 `client.js,derive.js,index.js` 三个，unexpected=`0`，index/derive sibling imports=`0`；derive `28.87 kB`、client `109.53 kB`、host `152.54 kB` PASS
  - `npm pack --dry-run --json --ignore-scripts` → files=`55`、packageSize=`287901`、unpackedSize=`1104748`；index/client/derive 六个 JS+map 与 CLI 七项全在包内，unexpected lib JS=`0` PASS
  - `git diff --check` → 无空白错误 PASS（exit: `0`）
- 安全边界：✓ EOCD/central/local 全范围与签名校验；✓ fatal UTF-8 后 latin1；✓ method 0/8、CRC、entry/source identity；✓ 拒绝 encryption/ZIP64/异常 flags；✓ 64MiB ZIP/32MiB entry/200× ratio/4096 entries；✓ 封面只认唯一根级 `00_`；✓ cache/source realpath containment；✓ async spawn pipes + windowsHide + shell:false + stdin.end；✓ output/stderr caps、120s timeout、single settle；✓ RIFF/WEBP 与同目录原子 rename；✓ 单文件失败继续且清临时文件。
- 真实派生事务：
  - `.runtime` staging canary（covers+wallpapers）→ written=`32`、failed=`0`、elapsed=`9350ms` PASS
  - staging `--force` 全量 → written=`84`、skipped=`0`、failed=`0`、elapsed=`18454ms` PASS；WebP count=`84`、bytes=`9633300`、13 hero dirs 各=`5`、global=`19`（chimera=`12`）、非 ASCII 名=`0`、坏签名=`0`
  - 尺寸 → aglaea cover-34=`1080×1440`（0.75）、cover-169=`1080×608`（1.7763）、wallpaper-0=`2139×2560` PASS
  - staging 二次运行 → written=`0`、skipped=`84`、failed=`0`、elapsed=`88ms` PASS
  - 71 个源文件 size/mtime/SHA-256 前后 manifest 完全一致=`true` PASS
  - 真实 cache 原本不存在；停服务后验证 staging source 在 `.runtime`、target parent 精确为 `.dsh-home/amphoreus`，目录级提升为 `assets-cache`；target WebP=`84`，source 不再存在；重启 HTTP=`200`、stderr=`0` bytes PASS
  - 按任务书真实 data-dir 再跑 CLI：首行 `data-dir: D:/DeepSeek Harness/.dsh-home/amphoreus`，written=`0`、skipped=`84`、failed=`0`、elapsed=`93ms` PASS
  - 当前 cache manifest 已记录 84 个相对路径/size/mtime/SHA-256；clean-build 前四 bundle 备份在 `.runtime/td9-lib-backup-20260905-004143`，构建成功未触发恢复
- 偏离与理由：covers 进度按任务书示例记 13 个 hero job，但 DeriveResult 按两个 cover 实际文件计 26；完整结果精确为 65 席位文件 + 19 全局文件=`84`。为可控测试增加可选 DeriveRuntime seam，生产单参数签名与默认真实 spawn 不变。任务书描述 Vol.04 “封面约28MB”实际是整 ZIP 约29MB，封面约2.46MB；安全上限按实物加冗余。
- 回滚与终态：原 cache 为 absent，回滚动作是停服务后删除精确 `assets-cache`；本任务目标要求生成并供 TD10 服务，故当前有意保留已验证的 84 文件 cache。权威 sessions、两 storage-domain 与原素材均未改。
- 遗留：无。
## TD10：确定性扫描并安全服务派生素材 — 2026-09-05 01:11
- commit: e0b250d
- 验收：
  - `node --test tests/derived-assets-webapi.test.ts tests/derived-firstframe.test.ts tests/workspaces-derived.test.ts` → `tests 8; pass 8; fail 0; skipped 0; duration_ms 314.076` PASS（exit: `0`）
  - 扩展聚焦（含原 firstframe/motif）→ `tests 17; pass 17; fail 0`；全量 → `tests 174; pass 173; fail 0; skipped 1; duration_ms 2047.4483` PASS
  - `npm run typecheck`、`node --check workbench/app.js`、`npm run build` 全通过；derive `28.87 kB`、client `110.10 kB`、host `159.68 kB` PASS（各 exit: `0`）
  - 真实 cache 开始/结束均 files=`84`、bytes=`9633300`、manifest SHA-256 `ad4e937b6b9cd3904ca7ca61500065934024039171875bbb08c270073d11ec68`，本任务代码阶段只读未改 PASS
  - `git diff --check` → 无空白错误 PASS（exit: `0`）
- 运行态（D.0.1）验收：
  - state → derivedCount=`84`、derived length=`84`、first=`_global/sticker-brand.webp`、last=`tribbie/sticker.webp`、running=`false`、lastDerive=`null` PASS
  - GET aglaea/cover-34 → `200 image/webp 189150`；HEAD → `200 image/webp`、body `0`，content-length=`189150`、cache-control=`private, max-age=86400`、nosniff PASS
  - missing=`404`、`--path-as-is` traversal=`404`、裸 POST=`405` PASS
  - 首帧实际 style 使用 `/amphoreus/derived/_global/wallpaper-4.webp`（sidebar wallpaper-5 同为派生）PASS
  - 浏览器门户 → cards=`13`、data-cover=`13`、derived `.webp` art=`13`、首图 `/amphoreus/derived/cyrene/cover-34.webp`、aspect=`3 / 4` PASS
  - 阿格莱雅席 → sidebar cover `/amphoreus/derived/aglaea/cover-34.webp`、aspect=`3 / 4`、sticker `/amphoreus/derived/aglaea/sticker.webp`、main-stage card art `/amphoreus/derived/aglaea/card.webp` PASS；随后恢复全体会议
  - 最终服务 PID `11260` running、HTTP `200`、stderr=`0` bytes PASS
- 本地服务 PATH 修正：
  - 首次重启 state `magick=null` FAIL；原因是 Start 脚本精简 PATH 未保留 ImageMagick。先加入 `magick` 只解析到 `.cmd` shim，Node `spawnSync` 仍 ENOENT FAIL；改为动态查找 `magick.exe` 并加入真实 exe 目录后，复刻服务 PATH 的 Node probe status=`0`
  - `local-deployment/Start-DeepSeekHarness.ps1` PowerShell parse errors=`0`；原 SHA-256 `283EE3CCC832D3D486F0EF7B3BF3FD64A071481DF469F5132EFDD64AA9571D77`，最终 SHA-256 `763EBAAE77D2C938434A02B660FF04A4D83F5C94917DFFFA73F843F134FE3B07`；原件备份 `.runtime/td10-Start-DeepSeekHarness.before.ps1`
  - 修正后重启 state `magick=Version: ImageMagick 7.1.2-25 Q16-HDRI x64 …`、derivedCount=`84` PASS
- 人工断言：✓ host apply await prepareAssets 后才注册 route/firstframe；✓ prepare 并发合并、成功幂等、scan/probe fail-soft；✓ 两层仅普通 ASCII 目录/文件且排序；✓ GET/HEAD 使用 set membership + realpath/open/realpath + dev/ino，原子换档瞬态只重试一次，稳定缺失才删 membership 并发 SSE；✓ derived 独立于 assetsRoot 优先，原图只作已配置 root 的 fallback；✓ firstframe 同顺序。
- 偏离与理由：任务书最小 register 异步 scan 有首请求竞态，增加 idempotent `prepareAssets()` 并在 async host effect 中显式 await；derived route 增加 symlink/TOCTOU 防护与稳定缺失清退。J-4 的席位 URL 实际修改 `client/workspaces-source.ts`。Start 脚本的单字段 PATH 扩展是本机服务满足任务书 magick 非空/TD11 后台派生的必要运维修正。
- 遗留：TD11 强制重派生使用稳定 URL + 86400 浏览器缓存，需要以 query 版本或等价方式 cache-bust；本任务未提前实现 TD11 生命周期。
## TD11：视觉层设置、后台派生与 SSE 进度 — 2026-09-05 01:35
- commit: e54a53a
- 动手前 `sed -n '60,100p' src/host/webapi.ts` 核对 → `SseHub.publish(event: string, value: unknown)`，所有进度/状态调用均按 event,value 顺序 PASS
- 自动化验收：
  - TD11 聚焦（client/host/settings/theme）→ `tests 13; pass 13; fail 0; skipped 0; duration_ms 438.8341` PASS（exit: `0`）
  - 全量最终 → `tests 185; pass 184; fail 0; skipped 1; duration_ms 2214.8636` PASS（exit: `0`）
  - `npm run typecheck`、`node --check workbench/app.js`、Lightning CSS、`npm run build` 全通过；derive `28.87 kB`、client `121.16 kB`、host `184.52 kB` PASS（各 exit: `0`）
  - auth/lifecycle tests → 415→403→400 顺序、strict extra/bad JSON 400、oversize 413、首请求202立即返回、并发第二请求409；success/partial/fatal/scan-fail 全部 running=false 并可重试 PASS
  - host 事件顺序 → start state-change → ordered derive-progress → scan → running=false/lastDerive → final state-change；error/current 文本分别限 2000/500 PASS
  - client tests → progress fail-closed、早到缓存、running 中展示/终态清除、POST racing progress 保留、refresh latest-wins PASS
  - settings 静态门 → 15 zh +15 en、visual panel 位于 runtime/workbench 之间、同步 useRef action lock、两个派生按钮共用 deriveDisabled、root 只读、aria-live、CSS Module 无字面色 PASS
  - `git diff --check` → 无空白错误 PASS（exit: `0`）
- 真实运行态：
  - 初始 state → running=`false`、derived=`84`、lastDerive=`null`、magick 非空；无 content-type POST=`415`，JSON 无 nonce=`403` PASS
  - 设置 → 翁法罗斯 → 视觉层：显示 assetsRoot、cacheDir、已派生 `84`、ImageMagick 版本；点「重档」后 radio checked、reset 出现、iframe 即时 `magazine-full`/Q；点「恢复配置值」后 light checked、reset 消失、iframe `magazine-light` PASS
  - 点「强制全部重做」后约120ms：主按钮文案「正在派生…」且两按钮 disabled；同一任务运行时第二个 nonce POST → HTTP `409`、body `{"error":"asset derivation is already running"}`；state running=`true` PASS
  - SSE 实流 → start/final state-change 各1；derive-progress 共 `71` 个 job 事件：covers 1→13、chronicle 1→13、cards 1→13、stickers 1→26、wallpapers 1→6，顺序完整 PASS
  - 第二轮 UI 中途真实捕获 `covers 2/13 · tribbie cover-34.webp` 与「正在派生…」；结束后显示「已派生 84 个文件」「上次派生 … · 84/0」PASS
  - final state → running=`false`、derivedCount=`84`、lastDerive written=`84`/failed=`0`；服务 PID `64116` running、HTTP `200`、stderr=`0` bytes PASS
  - 派生前已把 84 文件/9633300 bytes cache 复制到 `.runtime/td11-cache-backup-20260905-013024`；两次 force 后当前与备份逐文件 relative/size/SHA-256 diff=`0`，证明内容确定性相同；有意保留当前新 mtime cache
- 人工断言：✓ running gate 在无 await 同步段设定；✓ 202 只表示接纳，后台 rejection 内部收口；✓ final state-change 晚于 scan；✓ client 不从 host 模块做 runtime import；✓ named action 避免把派生误标为“重新解析”；✓ assetsRoot 不可编辑；✓ reset/radio/两个派生按钮都共享 busy 门；✓ secondaryButton disabled 也有可见样式。
- 偏离与理由：相对最小伪码增加 start state-change、严格 JSON、可控 derive/probe seam、SSE 文本上限、pending progress、refresh latest-wins 与同步 UI 锁；这些闭合并发和时序，不改任务协议。stable `.webp` URL + `max-age=86400` 的强制重派生 cache-bust 仍与 TD10 URL 终态契约冲突，本任务按既定裁决未改变 URL。
- 回滚与终态：magazine prefs 已恢复 config/light；cache 内容与备份逐字节相同且服务扫描为84，故无需恢复目录；权威 sessions/storage-domain 未改。TD11 临时 cookie/nonce/second-response 与 backup 在 D 章总验收后清理。
- 遗留：稳定派生 URL 的浏览器 24h 缓存刷新策略需后续版本化 URL 设计；不影响新安装、首载或本章验收。
## TD12：素材包文档、NOTICE/HANDOFF 对账与回退条件裁决 — 2026-09-05 01:41
- commit: 4b624ce
- 验收：
  - README `## 素材包`=`1`、`assets-cache`=`1`、`npm run derive`=`1`、`--data-dir`=`2`、`09阿格莱呀.jpg`=`2`；Markdown image=`0` PASS
  - README 提供 profile insert 示例、6 个精确目录、6 张壁纸名、13 席 HERO_VISUALS 文件表、build/derive/magick/dataDir/cache/设置路径与版权边界；未建议把素材复制进包目录 PASS
  - README 现状移除已完成 G2/G21，magazineMode 配置说明与 TD7/TD11 一致；新增稳定 URL 24h cache 已知限制 PASS
  - NOTICE 精确短语 `magazine 'full' layout`=`1`；MIT 原文、版权行与既有 DSW/无正文说明未改 PASS
  - HANDOFF 第1–4行与 HEAD 逐字相同、`## 7` 仍=`1`；旧 styles 行只加 `[已失效]` 纯前缀，新增现行 token 化说明、三种 D 消息、派生进度与 `### 7.5` 实测记录 PASS
  - `待 token 化` raw grep=`1`，但唯一命中位于 `[已失效]` 原文；非失效命中=`0` PASS（语义门）
  - fallback condition：全套测试虽绿，但 first map-ready 为 1 rAF、theme-token push 为 2 rAF，没有 token-before-ready happens-before；三席×双主题统一人工矩阵也未闭合，故按任务书不执行两遍 sed。DSW fallback 保留=`292`，文件头仍为 Step 1 PASS
  - `npm test` → `tests 185; pass 184; fail 0; skipped 1; duration_ms 2108.3823` PASS（exit: `0`）
  - `npm run build` → derive `28.87 kB`、client `121.16 kB`、host `184.52 kB` PASS（exit: `0`）
  - `git diff --check` → 无空白错误 PASS（exit: `0`）
- 人工断言：✓ README 不嵌图、不链接原图下载源；✓ Calendar 作为完整清单列出并注明当前 CLI 不消费；✓ HANDOFF 历史 append-only；✓ 验证记录只写已观察值；✓ fallback 的保留理由具体且可复验。
- 偏离与理由：TD12 局部文字要求直接改 HANDOFF 原句并使 raw `待 token 化=0`，与总纲 §0.6.13“不删/不改原文，只加失效前缀”不可同时成立；服从全局硬规则，采用 `[已失效]` + 新行，语义活跃计数为0。README 目录表补入实际存在的 `翁法罗斯日历/`，避免每席 calendar 列无目录归属。
- 遗留：第二步 fallback 删除明确未执行；只有在建立 token-before-first-ready 握手并完成至少三席 light/dark 同一人工矩阵后才能重审。
## D 章完成定义：十三套视觉、杂志语法与派生素材 — 2026-09-05 01:42
- commit: 630df08
- tag: `chapter-D`
- 最终测试与构建：`npm test` → `tests 185; pass 184; fail 0; skipped 1; duration_ms 2108.3823`；`npm run build` → derive `28.87 kB`、client `121.16 kB`、host `184.52 kB`；typecheck/node/CSS/diff 均 exit `0` PASS
- 机器门汇总：
  1. D 五个指定测试文件均存在，全量 fail=`0` PASS
  2. token registry alias/specific=`77/10`，异常 token=`0` PASS
  3. theme-tokens host/app=`1/1`，theme/change=`1` PASS
  4. styles DSW vars=`313`、dark selector=`1`、thread important=`0`、blue=`25` 且 fallback=`25`、raw hex=`4≤8` PASS
  5. seat layer source=`1`、seat-changed app=`3`/host=`1`；contrast=`104` 行、FAIL=`0` PASS
  6. Cyrene 排除逻辑显式存在 PASS
  7. motif 两个共享文件存在，payload motifDataUri=`3`、CSS/app refs=`2/2`、直接子层级规则=`1` PASS
  8. font-face=`0`、display var uses=`14`、settings def/use=`1/1`、typography.css absent、type shorthand=`12` PASS
  9. magazine schema/source/message 均存在；当前 canReplaceView calls=`11`。magazine 分支不再调用它，而以 syncMagazineClass 原位切换，DOM/焦点行为门更强且实测通过
  10. magazine-full selectors=`32`、data-folio=`1`、data-volume=`4`、data-cover=`2`、CARD_HEIGHT=`1`；app 固定蓝=`3`，按任务书同段 J-7 保留到后置 C/TC9，届时联合门变0
  11. lib JS 恰 client/derive/index 三个、unexpected=`0`、deriveConfig=`2`、白名单 derive/CLI=`1/1`、媒体扩展=`0`、sibling imports=`0/0`；spawnSync 仅 probe 一次，实际转换 spawn=`1` PASS
  12. derived route refs=`5`、coverUrl/workspaces+app 均存在、assetsCacheDir 与 derivedWallpaper 已接线 PASS
  13. settings.visualHeading=`2`、client derive/setMode=`2`、derive route=`1`、derivedCount 插值调用=`1` PASS
  14. README 素材包=`1`、NOTICE magazine phrase=`1`、data-dir≥1；HANDOFF raw 旧词=`1` 但唯一命中已失效，active=`0`（append-only 语义门）
- 运行态：state=`light/config`、cache path 字符串、running=`false`、derived=`84`、magick 非空；derived GET=`200 image/webp`、traversal=`404`、derive 无 nonce=`403`、stderr=`0` PASS
- 人工三点：
  - DSH light/dark 后 iframe token、theme、card/sidebar surface 在约180ms内同步；协议规定双 rAF，故不虚报“同一帧”；草稿由原位 token/motif/class 更新保持 value 与焦点
  - 阿格莱雅 light/dark 分别为金米白/暗金深棕；昔涟不安装席位层；门户恢复 brand `rgb(138, 104, 28)`
  - 设置区 full 即时出现 Q（22px/800）与 `01 / 06`，折叠分母不变；light 恢复装饰消失且修复后卡片数 `16→16`；派生 cover 实测 aspect `3 / 4`
- 已知书内冲突与裁决：① `canReplaceView` 两分支门被 TD8 的不重建 DOM 验收取代；② D-before-C 与 TC9 归属决定固定蓝在 D 时为3；③ HANDOFF raw=0 与历史只加失效前缀冲突；④ “同帧”与规定双 rAF 冲突。全部按更强全局/行为契约记录，不用伪计数规避。
- 回滚与终态：所有 prefs 恢复 config/light；cache 保留已验证84文件；TD11 backup 已在内容一致后安全删除；服务运行、stderr0；源素材与 sessions 未改。
- 遗留：第二步 CSS fallback 按条件明确保留；固定蓝由紧接的 C/TC9 清零；稳定 URL 强制重派生 cache-bust 为后续版本化设计项。
## TC1：Binding DELETE API 与队列语义 — 2026-09-05 01:54
- commit: 7301cac
- 动手前核对：当前 #bindingsRoute=`409`、#authorize JSON gate=`826`；DELETE 原本会被 content-type 415；上游 table.delete 返回 Promise<boolean> 且在队列执行槽判存在性 PASS
- 验收：
  - `node --test tests/bindings-delete.test.ts` → `tests 3; pass 3; fail 0; skipped 0; duration_ms 300.5128` PASS（exit: `0`）
  - 真实 HTTP fixture：missing DELETE（无 body/content-type+正确 nonce）=`404 {"error":"binding not found"}`；existing=`200 {"deleted":true}` 后第二次=`404`；无 nonce=`403` PASS
  - 排队并发：PUT 已入队但 commit 阻塞时 DELETE 直接入同一队列；放行后 PUT=`200`、DELETE=`200`、最终 GET=`404` PASS
  - 静态：DELETE 分支 table.get calls=`0`、direct `await table.delete`=`1`；BindInput enum=`1`、SESSION_ID regex=`1`、WorkbenchThread/SeatResolver=`0` PASS
  - 全量 → `tests 188; pass 187; fail 0; skipped 1; duration_ms 2144.8056`；typecheck/build/diff 全通过，host `184.75 kB` PASS
  - 本地服务 Stop/Start 后 state seatDirs=`13`；DELETE 固定不存在 ID → HTTP `404`、body 精确 `{"error":"binding not found"}`，非415/403；stderr=`0` bytes PASS
- 人工断言：✓ DELETE 只豁免 JSON Content-Type，不豁免 Host、connection 或 nonce；✓ 归属真相源仍只有 bindings；✓ 直接采用 delete job 的布尔结果，封闭 get→delete TOCTOU。
- 偏离与理由：任务书旧伪码先 get 再 delete 与 storage-domain 队列契约冲突；按上游权威及 C 章裁决改为直接 `await table.delete(sessionId)`。
- 遗留：无。
## TD2 G2：宿主页向 iframe 桥接 87 个主题 token — 2026-09-04 22:35
- commit: 1722602
- 验收：
  - `node --test tests/client-theme-bridge.test.ts` → `tests 3; pass 3; fail 0; skipped 0; duration_ms 115.5069` PASS（exit: `0`）
  - `npm run typecheck` → 无诊断 PASS（exit: `0`）
  - `npm test` → `tests 127; pass 126; fail 0; skipped 1; duration_ms 1590.629` PASS（exit: `0`）
  - `npm run build` → client `91.92 kB`、host `152.02 kB` PASS（exit: `0`）
  - 静态门 → `themeBridge` 声明=`1`、inject 引用=`1`、`amphoreus:theme-tokens` 构造=`1`、旧 `amphoreus:theme` 发送=`0`；指定五文件均只有一个 EOF newline PASS
  - `git diff --check` → 无空白错误 PASS（exit: `0`）
- 人工断言：✓ `readDswTokens` 只遍历 TD1 的 87-token 固定清单、从 `document.body` 计算样式读取、trim 并跳过空值；✓ `themeBridge` 在 apply 顶部一次性构造，slot inject 只引用稳定对象；✓ 初始订阅、theme/change、iframe onLoad、map-ready 共用同一 push；✓ 每次读取推迟两帧；✓ 卸载先置 inactive、退订并取消全部 pending rAF；✓ 不发送 static token 与旧布尔主题消息。
- 偏离与理由：在任务书双 rAF 基础上增加 active fence 和逐帧取消集合，避免组件卸载或 theme 引用换代后向旧 iframe 发送过期 token。
- 联合回填（TD3）：浏览器 fresh load 已确认 iframe root 收到 token；light→dark→跟随系统/light 均与宿主 body 同值，TD2 浏览器依赖已闭合。
## TD3 G2：iframe 主题接收与画布颜色变量化 — 2026-09-04 23:02
- commit: 0e0ab9d
- 修改前基线：app.js SHA-256 `5E045B137AFFA87CF1ECF263235E544067A7132CA50DD2F1AC4473ADB66134B6`；styles.css SHA-256 `4CD52988C8BED0C2B5BA5F17891B830FC31A146B8C3BCECCA6556A860A9B440A`；CSS `534` 行、DSW var=`4`、dark selector occurrences=`187`（`162` 行）、`#3478f6=30`、blue fallback=`0`、raw hex=`518`、thread-color important=`1`；卡片 `310×276`。
- 验收：
  - `node --check workbench/app.js` → 无输出 PASS（exit: `0`）
  - TD2+TD3 聚焦测试 → `tests 8; pass 8; fail 0; skipped 0`；扩展主题/画布聚焦复核 → `tests 19; pass 19; fail 0; skipped 0; duration_ms 153.384` PASS
  - 全量测试 → `tests 132; pass 131; fail 0; skipped 1` PASS（exit: `0`）
  - `npm run typecheck` → 无诊断；Lightning CSS 实际解析 → `LIGHTNINGCSS_PARSE_OK 54514`；`npm run build` → client `91.92 kB`、host `152.02 kB` PASS（各 exit: `0`）
  - CSS 机器门 → 行数=`376`、DSW var=`292`、dark selector=`1`、blue=`25` 且 fallback blue=`25`、hex=`285`/fallback hex=`284`/raw hex=`1`、thread-color important=`0`、static token=`0`、非法 `*/--dsw`=`0` PASS
  - 唯一 raw hex 为 `.portal-meta` 压图白字 `#fdfbff`；任务书明确允许保留 PASS
  - `.thread-card` CSS `310×276` 与 app.js `CARD_WIDTH=310/CARD_HEIGHT=276` 全部不变；`view-switch=0` PASS
  - 修改后 SHA-256：app.js `AE6B495553AD69E66BD58B3C5AE06E7F3C085A5D454F9C190C4E033D9832F933`；styles.css `B4596378CAF3C07B9E020E1E3408B9F37CD6AE09D6186AB5ADF8EF39FC83FBF4`；receiver test `C0BBE49A85F56FB08BB73570E3BD94030AAA3CF4C5E3E606FE6E4610AE5B3968`
  - `git diff --check` → 无空白错误 PASS（exit: `0`）
- 浏览器联合验收：
  - fresh load/light → host body 与 iframe root `bg=rgba(244, 242, 248, 0.22)`、`label=rgb(55, 48, 94)`；iframe `dataset.theme=light`、`colorScheme=light`、card bg `rgba(250, 249, 252, 0.76)`、sidebar bg `rgba(244, 242, 248, 0.1)` PASS
  - 点 DSH「深色」后约 `180ms` → host/iframe 同步 `bg=rgba(26, 22, 49, 0.4)`、`label=rgb(244, 242, 248)`；iframe `dataset.theme=dark`、`colorScheme=dark`、card bg `rgba(35, 30, 63, 0.78)`、sidebar bg `rgba(26, 22, 49, 0.28)` PASS
  - 点回原「跟随系统」后约 `180ms` → host 与 iframe 全部恢复上述 light 值；设置对话框关闭，原用户外观选择已恢复；服务 PID `67084` running、HTTP `200`、stderr=`0` bytes PASS
- 人工断言：✓ theme-token 消息同时校 parent WindowProxy、同源与 source marker；✓ 只收 alias/specific 且 entries≤87；✓ 值先做字符/长度门，再拒绝 URL/var/image/gradient 并用 `CSS.supports('color', …)`；✓ malformed generation 保留上一代；✓ 只删除 receiver 自有 token；✓ 旧布尔 receiver 保留；✓ 所有 fallback 完整保留；✓ 暗色只由宿主 token 值驱动。
- 偏离与理由：任务书给出的 CSS 文件头注释含内嵌 `*/`，改写为等义合法注释；接收器增加 parent、87-entry、纯 color 语义门；滚动条采用已桥接的专用 scrollbar token；这些收口不改变协议目标。
- 遗留：无。
## TD4：逐席 token 合成层与 104 项对比度门 — 2026-09-04 23:18
- commit: 7b188fc
- 验收：
  - `node --test tests/seat-theme.test.ts` → `tests 5; pass 5; fail 0; skipped 0; duration_ms 124.6176` PASS（exit: `0`）
  - `node scripts/check-contrast.ts` → 数据行=`104`（13×2×4）、FAIL=`0` PASS（exit: `0`）
  - 四类最低实测 → primary/layer1=`11.786≥4.5`、secondary/layer1=`7.206≥4.5`、foreground/button=`4.634≥4.5`、brand/layer1=`3.005≥3.0` PASS
  - 每席 light/dark 各生成同一组 `38` 个非空 token，全部属于 TD1 allowlist；state/scrollbar/toast/tooltip/mask/skeleton 禁止 token=`0` PASS
  - `node --check workbench/app.js` 与 `npm run typecheck` → 无诊断 PASS（各 exit: `0`）
  - `npm test` → `tests 137; pass 136; fail 0; skipped 1; duration_ms 1613.6602` PASS（exit: `0`）
  - `npm run build` → client `101.85 kB`、host `152.02 kB` PASS（exit: `0`）
  - 静态门 → `post('amphoreus:seat-changed'` 精确 `3` 处；setSeat 顶部 bind=`1`；生产 TD4 文件 `!important=0`；TD3 receiver 回归全通过；`git diff --check` 无空白错误 PASS
- 浏览器验收：
  - 门户全局层 → host `dataset.amphoreusSeat=null`、brand=`rgb(138, 104, 28)`、bg=`rgba(244, 242, 248, 0.22)` PASS
  - 进「阿格莱雅」席/light → host 与 iframe 同为 brand=`rgb(169, 137, 74)`、bg=`rgba(246, 241, 227, 0.22)`、label=`rgb(25, 21, 14)`、sidebar=`rgba(246, 241, 227, 0.1)`；host dataset=`aglaea` PASS
  - 席内切 DSH 深色 → host 与 iframe 同为 brand=`rgb(229, 197, 133)`、bg=`rgba(46, 38, 24, 0.4)`、label=`rgb(250, 247, 240)`；iframe theme=`dark` PASS
  - 切回原「跟随系统」并回门户 → brand 恢复 `rgb(138, 104, 28)`、bg 恢复 `rgba(244, 242, 248, 0.22)`、dataset 删除；进「昔涟」席仍保持同一全局值且 dataset 为空 PASS
  - 最终浏览器恢复「全体会议」与原系统外观；服务 PID `61248` running、HTTP `200`、stderr=`0` bytes PASS
- 人工断言：✓ light/dark 合成方向按 palette mode；✓ 同 source 先 override 再调用旧 disposer，更新无全局色闪隙；✓ seatStyle 关闭只清 layer 并保留 selected intent，重新开启可恢复；✓ Cyrene/null/未知席只清层、不永久退订；✓ model 只有 seatStyle/surfaceAlpha 变化时重算；✓ iframe 只上报 heroId，不自行合成 token。
- 偏离与理由：任务书 `SeatSchemeInput` 仅有当前 `base`，但 light ink 需要 `darkBase`、dark ink 需要 `lightBase`，数学上信息不足；新增 `oppositeBase` 精确表达反极性底色。`seatContrastReport(hero)` 无 alpha 参数，静态审计固定使用配置默认 `.22/.4` 并写明，运行时仍使用 live alpha。
- 遗留：无。
## TD5：13 种共享 SVG 纹样与画布层 — 2026-09-04 23:39
- commit: 5d584e3
- 验收：
  - `node --test tests/shared-motifs.test.ts tests/workbench-motif.test.ts` → `tests 8; pass 8; fail 0; skipped 0; duration_ms 148.4768` PASS（exit: `0`）
  - 全量测试 → `tests 145; pass 144; fail 0; skipped 1` PASS（exit: `0`）；首次未用精简 PATH 的 `npm test` 复现工作区已知 `'node' is not recognized`（exit `1`），按 §0 固化 PATH 重跑通过
  - `npm run typecheck`、`node --check workbench/app.js`、Lightning CSS 解析、`npm run build` 全通过；client `107.65 kB`、host `152.02 kB` PASS（各 exit: `0`）
  - 13 个 `HeroMotif` 与 MOTIFS keys 精确相等、unique SVG=`13`、URI round-trip=`13`；每个 SVG 有固定 viewBox、颜色、opacity、geometricPrecision 且无 script/foreignObject/href/src PASS
  - J-4 workspaces 浏览器侧载荷：13 席均生成 `volume` 与 light/dark motif；`src/host/webapi.ts` diff=`0` PASS
  - CSS/JS 静态门 → main-stage `::before=1`、原 `::after=1`、四直接子元素层级规则=`1`、CSS motif refs=`2`、app motif refs=`2`、CARD 310×276 不变；`git diff --check` 无空白错误 PASS
- 浏览器验收：
  - 黄金裔门户渲染 portal cards=`13`；进「那刻夏」席后 host dataset=`anaxa`、brand=`rgb(35, 102, 77)` PASS
  - `.main-stage` 的 motif 自定义属性长度=`1785`，前缀为 `url("data:image/svg+xml;utf8,`，含 astrolabe `circle` 与 `r="22"` 编码；`::before` backgroundImage 为同一 data URI、opacity=`0.55` PASS
  - `.canvas-tabs` computed position=`relative`，纹样层位于其下 PASS
  - 新会话草稿输入 `TD5-纹样切换焦点与草稿保留` 后 textarea active=`true`；切 DSH 深色后草稿文字逐字保留、motif URI 立即变化且 iframe theme=`dark` PASS
  - 设置 UI 点击本身把浏览器焦点移到宿主按钮（复核时 textarea active=`false`），但 `canReplaceView()`/protected branch 行为测试确认主题消息不重建 textarea DOM；随后恢复「跟随系统」、取消未发送草稿、回到「全体会议」，未生成会话 PASS
  - 最终服务 PID `57072` running、HTTP `200`、stderr=`0` bytes PASS
- 人工断言：✓ 纹样以共享纯函数单源生成，不使用位图/外部 SVG/资源路由；✓ 载荷 URI 再做 data-URI prefix 门；✓ 合并后的 main-stage style 整体 escapeHtml；✓ 主题变化先原位更新 motif，再按 canReplaceView 受保护重绘/延后；✓ portal 不铺单席纹样；✓ 原卡牌艺术 ::after 保留。
- 偏离与理由：任务书改动文件仍写已删除路由所在 `host/webapi.ts`，按其同段 J-4 裁决改实际 `client/workspaces-source.ts`；额外增加 workbench-motif 行为测试。浏览器通过宿主设置按钮切主题会按交互语义转移焦点，因此焦点不丢以无 DOM 重建的行为门验证，而真实浏览器同时验证草稿值完整保留。
- 遗留：无。
## TD6：系统字体阶梯单源 — 2026-09-04 23:43
- commit: 4d43f03
- 动手前核对：TD5 后 styles.css=`378` 行、settings.module.css=`313` 行；旧 display literal rules=`6`、mono literal rules=`3`；font asset/import refs=`0`；`src/client/typography.css` 不存在 PASS
- 验收：
  - workbench 字体变量 → display/body/mono 定义各=`1`，display 使用=`10`、body 使用=`2`、mono 使用=`3`；五个 `--amphoreus-type-*` 均含 `var(--amphoreus-font-*)`，缺 family=`0` PASS
  - settings 字体变量 → display/body/mono 定义各=`1`，标题 display 使用=`1`；两文件三套 family 字面逐一完全一致 PASS
  - 原 6 个 serif 与 3 个 mono literal 使用点全部归一到变量；字号、字重、行高、字距、布局均未改 PASS
  - `@font-face|fonts.googleapis|.woff|@import url` → `0`；typography.css=`ABSENT` PASS
  - Lightning CSS 对 workbench/styles.css 与 settings.module.css 均解析通过 PASS（exit: `0`）
  - `npm run typecheck` → 无诊断；`npm test` → `tests 145; pass 144; fail 0; skipped 1; duration_ms 1709.86` PASS（各 exit: `0`）
  - `npm run build` → client `108.12 kB`、host `152.02 kB` PASS（exit: `0`）
  - `git diff --check` → 无空白错误 PASS（exit: `0`）
- 人工断言：✓ 仅使用本机系统字体 fallback；✓ display/body/mono 三族与五级 type shorthand 单源；✓ CSS Modules 设置标题与 iframe 杂志标题采用同一 display 栈；✓ 不修改 DSH 内容字号 token。
- 偏离与理由：无。
- 遗留：无。
## TE2：派发记录与全体会议派发泳道 — 2026-09-05 05:14
- commit: 70177ad
- 动手前核对：实际执行任务书 `sed -n '3772,3924p'`、E.0 `3460,3608p` 与 storage-domain `78,98p`；确认 `update(key, fn)`、domain/changed、现有 4 KiB/64 KiB 路由边界与 connectorPath 的卡片左上角语义 PASS
- 验收：
  - 聚焦 → observations/firstframe/body-limits/bindings/lane 共 `tests 16; pass 16; fail 0; skipped 0; duration_ms 484.2495`；审查修正未解析 pipeline 站位 tooltip 后复跑核心 `tests 14; pass 14; fail 0; skipped 0; duration_ms 500.4729` PASS
  - 全量 → `tests 248; pass 247; fail 0; skipped 1; duration_ms 2708.3829`；`npm run build` → derive/client/host=`28.87/170.95/192.00 kB`；typecheck、node check、Lightning CSS=`66539` bytes、diff check 均 exit `0` PASS
  - API → Binding/Observation schema 加 dispatch 与 tier/source/pipeline/station；三段 `OBSERVATION_KEY=2`、route/create/safeParse/64KiB=`2/2/3/4`；POST 仅 dispatch 且 seq=`0`，GET filter、PUT patch、403/415/400/404/409/413 均由真实 loopback server 测试 PASS
  - memory 4–64 KiB PUT=`200`、>64 KiB=`413`；bindings/prefs 等其余写路由仍为 4 KiB；旧 firstframe fixture 抽成共享非 test 文件；zh/en dispatch 来源键与旧枚举回归同步 PASS
  - 泳道 → 仅 all 画布渲染，空 all 画布仍有 root；status 精确为已派发/进行中/已回应且无工艺词「回执」；pipeline 待命不创建会话，未解析/未部署均标记；首卡才显示派发徽记 PASS
  - 点到点 `connectorCurve` 保持旧卡片 connectorPath 语义；lane observer 单 owner、每次 render 先 disconnect；CSS block markers=`1/1`、alias=`20`、新增 dark selector=`0`、全文件 dark/canvas-controls=`1/4` PASS
  - 服务重启后 PID `43936`、state/observations HTTP=`200/200`、L0/cards/seatDirs=`L0/13/13`、observations=`0`、stderr=`0` bytes PASS
- 人工断言：✓ 浏览器只能创建 dispatch observation，observer 专属四类不对外开放；✓ rawLine 截前 200 字而 payload 保留全文；✓ stub 点击只 activate/enter-seat、不 prompt；✓ status/standby 只读现有状态；✓ 旧 ResizeObserver 不残留。
- 偏离与理由：依赖环使可构建顺序采用 TE2→TE3→TE1；本任务先落宿主 API 与 lane 消费端，`state.amph` 实时桥、真实派发与 receipt 三态分别由 TE1/TE3/TE4 后置联验。任务书只写非负 seq，但 E.0 明定 dispatch 固定 `0`，输入 schema 收紧为 literal 0；任务书漏列 locales、bindings/body-limit 回归，均随领域扩展同步。任务书 connectorPath 端点描述与现实现不符，抽共享点曲线保持两类调用正确。
- 遗留：真实浏览器 stub/edge/pipeline/三态在 TE1+TE3+TE4 联通后回填；未写入 dummy observation，避免无 DELETE 路由时污染真实 store。
## TE3：宿主页派发与移交共享流程 — 2026-09-05 05:23
- commit: 08dfbf7
- 动手前核对：实际执行 `sed -n '3924,3998p'` 与 `grep -n 'function decodeTail' -A 6`；确认 observation key 会 decodeURIComponent、TC4 PUT→create 补偿边界、TC2 fork-inherit 排队顺序与官方 create/fork resolve 后可寻址契约 PASS
- 验收：
  - 新增 `handoff.ts` 与 15 组流程测试；聚焦 → `tests 41; pass 41; fail 0; skipped 0; duration_ms 415.4498`；全量 → `tests 267; pass 266; fail 0; skipped 1; duration_ms 2480.0099` PASS
  - `npm run build` → derive/client/host=`28.87/177.10/192.00 kB`；typecheck、diff check 均 exit `0`，clsx 仍仅为既有非失败 bundle 提示 PASS
  - dispatch 精确顺序锁定为 binding PUT → create → observation POST → client binding → queue prompt → optional open；空文本零副作用，cwd/face/from/pipeline/station 完整透传，prompt/open 各失败后的 durable 部分状态由测试明确锁定 PASS
  - accept 精确为 fork → child handoff-fork binding → source observation accepted → open child；lineage/session/seq/face 与 `%3A` 编码精确，accept 段 `.prompt(`=`0`；dismiss 仅 PUT observation，stale accepted/dismissed 零写入 PASS
  - Workbench bridge 新增 dispatch/accept/dismiss 三类消息，严格校验 skill/text/from/cwd/face/pipeline/safe station/session/seq；accept/dismiss 只反查最新 open handoff；成功返回 dispatched/handoff-accepted/handoff-dismissed，错误沿用 bridge-error PASS
  - 全插件 `seatDeps` 升为唯一 `HandoffDeps`，Tab 与 Portal overlay 共用；任务书漏列的 `portal.tsx` 已补齐必填注入；TC11 单例装配回归同步且全绿 PASS
  - `src/client/handoff.ts` 导入 seat-actions=`1`、全文件 `.prompt(`=`1`；构建产物 `boundBy: "dispatch"`=`2`，未复制 bindings PUT PASS
- 人工断言：✓ dispatch 只在用户明确点击后发送首条任务；✓ accept 不发送移交内容；✓ fork-inherit 后置 handoff-fork 在同一 storage write chain 最终覆盖；✓ face 贯通双面席；✓ 三流程不被描述成跨系统原子事务。
- 偏离与理由：任务书文件表漏列 Portal overlay 的共享 deps 注入，按强类型真实调用面补入。任务书 DispatchInput 漏 face，会使长夜月派发退回三月七，故在共享层增加可选 face 并留给 TE1/TE7 透传。构建器统一双引号，原单引号 grep 字面为 0；采用 quote-agnostic 实测 2，而不向 bundle 塞伪字符串。
- 遗留：真实 dispatch/accept/dismiss 浏览器消息由 TE1/TE4/TE5 界面触发后联验；已明确 observation/prompt/open 与 fork/patch/open 各失败点可能留下的部分完成状态。
## TE1：状态桥、全体会议入口与派发面板 — 2026-09-05 06:16
- commit: 87f4849
- 动手前核对：实际重读 E.0/TE1、`FeatureSwitches` 八键、portal/bridge/Tab contracts；依赖环按 TE2→TE3→TE1 落地，TE3 dispatch case 只核对且精确 `1` 处 PASS
- 验收：
  - 新增 bridge-state/enter-seat-queue/dispatch-match 与面板测试；聚焦 → `tests 23; pass 23; fail 0; skipped 0; duration_ms 421.4346`，最终门户/桥/面板 → `tests 16; pass 16; fail 0; skipped 0; duration_ms 301.4442` PASS
  - 全量 → `tests 277; pass 276; fail 0; skipped 1; duration_ms 2890.8099`；真实套件 → `tests 1; pass 1; fail 0; skipped 0; duration_ms 222.3281`；最终 build derive/client/host=`28.87/180.47/192.32 kB`，typecheck/node check/diff check 均 exit `0` PASS
  - state bridge 完整推 revision/features/dispatch/pipelines/cards/seats/bindings/observations/memory/effectiveConfig/firewallWords；suite 缺失时八 feature 全 false；四个 effectiveConfig 布尔 L0 实测均 true PASS
  - map-ready 顺序固定为 workspaces→state→current→config→messages/live/theme/magazine→queue；queue 单实例、last-write-wins、take 后清空且只注入 Tab；request-current 同步 state/current PASS
  - matcher TS 与 iframe mirror 同源：代码+逻辑首项那刻夏；跨三月七/长夜月两行的唯一命中 `日志(2)+changelog(9)+回滚(2)=13`，名字 bonus 每 skill 仅一次，双面 face 精确透传 PASS
  - all 画布仅在 canvas 显示派发面板；本地 120ms 建议、全部席、两条 runtime pipeline、面板/按线派发与 portal 200 字表单均接通；只建第一站，其余站待命 PASS
  - 聚焦 textarea/input 时 state 更新不换 DOM；建议局部更新，去重 timer 在可替换后用最新 state 完整 render；value/selection 与非建议状态均由测试覆盖 PASS
  - 浏览器 Workbench→全体会议：panel/lane/textarea/pipelines/all-active=`1/1/1/2/1`；「帮我评审这段代码的逻辑」直接建议=`那刻夏代码·逻辑`；「随便聊聊」直接建议=`0`、出现无命中和全部席位 PASS
  - 真实点那刻夏 → `session-5321a3c7-a214-4c9b-8e68-4ab9b8ceaf43`，2 秒内 stub/edge=`1/1`、状态=`进行中`；observation=`dispatch/seq0/panel/accepted` 且 rawLine/payload 逐字一致，binding=`amphoreus-anaxa/dispatch/done`；日志证实 skill-invocation seq `6` 先于 user/message seq `8` PASS
  - 当前 Workbench 的 Portal「去派发」→ overlay 关闭、同一会话/画布 all、文本「整理一下日志」生成三月七建议且 session index 保持 `38` PASS
  - 无当前或 Chat 路径 → alpha.4 blank session 会隐藏 header/view，真实复现两次后改为不造空白会话、不关闭 overlay，由同一 portal iframe 原地进入 all；最终 Playwright fresh context 中 dialog 保持、派发面板/泳道/三月七建议出现、底层 Chat/空白 hero 不变 PASS
  - 服务最终 PID `70252`、HTTP `200`、四配置 true、stderr=`0` bytes；两段失败复现 blank 会话均经官方 archive RPC `200/ok=true` 隐藏且 session 日志保留 PASS
- 人工断言：✓ dispatch 仅明确点击后发送；✓ 面板不调模型做意图推断；✓ pipeline 只派第一站；✓ portal overlay 与 Tab 复用同一 state/dispatch bridge；✓ 输入焦点、原 Chat draft 与当前会话均不被门户 fallback 破坏。
- 偏离与理由：任务书 matcher 预期 `11` 与三处命中长度冲突，按唯一词累计修正为 `13`。任务书假设新建 blank session 可立即承载 Workbench，但 alpha.4 源码 `ConversationSession.tsx` 明确 blank phase 返回 null，且真实 `{sessionId}`、`{sessionId,workspaceId}` 两次均只出现空白 Hero；最终采用覆盖层内同一 all 画布，完整保留功能且不制造孤立/不可见会话。README 记录该稳定平台事实。
- 遗留：TE2 泳道「已回应」需 TE4 observer 写 receipt 后回填；真实 pipeline 首站派发、handoff accept/dismiss 在后续 UI 任务联合验收；本次真实 Anaxa dispatch 会话留作 TE4 replay 验证后再归档。
## TE4：移交、知会、回执与缺席观察器 — 2026-09-05 06:43
- commit: 49d6e10
- 动手前核对：实际执行任务书 TE4 与上游 SessionStore `sed -n`；确认 `session/event`、typed `list()/ownEvents()`、assistant interrupted 位置、domain change durability，以及 observer 必须在 `await bridge.start()` 后注册 PASS
- 验收：
  - 新增 `observer.ts` 与 `tests/observer.test.ts`；聚焦 → `tests 14; pass 14; fail 0; skipped 0`；组合 parser/API → `tests 28; pass 28; fail 0; skipped 0; duration_ms 568.3695`；全量 → `tests 291; pass 290; fail 0; skipped 1` PASS
  - `npm run build` → derive/client/host=`28.87/180.47/199.46 kB`；typecheck、diff check 均 exit `0`；observer 中 session.append/prompt/user-message/as-any 均=`0` PASS
  - live listener 先挂，session/created 与启动 list 共用 typed ownEvents replay；所有任务进单一 Promise 队列，重复 live/created/replay 按 `${sessionId}:${seq}:${kind}` 幂等，同 seq 多 kind 共存 PASS
  - live/replay interrupted 均跳过；只取 assistant text blocks；```/~~~ 完整 fence 状态机排除示例；handoff/notify 只看末六非空行、receipt 只看末行、absence 看围栏外全文；g/y matcher 前后 lastIndex 归零 PASS
  - handoff/receiptParsing 开关独立；已有 open/accepted/dismissed 不覆写；receipt 后以 binding table update 再验 skill，只改 face 并保留 source/injection/handoffFrom；已落 observation 可在 replay 补 face PASS
  - async disposer 立即 off session/event、session/created、snapshot 三监听，再 drain queue；host teardown 在 bridge/store close 前 await；单次写失败 warn 后下一事件继续 PASS
  - 默认 fixture 仍一卡；可选双面 fixture 的 `夜星` 精确解析为 testcard-b + face；NOTIFY_VERB 单源导出并被 parser/observer 共用 PASS
  - 真实重启后初始 live list 为空时，打开已完成 dispatch 会话触发 created replay：新增 receipt seq `1948`，payload=`common.md、persona.md`、tier=`标准`；全体会议 lane 从「进行中」最终显示「那刻夏 · 已回应」 PASS
  - 真实 live 消息在 seq `11263` 同时写 handoff+receipt 两键；handoff=`open`、target=`amphoreus-phainon/白厄`、payload 为已展开整改单，receipt=`accepted/标准`；源 binding 仍 `amphoreus-anaxa` PASS
  - 服务 PID `46872`、HTTP `200`、stderr=`0` bytes PASS
- 人工断言：✓ 不写自定义会话事件；✓ 不解析 user message/工具参数；✓ 不改归属 skill；✓ replay 只读 ownEvents 排除 fork 继承前缀；✓ storage-domain 自然发 state change，无重复 emit。
- 偏离与理由：任务书只扫描启动时 `ctx.sessions.list()`，真实重启时该表可为空且恢复会话 seed 不重放 `session/event`；真实验收捕获漏扫后增加 `session/created` typed replay，以相同队列去重。任务书只过滤 fence 边界会误读围栏正文，升级完整状态机。任务书旧 binding 读后 put 有竞态，改用 atomic update。
- 遗留：open handoff 已留给 TE5/TE8 的真实 UI accept/dismiss 验收；E 结束前归档源/子测试会话并保留权威日志。
## TE5：会话输入区移交坞与共享席位徽记 — 2026-09-05 07:07
- commit: c22d363
- 动手前核对：实际执行任务书 `sed -n '4099,4172p'`；核实 conversation.input.dock 为 list/session，owner InputZone，现任 todo/goal/queue order=`0/10/20`、locale 插值与工作台条件边界 PASS
- 验收：
  - 新增 HandoffDock/SeatBadge 双组件、双 CSS module 与 6 组专项测试；聚焦 → `tests 34; pass 34; fail 0; skipped 0; duration_ms 295.5828`；全量 → `tests 297; pass 296; fail 0; skipped 1; duration_ms 2976.2292` PASS
  - `npm run build` → derive/client/host=`28.87/191.52/199.46 kB`；typecheck、diff check 均 exit `0` PASS
  - input.dock 唯一注册 id=`amphoreus-handoff`、order=`30`，位于 conversation.view 注册之后且在 workbenchEnabled 条件外；复用唯一 model/seatDeps；TC11 精确 slot 顺序测试同步 PASS
  - latestOpenHandoff 只认当前 session 的 open handoff 并取最大 seq；handoffEnabled false/无 open 时不渲染；部署判定只读 runtime seat.status，不从视觉素材猜测 PASS
  - accept/dismiss 共用同步 useRef 锁与 runAction；无 useEffect/prompt/fetch/appendChild 自动动作；payload 用 React 纯文本 pre、aria-controls/expanded；错误保留输入并正确显示 PASS
  - SeatBadge 显式收 assetsConfigured，复用 heroVisualOf/stickerAssetUrl/fallbackHue；按 src 记录图片失败、未知/无素材退确定首字、null 为问号、face 有角标；light/full size=`28/48` PASS
  - 两 CSS module raw hex/rgb/hsl/dark selector=`0/0/0/0`；颜色全走 alias，full 56px 列与 alias gradient、窄屏 actions 换行、focus/disabled 状态齐全 PASS
  - locale zh/en 各新增 7 键且集合相等；可见按钮为查看内容/移交/忽略；工艺词「移交物」在 TSX=`0`，唯一值落 `handoff.payloadTip` tooltip PASS
  - 真实 Anaxa open handoff → composer 上方出现「移交给 白厄？」及三按钮；查看内容 title=`移交物`、expanded false→true，pre 逐字显示长整改单 PASS
  - 真实忽略 → dock 消失、observation seq `11263` 变 dismissed、acceptedSessionId 空、handoff-fork=`0`、当前会话未切、stderr=`0` PASS
  - 新 handoff seq `13896` 后对移交按钮同一 JS task 连点两次 → 白厄席只从 2 增至 3，仅生成 child `session-4d9fde90-2108-4da2-8237-9f9254fc09af`；observation accepted，binding=`amphoreus-phainon/handoff-fork/pending`、handoffFrom session/seq 精确、匹配 fork=`1`、源 binding 仍 Anaxa；新会话输入为空 PASS
  - 服务 PID `78728`、HTTP `200`、stderr=`0` bytes PASS
- 人工断言：✓ 未经点击不 fork/不切会话/不发送；✓ 未部署目标没有 accept 按钮；✓ dismiss 不创建 child；✓ accept 不把 payload 作为用户消息；✓ 组件永不接触 ctx。
- 偏离与理由：任务书 SeatBadge props 缺少 assetsConfigured 却要求素材 gate，增加显式布尔并拆独立 CSS；任务书两写动作只给 accept busy，改为共享同步锁阻止同 tick 双写；任务文件表漏列共享 SeatBadge 支持文件与 assembly 回归。
- 遗留：child 当前 injection pending 属预期，因为 accept 本身不发送；后续用户首次输入才注入下游卡。TE8 仍需在 iframe 接受路径解决 open-before-reply 生命周期并验证零自动消息；E 结束归档 disposable 父/子会话。
## TE6：画布移交虚线边与跨席来源角标 — 2026-09-05 07:16
- commit: 9625ea9
- 动手前核对：实际执行任务书 `sed -n '4170,4215p'` 并按当前函数重定位；确认 observation seq 对应 `answer.sourceSeq`、connectorPath 世界坐标、drag cache 查询全部 `path[data-from]`，且多数 handoff 因下游重新归席只显示跨席角标 PASS
- 验收：
  - 新增 `tests/workbench-handoff-edge.test.ts`；聚焦 → `tests 31; pass 31; fail 0; skipped 0; duration_ms 208.0953`；全量 → `tests 305; pass 304; fail 0; skipped 1` PASS
  - `npm run build` → derive/client/host=`28.87/191.52/199.46 kB`；typecheck、node check、diff check 均 exit `0` PASS
  - accepted handoff 同 workspace 才生成一条 handoff-connector；source 优先 assistant seq 精确卡、缺失时最大 turnIndex，target 总取最小 turnIndex；输入 cards 乱序、open/dismissed/缺端点/self/cross-workspace 全覆盖 PASS
  - path 使用 connectorPath 世界坐标并保留 data-from/to；既有 cache/refresh 无 class 过滤，拖动源/目标和非 100% zoom 均复用同一 position 更新链；不新增 observer/DOM 坐标 PASS
  - 跨席仅 child 首卡显示「移交自 来源」；严格要求 handoff-fork/handoff + lineage + accepted handoff，先出现 dispatch 不误取；来源 card 缺失退「上游」，名称 HTML escape；同 workspace/后续轮/无关 source 无角标 PASS
  - 基础 `.connectors path` 实线规则逐字保留；仅加高特异 `.handoff-connector` brand 虚线 `7 5/1.6` 与角标；新增 dark selector=`0`、全文件仍=`1` PASS
  - 真实 Anaxa→Phainon accepted child `session-4d9fde90-2108-4da2-8237-9f9254fc09af`：白厄席工作台 cards=`4`、cross badge=`1`、text=`移交自 那刻夏`、handoff connector=`0`，未伪造跨席源卡 PASS
  - 已从全体会议真实派发 March7/Longnight 同 skill source `session-6b5fe04f-5c86-4186-ab19-e822dfb7082c`，binding=`amphoreus-march7th/face长夜月/dispatch/done`；模型尚运行，接受后同席 path 的实机拖动联验留后置回填
- 人工断言：✓ 不修改普通 lineage 实线；✓ 不跨 workspace 画不存在端点；✓ 不为 source 造卡；✓ 同 endpoints 普通谱系与移交语义可并存；✓ 相机 pan/zoom 整体变换不重算世界 path。
- 偏离与理由：任务书一行 Map 会为 answer 缺失写重复空键，改为显式 assistant/first/last 三表；跨席来源反查显式过滤 kind/status，避免 dispatch 同样带 acceptedSessionId 时误标。README 工作台总说明统一留 TE10 收口。
- 遗留：真实同席 connector/drag 需当前 March7 disposable 会话完成并经后续接受后回填；TE8 将修 bridge open-before-reply 并继续用这些 observation/child 证据。
## TE7：会话头流水线站位与点站派发 — 2026-09-05 07:42
- commit: 5798fd9
- 动手前核对：实际执行任务书指定的 `sed -n '480,500p' deepseek-harness-source/packages/client/ui-slots/src/index.ts`；确认 strict session slot 的 inject 首参为 framework-resolved `sessionId`，声明 store 时才追加 actions，业务依赖只能由 apply closure 注入 PASS
- 验收：
  - 聚焦 `node --test tests/client-pipeline-rail.test.ts tests/client-handoff.test.ts tests/client-assembly.test.ts` → `tests 27; pass 27; fail 0; skipped 0; duration_ms 329.7701` PASS（exit: `0`）
  - `npm run typecheck` → 无诊断 PASS（exit: `0`）；`npm run build` → derive/client/host=`28.87/203.60/199.46 kB` PASS（exit: `0`）
  - 全量 `node --test tests/*.test.ts` → `tests 313; pass 312; fail 0; skipped 1; duration_ms 3088.4264` PASS（exit: `0`）；`git diff --check` → 无空白错误 PASS（exit: `0`）
  - helper 行为 → 双面席按 face 精确站位、旧无 face binding 兼容首个同 skill 站；未解析与未部署站保留原 station index 但不可派发；submit 同 tick 第二次获取同步锁失败 PASS
  - runtime 状态门 → suite 缺失、pipelinesEnabled=false 或 pipelines=[] 均不渲染；面板打开后状态降级会清 open/target/error；外部 pointerdown 与 Escape 共用 closePanel 并成对移除监听 PASS
  - 热目标门 → 提交前重新读取 model snapshot，pipeline 名、station 索引、skill、face、显示名、部署状态全部仍一致才派发；状态漂移不会创建会话或发送文本 PASS
  - 派发 → 只调用共享 `dispatchTask`，固定 `from='rail'`、`open=true`，透传 runtime pipeline/station/face；`cwdOf(sessionId)` 每次提交只读取一次并覆盖席位默认 cwd；空白文本零副作用 PASS
  - UI → strict `conversation.session.header.utilities` 注册 id=`amphoreus-rail`、order=`10`；chip、dialog、textarea label 与 station aria-label 完整；席位徽记复用 SeatBadge 并显式传 assetsConfigured PASS
  - CSS → `130` 行、alias refs=`21`、raw hex/rgb/hsl=`0`、dark selector=`0`；阴影使用 `--dsw-alias-bg-mask-1`；TSX 硬编码流水线/站名=`0`、直接 fetch/fork/prompt/session.append=`0` PASS
  - 真实浏览器那刻夏源会话 → header chip=`逐火线 5/10`，展开显示逐火线/守夜线两行且当前站实线高亮；Escape 关闭 dialog PASS
  - 点赛飞儿站 → 表单=`派发给 赛飞儿`；同一 JS task 双击派发 `请只回复：TE7-CIPHER-OK` 后只生成 `1` 个匹配会话/observation，assistant 已响应且会话完成，新会话 header chip=`逐火线 6/10` PASS
  - 真实持久化记录 → dispatch observation `from=rail`、`pipeline=逐火线`、`station=5`、payload 逐字一致；binding=`amphoreus-cipher/dispatch/done`，新会话 cwd 与来源会话同为 Anaxa 席目录；服务 HTTP=`200`、stderr=`0` bytes PASS
- 人工断言：✓ 流水线与站名全部来自 `state.suite.pipelines`；✓ 点站派发不是 fork/移交；✓ 未部署与未解析站 disabled；✓ 单站选择；✓ 派发失败保留文本和目标，成功才清空并关闭。
- 偏离与理由：任务书示例仅按 skill 判定当前站，会把三月七/长夜月这类同 skill 双面席错配；实现按 binding face 精确匹配，旧无 face 记录仍按首站兼容。增加提交时热状态重验与同步锁，避免配置刷新后向已撤站位派发或同 tick 双提交。
- 遗留：无。
## TE8：「接通中」尾页与 iframe 移交闭环 — 2026-09-05 08:01
- commit: f56902e
- 动手前核对：实际执行任务书 `sed -n '4296,4345p'` 并继续读至 TE8 末尾；同时以源码核实 `sessions.open()` 经 manager `notifyNow()` 可同步推 current-session，确认原 TE3 的 open-before-reply 会使 iframe 来不及设置目标相机标记 PASS
- 验收：
  - 聚焦 `node --test tests/workbench-connecting-tail.test.ts tests/client-handoff.test.ts tests/client-handoff-dock.test.ts tests/workbench-bridge.test.ts tests/workbench-handoff-edge.test.ts tests/client-pipeline-rail.test.ts` → `tests 50; pass 50; fail 0; skipped 0; duration_ms 349.1884` PASS（exit: `0`）
  - `node --check workbench/app.js`、`npm run typecheck` → 无诊断 PASS（各 exit: `0`）；Lightning CSS → `LIGHTNINGCSS_OK=73266` PASS（exit: `0`）
  - `npm run build` → derive/client/host=`28.87/204.95/199.46 kB` PASS（exit: `0`）
  - 全量 `node --test tests/*.test.ts` → `tests 320; pass 319; fail 0; skipped 1; duration_ms 2753.8039` PASS（exit: `0`）；`git diff --check` → 无空白错误 PASS（exit: `0`）
  - 记录选择与尾页 → 只取同 session、kind=handoff、status=open、safe seq 最大值；handoffEnabled=false/无 open 时不渲染；尾页位于详情消息之后、composer 之前 PASS
  - 摘要 → 先去最外尖括号，再以 Unicode code point 精确取前 `80`，超长加省略号；真实浏览器 summary 含 `80` 字正文加 `1` 个省略号且无坏代理字符 PASS
  - 部署门 → 已部署目标有贴纸/首字降级、目标名、移交/忽略两按钮；未部署仅显示「角色未部署」与忽略，接受按钮不存在；bridge 刷新最新 model 后再次核对 open 与 deployed PASS
  - 卡片 → 仅最新 open handoff 的 exact assistant sourceSeq 显示「待移交」；真实那刻夏画布第 5 轮角标=`1`，其余卡=`0`；接受后角标消失 PASS
  - RPC 时序 → `acceptHandoff` 默认仍按 fork→binding→observation→open，iframe bridge 显式 `{open:false}`；bridge 先回 accepted，iframe 校验 child id、设置 mapCardSessionSwitches、`await refreshIndex()` 后才发 activate-session，消除同步 current-session 竞态 PASS
  - 并发门 → 宿主页 accept/dismiss 共用 `${sessionId}:${seq}` 同步锁，iframe 另有同键同步锁；unsafe seq 在任何写入前拒绝；同一 JS task 双击真实「移交」只产生一个 child PASS
  - 静态门 → app.js「移交物」=`1` 且唯一为 `title="移交物"`；connecting-tail begin/end=`1/1`、marker 内 alias refs=`10`、dark selector=`0`、全文件 dark selector仍=`1`；handoff.ts `.prompt(`仍=`1` 且只属于 dispatch；bridge accept case `sessions.open=`0`；`refreshProjection=0`、`canvas-controls=4` PASS
  - 真实浏览器接受前 → source=`session-5321a3c7-a214-4c9b-8e68-4ab9b8ceaf43`、seq=`17394`、target=`白厄`、status=`open`；详情 `.connecting-tail=1`、h3=`白厄`、title=`移交物`、accept/dismiss=`1/1`、magazine=`light` PASS
  - 真实接受后 → 白厄席会话数 `3→4`，唯一 child=`session-988db804-5520-4d92-9a58-d2459beca03e`；observation status=`accepted`、acceptedSessionId 精确，binding=`amphoreus-phainon/handoff-fork/pending` 且 lineage session/seq 精确 PASS
  - 当前会话已切 child，iframe seat=`白厄`、新 child card=`1`、tail=`0`、待移交 badge=`0`、宿主输入为空；child 日志最后 `session/end-seed` 后 `user/message=0`、`skill-invocation=0`，接受动作未自动发送任何消息 PASS
  - 服务重启后 PID `80176`、HTTP=`200`、stderr=`0` bytes；独立只读审查未发现 actionable finding PASS
- 人工断言：✓ 尾页不自动接受/播放/发送；✓ 按钮固定移交/忽略；✓ 不显示档位与读取；✓ 贴纸失败走确定首字；✓ 接受后的打开权交回 iframe，最终仍使用官方 sessions.open 路径。
- 偏离与理由：任务书示例假设 TE3 已打开 child 后再设置 mapCardSessionSwitches，但平台 `sessions.open()` 可同步推送 current-session，实测时序有竞态；因此给 `acceptHandoff` 增加默认兼容的 open option，bridge 只做 durable fork/binding/observation 并先回执，iframe 完成索引/相机准备后再激活。另把任务书未覆盖的 Dock/iframe 跨入口重复操作收口为共享同步锁。
- 遗留：无。
## TE9：侧栏台账、席位记忆与插入草稿 — 2026-09-05 08:15
- commit: cef988f
- 动手前核对：实际执行任务书 `sed -n '4349,4433p'`、指定 `grep -n "draft" .../contract/input.ts | head`，并继续 `sed -n '315,330p'` 定位当前 `InputState.draft`；确认 conversation.view owner 自动提供 useInput/inputActions，`InputActions.setDraft` 是正确的未发送草稿写入口 PASS
- 验收：
  - 聚焦 `node --test tests/workbench-ledger.test.ts tests/workbench-bridge.test.ts tests/webapi-body-limits.test.ts` → `tests 12; pass 12; fail 0; skipped 0; duration_ms 354.7493` PASS（exit: `0`）
  - `node --check workbench/app.js`、`npm run typecheck` → 无诊断 PASS（各 exit: `0`）；Lightning CSS → `LIGHTNINGCSS_OK=76223` PASS（exit: `0`）
  - `npm run build` → derive/client/host=`28.87/205.78/199.46 kB` PASS（exit: `0`）
  - 全量 `node --test tests/*.test.ts` → `tests 325; pass 324; fail 0; skipped 1; duration_ms 2898.7465` PASS（exit: `0`）；`git diff --check` → 无空白错误 PASS（exit: `0`）
  - 选中语义 → ledger 先取 `state.activeId` 所属 thread，仅无活动线程才退 currentDshThread；具体席使用 seatId 归属记忆，全体会议使用所选 session binding；单测排除 currentDsh 错串 PASS
  - 记录 → 同 session observations 按 seq 升序，正文逐字使用 rawLine、title 使用 payload，五类标签只位于 renderLedger；无状态/侧栏收起不渲染；details toggle 写回 ledgerOpen，重渲染保持展开 PASS
  - 记忆 RMW → 全局 Promise 写队列逐笔在执行时读取最新 memory，PUT 响应立即推进本地真值，失败链被解毒而后续仍可写；单测 8 笔并发入队的 notes 长度严格 `1,2,3,4,5,6,7,8` PASS
  - bridge → `amphoreus:insert-input` 只接收非空字符串；WorkbenchView 由 owner props 读取当前 draft，空草稿直接写、非空以换行追加，再 rememberTab、openView(chat)、completeViewRequest；无 prompt/submit/自动发送，index.ts 的 uiConversation 注入仍唯一 PASS
  - CSS → ledger begin/end=`1/1`、marker 内 alias refs=`21`、dark selector=`0`，没有重复 `.sidebar` 基础规则；全文件 `canvas-controls=4` 不变 PASS
  - 工艺词局部性 → `grep -c 回执 workbench/app.js=1`，renderLedger 函数段同样=`1`；app.js 拼接固定回执模板 `卡｜读取：｜档位：=0` PASS
  - 真实那刻夏源会话 → 侧栏 `details.ledger`、summary=`台账 9`；运行态记录含派发/回执/移交，回执行正文逐字为 observation.rawLine、title 精确为 payload；选择另一卡后 ledger 行数即时从 `9→1`，证明跟随 activeId PASS
  - 添加「先看 README」→ memory GET=`200`，唯一 note text 逐字一致且含当前 sessionId；整页刷新后仍显示该便签；确认删除后 notes=`0` PASS
  - 点击便签 `↳` → 宿主从工作台切到对话 Tab，输入框草稿=`先看 README`，源会话真实用户消息仍=`5`、last user seq=`13904`，没有发送；随后已清空草稿 PASS
  - 同一真实 form 连续入队 `8` 条各 `500` 字便签 → 捕获 PUT status=`200×8`，DOM notes=`8` 且每条 code points=`500`、顺序 `TE9-0..7`；再同 tick 点 8 个删除按钮 → status=`200×8`、DOM/API notes=`0`，测试数据全部清理 PASS
  - 服务 PID `67432`、HTTP=`200`、stderr=`0` bytes；独立只读审查未发现 actionable finding PASS
- 人工断言：✓ 台账不写 localStorage；✓ 便签不自动 prompt/发送；✓ runtime rawLine 是回执行唯一来源；✓ state.amph=null、无 skill、空记录均可降级；✓ memory 最终恢复为开工前空状态。
- 偏离与理由：任务书最小 putMemory 每次从可能滞后的 SSE snapshot 做 RMW，连续八笔会覆盖前笔；实现增加单一串行 Promise 队列，并使用已由服务端 schema 校验的 PUT response 推进下一笔基线。任务书列 index.ts 但同时裁决其不注入 activateChat，当前 owner props 已足够，故核对而不制造无意义改动。
- 遗留：无。
## TE10：20 词防火墙与 E 章文档收尾 — 2026-09-05 08:25
- commit: 7bfbbaa
- 动手前核对：实际执行任务书 `sed -n '4434,4487p'`；`grep -c canvas-controls workbench/styles.css` 基线=`4`；读取真实 common.md 防火墙行并直接调用旧 parseSuite，确认旧 `lastIndexOf('：')` 因词项「读取：」误取最后冒号，只得到 `17/20` 词 PASS
- 验收：
  - fixture `node --test tests/suite-parse.test.ts tests/firewall-words.test.ts` → `tests 9; pass 9; fail 0; skipped 0; duration_ms 336.8094` PASS（exit: `0`）
  - 真实套件 `AMPHOREUS_REAL_SUITE=C:\Users\cangm\.claude\skills node --test tests/firewall-words.test.ts tests/suite-real.test.ts` → `tests 2; pass 2; fail 0; skipped 0; duration_ms 382.2269` PASS（exit: `0`）；真实词表逐项严格等于预期 `20` 词 PASS
  - 文档断言 → README observation key=`1`、`amphoreus:enter-seat=1`；HANDOFF `conversation.input.dock=3`、`QueueDock=1` PASS
  - `node --check workbench/app.js`、`npm run typecheck` → 无诊断 PASS（各 exit: `0`）；Lightning CSS → `LIGHTNINGCSS_OK=76223` PASS
  - `npm run build` → derive/client/host=`28.87/205.78/199.59 kB` PASS（exit: `0`）
  - 最终全量 `node --test tests/*.test.ts` → `tests 326; pass 325; fail 0; skipped 1; duration_ms 2793.9244` PASS（exit: `0`）；`git diff --check` → 无空白错误 PASS（exit: `0`）
  - scanner → 用 TypeScript JS AST 精确遮蔽 renderLedger body；scanner token 遮蔽 app comments；title 属性与所有遮蔽区均保留换行，失败位置稳定输出 `文件:行:词` PASS
  - client 覆盖 → `readdirSync` 扫全部 `.ts/.tsx`；settings.tsx 全文允许，locales 只允许两个实际设置键 `settings.visualHint/settings.magazineMode` 与 `*Tip`，handoff 只允许 observationKey 行及注释；其余无盲区 PASS
  - 词表门 → 无环境变量时固定夹具也严格 `20`；真实模式从 suite parser 读取且必须逐项全等，不会在真实解析缺词时退回硬编码 PASS
  - parser 回归 → 数量声明格式优先定位「角色台词与旁白：」后的列表，保留词项内部全角冒号；简短 `防火墙：词…` 仍支持；最小夹具精确解析 `词甲/词乙/读取：` PASS
  - 文案修正 → app 一般错误「画布分支锚点无效」改为「画布分支位置无效」；state 一般错误「杂志档位保存失败」改为「杂志模式保存失败」；合法设置区档位文案保持 PASS
  - README → M3 当前状态改为已完成并只保留 F 章发布/独立终验；新增工作台、数据、消息段，覆盖派发面板/泳道、全体会议、移交坞、站位轨、接通中、台账、跨席角标、observation key/dispatch seq0 与 E 消息集 PASS
  - HANDOFF §2.3 → 追加 strict session inject、InputZone 与 todo/goal/queue/plugin 顺序、t 插值、无 Popover、4KiB/64KiB/413 五组源码事实；原段落与 §7 均保留 PASS
  - 独立审查首轮发现 README 仍把 M3 写成未完成、locales 误放行整个 settings namespace；两项均收紧。随 README 状态修正，首次全量暴露旧 client-assembly 断言（`pass 324; fail 1`），同步更新为 M3 已完成/F 待办后最终全绿 PASS
- 人工断言：✓ 防火墙只豁免可证明的台账、tooltip 与设置表面；✓ 不扫描技能正文或生成产物；✓ 文档只陈述 A–E 已实现事实；✓ 未把运行态 common.md 词表复制进生产 UI。
- 偏离与理由：任务书假定 parse.ts 已正确提供 20 词，真实验收证明只有 17 词；若不修解析器，静态门会系统性漏扫回执/档位/读取：三词，故本任务连带修复 parser 并补最小回归。任务书只列 locales `*Tip` 豁免，但现有 TD11 的两个档位文案确属设置区；采用两个精确键白名单而非放行整个 settings namespace。
- 遗留：无。
## E 章完成定义：派发、移交、站位轨与台账 — 2026-09-05 08:34
- commit: 0486490；tag: `chapter-E`
- 范围：TE1–TE10 共 `10` 项均已有独立提交；因依赖环采用书内允许的 `TE2→TE3→TE1→TE4→…→TE10` 落地顺序，A→B→D→C→E 章节顺序与既有四章标签保持不变。
- 最终测试与构建：
  - `node --test tests/*.test.ts` → `tests 326; pass 325; fail 0; skipped 1; duration_ms 2793.9244` PASS（exit: `0`）；唯一 skip 是未设真实套件环境变量时的预期集成门
  - `npm run build` → derive/client/host=`28.87/205.78/199.59 kB` PASS（exit: `0`）；typecheck、node check、Lightning CSS、`git diff --check` 均 exit `0`
  - `AMPHOREUS_REAL_SUITE=C:\Users\cangm\.claude\skills node --test tests/firewall-words.test.ts tests/suite-real.test.ts` → `tests 2; pass 2; fail 0` PASS；运行态 suite contracts firewallWords=`20`、cards/seats/pipelines=`13/13/2`
- E-DoD 机器门：
  1. 指定 dispatch/observations/observer/firewall/fixture 五测试文件=`5/5`，全量 fail=`0` PASS
  2. 构建产物 client 消息计数：dispatch/accept-handoff/insert-input/state/enter-seat=`2/2/2/1/2` PASS
  3. store/webapi：dispatch source+kind=`2`、四扩展字段=`4`、web dispatch=`3` PASS
  4. observer：registerObserver=`2`、NOTIFY_VERB=`1`、session.append=`0` PASS
  5. observations route/create/key/safeParse/64KiB/413=`2/2/2/3/4/1` PASS
  6. shared API 四 effectiveConfig 字段=`4` PASS
  7. 六个 client 必需文件=`6/6`；dock/rail/uiConversation/order30/seat-actions reuse=`2/2/1/2/1` PASS
  8. handoff prompt all/dispatch/accept=`1/1/0`，sessions.create=`0` PASS
  9. mirror/functions/edge refs/app dispatched/bridge dispatched/handoff accepted/all chip=`1/6/4/1/1/1/2` PASS
  10. x-amphoreus-nonce=`1` PASS
  11. CSS 指定类 refs=`41`；dispatch-panel/lane/connecting/ledger alias=`29/20/10/21`，四段 dark=`0/0/0/0`；canvas-controls 仍=`4` PASS
  12. handoff dock 与 pipeline rail CSS 的 hex/rgb=`0/0`、`0/0` PASS
  13. 重启后 state HTTP=`200`、handoffEnabled=`true`；dispatch records=`3`、store `:0:dispatch` 行=`3`；source binding=`amphoreus-anaxa/dispatch/done`；TE8 accepted handoff 与 child/lineage/binding 均唯一，child dispatch=`0`，stderr=`0` bytes PASS
  14. fixture 与真实 firewall tests 均 pass，20 词只位于台账、tooltip、两个精确设置键及合同白名单 PASS
  15. README observation key/enter-seat=`1/1`；HANDOFF input dock/QueueDock=`3/1` PASS
- 人工三项：
  - fresh restart 后任一会话工作台点「全体会议」→ dispatch panel/lane/all-active=`1/1/true`；门户直接派发输入 `E-DOD-PORTAL` 后 overlay iframe `2→1`，同一 all 画布 panel/lane=`1/1` 且输入逐字带入，随后已清空，未派发会话 PASS
  - 那刻夏 header chip=`逐火线 5/10`；点击后 dialog/expanded=`1/true`，按 Escape 后 dialog=`0` PASS
  - TE8 实机 open handoff 同时出现 composer 横条与 iframe `.connecting-tail`，target=`白厄`、accept/dismiss=`1/1`；接受后 tail/角标=`0/0`、唯一 child 激活且输入为空 PASS
- 无自动消息证明：被接受 child 的日志含 fork seed；按最后 `session/end-seed` 划定 child 自有后缀后 events=`0`、user/message=`0`、skill-invocation=`0`。任务书直接对整个多帧 fork 文件 grep 会把父会话继承史计入而不等，故以 DSH 的 end-seed 边界核对真正新增事件，结果严格 `0=0` PASS。
- 恢复状态：Anaxa memory notes=`0`、门户临时文本与宿主草稿均清空；五个 E 章专用 binding 均 DELETE HTTP=`200`，五个专用会话以官方 gateway envelope `client-request → workspace/archiveSession({request})` 得 HTTP=`200/result.ok=true/archivedMatches=1`，对应权威 session 目录仍=`5/5`；首次只发 `{sessionId}` 虽 HTTP 200 但 result.ok=false，未误计成功，随后已用正确 envelope 完成。
- 偏离与理由：① matcher 书面 11 与唯一词累计实算 13 冲突，按真实三词命中；② alpha.4 blank session 不渲染 conversation.view，portal fallback 保持覆盖层同一 all 画布；③ TE8 修复同步 current-session 竞态；④ fork 日志零消息按 end-seed 自有事件边界判定；其余偏离逐项见 TE1–TE10。
- 遗留：无。E 章代码、运行态、浏览器与恢复门全部闭合；下一章为 F 发布包装、独立路径验收与实际发布。
## TF1：仓库卫生、品牌素材替换与 LF 基线 — 2026-09-05 08:43
- commit: 1aa5252
- 动手前核对：实际执行任务书 `sed -n '4536,4577p'`；确认 package 根已是 main git 仓、现有 `.gitignore` 七行、pack 临时 JSON 不存在、AUDIT 已跟踪、官方 glyph 路径与 webapi 白名单引用仍在 PASS
- 验收：
  - `.gitignore` 只追加 `*.tgz` 与 `.runtime/`；四个 A/F 必需模式计数=`4`，旧 `*.tmp` 保留且无重复 PASS
  - `.gitattributes` 逐字=`* text=auto eol=lf`；`.node-version` 逐字=`24` PASS
  - `git mv AUDIT-2026-09-04.md docs/AUDIT-2026-09-04.md` 为 `R100`；根旧链接=`0`、新 `docs/` Markdown 链接=`3`，README/HANDOFF 可达 PASS
  - mark → `M23.0584=0`、首行 plugin mark=`1`、第二行 dsh-synapse attribution=`1`、DeepSeek=`0`；图形仅三同心圆、自有 Vol.13 ripple，不携带上游品牌 glyph PASS
  - `git status --short` 的 node_modules/未跟踪 lib=`0`；tracked media png/jpg/zip=`0`、tracked lib/node_modules=`0`、`.npmignore=absent` PASS
  - 品牌允许项过滤后异常=`0`；README 唯一本机 link 示例已替换为 `link:D:/<你的目录>/dsh-amphoreus` PASS
  - webapi 静态白名单未改；包内无新增图片、压缩包或技能正文 PASS
  - `npm test` → `tests 326; pass 325; fail 0; skipped 1; duration_ms 2750.4839` PASS（exit: `0`）
  - `npm run build` → derive/client/host=`28.87/205.78/199.59 kB` PASS（exit: `0`）；`git diff --check` PASS（exit: `0`）
- 人工断言：✓ 审计正文只移动不改写；✓ HANDOFF 留在仓根；✓ reference/SYNAPSE-LICENSE 保留；✓ 官方素材从发布源码中移除但稳定 URL/白名单不变。
- 偏离与理由：任务书改动文件未列 README/HANDOFF，但 AUDIT 物理迁移后旧相对链接会断；同步只改五处引用（其中三个 Markdown href）并把 README 本机 link 示例占位化，属于 TF1 明示验收所必需。
- 遗留：无。
## TF2：发布字段、依赖归位与 npm 锁 — 2026-09-05 09:01
- commit: f66fa6e
- 动手前核对：实际执行任务书 `sed -n '4578,4636p'`，并确认 HEAD=`1aa5252`、工作树 clean；实时 GitHub REST/GraphQL viewer 的 canonical login=`xi-kari`、databaseId=`107102048`，`xixilove486` 公共用户查询=`404`，故任务书 `xi-kari/dsh-amphoreus` 三个 URL 与当前认证身份一致；两个候选远程仓均不存在且本地无 remote；npm 默认 registry=`https://registry.npmmirror.com`，显式 npmjs 查询 `dsh-amphoreus`=`404`，TF2 全部直接依赖及六个 override 的目标版本均存在 PASS
- 验收：
  - manifest 字面断言 → `0.2.0 alpha https://registry.npmjs.org yaml,zod 6 6` PASS（exit: `0`）；`.npmrc` 逐字=`legacy-peer-deps=true\n`、22 bytes、唯一匹配行=`1` PASS
  - 保持项 → `files` 完整数组与 HEAD 相等且仍为 `13` 项；`engines=^22.19.0 || >=24`、`dsh.client.inject` 十二项、`prepare=npm run build:types && npm run build:js` 均与 HEAD 相等；新增 `verify:dist`/`assets:check`/`release:check` 三脚本 PASS
  - 原地运行任务书锁命令时，npm `idealTree` 扫描 junction 化的现有 `node_modules`，约 `266 s` 后输出 `FATAL ERROR: Ineffective mark-compacts near heap limit Allocation failed - JavaScript heap out of memory`，exit=`134`，且未生成锁；没有重启同一进程，也未重铺或移动 junction
  - 修正为工作区隔离目录复制 `package.json`/`.npmrc` 后运行同一条 `npm install --package-lock-only --ignore-scripts --no-audit --no-fund --registry https://registry.npmjs.org` → `up to date in 43s` PASS（exit: `0`）；锁根=`dsh-amphoreus@0.2.0`、lockfileVersion=`3`、packages=`259`、bytes=`150451`
  - 包根与临时锁 SHA-256 均=`fc30c108eec2d4e4b7e94919d8611af249c5f0916b893151d9a4bf7540a887fb`；`dsh-client-web` npmjs resolved=`1`，npmmirror/`0.1.2-rc`/`0.1.2-alpha.5`=`0/0/0`，全部 `@deepseek-ai/dsh-*` 非 `0.1.2-alpha.4` 条目=`0`；六个 peer 均有 dev 副本 PASS
  - 隔离 `npm ci --dry-run --ignore-scripts --no-audit --no-fund --registry https://registry.npmjs.org` → `added 212 packages in 828ms` PASS（exit: `0`）；两次临时目录均先以 `Resolve-Path` 验证严格位于包根 `.tmp/tf2-*` 后清理，最终 `.tmp` 与辅助脚本均不存在
  - `npm run build` → derive/client/host=`28.87/205.78/199.59 kB` PASS（exit: `0`）；`grep -o 'from "@deepseek-ai/[^"]*"' lib/index.js | sort -u | wc -l` → `5`，精确为 home-paths/llm/skill/storage-domain/schemastery PASS
  - 全量 `npm test` → `tests 326; pass 325; fail 0; skipped 1; duration_ms 2826.3982` PASS（exit: `0`）；唯一 skip 为未设置真实套件环境变量的既有集成门；`git diff --check` PASS（exit: `0`）
- 人工断言：✓ 未执行登录、发布、建仓或 remote 写入；✓ 未写 token/registry 到 `.npmrc`；✓ 未改变 `files`、`engines`、inject、prepare；✓ 未对当前 junction `node_modules` 执行非 dry-run `npm ci`。
- 偏离与理由：任务书锁命令在包根因 npm 11 对现有大规模 junction idealTree 的内存占用退出 `134`；为同时保留原命令参数与“不碰 junction”边界，在包根 `.tmp` 下隔离生成并按哈希复制唯一锁文件，随后以受界路径检查清理，产物内容满足全部原验收断言。
- 遗留：远程仓与 npm 包尚未创建/发布，按任务书留给 TF12；TF9 路径 B 若实测 fallback 缺宿主 peer，再按任务书回退四个 DSH 包并记录。
## TF3：发布产物、纯度与 tarball 白名单机检 — 2026-09-05 09:04
- commit: 103d7b3
- 动手前核对：实际重读任务书 `sed -n '4637,4666p'` 对应段；确认 HEAD=`f66fa6e`、工作树 clean、TF2 的 `verify:dist` 脚本入口已提交但实现文件尚不存在，`package.json.files` 不含 `scripts/verify-dist.mjs` PASS
- 验收：
  - `npm run build` → derive/client/host=`28.87/205.78/199.59 kB` PASS（exit: `0`）
  - `npm run verify:dist` → `verify-dist: OK 377 checks` PASS（exit: `0`）；必需五产物存在，顶层 `lib/*.js` 精确为 client/derive/index 三个
  - 宿主纯度 → index/derive 的 `from`、副作用 import、字面 dynamic import 均纳入扫描，非字面 dynamic import fail closed；外部包名全部属于 `dependencies ∪ peerDependencies` PASS
  - 浏览器纯度 → literal require=`react,react/jsx-runtime`，均属于 PLATFORM_MODULES；全部 require 调用数与 literal require 数相等，非字面 require fail closed PASS
  - 包装契约 → ModuleLoader 首部、解析出的 loader id=`dsh-amphoreus` 与 manifest.name 全等、去 sourcemap 后以 `});` 结束；tsdown 多行 footer 经空白归一后精确含 `return module.exports; } });` PASS
  - tarball → files=`70`、unpackedSize=`1555660`、严格白名单外=`0`、禁用媒体/技能/源码/测试/reference/docs/HANDOFF/.npmrc/lock=`0`；`scripts/verify-dist.mjs` 在 manifest files 与 dry-run tarball 中均不存在 PASS
  - 真实反向：显式复制 `表情包/昔涟-收到.png` 为单文件 `workbench/x.png` 后运行 `npm run verify:dist` → `verify-dist: FAIL tarball path is not allowed: workbench/x.png` 与 `verify-dist: FAIL tarball contains forbidden media: workbench/x.png`，exit=`1` PASS；`finally` 显式删除该单文件，`HAS_FAIL=true`、`CLEANED=true`
  - 脚本写盘检查 → `writeFile/appendFile/copyFile/rename/unlink/rm/mkdir` 调用命中=`0`；唯一子进程为 `npm pack --dry-run --ignore-scripts --json`，无 tgz 产物 PASS
  - 全量 `npm test` → `tests 326; pass 325; fail 0; skipped 1; duration_ms 2862.5087` PASS（exit: `0`）；唯一 skip 为未设置真实套件环境变量的既有集成门
  - `git diff --check` → 无空白错误 PASS（exit: `0`）
- 人工断言：✓ Windows 通过显式 `ComSpec /d /s /c` 调用常量 npm pack 命令，避免 Node `shell:true` 的 DEP0190 警告；✓ npm JSON 前缀按首个 `[` 剥离；✓ 所有失败均整理为 `verify-dist: FAIL <原因>`，不输出脚本堆栈；✓ 未加入 `package.json.files`，未生成 tgz。
- 偏离与理由：任务书按单行字面量检查 footer，但当前 tsdown 0.22.2 将同一 footer 格式化为多行；先删除 sourcemap、再归一空白后检查任务书完整语义，既接受格式化差异，也不放宽 `return module.exports` 或双层闭合要求。Windows 任务书示例的 `shell:true` 会在 Node 24 打 DEP0190；改为显式执行 `ComSpec` 与常量命令，保留 npm.cmd 兼容且无动态 shell 输入。
- 遗留：无。
## TF4：平台模块防漂移测试优先读取发布声明 — 2026-09-05 09:13
- commit: 0ed840e
- 动手前核对：实际执行任务书 `sed -n '4667,4700p'`；确认旧测试只读 junction 的 `src/platform.ts`，而发布包 files 不含 src、但 `lib/types/platform.d.ts` 存在且含同一八项；本机两候选同时存在 PASS
- 验收：
  - 候选探针 → `.d.ts/.ts=true/true`，实际首选路径=`node_modules/@deepseek-ai/dsh-client-web/lib/types/platform.d.ts` PASS
  - `node --test tests/platform-modules.test.ts` → `tests 1; pass 1; fail 0; skipped 0; duration_ms 129.4611` PASS（exit: `0`）
  - 解析正则同时兼容 d.ts 的 `: readonly ["…"]` 与源码的 `= ['…']`，缺文件/缺声明均给具体路径；最终仍以 `assert.deepEqual` 锁定顺序、数量和值，没有降为包含关系 PASS
  - 全量 `npm test` → `tests 326; pass 325; fail 0; skipped 1; duration_ms 2804.1713` PASS（exit: `0`）
  - `npm run build` → derive/client/host=`28.87/205.78/199.59 kB` PASS；`npm run verify:dist` → `verify-dist: OK 377 checks` PASS（各 exit: `0`）
  - `git diff --check` → 无空白错误 PASS（exit: `0`）
- 人工断言：✓ 不移动/删除 junction 的 src 做模拟；✓ 发布态只有 d.ts 的独立 npm-ci 复核留 TF9；✓ 不删除测试、不放宽 PLATFORM_MODULES。
- 偏离与理由：无。
- 遗留：发布物无 src 的真实文件系统形态由 TF9 独立 npm-ci 克隆复核。
## TF5：GitHub Actions 双系统 CI 与 alpha 发布流 — 2026-09-05 09:18
- commit: ed5d008
- 动手前核对：实际执行任务书 `sed -n '4701,4767p'`；确认 `.node-version=24`、npm lock/.npmrc/verify-dist/发布字段均已由 TF1–TF4 提交，`.github/workflows` 尚不存在，当前无 remote/远程仓且 npmjs 未登录 PASS
- 验收：
  - `yaml.parse` 同时解析 `ci.yml` 与 `release.yml` → 两行 `yaml-ok`；结构脚本 → `workflow-structure-ok` PASS（exit: `0`）
  - CI matrix 精确=`ubuntu-latest,windows-latest`、fail-fast=false；步骤顺序为 checkout/setup-node → npm ci --ignore-scripts → test → build → verify:dist → pack dry-run；仅 Ubuntu 上传 lib、retention=`7` PASS
  - release 仅监听 `v*`；Ubuntu job permissions contents/id-token=`read/write`；依次 npm ci、release:check、tag/package version 等值门、`npm publish --provenance`，认证只引用 `secrets.NPM_TOKEN` PASS
  - 两工作流均使用 `.node-version` 与 npm cache/npmjs registry；`continue-on-error/pnpm/npm config set legacy-peer-deps`=`0/0/0` PASS
  - 全量 `npm test` → `tests 326; pass 325; fail 0; skipped 1; duration_ms 2827.0688` PASS（exit: `0`）
  - `npm run build` → derive/client/host=`28.87/205.78/199.59 kB`；`npm run verify:dist` → `verify-dist: OK 377 checks` PASS（各 exit: `0`）
  - `git diff --check` → 无空白错误 PASS（exit: `0`）
  - 独立审查修正两处时态：ZIP 会始终参与可选 cover 派生，只有派生结果的使用受 full 模式限制；删除发布后会立即过期的「尚待 F 章」进度句，并同步把 README 回归门改为稳定的 M3 已完成断言 PASS
- 人工断言：✓ 不写任何 token；✓ 不运行真实技能根 CI；✓ 不把任一 OS 标为可失败；✓ release 的 alpha/public/npmjs 由 publishConfig 单源约束。
- 偏离与理由：无。
- 遗留：远程尚未创建，故 `gh run` 的 Ubuntu/Windows 实际结论留 TF12 创建仓库并 push 后回填；若 Windows Node 24 暴露 glob 问题，按任务书只修 test script 并保留 Windows job。
## TF6：README 发布态、完整配置与外置素材说明 — 2026-09-05 09:21
- commit: 916cd5b
- 动手前核对：实际执行任务书 `sed -n '4768,4856p'`、`grep -n '^## ' README.md` 与 `sed -n '1,140p' src/host/config.ts`；确认原 README 十个二级节、A/B/D/E 锁定字面、当前全部 23 个顶层配置键及其嵌套默认值 PASS
- 验收：
  - 任务书 README grep → headings=`14`、四锁定标题=`4`、workbench host=`1`、骨架阶段=`0`、SYNAPSE license=`1`、正文不经宿主路由=`1`、素材标题=`1`、observation key/enter-seat=`1/1` PASS
  - 发布文案 grep → allowBuilds=`2`、dsh-synapse=`2`、非官方=`3`、amphoreus-skill-suite=`6`、`amphoreus-sync|即将支持|计划中|裸装会 ETARGET`=`0`、本机真实路径=`0` PASS
  - 十三席 skill 单元格唯一计数=`13`；截图 PNG=`0`；`docs/screenshots/README.md` 为任务书指定单行占位文本 PASS
  - 配置一致性扩展门 → `config.ts` 与 README 的 23 个顶层键全部双向存在；wallpaper/autoInvoke/handoff/workbench/suiteWatch/validate/sync 的每个当前子键均独立成行，类型与默认值逐项相同；`sync` 明标预留且当前无消费者 PASS
  - 素材事实复核 → README 七目录与 heroes.ts 相同；必需=`58`（6+13×4）、可选=`32`（13+1+12+2+4），实盘存在=`58/58`、`32/32`，required 大文件=`5`；日历/表情包/金卡物理数=`14/78/15` PASS
  - 三安装路径 → npm/tarball/GitHub 命令、reconcile 后重启、allowBuilds、含空格 link、卸载与三处保留数据、缺 lib 诊断均存在；未写任何凭据、原图下载或技能正文 PASS
  - Markdown 本地链接静检 → 共 `11`，意外缺失=`0`；唯一缺失为任务书明定暂不放盘的四张截图与 TF10 将创建的 `docs/E2E-CHECKLIST.md` PASS
  - `node --test tests/client-assembly.test.ts` → `tests 4; pass 4; fail 0; skipped 0; duration_ms 115.3726` PASS（exit: `0`）
  - 全量 `npm test` → `tests 326; pass 325; fail 0; skipped 1; duration_ms 2796.5712` PASS（exit: `0`）
  - `npm run build` → derive/client/host=`28.87/205.78/199.59 kB`；`npm run verify:dist` → `verify-dist: OK 377 checks` PASS（各 exit: `0`）
  - `git diff --check` → 无空白错误 PASS（exit: `0`）
- 人工断言：✓ 保留 client-assembly 锁定的席位/目录五语义与 M3 完成行；✓ 不把配置预留项写成可用命令；✓ 不夹带截图或原素材；✓ 显示名与职责继续以运行时技能套件为准。
- 偏离与理由：任务书配置 keys-ok 示例只列 16 个名字，而实际 config.ts 有 23 个顶层键；按“以当时 config.ts 为准”扩大到全部顶层与嵌套叶键。端到端清单链接按任务书先写入，目标文件由 TF10 创建，静检将它与四张故意缺席截图列为预期缺失。
- 遗留：GitHub 安装方式仍须 TF12 实测；失败时按任务书删除该方式并记录 HANDOFF。其余无。
## TF7：外置素材清单自检 — 2026-09-05 09:31
- commit: fc1e460
- 动手前核对：实际执行任务书 `sed -n '4857,4883p'`，并逐项读取 heroes.ts 的五个导出与 webapi 四目录命名；确认 required=`6+13×4=58`、optional=`13+1+12+2+4=32`，package files 不含 check-assets PASS
- 验收：
  - 无参数 `node scripts/check-assets.mjs` → `Usage: node scripts/check-assets.mjs "<assetsRoot>"`、exit=`2` PASS
  - `npm run assets:check -- "D:/DeepSeek Harness/deepseek插件开发"` 末行 → `assets: required 58/58 ok, optional 32/32 ok, large 5` PASS（exit: `0`）
  - 实盘逐行结果 missing/optional-missing=`0/0`，required large=`5`；large 文件仍计入 required ok，没有被误判为缺失 PASS
  - 受界空目录 → `assets: required 0/58 ok, optional 0/32 ok, large 0`、missing/optional-missing=`58/32`、exit=`1`；目录随后以非递归空目录删除，`EMPTY_CLEANED=true` PASS
  - 清单严格来自 `GLOBAL_WALLPAPERS`、13 个 `HERO_VISUALS.assets`、BRAND/CHIMERA/TRAILBLAZER 导出；物理多余日历/表情/金卡不凭目录扫描计入合同 PASS
  - 存在但不是普通文件按 missing 处理；ENOENT/ENOTDIR 分为 required/optional missing，其他 stat 错误整理为 `assets: <message>` 并 exit `1`；显示路径统一 `/` PASS
  - `node --check scripts/check-assets.mjs` PASS；写盘 API 命中=`0`，只使用 stat；manifest files 包含 check-assets=`false`，`npm run verify:dist` → `verify-dist: OK 377 checks` PASS
  - 全量 `npm test` → `tests 326; pass 325; fail 0; skipped 1; duration_ms 3040.4853` PASS（exit: `0`）
  - `npm run build` → derive/client/host=`28.87/205.78/199.59 kB` PASS（exit: `0`）；`git diff --check` PASS（exit: `0`）
- 人工断言：✓ 不下载、复制、重采样或写结果；✓ 只输出状态与汇总；✓ 不把仓库开发辅助脚本塞入 npm 包。
- 偏离与理由：无。
- 遗留：无。
## TF8：发布署名与 vendoring 归属核对 — 2026-09-05 09:34
- commit: 4701dc2
- 动手前核对：实际执行任务书 `sed -n '4884,4912p'`；确认 `settings.credit=2`、设置区仓库链接=`1`、`app.js` 的消息名字面量 `'synapse:`=`0`、宿主 `workbench.json|node:fs`=`0`、DSH 色彩 token 引用=`400`、handoff connector=`1`，三处历史条件与 A/B/D/E 章节前置均成立 PASS
- 改动：仅在 NOTICE 的 Changes 段末尾、`Original license text follows.` 之前追加任务书指定的 `mark.svg` 原创替换句；未改 MIT 原文、版权行、既有 Changes 措辞、设置区 DOM/locales/CSS 或 vendoring 文件头 PASS
- 验收：
  - `npm run build` → derive/client/host=`28.87/205.78/199.59 kB` PASS（exit: `0`）
  - 全量 `npm test` → `tests 326; pass 325; fail 0; skipped 1; duration_ms 2773.9264` PASS（exit: `0`）
  - `npm run verify:dist` → `verify-dist: OK 377 checks` PASS（exit: `0`）
  - 静态署名门 → `settings.credit=2`、`liangmianya/dsh-synapse=1`；NOTICE 的 `original artwork/in-memory seq index/no session text/magazine 'full' layout` 精确=`1/1/1/1`；NOTICE 中不属于非官方声明的 `DeepSeek` 行=`0` PASS
  - 条件句门 → `app_synapse=0`、`host_disk_matches=0`、`css_dsw_refs=400`、`handoff_connector=1` PASS
  - 文件头复核 → `mark.svg`、`src/host/workbench.ts`、`workbench/app.js`、`workbench/styles.css` 均保留 vendoring/移植归属头；未改这些文件 PASS
  - 真实浏览器：刷新本地 DSH 设置页，依次打开「设置」→「翁法罗斯」；`a[href="https://github.com/liangmianya/dsh-synapse"]` 的 `textContent` 实测为 `github.com/liangmianya/dsh-synapse` PASS
  - `git diff --name-only` 在写日志前仅为 `NOTICE`；`git diff --check` 无空白错误 PASS（exit: `0`）
- 人工断言：✓ 署名只存在于设置页、README、NOTICE 的发布归属位置；✓ 对话气泡与名牌未新增署名；✓ 原 upstream MIT 正文未改。
- 偏离与理由：无。
- 遗留：无。
## TF9：tarball 用户形态与独立 demo profile — 2026-09-05 10:00
- commit: 9b6fe14
- 动手前核对：实际执行任务书 `sed -n '4913,4955p'`；确认 HEAD=`4701dc2`、3090 无监听、`amphdemo` 初始不存在、发布版本=`0.2.0`、主 web profile 为 link 安装且 3080 正在运行 PASS
- 改动：新增可重复的 `scripts/path-b.sh`；为真正的官方 npm-ci 环境补齐三项仅开发期 runtime peer（`dsh-invariants/dsh-scope/dsh-storage`）并重生成锁；给 `conversation-feed.ts` 的 assistant blocks 加发布声明兼容类型锚点，不改变映射行为 PASS
- 脚本验收：
  - `bash -n scripts/path-b.sh` PASS；`grep -c "trap '" scripts/path-b.sh` → `1`；`rm -rf`=`0`；末行实测 `path-b: OK`（exit: `0`）
  - `npm run release:check` → 全量测试 `tests 326; pass 325; fail 0; skipped 1`、本地 build derive/client/host=`28.87/205.80/199.59 kB`、`verify-dist: OK 377 checks` PASS
  - 实包 → `dsh-amphoreus-0.2.0.tgz`，70 files、package size=`393.7 kB`、unpacked `< 2 MB`；tarball 复制到无空格 `/c/tmp/dsh-amphoreus-path-b.*` 后安装 PASS
  - reconcile → `@deepseek-ai/dsh-base -> @deepseek-ai/dsh-web-app -> dsh-amphoreus`；profile-local 仅有 direct `yaml/zod/dsh-amphoreus`，六项 peer 未重复安装；实际启动后六项均从 `$DSH_HOME/profiles/node_modules` fallback 解析 PASS
  - dump-config → `526:# == dsh-amphoreus`、`527:- id: amphoreus`、`533: dataDir: !!js dshHomePath('amphoreus')` PASS
  - 3090 启动 stderr bytes=`0`；禁词 `run pnpm run build/ERR_MODULE_NOT_FOUND/loaded without registering`=`0` PASS
  - HTTP → auth=`303`、首帧 `__AMPHOREUS_BOOT__=2`、state=`L0 13 true`、bundle 前缀=`window.__ModuleLoader__.load({`、mark.svg=`200` PASS
  - 独立 npm-ci clone → installed `dsh-client-web` 的 `lib/types/platform.d.ts=true`、`src/platform.ts=false`；最终复跑 `tests 326; pass 325; fail 0; skipped 1; duration_ms 3237.9023`；npm-ci build derive/client/host=`28.90/205.60/199.69 kB`；`verify-dist: OK 377 checks` PASS
  - 锁文件 → SHA256=`C091DE8BD25D8A17BDA0F86CB6558E4FE8E7E59F472D68300F580353F79B5BA2`、`registry.npmmirror.com=0`、`0.1.2-rc=0`、dsh-client-web 官方 registry resolved=`1`；dependencies 仍精确 `yaml,zod`、peers=`6`、overrides=`6` PASS
- 真实浏览器第 1–5 步：✓ 3090 令牌登录；✓ 总览门户显示全体会议与 13 席；✓ 进入那刻夏并从席位创建新会话；✓ 首轮投递完成，页眉显示「那刻夏 · 代码 / 已注入」，助手逐字回复 `TF9-PATH-B-OK`；✓ 切换「工作台」，iframe 显示该会话卡、名牌、第一轮正文与完整会话操作 PASS
- 清理与恢复：测试会话经官方 `workspace/archiveSession` 返回 `ok=true`，binding DELETE=`200` 且 remains=`0`；会话日志目录保留；3090 listeners=`0`；amphdemo 依赖为空且 bundles 保留 base/web-app；脚本实测主 web manifest/patch hash 前后相同；主 3080 最终恢复 `STATUS=running/HTTP_STATUS=200` PASS
- 敏感临时材料：独立复核指出临时 stdout 含一次性启动令牌、cookie jar 可跨重启；EXIT trap 已扩为 `stop_server; cleanup_sensitive`，成功/失败均删除 `$OUT` 与 `$JAR`，且只在路径属于本次 `$TMP_ROOT/` 时删除。现存 path-b 临时目录逐个验证位于 `C:/tmp/dsh-amphoreus-path-b.*` 后清除这两类文件；继承环境反向测试令 `OUT/JAR` 指向两个 `KEEP-*` 哨兵并用 3090 占用触发早退，脚本 exit=`1`、两个哨兵均原样保留；随后完整复跑 exit=`0`、末行 `path-b: OK`、最新 temp 的 OUT/JAR=`false/false`，主 3080 在脚本退出后仍为 `STATUS=running/HTTP_STATUS=200` PASS
- 失败与修正：首次从 PowerShell 调用裸 `bash` 实际进入 WSL，`/c/tmp` 不存在；改用任务书规定的 Git Bash 后执行。首次重跑发现 dump 的已配置 profile 注释会变为 `patched by ...amphdemo/cordis.patch.yml`，脚本在安装前把脚本自有 profile patch 复位为 `[]`，随后再写目标配置，恢复重复运行一致性。首个 npm-ci 真机运行以 11 个测试文件失败，根因为 `legacy-peer-deps` 下直接 dev peer 的 runtime peer 未安装；只向 devDependencies 补 `dsh-storage/dsh-scope/dsh-invariants` 后全部通过。发布态 d.ts 又暴露 assistant blocks 的回调参数隐式 any；用 `readonly AssistantBlock[]` 明确既有上游合同后 npm-ci typecheck 通过，逻辑与测试未改。
- 偏离与理由：任务书示例用简略文件列表作为 `git clone` 失败回退，会遗漏 verify-dist 所需发布文件；脚本固定采用完整 `git clone --no-hardlinks`，并仅把当前尚待同一 TF9 commit 的三份变更覆盖到 clone，确保验收的是当前工作树且不碰开发 junction。当前 dumper 以 `# == dsh-amphoreus` 标来源而非完整文件路径，按实际 alpha.4 输出锁定该来源行。
- 遗留：TF9 自动脚本的摘要将在 TF11 按任务书写入 HANDOFF §8 F；npm 远程发布形态留 TF12。其余无。
## TF10：A–E 发布门与端到端走查 — 2026-09-05 10:50
- commit: b68d9bc
- 动手前核对：实际执行任务书 `sed -n '4956,5010p'`；读取 A–E 最终完成定义区间 A=`864–918`、B=`1648–1668`、C=`2463–2494`、D=`3426–3450`、E=`4451–4487`，并先 `head -40 "$DSH_HOME/storages/amphoreus.json"` 核对 binding 真值位于 `tables.bindings` PASS
- 文档：新增 `docs/E2E-CHECKLIST.md`，A/B/C/D/E 表行=`40/16/20/16/18`，跨章 X 行=`14`，手工步骤=`12`；每步均有操作/预期/记录字段，结果记录含日期、三份 lib 构建时间、DSH 版本与浏览器 PASS
- 机器发布门：
  - X-1 真实新会话后 `/amphoreus/workbench/api/index` → HTTP `200`；body 的 `system-reminder|skill_content|"text"`=`0` PASS
  - X-2/3/4 → `workbench.json=absent`、DSW alias/specific refs=`400`、nonce header=`1` PASS
  - X-5/6 → 本轮 parent binding=`amphoreus-anaxa/seat-new`；真实分支 binding=`amphoreus-anaxa/fork-inherit` 且注入理由=`inherited-from-parent` PASS
  - X-7 → profile live 写 `workbench.enabled=false` 后刷新，官方 Tab 列表无「工作台」；恢复后 Tab 回归 PASS
  - X-8 → reparse host/client=`1/3`、skillRoots=`2`、tracked 技能文件=`0`、pack SKILL.md=`0` PASS
  - X-9/10/11/12 → suite 写盘调用=`0`、session append=`0`、TSX 非注释 ctx=`0`、CSS Modules hex=`0` PASS
  - X-13 → `npm run verify:dist | tail -1` 为 `verify-dist: OK 377 checks` PASS
  - X-14 → 代码与测试已证明例外边界，但任务书指定的 HANDOFF 明文落点属于后续 TF11；本次保留唯一一个表格 `☐`，TF11 写裁决后同提交改为 `✓`，未提前虚报
- 真实浏览器 12 步：
  - 门户/进席/建席 → 13 席与全体会议可见；那刻夏 token 到稳=`27 ms`、primary=`rgb(35, 102, 77)`；parent=`session-c9f752ec-1b5b-47ff-9017-96cb891d09d9`，binding source=`seat-new`、injection=`done` PASS
  - 回执/投影/分支 → 纯「自我介绍」按当前外部 common.md 的陪聊合同免逐轮回执，页眉仍显示「已注入」；该首轮完成时工作台恰好 1 张问答卡且无注入文本。同会话随后为工作场回执／移交新增第二轮，最终权威 index cards=`2`、seq 对=`10:2949,2956:10151`，末行=`那刻夏卡｜读取：common.md、persona.md｜档位：标准`，receipt 与 handoff 同 seq=`10151`；归档确认选择取消未写 hidden；fork-inherit child 创建 PASS
  - 派发 → 全体会议面板经显式选择白厄才发送；child=`session-7c325c21-57a4-4d45-ab0d-d636b82759ee`，binding=`amphoreus-phainon/dispatch`，observation payload 逐字相同，泳道与卡名牌均为白厄 PASS
  - 移交 → 接受前 dock 可见、observation=open、handoff-fork=`0`、未切换/未发送；接受后 observation=accepted、child=`session-7f42802e-a1ee-41b4-bfa7-157923f81dd2`、binding=`amphoreus-phainon/handoff-fork`，最后 `session/end-seed` 后 user/assistant=`0/0`，跨席角标=`移交自 那刻夏` PASS
  - 暗色 → body 暗标记存在，outer primary/base=`rgb(99,105,148)`/`rgba(19,22,43,0.4)`，iframe background 同 base；恢复「跟随系统」后暗标记移除、base 回亮值 PASS
  - 换席 → 那刻夏/遐蝶/昔涟主色=`rgb(35,102,77)`/`rgb(134,135,182)`/全局 `rgb(138,104,28)`；昔涟撤销逐席覆盖，最终 lastSeat=`null` PASS
  - 开关 → profile baseline SHA256=`DB10860ACCBAB96252A33C5F62106E7834D8102F8D2543B0BFB1837CB8F7C6BC`；关闭时设置区显示 `已在配置中关闭（workbench.enabled=false）`、API index=`503`；恢复原 bytes 后 hash 相同、state enabled=true、API index=`200` PASS
  - 技能更新 → Anaxa description 别名变化后 runtime aliases 更新，binding `21→21`、memory hash 不变；恢复后 SHA256=`E6BBFDCFCB0BC17926555010FE16D07322EA5E31D0166565BCC1DCAF2551FBA2`、mtime 原样。Cipher 目录临时改名后 cards=`12`、seat=undeployed、既有 binding=`1`、UI 显式列「未部署席位（1）」；同一 PowerShell 原路恢复后 generation=`7`、cards=`13`、seat=deployed、level=L0 PASS
- 接受按钮真机修复：首次普通点击被官方 ConversationRoot 的 40px 右宽度手柄截获；把 dock 从全列 `width:100%` 收到宿主已公开在祖先的 composer card 上限并居中，补 CSS 回归门。复测 bounding boxes：dock=`x420..1132`、button=`x1011..1061`、handle=`x1144..1184`、overlap=false；Playwright 普通 `click` 一次成功、唯一 handoff child 写入 PASS
- 清理：原四会话加命中区复测两会话共 `6` 个全部经官方 Gateway archive；对应 bindings DELETE 均 `200`，总数峰值 `21` 回 baseline `17`；六份权威日志均保留。profile/skill hash、mtime、Cipher 目录、theme、lastSeat、memory 全恢复；observations `14→19` 因无公开 DELETE 路由保留为归档验收证据；3080 running/HTTP200、stderr=`0 bytes`、3090 listeners=`0`、浏览器与 11 份临时 cookie/backup/rollback 文件清理 PASS
- 最终测试：`npm test` → `tests 326; pass 325; fail 0; skipped 1; duration_ms 2976.424`；`npm run build` → derive/client/host=`28.87/205.87/199.59 kB`；`npm run verify:dist` → `verify-dist: OK 377 checks`；`git diff --check` PASS（各 exit: `0`）
- 任务书文档验收：file=`ok`、X=`14`、A/B/C/D/E=`40/16/20/16/18`、steps=`12`、`api/workspaces=0`、手工段「可选」=`0`、表格未勾=`1`（仅时序依赖 TF11 的 X-14） PASS
- 偏离与理由：① B 章历史 404 探针若逐字写已删除 URL，会与本任务 `api/workspaces=0` 自验互相冲突；只把该历史命令的 route 字符串拆成 shell 等价拼接，语义与预期未改。② 当前技能 common.md 将纯自我介绍明确归陪聊场并免逐轮回执；不篡改外部技能，额外用同一会话的工作场评审验证真实 receipt。③ 稳定 HTML 壳按当前 webapi.ts 永远返回 200 并用 boot.disabled 自诊断；J-13 权威数据入口 `/api/index` 正确返回 503，按实际合同验收。④ 派发探针因模型把无语义标记当长任务，5 分钟仍运行；操作者经官方 cancel 结束，派发链本身此前已完整提交。⑤ TF10 原定只改文档，但真机发现移交按钮被宿主 resize hit area 截获；为使步骤 7 真正可由用户点击，连同回归测试在本任务修复并实测，未把程序化 DOM click 当最终通过。
- 遗留：X-14 的 HANDOFF 明文裁决由紧随的 TF11 写入并把唯一 `☐` 改为 `✓`；远程发布留 TF12。其余无。
## TF11：HANDOFF 发布态同步与文档闭合 — 2026-09-05 11:08
- commit: 95bdf01
- 动手前核对：实际执行任务书 `sed -n '5011,5048p'`；先冻结完整 `HANDOFF.md` 到独立二进制备份，并核对第 1–4 行、§0–§7、旧 §4／§5、`WB-25|第四梯队` 基线、AGENTS 与任务书 SHA256，随后才编辑 PASS
- 发布态同步：
  - 第 1–4 行保持不动；§0 标题下追加 `0.1 发布态现状`，旧现状整段仅加 `[已失效 2026-09-05]` 前缀；遗留汇总包含 B 章等价容量验收、TD12 条件裁决保留的 CSS 原色 fallback、派生稳定 URL cache-bust 与 TF12 发布动作 PASS
  - §3 保留早期设计输入并标注过时的 `02–07 未生成`；新增发布态代码权威行，明确冲突时以当前代码、测试与复现命令为准 PASS
  - §4、§5 原非空行全部保留，仅加失效前缀；§5 另加发布后下一步，不新增 `WB-25` 或「第四梯队」编号 PASS
  - §6 追加 `DELIVERY.md` 作废、`.pack-dry-run.json` 已删、历史 AUDIT 不更新、官方 DSH dist-tags、npmjs registry 显式参数与 bundle 变更后重启六组事实 PASS
  - §8 A–F 六章均按固定四字段写入；C 段精确保留 `garnish.ts` 的 `document.body.appendChild` 裁决，E 段 matcher 事实为三个唯一命中词按长度累计 `11→13` 分，F 段追加 `amphoreus:*` 消息清单复现命令 PASS
  - §9 覆盖 `git ls-files` 实际 21 个顶层项；任务书文字称 scripts 五个，但仓库实有六个，逐项写明入库／入包状态，只有 `derive-assets.mjs` 进入 npm 包；`BUILD-LOG.md` 明确入库不入包 PASS
- 受保护字节验证：
  - 第 1–4 行原始字节：before/after SHA256 均为 `de2309a63db4da22b68eb0c565c965ec209b65af213b9f1eb749d5ab96800f23`，`RAW_FIRST4_EQUAL=true` PASS
  - 原 §7 原始字节（只剥离为分隔新增 §8 的末尾空行）：before/after 长度均为 `4233` bytes，SHA256 均为 `5e963f09112243404ea71c7c45ae37e22b54605c21678a8b4a2de1d36a8a93ee`，`RAW_SECTION7_EQUAL=true` PASS
  - 原 §4／§5 逐非空行去新增前缀比对 → `SECTION4_ORIGINAL_PRESERVED=true`、`SECTION5_ORIGINAL_PRESERVED=true` PASS
- 任务书验收：
  - `sed -n '3p' HANDOFF.md | grep -c '2026-09-04 更新'` → `1`；`grep -c '^## 7'` → `1`；`grep -c '^## 8\. 已完成'` → `1`；`grep -c '^## 9\. 文件清单'` → `1` PASS
  - `awk '/^## 8\./,/^## 9\./' HANDOFF.md | grep -c '^### [A-F] · '` → `6`；未标失效的「一个都还没写」→ `0`；`DELIVERY.md` → `1`；`WB-25|第四梯队` → 基线／当前均 `0` PASS
  - `docs/E2E-CHECKLIST.md` 的 X-14 因本文件 C 段裁决闭合，`grep -c '| ☐'` → `0`；garnish 指定句命中=`1` PASS
  - 官方 registry `npm view @deepseek-ai/dsh dist-tags --json` → `latest=0.1.2-rc.1, alpha=0.1.2-alpha.5, next=0.1.2-rc.1`（exit: `0`）PASS
  - AGENTS SHA256 仍为 `228694BFFDD090C63A9390BE46C2D69B2BB0C9380B5F9885EF5E423E5C39C439`；任务书 SHA256 仍为 `D49F6F85F020BF5F4D9EF41DFC71A1F3E8DD341D6A8B0DE2B9EB3C9317502E71` PASS
  - `git diff --check` → 无空白错误 PASS（exit: `0`）
- 人工断言：✓ 不删 HANDOFF 原文；✓ 不改第 1–4 行或 §7；✓ 不生成第二个 `## 7`；✓ 不回改设计文档、AGENTS 或用户记忆；✓ 不把设计文档整段复制进 HANDOFF。
- 偏离与理由：任务书 §9 写「scripts/ 五个脚本」，实际 `git ls-files scripts` 为六个；按发布态真值全部列出。原 §3 的 `02–07 未生成` 已被本任务书自身推翻，保留原字面并加失效前缀。
- 遗留：TF12 的远程创建、双系统 CI、npm alpha 发布、两类安装抽测与 GitHub Release。
## TF12：发布执行与发布后核对 — 2026-09-05 12:08
- commit: fc754a6；tag: `v0.2.0`
- 动手前核对：实际执行任务书 `sed -n '5049,5080p'`，并读取其后 F 章完成定义 `5081–5105`；TF1–TF11 已提交，E2E 未勾项=`0`，工作树 clean，首次 `npm run release:check` → `tests 326/pass 325/fail 0/skipped 1`、build=`28.87/205.87/199.59 kB`、`verify-dist: OK 377 checks` PASS
- 发布文档与提交：
  - 新增 `docs/RELEASE-0.2.0.md`；一句话定位、`@alpha`／`@0.2.0` 安装、bundle 重启、仅兼容 alpha.4、素材自备、非官方声明、dsh-synapse 致谢齐全；HANDOFF §8 A–F 六条遗留原文=`6/6`，`WB-[0-9]|第四梯队=0/0`，docs 不进 package files／70 文件 tarball PASS
  - TF11 commit 回填为 `95bdf01`；按任务书生成 `release: dsh-amphoreus 0.2.0` 提交。首次远程 CI 暴露跨平台路径问题后，在尚无 tag 时把修复与回归测试 amend 进同一 TF12 提交，最终 SHA=`fc754a6ca02f96d4bbd47fe655196c04d611431e`，保持一任务一提交 PASS
- GitHub：
  - `gh repo create xi-kari/dsh-amphoreus --public --source . --remote origin --push` → public repo；description 为任务书指定中文，topics=`deepseek-harness,dsh-plugin,star-rail` PASS
  - 首次 CI run `33941645035`：Ubuntu `326/pass324/fail1/skip1`，失败因测试在 POSIX 注入 Windows 盘符；Windows `326/pass323/fail2/skip1`，失败因 `realpath` 与短路径／junction 拼写混用使 overlap 门漏判、readSkillPath 错拒合法路径 PASS（失败被真实记录，未标绿）
  - 修复：derive 对缺失 cache 从最近存在祖先 realpath 后重建尾段；reader 对输入文件先 realpath 再 relative；测试加入 junction 回归并改用 host-native env root。别名最小 harness 从 `overlap=false/read=undefined` 变为 `overlap=true/read=amphoreus-testcard-a`；聚焦=`21/21`，全量=`327/pass326/fail0/skip1` PASS
  - 修复后 CI run `33942052490` → Ubuntu job `101241266763` 与 Windows job `101241266984` 全步骤 success；workflow conclusion=`success` PASS
- npm 发布：
  - 仓库 `NPM_TOKEN` 计数=`0`，本机初始 `npm whoami` 为 ENEEDAUTH；用户在官方 npm 登录页手工完成账号与 WebAuthn，复核 `npm whoami=xi-kari` PASS
  - 第一次 publish 因调用 PATH 未含 Node，prepare 子进程输出 `'npm' is not recognized`，未发布；按总纲精简 PATH 复跑。npm `11.11.0` 的裸 publish/dry-run 实测显示 `tag latest`，未授权前主动取消；显式 `--tag alpha` 后页面再认证，CLI 输出 `+ dsh-amphoreus@0.2.0` PASS
  - registry → `alpha=0.2.0`、首发自动 `latest=0.2.0`；未执行 dist-tag add/rm。`dist.unpackedSize=1569891`；远程 dry-run=`70 files / 394.4 kB / 1.6 MB`，`.png|.jpg|SKILL.md=0` PASS
  - 本地与远端 `v0.2.0` 均指 `fc754a6ca02f96d4bbd47fe655196c04d611431e`；GitHub Release URL=`https://github.com/xi-kari/dsh-amphoreus/releases/tag/v0.2.0`，非 draft／非 prerelease PASS
- npm 形态重装：
  - amphdemo 从空依赖安装 `dsh-amphoreus@0.2.0`，dependency=`0.2.0`，bundles=`base→web-app→dsh-amphoreus`，六项 peer=`6/6 fallback`；dump=`526:# == dsh-amphoreus`、`527:id`、`533:dataDir` PASS
  - 3090 → auth=`303`、boot=`2`、state=`L0 13 true`、bundle 前缀=`window.__ModuleLoader__.load({`、mark=`200`、stderr bytes／禁词=`0/0` PASS
  - 检查脚本前几轮分别暴露 dump 注释含 profile patch 后缀与 `curl|head` 在 pipefail 下的断管；改成真实来源 grep 与先下载再 head，最终 `TF12_NPM_PROFILE_OK`。结束后 amphdemo 依赖／bundles／workspace 恢复，3090=`0`，主 3080 running；web manifest/patch SHA=`e8e30fc…/db10860…` 未变 PASS
- GitHub SHA 形态抽测：
  - amphgit 首次 add `github:xi-kari/dsh-amphoreus#fc754a6…` → `ERR_PNPM_GIT_DEP_PREPARE_NOT_ALLOWED`，lib=false；按任务书 name-only `dsh-amphoreus: true` 复试仍失败，未虚报 PASS
  - pnpm `11.7.0` 实际提示 key 为 `dsh-amphoreus@https://codeload.github.com/xi-kari/dsh-amphoreus/tar.gz/<SHA>`；复制精确 key 后第二次 add exit=`0`，prepare 运行，`lib/client.js=true`，dependency 含完整 40 位 SHA，bundles 末项正确，dump `526/527` PASS
  - 结束后 amphgit 插件、allow key 与临时输出移除；profile 保留 base/web-app，workspace SHA=`ae7c5b68…`、主 web 两 SHA 均恢复，3080 running、3090 clear，未创建会话或改 sessions PASS
- 发布控制流修正：无 secret 的本机发布后推 tag 仍触发旧 release.yml；run `33942640293` 的 release:check 与 tag/version 门 success，唯一 `npm publish --provenance` 因空 token 得 ENEEDAUTH。包已经由本机路径成功发布且 registry 可独立证明，没有双发。main 的 workflow 已改为先判远端版本／alpha：本机预发布则成功跳过，E404+token 才发布，其他状态 fail closed；publish 命令也显式 `--tag alpha`。
- 文档回写：GitHub README 将失效的 name-only allow key 改为 `v0.2.0` 实测完整 codeload key，并明确 SHA 变化时复制新提示；维护发布命令改为显式 `--tag alpha --access public --registry`。HANDOFF §0/§5/§6/§8 F/§9 同步真实发布态、历史失败与恢复边界 PASS
- 最终本地 `npm run release:check` → `tests 327; pass 326; fail 0; skipped 1; duration_ms 2639.8995`；build derive/client/host=`29.34/205.87/200.42 kB`；`verify-dist: OK 377 checks`；三份 lib mtime=`2026-09-05 12:06:20` PASS
- 人工断言：✓ 没有提交 tgz、令牌、cookie、原图或技能正文；✓ 没有移动／强推发布 tag；✓ 没有增删 latest；✓ GitHub 抽测不是可选项；✓ 主 web profile、权威 sessions、AGENTS 与用户记忆未改。
- 偏离与理由：① npm 11.11 不执行声明的 publish tag，必须显式 `--tag alpha`；② pnpm 11.7 的 GitHub build allow key 是包名加完整 codeload URL/SHA，而非任务书短 key；③ 本机发布路径仍触发旧 tag workflow，保留真实失败并修后续幂等控制流；④ 首次真实 CI 揭示三个跨平台路径缺陷，修生产边界而非跳过 Windows 或放宽断言。
- 遗留：npm `0.2.0` tarball 内 README 已冻结旧 GitHub allow key，当前 GitHub README 已纠正；旧 release run 的 ENEEDAUTH 保留为可审计历史。除此之外无发布动作遗留。
## F 章完成定义：发布包装、双形态安装与远程发布 — 2026-09-05 12:14
- commit: 本段所在提交，以 `chapter-F^{commit}` 为权威；tag: `chapter-F`
- 范围：TF1–TF12 共 `12` 项均已有独立提交；A→B→D→C→E→F 顺序完成，前五章标签保留，F 章在本段提交后补 `chapter-F`。
- 最终测试与构建：`npm test` → `tests 327; pass 326; fail 0; skipped 1`；`npm run build` → derive/client/host=`29.34/205.87/200.42 kB`；`npm run verify:dist` → `verify-dist: OK 377 checks`；三份 lib 最终 mtime=`2026-09-05 12:45:19`，全部 PASS
- F-DoD 21 门脚本 `C:/tmp/tf12-final-gates.sh` 最终 exit=`0`、末行 `F_CHAPTER_21_GATES=PASS`：
  1. git worktree=`true`，tracked lib/node_modules/tgz/jpg/zip=`0`，repo screenshot PNG=`4` 且全部位于 `docs/screenshots/`，npm tarball media=`0`，`.npmrc+package-lock=2` PASS（用户截图修正覆盖原零截图门）
  2. gitattributes/node-version/AUDIT 存在且 pack 临时文件不存在；gitignore 三模式=`3` PASS
  3. mark 旧 path/head/credit=`0/1/1` PASS
  4. package 版本／alpha／registry／repository／bugs／homepage、dependencies=`yaml,zod`、overrides≥6 → `pkg-ok` PASS
  5. lock rc/npmmirror=`0/0`，legacy-peer-deps=`1` PASS
  6. build exit=`0`，verify grep=`1` PASS
  7. 全量 pass/fail=`326/0` PASS
  8. platform focused pass=`1`，`platform.d.ts` 引用=`1` PASS
  9. CI Windows 行=`1`，main 最新 CI=`success` PASS
  10. README headings/保留标题/素材/allowBuilds/synapse/suite/非官方/席位/未来词=`14/4/1/2/2/6/3/13/0`，`keys-ok` PASS；任务书原「截图=0」在用户发布后指出断图后由四张实机 PNG 取代，npm tarball 仍因 `docs/` 不进 files 而保持图片=`0`
  11. DeepSeek 非白名单行=`0` PASS
  12. assets=`required 58/58, optional 32/32, large 5` PASS
  13. credit/link/artwork/index=`2/1/1/1` PASS
  14. E2E X/未勾/旧 API=`14/0/0` PASS
  15. path-b script/trap/HANDOFF=`1/1/1` PASS
  16. HANDOFF line3/§7/A–F/§9/未失效旧现状/DELIVERY=`1/1/6/1/0/1` PASS
  17. tag/alpha/unpacked=`v0.2.0/0.2.0/1569891` PASS
  18. dsh-plugin topic/Release 文档 WB 编号=`1/0` PASS
  19. reparse/skillRoots 总命中/suite 写 API/内嵌技能文件=`1/4/0/0` PASS
  20. npm state/wrapper/GitHub lib 记录=`2/1/1`，amphdemo/amphgit=`clean/clean`，3090=`0` PASS
  21. AGENTS SHA256=`228694bffdd090c63a9390be46c2d69b2bb0c9380b5f9885ef5e423e5c39c439`，TA11 后用户记忆新改文件=`0` PASS
- 远程终态：public repo、三 topics、`v0.2.0`、npm `alpha=0.2.0`、GitHub Release 全部可查询；发布提交／`v0.2.0` 固定为 `fc754a6ca02f96d4bbd47fe655196c04d611431e`，截图与后续发布流程由 main 维护提交 `15af35baa7fad82a494c45d153b92802fcec7ab1` 引入；CI run `33942052490` 与维护 run `33945149159` 均为 Ubuntu／Windows success。旧 release run `33942640293` 的空 token ENEEDAUTH 与已成功本机发布并存，未删除证据、未重复发布。
- 恢复终态：amphdemo 与 amphgit 均只保留 base/web-app 且无插件依赖；两 profile workspace 恢复；主 web manifest/patch SHA=`e8e30fc…/db10860…`；3080 running，3090 clear；sessions、AGENTS、用户记忆未改；临时 token/cookie/output 均未入库。
- 用户截图修正：README 原先引用四个不存在的 PNG，GitHub 与 npm 页面均显示断图。Stop/Start 后主服务=`PID 47328 / HTTP 200 / stderr 0`；独立 headless Playwright 以 1600px 视口生成 `portal.png(1600×1400)`、`seat-anaxa.png(1600×1200)`、`workbench.png(1600×1200)`、`settings.png(1600×1200)`。四图均逐张视觉复核；设置页在截图 DOM 中把三处本机路径替换为占位值，未捕获令牌。为截图新建的唯一 Anaxa 空会话 `session-e012eaf8-b915-4dd9-b43a-32ff97b0975c` 已经官方 `workspace/archiveSession` 返回 `ok=true`，binding DELETE=`200`，日志目录保留。npm 页面修复前实测四个 img 均指 `raw.githubusercontent.com/.../HEAD/docs/screenshots/*.png` 且 `naturalWidth=0`；维护提交 `15af35baa7fad82a494c45d153b92802fcec7ab1` 推入 main 后复核 GitHub README 四图均 `complete=true`，源为 `github.com/.../raw/main/...`，npm 页面四图均 `complete=true`，源为 `raw.githubusercontent.com/.../HEAD/...`，两处 natural size 都是 `1600×1400 / 1600×1200 / 1600×1200 / 1600×1200`。npm `0.2.0` tarball 不重发且仍无图片；npm 页面正文仍保留该 tarball 冻结的旧「截图待补」句，但四个图片元素均已恢复。维护 CI run `33945149159` 双 OS success PASS
- 截图文件 SHA256：`portal=c2c8d7baa334cc8d28d3866d8132934b28de7bb76cfedd1a5c488d4d5929adaf`、`seat-anaxa=df0b8f33deec21496a15413731695b31a6fb8c2cf9304bba7e5976580eb84f1d`、`workbench=57c26424f355d64d446809cba88fabb6578791f1ee800e13da805400ad3d8779`、`settings=ed63a404bf1b801ebd95f906223f8c5a64ca4e396d91020baaae689401de6fde`；`docs/screenshots/README.md` 已写尺寸、内容、脱敏与不入包边界。原 F-DoD 的零截图占位门由用户明确纠正为 repo 图片=`4`、tarball 图片=`0`。
- 偏离与理由：任务书对 npm 11.11 的 publishConfig tag、pnpm 11.7 的 Git build allow key、无 secret 时 tag workflow 三处假设与实测不符，均以不双发、不移动 tag、不增删 dist-tag、保留失败证据的方式收口；首次远程 CI 的三个跨平台问题已修复并由双 OS 复跑证明。
- 遗留：产品级后续仅为 TD12 已裁决的 CSS fallback 与稳定派生 URL cache-bust；发布历史边界见 TF12 遗留。F 章所要求的任务、远程、安装、恢复与验收全部闭合。
## 发布后实机缺陷修复：全席征询、首请求身份与席位 Workspace — 2026-09-05 14:28
- 发布边界：以下三项来自用户在本地 `main` 对已发布成品做真实操作后发现的问题，均发生在不可变的 npm `dsh-amphoreus@0.2.0` 发布之后；本轮没有重发 `0.2.0`、没有移动 `v0.2.0`，修复随下一包版本发布。

### 1. 「全体会议」从单席调度台补成可见的全席征询
- 修复前事实：任务书与原实现把「全体会议」定义为 `seatId==='all'` 的总览／单席派发面板；`dispatch-pick` 一次只接收一个 `skillName`，「按线派发」也只建第一站。因而用户写一句话后仍必须再点一个承办席，不能让全员分别作答；这不是单席 dispatch 失效，而是名称与真实能力之间的设计缺口。
- 实现：新增 `amphoreus:broadcast → amphoreus:conference-started / amphoreus:conference-progress`；宿主 bridge 在 `model.refresh()` 后只从可信 snapshot 选取 `status=deployed && hidden!=true` 的唯一 skill，不接收 iframe 自报 targets。每席继续走 `PUT binding → create → dispatch observation → prompt`，`open:false`，最多 `3` 席并行；会议页以 13 张席位卡分别显示待召集／建席／回复中／已回复／失败和最终正文，不自动切换当前会话。
- 实机中间缺陷与修正：两轮调试中关闭门户会取消剩余调度，首批各 `3` 席仍由宿主完成；后续又实测非当前 session 的 conversation feed 不会自动水合，以及 session `completed` 可先于最终 response 投影；最终让会议观察全局 session-list 的非空 `projectionValues.turnOutline[].response`，只在正文实际出现后结算该席。
- 最终会议输入：`CONFERENCE-E2E-TURNOUTLINE-FIX-20260905：请每位用一句话说明你是谁，以及你会怎样帮助这个插件变得更好。`；实机产生 session／唯一 skill=`13/13`，同一原文／唯一预期 skill=`13/13`，typed 与 skill 同首 step／skill 先于首条可见回复=`13/13`，角色身份／唯一可见回复=`13/13`，generic=`0/13`、double=`0/13`。
- 最终 UI：会议结果卡=`13`、done=`13`、failed=`0`，标题区字面为 `13/13 已回复 · 本轮结束`；13 张卡均显示各自最终回复。浏览器可见完成进度按 `0→1→3→4→6→9→11→13` 增长，没有把单个角色答复复制成全员结果。
- 严格格式边界：最终会议的「一个 assistant 回复」为 `13/13`，角色身份正确为 `13/13`，但把物理换行也计入时，严格单行服从只有 `4/13`；其余回复由外部 persona／台账格式展开为多行。这一项按失败边界原样记录，不影响 13 席调度、身份、去重或最终回复可见性。
- 生命周期边界：会议汇总只存在当前页面内存；刷新、关闭总览或离开承载视图会取消尚未派出的席位，已经被 DSH 接受的独立 turn 继续按宿主语义收口。调试时产生的取消首批、feed-stall 与投影竞态批次均按各自报告独立清理，不与最终成功批次合并计数。

### 2. 首问「你是谁」由先通用助手后角色的双答改为首请求即角色
- 修复前 13 席统一真调用：prompt accepted／Harness completed=`13/13 / 13/13`，预期 skill invocation 恰好一次=`13/13`，角色名最终能找到=`13/13`；但第一条可见回复角色正确仅 `1/13`、generic-free=`1/13`、无双回复=`1/13`、skill 先于首答=`1/13`、typed 与 skill 同首 step=`0/13`、唯一可见回复=`1/13`、严格单行=`6/13`。也就是 `12/13` 先答通用 DeepSeek／Coding Agent，再迟到一条角色答复。
- 根因：旧 `agent/session-start` 启动异步 `skills.get()` 后调用 `agent.inject()`；首个用户消息已被 `agent/pre-step` 接受时，binding 可能稍后被 session-start 标成 `done`，技能卡进入 `next-step` 而没有进入当前模型请求。权威时间线表现为 `typed → reply1 → skill → reply2`，skill 比 typed 晚 `106–220ms`；binding 最终显示 done 并不证明首请求已经携带角色卡。
- 修复：`agent/session-start` 只同步记住 startup／clear／compact／resume 来源；awaited `agent/pre-step` 成为技能卡唯一提交边界，在当前 accepted decision 内追加对应 `skill-invocation` 后才标记 binding done。显式 `/skill` 同 step 继续去重，resume 继续禁止重复注入，fork／late-binding 仍从 pending 状态走同一 pre-step 路径。
- 修复后 13 席独立真调用：prompt accepted／Harness completed=`13/13 / 13/13`；第一条可见回复角色正确、generic-free、无双回复、skill 先于首答、typed 与 skill 同首 step、恰好一个预期 skill、恰好一个可见回复、严格单行均为 `13/13`。每席时间线均为 `typed@7 → skill@10 → reply1`；generic=`0/13`、double=`0/13`，墙钟由 `360.068s` 降至 `125.443s`，output tokens 由 `39,406` 降至 `10,827`，stderr 增量=`0 bytes`。
- 单席复核：直接从那刻夏席新会话询问身份，时间线=`typed@7 → skill@10 → reply1@1769`，预期 skill 一次、skill 先于首答、generic=false、double=false；回复以正式名「阿那克萨戈拉斯」自述角色与评审职责，没有通用模型前答。

### 3. 黄金裔席位空会话取得真实 Workspace ownership 后可单独对话
- 修复前根因：席位侧栏按 binding 与 session list 列出会话，但 `startSeatSession()` 只用 `{sessionId,cwd:seatDir}` 创建，没有注册或传入 `workspaceId`。DSH 已成功把该 blank session 设为 current，然而 `ConversationRoot` 在 ready 的 `workspaces.items[].sessionIds` 中找不到 owner，于是 `sessionWorkspace=undefined → hero=true → chipTitle=undefined → inert=true`，主区显示「选择工作区」且输入框禁用；侧栏行 active 与主区不可输入可以同时成立。
- 修复：新建席位会话先选择当前普通 DSH Workspace；没有当前普通 Workspace 时按席位内部目录幂等创建 Workspace，再以 `{sessionId,workspaceId}` 建会话。历史上同 seat cwd、无 ownership 的 blank orphan 在打开前按原目录幂等注册并以同 sessionId adoption；普通目录会话仍只 open、不猜 skill。十三个内部 seat workspace 从「我的目录」过滤，避免与「黄金裔席位」重复展示。
- 实机：在普通 Workspace `1` 中从赛飞儿席新建空会话，创建后 Workspace chip 仍为 `1`，当前 session 属于该 Workspace，主区没有回到「选择工作区」，composer 可输入并能完成独立角色对话；历史 orphan 打开路径也走 adoption。直接席位身份会话完成后 archive／binding absent／log retained=`1/1/1`。
- 内部 Workspace 恢复：调试期间创建的内部席位 Workspace 注册共 `4` 个均已删除；唯一新建 blank 测试 session 已官方归档。既有受保护 session 保持 unarchived、binding／日志／nonblank 状态均不变；原用户 Workspace 共 `2` 个（`1`、`缇宝`）原样保留，席位目录与 manifest 未改，stderr=`0 bytes`。

- 最终成功批次清理：修复前身份批次 archive／binding absent／log retained=`13/13 / 13/13 / 13/13`；修复后身份批次=`13/13 / 13/13 / 13/13`；最终全席征询批次=`13/13 / 13/13 / 13/13`。最终会议 active own bindings=`0`，因 observations 无公开 DELETE 路由保留 dispatch 验收记录=`14`，服务 stderr=`0 bytes`；各批次是独立集合，没有把调试批次叠加成虚构总数。
- 独立调试批次清理：首次取消会议=`3/3 / 3/3 / 3/3`，第二次取消会议=`3/3 / 3/3 / 3/3`，feed-stall 批次=`3/3 / 3/3 / 3/3`，投影顺序竞态主体=`10/10 / 10/10 / 10/10`、尾批=`3/3 / 3/3 / 3/3`；每组三元组依次为 archive／binding absent／log retained，分别由各自报告证明。
- 回归与运行终态：会议／身份／Workspace 聚焦测试=`38/38` PASS；最终全量 `npm test` → `tests 341; pass 340; fail 0; skipped 1; duration_ms 3067.7204` PASS（exit: `0`）；最终 lib mtime=`2026-09-05 14:27:33`，derive/client/host=`29.34/217.57/200.33 kB`；`npm run verify:dist` → `verify-dist: OK 382 checks` PASS（exit: `0`）。主服务=`PID 74008 / STATUS running / HTTP 200 / stderr 0 bytes`。
- npm 边界：官方 registry 的 `alpha=0.2.0` 与 `latest=0.2.0`、发布提交及 `v0.2.0` 均未改变；npm `0.2.0` tarball 未重发，以上三项修复仅存在后续 `main`，等待新版本发布。

### 4. 最终运行合同收口与原生提示词调整 — 2026-09-05 15:24
- Workspace：等待席位、Session、Workspace 首帧 ready；只复用当前普通 Workspace，无当前归属则幂等注册对应 seat 目录。Session 创建后等待独立 Workspace follow 的 membership，必要时官方 create 回读；成功创建后的同步或导航失败保留 binding。已有 owner 不重复 adoption；Windows 路径折叠大小写，POSIX 保留。侧栏新建／打开明确选择 chat、保留 draft、关闭 portal；已挂载 Workbench 经官方 openView 切回对话。
- 注入：pre-step 只提议卡片，session/event 接受对应 user/message 才记录 done/skipped；KvTable.update 在写队列内检查绑定代际，排队换席与删除不被旧写覆盖；读卡期间换绑时拒绝过时提议。pending 或 done 的 resume 都核查当前绑定之后的日志，日志缺卡则补首次注入。binding 同席同 face 的幂等 PUT 保留已完成注入；换席重新计 boundAt。
- 原生提示词实机基线：系统首句为 `You are an AI agent powered by DeepSeek Harness.`，deployment persona 另有 `You are a coding agent powered by the deepseek-v4-pro model.`；角色会话现在通过官方 assemble waterfall 替换这两句。cwd、工具说明、运行上下文仍来自宿主；普通会话对照实测保留两句并回复「普通会话正常」。
- 实机直聊：`UI-FINAL-CIPHER` session `session-69237582-9b50-4370-beef-a2569c037041`，Workspace `cipher`／cwd seat/cipher；从首页点席位 + 后输入框可用，发送后默认对话 Tab，首答单条赛飞儿身份；系统首句为本席身份，原两句消失。此会话保留给用户继续查看。官方 API 的 7 项 Workspace／binding／nonblank 检查全部通过。
- 会议终态：原 turnOutline 只有 120 字预览且没有成功／失败语义，因此最终改为官方 remote.session.follow 读取完整 assistant/message 和 turn/end.reason。取消发生于 dispatch 未返回时不再反写 running；控制流使用 microtask，不依赖隐藏页会停的 requestAnimationFrame；部分文本后错误、无文本终止、输出上限、超时、关闭订阅均有回归。
- `CONFERENCE-FINAL-JOURNAL-20260905` 实机暴露遗漏 root remote 服务依赖，UI 13 卡报 `cannot get property "remote" without inject`；该批模型本身完成 13/13、身份正确 13/13、两句原生身份消失 13/13，未将 UI 标绿。按官方客户端同时声明 remote 与 remote.session 后复跑。
- `CONFERENCE-FINAL-REMOTE-20260905` 最终 UI 字面为 `13/13 已回复 · 本轮结束`，13 卡均 done，逐卡可见完整结尾，所有角色都为单条自身回复；官方日志同文、唯一技能、同首 step、技能先于首答、角色身份、两句原生身份消失、真实 completed 均 13/13，generic=0、double=0。完整原文与长度、SHA256 见本地 final-remote-replies.json。
- 内容复核进一步发现昔涟、丹恒曾把参考文件错按 seat cwd 查找，真实 read 返回 FS_NOT_FOUND，尽管 skill resourceBase 已带原目录。现按运行时 card.path 与 config.commonPath 在 system identity 明确 persona/common 两个绝对路径，同时告诉独立派发席只答自身、不据本会话只有自己推断其他席位缺席。定向再调用昔涟、丹恒、三月七：3/3 成功读取正确 persona.md，3/3 成功读取正确 common.md，资料缺失误报=0，要求重新召集／误报其他席缺席=0，单回复=3/3，completed=3/3；`RESOURCE_FIX_RESULT=true`，exit 0。角色卡自带回执仍可附在正文后。
- 最终自动验收：`npm run release:check` → `tests 377; pass 376; fail 0; skipped 1; duration_ms 2783.2196`，build derive/client/host=`29.34/227.54/206.50 kB`，`verify-dist: OK 392 checks`，exit 0；lib 最终 mtime `2026-09-05 15:21:29`。唯一 skip 为未设置 AMPHOREUS_REAL_SUITE 的既有环境合同，另有上述真实模型验收。
- 最终打包：`npm pack --dry-run --json --ignore-scripts` → 420297 bytes / unpacked 1670249 bytes / 73 files / raster images 0，exit 0。运行 PID=81588、HTTP=200、stderr=0。
- 精确清理：两轮 final 会议 26 个 Session、参考路径对照 4 个 Session、baseline Anaxa 与 blank Cipher 各 1，共 32 个已官方 archive，binding absent=32/32，画布隐藏=32/32，权威 zstd 日志保留=32/32；最终 Cipher 展示会话保留。外部技能、主项目文件与用户既有 Workspace 未替换；初始化生成的有效 seat Workspace 保留以支持直聊。npm 0.2.0 未重发，发布 tag 不动。
- 干净环境 CI：首个修复提交 `a4db4d1` 的 run `33952603414` 在 Ubuntu／Windows 都完成测试，但 build 发现缺少 `system-prompt/assemble` 类型声明。已显式添加 `@deepseek-ai/dsh-system-prompt@0.1.2-alpha.4` devDependency 与 type-only import，锁文件仅增该包条目；本地 typecheck exit 0，远程复跑以随后 CI 为准。此项不改变已验证的运行代码。
- 远程复跑闭合：代码提交 `fd5c8769a8cfa9f607ca8aa72c4ae30298021877` 的 CI run `33952725757` 已 completed/success；Ubuntu 与 Windows 的 npm ci、test、build、verify:dist、pack 均 success。主修复为 `a4db4d1f0da4c95f40ad36f19dcef6c7cec785ab`，本地工作树已完成提交并推送；本轮未发布新的 npm 版本。

## 0.2.1：会话管理、归档一致性与功能回归 — 2026-09-05
- 用户反馈黄金裔侧栏 + 新建多段后没有删除入口。根因为自定义 sidebar.workspaces 遮蔽原生菜单，只展示前5条，普通目录还隐藏 blank；门户桥未过滤官方 archived 集合，旧派发记录继续可见。
- 每条席位／目录会话（含blank）新增常驻“归档”入口与行内确认／取消；超过5条可展开全部。同id归档单飞；当前归档后clear，用户已切换的新会话不误清。角色binding与权威日志保留，归档只从界面移除。
- 归档状态通过ctx.workspaces.list贯通门户、工作台线程、派发泳道、移交与会议结果；归档会话不可从旧按钮重新打开／发送／fork，已归档会议卡保留正文而隐藏打开入口。侧栏归档只调用官方archive，不走递归canvas hide，未归档子分支仍可独立使用。
- 快速双击+复现为clicks=2/startCalls=2/pending=2；修复后同skill的+与空席进入共享同步锁，pending禁用，完成后可再次独立新建，不影响会议派发。
- 原生watchNavigation刷新时会按最近工作区准备一个无binding的blank。新增“未绑定角色的对话”组，只显示内部seat目录中真实存在、未绑定、未归档会话，支持普通打开和归档，不自动赋予角色；普通目录规则不变。
- 清理：先停服务备份sessions与storages，CHAT-BACKUP.zip包含347文件、171份会话日志，14897024 bytes，逐文件SHA256回读通过。对清理基线171个会话执行官方归档和画布隐藏，171/171成功，旧可见35→0，15个Workspace注册原样保留。备份后的新建会话按新操作保留；未物理删除权威日志。
- 浏览器实测：两个+生成两段blank；取消归档维持2，确认依次2→1→0，当前归档回首页不主动补新会话；门户“尚无会话”，全体会议画布0次派发。随后超过5条测试6段展开全部，6条都可逐条归档。父会话归档后子分支保留并能打开对话、显示继承的“父会话正常”；内部unbound castorice与普通目录1的blank均可打开／归档。
- 全量验收：tests396/pass395/fail0/skipped1，duration_ms3140.2614；build derive/client/host=29.34/238.61/206.50 kB；verify-dist: OK397 checks，exit0。唯一skip为AMPHOREUS_REAL_SUITE未设置的条件合同。
- 清理事务路径：D:/DeepSeek Harness/.codex-transactions/2026-09-05-chat-cleanup。BASELINE scoped171/archived136/visible35，MODIFIED scoped171/archived171/visible0，副本ROLLBACK恢复scoped171/archived136/visible35；archive和canvas-hidden之外字段不变。回滚脚本在显式live storage目标时按Stop/Start运行，默认需给出目标路径。
- 发布版本定为0.2.1；同步GitHub main、v0.2.1与Release，npm默认latest与既有alpha均指向本补丁，具体结果在发布后补记。
- 0.2.1 发布完成：commit/tag=`144ada7c737c19d48d3771521fb84c2232d76eed`；GitHub main push、v0.2.1 与 Release 全部成功。CI run `33955526162` 的 Ubuntu／Windows 全步骤成功；release run `33955698415` 幂等检查成功，确认本机已发布后跳过重复 publish。
- npm：非TTY初次publish遇EOTP、未发布；TTY重试经用户官方安全密钥验证，CLI字面`+ dsh-amphoreus@0.2.1`。npm dist-tag latest单独验证后字面`+latest: dsh-amphoreus@0.2.1`；registry查询latest=alpha=0.2.1、gitHead=144ada7c…、unpackedSize=1700941。74文件、426064bytes；远端tarball与本地验收包SHA512完全一致，integrity=`sha512-G8KotAJcvQHi+Sv2U2PbjvvIDeRzrewviwRYbD8tdC2ZbFPpkiNhtnk5pxwpee9zjLnhAHWU35hTxuARfrqpqA==`。原v0.2.0/tag/tarball保留。
- 最终功能测试：父会话归档后子分支仍显示并能打开；6条展开全部并逐条归档；未绑定内部草稿与普通目录blank可打开/归档。清理基线之后新建的9个blank是新操作，保留未纳入旧171条清理集合。原生启动可能准备新blank且可管理，未虚报为永久零会话。

## 0.2.2：套件 v1.6.0 接入与合同适配 — 2026-09-05
- 上游固定为v1.6.0/fd01e56ce929fbad2d38011adab20df8a0234065；本机新增独立Git来源D:/DeepSeek Harness/skill-sources/amphoreus-skill-suite，仅检出skills/adapters/docs/tools，不复制图片进插件。原Claude/Codex两套根的44文件经换行归一化逐一比对均一致，未重写全局技能。
- profile仅在skillRoots首位增加专用Git来源，保留原两条候选及free-search、dshmarket和SQLite设置。运行态L0、cards13、指纹fd01e56(v1.6.0)，上游工作树干净。
- 台账只接受固定details/summary结构、默认折叠；任意HTML与属性保持转义，支持backtick/tilde代码围栏。observer去除台账外壳后再检查末行合同；独立审阅发现同一行summary+fence误登记，新增测试先复现4通过/1失败，再修复为全通过。
- 角色system参考补relations.md绝对路径，全席征询显式各席独立作答；未重写技能正文、日志或角色声线。CI与release固定检出上游SHA，真实suite合同不再条件跳过。
- 上游validator：amphoreus wave all: PASS；router_manifest=18/18；cards=13/13；evals=13 scenarios=65；encoding=UTF-8 line_endings=LF；behavior=not_run_by_static_validator，exit0。
- npm run release:check（AMPHOREUS_REAL_SUITE指专用skills根）：tests401/pass401/fail0/skipped0，verify-dist: OK397 checks，exit0。
- 实机SUITE-V160-ROUND-20260905：同文13/13、唯一技能13/13、typed/skill同首step13/13、skill先于回复13/13、completed13/13、单条角色回复13/13、generic0/doubleReply0，两句原生身份均消失13/13。浏览器字面13/13已回复·本轮结束；details13/open0，点击0→1→0。原始回复与会话记录保留供对照，未将台账长度算成角色正文篇幅失败，也未把独立征询称作互相交错对话。
- 事务位于D:/DeepSeek Harness/.codex-transactions/2026-09-05-suite-v1.6。原app.js SHA256=010712952ec45c13eddb0e23202d5881124e16a91c74bc880190db678a359f9c；修改版=aecec66a414f18aefe993a7a0a497263cca54ae28edfbe2c78b06d7fd833d3b2。账本探针baseline exit1（ledger=false），modified exit0（ledger=true/collapsed=true）；ROLLBACK.sh只在独立copy恢复原hash与原行为，线上保留新版。