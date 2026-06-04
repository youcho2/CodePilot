## CodePilot v0.55.1

> ⚠️ **本系列是一次大规模重构更新，底层改动面很大。** v0.55.1 在 v0.55.0 基础上修复了"内测版收不到正式版更新提示"等问题；如果你仍在意稳定性、不想冒险踩坑，可以继续观察后续修订版本。
>
> 在重构正式版 v0.55.0（多执行引擎 / 上下文用量可视化 / Codex 账号原生能力）基础上的修订版，主要修复了 0.55.0-preview 内测用户收不到正式版更新提示的问题。

### 修复问题

- **内测版收不到正式版更新提示** — 之前装了 0.55.0-preview 内测版的用户，应用检查更新时会把正式版误判成"和当前版本一样"，导致不弹更新提示。现在内测版能正确识别出正式版更新（修复并入 0.55.1 后，之后版本的更新检测也一并修正）。

### 重构正式版主要内容（自上一个正式版 0.54.0 起，首次升级的用户可一并了解）

- **多执行引擎，可整体切换也可按会话切换** — 同一个应用里支持 Anthropic Claude Code、CodePilot 自建 Native、OpenAI Codex 三种执行引擎；可设全局默认，也能在单个对话里临时切换。
- **上下文用量可视化** — 聊天里实时看到本次对话占用了多少上下文、还剩多少，并按来源（系统提示 / 工作区规则 / 技能 / 记忆 / 工具 / MCP）分解。
- **OpenAI Codex 账号原生能力打通** — 用 Codex 账号登录后，助理记忆、Widget 可视化、定时任务 + 到点通知、Dashboard、CLI 工具在 Codex 引擎下也能用；接不了的能力会如实标注为不支持。
- **集中修复内测反馈问题** — macOS 菜单栏图标看不清、Windows 生成命令是 bash 语法 / 安装无法选目录 / 服务商编辑窗口关闭按钮贴脸 / Codex 无法启动、OpenRouter + Opus 会话被静默换成 Sonnet、小米 MiMo 型号被改回默认、飞书桥接后台刷错误日志等。

### 已知问题

以下问题已记录、不影响主流程，正在跟进（欢迎到 GitHub Issues 反馈复现细节）：

- Windows 上服务商编辑窗口右上角关闭按钮在个别情况下点击无反应（仍在 Windows 真机验证中）。
- 个别用户反馈流式回复期间继续追加消息进队列的行为异常（核查中）。
- MCP 在设置页能看到，但运行时模型调不到，需要把 MCP 配置到项目路径才识别（排查中）。

**反馈入口**：欢迎在 [GitHub Issues](https://github.com/op7418/CodePilot/issues) 提交问题与复现步骤。

## 下载地址

### macOS
- [Apple Silicon (M1/M2/M3/M4)](https://github.com/op7418/CodePilot/releases/download/v0.55.1/CodePilot-0.55.1-arm64.dmg)
- [Intel](https://github.com/op7418/CodePilot/releases/download/v0.55.1/CodePilot-0.55.1-x64.dmg)

### Windows
- [Windows 安装包](https://github.com/op7418/CodePilot/releases/download/v0.55.1/CodePilot.Setup.0.55.1.exe)

## 安装说明

**macOS**: 下载 DMG → 拖入 Applications → 首次启动如遇安全提示，在系统设置 > 隐私与安全中点击"仍要打开"
**Windows**: 下载 exe 安装包 → 双击安装

## 系统要求

- macOS 12.0+ / Windows 10+ / Linux (glibc 2.31+)
- 需要配置 API 服务商（Anthropic / OpenRouter 等）
- 推荐安装 Claude Code CLI 以获得完整功能
