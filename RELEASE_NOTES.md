## CodePilot v0.56.3

> 新增 ClinePass 与 OpenCode Go 两类订阅服务商接入，并彻底修复发送后输入框文本残留、服务商弹窗关闭按钮等体验问题。推荐升级。

### 新增功能

- **接入 ClinePass 订阅** — 在「添加服务 > Coding Plan」里新增 ClinePass（月付订阅，提供一组开源编程模型）。填一个 API Key 即可在 CodePilot / Codex 运行时使用，模型由订阅白名单提供。
- **接入 OpenCode Go 订阅** — 新增 OpenCode Zen「Go」订阅。按官方协议拆为两个渠道：OpenAI 兼容（GLM / Kimi / DeepSeek / MiMo）与 Anthropic Messages（MiniMax / Qwen）。两者共用同一订阅 Key，模型由套餐白名单提供，不做在线全量刷新，避免把套餐外或错协议的模型拉进来。其中 Anthropic 渠道在 Claude Code 运行时为实验性接入。

### 修复问题

- **发送后输入框彻底清空** — 进一步修复发送消息后输入框文本残留的问题。这次覆盖了之前仍会残留的几种情况：已在对话页时跳转到带预填内容的新对话、新对话的第一条普通消息、以及第一条消息带技能 / 命令徽章时；现在发送即清，且不会清掉你在等待回复期间已经开始输入的下一条。
- **服务商弹窗关闭按钮** — 修复「添加服务」全屏弹窗右上角的关闭按钮在 macOS 上点不动（被窗口拖拽区吞掉点击）、在 Windows 上与系统最小化 / 关闭按钮挤在一起打架的问题。

### 优化改进

- **服务商品牌图标** — 升级图标库并补全品牌图标（含 Cline / OpenCode），同时修正部分服务商卡片错误显示成无关品牌 logo 的问题。

### 已知问题

以下问题已记录、不影响主流程，仍在跟进（欢迎到 GitHub Issues 反馈复现细节）：

- OpenCode Go 的 Anthropic 渠道（MiniMax / Qwen）在 Claude Code 运行时为实验性接入，流式与工具调用的真机验证仍在补充。
- MCP 在设置页能看到，但运行时模型调不到，需要把 MCP 配置到项目路径才识别（排查中）。

**反馈入口**：欢迎在 [GitHub Issues](https://github.com/op7418/CodePilot/issues) 提交问题与复现步骤。

## 下载地址

### macOS
- [Apple Silicon (M1/M2/M3/M4)](https://github.com/op7418/CodePilot/releases/download/v0.56.3/CodePilot-0.56.3-arm64.dmg)
- [Intel](https://github.com/op7418/CodePilot/releases/download/v0.56.3/CodePilot-0.56.3-x64.dmg)

### Windows
- [Windows 安装包](https://github.com/op7418/CodePilot/releases/download/v0.56.3/CodePilot.Setup.0.56.3.exe)

## 安装说明

**macOS**: 下载 DMG → 拖入 Applications → 首次启动如遇安全提示，在系统设置 > 隐私与安全中点击"仍要打开"
**Windows**: 下载 exe 安装包 → 双击安装

## 系统要求

- macOS 12.0+ / Windows 10+ / Linux (glibc 2.31+)
- 需要配置 API 服务商（Anthropic / OpenRouter 等）
- 推荐安装 Claude Code CLI 以获得完整功能
