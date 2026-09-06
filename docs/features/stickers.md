# 对话表情（stickers）

黄金裔在对话中插入的小图全部来自**外部技能套件**：`amphoreus/references/stickers.md`（索引）、`amphoreus/scripts/stickers.py`（选择脚本）、`amphoreus/assets/stickers/manifest.json`（登记表）及同目录的图片文件。插件只读加载、只做校验与转发，**从不转换、缩放、缓存或打包任何图片**——npm 包白名单里没有图片，删掉套件目录即什么都不剩。

## 格式规则

| 扩展名 | 服务的 `content-type` | 文件必须以此开头 |
| --- | --- | --- |
| `.webp` | `image/webp` | `RIFF????WEBP` |
| `.gif` | `image/gif` | `GIF87a` 或 `GIF89a` |
| `.png` | `image/png` | `89 50 4E 47 0D 0A 1A 0A` |

- **以 manifest 为准。** 每项 `file` 的扩展名决定格式（正则 `^[a-z0-9]+(?:-[a-z0-9]+)*\.(?:webp|gif|png)$`）。manifest 的 `version` 仍为 `1`，没有新增字段；现有只含 `.webp` 的套件无需改动。
- **扩展名与字节必须一致。** 加载目录时按扩展名对应的魔数嗅探前 12 字节；一个名为 `x.gif` 而实为 WebP 的文件会被整条剔除，既不出现在 prompt 的可服务清单中，也不会被路由送出。
- **路由不做猜测。** `GET /amphoreus/stickers/<key>.<ext>` 要求 `<ext>` 与该 key 在 manifest 里登记的扩展名完全相等；manifest 写 `cyrene.webp` 时请求 `cyrene.gif` 得到 404。大小写敏感（`.GIF` 不匹配）。
- **响应头不变。** `content-length`、`x-content-type-options: nosniff`、`cache-control: no-store`，每次请求都重新读文件并重新嗅探，套件更新即时生效。
- **GIF 会在对话中按动图播放**（浏览器原生 `<img>` 行为），插件不抽帧、不限时长；是否放动图完全由套件作者在 manifest 中列出与否决定。

## 与模型的约定

席位 system prompt 中的清单从「表情键」改为**实际服务的文件名**（`cyrene.webp`、`phainon-ehe.gif`……），URL 模板为 `![角色·表情](<http://127.0.0.1:<port>/amphoreus/stickers/<文件名>>)`。模型只需把确认后的文件名原样拼进路径，不用也不能改写扩展名；GIF 仅当 manifest 列出时才可用。其余句子（读取索引、`--format json`、只采用 `ok`/`fallback`、失败即省略）与 0.3.0 一致。

## 渲染侧

- 原生 DSH 对话：`ui-primitives` 的 Markdown 渲染器对任何绝对 `http(s)` 图片 URL 直接出 `<img>`，无需客户端改动。
- 工作台 iframe（`workbench/app.js`）：仅放行同源 `/amphoreus/stickers/<key>.(webp|gif|png)`，其余（远程、`file:`、`data:`、带 query/hash、其它扩展名）一律退化为 alt 文本。

## 测试

`tests/stickers-webapi.test.ts`：三种格式各自的 mime 与响应头、扩展名/字节不符被剔除、错扩展名 404、原有路径遍历与符号链接用例保留；设置 `AMPHOREUS_REAL_SUITE` 后另有一条用例核对真实套件的 manifest 全部 96 项可加载。`tests/workbench-stickers.test.ts`、`tests/seat-prompt.test.ts` 同步覆盖渲染白名单与 prompt 文案。
