# dsh-amphoreus 建设交接（2026-09-03）

> **2026-09-04 更新**：§0「一句话现状」、§4「已落盘的代码」、§5「下一步」已过时——现状见 `README.md`「现状」与 `AUDIT-2026-09-04.md`；建设任务书见 `../设计文档/07_建设计划_分章草稿/`。§1 用户裁决、§2 平台事实、§6 注意事项仍有效。§7 为 M1 原样接入事后核对记录。

> 给接手建设的 AI（Fable 5 等）。本文是**唯一交接入口**：先读本文，再按需读 `../设计底账/`（事实）与 `../设计文档/01_技能桥接与无损更新.md`（技能桥接规范）。工作区总入口 `D:\DeepSeek Harness\AGENTS.md`，插件通用规范 `D:\DeepSeek Harness\DSH插件开发指南.md`。
> 标注：**[实测]** 本机跑过；**[源码]** 读 alpha.4 源码得出；**[未核实]** 动手前须验证。

> **2026-09-04 更新**：差距审计见 `docs/AUDIT-2026-09-04.md`；**完整建设任务书见 `../设计文档/07_建设者任务书（Codex一口气版）.md`**（66 任务 TA1–TF12，含总纲、G1–G21 映射、章间裁决 J-1…J-16、完成定义）。接手建设者从该任务书 §0 开工，本文 §5「下一步」已被其取代；§1 裁决与 §2 平台事实仍有效。

## 0. 一句话现状

### 0.1 发布态现状（0.2.0，2026-09-05）

`dsh-amphoreus@0.2.0` 的 A–E 功能建设、TF1–TF10 发布前验证与 TF11 交接同步已经完成；本机 profile `web` 仍以 `link:D:/DeepSeek Harness/deepseek插件开发/dsh-amphoreus` 运行。面向用户的 npm 安装形态为发布后的 `dsh-amphoreus@alpha` 或 `dsh-amphoreus@0.2.0`，TF12 完成前不得把它写成已可下载。

当前已实现运行时技能套件解析与无损更新、13 席工作区与自动注入、全局／逐席视觉、外置素材派生、iframe 工作台、全体会议派发、移交坞／移交边／接通尾页、站位轨与台账。最终本机构建时间：`lib/index.js`、`lib/client.js`、`lib/derive.js` 均为 2026-09-05 10:50:04。

遗留：B 章的 30+ 轮字面场景以同 route/schema 的 70-position 事务作容量验收；CSS 原色 fallback 按 TD12 的条件裁决保留；稳定 URL 在强制重派生时的 cache-bust 仍待后续版本化；TF12 的远程仓库、真实双系统 CI、npm 发布、npm 安装复测、GitHub SHA 安装抽测与 GitHub Release 尚未执行。其余 A–E 代码遗留为无。

[已失效 2026-09-05] 包 `dsh-amphoreus` 已有可装可启的双半侧骨架：已 `link:` 装进 profile `web`，`dsh web` 启动后宿主行挂载、浏览器 bundle 进入启动图并被 `/plugins` 路由 200 下发、stderr 为空 **[实测]**。业务模块（技能桥接、席位、注入、观察、Web 通道、首帧、主题壁纸、工作台、设置区）**一个都还没写**，只有类型契约 `src/host/suite/types.ts`。服务当前仍在运行（PID 见 `.runtime/deepseek-harness.pid`），改完 host 代码需 Stop/Start，改完 client 需重建 `lib/client.js` 并刷新页面（无 `pnpm run dev:web` 时 HMR 不会自动生效）。

## 1. 用户裁决（不可违反）

1. **技能无损更新**：插件不内嵌、不复制任何 `SKILL.md`/`persona.md`/`common.md`/`relations.md`；运行时从 `skillRoots` 读取并解析路由表/流水线/移交/回执；解析失败显式降级（横幅「套件格式未识别，已降级」），**不得静默沿用旧缓存**；绑定键 = skill `name`；自有数据以 name 为键落 storage-domain，与技能分离；对技能目录只读；素材↔skill name 对照表（`src/shared/heroes.ts`）是唯一允许硬编码的黄金裔对照。十条细则见 `../设计底账/05_假设与未决.md` §1.1。
2. **「线性流水线项目」= dsh-synapse**（liangmianya，MIT）：吸收改造为黄金裔工作台，不推倒重来。已 vendoring 到 `workbench/`（见 §4），署名在 `NOTICE`。
3. **安装即自动为每位黄金裔创建相对完整席位**：独立背景（该册杂志封面）、独立 UI 风格（逐席 `--dsw-alias-*` token 变体，光暗两套）、绑定技能卡（席内新会话首轮自动注入对应卡）。
4. **每席 UI 风格以 13 册 CHRYSOS 杂志分册为版式与色板单源**（`../设计底账/06`），杂志语法可作整体界面语法；M1 轻档（只借色板/纹样/封面），M2 起重档。
5. 全局壳 = 昔涟（`昔涟壁纸/` + Vol.13 色板）。
6. 公开发布不夹带原图；素材经 `assetsRoot` 指向用户本地目录。

待裁决项（`05` §4）一律暂按底账倾向：席位 = 插件自定义分组（不造 13 个 DSH 目录工作区）；单一预设 + 首轮注入；工作台作 `conversation.view` 第二 Tab；包名 `dsh-amphoreus`；三月七/长夜月同席翻面。

## 2. 已核实的平台事实（本次调研新增，底账 01 之外）

### 2.1 加载与安装 [实测]
- `dsh plugin --profile web add <含空格路径>` 会失败：launcher 以 `shell: true` 把参数转给 pnpm 且不加引号，路径在空格处断开。**正确做法**：在 profile 目录 `cd "D:/DeepSeek Harness/.dsh-home/profiles/web" && pnpm add "link:D:/DeepSeek Harness/deepseek插件开发/dsh-amphoreus"`，再跑 `dsh plugin --profile web install` 让 launcher 把 `dsh-amphoreus` reconcile 进 `dsh.profile.bundles`。已完成，profile `package.json` 里三层为 base / web-app / dsh-amphoreus。
- 补丁 `!!js dshHomePath('amphoreus')` 在 bundle 补丁内可用（`--dump-config` 已显示该行）；app-boot 在 prepare 阶段 `ctx.provide('dshHomePath', …)`。
- 启动图里本包行：`{"id":"dsh-amphoreus","url":"/plugins/??dsh-amphoreus/client.js&rev=…","inject":[…12 包]}`，属 application batch；`dsh.client.inject` 只是到达顺序提示，不排序激活。
- 宿主半侧从 profile 解析 `@deepseek-ai/*` 全部走 `$DSH_HOME/profiles/node_modules` 回退目录（226 个符号链接指向 dev 仓）；`zod`/`yaml`/`clsx`/`react`/`zustand`/`immer` 也在那里。**`dsh-client-web`、`dsh-client-store`、`dsh-client-ui-slots`、`dsh-client-ui-primitives` 不在回退目录**，只在 `deepseek-harness-dev/apps/web/node_modules`（静态装配库）。
- 令牌门：源码确认只作用于 `/api` 前缀与 index 渲染；`ctx.webServer.register` 的自定义路由直接交给 handler，无鉴权 **[源码]**。运行时只探到未注册路径落到 SPA 回退 404，尚未用真实路由验证 **[未核实，建第一条路由时顺手验证]**。要鉴权可用 `ctx.connection.requestRejection(req)`（`@deepseek-ai/dsh-client-connection` 宿主面提供 `ctx.connection`，返回 401/403/undefined）。
- 会话创建接受客户端预生成 id：`create({ sessionId, workspaceId|cwd })` → `ensureSession(id, cwd, checkPersistedIdentity=true)` → 持久层 `SESSION_QUERY_SESSION_NOT_FOUND` 后走 `agents.create` **[源码]**；官方 id 格式 `session-<uuid>`；cwd 与已存在会话不符抛 `session/conflict`。这支撑「先绑定席位再建会话」（D-E）。
- fork 不接受预置 id（`SessionForkRequest {sessionId, atSeq?}`），移交后要 fork 完再绑定。

### 2.2 构建与开发环 [实测]
- Node 24.14.1 原生 strip TS：`node --test tests/*.test.ts` 直接跑；`node --check` 可校验 .mjs/.js。
- 树外构建：`tsdown.config.ts` 复刻官方 `clientBundle()` 契约（banner/intro/footer、8 项平台 externals、CSS Modules/`?inline`/全局 CSS 三通道经 lightningcss、纯度门）。`PLATFORM_MODULES` 是**拷贝**（官方库文件导入了样式，Node 配置里 import 不了），`tests/platform-modules.test.ts` 读官方源码比对防漂移，已通过。
- `scripts/dev-link.mjs`：把 `package.json` 声明的全部依赖从 profile 回退目录 / `apps/web/node_modules` / `.pnpm` store 以 **junction** 链进 `./node_modules`（42 项，0 缺失）。只删自己建的 reparse point。**不要在 Git Bash 用 `ln -s`：本机会复制整棵目录树而非建链**（已验证并清理）。junction 用 `New-Item -ItemType Junction`（PowerShell）或 Node `symlinkSync(target, link, 'junction')`；`cmd /c mklink /J` 在此 shell 里参数转义失败。
- schemastery 嵌套对象 `.default({})` 类型报 TS2345；运行时空对象确实会填满内层默认值（实测）。解法：`const EMPTY_OBJECT = {} as unknown as never` 再 `.default(EMPTY_OBJECT)`（已用）。
- 构建后 `lib/index.js` 只保留 `@deepseek-ai/schemastery` 一个外部导入（当前只用了它）；宿主纯度门会拒绝未声明为 dependency/peer 的 `@deepseek-ai/*` 值导入。
- Bash 工具单条命令过长会 `ENAMETOOLONG` 直接不执行：**文件逐个用 Write 工具写**，不要拼大 heredoc。
- 本机构建 DSH 本体的坑见 `D:\DeepSeek Harness\AGENTS.md`（精简 PATH、pnpm shim、`curl --noproxy '*'`）。

### 2.3 DSH 客户端契约（供写 UI 时直接用）[源码]
- 槽位注册：`ctx.slots.inject(key, () => ctx.slots.register({name, id?/key?/priority?, order?, label?, children?, store?, inject?, locale?}, Component))`。single 槽同 priority 重复注册抛错，更低 priority 者渲染。**被遮蔽的官方条目仍在账本，其声明的子槽（`sidebar.workspaces.directoryFlow`）不能重声明**——席位侧栏替换件不声明 children，「新建目录工作区」改调 `ctx.uiWorkspace.pickDirectory()/listDirectory()/createDirectory()` + `ctx.workspaces.create({path})`（D-K）。
- 可加座的列表槽与现任：`conversation.view`（chat 0、trajectory 10；>1 项自动出 Tab）、`conversation.input.dock`（goal 10）、`conversation.session.header.actions`（agent-preset −10、jobs 20）、`conversation.session.header.utilities`、`settings.section`（general 0、agent-presets 20）、`sidebar.footer.action`、`shell.overlay`。空置 single 槽：`sidebar.brand.mark {size}`、`sidebar.brand.name`、`conversation.hero.brand.mark {size,className}`（本机非 official 构建）。
- 第二视图范例：ui-trajectory 在 `conversation.view` 注册 `id:'trajectory', order:10, label: () => t(...)`，inject 用 `ctx.sessions.binding(sessionId)` 与 `ctx.uiConversation.binding(sessionId).target('trajectory')`。工作台照此形状，id `amphoreus-workbench`, order 20。
- 标准钩子：全局 `useSessions`、`useWorkspaces`、`useSessionPendingInteraction`；session 域 `sessionId`、`useSession`、`useProjection`、`useConversation`、`useInput`、`inputActions`、`useChat`。当前会话 = `ctx.sessions.list.getSnapshot().current`；`SessionSummary {id, title?, displayTitle, cwd?, parentId?, origin?, running, completed?, blank, updatedAt, projectionValues?}`。
- `ctx.sessions`：`create/open/clear/fork({sessionId, atSeq?, increaseTitle?})/scope/sessionOf/binding/search`；会话面 `prompt(content[], 'queue'|'steer')`、`rename`、`loadOlder`。
- 主题：`ctx.theme.overrideTokens(source, {'--dsw-…': {light, dark}})` 返回 disposer；**同一 source 再调用即整层替换**（新 seq 叠到顶），disposer 只撤自己那层；裸字符串抛 TypeError；`ctx.theme.getTheme()` / `ctx.on('theme/change', snap)`；ThemePresenter 把 tokens 写成 `body` 内联变量。alias/specific 全量 token 名与光暗值见 `reference/` 里无，需要时 `sed -n` 读 `deepseek-harness-source/packages/client/ui-theme/src/styles/design-platform.css`（body{} 光色块、body[data-ds-dark-theme]{} 暗色块各 89 项）。
- 壁纸透出必须改半透明的面：`ui-layout AppFrame.module.css .frame`（bg-base）与 `.sidebarCol`（sidebar-fill）、`ui-conversation ConversationRoot.module.css .root`（bg-base）、`ui-chat DetailsPanel.module.css .root`（bg-base）、web 壳 `body`（bg-base）。这些是内部实现，透出功能要可关（`wallpaper.enabled`）。首帧图层走宿主 `webserver/index-inject` 的 `{kind:'style'}` + `{kind:'html', placement:'body'}` 行（body 行落在壳脚本之前、`#root` 之前）。
- 词典：`ctx.locale.register(NS, {zh, en})`，同命名空间同语言重复注册抛错；组件经 `locale: NS` 拿 `t`。
- 会话行 UI 参考：`ui-workspace/src/client/rows/{WorkspaceBrowser,Rows}.tsx` 与 `tree.ts`（`deriveGroups/deriveFlat` 形状）；侧栏壳 `ui-sidebar/src/client/SidebarRoot.tsx`；设置行范例 `ui-theme/src/client/AppearanceRow.tsx`；图标名见 `ui-primitives/src/icons/index.tsx`（`IconNewChatOutline16`、`IconBranchOutline16`、`IconSkillOutline16` 等）。
- session 槽的 inject 首参是框架解析出的 `sessionId`；只有声明 store 时才在其后追加 actions（`ui-slots/src/index.ts:483-498`）。
- `conversation.input.dock` 的 owner 是 `InputZone`（`ui-conversation/src/client/contract/slots.ts:127,196-200`）；现任依次为 todo `order:0`（`TodoPanel.tsx:137-138`）、goal `order:10`（`ui-goal/src/client/index.ts:81-84`）、queue `order:20`（`QueueDock.tsx:298-301`），本插件使用 `order:30`（`src/client/index.ts:268-272`）。
- `t()` 支持 `{name}` 形式的参数插值，未提供的参数保留原占位符（`locale/src/client/index.ts:447-455`）。
- `ui-primitives/src/index.ts:1-49` 的公开组件含 `HoverCard`、`Modal`、`Tooltip` 等，但没有 Popover；对 `ui-primitives/src/**` 的 `Popover` 全树搜索同样为零命中。
- `readJson` 默认上限为 4 KiB（`src/host/webapi.ts:20,1007-1017`）；memory PUT 与 observations POST/PUT 均显式放宽到 64 KiB（`:492,508,556`），超过各自上限统一返回 413（`:375-377`）。
- 客户端规则：组件永不见 `ctx`；跨插件只 `import type`；样式只 `--dsw-alias-*` + CSS Modules + clsx；不写 `document.body.appendChild`（synapse 旧做法）。

### 2.4 宿主契约（供写注入/桥接时直接用）[源码]
- `ctx.skills.registerProvider(control => provider)`：`list()` 返回 `SkillCandidate[]` 或 `{candidates, complete:false}`（不缓存）；候选必填 `name, description, invocation{modelInvocable,userInvocable}, provider(=提供者名), source, rank, locator`，可选 `resourceBase{kind:'directory',path}`（`renderSkillContent` 据此输出 Base directory 提示，卡内 `../amphoreus/references/common.md` 才可达）。`control.invalidate()` 广播 `skills/change`。近层同名覆盖远层，rank 仅同层内比序（custom 300）。
- `disable-model-invocation: true` → `modelInvocable:false` → 不进 `<available_skills>`、`skill` 工具拒载，**唯一入口是 `/name` 手势**（`dsh-tool-skill` 在 `agent/pre-step` 扫 `source.kind==='user'` 消息）。
- 注入等价物：`createUserMessage({content:[{type:'text', text: renderSkillContent(def)}], source:{kind:'skill-invocation', name, form:'instructions'}})`（`@deepseek-ai/dsh-llm` + `dsh-skill`）。两条路径：`agent/session-start {agent, source}` 时 `agent.inject(msg)`（入 next-step 收件箱，位于用户首句之前）；或 `agent/pre-step` 瀑布 `const d = await next(); return {...d, messages:[...d.messages, msg]}`（与手敲 `/name` 同位）。`pre-step` 的 `messages` 只是本步新领取批次，去重要另存状态（`bindings.injection.state`）。
- 会话事件只读：`ctx.on('session/event', (session, event) => …)`（隔离调用、抛错只告警）；**不写自定义会话事件**（未知 type 且无 `ignorable` 会拒载整份日志）。`Session {id, header{cwd?, parentSession?, isSeeded}, firstLiveSeq, inheritedEventCount, snapshotEvents(), ownEvents()}`；`SessionStore.list()/get()`。
- storage-domain：`defineDomain({name, version, layout?, global?:{schema, initial}, tables:{t: domainTable<K,V>(zodSchema)}})`，名字匹配 `/^[a-z][a-z0-9_]*$/`；`await ctx.storageDomain.open(spec)`；`table().get/put/update/delete/entries`；json 后端根固定 `$DSH_HOME/storages/`（所以域文件落不到 `$DSH_HOME/amphoreus/`，接受分置：文件类数据落 `dataDir`）。
- Web 路由：`ctx.webServer.register({kind:'exact'|'prefix', path, handler})` 重复抛错；SSE 可长期持有响应；静态资源用 `readFile(new URL('./x', import.meta.url))` 自定位。
- 命令：`ctx.commands.register({name:/^[a-z][a-z0-9_-]*$/, description, input?, handler({agent, rawInput, signal}) → {kind:'success', text?}|{kind:'error', text}})`，命令行不进模型。

## 3. 设计文档状态

| 文件 | 状态 |
|---|---|
| `../设计底账/00–06` | 事实底账，完整，2026-09-02 |
| `../设计文档/01_技能桥接与无损更新.md`（1208 行） | 综合成稿，**未经对抗核查**；结构合理，建设者按它实现解析器/降级矩阵/注入状态机即可，遇到与源码冲突以源码为准 |
| `../设计文档/00_总体架构（草稿·未核查）.md`（737 行） | 2026-09-03 从 `%TEMP%` 抢救的六段装配稿，未复核；其模块编号 H1–H9/B1–B11、决策 D-A…D-W、INV 表、配置 schema、两域数据落点、synapse 分阶段吸收都可直接沿用，与本文 §2 冲突处以本文为准 |
| [已失效 2026-09-05] 02–07 | 未生成；不必补文档，直接按 00 草稿 §5 的模块表写代码 |
| 发布态实现依据 | 设计底账与早期草稿保留为历史输入；A–F 任务的完成状态以当前代码、测试、`BUILD-LOG.md`、`docs/E2E-CHECKLIST.md` 与本文件 §8 的实测记录为准，冲突处以代码及复现命令为准 |

## 4. 已落盘的代码与文件

```
[已失效 2026-09-05] dsh-amphoreus/
[已失效 2026-09-05]   package.json          name/exports/files/dsh.bundle/dsh.client；依赖钉 0.1.2-alpha.4（npm 已确认存在）
[已失效 2026-09-05]   cordis.patch.yml      insert 单行 id: amphoreus（skillRoots / dataDir !!js / assetsRoot）
[已失效 2026-09-05]   tsconfig.json         对齐官方 client 编译形状（es2024, bundler, react-jsx, exactOptionalPropertyTypes…）
[已失效 2026-09-05]   tsdown.config.ts      host ESM + client CJS 闭包工厂 + CSS 三通道 + 纯度门；导出 PLATFORM_MODULES
[已失效 2026-09-05]   scripts/dev-link.mjs  junction 链依赖；`npm run dev:link`
[已失效 2026-09-05]   src/index.ts          宿主壳：name='amphoreus'，inject=[webServer, skills, storageDomain, sessions, agents]，apply 只打日志
[已失效 2026-09-05]   src/host/config.ts    完整 schemastery Config（键义见 00 草稿 §3；全部嵌套对象带默认）
[已失效 2026-09-05]   src/host/suite/types.ts  SuiteSnapshot/CardEntry/Pipeline/HandoffEdge/ContractFormats/Diagnostic… 契约类型
[已失效 2026-09-05]   src/shared/heroes.ts  HERO_VISUALS 13 席（skill↔heroId↔月序↔册号↔纹样↔色板↔素材文件名）、GLOBAL_WALLPAPERS、fallbackHue
[已失效 2026-09-05]   src/client/index.ts   浏览器壳：inject=[slots, locale]，只注册词典 NS 'amphoreus'
[已失效 2026-09-05]   src/client/locales.ts zh/en 起始词典
[已失效 2026-09-05]   src/css-modules.d.ts  *.module.css / *.css?inline 声明
[已失效 2026-09-05]   tests/platform-modules.test.ts  平台模块表防漂移（通过）
[已失效 2026-09-05] [已失效]   workbench/app.js|styles.css|mark.svg  dsh-synapse v0.4.1 vendoring：路由 → /amphoreus/workbench/api、消息 synapse:* → amphoreus:*、source → 'dsh-amphoreus'、localStorage 键 → dsh-amphoreus:*；styles.css 仍是硬编码 hex（待 token 化）
[已失效 2026-09-05]   workbench/app.js|styles.css|mark.svg  dsh-synapse v0.4.1 vendoring；styles.css 第一步 token 化完成（var + 回退），暗色由宿主 DSW token 驱动；第二步删回退见 07 任务书 TD12
[已失效 2026-09-05]   src/host/workbench.ts  内存 seq 索引（ProjectionIndex），启动自 sessions.list() + sessionPersistence.list()/inspect() 重建，无正文、无 workbench.json
[已失效 2026-09-05]   reference/synapse-host-index.js  synapse 宿主半侧原件（H8 工作台投影的改造基底，不进包）
[已失效 2026-09-05]   reference/SYNAPSE-LICENSE.txt, reference/magazine-palette.json（13 册逐页明暗与色板实测 JSON，来自 06 附录脚本）
[已失效 2026-09-05]   LICENSE (MIT), NOTICE（synapse 署名、非官方声明、素材不随包）
```
[已失效 2026-09-05] `.gitignore` 排除 `node_modules/`、`lib/`。`lib/` 当前是骨架构建产物，每次改源码后 `npm run build`（typecheck → d.ts → tsdown）。

## 5. 下一步（按顺序，每步给验收）

[已失效 2026-09-05] **M1 技能桥接 + 全局视觉 + 设置区**
[已失效 2026-09-05] 1. `src/host/suite/markdown.ts`：`splitFrontmatter`（照抄 skill-filesystem 算法：首行 `---`，`yaml.parse`，非对象视为无 frontmatter，旧键 `disableModelInvocation/modelInvocable/userInvocable` 整卡无效）、`sectionize`（`##`/`###`，围栏内忽略）、`parseTable`、`inlineCodes`。
[已失效 2026-09-05] 2. `src/host/suite/roots.ts`：`expandRootPath`（`~`、`$DSH_HOME`、`%VAR%`、相对 → `resolveDshHome()`，realpath 去重）、主根选择（第一个含 `amphoreus/SKILL.md` 且 name 恰为 `amphoreus` 的根）。
[已失效 2026-09-05] 3. `src/host/suite/parse.ts`：纯函数 `parseSuite(files, config) → SuiteSnapshot`，按设计文档 01 §2（分派表两列、`common.md`「移交与流水线」`◯◯线：A → B` 行、「汇报与回执」模板编译成正则、各卡「## 输出模板」回执名与 face、「## 协作与移交」行内代码移交边、description 里 `amphoreus-x／别名` 段）；降级矩阵 §3（L0–L3、FeatureSwitches）。**夹具用虚构卡名**，另加 `AMPHOREUS_REAL_SUITE` 环境变量指向 `~/.claude/skills` 的集成测试（期望 13 卡、逐火线 10 站、守夜线第 3 站 face 长夜月）。
[已失效 2026-09-05] 4. `src/host/suite/fingerprint.ts` + `watch.ts`：清单 sha256（含 persona.md，不含 evals），`fs.watch` 递归失败降轮询，去抖后重解析并 `control.invalidate()`。
[已失效 2026-09-05] 5. `src/host/bridge.ts`：`registerProvider`（provider 名 `dsh-amphoreus`，source `amphoreus`，rank 300，`resourceBase` = 卡目录，`get()` 现读磁盘）。验收：新会话敲 `/amph` 出 14 项且标「仅用户可调用」；`/amphoreus-cyrene 自我介绍` 首答末行匹配回执正则；轨迹视图里 `<available_skills>` 不含 amphoreus-*。
[已失效 2026-09-05] 6. `src/host/store.ts`：两域 `amphoreus`（single：seats/bindings/memory/observations/suite_events + global）与 `amphoreus_canvas`（per-record）；`src/host/seats.ts` 幂等对齐（新卡 deployed、消失 undeployed 保留、改名 renamedFrom/To、`missing` 且空表不建席）。
[已失效 2026-09-05] 7. `src/host/webapi.ts`：`/amphoreus/api/state|events(SSE)|bindings|seats|memory|canvas`、`/amphoreus/assets/*`、`/amphoreus/wallpaper/*`、`/amphoreus/workbench/*`；写路由校 `X-Amphoreus-Nonce`（首帧下发）+ Host 白名单；**不承载会话正文**。`src/host/firstframe.ts`：`index-inject` 的 global/style/html/script 行。
[已失效 2026-09-05] 8. 客户端 `theme.ts`：全局层 `overrideTokens('dsh-amphoreus/global', …)`（昔涟色板 + bg-base/sidebar-fill 带 alpha）；壁纸元素属性切换；`settings.tsx`：`settings.section` id `amphoreus` order 30；品牌三槽 priority −10。
[已失效 2026-09-05] 9. `/amphoreus-sync` 两步命令（可选，`ctx.inject(['commands'])`）。

[已失效 2026-09-05] [已失效] **M2** 席位侧栏（`sidebar.workspaces` priority −10，两组：黄金裔席位 / 我的目录，D-E 预绑定建会话）、逐席 token 层与封面切换（切换协议：预加载 → 240ms 淡入 → 再换 token；失败退全局）、`src/host/injector.ts` 一次性注入状态机（session-start 置 pending、首个 pre-step 追加、手敲同名则 skipped）、`observer.ts` 回执/移交行解析、名牌（`conversation.session.header.actions` order −20）、工作台 Tab（iframe 承载 `workbench/`，桥接 `amphoreus:*` + 新增 `amphoreus:theme-tokens`，正文由宿主页 `useConversation` 喂入）。

[已失效 2026-09-05] [已失效] **M2 当前状态** 工作台以 iframe 承载 `workbench/`，宿主只维护无正文的内存 seq 索引；当前会话正文经 `uiConversation.binding(sessionId).target('chat')` 从浏览器控制器喂入。席位侧栏、逐席 token、技能卡身份与回执观察仍按 D、C、E 章继续建设。

[已失效 2026-09-05] **D 章消息更新（2026-09-05 实测）**：`amphoreus:theme-tokens` 已接通 87 个 token 与 light/dark；`amphoreus:seat-changed` 已接通逐席主题；`amphoreus:magazine-mode` 已接通持久档位与原位版式切换。派生素材由宿主安全路由服务，设置区可后台重建并接收 `derive-progress`。
[已失效 2026-09-05] [已失效] **M3** 移交坞（`conversation.input.dock` order 20，点击才 fork）、站位轨、台账、评估 native 工作台。

**发布后下一步（2026-09-05）**：以 §8 各章「遗留」汇总为准。当前产品级后续项为按 TD12 条件裁决保留 CSS 原色 fallback，以及稳定 URL 强制重派生的 cache-bust 版本化；发布流程后续项为 TF12 的远程 CI、npm 发布、npm／GitHub 安装复测与 GitHub Release。

## 6. 注意事项汇总

- 上游 `alpha` dist-tag 已到 alpha.5，本包钉 alpha.4；升级前先跑底账 05 §2 全表。
- 工艺词防火墙 20 词只进设置区/台账/tooltip，不进气泡与名牌正文（INV-6）。
- 未经明确点击，移交从不接受或切换；移交物不自动发送（INV-3）。
- 缺卡不代演，显示 `common.md` 抽出的缺席标准行（INV-4）。
- 昔涟席 = 全局层，进入不切壁纸与 token。
- 素材：用户原图在 `../` 七个子目录（清单 `../设计底账/04`）；套件自带 webp 素材在 `D:\研究\amphoreus-skill-suite\assets\`（cards/layers/symbols/stickers/mag/meeting，英文 id 命名，可直接作 assetsRoot 的一部分）。杂志 zip 解包目录 `%TEMP%\amphoreus-mag\` 可能已丢，需要时按 06 附录重建。
- `/tmp/refs/dsh-synapse` 克隆可能已丢；所需内容已在 `workbench/` 与 `reference/`。
- 记忆文件 `C:\Users\cangm\.claude\projects\D--DeepSeek-Harness-deepseek----\memory\` 有工作区布局、构建坑、目标、硬约束、本次构建状态五条。

- `D:/DeepSeek Harness/deepseek插件开发/DELIVERY.md` 与当前代码不符，已作废且不属于本仓库发布内容。
- `.pack-dry-run.json` 是早期误存的构建临时文件，已物理删除且由 `.gitignore` 防回归。
- `docs/AUDIT-2026-09-04.md` 是建设前历史审计，保留取证但不再更新；当前实现事实以代码、`BUILD-LOG.md`、E2E 清单和 §8 为准。
- 2026-09-05 从官方 npm registry 实测 `@deepseek-ai/dsh` dist-tags：`latest=0.1.2-rc.1`、`alpha=0.1.2-alpha.5`、`next=0.1.2-rc.1`；本包兼容基线仍钉 `dsh-v0.1.2-alpha.4`。
- 本机 npm 默认 registry 为 `https://registry.npmmirror.com`；所有发布、发布后查询与新包重装必须显式使用 `--registry https://registry.npmjs.org`。
- `dsh plugin add/remove/update` 改变 bundle membership 后必须重启对应 `dsh web`／profile；profile/home `cordis.patch.yml` 的 live 修改不替代 bundle 重启。

### 6.1 E 章运行与人工验收（2026-09-05）

- 全量 `326` 个测试中 `325` 通过、`1` 个预期跳过、`0` 失败；真实技能套件防火墙严格解析 `20` 词，服务重启后 L0 的 13 席与两条流水线保持正常。
- 工作台的「全体会议」chip 已实测进入同一派发面板与泳道；门户「去派发」已实测把输入带到该画布而不直接创建会话。
- 那刻夏会话头已实测显示「逐火线 5/10」，站位面板可由 Escape 关闭。
- 同一 open 移交已实测同时显示输入区横条与详情尾页；明确接受后只生成一个白厄 child，不自动发送移交内容，随后尾页与待移交角标消失。
- 台账已实测随画布活动线程从 `9` 行切到 `1` 行；单条便签新增、刷新、插入草稿、删除，以及连续八条 500 字便签的保序写入与清理均通过。
- E 章专用 binding 已删除、会话已走官方 archiveSession 隐藏；权威 session 日志目录全部保留，测试便签与草稿已恢复为空。

## 7 M1 原样接入事后核对记录

### 7.1 事实

2026-09-04 对 profile `web` 的依赖清单与锁文件取证，原版 `dsh-synapse@0.4.1` 未安装过：

```text
D:/DeepSeek Harness/.dsh-home/profiles/web/package.json:0
D:/DeepSeek Harness/.dsh-home/profiles/web/pnpm-lock.yaml:0
```

M1「原样接入验证」没有执行；2026-09-03 的建设直接以 vendoring 取代了该步骤。Vendoring 的来源文件与去向见 §4 和 [NOTICE](NOTICE)。

### 7.2 替代验证（2026-09-04 实测）

Vendoring 版 `/amphoreus/workbench/` 返回 200；iframe 在 `conversation.view` 内加载；门户渲染 13 张卡片；进席以及画布、详情视图、检查器均可用。依据见 [AUDIT-2026-09-04.md](docs/AUDIT-2026-09-04.md) §2 的 WB-04／WB-06／WB-08／WB-51 和 §5「浏览器实测」。

### 7.3 消息对照表

#### iframe → 宿主

| 原 `synapse:*` 名 | `amphoreus:*` 名 | 状态 |
|---|---|---|
| `synapse:map-ready` | `amphoreus:map-ready` | 工作 |
| `synapse:request-current` | `amphoreus:request-current` | 工作 |
| `synapse:create-session` | `amphoreus:create-session` | 工作 |
| `synapse:send-message` | `amphoreus:send-message` | 工作 |
| `synapse:fork-session` | `amphoreus:fork-session` | 工作 |
| `synapse:open-session` | `amphoreus:open-session` | 本章修复 |
| `synapse:activate-session` | `amphoreus:activate-session` | 工作 |
| `synapse:close` | `amphoreus:close` | 本章修复 |

- `amphoreus:create-session` 使用字段 `seatHeroId`；D-E 顺序待 G13 章。
- `amphoreus:open-session` 的本章修复让同一会话切回「对话」Tab；`seq` 定位待 G12 章。
- `amphoreus:close` 的本章修复由宿主调用 `openView('chat')`。

#### 宿主 → iframe

| 原 `synapse:*` 名 | `amphoreus:*` 名 | 状态 |
|---|---|---|
| `synapse:current-session` | `amphoreus:current-session` | 工作 |
| `synapse:map-opened` | `amphoreus:map-opened` | 工作 |
| `synapse:created-session` | `amphoreus:created-session` | 工作 |
| `synapse:forked-session` | `amphoreus:forked-session` | 工作 |
| `synapse:message-sent` | `amphoreus:message-sent` | 工作 |
| `synapse:bridge-error` | `amphoreus:bridge-error` | 工作 |
| `synapse:workspaces` | `amphoreus:workspaces` | 未接线 |
| `synapse:live-reply` | `amphoreus:live-reply` | 未接线 |
| `synapse:theme` | `amphoreus:theme` | 未接线 |

- `amphoreus:workspaces` 的宿主端从不发送，`workbench/app.js` 接收端是死代码。
- `amphoreus:live-reply` 待 G6 章接线；`amphoreus:theme` 待 G2 章接线。

#### 已删除的原接口

- `POST /synapse/api/sessions/sync`
- `/synapse/api/messages`

替代物见 [AUDIT-2026-09-04.md](docs/AUDIT-2026-09-04.md) G8／G14。

### 7.4 结论

基底可运行已由 vendoring 版实证；不回头重装原包。

### 7.5 D 章视觉验证记录（2026-09-05）

- 全局 light/dark：宿主 body 与 iframe root 的 bg/label/sidebar token 同步，约 180ms 内完成双 rAF 桥接；切换前后服务 stderr 为 0。
- 阿格莱雅：light 为 brand `rgb(169, 137, 74)`、bg `rgba(246, 241, 227, 0.22)`；dark 为 brand `rgb(229, 197, 133)`、bg `rgba(46, 38, 24, 0.4)`；回门户恢复全局 brand `rgb(138, 104, 28)`。
- 那刻夏：星盘纹样以 SVG data URI 平铺，`.canvas-tabs` 为 relative；主题变化时草稿文字保留，纹样 URI 即时切换。
- 昔涟：进入后不安装逐席层，保持全局 token 与壁纸语义。
- 杂志档位：light→full 正式卡 DOM 数量 `16→16`；Q 字号 `22px`、字重 `800`，folio `01 / 06`；折叠后分母仍为 `06`；草稿切档时 value 不变且 active 仍为 true；恢复 light 后装饰消失。
- 派生素材：84 个 WebP；门户 13 张 cover 均走 `/amphoreus/derived/` 且 aspect-ratio 为 3/4；阿格莱雅侧栏 cover、card、sticker 均为派生 URL；后台 force 派生 SSE 顺序完整，最终 `84/0`。
- 第二步未做：首个 `map-ready` 前收到 `amphoreus:theme-tokens` 尚无确定的 happens-before；当前握手可能先在 1 rAF 发 ready、再在 2 rAF 发 token。全套测试虽通过，三席双主题同一验收矩阵也未同时闭合，因此继续保留原色回退。

## 8. 已完成（按章）

### A · 整备与卫生（2026-09-04）
- 完成任务：TA1–TA11；章末收尾与 `chapter-A` 已完成。
- 新事实 [实测]：仓库、构建基线、唯一 nonce 写头、iframe 双 Tab 清理、`openView('chat')`、Tab 记忆、工作台开关／不可投影状态、设置区署名与门户均已落地；章末 `tests 69 / pass 68 / fail 0 / skipped 1`，client／host 为 `70.22/158.32 kB`。
- 偏离设计：A-DoD-16 的原字面计数与两处必要调用冲突，改以等价局部变量约束；ready 只在 resolver 完成后宣告。
- 遗留：无。

### B · 投影与桥接（2026-09-04）
- 完成任务：TB1–TB10；章末提交 `7dd17f0` 与 `chapter-B` 已完成。
- 新事实 [实测]：`ProjectionIndex` 只存 seq 结构，正文由浏览器 `uiConversation` 喂入；live reply、server canvas／prefs、隐藏会话与迁移均已接通。运行态 `revision=1, sessions=14, sessionsWithCards=11, cards=25, textCount=0`，旧 workspaces 数据路由为 404，`workbench.json` 不再生成；章末 `tests 119 / pass 118 / fail 0 / skipped 1`，client／host 为 `86.41/152.02 kB`。
- 偏离设计：未制造 30+ 轮不可逆模型会话；改用同 schema／route 的 70-position PUT/GET 与完整回滚证明容量。`source.kind` 字面门按等价行为修正。
- 遗留：无代码遗留；30+ 轮字面场景的等价容量验收理由保留在 `BUILD-LOG.md`。

### C · 席位语义与专属空间（2026-09-05）
- 完成任务：TC1–TC11；章末提交 `205004a` 与 `chapter-C` 已完成。
- 新事实 [实测]：13 个 deployed seats 与 13 个 seatDirs、侧栏双组、先 PUT binding 再 create、fork-inherit、会话名牌、Portal overlay、逐席壁纸／theme，以及 current／unknown／global／Cyrene 行为均通过；章末 `tests 242 / pass 241 / fail 0 / skipped 1`，derive／client／host 为 `28.87/170.83/188.25 kB`。
- 偏离设计：`garnish.ts` 的 `document.body.appendChild` 保留，理由：问候语装饰层不进槽位。（裁决 J-15；TF10 X-14）
- 遗留：C 章当时交给 E 章的派发、移交、站位轨、接通尾页与台账已由 TE1–TE10 完成；当前无。

### D · 十三套视觉与杂志语法（2026-09-05）
- 完成任务：TD1–TD12；章末提交 `630df08` 与 `chapter-D` 已完成。
- 新事实 [实测]：77 alias + 10 specific 共 87 个桥接 token、104 条对比度记录且 0 失败、13 个 motif、系统字体、full magazine、84 个派生 WebP、derived 路由与设置区派生均通过；light/dark 双 rAF 桥约 180ms。章末 `tests 185 / pass 184 / fail 0 / skipped 1`，derive／client／host 为 `28.87/121.16/184.52 kB`。
- 偏离设计：`canReplaceView` 分支由原位 class/token 更新替代；“同帧”按真实双 rAF 记为约 180ms；D 按裁决先于 C；HANDOFF 的早期行只加失效前缀。
- 遗留：CSS 原色 fallback 按 TD12 条件裁决保留；固定蓝已由后续 C/TC9 清零；稳定 URL 在强制重派生时的 cache-bust 仍是后续版本化设计项。

### E · 总空间派发与流水线（2026-09-05）
- 完成任务：TE1–TE10；章末提交 `0486490` 与 `chapter-E` 已完成。
- 新事实 [实测]：全体会议、派发面板／泳道、station rail、observer／observations、handoff dock／edge／connecting tail、ledger／memory／insert draft 与 20 词防火墙均完成；派发文本只在明确提交后发送，移交物不自动发送。章末 `tests 326 / pass 325 / fail 0 / skipped 1`，derive／client／host 为 `28.87/205.78/199.59 kB`；5 个 bindings 删除、5 个会话经官方 Gateway 归档，日志目录保留，notes／drafts 清空，stderr 为 0。
- 偏离设计：matcher 的任务书示例分数为 11，按三个唯一命中词的长度累计后实算为 13；blank session 不挂 conversation.view，Portal 保持 all canvas；TE8 修复同步 current-session 竞态；fork child 零新增消息按最后 `session/end-seed` 后缀判定。
- 遗留：无。

### F · 发布与验收（2026-09-05）
- 完成任务：TF1–TF11 已完成并验收；TF12 尚未完成，原因是远程仓库、真实 GitHub CI、npm 发布、npm 安装复测、GitHub SHA 安装抽测与 GitHub Release 必须在本文件事实落盘之后依次执行。
- 新事实 [实测]：TF1 清理仓库并加入 LF／Node 24 基线与原创 mark；TF2 将生产 dependencies 收到 `yaml,zod`、peers=6、overrides=6，官方 npm 锁无 rc/npmmirror；TF3 `verify-dist: OK 377 checks`、tarball 70 files、unpacked <2 MB，真实媒体反向门 exit 1；TF4 优先读发布态 `platform.d.ts`；TF5 的 Ubuntu/Windows CI 与 v* provenance release YAML／结构在本地通过，远程尚未运行；TF6 README 有 14 个二级标题、23 个顶层配置键、三种安装方式与 13 席表；TF7 外置素材 required/optional=`58/58,32/32`、large=`5`；TF8 NOTICE 四事实唯一、设置署名与上游归属完整。
- 新事实 [实测]：TF9 `path-b: OK`；tarball 70 files、393.7 kB；reconcile 为 base → web-app → dsh-amphoreus，profile-local 未重复安装六项 peer，启动后六项全由 fallback 解析；dump 命中 526/527/533，3090 stderr 0，auth 303，boot=2，state=`L0 13 true`，bundle wrapper 与 mark 200；独立 npm-ci 的 dsh-client-web 为 d.ts=true/src=false，`tests 326/pass 325/fail 0/skip 1`，build=`28.90/205.60/199.69 kB`，verify=377；真实首轮 `TF9-PATH-B-OK`，3090 清零、主 web hash 不变且 3080 running/200，敏感 OUT/JAR 已清理。
- 新事实 [实测]：TF10 汇总 A–E 110 行、X-1…X-14 与 12 步浏览器走查；X-1…X-13 已实测，X-14 由本节 C 段裁决闭合。真实完成建席、陪聊／工作回执、fork-inherit、白厄派发、显式移交、暗色、三席换装、live 开关、技能别名更新与缺卡恢复；6 个测试会话官方归档、binding 回基线，profile／技能 hash 与 mtime 全恢复。E2E 又发现 dock 被官方 40px resize handle 截获，已将 dock 对齐 composer card 上限；修复后几何不重叠且普通指针一次接受成功。最终 `tests 326 / pass 325 / fail 0 / skipped 1`，derive／client／host 为 `28.87/205.87/199.59 kB`，verify=377。
- 偏离设计：TF2 将宿主包归入 peerDependencies；TF9 的独立 npm-ci 又发现三个仅开发期 runtime peer 缺失，只将 `dsh-invariants/dsh-scope/dsh-storage` 补入 devDependencies。项目级 `.npmrc` 使用 `legacy-peer-deps=true`，六项 overrides 防止 rc 漂移。TF9 用完整 no-hardlinks clone 代替不完整复制回退；默认复用主 DSH_HOME，只验证 profile 依赖、bundle、端口与进程隔离，storage/session 仍属同一 home，脚本保留 `PATH_B_DSH_HOME` 供完整数据隔离；实测会话已归档、bindings 回基线且主 web manifest/patch hash 不变。TF10 按当前外部 common.md 保留陪聊免逐轮回执，并以工作场另证 receipt；稳定工作台 HTML 壳返回 200/boot disabled，权威 index 在关闭时返回 503。
- 遗留：TF12 的远程仓创建、双系统 CI、`v0.2.0` tag、npm `alpha` 发布、npm 安装复测、GitHub SHA 安装抽测与 GitHub Release。
- `amphoreus:*` 消息清单以 `grep -o "'amphoreus:[a-z-]*'" workbench/app.js src/client/workbench.tsx | sort -u` 实测为准，M1 核对与数字见 §7。

## 9. 文件清单（发布态）

| 路径 | 入库 | npm 包 | 说明 |
|---|---:|---:|---|
| `.gitattributes` | 是 | 否 | 全仓 LF 基线 |
| `.github/` | 是 | 否 | Ubuntu/Windows CI 与 tag release workflow |
| `.gitignore` | 是 | 否 | 忽略依赖、产物、tarball 与本地运行文件 |
| `.node-version` | 是 | 否 | Node 24 |
| `.npmrc` | 是 | 否 | `legacy-peer-deps=true`，无 registry 或 token |
| `BUILD-LOG.md` | 是 | 否 | 最终将承载 66 个任务与六章验收日志；TF11 提交时为 65 个任务段／五个章末段，TF12 与 F 章收尾后达到最终计数 |
| `cordis.patch.yml` | 是 | 是 | DSH bundle patch |
| `docs/` | 是 | 否 | 历史审计、E2E 清单、截图占位；TF12 后含 release note |
| `HANDOFF.md` | 是 | 否 | 唯一交接入口 |
| `LICENSE` | 是 | 是 | 本包 MIT |
| `NOTICE` | 是 | 是 | vendoring、非官方声明与变更归属 |
| `package-lock.json` | 是 | 否 | 官方 npm registry 的 npm-ci lock |
| `package.json` | 是 | 自动 | 发布 manifest 与 files 白名单 |
| `README.md` | 是 | 是 | 用户安装、配置、素材、技能与限制 |
| `reference/` | 是 | 否 | 上游许可、宿主基底与杂志色板证据 |
| `scripts/` | 是 | 部分 | 六个开发／验收脚本逐项展开如下，只有派生器进包 |
| `scripts/check-assets.mjs` | 是 | 否 | 外置素材只读检查 |
| `scripts/check-contrast.ts` | 是 | 否 | 视觉对比度开发门 |
| `scripts/derive-assets.mjs` | 是 | 是 | 用户侧素材派生器 |
| `scripts/dev-link.mjs` | 是 | 否 | 本地 junction 开发辅助 |
| `scripts/path-b.sh` | 是 | 否 | tarball/profile/npm-ci 路径 B 复验 |
| `scripts/verify-dist.mjs` | 是 | 否 | 发布产物纯度验证；不自带进包 |
| `src/` | 是 | 否 | TypeScript 源码 |
| `tests/` | 是 | 否 | 单元、合同与回归测试 |
| `tsconfig.json` | 是 | 否 | TypeScript 构建配置 |
| `tsdown.config.ts` | 是 | 否 | 树外三入口构建配置 |
| `workbench/` | 是 | 是 | vendored 画布运行文件，逐项展开如下 |
| `workbench/app.js` | 是 | 是 | vendored 画布逻辑 |
| `workbench/styles.css` | 是 | 是 | 画布样式与 token fallback |
| `workbench/mark.svg` | 是 | 是 | 本包原创 mark |
| `lib/` | 否 | 构建后是 | 三个 JS/map 与声明文件；不入 Git |
| `node_modules/` | 否 | 否 | 本地依赖／junction，不入 Git 或包 |

顶层入库项以 `git ls-files | sed 's,/.*,,' | sort -u` 为准；`package.json.files` 共 13 项，`scripts/` 六个脚本中只有 `derive-assets.mjs` 进 npm 包。
