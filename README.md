# dsh-amphoreus

翁法罗斯 × DSH：黄金裔席位工作区、技能无损桥接与画布工作台。基于 DeepSeek Harness（dsh-v0.1.2-alpha.4）构建，非官方产品。

状态：骨架阶段（2026-09-03）。建设者请先读 [HANDOFF.md](HANDOFF.md)。

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

## 边界

- 不内嵌技能内容；`skillRoots` 只是目录引用，运行时解析，对技能目录只读。
- 不写自定义会话事件；自有数据落 storage-domain 与 `dataDir`。
- 不夹带《崩坏：星穹铁道》原图；素材经 `assetsRoot` 指向用户本地目录。
- 工作台源自 liangmianya/dsh-synapse v0.4.1（MIT），见 [NOTICE](NOTICE)。
