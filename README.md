# dsh-amphoreus

翁法罗斯 × DSH：黄金裔席位工作区、技能无损桥接与画布工作台。基于 DeepSeek Harness（dsh-v0.1.2-alpha.4）构建，非官方产品。

## 现状（2026-09-05）

已实现：

- 从 `skillRoots` 在运行时解析技能套件，并提供目录监听、内容指纹与显式降级。
- 建立 13 席黄金裔席位表与席位目录；席内新会话在首轮一次性注入对应技能卡。
- 提供 `/amphoreus/*` Web API，并以进程级 nonce 与 Host 门保护写请求。
- 提供首帧壁纸层、全局昔涟主题层、品牌三槽和设置区。
- 提供工作台 Tab；其中 iframe 承载由 dsh-synapse 改造的 vendored 画布。会话结构由冷重放与实时事件共同维护，卡片正文只由当前浏览器会话控制器喂入。
- 提供 13 席 light/dark token、共享 SVG 纹样、`light`/`full` 杂志版式，以及可重建的本地 WebP 派生缓存；视觉层设置可即时切档并显示后台派生进度。

仍待后续章节兑现：`M3` 总空间派发能力。历史审计基线见 [AUDIT-2026-09-04.md](AUDIT-2026-09-04.md)。

- 正文与会话列表不经宿主路由，宿主只保留 seq 索引（B 章）。

## 席位与目录

黄金裔席位是会话的承办绑定维度，唯一事实来自会话 ID 到 skill name 的绑定；“我的目录”继续使用 DSH 官方工作区维度，表示会话所在目录，两者互不替代。

在席内新建会话时，插件先预生成会话 ID 并写入席位绑定，再用该 ID 创建会话；创建或打开失败时回滚预绑定。由已有会话 fork 出的子会话继承父席。昔涟席代表全体会议与全局视觉层，进入时不切换逐席壁纸或主题 token。

## 配置

| 配置键 | 说明 |
|---|---|
| `skillRoots` | 按顺序列出运行时搜索和解析 Amphoreus 技能套件的只读目录。 |
| `dataDir` | 指定插件自有文件数据的落盘目录。 |
| `assetsRoot` | 指向用户本地素材根目录；原始图片不随插件分发。 |
| `heroWorkspaceMode` | 选择启用十三席席位目录（`seats`）或关闭席位工作区（`off`）。 |
| `magazineMode` | 选择杂志视觉的 `light` 或 `full` 档；视觉层设置可写入持久偏好覆盖此配置，并可恢复为配置值。 |
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
4. 派生素材使用稳定 `.webp` URL 与一天私有缓存；强制重做后，已经打开的浏览器页可能需要刷新才能立即看见新图。
5. DSH alpha.4 的空白会话不渲染会话视图；从对话 Tab 打开总览再进入“全体会议”或使用“去派发”时，总空间画布因此留在门户覆盖层内承载，不新建空白宿主会话。

## 素材包

发布包不含任何图片、杂志内页或技能正文。原始素材留在用户自己的目录中，插件只从 profile 配置的 `assetsRoot` 读取；请勿把素材复制进插件包目录。

在目标 profile 的 `cordis.patch.yml` 中，以包内 [`cordis.patch.yml`](cordis.patch.yml) 的 insert 形状覆盖素材根，例如：

```yaml
- insert:
    - id: amphoreus
      name: dsh-amphoreus
      config:
        assetsRoot: 'D:/你的素材目录'
```

素材根采用以下目录名；名称与运行时代码逐字一致：

| 目录 | 内容与用途 |
|---|---|
| `昔涟壁纸/` | 6 张全局壁纸：`Image_1788022237216_660.png`、`Image_1788022238729_461.png`、`Image_1788022241165_565.png`、`Image_1788022242885_262.png`、`Image_1788022248464_572.png`、`Image_1788022255434_340.png`。 |
| `翁法罗斯英雄纪/` | 13 张英雄纪原图；保留源文件原名，包括 `09阿格莱呀.jpg`。 |
| `翁法罗斯日历/` | 13 席日历图；属于完整素材清单，当前派生 CLI 不消费这一目录。 |
| `翁法罗斯如我所书卡牌/` | 13 张角色卡牌原图。 |
| `表情包/` | 至少包含 13 张席位贴纸、品牌贴纸 `小昔涟-嘻嘻.png` 与 12 张奇美拉贴纸。 |
| `黄金裔杂志_13册分册压缩包/` | Vol.01–Vol.13；派生器只在内存中读取每册唯一的根级 `00_封面`，不解压杂志内页。 |

十三席的五类源文件名直接对应 `HERO_VISUALS[].assets`：

| heroId | Vol. | 英雄纪 | 日历 | 如我所书卡牌 | 杂志分册 | 席位贴纸 |
|---|---:|---|---|---|---|---|
| `cyrene` | 13 | `13昔涟.jpg` | `翁法罗斯2026一年历-封面-昔涟.jpg` | `13昔涟.png` | `Vol.13_往昔的涟漪_昔涟_14张.zip` | `昔涟-收到.png` |
| `tribbie` | 02 | `01缇宝.jpg` | `1月-门关月-缇宝.jpg` | `01缇宝.png` | `Vol.02_命运的三子_缇宝_11张.zip` | `缇宝-睿智.png` |
| `cerydra` | 10 | `02刻律德菈.jpg` | `2月-平衡月-刻律德菈.jpg` | `02刻律德菈.png` | `Vol.10_执棋的君主_刻律德菈_12张.zip` | `刻律德菈-将军.png` |
| `march7th` | 11 | `03长夜月.jpg` | `3月-长夜月-长夜月.jpg` | `03长夜月.png` | `Vol.11_隐秘的陌客_长夜月_12张.zip` | `长夜月-去吧.png` |
| `terrae` | 12 | `04丹恒.jpg` | `4月-耕耘月-丹恒.jpg` | `04丹恒.png` | `Vol.12_腾飞的荒龙_丹恒·腾荒_12张.zip` | `丹恒-倾听.png` |
| `hysilens` | 09 | `05海瑟音.jpg` | `5月-欢喜月-海瑟音.jpg` | `05海瑟音.png` | `Vol.09_奏浪的剑骑_海瑟音_12张.zip` | `海瑟音-哼歌.png` |
| `hyacine` | 06 | `06风堇.jpg` | `6月-长昼月-风堇.jpg` | `06风堇.png` | `Vol.06_摇光的医师_雅辛忒丝_12张.zip` | `风堇-治愈.png` |
| `phainon` | 08 | `07白厄.jpg` | `7月-自由月-白厄.jpg` | `07白厄.png` | `Vol.08_无名的英雄_白厄_12张.zip` | `白厄-诶嘿.png` |
| `anaxa` | 05 | `08那刻夏.jpg` | `8月-收获月-那刻夏.jpg` | `08那刻夏.png` | `Vol.05_殁世的学士_阿那克萨戈拉斯_12张.zip` | `那刻夏-看穿.png` |
| `aglaea` | 01 | `09阿格莱呀.jpg` | `9月-拾线月-阿格莱雅.jpg` | `09阿格莱雅.png` | `Vol.01_黄金的织者_阿格莱雅_12张.zip` | `阿格莱雅-设计.png` |
| `mydei` | 03 | `10万敌.jpg` | `10月-纷争月-万敌.jpg` | `10万敌.png` | `Vol.03_亡国的王储_迈德漠斯_11张.zip` | `万敌-狂.png` |
| `castorice` | 04 | `11遐蝶.jpg` | `11月-哀悼月-遐蝶.jpg` | `11遐蝶.png` | `Vol.04_死荫的侍女_遐蝶_14张.zip` | `遐蝶-创作.png` |
| `cipher` | 07 | `12赛飞儿.jpg` | `12月-机缘月-赛飞儿.jpg` | `12赛飞儿.png` | `Vol.07_捷足的羁客_赛法利娅_12张.zip` | `赛飞儿-得手.png` |

先完成构建，并确保 ImageMagick 的 `magick` 可执行文件在 PATH；随后显式指定与运行服务完全相同的 `dataDir`：

```bash
npm run build
npm run derive -- --assets-root "<dir>" --data-dir "<DSH_HOME>/amphoreus"
```

当前 shell 的 `DSH_HOME` 未必与服务进程一致，因此不要省略 `--data-dir`。派生物写入 `<dataDir>/assets-cache/`；运行时优先使用 WebP，缺失时回退原图。缓存可重建；若要删除，请先停止服务，删除该精确目录后再启动，使文件清单重新扫描。

也可以在 DSH 设置中进入：**翁法罗斯 → 视觉层 → 重新派生素材**。后台任务会显示进度、完成数量与最近结果。

素材版权归《崩坏：星穹铁道》官方或相应二创作者所有，仅供本地私用，请勿随插件包分发。

## 边界

- 不内嵌技能内容；`skillRoots` 只是目录引用，运行时解析，对技能目录只读。
- 不写自定义会话事件；自有数据落 storage-domain 与 `dataDir`。
- 不夹带《崩坏：星穹铁道》原图；素材经 `assetsRoot` 指向用户本地目录。

## 致谢

- 工作台画布、投影与桥接协议源自 [liangmianya/dsh-synapse](https://github.com/liangmianya/dsh-synapse) v0.4.1（MIT），本包为**改造版**，不宣称原创；改动摘要与原始许可见 [NOTICE](NOTICE)、[reference/SYNAPSE-LICENSE.txt](reference/SYNAPSE-LICENSE.txt)。
- 技能套件 [xi-kari/amphoreus-skill-suite](https://github.com/xi-kari/amphoreus-skill-suite) 由运行时从 `skillRoots` 解析，不随包分发。
- 本包基于 DeepSeek Harness 构建，非官方产品。
