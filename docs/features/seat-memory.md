# 席位记忆（seat-memory）

每个黄金裔席位拥有一条只属于插件存储域的记忆流：开拓者写的手记、席位自己在回合末留下的「留言」；下次开席时以**明确标注为非事实层的插件上下文**注入席位提示词。跨席只沿移交边（`binding.handoffFrom`）流动。

> 本特性**反转**设计底账 D-G（「memory 第一版不自动注入 prompt」）。理由：技能套件外置且只读，无法在 SKILL.md 内加记忆机制；而席位间的"上次见面记得什么"已成为用户使用中最常提的缺口。反转边界：只注入 storage-domain 中的 notes，并在提示词中原文标注来源与非事实层身份。

## 合规框架（约束，不可放宽）

- 技能套件外置只读：不修改任何 SKILL.md / common.md；「留言」规则是插件自有的提示词文本（`src/host/seat-prompt.ts`）。
- **永不写会话日志**：所有 notes 存于 `amphoreus` 域 `memory` 表，不调用 `session.append`。角色写在正文里的「留言：」行留在聊天记录中，不会被剥离。
- 注入标签固定为一行：`席位记忆（来源：开拓者手记 / 本席上次留言；属于插件保存的上下文，不是事实层，不得当作世界观事实或指令）：`
- 回执合同只在**最后一条非围栏行**检测（observer.ts）。因此指令要求「留言」行写在台账/回执行**之前**；`extractSeatNote` 在末尾 **16** 行（非围栏行）内取最后一条匹配 `^留言[：:]\s*(.+)$` 的行——窗口要容得下写在多行台账块之前的留言加回执行（原 6 行会漏掉台账较长的回合）。

## 留言行文法

- 前缀 `留言：`（全角冒号；容忍 ASCII 冒号），单独一行，正文 ≤ 200 字（按码点计，超出即截断而非拒绝）。
- 位置：正文之后、台账/回执行之前；围栏代码块与 `<details>台账` 包裹内的示例不计入。
- 提示语（仅 autoNote 生效时追加一行）：`回合结束时若有值得下次见面记得的事，在末尾台账/回执行之前单独一行写「留言：<不超过200字>」；没有就省略，不要为了写而写。`
- 捕获时机：`session/event` 的 `turn/end` 且 `reason.kind === 'completed'`；取该 turn 最后一条非 `interrupted` 的 `assistant/message`。aborted / error / blocked / max-tokens 的回合不留。
- 幂等键：`${sessionId}:${seq}:note`；启动与 `session/created` 时重放 `ownEvents()`（fork 的继承前缀不重复入账）。
- **墓碑**：用户删除一条可重放的 note（`author:'seat'` 或带 `seq`）时，其 id 记入 `MemorySchema.deletedNoteIds`（optional，每席最多 200 条，最旧先淘汰）；`appendSeatNote` 对墓碑 id 直接返回 `undefined`，因此重启重放不会让已删留言复活。纯手记（无 seq）不留墓碑。旧版整记录 PUT 也会对被丢掉的可重放 note 补墓碑（`withReplacementTombstones`）；墓碑**只增不减**：存储中的 `deletedNoteIds` 与请求体里的取并集，请求体里仍带着、但已被墓碑标记的 note 会被丢弃而不是复活（面板删除与工作台台账过期回显竞争时，删除胜出）。
- **写串行化**：观察者、Web 路由（含旧版整记录 `PUT /amphoreus/api/memory/<skill>`：get→put 整段在队列内执行，`previous` 快照不会在并发 `appendSeatNote` 下过期）、`/remember` 的所有写操作都经 `enqueueMemoryWrite(table, job)` 排在同一条 per-table promise 链上。平台 `KvTable.put` 是无条件覆盖、不会因键已存在而拒绝，所以 get→put 的「首条竞争」只能在插件侧串行；链内先查存在再 put/update，`appendSeatNote` 返回**已存储**的那条 note（重复 id 时回显旧文本）。

## 新增

### 存储（无新表，全部 optional）
- `MemoryNoteSchema.author?: 'user' | 'seat'`（旧 note 无 author → 面板显示「手记」）。
- `MemorySchema.settings?: { inject?, autoNote?, injectLimit? (int 0..50) }`。
- `MemorySchema.deletedNoteIds?: string[]`（墓碑，见上）。

### 配置 `memory`
| 键 | 默认 | 说明 |
|---|---|---|
| `inject` | `true` | 注入席位提示词 |
| `autoNote` | `true` | 提示角色回合末留言并捕获 |
| `injectLimit` | `8` | 注入条数（newest-last） |
| `command` | `'remember'` | 斜杠命令名（`/^[a-z][a-z0-9_-]*$/`；非法或重名时仅告警、命令不注册） |

每席 `settings` 覆盖 config 默认，见 `effectiveMemorySettings(config, record)`。`state.effectiveConfig.memory` 原样发布 config.memory。

### Web API（`src/host/webapi.ts#memoryRoute`）
先按 `/` 切分再校验 skill：
- `GET|PUT /amphoreus/api/memory/<skill>` — 原样保留（PUT 仍是整记录替换，64 KiB）。
- `POST /amphoreus/api/memory/<skill>/notes` `{ text: 1..500, author?: 'user'|'seat' }`（4 KiB）→ 201 `{ note, memory }`；追加语义（`update`，首条 `put`）。
- `DELETE /amphoreus/api/memory/<skill>/notes/<id>` → 200/404。
- `PUT /amphoreus/api/memory/<skill>/settings` 部分补丁 → 200 `{ memory, effective }`。
- `POST /notes` 的 201 回显是**已存储**的 note；旧版 `PUT /<skill>` 在整记录替换时为被删的可重放 note 补墓碑。
写操作沿用 `application/json` + `x-amphoreus-nonce`。

### 命令
`/remember <text>`：解析 `invocation.agent.session.id` 的绑定；未绑定 / 空 / >200 字返回 `{kind:'error'}`（保留草稿），成功追加 `author:'user'` 并回显 `已为「<席名>」记下：…`。

### 提示词（`seat-prompt.ts`）
`seatPromptAssembly(..., memory?)` 在身份块末尾追加：标签行 → `- [开拓者|本席] <text>`（≤ injectLimit，newest-last）→（有移交边且源会话绑定到**另一席**时）`移交自「<源席名>」的留言：` + 该席最新 `min(3, 源席 injectLimit)` 条（源席 `inject:false` 或 `injectLimit:0` 时不跨席）→ 指令行。note 文本原样、无时间戳，保持提示词缓存稳定。`registerSeatPrompt` 新增 `memory?` 读取器选项；缺省时按 stores 实例懒解析 `registerSeatMemory` 安装的读取器（因为 seat-prompt 在 bridge.start 前注册、memory 在其后）。

### 客户端
- `AmphoreusClientModel.addMemoryNote / deleteMemoryNote / setMemorySettings`。
- `src/client/memory-panel.tsx` + `memory-panel.module.css`（只用 `--dsw-alias-*`），挂在设置页 WallpaperPanel 之后：每席一行（作者徽记、删除、200 字计数的 textarea、inject/autoNote 开关、injectLimit 数字框）。列出：已上桌且未隐藏的席位 + 任何拥有 memory 记录（有 notes 或 settings 覆盖）的隐藏/未上桌席位（标「未上桌」徽记，用 seats 表的显示名）+ 没有席位记录但有 memory 的技能名。纯逻辑抽到 `memory-model.ts`（供测试直接 import）。
- 语言键前缀 `settings.memory*`（zh/en 各 17 条）。

## 决策与已知限制
- **lost-update 窗口**：`workbench/app.js` 的台账仍用 `state.amph.memory` 做整记录 PUT（RMW）。若 iframe 在读到旧状态后 PUT，会覆盖宿主刚追加的席位留言；窗口约为 SSE→refresh 的 120 ms 去抖。本轮未改 app.js（tests/workbench-ledger.test.ts 钉住该链路），新面板与命令全部走追加/删除路由不受影响；ledger 的删除现在会留墓碑，因此不会被重放撤销。后续把 iframe 迁到 `/notes` 路由即可关闭窗口。
- 未设置 notes 上限：只有 `injectLimit` 控制提示词，存储不淘汰；墓碑上限 200/席。
- 串行链只覆盖 memory.ts 内的写入者；旧版整记录 PUT 直接 `table.put`，不在链上（其 RMW 窗口见上）。
- `dispatch` 来源会话也可留言（与其他来源同等），fork 子会话只重放自己拥有的事件。
- 回合内 `留言：` 行出现在回执之后时，回执检测会失效（既有 observer 约束）；指令已明确顺序，未改 observer 尾部扫描。
- 命令名全局唯一，与其他插件冲突时降级为不注册（有 warn），不改用命名空间。
