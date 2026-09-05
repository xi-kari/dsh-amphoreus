# 首次运行设置向导（素材目录 → 自检 → 一键派生）

## 做什么

页面首次进入 `ready` 状态时，如果 `effectiveConfig.setupNeeded === true`（没有生效的素材目录，或派生缓存为空）且 `prefs.setupDismissedAt` 未设置，`shell.overlay` 上弹出 `amphoreus-setup` 对话框（order -10；两个遮罩都是 `shell.overlay` 内的绝对定位兄弟节点，向导 `.scrim` 设 `z-index: 1` 以画在总览遮罩之上；套件更新横幅 `amphoreus-suite-notice`（z-index 5）在向导打开期间返回 `null`，不会画在 aria-modal 之上；全局 Alt+数字 / Alt+0 席位快捷键在向导打开期间挂起（`isSuspended`）；Escape 在捕获阶段处理并 `stopPropagation`，只关向导），三步走：

1. **选择目录** —— 先调 `ctx.uiWorkspace.pickDirectory()`（本机选择器）；抛错则调 `listDirectory()` 展示极简目录浏览器（主目录 / 面包屑 / 子目录 / “使用此文件夹”）；再抛错则只剩路径文本框。文本框始终可用。
2. **自检** —— `POST /amphoreus/api/assets/check {root}`，展示必需 / 可选 / 壁纸文件夹计数与前 5 个缺失的必需文件；“保存并继续” → `PUT /amphoreus/api/assets/root`（要求目录具备**素材包信号**，见下）。
3. **派生** —— `model.deriveAssets(false)`，实时进度来自既有 SSE `derive-progress`；完成判定只比较主机时间戳（点击时记下 `assets.lastDerive.at` 作基线，出现更新的 `lastDerive.at` 且 `running === false` 即完成，不用浏览器时钟）；`assets.magick === null` 时给出安装提示并禁用按钮。“完成 / 跳过，不再提示” → `PUT /api/prefs {setupDismissedAt}`（永久抑制，文案如实说明；× / Escape / 点遮罩才是临时关闭）。

同一页面内向导只会自动弹出一次；用户关闭后不再自动出现（即使状态刷新）。设置页新增「素材目录」面板（紧跟展示同一根目录并持有派生按钮的「视觉层」面板之后、语法面板之前）：来源、自检摘要、`更换素材目录…`（重新打开向导）、`重新自检`、以及仅当来源为向导时出现的 `清除向导设置`。

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
| 路由 | `POST /amphoreus/api/assets/check` body `{root?: string}` strict（≤4 KiB，root ≤4096 字）→ `200 {report}`；无 root 时检查生效目录并广播 `state-change {table:'assets', key:'check'}`；非目录 / 不存在 / 不可访问（EPERM、EACCES、EINVAL 等 → `assetsRoot is not accessible`，不再 500）/ 与缓存重叠（cacheDir 先经 `canonicalizeForContainment` 解析 junction / 尚未创建的尾段）→ 400；只返回状态，不返回文件内容 |
| 路由 | `PUT /amphoreus/api/assets/root` body `{root: string \| null}` strict → 派生进行中或另一次改根进行中 → **409**（根目录被正在读取的派生钉住，含 `null` 清除）→ 置 `#rootChanging`（校验与落盘期间到达的 `POST /api/assets/derive` 返回 409 `assetsRoot is being changed`，不会以旧根启动却记在新根名下）→ 校验目录（realpath + isDirectory + 拒绝 cacheDir 重叠）→ **素材包信号门**（`looksLikeAssetPack`：`requiredOk > 0 || optionalOk > 0 || homePopulated > 0`，否则 400 `does not look like an Amphoreus asset pack`）→ 写 `prefs.assetsRoot` → 生效目录真的变了（canonical 比较）则置 `#deriveForceNext` → 刷新自检 → 广播 `state-change {table:'assets', key:'root'}` → `200 {assets}` |
| 路由 | `PUT /amphoreus/api/prefs` 新增 `setupDismissedAt: number \| null` |
| 状态 | `assets.rootSource: 'none' \| 'config' \| 'prefs'`、`assets.check?: AssetsCheckReport`（prepareAssets 时计算，改目录时刷新）、`effectiveConfig.setupNeeded` |
| 主机模块 | `src/host/assets-check.ts`：`checkAssets(root, {cacheDir?, largeBytes?})`、`assetsInventory()`、`summarizeAssetsCheck()`、`looksLikeAssetPack(report)`、`canonicalizeForContainment(path)`（从 `derive.ts` 迁入，派生与自检共用同一套包含判定）；全部从 `derive.ts` 再导出，随 `lib/derive.js` 发布；`scripts/check-assets.mjs` 直接 import `../src/host/assets-check.ts`（Node 类型剥离加载，**无需先 build**） |
| 客户端 | `setup-store.ts`（store + `shouldOfferSetup` / `watchSetupAutoOpen` / `chooseFolder` / `digestCheck` 纯函数）、`setup-wizard.tsx` + `.module.css`、`setup-panel.tsx`；model 新增 `checkAssets(root?)`、`setAssetsRoot(root \| null)`、`dismissSetup()` |
| 文案 | `setup.*` 前缀，zh / en 各 50 键 |
| 测试 | `tests/assets-check.test.ts`（含 junction 别名 / 未创建尾段的缓存重叠、不可访问根）、`tests/webapi-assets-root.test.ts`（含无信号目录 400、派生中 409、改目录后首次派生 force 且只消耗一次、改根校验期间派生 409、SSE `root`/`check`、缓存已有文件时 `setupNeeded=false`）、`tests/client-setup.test.ts`（含 z-index、横幅在向导期间卸载、快捷键挂起、面板紧随视觉层、跳过文案、捕获阶段 Escape、主机时间戳基线、settings 通过 `bindSetupStore`/`setupStoreOf` 取 store 的钉子）、`tests/host-apply.test.ts`（对 stub ctx 执行宿主 `apply()`：降级模式与完整模式的监听注册与释放顺序） |

## 决策与已知限制

- **不自动派生**：自检通过后仍需用户点“开始派生”（409 / magick 缺失都能明确呈现）。
- `assetsConfigured` 语义不变（仍是“非空字符串”），不依赖自检结果，避免改变品牌 / 装饰 / 壁纸回退行为。
- 自检允许保存**不完整**的目录（缺失部分走抽象回退），但必须至少命中一个已知文件或一个非空壁纸文件夹（素材包信号）。原因：`/amphoreus/assets/` 以 nonce 门控直接读取该目录，任意目录都能被设为根意味着任意目录都可被读——无信号目录一律 400。根本不是目录 / 不可访问 / 与缓存重叠同样拒绝。
- **改目录后的首次派生强制重写**：派生缓存按 mtime 增量跳过，换根后旧根产物往往更新、会被误判为“已最新”，所以 `PUT /api/assets/root` 发现生效目录（canonical）真的变化时置一次性 `#deriveForceNext`，下一次 `POST /api/assets/derive` 无论 body 都按 `force: true` 执行并清掉标志；重存同一目录不触发。
- **派生进行中禁止改根**：正在运行的派生持有旧根路径，此时 `PUT /api/assets/root`（包括 `null`）返回 409，客户端等 `assets.running` 变 false 再重试。
- 设置页的 `更换素材目录…` 通过 `bindSetupStore(model, setup)` / `setupStoreOf(model)` 取到向导 store，`AmphoreusSettings` 签名保持 `({ model, t })`，`// @anchor settings-inject` 处不新增字段。
- 向导浏览模式只读，不提供新建文件夹。
- `setupDismissedAt` 一旦写入即永久抑制自动弹出（按钮文案「跳过，不再提示」）；`PUT /api/prefs {setupDismissedAt: null}` 可重置（UI 未暴露，设置面板可随时手动打开向导）。
- `scripts/check-assets.mjs` 仍不在 npm `files` 里（保持 package 白名单不变）；它直接 import `src/host/assets-check.ts`，只面向仓库使用者，不需要 `lib/`。
- 首帧 `__AMPHOREUS_BOOT__` 未新增 `setupNeeded`：向导只在 `/api/state` 就绪后决策，不会闪烁。
