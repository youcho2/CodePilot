## CodePilot v0.58.4

> 紧急修复 v0.58.3 更新后部分电脑一直停留在 “Starting CodePilot...” 的启动故障。

### 修复问题

- **修复更新后无法进入主界面** — 补齐安装包中缺失的后台服务运行依赖，CodePilot 现在可以正常完成启动，不会再无限停留在启动页。

### 优化改进

- **新增安装包真实启动门禁** — macOS 和 Windows 发布包在上传前都会实际启动后台服务并检查健康状态，避免出现“构建成功但用户无法启动”的版本。

## 下载地址

### macOS
- [Apple Silicon (M1/M2/M3/M4)](https://github.com/op7418/CodePilot/releases/download/v0.58.4/CodePilot-0.58.4-arm64.dmg)
- [Intel](https://github.com/op7418/CodePilot/releases/download/v0.58.4/CodePilot-0.58.4-x64.dmg)

### Windows
- [Windows 安装包](https://github.com/op7418/CodePilot/releases/download/v0.58.4/CodePilot.Setup.0.58.4.exe)

## 安装说明

**macOS**：下载 DMG → 拖入 Applications → 首次启动如遇安全提示，在系统设置 > 隐私与安全中点击“仍要打开”
**Windows**：下载 exe 安装包 → 双击安装

## 系统要求

- macOS 12.0+ / Windows 10+ / Linux (glibc 2.31+)
- 需要配置 API 服务商（Anthropic / OpenRouter 等）
- 推荐安装 Claude Code CLI 以获得完整功能
