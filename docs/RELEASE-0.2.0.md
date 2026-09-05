# dsh-amphoreus 0.2.0

翁法罗斯 × DSH：为 amphoreus-skill-suite 的 13 张黄金裔技能卡各建一席专属工作区，并用一张总览画布组织会话、派发任务与显式移交。

`dsh-amphoreus` 是基于 DeepSeek Harness 构建的第三方非官方插件。本版本完成了运行时技能套件桥接、十三席工作区、首轮自动注入、逐席视觉、外置素材派生、总览工作台、派发、移交、站位轨和台账，并通过本地源码形态、独立 tarball profile 与干净 npm-ci 环境验证。

## 安装

本版本只承诺兼容 **`dsh-v0.1.2-alpha.4`**。运行 DSH 本体时请钉定该版本：

```bash
npx @deepseek-ai/dsh@0.1.2-alpha.4 web
```

安装插件时，请显式使用 `alpha` 标签或精确版本，不要依赖 npm `latest`。

### 安装 alpha

```bash
dsh plugin --profile web add dsh-amphoreus@alpha
```

### 安装精确版本

```bash
dsh plugin --profile web add dsh-amphoreus@0.2.0
```

插件安装成功后，launcher 会把 `dsh-amphoreus` reconcile 进 profile 的 `dsh.profile.bundles`。Bundle 列表只在 profile 启动时组合，因此安装、升级或移除后都必须停止当前 `dsh web` 进程并重新启动：

```bash
dsh web
```

`cordis.patch.yml` 的 live reload 不能代替这次重启。

## 本次发布

- 在运行时从 `skillRoots` 读取 amphoreus-skill-suite，不把 `SKILL.md`、`persona.md`、`common.md` 或 `relations.md` 复制进插件。
- 自动建立 13 席黄金裔工作区；席内新会话先写入席位绑定，再创建会话，并在首轮一次性注入对应技能卡。
- 保留 DSH 官方目录工作区，同时增加独立的黄金裔承办席位维度。
- 提供昔涟全局视觉层、13 席 light/dark token、共享 SVG 纹样和 `light`／`full` 两档杂志版式。
- 提供可重建的本地 WebP 派生缓存；原图只从用户配置的 `assetsRoot` 读取。
- iframe 工作台只接收浏览器侧投影的会话正文；宿主只保存 seq 结构，不建立第二份正文存储。
- 全体会议提供显式派发入口、派发泳道和运行时流水线站位轨。
- 模型产生符合技能套件合同的移交行后，界面显示移交坞、画布关系和“接通中”尾页；只有用户明确点击后才接受和切换，移交内容不会自动发送。
- 台账跟随画布当前线程，显示回执、缺席、知会、移交和派发记录，并提供席位记忆便签与“插入到输入框”操作。
- 所有插件写请求使用进程级 nonce 与 Host 门；宿主重启后需刷新已打开的工作台页面。
- 发布物通过宿主外部依赖纯度、浏览器 `PLATFORM_MODULES`、ModuleLoader 包装、tarball 白名单和 2 MB 解包体积门。

## 素材

本仓库与 npm 包不包含、下载或重新分发《崩坏：星穹铁道》原图。用户需要把自己持有的壁纸、英雄纪、如我所书卡牌、日历、贴纸与可选杂志分册放到自行配置的 `assetsRoot`。

完整目录、文件名与数量见 README 的“素材包”一节。发布前自检基线为：

- 必需文件：`58/58`
- 可选文件：`32/32`
- 大于 8 MiB、建议预先缩放的必需图片：`5`

缺少素材不会让插件伪造角色内容；界面会保留席位配色、纹样和确定性的抽象视觉回退。

## 技能套件

技能套件不随本插件发布。请单独获取：

```bash
git clone https://github.com/xi-kari/amphoreus-skill-suite.git
```

插件会在运行时从 `skillRoots` 解析席位、角色显示名、职责、分派表、流水线、回执与移交格式。更新套件后，可以等待目录监听重新解析，也可以在 DSH 设置的“翁法罗斯”区域点击“重新解析套件”。

绑定键始终是 skill name；套件文件缺失或格式漂移时，插件显式降级，不静默沿用旧解析结果。

## 已知限制与发布提交冻结状态

以下 A–F 六条保持 HANDOFF §8 在本次发布提交冻结时的遗留原文：

1. **A · 整备与卫生**：无。
2. **B · 投影与桥接**：无代码遗留；30+ 轮字面场景的等价容量验收理由保留在 `BUILD-LOG.md`。
3. **C · 席位语义与专属空间**：C 章当时交给 E 章的派发、移交、站位轨、接通尾页与台账已由 TE1–TE10 完成；当前无。
4. **D · 十三套视觉与杂志语法**：CSS 原色 fallback 按 TD12 条件裁决保留；固定蓝已由后续 C/TC9 清零；稳定 URL 在强制重派生时的 cache-bust 仍是后续版本化设计项。
5. **E · 总空间派发与流水线**：无。
6. **F · 发布与验收**：TF12 的远程仓创建、双系统 CI、`v0.2.0` tag、npm `alpha` 发布、npm 安装复测、GitHub SHA 安装抽测与 GitHub Release。

兼容范围仅为 `dsh-v0.1.2-alpha.4`。

此外，发布态使用时需要注意：

- 页面加载时已经创建的首个会话通常不受 `workbench.defaultView` 影响。
- “记住 Tab”在插件热重载或会话回到空白态时可能短暂记为“对话”；下一次进入工作台后会自愈。
- 派生素材使用稳定 `.webp` URL 与一天私有缓存；强制重新派生后，已经打开的浏览器页可能需要刷新才能立即看见新图。
- DSH alpha.4 的空白会话不渲染会话视图；从对话 Tab 打开总览再进入“全体会议”或使用“去派发”时，总空间画布会保留在门户覆盖层内承载，不创建空白宿主会话。
- 首帧 nonce 每个进程随机生成；宿主重启后需要刷新工作台。

## 验证摘要

发布提交冻结前已完成：

- 全量测试：`327` 项，其中 `326` 通过、`1` 项因未设置真实套件环境变量而按预期跳过、`0` 失败。
- 构建产物：`lib/index.js`、`lib/client.js`、`lib/derive.js` 与对应 sourcemap、类型声明均完整。
- 发布物验证：`verify-dist: OK 377 checks`。
- tarball：`70` 个文件，解包体积小于 `2 MB`，不含游戏图片、技能正文、源码、测试、历史审计或本地配置。
- 外置素材检查：必需 `58/58`、可选 `32/32`。
- tarball 测试 profile：profile 依赖、bundle 与 3090 进程独立，storage/session 仍共享主 DSH_HOME；bundle reconcile、宿主 peer fallback、首帧注入、`L0 13 true`、浏览器 bundle、工作台静态资源与真实首轮会话均通过，测试会话已归档且 bindings 回到基线。
- 干净 npm-ci 环境：发布态 `dsh-client-web` 只有 `lib/types/platform.d.ts`、没有源码目录时，测试、类型检查、构建和发布物验证仍通过。
- 端到端发布门：A–E 共 `110` 条章级断言、`X-1` 至 `X-14` 跨章门和 `12` 步浏览器走查全部通过。

远程 GitHub CI、npm registry 发布、npm 形态重装、GitHub SHA 安装与 GitHub Release 的实际结果将在发布执行完成后写回 HANDOFF。

## 致谢

工作台画布、投影与桥接协议源自 [liangmianya/dsh-synapse](https://github.com/liangmianya/dsh-synapse) v0.4.1，依照 MIT License 使用和改造。`dsh-amphoreus` 保留原始版权与许可说明，并在 NOTICE 中记录移植范围、正文边界、主题适配、杂志版式与原创 mark 替换。

黄金裔方法与角色技能由 [xi-kari/amphoreus-skill-suite](https://github.com/xi-kari/amphoreus-skill-suite) 提供；插件只在运行时读取用户配置的套件，不把技能内容纳入 npm 包。

## 声明与许可

本项目采用 MIT License。该许可适用于本项目代码及依照原许可改造的 dsh-synapse 代码，不授予任何游戏美术或角色素材的再分发权。

本项目基于 DeepSeek Harness 构建，不是 DeepSeek 官方产品，与深度求索公司无关联、无背书。

《崩坏：星穹铁道》相关名称与美术归其权利人所有；本仓库和 npm 包不分发相关图像，也不提供原图下载链接。
