# 席位切换：Alt+数字 快捷键 与 `/seat <名字>` 命令

## 做什么

- **Alt+1 … Alt+9**：按侧栏顺序（已部署且未隐藏，按 `userOrder ?? order` 排序，与 `seatViewsFrom` 一致）进入第 N 个席位；落点与侧栏点击完全相同——有绑定会话则打开最近一段并切到对话视图，没有则新建席位会话再切到对话视图。第 10 个及之后的席位没有数字键。
- **Alt+0**：开关 δ-me13 总览浮层（`portal.toggle`）。
- **`/seat <名字>`**：在输入框里输入 `/seat 那刻夏` 回车即进入该席；`/seat all`（或 `全体`、`总览`、`portal`）打开总览。名字匹配顺序：精确 → 忽略大小写，覆盖显示名、用户改名、skillName（含去掉 `amphoreus-` 前缀的短名）、heroId、技能卡 displayName 与 aliases。只解析已部署席位；隐藏席位仍可按名字进入。
- `/` 菜单里 `seat` 分组（不显示组标题）：每个可见席位一行 + `seat all`，描述里带 `Alt+N`；只在行首触发时出现。菜单选中某行后 token 变成 `/seat <名字> `，再回车确认。
- 侧栏席位行的 `title` 追加 `快捷键 Alt+N`。

## 新增

| 类别 | 内容 |
| --- | --- |
| 客户端模块 | `src/client/seat-switch.ts`（纯函数：`orderedHotkeySeats` / `seatForDigit` / `resolveSeatByName` / `parseSeatLine` / `hotkeyLabel`）、`src/client/seat-hotkeys.ts`（`installSeatHotkeys`，window keydown，返回 disposer）、`src/client/seat-command.ts`（`createSeatCommandSource`，自有 InputTriggerSource，trigger `/`、name `seat`）、`src/client/seat-start-guard.ts`（`createSeatStartGuard`，跨快捷键 / `/seat` 共享的新建会话防抖） |
| 接线 | `src/client/index.ts` `@anchor client-services` 之后（`// seat-switch: begin … end` 标记内）：`currentSeatViews` / `seatStartGuard` / `enterSeatView` / `ctx.effect(installSeatHotkeys…)` / `ctx.inject(['inputTriggers'], …)` |
| 文案 | `seat.command.section`、`seat.command.hint`、`seat.notFound`（`{name}`）、`seat.hotkeyHint`（`{key}`）、`seat.imagesUnsupported`，zh/en 同步 |
| package.json | `dsh.client.inject` 追加 `@deepseek-ai/dsh-client-ui-input-trigger`（仅到达顺序提示） |
| 测试 | `tests/client-seat-switch.test.ts`、`tests/client-seat-hotkeys.test.ts`、`tests/client-seat-command.test.ts`、`tests/client-seat-start-guard.test.ts`、`tests/client-seat-wiring.test.ts`（用 vm 编译 index.ts 的接线块，钉住两条落点分支与注册方式）、`tests/fixture-seat-view.ts` |

没有新增配置、偏好、Web API 路由或槽位；存储 schema 未动。

## 决策

- **为什么是 Alt 而不是 Ctrl**：Ctrl+1..9 在 Chromium / Firefox / Edge 里是浏览器标签切换保留键，页面脚本 `preventDefault` 无效；Alt+数字可被拦截。平台没有全局快捷键注册表（客户端所有 keydown 都是组件内局部监听），只能自己挂 window 监听。
- **不修改 `export const inject`**：`/seat` 通过 `ctx.inject(['inputTriggers'], scope => scope.effect(...))` 注册，profile 没有 ui-input-trigger 时插件照常启动，只是没有 `/seat`。快捷键不依赖任何可选服务。
- **为什么是自有 InputTriggerSource 而不是 `ctx.commandUi.register`**：客户端 command contribution 只支持无参 popupSelect（`/seat foo` 会被放行给宿主目录，无宿主命令时直接发给模型）；宿主 `ctx.commands.register` 的 handler 在 Node 侧，无法切换浏览器当前会话。自有 source 的 `matchEnter` 对任何 `/seat …` 行返回 `{claim}`，submit 成功后由输入机自己 commit 草稿；`{kind:'error'}` 时草稿保留供修正。
- **`matchEnter` 只认 `/seat` 精确 token**：`/seats`、`/seatx` 等不会被截获，继续走默认链路。
- **带图片时拒绝整个提交**：`/seat` 的 claim 不声明图片支持；若输入框附带图片，`matchEnter` 按平台契约抛出 `seat.imagesUnsupported`，输入机把它显示为错误通知并原样保留文字与图片（与 ui-commands 的 `refuseImages` 一致），不会出现“席位切了、图片留在旧会话”的情况。
- **防抖**：同一 skill 的进入操作在飞行中时再次按键被吞掉（`preventDefault`）但不重复启动；不同席位可并发。`event.repeat`、`event.isComposing`、`defaultPrevented` 一律忽略。
- **新建会话的共享守卫**：`startSeatSession` 返回后模型快照要等 SSE 推动 `model.refresh()` 才会出现新会话，这段窗口内 `view.sessionIds` 仍为空。`seatStartGuard` 让该 skill 在“新建已发出 → 快照中出现绑定会话（或 4 s 超时）”期间保持 busy，快捷键与 `/seat` 共用同一守卫，不会为同一席位开出两段会话；新建失败则立即释放以便重试。侧栏「+」新建同样经 `seatStartGuard.run(skill, …)` 走这条共享守卫（已在飞行中则不重复新建、返回 `undefined`）；侧栏自己的 `creatingSkills` 仍保留为按钮禁用态。向导（aria-modal）打开期间 `isSuspended` 让所有和弦交还页面。
- **可编辑目标**：目标是 input / textarea / contenteditable 时，不带 Alt 的数字直接放行；带 Alt 且 `key` 本身是数字时才生效——若 Alt+数字在该布局下产生字形（macOS Option+1 → `¡`），视为文字输入放行，不吞键。
- **只认主键盘区数字（`Digit0-9`），不认小键盘**：Windows 下 Alt+小键盘数字是系统 Alt-code 字符输入（Alt+Numpad0233 → é），字符在 Alt 松开时由系统合成，`preventDefault` 拦不住累积——若把 Numpad 当快捷键，会既切席位又往输入框塞乱码。`event.code` 有值时以物理键为准（`Numpad2` 即便 `key` 为 `'2'` 也不算）；`code` 为空的合成事件才回退看 `key`。非可编辑目标下 `code=Digit2, key='™'` 仍能切到第 2 席。

## 已知限制

- **iframe 焦点**：总览浮层与工作台画布都是 iframe，打开后焦点在 iframe 文档内，父窗口的 keydown 收不到按键——快捷键在总览 / 工作台聚焦时不生效（Alt+0 关不掉已聚焦的总览，需 Esc）。要打通需在 `workbench/app.js` 增加 `amphoreus:hotkey` postMessage 桥，本次未做。
- 席位数 > 9 时只有前 9 个有数字键；`/seat` 不受限。
- `/seat` 命名与宿主命令目录不冲突（当前无 `seat` 宿主命令）；若未来宿主注册同名命令，ui-commands 的 source 先注册，会先于本 source 抢到该行。
- 快捷键不可配置（无 prefs 字段）。
- **快捷键落点失败只写 console**：`Alt+N` 进入席位时若 `startSeatSession` / `openBoundSeatSession` 抛错（席位目录缺失、宿主 RPC 出错），只 `console.warn`，界面无提示；`/seat` 走输入机会显示为错误通知。原因：平台的 `conversation.input.for(actx).notify()` 需要会话作用域 ctx，插件根 ctx 拿不到当前会话的 scope；侧栏的 `setError` 是组件内 React 状态，同样不可达。待后续有全局通知槽位再接。
