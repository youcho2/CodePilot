## CodePilot v0.42.0

> 本版本聚焦 **CLI 工具的 AI 化安装体验**和全新的 **Agent 友好度评分系统**。安装工具改为由 AI 全程协助，工具卡片新增 5 星评分帮你判断哪些工具最适合 AI 使用。

### 新增功能

- **AI 协助安装 CLI 工具**：点击安装按钮直接跳转聊天，AI 帮你执行安装命令、处理权限问题、引导认证配置、生成工具简介，全流程在对话中完成
- **Agent 友好度 5 星评分**：工具卡片新增 ★★★★★ 评分，从 5 个维度评估工具对 AI 的友好程度（Agent 原生设计 / JSON 输出 / Schema 自省 / Dry Run / 上下文友好）
- **AI 自动评估兼容度**：通过聊天添加的自定义工具，AI 会从 --help 输出自动评估 Agent 兼容度；批量生成简介时也会同步评估
- **新增推荐 CLI 工具**：即梦 Dreamina CLI（AI 图片/视频生成）、飞书 Lark CLI（200+ 命令覆盖飞书全业务域）
- **工具安装后自动配置**：需要认证的工具安装后，AI 自动引导完成登录和配置；需要 Skills 安装的工具（飞书、gws）会在安装提示中告知

### 修复问题

- 修复斜杠命令（如 /review）发送时用户附加文本在气泡中不显示的问题
- 修复 JSON 格式版本号（如 Dreamina CLI）在工具卡片上显示为乱码的问题
- 移除不可用的 Custom API (OpenAI-compatible) Provider 选项
- 修复旧版 custom provider 升级时可能误删有效配置的问题

### 优化改进

- 工具详情弹窗新增"AI Agent 兼容度"区域，展示具体达标维度和评分
- GLM 模型更新为 GLM-5-Turbo / GLM-5.1 / GLM-4.5-Air
- MCP list 工具的 JSON 输出在所有工具类型中统一字段格式

## 下载地址

### macOS
- [Apple Silicon (M1/M2/M3/M4)](https://github.com/op7418/CodePilot/releases/download/v0.42.0/CodePilot-0.42.0-arm64.dmg)
- [Intel](https://github.com/op7418/CodePilot/releases/download/v0.42.0/CodePilot-0.42.0-x64.dmg)

### Windows
- [Windows 安装包](https://github.com/op7418/CodePilot/releases/download/v0.42.0/CodePilot-Setup-0.42.0.exe)

## 安装说明

**macOS**: 下载 DMG → 拖入 Applications → 首次启动如遇安全提示，在系统设置 > 隐私与安全中点击"仍要打开"
**Windows**: 下载 exe 安装包 → 双击安装

## 系统要求

- macOS 12.0+ / Windows 10+ / Linux (glibc 2.31+)
- 需要配置 API 服务商（Anthropic / OpenRouter 等）
- 推荐安装 Claude Code CLI 以获得完整功能
