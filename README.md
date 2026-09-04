# dsh-amphoreus

翁法罗斯 × DSH：黄金裔席位工作区、技能无损桥接与画布工作台。基于 DeepSeek Harness（dsh-v0.1.2-alpha.4）构建，非官方产品。

## 现状（2026-09-04）

已实现：

- 从 `skillRoots` 在运行时解析技能套件，并提供目录监听、内容指纹与显式降级。
- 建立 13 席黄金裔席位表与席位目录；席内新会话在首轮一次性注入对应技能卡。
- 提供 `/amphoreus/*` Web API，并以进程级 nonce 与 Host 门保护写请求。
- 提供首帧壁纸层、全局昔涟主题层、品牌三槽和设置区。
- 提供工作台 Tab；其中 iframe 承载由 dsh-synapse 改造的 vendored 画布。会话结构由冷重放与实时事件共同维护，卡片正文只由当前浏览器会话控制器喂入。

仍待后续章节兑现：`G2` 画布主题 token、`G5` 卡片黄金裔身份、`G7` fork 继承席位、`G13` 新会话归属原子化、`G15` 全局门户移动、`G21` 杂志重档，以及 `M3` 总空间派发能力。历史审计基线见 [AUDIT-2026-09-04.md](AUDIT-2026-09-04.md)。

- 正文与会话列表不经宿主路由，宿主只保留 seq 索引（B 章）。

## 配置

| 配置键 | 说明 |
|---|---|
| `skillRoots` | 按顺序列出运行时搜索和解析 Amphoreus 技能套件的只读目录。 |
| `dataDir` | 指定插件自有文件数据的落盘目录。 |
| `assetsRoot` | 指向用户本地素材根目录；原始图片不随插件分发。 |
| `heroWorkspaceMode` | 选择启用十三席席位目录（`seats`）或关闭席位工作区（`off`）。 |
| `magazineMode` | 选择杂志视觉的 `light` 或 `full` 档；`full` 档仍待 `G21` 完成。 |
| `seatStyle` | 控制逐席视觉样式是否启用。 |
| `wallpaper.*` | 配置壁纸开关、全局选图方式与索引、侧栏索引、逐席壁纸、明暗遮罩和表面透明度。 |
| `autoInvoke.*` | 配置首轮技能卡自动注入开关及允许的会话启动来源。 |
| `workbench.enabled` | 控制工作台 Tab 与相关工作台能力是否启用。 |
| `workbench.host` | 选择工作台承载方式；`native` 预留，当前按 `iframe` 处理。 |
| `workbench.defaultView` | 选择会话默认进入 `chat` 或 `workbench`；页面加载时的首个会话通常不受该设置影响。 |
| `workbench.cardTextLimit` | 设置浏览器侧工作台卡片的正文截断字数；详情仍保留当前会话控制器提供的全文。 |
| `workbench.autoProjection` | 控制会话事件是否自动投影到工作台。 |
| `suiteWatch.*` | 配置技能套件监听模式（`fs`、`poll`、`off`）、轮询间隔和防抖时间。 |
| `trustedHosts` | 列出允许通过 Host 门访问插件 Web 路由的额外主机。 |

## 开发环

```bash
npm run dev:link
```

把 `package.json` 声明的依赖以 junction 从本机 DSH 安装链进 `node_modules`。

```bash
npm run build
```

typecheck → 声明文件 → tsdown（`lib/index.js` 宿主半侧、`lib/client.js` 浏览器半侧）。

```bash
npm test
```

## 安装到 profile web

在 profile 目录执行（路径含空格时不要用 `dsh plugin add <path>`）：

```bash
pnpm add "link:D:/DeepSeek Harness/deepseek插件开发/dsh-amphoreus"
```

再运行 `dsh plugin --profile web install` 让 launcher 把本包 reconcile 进 `dsh.profile.bundles`，然后重启 `dsh web`。

## 已知限制

1. 首帧 nonce 每个进程随机生成；宿主重启后需刷新工作台。
2. 页面加载时的首个会话通常不受 `workbench.defaultView` 影响。
3. “记住 Tab”在插件热重载或会话回到空白态时可能被误记为“对话”；下次进入工作台 Tab 后会自愈。

## 边界

- 不内嵌技能内容；`skillRoots` 只是目录引用，运行时解析，对技能目录只读。
- 不写自定义会话事件；自有数据落 storage-domain 与 `dataDir`。
- 不夹带《崩坏：星穹铁道》原图；素材经 `assetsRoot` 指向用户本地目录。

## 致谢

- 工作台画布、投影与桥接协议源自 [liangmianya/dsh-synapse](https://github.com/liangmianya/dsh-synapse) v0.4.1（MIT），本包为**改造版**，不宣称原创；改动摘要与原始许可见 [NOTICE](NOTICE)、[reference/SYNAPSE-LICENSE.txt](reference/SYNAPSE-LICENSE.txt)。
- 技能套件 [xi-kari/amphoreus-skill-suite](https://github.com/xi-kari/amphoreus-skill-suite) 由运行时从 `skillRoots` 解析，不随包分发。
- 本包基于 DeepSeek Harness 构建，非官方产品。
