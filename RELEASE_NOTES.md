## CodePilot v0.61.0

> 新增 Claude Opus 5 / Sonnet 5，并让 Grok 4.5 能作为指定模型的 Sub-agent 使用；同时修复模型回复后显示名称漂移和推理强度参数不兼容的问题。

### 新增功能

- **Claude Opus 5** — Claude Code、CodePilot Runtime 和 Codex Runtime 的 Anthropic 渠道现可选择 Opus 5，支持 1M 上下文、自适应思考和 Low / Medium / High / XHigh / Max 推理强度。旧的 `Opus` 入口仍固定为 Opus 4.7，不会让已有会话静默升级。
- **Claude Sonnet 5** — 新增显式 Sonnet 5 入口，支持 1M 上下文和完整推理强度选择；旧的 `Sonnet` 入口继续固定为 Sonnet 4.6。
- **Grok 4.5 Sub-agent** — 已通过 xAI OAuth 登录的用户，现在可以在 CodePilot Runtime 和 Codex Runtime 中把 Grok 4.5 指定为 Sub-agent 模型，模型选择器与 Sub-agent 路由使用同一份可用性目录。

### 修复问题

- **修复 Opus 5 回复后显示成 Default** — Claude Code 返回动态模型目录后，不会再删除当前会话选择的显式模型。Opus 5 完成回复、切换会话或刷新后仍会正确显示为 Opus 5。
- **修复 Opus 5 关闭思考时的请求错误** — 关闭思考后选择 XHigh / Max 会自动使用该组合允许的最高档 High，并明确提示；Auto 会发送兼容值，但不会谎称用户主动选择了 High。
- **修复 Sonnet 4.6 非法 XHigh 参数** — Sonnet 4.6 不支持的 XHigh 不会再被发送到 Anthropic；界面会如实说明可用档位，避免上游返回 400。
- **修复第三方 Anthropic 代理的误导提示** — 代理未发送推理强度时，提示会显示用户原本选择的档位，而不是系统调整后的内部值；相关提示现已支持中英文。
- **修复 Grok 主会话可用但 Sub-agent 列表缺失** — OAuth 虚拟服务商不再只出现在主模型选择器，Sub-agent 路由也会按 Runtime 兼容性正确列出。

### 优化改进

- Anthropic Native、Claude Code SDK 和 Codex Provider Proxy 现在共用模型思考与推理强度校验，减少三条 Runtime 之间的行为漂移。
- Claude Code 动态发现的模型只会补充目录，不会覆盖 CodePilot 的显式模型和固定版本映射。
- 模型请求会继续区分用户选择、系统兼容兜底和 Runtime 实际发送值，避免把内部默认值展示成用户选择。

### 已知限制

- Claude Code Runtime 连接首包等待极长的第三方渠道时，分级超时修复已经落地，但 6–9 分钟真实慢渠道验证尚未完成；如仍出现自动中断，请在 [#635](https://github.com/op7418/CodePilot/issues/635) 反馈 Runtime、服务商和错误提示。
- Claude Code Runtime 使用 Opus 5 需要 Claude Code CLI 2.1.219 或更新版本。
- 尚未验证的 OpenRouter、Bedrock 和 Vertex Opus 5 模型 ID 不会被自动加入目录；可用性以各服务商实际支持为准。
- Grok 4.5 Sub-agent 是否可运行仍取决于当前 xAI 账号的实际权限；目录可见不代表套餐 entitlement 一定可用。
- 部分 Windows 11 25H2 设备仍可能出现安装程序启动后立即退出的问题，正在 [#633](https://github.com/op7418/CodePilot/issues/633) 跟进。
- Native Runtime 的定时任务工具缺失、复杂项目的新会话上下文膨胀，以及更新提示期间 CPU 持续偏高，分别在 [#634](https://github.com/op7418/CodePilot/issues/634)、[#632](https://github.com/op7418/CodePilot/issues/632)、[#626](https://github.com/op7418/CodePilot/issues/626) 跟进。

## 下载地址

### macOS
- [Apple Silicon (M1/M2/M3/M4)](https://github.com/op7418/CodePilot/releases/download/v0.61.0/CodePilot-0.61.0-arm64.dmg)
- [Intel](https://github.com/op7418/CodePilot/releases/download/v0.61.0/CodePilot-0.61.0-x64.dmg)

### Windows
- [Windows 安装包](https://github.com/op7418/CodePilot/releases/download/v0.61.0/CodePilot.Setup.0.61.0.exe)

## 安装说明

**macOS**：下载 DMG → 拖入 Applications → 首次启动如遇安全提示，在系统设置 > 隐私与安全中点击“仍要打开”
**Windows**：下载 exe 安装包 → 双击安装

## 系统要求

- macOS 12.0+ / Windows 10+ / Linux (glibc 2.31+)
- 需要配置 API 服务商或受支持的套餐凭据
- 推荐安装 Claude Code CLI 以获得完整功能
