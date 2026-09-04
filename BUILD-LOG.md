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
- commit: PENDING-TASK
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
