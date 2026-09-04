# BUILD LOG

> 任务书：`../设计文档/07_建设者任务书（Codex一口气版）.md`。验收记录按 TA1–TF12 顺序追加。

## TA1 开仓：git init、清杂物、基线提交 — 2026-09-04 15:37
- commit: 76cf15d
- 验收：
  - `git -C "$PKG" log --oneline | wc -l` → `1` PASS（pipeline exit: `0 0`）
  - `git -C "$PKG" status --porcelain | wc -l` → `0` PASS（pipeline exit: `0 0`）
  - `git -C "$PKG" ls-files | grep -c "^lib/\|^node_modules/"` → `0` PASS（pipeline exit: `0 1`；grep 以 1 表示零匹配）
  - `git -C "$PKG" ls-files reference | wc -l` → `3` PASS（pipeline exit: `0 0`）
  - `test ! -f "$PKG/.pack-dry-run.json"` → `无标准输出` PASS（exit: `0`）
- 人工断言：✓ 基线提交未包含 `lib/` 或 `node_modules/`；✓ `reference/` 三个证据文件已跟踪；✓ `.pack-dry-run.json` 已物理删除。
- 偏离与理由：验收依赖首次提交已经存在，因此 TA1 的验收记录在提交后写入，并随 TA2 提交入库；TA1 自身仍只有一次基线提交。
- 遗留：无
## TA2 G17：配置键 `workbench.host` — 2026-09-04 15:38
- commit: PENDING-TA2
- 验收：
  - `grep -n "host: z.union(\['iframe', 'native'\]).default('iframe')" "$PKG/src/host/config.ts" | wc -l` → `1` PASS（pipeline exit: `0 0`）
  - `npm run typecheck` → `> dsh-amphoreus@0.1.0 typecheck`；`node node_modules/typescript/bin/tsc -p tsconfig.json --noEmit` PASS（exit: `0`）
  - `node --test tests/webapi-firstframe.test.ts` → `tests 4; pass 4; fail 0; duration_ms 317.5616` PASS（exit: `0`）
- 人工断言：✓ 全仓 `workbench: {` 仅有配置接口与测试夹具两处，二者都已补 `host`；✓ 未实现 `native` UI；✓ `cordis.patch.yml` 未改。
- 偏离与理由：首次执行 `npm run typecheck` 因调用环境 PATH 未含 Node 而输出 `'node' is not recognized`（exit 1）；按总纲 §0.4/AGENTS 构建环境将 PATH 收敛后，以同一命令复跑通过。提交短 SHA 在提交完成后回填，并随下一任务提交入库，以避免自引用哈希悖论。
- 遗留：无
