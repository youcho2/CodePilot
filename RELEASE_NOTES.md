## CodePilot v0.55.0

> ⚠️ **本版是一次大规模重构更新，底层改动面很大，可能存在尚未发现的问题。如果你更在意稳定性、不想冒险踩坑，建议先不升级、等后续修订版本再更新。**
>
> 重构完成的正式版：多执行引擎（Claude Code / 自建 Native / OpenAI Codex）、上下文用量可视化、Codex 账号原生能力全部落地为稳定版，并集中修复了 macOS 视觉与托盘、Windows 安装与交互、服务商型号映射等内测反馈问题。

### 新增功能

- **多执行引擎，可整体切换也可按会话切换** — 同一个应用里支持 Anthropic Claude Code、CodePilot 自建 Native、OpenAI Codex 三种执行引擎；可以设全局默认，也能在单个对话的输入框下方临时切换，互不影响。
- **上下文用量可视化** — 聊天里能实时看到本次对话占用了多少上下文、还剩多少，并按来源（系统提示 / 工作区规则 / 技能 / 记忆 / 工具 / MCP）分解，长对话不再"用着用着突然被截断也不知道为什么"。
- **OpenAI Codex 账号原生能力打通** — 用 Codex 账号登录后，助理记忆、Widget 可视化、定时任务 + 到点通知、Dashboard、CLI 工具这些内置能力在 Codex 引擎下也能用；接不了的能力会如实标注为不支持，而不是假装可用。

### 修复问题

- **OpenRouter + Opus 会话被静默换成 Sonnet** — 之前用 OpenRouter（Claude Code 引擎）选了 Opus 的老会话，重新打开后顶部会显示成 Sonnet，继续发送也真的用了 Sonnet。现在会正确认出你当初选的模型，显示和发送都回到 Opus。
- **小米 MiMo 型号被改回默认** — 修复 MiMo 自定义型号在某些情况下被改回默认型号的问题；现在你设过的型号会保留，默认型号也对齐到 MiMo-V2.5-Pro。
- **中断任务后输入框发不出消息** — 之前中断一个正在运行的任务后，再在输入框输入内容点发送会没反应。现在中断后可以正常继续发送。
- **完全访问权限每条消息都要二次确认** — 开启完全访问权限后，之前每次发送都要再点一次"已了解，继续发送"。现在只在开启该权限时确认一次，之后连续发送不再被打断。
- **macOS 菜单栏图标看不清** — 菜单栏（顶部状态栏）的 CodePilot 图标改用专门的单色模板图标，浅色 / 深色模式下都清晰。
- **Windows 生成的命令是 bash 语法** — 在 Windows 上，模型生成的脚本命令默认按 PowerShell 输出，不再默认给只能在 macOS/Linux 跑的 bash 命令。
- **Windows 安装无法选择目录** — Windows 安装包恢复可以选择安装位置。
- **Windows 服务商编辑窗口关闭按钮贴着系统按钮** — 编辑服务商的全屏窗口里，应用内的关闭按钮让出系统窗口控制区，不再和系统的"×"贴脸误点。
- **Windows 上 Codex 无法启动** — 修复 Windows 下 Codex 启动报 `spawn EINVAL`、无法登录 / 无法使用的问题。
- **飞书桥接后台刷错误日志** — 修复开启飞书桥接后后台每分钟重复刷错误、污染日志的问题。

### 优化改进

- **Codex 启动更稳更快** — 同时装了多个版本的 Codex 时会自动选最新的可用版本；遇到坏的 / 旧的二进制会快速失败并给出明确原因，不再卡住几十秒。
- **设置页打开更干净** — 打开设置概览时不再对不存在的虚拟 Codex 账号发无效的模型请求，消除后台报错噪音。
- **macOS 平台质感** — 窗口、顶部栏、侧栏、输入区等按 macOS 原生材质与悬停效果做了平台化处理，页面内容本身不分叉。

### 已知问题

以下问题已记录、不影响主流程，正在跟进（欢迎到 GitHub Issues 反馈复现细节）：

- Windows 上服务商编辑窗口右上角关闭按钮在个别情况下点击无反应（仍在 Windows 真机验证中）。
- 个别用户反馈流式回复期间继续追加消息进队列的行为异常（核查中）。
- MCP 在设置页能看到，但运行时模型调不到，需要把 MCP 配置到项目路径才识别（排查中）。

**反馈入口**：欢迎在 [GitHub Issues](https://github.com/op7418/CodePilot/issues) 提交问题与复现步骤。

## 下载地址

### macOS
- [Apple Silicon (M1/M2/M3/M4)](https://github.com/op7418/CodePilot/releases/download/v0.55.0/CodePilot-0.55.0-arm64.dmg)
- [Intel](https://github.com/op7418/CodePilot/releases/download/v0.55.0/CodePilot-0.55.0-x64.dmg)

### Windows
- [Windows 安装包](https://github.com/op7418/CodePilot/releases/download/v0.55.0/CodePilot.Setup.0.55.0.exe)

## 安装说明

**macOS**: 下载 DMG → 拖入 Applications → 首次启动如遇安全提示，在系统设置 > 隐私与安全中点击"仍要打开"
**Windows**: 下载 exe 安装包 → 双击安装

## 系统要求

- macOS 12.0+ / Windows 10+ / Linux (glibc 2.31+)
- 需要配置 API 服务商（Anthropic / OpenRouter 等）
- 推荐安装 Claude Code CLI 以获得完整功能
