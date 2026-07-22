## CodePilot v0.59.0

> 新增千问 Token Plan 与 xAI Grok 4.5 双渠道接入，让套餐凭据和官方 API Key 都能在正确的 Runtime 中使用。

### 新增功能

- **新增三类千问套餐入口** — 阿里云百炼 Coding Plan、千问 Token Plan 个人版和团队版现在拥有独立配置与精确模型目录；即使服务地址相同，也会保持正确的套餐身份。
- **新增 xAI API Key + Grok 4.5** — 可通过官方 xAI API Key 在 CodePilot Runtime 和 Codex Runtime 使用 Grok 4.5 Responses。
- **新增 xAI Grok OAuth 兼容登录** — SuperGrok 用户可选择浏览器或设备码登录，并在 CodePilot Runtime、Codex Runtime 使用 Grok 4.5。该入口复用公开 Grok CLI OAuth client，可能受 xAI 上游策略变化影响；官方 API Key 入口始终独立保留。

### 修复问题

- **修复同地址套餐串线** — 不再依靠 Base URL 猜测个人版或团队版，旧配置无法确认时会要求用户明确选择。
- **阻止套餐凭据被后台误用** — 千问订阅凭据不会再被自动标题、定时任务、heartbeat、后台记忆等非交互场景静默调用。
- **修复 xAI OAuth 取消竞态** — 登录超时会同步取消服务端流程，取消后的迟到 token 不会写入本地凭据。
- **修复浏览器授权完成页不结束** — CodePilot 已登录后，xAI 页面现在能正确识别本地 callback 的完成结果。

### 优化改进

- xAI OAuth 支持并发 refresh 合并、refresh token 轮换和原子凭据更新；临时网络错误不会误删现有登录状态。
- 浏览器登录与设备码登录在界面中明确分离；选择浏览器登录后不再显示设备码提示。
- 旧 Token Plan 配置只有在用户明确确认套餐时才按新目录整理模型，普通编辑不会静默替换用户选择。
- Provider、模型目录、Runtime picker、Doctor 与实际请求共用同一套餐身份判断，减少“界面可选但请求走错”的差异。

## 下载地址

### macOS
- [Apple Silicon (M1/M2/M3/M4)](https://github.com/op7418/CodePilot/releases/download/v0.59.0/CodePilot-0.59.0-arm64.dmg)
- [Intel](https://github.com/op7418/CodePilot/releases/download/v0.59.0/CodePilot-0.59.0-x64.dmg)

### Windows
- [Windows 安装包](https://github.com/op7418/CodePilot/releases/download/v0.59.0/CodePilot.Setup.0.59.0.exe)

## 安装说明

**macOS**：下载 DMG → 拖入 Applications → 首次启动如遇安全提示，在系统设置 > 隐私与安全中点击“仍要打开”
**Windows**：下载 exe 安装包 → 双击安装

## 系统要求

- macOS 12.0+ / Windows 10+ / Linux (glibc 2.31+)
- 需要配置 API 服务商或受支持的套餐凭据
- 推荐安装 Claude Code CLI 以获得完整功能
