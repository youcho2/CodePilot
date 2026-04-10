## CodePilot v0.48.1

> v0.48.0 发布后的紧急修复，解决 Runtime 选择、看板渲染、数据库约束等问题。

### 修复问题

- 修复了只配置第三方服务商（如智谱、Kimi）时，自动模式错误选择 Claude Code 引擎导致无法使用的问题
- 修复了 Native 引擎下大量请求被误判为"空响应"的问题
- 修复了看板面板中 Widget 样式丢失、内容被裁切的问题
- 修复了删除会话时可能出现的数据库外键约束错误
- 修复了 OpenAI Codex API 连接超时没有明确提示的问题，现在会建议配置代理
- 修复了更新通知弹窗在每次启动时重复弹出的问题

### 优化改进

- Runtime 选择现在精确匹配请求使用的服务商凭据，不再被无关服务商干扰
- 显式选择 Claude Code 引擎时始终尊重用户选择，不再因凭据检查误判
- 服务商过期引用（如删除服务商后的残留绑定）现在正确回退到可用服务商

## 下载地址

### macOS
- [Apple Silicon (M1/M2/M3/M4)](https://github.com/op7418/CodePilot/releases/download/v0.48.1/CodePilot-0.48.1-arm64.dmg)
- [Intel](https://github.com/op7418/CodePilot/releases/download/v0.48.1/CodePilot-0.48.1-x64.dmg)

### Windows
- [Windows 安装包](https://github.com/op7418/CodePilot/releases/download/v0.48.1/CodePilot.Setup.0.48.1.exe)

## 安装说明

**macOS**: 下载 DMG → 拖入 Applications → 首次启动如遇安全提示，在系统设置 > 隐私与安全中点击"仍要打开"
**Windows**: 下载 exe 安装包 → 双击安装

## 系统要求

- macOS 12.0+ / Windows 10+ / Linux (glibc 2.31+)
- 需要配置 API 服务商（Anthropic / OpenRouter / OpenAI 等）
- 可选安装 Claude Code CLI 以获得完整命令行能力
