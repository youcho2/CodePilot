## CodePilot v0.60.0

> 新增多模型 Sub-agent 编排：在同一个对话里让 Qwen、DeepSeek、Kimi 等不同模型分工协作，并修复 Windows 系统代理导致 Codex 请求 502 的问题。

### 新增功能

- **多模型 Sub-agent 编排** — 主对话可以启动多个子代理并为每个子代理指定确切的服务商和模型（如 Qwen 负责调研、DeepSeek 负责文案、Kimi 负责实现）。CodePilot Runtime、Claude Code Runtime、Codex Runtime 三条路径均已支持。
- **子代理依赖工作流** — 子代理之间可以声明依赖关系：下游任务会自动等待上游完成，并在启动时收到上游的完成结果，不再需要手动在任务间搬运内容。
- **子代理运行胶囊与详情面板** — 每个子代理任务在对话中显示为一个状态胶囊（排队 / 运行中 / 已完成 / 失败 / 已取消），可打开侧边栏查看实时活动、使用的真实模型、重试次数和完整结果。状态均来自持久化的运行记录，刷新或重启后仍可恢复。
- **Codex Account 支持指定模型的子代理** — 使用 Codex 登录账号时，也可以把子任务精确委派给已配置的 CodePilot 服务商模型，主对话保持你选择的模型不变。
- **Grok X Search** — xAI Grok 模型现已支持官方 X Search 联网搜索，回答会附带可点击的来源链接并在刷新后保留。目前已完整验证 xAI OAuth 登录 + CodePilot Runtime 组合，API Key 与 Codex Runtime 组合仍在验证中。

### 修复问题

- **修复 Windows 系统代理导致 Codex 请求 502** — 开启 Clash 等系统代理且未配置 `NO_PROXY` 时，CodePilot 发往本机 Codex 通道的请求可能被代理截获并返回 502 Bad Gateway。现在应用会自动让本机回环地址绕过代理，同时完整保留你的外网代理设置。
- **修复子代理停止按钮失效** — 点击停止后，排队中和运行中的子代理现在会立即终止并记录为“已取消”，不会再出现停止后子任务仍在后台继续运行、或迟到的完成结果覆盖取消状态的问题。
- **修复 Codex 协作任务的胶囊误报** — 此前 Codex 原生协作的每次内部轮询都会生成一个“Codex worker 已完成”的胶囊（一次会话可能出现十几个假胶囊）。现在只有能确认真实子任务身份时才显示胶囊，状态也不再把轮询完成误当作任务完成。
- **修复模型显示与路由校验** — 子代理胶囊会区分“请求的模型”与“实际运行的模型”；当运行时静默替换成其他模型时会直接报错，而不是显示错误的模型名继续执行。

### 优化改进

- 网络类错误现在会给出更明确的诊断：本机代理截获、上游服务商故障、连接被拒绝会分别提示，并保留原始错误信息便于排查。
- 子代理运行记录在应用重启、页面刷新和开发热更新后保持一致，不会误报中断或丢失进行中的任务。

### 已知限制

- Codex Account 原生协作模式下，如果 Codex 未上报子任务身份信息，CodePilot 不会显示对应胶囊（宁缺毋假）；指定模型的子代理不受影响。
- Windows 系统代理修复已通过完整自动化测试，真实 Windows + Clash 环境的实机验证仍在进行中，如仍遇到 502 请反馈。

## 下载地址

### macOS
- [Apple Silicon (M1/M2/M3/M4)](https://github.com/op7418/CodePilot/releases/download/v0.60.0/CodePilot-0.60.0-arm64.dmg)
- [Intel](https://github.com/op7418/CodePilot/releases/download/v0.60.0/CodePilot-0.60.0-x64.dmg)

### Windows
- [Windows 安装包](https://github.com/op7418/CodePilot/releases/download/v0.60.0/CodePilot.Setup.0.60.0.exe)

## 安装说明

**macOS**：下载 DMG → 拖入 Applications → 首次启动如遇安全提示，在系统设置 > 隐私与安全中点击“仍要打开”
**Windows**：下载 exe 安装包 → 双击安装

## 系统要求

- macOS 12.0+ / Windows 10+ / Linux (glibc 2.31+)
- 需要配置 API 服务商或受支持的套餐凭据
- 推荐安装 Claude Code CLI 以获得完整功能
