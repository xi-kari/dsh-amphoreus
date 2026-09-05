# dsh-amphoreus 端到端验收清单

> 任一 ☐ 为假则不发布。机器断言必须保留命令输出或对应 `BUILD-LOG.md` 证据；截图只能辅助人工判断，不能替代断言。

## 前置条件

- 已通过本机部署启动脚本启动服务；令牌 URL 从 `.runtime/deepseek-harness.url` 读取，不写入本文件。
- 3080 使用当前 web profile；TF9 的 3090 隔离 profile 使用 `/c/tmp/jar`，下文 `jar` 指对应端口的 cookie jar。
- `assetsRoot` 已配置，技能根实际解析出 13 张卡；本机兼容基线为 `dsh-v0.1.2-alpha.4`。
- 写操作前记录原 profile、主题、席位、技能文件哈希与相关会话状态；结束时逐项恢复。

## A–E 章完成定义汇总

以下断言采用一口气版任务书的最终裁决文本。A-DoD-11 是 A 章阶段门；B 章落地后全局 `uiConversation` 正确计数为 1。B 章历史 404 探针中的已删除路由以等价 shell 字符串拼接记法保存，避免把废弃路由字面重新引入发布清单。A–E 的 `✓` 均对应各章标签和 `BUILD-LOG.md` 已记录的逐项验收。

| 编号 | 来源章·任务 | 断言（命令） | 预期 | 结果 |
|---|---|---|---|---|
| A-DoD-1 | A · A-DoD-1 | `test -d "$PKG/.git"                                                                  # A-DoD-1` | 目录存在 | ✓ |
| A-DoD-2 | A · A-DoD-2 | `[ "$(git -C "$PKG" status --porcelain \| wc -l)" = 0 ]                                # A-DoD-2 工作区干净` | 0 | ✓ |
| A-DoD-3 | A · A-DoD-3 | `[ "$(git -C "$PKG" log --oneline \| wc -l)" -ge 10 ]                                  # A-DoD-3` | ≥ 10 | ✓ |
| A-DoD-4 | A · A-DoD-4 | `[ "$(git -C "$PKG" ls-files \| grep -c '^lib/\|^node_modules/\|pack-dry-run')" = 0 ]  # A-DoD-4` | 0 | ✓ |
| A-DoD-4b | A · A-DoD-4b | `test ! -f "$PKG/.pack-dry-run.json"                                                  # A-DoD-4b 文件已物理删除（不只是 ignore）` | 文件不存在 | ✓ |
| A-DoD-5 | A · A-DoD-5 | `[ "$(grep -c "host: z.union(\['iframe', 'native'\]).default('iframe')" "$PKG/src/host/config.ts")" = 1 ]   # A-DoD-5` | 1 | ✓ |
| A-DoD-6 | A · A-DoD-6 | `[ "$(grep -c "host: 'iframe' \| 'native'" "$PKG/src/host/config.ts")" = 1 ]           # A-DoD-6` | 1 | ✓ |
| A-DoD-7 | A · A-DoD-7 | `[ "$(grep -c "'x-amphoreus-nonce': BOOT.nonce" "$PKG/workbench/app.js")" = 1 ]       # A-DoD-7 锁实现位置：api() 的 nonceHeader` | 1 | ✓ |
| A-DoD-8 | A · A-DoD-8 | `[ "$(grep -c 'export function workbenchPage(boot: WorkbenchBoot)' "$PKG/src/host/webapi.ts")" = 1 ]   # A-DoD-8` | 1 | ✓ |
| A-DoD-9 | A · A-DoD-9 | `[ "$(grep -c 'view-switch' "$PKG/workbench/app.js" "$PKG/workbench/styles.css" \| awk -F: '{s+=$NF} END{print s}')" = 0 ]   # A-DoD-9（修前实测 12）` | 0 | ✓ |
| A-DoD-10 | A · A-DoD-10 | `[ "$(grep -c "openView('chat'" "$PKG/src/client/workbench.tsx")" -ge 2 ]             # A-DoD-10 close + open-session（C TC8 抽 hook 后由 onClose 与 openChat 两处直写 openView('chat' 保持 ≥2，裁决 J-10）` | ≥ 2 | ✓ |
| A-DoD-11 | A · A-DoD-11 | `[ "$(grep -c "'uiConversation'" "$PKG/src/client/index.ts")" = 0 ]                   # A-DoD-11 决策 A-2（注释不带引号）；只在 A 章末成立，B TB4 后该值为 1（裁决 J-2），全局完成定义以 1 为准` | A 章末为 0；B 章后全局为 1 | ✓ |
| A-DoD-12 | A · A-DoD-12 | `test -f "$PKG/src/client/tabmemory.ts" && test -f "$PKG/tests/client-tabmemory.test.ts"   # A-DoD-12` | 两文件存在 | ✓ |
| A-DoD-13 | A · A-DoD-13 | `[ "$(grep -c "dsh-amphoreus:workbench-tab" "$PKG/src/client/tabmemory.ts")" -ge 1 ]  # A-DoD-13` | ≥ 1 | ✓ |
| A-DoD-14 | A · A-DoD-14 | `[ "$(grep -c 'seedConversationView(localStorage' "$PKG/src/client/index.ts")" -ge 1 ] # A-DoD-14` | ≥ 1 | ✓ |
| A-DoD-14b | A · A-DoD-14b | `[ "$(grep -c '"view":null' "$PKG/tests/client-tabmemory.test.ts")" -ge 1 ]          # A-DoD-14b 覆盖「键存在但 view 为 null」用例` | ≥ 1 | ✓ |
| A-DoD-15 | A · A-DoD-15 | `[ "$(grep -c 'if (workbenchEnabled)' "$PKG/src/client/index.ts")" -ge 1 ]            # A-DoD-15` | ≥ 1 | ✓ |
| A-DoD-16 | A · A-DoD-16 | `[ "$(grep -c 'workbench: publicWorkbench(this.#config)' "$PKG/src/host/webapi.ts")" = 1 ]   # A-DoD-16` | 1 | ✓ |
| A-DoD-17 | A · A-DoD-17 | `[ "$(grep -c 'markUnprojectable' "$PKG/src/index.ts")" -ge 2 ]                       # A-DoD-17 两处 catch` | ≥ 2 | ✓ |
| A-DoD-18 | A · A-DoD-18 | `[ "$(grep -c 'settings.workbenchUnprojectable' "$PKG/src/client/locales.ts")" -ge 2 ] # A-DoD-18 zh+en` | ≥ 2 | ✓ |
| A-DoD-18b | A · A-DoD-18b | `[ "$(grep -c 'aria-labelledby="amphoreus-workbench"' "$PKG/src/client/settings.tsx")" = 1 ]   # A-DoD-18b 设置区面板存在` | 1 | ✓ |
| A-DoD-18c | A · A-DoD-18c | `[ "$(grep -c 'wb.enabled ?' "$PKG/src/client/settings.tsx")" -ge 1 ]                 # A-DoD-18c 链接条件渲染` | ≥ 1 | ✓ |
| A-DoD-19 | A · A-DoD-19 | `[ "$(grep -c 'card-unprojectable' "$PKG/workbench/app.js" "$PKG/workbench/styles.css" \| awk -F: '{s+=$NF} END{print s}')" -ge 2 ]   # A-DoD-19` | ≥ 2 | ✓ |
| A-DoD-20 | A · A-DoD-20 | `[ "$(sed -n 2p "$PKG/workbench/mark.svg" \| grep -c 'dsh-synapse')" = 1 ]             # A-DoD-20` | 1 | ✓ |
| A-DoD-21 | A · A-DoD-21 | `[ "$(grep -c "settings.credit" "$PKG/src/client/settings.tsx")" -ge 1 ]              # A-DoD-21` | ≥ 1 | ✓ |
| A-DoD-22 | A · A-DoD-22 | `[ "$(grep -c '^## 致谢' "$PKG/README.md")" = 1 ]                                    # A-DoD-22` | 1 | ✓ |
| A-DoD-23 | A · A-DoD-23 | `[ "$(grep -c '骨架阶段' "$PKG/README.md")" = 0 ]                                     # A-DoD-23` | 0 | ✓ |
| A-DoD-24 | A · A-DoD-24 | `[ "$(grep -c '^## 7' "$PKG/HANDOFF.md")" = 1 ]                                       # A-DoD-24` | 1 | ✓ |
| A-DoD-25 | A · A-DoD-25 | `[ "$(sed -n 3p "$PKG/HANDOFF.md" \| grep -c '2026-09-04 更新')" = 1 ]                 # A-DoD-25` | 1 | ✓ |
| A-DoD-25b | A · A-DoD-25b | `[ "$(sed -n 4p "$PKG/HANDOFF.md")" = "" ]                                            # A-DoD-25b 新引用块后有空行` | 空行 | ✓ |
| A-DoD-26 | A · A-DoD-26 | `(cd "$PKG" && npm run typecheck && npm test && npm run build)                        # A-DoD-26 退出码 0` | 退出码 0 | ✓ |
| A-DoD-27 | A · A-DoD-27 | `curl -s --noproxy '*' -b /tmp/amph.jar http://127.0.0.1:3080/amphoreus/api/state \| grep -c '"workbench":{"status":{"kind":"ready"}'   # A-DoD-27 → 1` | 1 | ✓ |
| A-DoD-28 | A · A-DoD-28 | `curl -s --noproxy '*' -b /tmp/amph.jar http://127.0.0.1:3080/amphoreus/workbench/ \| grep -c '"workbench":{"enabled":true'            # A-DoD-28 → 1` | 1 | ✓ |
| A-DoD-29 | A · A-DoD-29 | `curl -s --noproxy '*' -b /tmp/amph.jar -o /dev/null -w '%{http_code}\n' -X DELETE -H 'content-type: application/json' http://127.0.0.1:3080/amphoreus/workbench/api/threads/00000000-0000-0000-0000-000000000000   # A-DoD-29 → 403（无 nonce 头被拒）` | 403 | ✓ |
| A-DoD-29b | A · A-DoD-29b | `curl -s --noproxy '*' -b /tmp/amph.jar -o /dev/null -w '%{http_code}\n' -X DELETE -H 'content-type: application/json' -H "x-amphoreus-nonce: $NONCE" http://127.0.0.1:3080/amphoreus/workbench/api/threads/00000000-0000-0000-0000-000000000000   # A-DoD-29b → 404（带 nonce 头过门，线程不存在），不是 403` | 404 | ✓ |
| A-DoD-30 | A · A-DoD-30 | 归档不报 `invalid amphoreus nonce`。 | 归档写操作成功且无该错误 | ✓ |
| A-DoD-31 | A · A-DoD-31 | iframe 内无「对话／工作台」胶囊。 | 不存在第二层切换条 | ✓ |
| A-DoD-32 | A · A-DoD-32 | 卡脚「DSH」按钮切到对话 Tab。 | 返回官方对话 Tab | ✓ |
| A-DoD-33 | A · A-DoD-33 | 停在工作台 Tab 时切到本页未打开过的会话仍落工作台（含该会话曾输入过草稿的情况）。 | 新会话保持工作台 Tab 记忆 | ✓ |
| A-DoD-34 | A · A-DoD-34 | 设置页有「工作台」面板与底部署名行。 | 两处均可见 | ✓ |
| B-1 | B · 章末 DoD | `node --test tests/*.test.ts` → `# fail 0`，且存在 `tests/workbench-projection.test.ts`、`tests/migrate-synapse.test.ts`。 | 原文内联预期 | ✓ |
| B-2 | B · 章末 DoD | `grep -n "titleFromText\|noteProjection\|isRuntimeContextText\|MAX_PROJECTION_LENGTH\|acquireLock\|workbench.json\|node:fs\|cancelled\|canceled" src/host/workbench.ts` → 无输出。 | 原文内联预期 | ✓ |
| B-3 | B · 章末 DoD | `grep -n "source.kind\|isInjectedText" src/host/workbench.ts` → ≥ 2 行；`grep -n "kind !== 'user'" src/host/workbench.ts` → ≥ 1 行；`grep -n "'interrupted'" src/host/workbench.ts` → ≥ 1 行；`grep -n "'sessionPersistence'" src/index.ts` → 1 行。 | 原文内联预期 | ✓ |
| B-4 | B · 章末 DoD | `grep -n "workbench/api/"workspaces"\|workbench/api/threads\|pollProjection\|setInterval(\|loadThreadHistory\|messagesFromEvents\|workspaceChoices\|amphoreus:hydrate" workbench/app.js` → 无输出；`grep -c "workbench/api/index" workbench/app.js` → ≥ 2；`grep -c "includeHidden=1" workbench/app.js` → ≥ 1；`grep -c "EventSource(" workbench/app.js` → 1。 | 原文内联预期 | ✓ |
| B-5 | B · 章末 DoD | `grep -n "localStorage" workbench/app.js` → 每行含字面量 `last-seat` 或 `quick-phrases`（首启拷入的读与删；`QUICK_PHRASES_KEY` 常量已删除，`grep -c QUICK_PHRASES_KEY workbench/app.js` → 0）。 | 原文内联预期 | ✓ |
| B-6 | B · 章末 DoD | `grep -n "amphoreus:workspaces\|amphoreus:messages\|amphoreus:live-reply\|amphoreus:config" src/client/workbench.tsx` → 四种消息各 ≥ 1 处发送；`grep -n "followedId" src/client/workbench.tsx` → ≥ 2 行；`grep -n "useCallback" src/client/workbench.tsx` → ≥ 1 行。 | 原文内联预期 | ✓ |
| B-7 | B · 章末 DoD | `grep -n "'uiConversation'" src/client/index.ts` → 1 行；`grep -rn "from '@deepseek-ai/dsh-client-ui-chat/client'" src/client` 全部为 `import type`。 | 原文内联预期 | ✓ |
| B-8 | B · 章末 DoD | 运行态：`curl -s --noproxy '*' -b jar http://127.0.0.1:3080/amphoreus/workbench/api/index \| grep -c '"text"'` → 0；`…/api/"workspaces"` → HTTP 404；`ls "$DSH_HOME/amphoreus/" \| grep -c "workbench.json"` → 0（旧文件删除后）。 | 原文内联预期 | ✓ |
| B-9 | B · 章末 DoD | 运行态：拖动卡片后 `ls "$DSH_HOME/storages/amphoreus_canvas/canvas/" \| wc -l` ≥ 1；`grep -c synapseMigratedFrom "$DSH_HOME/storages/amphoreus.json"` 在存在旧 synapse 文件时为 1。 | 原文内联预期 | ✓ |
| B-10 | B · 章末 DoD | 运行态：`workbench.cardTextLimit=1000` 时长回答卡片含 `——…（详情查看全文）`，详情视图不含该后缀。 | 原文内联预期 | ✓ |
| B-11 | B · 章末 DoD | 运行态：进席新建会话并发一句话，画布仅一张卡，卡标题与正文均不含 `<system-reminder>`／`<skill_content`。 | 原文内联预期 | ✓ |
| B-12 | B · 章末 DoD | `NOTICE` 含 `in-memory seq index` 与 `no session text`；`grep -c "workbench.json" lib/index.js` → 0。 | 原文内联预期 | ✓ |
| B-13 | B · 章末 DoD | TB8：`grep -n "scrollToTurn\|loadThrough" src/client/workbench.tsx` → ≥ 2 行；`grep -c "data-turn=" workbench/app.js` → ≥ 2；`grep -n "'amphoreus:open-session'" workbench/app.js` → 每行含 `turn`；`grep -rn "switchToChat" src/client` → 无输出。 | 原文内联预期 | ✓ |
| B-14 | B · 章末 DoD | 运行态（冷重放）：重启服务后不点开任何会话，`curl -s --noproxy '*' -b jar http://127.0.0.1:3080/amphoreus/workbench/api/index \| python -c "import json,sys;d=json.load(sys.stdin)['sessions'];print(len(d), sum(1 for s in d if s['cards']))"` → 第一个数 ≥ 侧栏会话数，第二个数 ≥ `find "$DSH_HOME/sessions" -mindepth 2 -maxdepth 2 -type d -not -empty \| wc -l` 中有用户消息的会话数（≥ 1）。 | 原文内联预期 | ✓ |
| B-15 | B · 章末 DoD | 运行态（归档）：归档一个会话后 `curl -s --noproxy '*' -b jar 'http://127.0.0.1:3080/amphoreus/workbench/api/index?includeHidden=1' \| grep -c '"hidden":true'` → ≥ 1，且不带 `includeHidden` 的同请求 → 0；刷新页面后该会话不在侧栏与画布。 | 原文内联预期 | ✓ |
| B-16 | B · 章末 DoD | 运行态（长会话画布）：对 ≥ 30 轮会话拖动全部卡后 `PUT /amphoreus/api/canvas/<id>` 返回 200，`python -c "import json,sys;print(len(json.load(open(sys.argv[1]))['positions']))" "$DSH_HOME/storages/amphoreus_canvas/canvas/<id>.json"` ≥ 30；`grep -n "MAX_CANVAS_BODY_BYTES" src/host/webapi.ts` ≥ 2 行。 | 原文内联预期 | ✓ |
| C-1 | C · 章末 DoD | `npm run build` 退出码 0；`node --test tests/*.test.ts` 全 pass，且存在并通过：`tests/injector-inherit.test.ts`、`tests/client-seat-model.test.ts`、`tests/client-seat-wallpaper.test.ts`（D 的 `tests/seat-theme.test.ts` 同时存在）。 | 原文内联预期 | ✓ |
| C-2 | C · 章末 DoD | `grep -c "'session/created'" src/host/injector.ts` ≥ 1；`grep -c "fork-inherit" src/host/injector.ts` ≥ 2；`grep -c "freshFork" src/host/injector.ts` ≥ 2。 | 原文内联预期 | ✓ |
| C-3 | C · 章末 DoD | `grep -c "request.method === 'DELETE'" src/host/webapi.ts` ≥ 1；`grep -c "seatDirs" src/shared/api.ts` ≥ 1（B TB3 前置）。 | 原文内联预期 | ✓ |
| C-4 | C · 章末 DoD | `grep -c "hue: number \| null" src/client/workspaces-source.ts` ≥ 1；`grep -c "source:" src/client/workspaces-source.ts` ≥ 2；`grep -n "WorkbenchThread\|SeatResolver\|createSeatResolver" src/host/*.ts src/index.ts \| wc -l` = 0。 | 原文内联预期 | ✓ |
| C-5 | C · 章末 DoD | `grep -c "seatHeroId" src/client/workbench.tsx` = 0；`grep -c "seatHeroId" workbench/app.js` = 0；`grep -c "startSeatSession" src/client/seat-actions.ts` ≥ 1；`grep -c "deleteBinding(" src/client/seat-actions.ts` ≥ 2（定义 + 回滚调用）；`grep -n "putBinding(deps\|sessions.create(" src/client/seat-actions.ts` 中 `putBinding` 行号小于 `sessions.create` 行号。 | 原文内联预期 | ✓ |
| C-6 | C · 章末 DoD | `grep -n "name: 'sidebar.workspaces'" -A 3 src/client/index.ts \| grep -c "priority: -10"` = 1；`grep -c "children" src/client/index.ts` = 0；`grep -c "data-amphoreus-seat-browser" src/client/seat-browser.tsx` ≥ 2；`grep -c "seatViewsFrom" src/client/seat-browser.tsx src/client/index.ts \| awk -F: '{s+=$2} END {print s}'` ≥ 2。 | 原文内联预期 | ✓ |
| C-7 | C · 章末 DoD | `grep -n "name: 'conversation.session.header.actions'" -A 3 src/client/index.ts \| grep -c "order: -20"` = 1。 | 原文内联预期 | ✓ |
| C-8 | C · 章末 DoD | `grep -c "name: 'sidebar.footer.action'" src/client/index.ts` = 1；`grep -c "name: 'shell.overlay'" src/client/index.ts` = 1；`grep -c "mode=portal" src/client/portal.tsx` ≥ 1；`grep -c "openPortal" src/client/index.ts` ≥ 2（`WorkbenchViewInjected` 注入 + 类型）。 | 原文内联预期 | ✓ |
| C-9 | C · 章末 DoD | `grep -c "registerSeatTheme" src/client/theme.ts` ≥ 1；`grep -c "seatLayer.apply(" src/client/theme.ts` ≥ 2；`grep -c "GLOBAL_SEAT_HERO" src/client/seat-model.ts` ≥ 1；`grep -c "GLOBAL_SEAT_HERO" src/client/theme.ts` ≥ 1；`grep -c "amphoreus-seat-layer" src/host/firstframe.ts` ≥ 3；`grep -c "amphoreus-wallpaper::after" src/host/firstframe.ts` ≥ 1；`grep -c "\.decode()" src/client/theme.ts` ≥ 1；`grep -c "260" src/client/theme.ts` ≥ 1；`grep -c "overrideTokens" src/client/seat-wallpaper.ts` = 0。 | 原文内联预期 | ✓ |
| C-10 | C · 章末 DoD | `grep -c "thread-color.*!important" workbench/styles.css; test $? -eq 1`（预期无匹配，`grep -c` 输出 0 且退出码 1）；`grep -c "card-seat-badge" workbench/app.js` ≥ 1；`grep -c "card-seat-badge" workbench/styles.css` ≥ 1；`grep -c "3478f6" workbench/app.js` = 0；`grep -c "dsh-amphoreus:last-seat" workbench/app.js` = 0；`grep -c "bindingBySession" workbench/app.js` = 0；`grep -c "canvas-group-label" workbench/app.js` ≥ 1。 | 原文内联预期 | ✓ |
| C-11 | C · 章末 DoD | `grep -c "amphoreus:open-seat\|amphoreus:open-portal" src/client/workbench.tsx` ≥ 2；`grep -c "amphoreus:open-seat\|amphoreus:open-portal" workbench/app.js` ≥ 2；`grep -c "amphoreus:close" workbench/app.js` ≥ 2；`grep -c "useWorkbenchBridge" src/client/workbench.tsx` ≥ 2。 | 原文内联预期 | ✓ |
| C-12 | C · 章末 DoD | `grep -nE "#[0-9a-fA-F]{3,8}\b" src/client/seat-browser.module.css src/client/nameplate.module.css src/client/portal.module.css` 输出为空；`grep -nE "rgba?\(" src/client/seat-browser.module.css src/client/nameplate.module.css` 输出为空（`portal.module.css` 仅允许 `.panel` 的 `box-shadow` 一处 `rgba(0,0,0,.28)`）。 | 原文内联预期 | ✓ |
| C-13 | C · 章末 DoD | `node -e "const {zh,en}=await import('./src/client/locales.ts');process.exit(JSON.stringify(Object.keys(zh).sort())===JSON.stringify(Object.keys(en).sort())?0:1)" --input-type=module` 退出码 0，且 `grep -c "'seats.portal'" src/client/locales.ts` = 2。 | 原文内联预期 | ✓ |
| C-14 | C · 章末 DoD | `grep -c "'uiWorkspace'" src/client/index.ts` ≥ 1；`grep -c "席位与目录" README.md` ≥ 1；`grep -c "CSSProperties" src/client/seat-browser.tsx src/client/nameplate.tsx \| awk -F: '{s+=$2} END {print s}'` ≥ 2。 | 原文内联预期 | ✓ |
| C-15 | C · 章末 DoD | 运行态（服务重启后）：`curl -s --noproxy '*' -b /c/tmp/amph.jar http://127.0.0.1:3080/amphoreus/api/state \| grep -c '"seatDirs"'` = 1；`curl -s --noproxy '*' -b /c/tmp/amph.jar -o /dev/null -w "%{http_code}" -X DELETE -H "x-amphoreus-nonce: <state.nonce>" http://127.0.0.1:3080/amphoreus/api/bindings/session-00000000-0000-0000-0000-000000000000` = 404。 | 原文内联预期 | ✓ |
| C-M1 | C · 人工验收 | 在任一非昔涟席新建会话并发一句后，`GET /amphoreus/api/bindings` 含该 id 且 `"source":"seat-new"`、`"injection":{"state":"done"…}`；对其 fork 后出现 `"source":"fork-inherit"` 记录；重启后打开旧的无绑定子会话不新增记录。 | 按原文人工确认 | ✓ |
| C-M2 | C · 人工验收 | 进该席时 `document.body.dataset.amphoreusSeat` 等于其 heroId、`.amphoreus-seat-layer[data-active]` 存在；离席后两者消失；进昔涟席时 dataset 为 `undefined` 且 `--dsw-alias-brand-primary` 为 `rgb(138, 104, 28)`；流式回复期间不反复淡入。 | 按原文人工确认 | ✓ |
| C-M3 | C · 人工验收 | 侧栏：官方 `[data-slot="sidebar.workspaces"] [role="tree"]` 为 `null`，`[data-amphoreus-seat-browser]` 存在；名牌出现在有绑定会话头且在 agent-preset 之前。 | 按原文人工确认 | ✓ |
| C-M4 | C · 人工验收 | 门户：`[data-slot="shell.overlay"] [role="dialog"]` 打开时存在、`pointerEvents === 'auto'`；Esc（焦点在 iframe）/关闭按钮/点 scrim/点席均关闭；Tab 内「全部角色」能打开门户。 | 按原文人工确认 | ✓ |
| C-M5 | C · 人工验收 | 画布：进席后 `.thread-card.selected, .tree-row.active` 非空；卡片带席色边与名牌；未知卡为 `hsl(...)` 通用徽记；多 cwd 时会话树出现目录分组标签。 | 按原文人工确认 | ✓ |
| D-1 | D · 章末 DoD | `node --test tests/*.test.ts` 退出码 0，且存在并通过：`tests/shared-color.test.ts`、`tests/client-theme-bridge.test.ts`、`tests/seat-theme.test.ts`、`tests/shared-motifs.test.ts`、`tests/host-zip.test.ts`。 | 原文内联预期 | ✓ |
| D-2 | D · 章末 DoD | `grep -o "'--dsw-alias-" src/shared/tokens.ts \| wc -l` = 77；`grep -o "'--dsw-specific-" src/shared/tokens.ts \| wc -l` = 10；`grep -c "'--dsw-alias-brand-primary-new" src/shared/tokens.ts` = 0。 | 原文内联预期 | ✓ |
| D-3 | D · 章末 DoD | `grep -c "amphoreus:theme-tokens" src/client/workbench.tsx` ≥ 1 且 `grep -c "amphoreus:theme-tokens" workbench/app.js` ≥ 1；`grep -c "theme/change" src/client/index.ts` ≥ 1。 | 原文内联预期 | ✓ |
| D-4 | D · 章末 DoD | `grep -o -- 'var(--dsw-\(alias\|specific\)-' workbench/styles.css \| wc -l` ≥ 150；`grep -c '\[data-theme="dark"\]' workbench/styles.css` = 1；`grep -c "thread-color: #3478f6 !important" workbench/styles.css` = 0；`grep -o '#3478f6' workbench/styles.css \| wc -l` = `grep -o ', #3478f6)' workbench/styles.css \| wc -l`；`A=$(grep -oE '#[0-9a-fA-F]{3,6}\b' workbench/styles.css \| wc -l); B=$(grep -o ', #[0-9a-fA-F]\{3,6\})' workbench/styles.css \| wc -l); echo $((A-B))` ≤ 8（TD12 第二步做了则改为 `grep -o ', #' workbench/styles.css \| wc -l` ≤ 15）。 | 原文内联预期 | ✓ |
| D-5 | D · 章末 DoD | `grep -c "dsh-amphoreus/seat" src/client/theme.ts` ≥ 1；`grep -o "amphoreus:seat-changed" workbench/app.js \| wc -l` = 3（enterSeat、showPortal、map-opened）且 `grep -c "amphoreus:seat-changed" src/client/workbench.tsx` ≥ 1；`node scripts/check-contrast.ts` 退出码 0 且输出含 `104` 行结果、0 个 `FAIL`。 | 原文内联预期 | ✓ |
| D-6 | D · 章末 DoD | `grep -c "'cyrene'" src/client/theme.ts src/client/seat-theme.ts \| awk -F: '{s+=$2} END {print s}'` ≥ 1（昔涟不切层的显式判断存在）。 | 原文内联预期 | ✓ |
| D-7 | D · 章末 DoD | `ls src/shared/motifs.ts src/client/motif.ts` 均存在；`grep -c "motifDataUri" src/client/workspaces-source.ts` ≥ 1（裁决 J-4）；`grep -c "amphoreus-motif-url" workbench/styles.css workbench/app.js` 各 ≥ 1；`grep -c '^\.main-stage > \.canvas-tabs' workbench/styles.css` = 1。 | 原文内联预期 | ✓ |
| D-8 | D · 章末 DoD | `grep -rc "@font-face" workbench/styles.css src/client/ \| awk -F: '{s+=$2} END {print s}'` = 0；`grep -o "var(--amphoreus-font-display)" workbench/styles.css \| wc -l` ≥ 5；`grep -c -- '--amphoreus-font-display:' src/client/settings.module.css` = 1；`grep -c 'var(--amphoreus-font-display)' src/client/settings.module.css` ≥ 1；`ls src/client/typography.css` 不存在；`grep -o 'font: var(--amphoreus-type-' workbench/styles.css \| wc -l` ≥ 8；`grep -oE -- '--amphoreus-type-[a-z]+: [^;]*' workbench/styles.css \| grep -vc 'var(--amphoreus-font-'` = 0。 | 原文内联预期 | ✓ |
| D-9 | D · 章末 DoD | `grep -c "magazineMode: z.enum" src/host/store.ts` = 1；`grep -c "/amphoreus/api/prefs" src/host/webapi.ts` ≥ 1；`grep -c "magazineModeSource" src/shared/api.ts src/host/webapi.ts` 各 ≥ 1；`grep -c "amphoreus:magazine-mode" workbench/app.js src/client/workbench.tsx` 各 ≥ 1；`grep -c "canReplaceView()" workbench/app.js` 比改前多 ≥ 2（theme-tokens 与 magazine-mode 两个分支都经它）。 | 原文内联预期 | ✓ |
| D-10 | D · 章末 DoD | `grep -c "^\.magazine-full" workbench/styles.css` ≥ 30；`grep -c 'data-folio=' workbench/app.js` ≥ 1（裁决 J-7）；`grep -c 'data-volume=' workbench/app.js` ≥ 3；`grep -c 'data-cover' workbench/app.js` ≥ 2；`grep -c '#3478f6' workbench/app.js` = 0；`grep -c "CARD_HEIGHT = 276" workbench/app.js` = 1（尺寸未改）。 | 原文内联预期 | ✓ |
| D-11 | D · 章末 DoD | `ls lib/derive.js scripts/derive-assets.mjs src/host/zip.ts` 全部存在；`ls lib/*.js \| grep -vc 'lib/\(index\|client\|derive\)\.js$'` = 0（无游离 chunk）；`grep -c "deriveConfig" tsdown.config.ts` ≥ 2；`node -e "const p=require('./package.json');process.exit(p.files.includes('lib/derive.js')&&p.files.includes('scripts/derive-assets.mjs')?0:1)"` 退出 0；`node -e "const p=require('./package.json');process.exit(p.files.some(f=>/\.(png\|jpg\|jpeg\|webp\|zip)$/i.test(f))?1:0)"` 退出 0（白名单无图片）；`grep -c "spawnSync\|{ input" src/host/derive.ts` 只允许 `probeMagick` 那一处 `spawnSync`（`grep -c "spawn(" src/host/derive.ts` ≥ 1）。 | 原文内联预期 | ✓ |
| D-12 | D · 章末 DoD | `grep -c "/amphoreus/derived/" src/host/webapi.ts` ≥ 2；`grep -c "coverUrl" src/client/workspaces-source.ts workbench/app.js` 各 ≥ 1（裁决 J-4）；`grep -c "assetsCacheDir" src/index.ts` ≥ 1；`grep -c derivedWallpaper src/host/firstframe.ts` ≥ 1。 | 原文内联预期 | ✓ |
| D-13 | D · 章末 DoD | `grep -c "settings.visualHeading" src/client/locales.ts` = 2（zh、en 各一）；`grep -c "deriveAssets\|setMagazineMode" src/client/state.ts` ≥ 2；`grep -c "/amphoreus/api/assets/derive" src/host/webapi.ts` ≥ 1；`grep -c "settings.derivedCount', { n:" src/client/settings.tsx` = 1。 | 原文内联预期 | ✓ |
| D-14 | D · 章末 DoD | `grep -c "## 素材包" README.md` = 1；`grep -c "待 token 化" HANDOFF.md` = 0；`grep -c "magazine 'full' layout" NOTICE` = 1；`grep -c -- '--data-dir' README.md` ≥ 1。 | 原文内联预期 | ✓ |
| D-15 | D · 章末 DoD | 运行态（服务已 Stop/Start、`npm run build` 完成、页面刷新；**先执行 D.0.1 前言**）：<br>- `C "$BASE/amphoreus/api/state" \| node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const j=JSON.parse(s);const ok=['light','full'].includes(j.effectiveConfig.magazineMode)&&['config','prefs'].includes(j.effectiveConfig.magazineModeSource)&&typeof j.assets?.cacheDir==='string'&&typeof j.assets?.running==='boolean';process.exit(ok?0:1)})"` 退出 0；<br>- （裁决 J-4，workspaces 路由已删）iframe DevTools：`addEventListener('message', e => { const j = e.data; if (j?.type !== 'amphoreus:workspaces') return; const ok = Array.isArray(j.seats) && j.seats.length === 13 && j.seats.every(x => x.motif && typeof x.motif.light === 'string' && x.motif.light.startsWith('url("data:image/svg+xml') && typeof x.motif.dark === 'string' && Number.isInteger(x.volume) && x.volume >= 1 && x.volume <= 13); console.log('seats-ok', ok) })` 后刷新宿主页 → 打印 `seats-ok true`；`C "$BASE/amphoreus/api/state" \| J 'j.effectiveConfig.magazineMode'` ∈ `"light"\|"full"`；<br>- `C -o /dev/null -w '%{http_code} %{content_type}\n' "$BASE/amphoreus/derived/aglaea/cover-34.webp"` 输出 `200 image/webp`；`C --path-as-is -o /dev/null -w '%{http_code}\n' "$BASE/amphoreus/derived/../../x.webp"` 输出 `404`；<br>- `C -X POST -H 'content-type: application/json' -d '{}' -o /dev/null -w '%{http_code}\n' "$BASE/amphoreus/api/assets/derive"` 输出 `403`。 | 原文内联预期 | ✓ |
| D-16 | D · 章末 DoD | 人工三点（记录到 HANDOFF「验证记录」）：① DSH 切暗色，iframe 同帧变暗，草稿 textarea 焦点不丢；② 进阿格莱雅席整页金/米白（`getComputedStyle(document.body).getPropertyValue('--dsw-alias-brand-primary')` ≠ `rgb(138, 104, 28)`）、进昔涟席与全局一致、回门户恢复为 `rgb(138, 104, 28)`；③ 设置区切重档后画布出现 `Q` 徽章（`::after` 计算字号 22px）与 `NN / NN` 页码，切回轻档消失且 `.thread-card` 数量不变。 | 原文内联预期 | ✓ |
| E-1 | E · 章末 DoD | `node --test tests/*.test.ts` 退出码 0，且新增测试文件存在：`tests/dispatch-match.test.ts`、`tests/webapi-observations.test.ts`、`tests/observer.test.ts`、`tests/firewall-words.test.ts`；`test -f tests/fixture-suite.ts`。 | 原文内联预期 | ✓ |
| E-2 | E · 章末 DoD | `npm run build` 退出码 0；`grep -c "amphoreus:dispatch\b" lib/client.js` ≥ 1；`grep -c "amphoreus:accept-handoff" lib/client.js` ≥ 1；`grep -c "amphoreus:insert-input" lib/client.js` ≥ 1；`grep -c "amphoreus:state" lib/client.js` ≥ 1；`grep -c "amphoreus:enter-seat" lib/client.js` ≥ 1。 | 原文内联预期 | ✓ |
| E-3 | E · 章末 DoD | `grep -n "'dispatch'" src/host/store.ts` 命中 ≥ 2（`BindingSchema.source` 与 `ObservationSchema.kind`）；`grep -n "dispatchedFrom\|pipeline: z.string\|station: z.number\|tier: z.string" src/host/store.ts` 命中 4 行；`grep -c "'dispatch'" src/host/webapi.ts` ≥ 2（`BindInput.boundBy` 与 `ObservationCreateInput.kind`）。 | 原文内联预期 | ✓ |
| E-4 | E · 章末 DoD | `test -f src/host/observer.ts && grep -c "registerObserver" src/index.ts` ≥ 1；`grep -c "export const NOTIFY_VERB" src/host/suite/parse.ts` = 1；`grep -c "session.append" src/host/observer.ts` = 0。 | 原文内联预期 | ✓ |
| E-5 | E · 章末 DoD | `grep -c "#observationsRoute" src/host/webapi.ts` ≥ 2；`grep -c "ObservationCreateInput" src/host/webapi.ts` ≥ 2；`grep -c "OBSERVATION_KEY" src/host/webapi.ts` ≥ 2；`grep -c "safeParse" src/host/webapi.ts` ≥ 2；`grep -c "64 \* 1024" src/host/webapi.ts` ≥ 3（observations POST/PUT + memory PUT）；`grep -c "413" src/host/webapi.ts` ≥ 1。 | 原文内联预期 | ✓ |
| E-6 | E · 章末 DoD | `grep -c "handoffEnabled\|receiptParsing\|dispatchHints\|pipelinesEnabled" src/shared/api.ts` = 4。 | 原文内联预期 | ✓ |
| E-7 | E · 章末 DoD | `test -f src/client/handoff.ts src/client/handoff-dock.tsx src/client/pipeline-rail.tsx src/client/seat-badge.tsx src/client/bridge-state.ts src/client/enter-seat-queue.ts`；`grep -c "conversation.input.dock" src/client/index.ts` ≥ 1；`grep -c "conversation.session.header.utilities" src/client/index.ts` ≥ 1；`grep -c "'uiConversation'" src/client/index.ts` = 1；`grep -c "order: 30" src/client/index.ts` ≥ 1；`grep -c "from './seat-actions.ts'" src/client/handoff.ts` ≥ 1。 | 原文内联预期 | ✓ |
| E-8 | E · 章末 DoD | `grep -c "\.prompt(" src/client/handoff.ts` = 1，且该行位于 `dispatchTask` 函数体内（`awk '/^export async function dispatchTask/,/^}/' src/client/handoff.ts \| grep -c "\.prompt("` = 1）；`awk '/^export async function acceptHandoff/,/^}/' src/client/handoff.ts \| grep -c "\.prompt("` = 0；`grep -c "sessions.create(" src/client/handoff.ts` = 0（create 只在 seat-actions）。 | 原文内联预期 | ✓ |
| E-9 | E · 章末 DoD | `grep -c "@mirror-begin suggestSeats" workbench/app.js` = 1；`grep -c "function renderDispatchPanel\|function renderDispatchLane\|function renderConnectingTail\|function renderLedger\|function handoffChain\|function statusOf" workbench/app.js` = 6；`grep -c "handoff-connector\|dispatch-edge" workbench/app.js` ≥ 2；`grep -c "amphoreus:dispatched" workbench/app.js` ≥ 1；`grep -c "amphoreus:dispatched" src/client/workbench.tsx` ≥ 1；`grep -c "amphoreus:handoff-accepted" workbench/app.js` ≥ 1；`grep -c 'data-workspace="all"' workbench/app.js` ≥ 2（门户 + canvasTabs chip）。 | 原文内联预期 | ✓ |
| E-10 | E · 章末 DoD | `grep -c "x-amphoreus-nonce" workbench/app.js` ≥ 1。 | 原文内联预期 | ✓ |
| E-11 | E · 章末 DoD | `grep -c "\.dispatch-panel\|\.dispatch-lane\|\.connecting-tail\|\.ledger\b\|\.handoff-connector\|\.seat-chip" workbench/styles.css` ≥ 6；四段标记块内 alias 计数（绝对值，不依赖改动前基线）：`awk '/@e-begin dispatch-panel/,/@e-end dispatch-panel/' workbench/styles.css \| grep -o 'var(--dsw-alias-' \| wc -l` ≥ 18；`dispatch-lane` 段 ≥ 8；`connecting-tail` 段 ≥ 8；`ledger` 段 ≥ 8；四段内 `grep -c '\[data-theme="dark"\]'` = 0；`grep -c 'canvas-controls' workbench/styles.css` 与改动前一致（本章不加该选择器；数值以 D 章落地后为准，动手前先 `grep -c` 记下）。 | 原文内联预期 | ✓ |
| E-12 | E · 章末 DoD | `src/client/handoff-dock.module.css`、`src/client/pipeline-rail.module.css` 中 `grep -c "#[0-9a-fA-F]\{3,6\}\b"` = 0 且 `grep -c "rgba\?(" ` = 0（无例外）。 | 原文内联预期 | ✓ |
| E-13 | E · 章末 DoD | 运行态（服务已 Stop/Start，E.0.2 前置块已跑）：<br>- `curl -s --noproxy '*' -b jar "$U/amphoreus/api/state" \| grep -c '"handoffEnabled":true'` = 1（真实套件 L0 下）。<br>- 按 TE2 验收 POST 一条 dispatch → 201；`curl -s --noproxy '*' -b jar "$U/amphoreus/api/observations" \| grep -c '"kind":"dispatch"'` ≥ 1；`grep -c ':0:dispatch' "$STORE"` ≥ 1。<br>- 触发一行移交后 `GET /amphoreus/api/observations` 出现 `"kind":"handoff","status":"open"`；接受后同键 `"status":"accepted"` 且 `GET /amphoreus/api/bindings` 出现 `"source":"handoff-fork"`。<br>- 被接受的子会话 `<child>`：`curl -s --noproxy '*' -b jar "$U/amphoreus/api/observations?sessionId=<child>" \| grep -c '"kind":"dispatch"'` = 0；`dumplog "$(find "$SESSIONS" -path "*<child>*" -name session.jsonl.zstd)" \| grep -c '"type":"user/message"'` 等于同命令 `grep -c 'skill-invocation'` 的值（插件没有发出任何用户消息，只有注入）。<br>- `bindings` 中原会话 `skillName` 在整个移交流程前后不变。 | 原文内联预期 | ✓ |
| E-14 | E · 章末 DoD | `node --test tests/firewall-words.test.ts` pass（工艺词只在台账函数体、tooltip、locales `*Tip` 键、settings.tsx、handoff.ts 的 observationKey/注释出现）。 | 原文内联预期 | ✓ |
| E-15 | E · 章末 DoD | TE10 文档断言：`grep -cF '${sessionId}:${seq}:${kind}' README.md` ≥ 1；`grep -c "amphoreus:enter-seat" README.md` ≥ 1；`grep -c "conversation.input.dock" HANDOFF.md` ≥ 1；`grep -c "QueueDock" HANDOFF.md` ≥ 1。 | 原文内联预期 | ✓ |
| E-M1 | E · 人工验收 | 任一会话工作台点「全体会议」chip → 出现派发面板与泳道；总览门户「去派发」→ 落到同一画布且文本已带入。 | 按原文人工确认 | ✓ |
| E-M2 | E · 人工验收 | 那刻夏席会话头出现「逐火线 5/10」chip；点外/Escape 可关。 | 按原文人工确认 | ✓ |
| E-M3 | E · 人工验收 | 有 open 移交的会话 composer 上方出现横条，且 iframe 详情底部出现「黄金裔接通中…」卡。 | 按原文人工确认 | ✓ |

## 跨章发布断言

| 编号 | 来源章·任务 | 断言（命令） | 预期 | 结果 |
|---|---|---|---|---|
| X-1 | 跨章 · 注入不成卡（①④，G1） | 进任一席新建会话发一句话后：`curl -s --noproxy '*' -b jar -w '\n%{http_code}' http://127.0.0.1:3080/amphoreus/workbench/api/index \| tee /tmp/x1 \| tail -1` → `200`；`head -n -1 /tmp/x1 \| grep -c "system-reminder\|skill_content\|\"text\""` | `200` 且 `0` | ✓ |
| X-2 | 跨章 · 正文不落盘（G8） | `test ! -f "$DSH_HOME/amphoreus/workbench.json" && echo absent` | `absent` | ✓ |
| X-3 | 跨章 · 画布 token 化（⑤，G2） | `grep -o -- 'var(--dsw-\(alias\|specific\)-' workbench/styles.css \| wc -l` | ≥ `150` | ✓ |
| X-4 | 跨章 · 写操作带 nonce（G3） | `grep -c "x-amphoreus-nonce" workbench/app.js` | ≥ `1` | ✓ |
| X-5 | 跨章 · 绑定权威（②） | 席内新会话后 `node -e "const s=require('$DSH_HOME/storages/amphoreus.json');console.log(Object.keys(s.tables?.bindings??s.bindings??{}).length)"`（键路径动手前 `head -40` 该文件核对） | ≥ `1` | ✓ |
| X-6 | 跨章 · fork 继承席位（G7） | 席内分支后 bindings 中出现 `"source":"fork-inherit"`（或 E/D 章定义的等价字段） | 出现 | ✓ |
| X-7 | 跨章 · 开关生效（G10） | profile 补丁 `workbench: { enabled: false }` 热载（`cordis.patch.yml` 走 live，F-27）后刷新：`document.querySelectorAll('[role=tab]')` 文本不含「工作台」 | 不含 | ✓ |
| X-8 | 跨章 · 无损更新入口不倒退（⑦） | `grep -c "reparse" src/host/webapi.ts src/client/settings.tsx` 均 ≥ 1；`grep -c "skillRoots" src/host/config.ts` ≥ 1；`git ls-files \| grep -c "SKILL\.md\|persona\.md\|common\.md\|relations\.md"` = 0（仓内无技能文件；运行时 `readFile` 读取技能卡是硬约束要求，**不是**内嵌）；`npm pack --dry-run --ignore-scripts --json 2>/dev/null \| grep -c "SKILL.md"` = 0 | 成立 | ✓ |
| X-9 | 跨章 · 只读技能目录 | `grep -rnE "\b(writeFile\|mkdir\|rename\|rm\|unlink\|appendFile\|copyFile)(Sync)?\(" src/host/suite/ \| wc -l`（函数调用形态；`types.ts:146` 的 `'suspected-rename'` 字面量不计，F-29） | `0` | ✓ |
| X-10 | 跨章 · 不写会话事件 | `grep -rn "session.append\|appendEvent" src/ \| wc -l` | `0` | ✓ |
| X-11 | 跨章 · 组件不见 ctx | `grep -n "\bctx\b" src/client/*.tsx \| grep -v ":[0-9]*:\s*\(\*\|//\|/\*\)" \| wc -l`（注释行除外；`workbench.tsx:4` 头注释含 `ctx.sessions`，F-29） | `0` | ✓ |
| X-12 | 跨章 · 样式纪律 | `grep -n "#[0-9a-fA-F]\{3,8\}\b" src/client/*.module.css \| wc -l` | `0`（字面色值只允许在 `src/shared/heroes.ts` 色板与 workbench/styles.css 的 `var(..., #fallback)` 回退位） | ✓ |
| X-13 | 跨章 · 发布纯净（⑥） | `npm run verify:dist \| tail -1 \| grep -c "^verify-dist: OK"` | `1` | ✓ |
| X-14 | 跨章 · garnish.ts 例外处置 | HANDOFF 中有一行明确「garnish.ts 的 `document.body.appendChild` 保留/移除」的裁决与理由 | 存在 | ✓ |

## 手工走查脚本

前置：服务已启动；令牌 URL 见 `.runtime/deepseek-harness.url`；`assetsRoot` 已配置；技能根有 13 张卡。每一步都必须执行，不以截图代替机器证据。

   1. **打开门户**
      - 操作：点击侧栏底部或总览入口，打开十三席门户。
      - 预期：显示 13 席卡和全体会议入口；每席有封面、贴纸与席色；未部署席显示套件缺席标准行而非代演。
      - 记录字段：可见席数（应为 `13`）、全体会议入口、未部署席文案与素材状态。

   2. **进席（那刻夏 anaxa）**
      - 操作：从门户进入那刻夏席，同时开始计时并读取计算样式。
      - 预期：不超过 300 ms，壁纸切为该席封面，`document.body` 的 `--dsw-alias-brand-primary` 变为 `heroes.ts` 中 anaxa 的 accent；侧栏出现该席会话列表。
      - 记录字段：耗时、`getComputedStyle(document.body).getPropertyValue('--dsw-alias-brand-primary')`、会话列表条数。

   3. **新会话**
      - 操作：点击「在此席新建会话」。
      - 预期：会话立即进入该席分组；`/amphoreus/api/state` 的 bindings 出现该 sessionId 到 `amphoreus-anaxa` 的绑定，顺序为先 PUT 再 create。
      - 记录字段：sessionId、binding 的 skill/source/injection、会话出现时间。

   4. **首轮回执**
      - 操作：输入「自我介绍」，等待首答完成并打开轨迹视图；随后在同一会话输入一个明确的工作场评审对象。
      - 预期（2026-09-05 实测裁决）：当前运行时 `common.md` 把纯自我介绍归入陪聊场并免逐轮回执，首答应保持自然对话；工作场答复末行必须匹配 `PublicSuite.contracts.receipt` 正则和规定的 `◯◯卡｜读取：…｜档位：…` 形状，UI 有回执标记。两轮的轨迹视图均把注入消息作为 inject 角色呈现，`<available_skills>` 不含 amphoreus-*。
      - 记录字段：陪聊首答、工作场回执行原文、UI 标记、inject 节点、available_skills 检查结果。

   5. **切 Tab**
      - 操作：点击「工作台」Tab；点一次「归档」再撤销；检查返回官方对话 Tab 的路径。
      - 预期：自我介绍首轮完成时画布恰有 1 张卡；完成第 4 步的工作场 follow-up 后最终有 2 张卡，两张均无注入正文，第一张标题为「自我介绍」，并带承办名牌和席色；没有第二层「对话／工作台」切换条，或其中「对话」按钮能切回官方 Tab；不出现 `invalid amphoreus nonce` 红条。
      - 记录字段：首轮／最终卡数、卡标题、名牌、席色、Tab 列表、归档／撤销结果。

   6. **派发**
      - 操作：回到总览／全体会议，在派发入口输入一条任务，确认后派给白厄。
      - 预期：白厄席出现新会话并绑定 `amphoreus-phainon`；画布出现对应卡且承办为白厄；确认动作之前不发送文本。
      - 记录字段：新 sessionId、binding、dispatch observation、卡片承办与确认前消息数。

   7. **移交**
      - 操作：在那刻夏会话中要求模型输出 `此事移交白厄：<移交物>`，观察待处理状态，然后点击接受。
      - 预期：接受前出现移交坞／横条，不自动切换、不自动发送；点击接受后才 fork 和绑定；同席或 `all` 工作区内显示虚线移交边，跨席显示角标。
      - 记录字段：observation key/status、acceptedSessionId、下游 binding、接受前后当前会话、用户消息数、连线或角标。

   8. **切暗色**
      - 操作：DSH 设置 → 外观 → 暗色，同时采集宿主与 iframe 样式。
      - 预期：外壳与 iframe 画布同步变暗；画布底色来自 `--dsw-alias-bg-base` 的暗值；席位 accent 使用暗色变体，壁纸遮罩增强。
      - 记录字段：`document.body.dataset.dsDarkTheme`、iframe `getComputedStyle(iframe.contentDocument.body).backgroundColor`、accent 与遮罩值。

   9. **切席换装**
      - 操作：从那刻夏切到遐蝶，再切到昔涟。
      - 预期：每次切换壁纸淡入且无白闪；进入昔涟席不保留逐席壁纸和 token；`overrideTokens('dsh-amphoreus/seat')` 层撤销，品牌主色回到全局昔涟值。
      - 记录字段：三次 `--dsw-alias-brand-primary`、三次壁纸 URL、全局层恢复值。

   10. **关 `workbench.enabled`**
       - 操作：备份 profile 补丁；在 amphoreus 行复述完整 config 并加入 `workbench: { enabled: false }`，等待 live 热载后刷新，再原样恢复。
       - 预期（2026-09-05 实测裁决）：关闭时 Tab 文本不含「工作台」；稳定 HTML 壳 `/amphoreus/workbench/` 保持 `200` 并在 boot 中明示 disabled，J-13 的权威数据入口 `/amphoreus/workbench/api/index` 返回 `503` 与关闭原因；设置区显示同一原因。恢复后 Tab、boot.enabled 和数据入口均恢复。
       - 记录字段：关闭／恢复两次 Tab 列表、壳与 API HTTP 状态、boot 字段、设置区原因、补丁恢复哈希。

   11. **重解析套件**
       - 操作：由测试操作者临时修改 `~/.claude/skills/amphoreus-anaxa/SKILL.md` 的 description 别名，等待 suiteWatch 或点击「重新解析套件」，验证后恢复；再暂时把 `amphoreus-cipher` 目录改名为 `_amphoreus-cipher`，验证后恢复并再次解析。
       - 预期：第一次解析代次加 1，`suite_events` 出现 `parsed`，显示名变化且席位／绑定／记忆不丢；目录缺失时该席变为「未部署」、会话保留、横幅显示降级原因；恢复后该席回到 `deployed`。
       - 记录字段：原始文件哈希、两次代次、suite_events、显示名、两次 seats 状态、绑定／记忆计数、恢复哈希。

   12. **清理**
       - 操作：还原 profile、主题、席位和全部技能临时改动；归档测试会话并清理对应 binding；检查技能工作树。
       - 预期：`git -C ~/.claude/skills status`（若为工作树）无差异；没有测试 profile 差异或孤儿进程；不删除 `$DSH_HOME/sessions` 权威日志。
       - 记录字段：技能 git status、profile 哈希、主题／席位、归档结果、binding 清理结果、服务状态。

## 结果记录

- 日期：2026-09-05
- lib 构建时间：`index.js 2026-09-05 10:50:04`、`client.js 2026-09-05 10:50:04`、`derive.js 2026-09-05 10:50:04`
- DSH 版本：`0.1.2-alpha.4`
- 浏览器：Playwright CLI / Chromium

本轮先冻结 profile、技能文件、主题、binding 与 memory 状态，再完成所有写操作和恢复。纯「自我介绍」在当前运行时 `common.md` 中属于陪聊场，按合同免逐轮回执；因此第 4 步同时保留这条真实聊天行为，并用同一会话的工作场评审验证末行回执与 receipt observation。工作台 HTML 壳在关闭时仍以 `200` 提供带 `workbench.enabled=false` 的自诊断启动数据；真正的数据入口 `/amphoreus/workbench/api/index` 按 J-13 返回 `503` 与关闭原因。两处均按当前运行时合同记录，不把外部技能更新或稳定壳误判为插件倒退。

| 步骤 | 结果 | 备注／证据 |
|---:|---|---|
| 1 | ✓ | 3080 真实门户显示全体会议与 13 张席位卡；素材配置为真，常态 13 席均 deployed。第 11 步真实撤去 Cipher 后，state 将该席标为 undeployed、cards=12、既有会话／binding 保留，侧栏只在「未部署席位（1）」列出赛飞儿且没有角色代演。 |
| 2 | ✓ | 门户点击那刻夏到 token 稳定实测 `27 ms`；`--dsw-alias-brand-primary=rgb(35, 102, 77)`，等价于 heroes.ts 的 `#23664d`；侧栏出现那刻夏会话组。独立视觉复核中活动壁纸层为 `/amphoreus/derived/anaxa/cover-169.webp`、opacity=`1`。 |
| 3 | ✓ | 新会话 `session-c9f752ec-1b5b-47ff-9017-96cb891d09d9` 先绑定再创建；binding=`amphoreus-anaxa/seat-new`，injection=`done`。 |
| 4 | ✓ | 「自我介绍」真实首答按当前陪聊合同免逐轮回执，页眉仍显示「那刻夏 · 代码 / 已注入」，轨迹里的 skill-invocation 独立存在且 available_skills 不含 amphoreus-*；随后工作场评审末行逐字为 `那刻夏卡｜读取：common.md、persona.md｜档位：标准`，receipt observation 与 handoff observation 同 seq=`10151` 落盘。 |
| 5 | ✓ | 第 4 步「自我介绍」首轮刚完成时，当前会话向画布贡献恰好 1 张问答卡，含那刻夏名牌、席色与两次工具标记；随后为验证工作场回执／移交而新增第二轮，最终权威 index 为 cards=`2`、seq 对=`10:2949,2956:10151`。iframe 无重复 Tab 条。点击归档后弹出确认框，选择取消，未写 hidden 状态；分支 `session-75c02d32-cae0-47d4-a94e-cd4b5bbd57a4` 的 binding 为 `amphoreus-anaxa/fork-inherit`，注入跳过理由 `inherited-from-parent`。 |
| 6 | ✓ | 经「全部席位」显式选择白厄后才发送；新会话 `session-7c325c21-57a4-4d45-ab0d-d636b82759ee`，binding=`amphoreus-phainon/dispatch`，dispatch payload 原样，泳道与卡片承办均为白厄。模型把无语义探针当长任务运行，5 分钟后由测试操作者 cancel；这不影响 PUT→create→observation→prompt 的派发主链验收。 |
| 7 | ✓ | 接受前 observation=`open`、当前会话未切换且 handoff-fork 数为 0；移交坞显示「移交给 白厄？」。接受后 observation=`accepted`，child=`session-7f42802e-a1ee-41b4-bfa7-157923f81dd2`，binding=`amphoreus-phainon/handoff-fork`、来源 seq=`10151`；child 在最后 `session/end-seed` 后 user/assistant 新增均为 0，跨席卡显示「移交自 那刻夏」。同工作区虚线边已由 E 章 TE6/TE8 的真实浏览器验收记录覆盖。首次普通指针点击被宿主 40px 右宽度手柄截获，修复后 dock 宽度与 composer 共用上限；真机框为 dock x=420..1132、按钮 x=1011..1061、handle x=1144..1184，overlap=false，第二次普通 `click` 一次成功并产生唯一 child。 |
| 8 | ✓ | 暗色时 body 存在 `data-ds-dark-theme`，主色=`rgb(99, 105, 148)`、base=`rgba(19, 22, 43, 0.4)`，iframe body 背景同值；恢复「跟随系统」后属性移除、base 回 `rgba(238, 239, 247, 0.22)`。切换过程无白屏。 |
| 9 | ✓ | 那刻夏主色=`rgb(35, 102, 77)`、活动层=`derived/anaxa/cover-169.webp`/opacity 1；遐蝶经可读性合成为 `rgb(134, 135, 182)`、活动层=`derived/castorice/cover-169.webp`；昔涟撤销逐席覆盖后回全局主色 `rgb(138, 104, 28)`，两个逐席层均无 background 且 opacity 0。切换无白闪，最终 `prefs.lastSeat=null`。 |
| 10 | ✓ | profile 原始 SHA256=`DB10860ACCBAB96252A33C5F62106E7834D8102F8D2543B0BFB1837CB8F7C6BC`。live 关闭后 Tab 列表无「工作台」，设置区逐字显示 `已在配置中关闭（workbench.enabled=false）`，API index=`503`；稳定 HTML 壳=`200` 且 boot 明示 disabled。按原始 bytes 恢复后 SHA 相同、Tab 恢复、API index=`200`、state enabled=true。 |
| 11 | ✓ | Anaxa description 临时别名出现在运行时 aliases，generation 经 watcher/显式解析递增到 3，binding `21→21`、memory hash 不变；恢复后文件 SHA256=`E6BBFDCFCB0BC17926555010FE16D07322EA5E31D0166565BCC1DCAF2551FBA2` 且 mtime 原样，generation=4。Cipher 目录缺失时 cards=12、seat=`undeployed`、既有 binding=1、UI 显示「未部署席位（1）」和赛飞儿；恢复后 generation=7、cards=13、seat=`deployed`、L0。`suite_events` 逐次保留 parsed：generation `2/3/4/5/6/7`，对应 cards `13/13/13/12/12/13`。 |
| 12 | ✓ | 两轮共 6 个测试会话均经官方 `workspace/archiveSession` 成功归档，6 个日志目录均保留；对应 bindings 全部 DELETE 200，最终 binding 从本轮峰值 21 回基线 17。profile/Anaxa hash、Anaxa mtime、Cipher 路径、主题、`lastSeat=null`、memory hash 均恢复；3080 running/HTTP 200、stderr 0 bytes、3090 listeners 0、临时 cookie/备份/rollback 文件全部删除。observations 由 14 增至 19，因公开 API 无删除路由而保留为已归档验收证据。 |

## 0.3.0 增补

> 沿用前文的 `$BASE`／`jar`／nonce 约定：`N` 为首帧下发的 `x-amphoreus-nonce`，写请求带 `-H "x-amphoreus-nonce: $N" -H "content-type: application/json"`（下文简记为 `$W`）。`<skill>` 取 `amphoreus-anaxa`。行为细节以 `docs/features/*.md` 为准。

| 编号 | 断言（命令） | 预期 | 结果 |
|---|---|---|---|
| R30-1 | `curl -s -b jar -X POST "$BASE/amphoreus/api/assets/check" $W -d '{}' -o /dev/null -w '%{http_code}'` | `200`，响应 `report` 含必需／可选／壁纸夹计数 | ☐ |
| R30-2 | `curl -s -b jar -X PUT "$BASE/amphoreus/api/assets/root" $W -d '{"root":"C:/Windows"}' -w '\n%{http_code}'` | `400`，正文含 `does not look like an Amphoreus asset pack`；`prefs.assetsRoot` 不变 | ☐ |
| R30-3 | `curl -s -b jar -X POST "$BASE/amphoreus/api/memory/<skill>/notes" $W -d '{"text":"E2E 留言"}'` → 取 `note.id` → `curl -s -b jar -X DELETE "$BASE/amphoreus/api/memory/<skill>/notes/<id>" -H "x-amphoreus-nonce: $N" -o /dev/null -w '%{http_code}'` | POST `201` 且回显已存储 note；DELETE `200`；再 GET `/amphoreus/api/memory/<skill>` 不含该 id | ☐ |
| R30-4 | `curl -s -b jar -D - "$BASE/amphoreus/api/prefs/visual-scheme" -o /tmp/scheme.json \| grep -i '^content-disposition'` | 含 `attachment`；文件 `version` 为 `1`，除三个视觉键与 `exportedAt` 外不含其他偏好键 | ☐ |
| R30-5 | 浏览器：焦点在页面（非 iframe、非输入框）时按 `Alt+3` | 进入侧栏第 3 席（按 `userOrder ?? order`）的最近会话或新建一段并切到对话视图；`Alt+0` 开关总览 | ☐ |
| R30-6 | 浏览器：设置 → δ-me13，`document.querySelectorAll('[data-amph-console] section').length` | `12`（席位目录、运行时、视觉层、素材向导、视觉语法、席位壁纸、视觉方案、席位预设、席位音效、席位记忆、工作台、诊断） | ☐ |

清理：删除 R30-3 留下的 note（若 DELETE 失败则从设置面板删除）；R30-2 不改变任何状态；R30-4 的下载文件不含壁纸二进制，可直接删除。
