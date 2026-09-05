# 视觉方案导出 / 导入（JSON）

把三项**视觉偏好**——杂志模式 `magazineMode`、席位视觉语法 `grammar`、壁纸位置 `customWallpapers`——打包成一个 JSON 文件下载，或从文件整体恢复。壁纸文件本体（`<dataDir>/custom-wallpapers/<heroId>/`）不在方案内。

## 文件格式（schema v1）

```json
{
  "version": 1,
  "exportedAt": 1757000000000,
  "magazineMode": "full",
  "grammar": { "blurScale": 1.4, "mascot": "static" },
  "customWallpapers": { "aglaea": { "fit": "contain", "x": 10, "y": 90 } }
}
```

- `version` 必须为字面量 `1`；其他值 → 400（未来改格式时加 `version: 2` 分支，不做隐式迁移）。
- `exportedAt` 可选，仅供人看，导入时忽略。
- 三个视觉键都可选，且**稀疏**：导出只写用户实际改过的键，不写默认值，以保证往返一致。
- 校验与 `PUT /amphoreus/api/prefs` 共用同一套 zod：`GrammarInput.strict()`、`PlacementInput.strict()`（已从 `PrefsInput` 内提为共享常量）、heroId 正则 `^[a-z0-9][a-z0-9-]{0,31}$`。未知键、越界值、`null` 均 400。
- 文件里不允许出现 `lastSeat` / `quickPhrases` / `wallpaperCursor` 等行为偏好（`.strict()` 拒绝）。

## 路由

`/amphoreus/api/prefs/visual-scheme`（精确路径，插在 `// @anchor webapi-routes`，位于 `/amphoreus/api/prefs` 之前）

| 方法 | 行为 |
| --- | --- |
| `GET` | 200，JSON 方案；响应头 `content-disposition: attachment; filename="amphoreus-visual-scheme.json"`、`cache-control: no-store`。走连接围栏（cookie/token），不需 nonce。 |
| `PUT` | `readJson(request, MAX_SCHEME_BODY_BYTES = 64 KiB)` → `VisualSchemeInput.safeParse` → 400 `{error}` / 413（由统一 catch 处理）；成功 200 `{ prefs }`。需要 `content-type: application/json` + `x-amphoreus-nonce`（继承 `#authorize`：403 / 415）。 |
| 其他 | 405，`allow: GET, PUT`（列出全部已服务方法，RFC 9110 §10.2.1）。 |

### 替换语义（REPLACE）

导入对**且仅对**三个视觉键做"先删后设"：文件里没有的键被清空（例如文件里没有 `mydei` 的位置 → 该席位位置回到默认；没有 `grammar` → 语法全部回默认）。`lastSeat`、`quickPhrases`、`quickPhrasesInitialized`、`wallpaperCursor` 及任何其他偏好原样保留。写入通过 `updateAmphoreusGlobal` 串行化。

这与 `PUT /amphoreus/api/prefs` 的 MERGE/patch 语义刻意不同：方案文件的目的是"恢复到某个视觉快照"，合并会让文件外的席位残留。

## 客户端

- `AmphoreusClientModel.exportVisualScheme()`：先 `fetch GET`（credentials include、no-store）探测，非 2xx 抛 HTTP 错误；成功后把**同源路由 URL** 交给临时 `<a download>` 点击，由响应头 `content-disposition: attachment` 决定文件名。与平台 `session-log-export` 的 `downloadUrl` 同一做法：不经 `blob()` / `createObjectURL`，因此没有"点击后立刻 revoke 导致某些浏览器下载为空"的竞态。不追加到 `document.body`。
- `AmphoreusClientModel.importVisualScheme(file: File)`：`file.size > 64 KiB` → 直接抛"视觉方案文件过大（上限 64 KiB）"（不读、不上传，避免超大文件触发服务端半途断流变成泛化的网络错误）→ `file.text()` → `JSON.parse`（失败抛"视觉方案文件不是有效 JSON"，不发请求）→ PUT；400 → "视觉方案文件无效：<detail>"，413（服务端兜底）→ 同一"过大"文案，其余非 2xx → HTTP 状态；成功后 `refresh()`，主题层 / 语法层 / 壁纸订阅自动重绘。
- 面板 `src/client/scheme-panel.tsx`：`<section aria-labelledby="amphoreus-scheme">`，标题 + 提示（含"不含壁纸文件本体"）+ 两个 `.secondaryButton`（导出视觉方案 / 导入视觉方案）+ 隐藏 `<input type="file" accept="application/json,.json">`（复用 `.wpFile`）+ 成功行（`role="status"`）。错误由 settings.tsx 页面级 `actionError` 行显示。成功行的状态机抽成纯函数 `src/client/scheme-status.ts`（`reduceSchemeStatus`）：方案动作无错完成 → 显示；完成时 `errored` → 不显示；之后任何设置动作开始（`acting`）或出现错误 → 立即清掉，不会与页面级错误行并存；后台 SSE `refresh()` 不算动作，不会抹掉成功行。
- 挂载点：`settings.tsx` 的 `{/* @anchor settings-panels */}` 之后（WallpaperPanel 与工作台段之间）。`SettingsAction` 联合类型尾部追加 `'scheme-export' | 'scheme-import'`，与 `run()` 动作锁共用。
- 组件不接触 ctx；只用现有 CSS Module 类，无新样式。

## 本地化

前缀 `settings.scheme*`，zh / en 各 8 键：`schemeHeading`、`schemeHint`、`schemeExport`、`schemeExporting`、`schemeImport`、`schemeImporting`、`schemeExported`、`schemeImported`。

## 测试

- `tests/visual-scheme.test.ts`：GET 只含视觉键 + attachment 头；空存储只有 `version`/`exportedAt`；PUT 全量替换（预置文件外席位 `mydei` 被删）、最小文件清空三键、导出→导入往返一致、11 种非法体 400 且存储不变、65 KiB → 413、缺 nonce → 403、错 content-type → 415、其他偏好保留、存储仍通过 `GlobalSchema`。
- `tests/client-scheme-panel.test.ts`：locale 双语 parity、面板源码约束（无 ctx / 无 fetch / 隐藏 file input）、settings 挂载位置与联合类型尾部、模型方法的 fetch 形状；用 stub fetch / window / document 实测 `importVisualScheme` 错误映射（含 64 KiB 客户端预检不触网）、`exportVisualScheme` 探测失败不触发下载 / 成功只点击同源 URL 且绝不建 object URL；`reduceSchemeStatus` 状态机全路径。

## 决策与已知限制

- **不打包壁纸二进制**：文件无大小上限且 `src/host/zip.ts` 只读；方案只带位置元数据。给未上传壁纸的席位导入位置是无害的（有文件后即生效）。
- 导出取**存储值**而非 effective 值（不混入 `GRAMMAR_DEFAULTS` / 配置回退），保证往返精确、也避免把配置文件里的 `magazineMode` 固化进方案。
- 导入不触发额外 SSE 事件：`domain.global.set` 已由 `domain/changed` 监听发布，客户端 `refresh()` 也已同步。
- 64 KiB 上限远超 13 席全字段的实际体积（约 2 KB），是给 envelope 与未来字段的余量。
- 未做旧版本迁移；`version` ≠ 1 直接 400。
- 400 分支的 zod 详情原样（英文）接在中文前缀后，未本地化。
- 共享热点文件中两处非锚点改动，集成时预期与兄弟分支有轻微文本冲突：`settings.tsx` 第 5 行的 `import { SchemePanel }`（import 区无锚点，挂载面板不可避免）；`webapi.ts` 中 `HERO_ID` + `PlacementInput` 提到 `PrefsInput` 之上（`PlacementInput` 提升是规格允许的唯一 PrefsInput 改动，heroId 正则一并提升以保证两套 schema 同步）。
