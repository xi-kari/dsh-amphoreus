# 技能套件更新提示（suite-notice）

壳层顶部居中的一条可关闭状态条：技能套件（δ-me13 skill）在磁盘上变化后，告诉用户宿主**已经**重新解析，以及哪些东西真的还没跟上。文案只说事实，不说"请重启"——除了唯一一种真需要重启的情形。

## "实时"到底是什么意思

宿主侧（`src/host/bridge.ts`）的 SuiteWatcher 在 manifest sha 变化时重新解析并 `#replaceSnapshot` → 发 SSE `snapshot`；客户端 `AmphoreusClientModel` 收到后 120 ms 内重新拉 `/amphoreus/api/state`。以下消费方全部读**当前**快照，无需重启：

- 技能目录（`provider.list()/get()` 每次读 `source.current()`，`invalidate()` 触发 `skills/change`）
- 席位系统提示（`registerSeatPrompt` 每次 `system-prompt/assemble` 时读 `options.current()`）
- 席位表（每个快照 `reconcileSeats`）、观察器（快照时换 matcher）、Web API / SSE

**真正滞后的只有两处：**

1. 已经注入过卡片正文的会话（`bindings[].injection.state === 'done'`）会把旧卡片留在会话日志里，直到 `/clear`、恢复（resume）或新建会话——注入器只对 `pending` 状态写卡片（`src/host/injector.ts`）。
2. 浏览器里 `/amphoreus-*` 斜杠补全的技能目录按会话缓存，切换会话或重连后才刷新（平台 ui-skill 行为，推断）。文案不展开这一条。

**唯一需要重启的情形：** 进程启动时技能根不存在。此时 `resolver.start()` 没有创建 watcher，`scheduleReparse()` / `forceReparse()`（POST `/amphoreus/api/reparse`）都是空操作，只有重启 web 进程才会重新扫描。客户端用诊断 `root-missing`（`parse.ts` 只在没有主根时发出）判定"没有 watcher"，而不是只看 `boot.level`——`window.__AMPHOREUS_BOOT__.level` 是**页面被服务那一刻**的 level（`firstframe.ts` 读 `resolver.current()`），运行期 `parse-exception` 也会让页面以 L3 起跳，但那时 watcher 仍在、重新解析仍有效。首拉到达前先以 `boot.level === 'L3'` 作预判，首拉后以诊断为准。

## 三种真实状态 + 恢复

客户端存储 `createSuiteNoticeStore` 比较连续两次 ready 状态的 `suite.fingerprint.manifestSha256` 与 `suite.level`：

| kind | 触发 | 标题文案（zh） |
| --- | --- | --- |
| `updated` | sha 变化，level 仍为 L0 | 技能套件已更新至 {label}，已重新解析 |
| `degraded` | 变为 L1/L2 | 套件显式降级（{n} 条诊断） |
| `missing` | 变为 L3 或 `suite` 为空；**或首个 ready 状态就是 L3**（启动缺根，见下） | 套件未识别 |
| `recovered` | 从 L1/L2/L3 回到 L0 | 套件已恢复，当前 {label} |

附加行：
- `suite.sessionsStale`（"已有 {n} 个会话在 /clear、恢复或新建后才会用到新卡"）：`staleSessions > 0` 且 kind ≠ missing 时显示。`staleSessions` = `injection.state==='done'` 且 `(injection.at ?? boundAt) < suite.parsedAt` 且会话未归档（`ctx.workspaces.list.getSnapshot().archivedSessionIds`）的绑定数。用注入时间而非绑定时间：绑定先是 `pending`，首个 pre-step 才写卡并置 `done`（`injector.ts`），解析前打开、解析后才发第一条消息的会话拿到的已是新卡。归档会话保留 bindings 行（不会被清理），但用户已看不到，不计入。
- `suite.restartHint`：仅当 `startedMissing`（宿主没有 watcher：首拉前看 `boot.level === 'L3'`，首拉后看诊断 `root-missing`）时显示；此时"重新解析"按钮也隐藏，因为点了也没用。运行期 `parse-exception` 导致的 L3 不属于此类，按钮保留。

沉默规则：首个 ready 状态（或 boot）只作基线，不提示——**唯一例外是首个 ready 状态本身就是 L3**：这是启动缺根的情形，没有 watcher，状态永远不会自己变化，所以首拉是唯一一次把"套件未识别 + 需重启"说出来的机会，于是直接播一条 `missing`（id 稳定，关闭后同一页会话内不再弹）。强制重新解析但 sha 不变（仅 generation 递增）不提示；boot level 与首拉 level 不一致（例如页面按 L3 起跳、首拉已是 L0）按转换分类提示一次。

## 动作

- **关闭**：`store.dismiss(id)`，id = `${kind}:${level}:${sha}:${generation}`——每次发出的提示各自可关闭：关掉一条 `updated` 不会吞掉同 sha 之后的 `recovered`，回退到曾关闭过的 sha 也是新事件照常显示。持久化到 `sessionStorage['dsh-amphoreus:suite-notice']`（数组，最多 32 条）；启动缺根那条的 generation 不会变，所以刷新页面后仍保持关闭。storage 不可用或损坏时退化为内存去重。
- **重新解析**：仅 degraded / missing 且 `!startedMissing` 时出现，调用 `model.reparse()`（POST `/amphoreus/api/reparse`，nonce 头由 model 自带）。失败文案以 notice id 为键，换到下一条提示时不会残留。
- 未实现"打开控制台"：settings 面板的导航 API 不在本插件已注入的服务里，按任务允许跳过。

## 接入点

- 新文件：`src/client/suite-notice-store.ts`（纯存储，可单测）、`src/client/suite-notice.tsx`（`SuiteNoticeBanner`）、`src/client/suite-notice.module.css`。
- `src/client/index.ts`：`@anchor client-imports` 后导入；`@anchor client-services` 后 `createSuiteNoticeStore({ model, boot, storage: safeSessionStorage(), archivedSessionIds: () => ctx.workspaces.list.getSnapshot().archivedSessionIds })` + `ctx.effect` 释放；`@anchor shell-overlay-entries` 后在**同一个** `shell.overlay` inject 回调数组内 `ctx.slots.register({ id: 'amphoreus-suite-notice', order: 10, locale: NS, inject: () => ({ store, model, portalOpen, subscribePortal }) }, SuiteNoticeBanner)`。`ctx.slots.inject` 调用列表未变，assembly 测试原样通过。
- 门户打开（`portal.getSnapshot().open`）时横幅返回 `null`，不与全屏门户抢位置。
- 无新路由、无新 EventSource（MAX_SSE_CLIENTS=8）、无 host 改动、无 storage schema 改动。
- 语言键前缀 `suite.*`（9 个，zh/en 对齐）：updated / sessionsStale / degraded / missing / recovered / restartHint / reparse / reparsing / dismiss。

## 样式

`.banner` `position:absolute; top:12px; left:50%; translateX(-50%)`，`z-index:5`（高于门户 `.close` 的 2），`pointer-events:auto`；仅 `--dsw-alias-*` 令牌；`data-kind` 决定左边条颜色（brand / warn / error / success）。`role="status" aria-live="polite"`。

## 测试

`tests/client-suite-notice.test.ts`（16 项）：分类函数；首个 ready 不提示；sha 变化提示；同 sha 仅 generation 变化沉默；degraded → missing → recovered 序列（运行期消失仍 `startedMissing === false`）；**启动缺根：boot L3 + 首拉 L3 播 `missing`、之后沉默、关闭后刷新仍关闭、`suite` 为空同理**；运行期 `parse-exception` 起跳的页面 `startedMissing` 清零；boot L3 → 首拉 L0 视为恢复；关闭持久化 / 幂等 / 回退到已关闭 sha 仍显示；关闭 `updated` 不吞后续同 sha `recovered`；损坏或抛错的 storage 退化；`staleSessions` 按注入时间计且排除归档会话；dispose 退订；横幅源码 regex（role=status、门户门控、错误以 id 为键、无 ctx/fetch/appendChild、无防火墙词、键集对齐）；CSS 仅 dsw 令牌；index 接线（`name: 'shell.overlay'` 计数只断言 ≥ 2，为其他分支的 overlay 条目留位）。

`tests/client-portal.test.ts` 两处 `indexOf('\n  const bootWorkbench')` 切片终点改为 `'\n  // @anchor client-services'`（我的服务块插到了 anchor 之后、bootWorkbench 之前，否则 openSeat 切片会把新代码吞进 vm 上下文）；`name: 'shell.overlay'` 计数 1 改为 `ctx.slots.inject('shell.overlay'` 计数 1 + `id: 'amphoreus-portal'` 计数 2（列表槽内第二条注册是本功能的设计意图）。

## 已知限制

- `label` 来自 `fingerprint.label`（git `<head7> (<describe>)[+dirty]` 或 `sha256:<12>`），没有"从 X → Y"的前值，因为 SuiteSnapshot 不携带上一枚指纹。
- 斜杠补全滞后未在文案中提及（推断项，未验证）。
- `staleSessions` 只能排除壳层已归档的会话；已被宿主删除但 bindings 行仍在的会话无法从客户端识别（bindings 只在手动 DELETE 路由时清理），计数在这类情况下仍可能偏高。
- 首次 SSE `snapshot` 到达先于 `reconcileSeats` 写完 `suite_events` 的窄窗口不影响本功能（只读 fingerprint / level / bindings）。
- `suite.restartHint` 文案避开了 "dsh" 一词：`tests/client-brand-shell.test.ts` 禁止任何语言键出现 `\bDSH\b`，故写作"重启本地服务（web 进程）"。
