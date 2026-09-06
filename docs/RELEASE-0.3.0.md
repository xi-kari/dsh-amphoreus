# dsh-amphoreus 0.3.0

七项新功能与一轮席位视觉重做，继续适配 δ-me13 skill 套件并保留 DSH 0.1.2-alpha.4 的运行兼容性。

## 更新

- 首次运行向导：没有生效素材目录或派生缓存为空时，在页面上选择素材文件夹、服务端自检并一键派生；保存的目录写入 `prefs.assetsRoot`，优先于 `cordis.patch.yml` 的 `assetsRoot`。新增 `POST /amphoreus/api/assets/check` 与 `PUT /amphoreus/api/assets/root`，无素材包信号的目录一律 400，派生进行中改根返回 409。
- 席位预设：每席可绑定新会话默认的智能体预设、模型（含推理强度）与权限档位，`PUT /amphoreus/api/seats/<skill>/preset`；权限只对全新会话生效，模型写回部署默认值后自动恢复。
- 席位记忆：开拓者手记与角色回合末的「留言：」行按席存入插件存储域，下次开席时以明确标注为非事实层的上下文注入席位提示词；新增 `/remember` 命令、`/amphoreus/api/memory/<skill>/notes|settings` 路由、配置块 `memory`（`inject`/`autoNote`/`injectLimit`/`command`）与设置面板；删除的留言留墓碑，重启重放不会复活。
- 视觉方案导出／导入：`GET|PUT /amphoreus/api/prefs/visual-scheme` 以 JSON 导出、整体替换语法与壁纸位置，其他偏好不动；64 KiB 上限，`version` 只接受 `1`。
- 席位切换：`Alt+1`…`Alt+9` 按侧栏顺序进席，`Alt+0` 开关总览，`/seat <名字>` 输入框命令；只认主键盘区数字，向导打开期间挂起。
- 套件更新提示：技能套件改动、降级或目录缺失时在页面顶部显示真实状态横幅并可重新解析；只有启动时技能根就不存在才需要重启。
- 席位音效：用户自备的入席问候与发送提示音，`PUT|DELETE /amphoreus/api/seat-sound/<heroId>/<slot>`、`GET /amphoreus/seat-sound/…`，单文件 20 MiB，插件不附带任何音频。
- 视觉：13 席视觉语法层（圆角、玻璃、纹样、排版、吉祥物、环境动效）、席位主页壁纸（横版优先、可钉住）、δ-me13 品牌与问候、逐席代码配色与气泡、自定义席位壁纸（图片／视频）、门户材质样卡、白厄拱形侧栏、hover 页码、控制台重排、目录工作区移除入口、与 DSH-better-sidebar 共存；修正 clip-path 裁掉设置弹窗的问题。
- 对话表情由 `/amphoreus/stickers/<key>.webp` 从当前有效技能根只读提供；技能正文与图片仍不进包。
- 基础：tarball 不再携带 sourcemap；`sync.source` 默认改为 `github:xi-kari/delta-me13-skill`；新增平台类型 devDependencies；共享热点文件以 `// @anchor <name>` 标注扩展点。

## 安装

```bash
dsh plugin --profile web add dsh-amphoreus@0.3.0
```

升级后重启 DSH Web，并刷新页面。首次进入若尚未配置素材目录，会直接弹出向导；已有 `assetsRoot` 的用户不受影响。外部套件仍由 `skillRoots` 指向的 `skills/` 目录解析。

## 验证

- 插件全量回归：595 项测试、595 通过、0 失败、0 跳过（`AMPHOREUS_REAL_SUITE` 指向 δ-me13 skill v1.7.0 `0594030` 的 `skills/`）。
- 发布产物验证：`npm run verify:dist` OK。
- 七个功能分支各经两轮对抗评审与修复后按并集策略合并；合并后审计 20 条发现、6 条确认并已修复（`7fd2ed8`）。
- npm 发布：`dsh-amphoreus@0.3.0`，gitHead = `5f3c468e8813d8e5c279452487675d874329d976`，dist-tag `alpha`（`latest` 随后指向 0.3.0）；108 文件、unpacked 1,371,865 B、packed 352,433 B，shasum `a58576714b12fbd836a8cedc461047081bfb4624`；本地 `npm pack` 与 registry tarball sha256 一致（`d89b233d83dd330f676a…`）。
- Git tag：`v0.3.0` → `5f3c468e8813d8e5c279452487675d874329d976`；release workflow run `34002755334` success（gitHead 与 tag 一致，跳过重复发布）；CI run `34000458048` ubuntu/windows 双绿。

## 使用边界

席位记忆只存于插件存储域、不写会话日志，注入的内容明确标注为非事实层。席位音效、自定义壁纸与素材原图均为用户自备文件，插件与 npm 包不附带。`Alt+数字` 在总览或工作台 iframe 聚焦时不生效；席位超过 9 个时只有前 9 席有数字键。视觉方案文件不打包壁纸二进制。

MIT License。基于 DeepSeek Harness 的非官方插件；工作台继承 dsh-synapse 的 MIT 实现与署名。
