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
- commit: PENDING-TB1
- 验收：
  - `node --test tests/workbench-projection.test.ts` → `tests 1; pass 1; fail 0; skipped 0; duration_ms 128.1887` PASS（exit: `0`）
  - `npm run typecheck` → 无诊断 PASS（exit: `0`）
  - `grep -n 'titleFromText\|noteProjection\|isRuntimeContextText\|cancelled\|canceled' src/host/workbench.ts` → `无输出` PASS（grep exit: `1`，零匹配为预期）
  - `git diff --check` → `无空白错误` PASS（exit: `0`）
- 人工断言：✓ 普通 `source.kind=user` 与无 source 旧消息保留；✓ skill-invocation/skill-catalog/plugin 过滤；✓ 无 source 的 system-reminder/skill-content/runtime-context 回退过滤；✓ 仅 error/aborted/interrupted 成错误；✓ 首条用户正文不再生标题。
- 偏离与理由：TB2 尚未替换旧 WorkbenchStore，本任务按任务书将其过渡期消息正文置空；下一任务改为纯结构索引后该旧路径整体删除。提交短 SHA 按下一提交回填规则处理。
- 遗留：无
