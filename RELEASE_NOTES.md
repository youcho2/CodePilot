## CodePilot v0.43.0

> 本版本新增**项目看板**——AI 原生的项目控制台。聊天中生成的可视化组件可以固定到看板持续追踪，支持文件、MCP 工具、CLI 命令三种数据源，看板数据自动刷新，组件可导出为图片分享。

### 新增功能

- **项目看板**：右侧新增看板面板，固定聊天中的可视化组件到看板，项目级持续追踪
- **看板 MCP 工具**：AI 在对话中直接管理看板——固定组件、刷新数据、更新内容、调整排序，全部通过对话完成
- **三种数据源**：支持本地文件（glob 模式）、MCP 工具（Linear/Notion 等外部服务）、CLI 命令（git log/docker ps 等）作为看板数据来源
- **组件导出为图片**：在看板或聊天中点击导出按钮，将可视化组件保存为高清 PNG 图片（含 Chart.js 图表）
- **看板与对话联动**：点击看板组件标题可发起深入分析对话；AI 自动感知看板内容，对话中了解你在追踪什么
- **组件间联动**：看板组件之间可以通过筛选器实现数据联动——点击一个组件的筛选条件，其他组件自动更新
- **看板组件排序**：通过上下箭头调整组件顺序，支持自动刷新开关

### 修复问题

- 修复可视化组件在部分模型下渲染为 JSON 代码的问题（解析器改为格式无关，兼容所有模型输出变体）
- 修复 Chart.js 图表因 CDN 脚本加载时序问题不渲染的问题
- 修复可视化组件底部内容被裁切的问题

### 优化改进

- 可视化组件的 Pin 和显示代码按钮统一为工具栏，对齐显示
- Toast 提示支持 loading 状态（转圈等待 → 成功/失败自动切换）
- 看板组件标题改为人类可读的自然语言（如"用户参与度指标"而非 user_engagement）

## 下载地址

### macOS
- [Apple Silicon (M1/M2/M3/M4)](https://github.com/op7418/CodePilot/releases/download/v0.43.0/CodePilot-0.43.0-arm64.dmg)
- [Intel](https://github.com/op7418/CodePilot/releases/download/v0.43.0/CodePilot-0.43.0-x64.dmg)

### Windows
- [Windows 安装包](https://github.com/op7418/CodePilot/releases/download/v0.43.0/CodePilot-Setup-0.43.0.exe)

## 安装说明

**macOS**: 下载 DMG → 拖入 Applications → 首次启动如遇安全提示，在系统设置 > 隐私与安全中点击"仍要打开"
**Windows**: 下载 exe 安装包 → 双击安装

## 系统要求

- macOS 12.0+ / Windows 10+ / Linux (glibc 2.31+)
- 需要配置 API 服务商（Anthropic / OpenRouter 等）
- 推荐安装 Claude Code CLI 以获得完整功能
