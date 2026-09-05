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
| 客户端模块 | `src/client/seat-switch.ts`（纯函数：`orderedHotkeySeats` / `seatForDigit` / `resolveSeatByName` / `parseSeatLine` / `hotkeyLabel`）、`src/client/seat-hotkeys.ts`（`installSeatHotkeys`，window keydown，返回 disposer）、`src/client/seat-command.ts`（`createSeatCommandSource`，自有 InputTriggerSource，trigger `/`、name `seat`） |
| 接线 | `src/client/index.ts` `@anchor client-services` 之后：`currentSeatViews` / `enterSeatView` / `ctx.effect(installSeatHotkeys…)` / `ctx.inject(['inputTriggers'], …)` |
| 文案 | `seat.command.section`、`seat.command.hint`、`seat.notFound`（`{name}`）、`seat.hotkeyHint`（`{key}`），zh/en 同步 |
| package.json | `dsh.client.inject` 追加 `@deepseek-ai/dsh-client-ui-input-trigger`（仅到达顺序提示） |
| 测试 | `tests/client-seat-switch.test.ts`、`tests/client-seat-hotkeys.test.ts`、`tests/client-seat-command.test.ts`、`tests/fixture-seat-view.ts` |

没有新增配置、偏好、Web API 路由或槽位；存储 schema 未动。

## 决策

- **为什么是 Alt 而不是 Ctrl**：Ctrl+1..9 在 Chromium / Firefox / Edge 里是浏览器标签切换保留键，页面脚本 `preventDefault` 无效；Alt+数字可被拦截。平台没有全局快捷键注册表（客户端所有 keydown 都是组件内局部监听），只能自己挂 window 监听。
- **不修改 `export const inject`**：`/seat` 通过 `ctx.inject(['inputTriggers'], scope => scope.effect(...))` 注册，profile 没有 ui-input-trigger 时插件照常启动，只是没有 `/seat`。快捷键不依赖任何可选服务。
- **为什么是自有 InputTriggerSource 而不是 `ctx.commandUi.register`**：客户端 command contribution 只支持无参 popupSelect（`/seat foo` 会被放行给宿主目录，无宿主命令时直接发给模型）；宿主 `ctx.commands.register` 的 handler 在 Node 侧，无法切换浏览器当前会话。自有 source 的 `matchEnter` 对任何 `/seat …` 行返回 `{claim}`，submit 成功后由输入机自己 commit 草稿；`{kind:'error'}` 时草稿保留供修正。
- **`matchEnter` 只认 `/seat` 精确 token**：`/seats`、`/seatx` 等不会被截获，继续走默认链路。
- **防抖**：同一 skill 的进入操作在飞行中时再次按键被吞掉（`preventDefault`）但不重复启动；不同席位可并发。`event.repeat`、`event.isComposing`、`defaultPrevented` 一律忽略。
- **可编辑目标**：目标是 input / textarea / contenteditable 时，不带 Alt 的数字直接放行；带 Alt 的数字仍生效（Alt 不会往输入框写字）。
- **数字识别用 `event.code` 优先**：某些键盘布局下 Alt+数字的 `key` 是符号，`Digit2` / `Numpad2` 仍可靠。

## 已知限制

- **iframe 焦点**：总览浮层与工作台画布都是 iframe，打开后焦点在 iframe 文档内，父窗口的 keydown 收不到按键——快捷键在总览 / 工作台聚焦时不生效（Alt+0 关不掉已聚焦的总览，需 Esc）。要打通需在 `workbench/app.js` 增加 `amphoreus:hotkey` postMessage 桥，本次未做。
- 席位数 > 9 时只有前 9 个有数字键；`/seat` 不受限。
- `/seat` 命名与宿主命令目录不冲突（当前无 `seat` 宿主命令）；若未来宿主注册同名命令，ui-commands 的 source 先注册，会先于本 source 抢到该行。
- 快捷键不可配置（无 prefs 字段）。
