# 席位预设（seat = preset binding）

每个席位可以绑定一组"新会话默认值"，在该席位**新建**会话时自动落到会话上。它不是一个平台概念，而是三个彼此独立的平台机制的席位级捆绑：

| 层 | 平台机制 | 应用位置 | 生效限制 |
|---|---|---|---|
| 智能体预设 `agentPreset` | `remote.agentPresets.select(sessionId, id)`（插件组合，不含模型/权限） | 客户端，`startSeatSession` 在 create + 工作区同步之后、open/返回之前 | **只能在会话空白（未开始首轮）时切换**；`agent-preset/locked`、`gateway/invocation-unavailable` 静默跳过，其余拒绝只 `console.warn`，会话照常创建（落回部署默认预设） |
| 模型 `model{provider, model, reasoningEffort?}` | `remote.session.selectModel(...)` | 客户端，同上 | 平台会**同时把它写成部署级默认模型**（`agent-default-model` 设置命名空间），见下文处理 |
| 权限 `permission` | `ctx.permissionPresets.set(session, name)` | 宿主端 `session/created` 监听（`src/host/seat-permission.ts`） | 服务可选（非受限 shell 执行器上不存在），用 `ctx.get('permissionPresets')` 按事件解析；缺失或拒绝只 `logger.warn` |

所有层都是"尽力而为"：任何一层失败都不会删除席位绑定，也不会阻止会话创建；`dispatchTask` 之类紧接着发提示词的调用方在预设落地之后才继续。

## 存储

- `SeatSchema.preset?: { agentPreset?: /^[a-z0-9][a-z0-9-]*$/, model?: { provider, model, reasoningEffort? }, permission?: string }`（`src/host/store.ts`，anchor `seat-fields`）。整体 `.optional()`，旧记录无需迁移；`dataVersion` / 表清单不变。
- `planSeatReconciliation` 与 `userOrder`/`hidden` 一样原样保留 `preset`（anchor `seat-preserve`），套件重新解析不会抹掉它。
- 共享词汇在 `src/shared/seat-preset.ts`：`SeatPreset`、`SEAT_PERMISSION_PRESETS`（`read-only` / `workspace-write` / `danger-full-access`，来自 base bundle 的权限表；平台没有权限名单远程接口）、`normalizeSeatPreset`、`isEmptySeatPreset`。

## 路由

`PUT /amphoreus/api/seats/<skill>/preset`（`#seatPresetRoute`）

- body：`SeatPresetInput.strict()`，或 `null` 清除；`{}` 等价于清除（存储中删除 `preset` 字段而不是留下空对象）。
- 404：席位不存在、尾段不是 `preset`、skill 名不合法；400：zod 拒绝；写入受 `x-amphoreus-nonce` + `application/json` 约束（与 `#bindingsRoute` 相同）。
- `GET` 同路径返回 `{ preset | null }`。分支放在精确匹配 `/amphoreus/api/seats` 之后（anchor `webapi-routes`）。
- 客户端：`AmphoreusClientModel.setSeatPreset(skill, preset | null)`（anchor `client-model-methods`），保存后刷新状态；席位记录已随 `state.seats` 整体下发。

## 客户端装配

- `SeatActionDeps.applySeatPreset?: (sessionId, skillName) => Promise<void>`（可变可选属性）。`seatDeps` 字面量被测试钉住，因此在字面量之后一行赋值：`seatDeps.applySeatPreset = …`。
- `src/client/seat-preset-apply.ts`：纯函数式 applier，`createSeatPresetApplier(deps)`。`remote.agentPresets` 与 `remote.settings` 是可选服务，通过 `ctx.inject([...], scope => scope.effect(() => applier.attach({...})))` 附着/脱离，因此**冻结的 `inject` 数组没有变化**，缺少这些命名空间的部署自然退化为"默认"。
- 设置面板 `src/client/seat-preset-panel.tsx`（anchor `settings-panels`，位于壁纸面板与工作台之间）：每个已部署、未隐藏席位一行三个 select（智能体预设 / 模型 (+推理强度，仅当模型公布 efforts) / 权限）；"默认"= 未设置。目录（`listAgentPresets()` 过滤 broken、`modelCatalog()`）通过 `model.presetDirectory`（`AmphoreusClientModel` 上的纯回调槽，装配时换成真实 applier）传给面板，settings 的注入 props 与组件签名保持原样，组件不接触 ctx。样式 `seat-preset-panel.module.css` 只用 `--dsw-alias-*` 令牌。
- 纯逻辑 `src/client/seat-preset-tiers.ts`：`withTier` 单层编辑（换模型会丢弃推理强度；全默认折叠为 `null`）、`encode/decodeModelChoice`（`U+001F` 分隔 provider 与 model）。

## 模型层的全局副作用与处理

已核实 `api/session-controller/src/commands.ts` selectModel 无条件调用 `agentDefaultModel.saveSelection`，而 `core/agent-default-model/src/index.ts` 的文档形状为 `{ provider, model, reasoningEffort? }`，写入方式是 `settings.replace('agent-default-model', …)`。因此：

1. 应用前先读 `remote.session.modelCatalog().default`；
2. `selectModel` 落到席位会话；
3. 若 `remote.settings` 可用且旧默认与席位模型不同，用 `remote.settings.replace('agent-default-model', {provider, model, reasoningEffort?}, undefined)` 写回旧默认。

面板底部据 `canRestoreDefaultModel()` 显示 `settings.presetModelRestore`（可恢复）或 `settings.presetModelWarning`（"会同时改写全局默认模型"，`remote.settings` 缺失时）。恢复失败只警告。极小窗口内（读默认 → 写回之间）其他新建的普通会话可能拿到席位模型，这是平台接口形态决定的已知限制。

## 已知限制

- 智能体预设不作用于已开始的会话与 `acceptHandoff` 的 fork 子会话（非空白，`agent-preset/locked`）；席位进入既有会话（seat-enter）也不重新应用任何层。
- 权限名单硬编码 base bundle 三项；部署若改了权限表，可在 select 中看到"未知名"选项保留原值但无法枚举新名字。
- 未在 seat-browser 行内加预设徽记（`SeatView` 与 seat-model 测试被钉住，非平凡改动，按任务说明跳过）。
- 宿主监听顺序（权限服务 pin 先于本插件监听）依据 bundle 行序推断并以假 ctx 测试了"后注册者覆盖"语义；未在真机验证权限服务是否在当前 Windows 部署上被组合。

## 本地化前缀

`settings.preset*`（zh 为键权威，en 同步；含 `settings.presetModelWarning` 固定文案"会同时改写全局默认模型"）。

## 测试

`tests/store-seats.test.ts`（schema 接受/拒绝、reconcile 保留）、`tests/client-seat-actions.test.ts`（create → sync → preset → open 顺序；失败只警告；缺依赖跳过）、`tests/webapi-seat-preset.test.ts`（存/换/清、404/400/403/415/405、分支位置）、`tests/seat-permission.test.ts`（监听顺序、服务缺失/拒绝容错、宿主装配与 type-only）、`tests/client-seat-preset-apply.test.ts`（三层独立、locked 静默、默认模型读回/恢复、目录降级、tiers 纯函数、装配与 CSS 令牌）。
