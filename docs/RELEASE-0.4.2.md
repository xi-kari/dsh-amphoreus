# dsh-amphoreus 0.4.2

兼容 δ-me13 skill v1.8.0，宿主基线为 DeepSeek Harness 0.1.6-alpha.2。角色卡、工作方法内核、关系资料和表情继续从外部 `skillRoots` 只读加载，不进入 npm 包。

发布前通过当前 npm 的实际 manifest 准备逻辑核对来源提交。`gitHead` 必须存在并等于发布目录的 HEAD；无法识别来源时停止发布，使用普通 Git clone 可避免 worktree 指针导致的来源缺失。安装与运行接口保持兼容。

## 升级

```bash
dsh plugin --profile web add dsh-amphoreus@0.4.2
```

另将外部技能套件完整更新到 [δ-me13 skill v1.8.0](https://github.com/xi-kari/delta-me13-skill/releases/tag/v1.8.0)，重启 DSH 并重新解析套件，核对目录和指纹后建立新席位会话。已有会话首轮注入的旧卡正文不会被追溯替换。

## 验证范围

固定 v1.8.0 套件的本地发布检查通过 631 项测试，无失败、无跳过；类型检查、构建及 587 项产物检查通过。

真实套件验证覆盖 14 个调用入口的正文保真、13 席的外部资料可读取性、新版工作方法内核、缺卡保护与缺材料移交。发布来源检查另以普通 Git 仓库和 worktree 做正负对照。

插件读取、解析、注入前内容和安装包验证不代替真实模型行为评测；上游 65 题结果不计作本次 DSH 模型实测。
