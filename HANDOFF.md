# dsh-amphoreus 建设交接（2026-09-03）

> **2026-09-04 更新**：§0「一句话现状」、§4「已落盘的代码」、§5「下一步」已过时——现状见 `README.md`「现状」与 `AUDIT-2026-09-04.md`；建设任务书见 `../设计文档/07_建设计划_分章草稿/`。§1 用户裁决、§2 平台事实、§6 注意事项仍有效。§7 为 M1 原样接入事后核对记录。

> 给接手建设的 AI（Fable 5 等）。本文是**唯一交接入口**：先读本文，再按需读 `../设计底账/`（事实）与 `../设计文档/01_技能桥接与无损更新.md`（技能桥接规范）。工作区总入口 `D:\DeepSeek Harness\AGENTS.md`，插件通用规范 `D:\DeepSeek Harness\DSH插件开发指南.md`。
> 标注：**[实测]** 本机跑过；**[源码]** 读 alpha.4 源码得出；**[未核实]** 动手前须验证。

> **2026-09-04 更新**：差距审计见 `AUDIT-2026-09-04.md`；**完整建设任务书见 `../设计文档/07_建设者任务书（Codex一口气版）.md`**（66 任务 TA1–TF12，含总纲、G1–G21 映射、章间裁决 J-1…J-16、完成定义）。接手建设者从该任务书 §0 开工，本文 §5「下一步」已被其取代；§1 裁决与 §2 平台事实仍有效。

## 0. 一句话现状

包 `dsh-amphoreus` 已有可装可启的双半侧骨架：已 `link:` 装进 profile `web`，`dsh web` 启动后宿主行挂载、浏览器 bundle 进入启动图并被 `/plugins` 路由 200 下发、stderr 为空 **[实测]**。业务模块（技能桥接、席位、注入、观察、Web 通道、首帧、主题壁纸、工作台、设置区）**一个都还没写**，只有类型契约 `src/host/suite/types.ts`。服务当前仍在运行（PID 见 `.runtime/deepseek-harness.pid`），改完 host 代码需 Stop/Start，改完 client 需重建 `lib/client.js` 并刷新页面（无 `pnpm run dev:web` 时 HMR 不会自动生效）。

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
| 02–07 | 未生成；不必补文档，直接按 00 草稿 §5 的模块表写代码 |

## 4. 已落盘的代码与文件

```
dsh-amphoreus/
  package.json          name/exports/files/dsh.bundle/dsh.client；依赖钉 0.1.2-alpha.4（npm 已确认存在）
  cordis.patch.yml      insert 单行 id: amphoreus（skillRoots / dataDir !!js / assetsRoot）
  tsconfig.json         对齐官方 client 编译形状（es2024, bundler, react-jsx, exactOptionalPropertyTypes…）
  tsdown.config.ts      host ESM + client CJS 闭包工厂 + CSS 三通道 + 纯度门；导出 PLATFORM_MODULES
  scripts/dev-link.mjs  junction 链依赖；`npm run dev:link`
  src/index.ts          宿主壳：name='amphoreus'，inject=[webServer, skills, storageDomain, sessions, agents]，apply 只打日志
  src/host/config.ts    完整 schemastery Config（键义见 00 草稿 §3；全部嵌套对象带默认）
  src/host/suite/types.ts  SuiteSnapshot/CardEntry/Pipeline/HandoffEdge/ContractFormats/Diagnostic… 契约类型
  src/shared/heroes.ts  HERO_VISUALS 13 席（skill↔heroId↔月序↔册号↔纹样↔色板↔素材文件名）、GLOBAL_WALLPAPERS、fallbackHue
  src/client/index.ts   浏览器壳：inject=[slots, locale]，只注册词典 NS 'amphoreus'
  src/client/locales.ts zh/en 起始词典
  src/css-modules.d.ts  *.module.css / *.css?inline 声明
  tests/platform-modules.test.ts  平台模块表防漂移（通过）
[已失效]   workbench/app.js|styles.css|mark.svg  dsh-synapse v0.4.1 vendoring：路由 → /amphoreus/workbench/api、消息 synapse:* → amphoreus:*、source → 'dsh-amphoreus'、localStorage 键 → dsh-amphoreus:*；styles.css 仍是硬编码 hex（待 token 化）
  workbench/app.js|styles.css|mark.svg  dsh-synapse v0.4.1 vendoring；styles.css 第一步 token 化完成（var + 回退），暗色由宿主 DSW token 驱动；第二步删回退见 07 任务书 TD12
  src/host/workbench.ts  内存 seq 索引（ProjectionIndex），启动自 sessions.list() + sessionPersistence.list()/inspect() 重建，无正文、无 workbench.json
  reference/synapse-host-index.js  synapse 宿主半侧原件（H8 工作台投影的改造基底，不进包）
  reference/SYNAPSE-LICENSE.txt, reference/magazine-palette.json（13 册逐页明暗与色板实测 JSON，来自 06 附录脚本）
  LICENSE (MIT), NOTICE（synapse 署名、非官方声明、素材不随包）
```
`.gitignore` 排除 `node_modules/`、`lib/`。`lib/` 当前是骨架构建产物，每次改源码后 `npm run build`（typecheck → d.ts → tsdown）。

## 5. 下一步（按顺序，每步给验收）

**M1 技能桥接 + 全局视觉 + 设置区**
1. `src/host/suite/markdown.ts`：`splitFrontmatter`（照抄 skill-filesystem 算法：首行 `---`，`yaml.parse`，非对象视为无 frontmatter，旧键 `disableModelInvocation/modelInvocable/userInvocable` 整卡无效）、`sectionize`（`##`/`###`，围栏内忽略）、`parseTable`、`inlineCodes`。
2. `src/host/suite/roots.ts`：`expandRootPath`（`~`、`$DSH_HOME`、`%VAR%`、相对 → `resolveDshHome()`，realpath 去重）、主根选择（第一个含 `amphoreus/SKILL.md` 且 name 恰为 `amphoreus` 的根）。
3. `src/host/suite/parse.ts`：纯函数 `parseSuite(files, config) → SuiteSnapshot`，按设计文档 01 §2（分派表两列、`common.md`「移交与流水线」`◯◯线：A → B` 行、「汇报与回执」模板编译成正则、各卡「## 输出模板」回执名与 face、「## 协作与移交」行内代码移交边、description 里 `amphoreus-x／别名` 段）；降级矩阵 §3（L0–L3、FeatureSwitches）。**夹具用虚构卡名**，另加 `AMPHOREUS_REAL_SUITE` 环境变量指向 `~/.claude/skills` 的集成测试（期望 13 卡、逐火线 10 站、守夜线第 3 站 face 长夜月）。
4. `src/host/suite/fingerprint.ts` + `watch.ts`：清单 sha256（含 persona.md，不含 evals），`fs.watch` 递归失败降轮询，去抖后重解析并 `control.invalidate()`。
5. `src/host/bridge.ts`：`registerProvider`（provider 名 `dsh-amphoreus`，source `amphoreus`，rank 300，`resourceBase` = 卡目录，`get()` 现读磁盘）。验收：新会话敲 `/amph` 出 14 项且标「仅用户可调用」；`/amphoreus-cyrene 自我介绍` 首答末行匹配回执正则；轨迹视图里 `<available_skills>` 不含 amphoreus-*。
6. `src/host/store.ts`：两域 `amphoreus`（single：seats/bindings/memory/observations/suite_events + global）与 `amphoreus_canvas`（per-record）；`src/host/seats.ts` 幂等对齐（新卡 deployed、消失 undeployed 保留、改名 renamedFrom/To、`missing` 且空表不建席）。
7. `src/host/webapi.ts`：`/amphoreus/api/state|events(SSE)|bindings|seats|memory|canvas`、`/amphoreus/assets/*`、`/amphoreus/wallpaper/*`、`/amphoreus/workbench/*`；写路由校 `X-Amphoreus-Nonce`（首帧下发）+ Host 白名单；**不承载会话正文**。`src/host/firstframe.ts`：`index-inject` 的 global/style/html/script 行。
8. 客户端 `theme.ts`：全局层 `overrideTokens('dsh-amphoreus/global', …)`（昔涟色板 + bg-base/sidebar-fill 带 alpha）；壁纸元素属性切换；`settings.tsx`：`settings.section` id `amphoreus` order 30；品牌三槽 priority −10。
9. `/amphoreus-sync` 两步命令（可选，`ctx.inject(['commands'])`）。

[已失效] **M2** 席位侧栏（`sidebar.workspaces` priority −10，两组：黄金裔席位 / 我的目录，D-E 预绑定建会话）、逐席 token 层与封面切换（切换协议：预加载 → 240ms 淡入 → 再换 token；失败退全局）、`src/host/injector.ts` 一次性注入状态机（session-start 置 pending、首个 pre-step 追加、手敲同名则 skipped）、`observer.ts` 回执/移交行解析、名牌（`conversation.session.header.actions` order −20）、工作台 Tab（iframe 承载 `workbench/`，桥接 `amphoreus:*` + 新增 `amphoreus:theme-tokens`，正文由宿主页 `useConversation` 喂入）。

**M2 当前状态** 工作台以 iframe 承载 `workbench/`，宿主只维护无正文的内存 seq 索引；当前会话正文经 `uiConversation.binding(sessionId).target('chat')` 从浏览器控制器喂入。席位侧栏、逐席 token、技能卡身份与回执观察仍按 D、C、E 章继续建设。

**D 章消息更新（2026-09-05 实测）**：`amphoreus:theme-tokens` 已接通 87 个 token 与 light/dark；`amphoreus:seat-changed` 已接通逐席主题；`amphoreus:magazine-mode` 已接通持久档位与原位版式切换。派生素材由宿主安全路由服务，设置区可后台重建并接收 `derive-progress`。
**M3** 移交坞（`conversation.input.dock` order 20，点击才 fork）、站位轨、台账、评估 native 工作台。

## 6. 注意事项汇总

- 上游 `alpha` dist-tag 已到 alpha.5，本包钉 alpha.4；升级前先跑底账 05 §2 全表。
- 工艺词防火墙 20 词只进设置区/台账/tooltip，不进气泡与名牌正文（INV-6）。
- 移交从不自动切换、移交物不自动发送（INV-3）。
- 缺卡不代演，显示 `common.md` 抽出的缺席标准行（INV-4）。
- 昔涟席 = 全局层，进入不切壁纸与 token。
- 素材：用户原图在 `../` 七个子目录（清单 `../设计底账/04`）；套件自带 webp 素材在 `D:\研究\amphoreus-skill-suite\assets\`（cards/layers/symbols/stickers/mag/meeting，英文 id 命名，可直接作 assetsRoot 的一部分）。杂志 zip 解包目录 `%TEMP%\amphoreus-mag\` 可能已丢，需要时按 06 附录重建。
- `/tmp/refs/dsh-synapse` 克隆可能已丢；所需内容已在 `workbench/` 与 `reference/`。
- 记忆文件 `C:\Users\cangm\.claude\projects\D--DeepSeek-Harness-deepseek----\memory\` 有工作区布局、构建坑、目标、硬约束、本次构建状态五条。

## 7 M1 原样接入事后核对记录

### 7.1 事实

2026-09-04 对 profile `web` 的依赖清单与锁文件取证，原版 `dsh-synapse@0.4.1` 未安装过：

```text
D:/DeepSeek Harness/.dsh-home/profiles/web/package.json:0
D:/DeepSeek Harness/.dsh-home/profiles/web/pnpm-lock.yaml:0
```

M1「原样接入验证」没有执行；2026-09-03 的建设直接以 vendoring 取代了该步骤。Vendoring 的来源文件与去向见 §4 和 [NOTICE](NOTICE)。

### 7.2 替代验证（2026-09-04 实测）

Vendoring 版 `/amphoreus/workbench/` 返回 200；iframe 在 `conversation.view` 内加载；门户渲染 13 张卡片；进席以及画布、详情视图、检查器均可用。依据见 [AUDIT-2026-09-04.md](AUDIT-2026-09-04.md) §2 的 WB-04／WB-06／WB-08／WB-51 和 §5「浏览器实测」。

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

替代物见 [AUDIT-2026-09-04.md](AUDIT-2026-09-04.md) G8／G14。

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
