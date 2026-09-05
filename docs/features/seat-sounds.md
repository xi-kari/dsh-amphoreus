# 席位音效（seat-sounds）

用户自备的每席音效：**入席问候**（切换到某位黄金裔的席位时）与**发送提示**（用户在输入框发出消息时）。插件**不附带任何音频**——所有文件都是用户在设置面板上传、只存放于本机数据目录 `<dataDir>/seat-sounds/<heroId>/<slot>.<ext>`，与自定义壁纸同一条"永不打包"的姿态。

## 做了什么

| 层 | 新增 | 说明 |
| --- | --- | --- |
| 宿主 | `src/host/seat-sounds.ts` `SeatSoundStore` | 与 `custom-wallpapers.ts` 平行的兄弟模块（未重构原文件）。`scan / list / get / urlOf / put / remove / serve`；一席两槽 `greeting`/`send`，上传即替换。 |
| 路由 | `PUT|DELETE /amphoreus/api/seat-sound/<heroId>/<slot>` | PUT 二进制正文，`content-type` 为音频 MIME；或 **空 / `application/octet-stream`** + `x-amphoreus-ext: mp3…`（Windows 上 .ogg/.flac 的 `File.type` 常为空）。其它已声明类型（如 `image/png`）即使带扩展名提示也 415。需 `x-amphoreus-nonce`。415 未知类型 / 413 超限 / 400 非法 hero 或槽位 / 503 无 dataDir。 |
| 路由 | `GET|HEAD /amphoreus/seat-sound/<heroId>/<file>` | Range（206/416）、`cache-control: private, max-age=31536000, immutable`、`nosniff`、realpath 包含校验；URL 带 `?v=<mtime>`。 |
| SSE | `state-change` table `seat-sounds` | put/remove 后推送，客户端模型按现有 120 ms 去抖刷新。 |
| 状态 | `AmphoreusState.seatSounds: SeatSoundInfo[]` | `{heroId, slot, url, mime, bytes, prefs}`，prefs 已合并默认值。 |
| 偏好 | `prefs.seatSounds?: { master?, seats?: Record<heroId, { greeting?: {enabled?, volume?}, send?: 同 }> }` | 全部 `.optional()`，旧全局仍可解析。`PUT /amphoreus/api/prefs` `{ seatSounds: patch }` 部分补丁，seat 条目为 `null` 时删除。删除文件时同步清掉该槽偏好。 |
| 共享 | `SEAT_SOUND_DEFAULTS = { enabled: true, volume: 0.6 }`、`SEAT_SOUND_MASTER_DEFAULT = true`、`SEAT_SOUND_MAX_BYTES = 20 MiB` | `src/shared/api.ts` |
| 客户端 | `src/client/seat-sounds.ts` | `createSeatSoundPlayer({audioFactory?, doc?, armed?})`：`play()` 在首个用户手势前静默；`greet()` 未解锁时暂存（后者覆盖前者），首个 `pointerdown/keydown` 后**只回放一次**；`play()` 的 NotAllowedError 一律吞掉。`installSeatSounds({seat, model, player})` 订阅 `createSeatWatch`，跳过安装时的初值与 `null`（离席 / 全局昔涟席），按 master + 槽位 enabled/volume 播放问候。 |
| 客户端 | `src/client/send-sound.tsx` | 空渲染哨兵，注册为 `conversation.input.dock` 的第二条目（id `amphoreus-send-sound`，order 31，与 `amphoreus-handoff` 共用同一个 `ctx.slots.inject` 回调，装配测试的调用清单不变）。 |
| 模型 | `uploadSeatSound / removeSeatSound / setSeatSoundPrefs` | `src/client/state.ts` |
| 设置 | `src/client/sound-panel.tsx` + `sound-panel.module.css` | 总开关；每席一行、每槽：上传/更换/移除、启用、音量滑杆（200 ms 去抖）、试听。昔涟只显示"发送提示"。`SettingsAction` 追加 `'sound'`。文案前缀 `settings.sound*`（zh/en 各 14 键）。 |

## 支持格式

`audio/mpeg` mp3 · `audio/ogg` ogg · `audio/wav`/`audio/x-wav` wav · `audio/webm` webm · `audio/mp4` m4a · `audio/aac` aac · `audio/flac` flac。单文件上限 20 MiB（`SEAT_SOUND_MAX_BYTES`；测试可经 `WebApiOptions.seatSoundMaxBytes` 缩小）。

超限处理（保证客户端一定收到 413，而不是连接被重置后的 `Failed to fetch`）：

- 浏览器上传 `File` 总带 `content-length`：声明长度超限时**不碰磁盘**（不建目录、不开临时文件），直接读空正文并回 413。
- 分块 / 未声明长度的正文：写到上限后停止落盘，其余字节只读不存，读完再回 413——这样响应走的是有序连接。代价是超大正文会被完整读一遍（本机回环下可忽略）。
- 任一失败路径（413/415/写错误）都删除自己的临时文件，并在 hero 目录变空时把目录也删掉，与 `remove()` 的行为一致。

## 决策

- **发送检测不走输入机 phase。** 研究阶段设想用 `InputState.phase` 离开 `'plain'`；读平台源码后发现普通发送走 `beginDetached()`，phase 同步回到 `'plain'` 且从未离开（`input/machine.ts:122-128`），只有斜杠命令才进入 `adjudicating/submitting`。改用 `useSession(s => s.pendingSubmissions)`：输入框的默认 sink 总会先 `session.beginSubmission()` 登记一个 requestId（`ui-conversation/service.ts:221`），而插件自行发起的 `session.prompt()`（移交接受、分派、会议）不会（`sessions/session.ts:225-262`），因此**用户发送响、插件发送不响**，与决策 3 的意图一致。哨兵挂载时已存在的 id 不回放。
- **昔涟席无问候。** 全局席使 `body[data-amphoreus-seat]` 为空、seat watch 给出 `null`，没有可触发的时刻；面板对昔涟只提供发送槽，宿主仍接受 `cyrene/greeting` 上传但永不播放。
- **首帧不问候。** 页面恢复上次席位时 `installSeatSounds` 记住初值不播；之后的席位切换若发生在任何手势之前，问候会被暂存到首个手势时回放一次（浏览器自动播放策略）。
- **音频元素不入 DOM。** `new Audio(url)` 游离元素即可播放，无需 `appendChild`。
- **写流错误只走 Promise 拒绝。** `put()` 从创建 WriteStream 起就消费其 `'error'`（EEXIST / ENOENT / EACCES / ENOSPC…），任何失败都映射为 500/413/415，而不是未捕获的 `'error'` 事件把宿主进程打死。临时文件名带随机后缀（`pid-time-hex`），同一毫秒内的两次上传不会撞名；即使撞名（测试用固定 token 复现）输家也只是 EEXIST 拒绝，且**不会误删赢家的临时文件**。 同一 hero 的 put/remove 经每席队列串行执行：并发上传同一槽位不会在 Windows 上触发 rename-over 的 EPERM，put 与 remove 竞争时也各自完整落地。
- **发送哨兵的判定是纯函数。** `nextSendDecision(seen, ids)`：首次观察只记不响；之后每批含新 requestId 才响一次；消失又出现的 id 不算新；超过 64 个记忆时收缩为当前在途 id（收缩后同一批不会回放）。组件 effect 只是它的一层壳，单测直接打这个函数。
- **面板偏好写入不丢。** 设置页的动作锁（`run`）在忙时会直接丢弃调用；音量去抖 / 启用 / 总开关的写入改为在 `busy` 期间合并进一个待发补丁（`mergeSeatSoundPatch`，按叶合并、后写覆盖），`busy` 释放后一次性发出。

## 已知限制

- 依赖 `pendingSubmissions` 的哨兵位于会话作用域槽位，只覆盖当前会话；子代理会话（`subagent !== null`）走 `session.prompt` 直发不登记 echo，不响。
- 无 `dataDir` 时（测试配置 `dataDir: ''` 除外——宿主 index 总会给出路径）路由返回 503，面板上传报错。
- 音量是线性 `HTMLMediaElement.volume`，无淡入淡出。
