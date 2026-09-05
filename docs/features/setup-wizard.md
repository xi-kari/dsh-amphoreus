# 首次运行设置向导（素材目录 → 自检 → 一键派生）

## 做什么

页面首次进入 `ready` 状态时，如果 `effectiveConfig.setupNeeded === true`（没有生效的素材目录，或派生缓存为空）且 `prefs.setupDismissedAt` 未设置，`shell.overlay` 上弹出 `amphoreus-setup` 对话框（order -10，叠在总览之上），三步走：

1. **选择目录** —— 先调 `ctx.uiWorkspace.pickDirectory()`（本机选择器）；抛错则调 `listDirectory()` 展示极简目录浏览器（主目录 / 面包屑 / 子目录 / “使用此文件夹”）；再抛错则只剩路径文本框。文本框始终可用。
2. **自检** —— `POST /amphoreus/api/assets/check {root}`，展示必需 / 可选 / 壁纸文件夹计数与前 5 个缺失的必需文件；“保存并继续” → `PUT /amphoreus/api/assets/root`。
3. **派生** —— `model.deriveAssets(false)`，实时进度来自既有 SSE `derive-progress`；`assets.magick === null` 时给出安装提示并禁用按钮。“完成 / 暂时跳过” → `PUT /api/prefs {setupDismissedAt}`。

同一页面内向导只会自动弹出一次；用户关闭后不再自动出现（即使状态刷新）。设置页新增「素材目录」面板：来源、自检摘要、`更换素材目录…`（重新打开向导）、`重新自检`、以及仅当来源为向导时出现的 `清除向导设置`。

## 生效顺序（重要）

```
effectiveRoot = (prefs.assetsRoot ?? '').trim() || config.assetsRoot.trim()
```

- `prefs.assetsRoot`（向导写入插件自己的 storage-domain 全局 prefs）**优先于** `cordis.patch.yml` 的 `assetsRoot`；patch 值保留为底层默认值，清除向导设置后立即回退到它。
- 只要两者之一非空且派生缓存里有文件，`setupNeeded` 为 false，向导不会自动弹出。
- 平台没有运行时写回 `cordis.patch.yml` 的 API（app-boot 只读），所以选择插件 prefs 持久化，零新依赖。
- 一个 getter 闭包（`src/index.ts` `effectiveAssetsRoot`）同时喂给 `AmphoreusWebApi`（`WebApiOptions.assetsRoot`）与 `registerFirstFrame`（`FirstFrameOptions.assetsRoot`），webapi 内部所有读点（`state().assets.root`、`assetsConfigured`、`#serveWallpaper`、`#deriveRoute`、`#serveAssetPath`）都走 `#assetsRoot()`，首帧与 `/api/state` 不会不一致。未注入 getter 时 webapi 默认自己按同一规则读 prefs。

## 新增 / 变更

| 类型 | 内容 |
|---|---|
| 存储 | `GlobalSchema.prefs.assetsRoot?: string`、`prefs.setupDismissedAt?: number`（均 optional，旧数据照常解析） |
| 路由 | `POST /amphoreus/api/assets/check` body `{root?: string}` strict（≤4 KiB，root ≤4096 字）→ `200 {report}`；无 root 时检查生效目录并广播 `state-change {table:'assets', key:'check'}`；非目录 / 不存在 / 与缓存重叠 → 400；只返回状态，不返回文件内容 |
| 路由 | `PUT /amphoreus/api/assets/root` body `{root: string \| null}` strict → 校验目录（realpath + isDirectory + 拒绝 cacheDir 重叠）→ 写 `prefs.assetsRoot` → 刷新自检 → 广播 `state-change {table:'assets', key:'root'}` → `200 {assets}` |
| 路由 | `PUT /amphoreus/api/prefs` 新增 `setupDismissedAt: number \| null` |
| 状态 | `assets.rootSource: 'none' \| 'config' \| 'prefs'`、`assets.check?: AssetsCheckReport`（prepareAssets 时计算，改目录时刷新）、`effectiveConfig.setupNeeded` |
| 主机模块 | `src/host/assets-check.ts`：`checkAssets(root, {cacheDir?, largeBytes?})`、`assetsInventory()`、`summarizeAssetsCheck()`；从 `derive.ts` 再导出，随 `lib/derive.js` 发布；`scripts/check-assets.mjs` 改为调用 `lib/derive.js`（需先 build） |
| 客户端 | `setup-store.ts`（store + `shouldOfferSetup` / `watchSetupAutoOpen` / `chooseFolder` / `digestCheck` 纯函数）、`setup-wizard.tsx` + `.module.css`、`setup-panel.tsx`；model 新增 `checkAssets(root?)`、`setAssetsRoot(root \| null)`、`dismissSetup()` |
| 文案 | `setup.*` 前缀，zh / en 各 50 键 |
| 测试 | `tests/assets-check.test.ts`、`tests/webapi-assets-root.test.ts`、`tests/client-setup.test.ts` |

## 决策与已知限制

- **不自动派生**：自检通过后仍需用户点“开始派生”（409 / magick 缺失都能明确呈现）。
- `assetsConfigured` 语义不变（仍是“非空字符串”），不依赖自检结果，避免改变品牌 / 装饰 / 壁纸回退行为。
- 自检允许保存不完整的目录（缺失部分走抽象回退）；只有根本不是目录 / 与缓存重叠才拒绝。
- 向导浏览模式只读，不提供新建文件夹。
- `setupDismissedAt` 一旦写入即永久抑制自动弹出；`PUT /api/prefs {setupDismissedAt: null}` 可重置（UI 未暴露，设置面板可随时手动打开向导）。
- `scripts/check-assets.mjs` 仍不在 npm `files` 里（保持 package 白名单不变），但已不再 import `src/`。
- 首帧 `__AMPHOREUS_BOOT__` 未新增 `setupNeeded`：向导只在 `/api/state` 就绪后决策，不会闪烁。
