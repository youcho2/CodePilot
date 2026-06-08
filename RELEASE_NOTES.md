## CodePilot v0.55.2

> v0.55.x 系列的稳定性维护版本：修复 Codex 终止后无法继续发送、发送截图/附件被吞、以及主日志异常增大三个问题，建议所有 0.55.x 用户升级。
>
> 首次从 0.54.0 升级的用户，可一并参考 v0.55.0 的重构说明（多执行引擎 / 上下文用量可视化 / Codex 账号原生能力）。

### 修复问题

- **Codex 终止后无法发送新指令** — 在 Codex 引擎下点击「终止」停止当前任务后，同一个对话再发新消息会没有反应、像整个卡死，需要新建会话或重启才能继续。现在「终止」会真正中断后端任务并恢复输入，停止后可以直接接着发。
- **发送截图 / 附件时图片直接消失** — 在对话框贴图后点发送，如果这条消息其实没有真正发出去（服务还在加载、所选服务 / 模型不兼容、被中断、或新建对话时创建会话失败等），截图会被直接清空、白丢。现在只要消息没真正发出，你的文字和截图都会保留在输入框里，等条件就绪再发。
- **主日志异常增大** — 在 Codex 引擎下长时间使用后，应用主日志（codepilot-main.log）会无节制增长，个别用户甚至涨到 10GB 以上，挤占磁盘并可能拖累应用稳定性。现在日志有大小上限并自动轮转，不会再无限增长。

### 优化改进

- **大幅降低 Codex 引擎日志噪声** — 默认只记录关键诊断信息，不再把海量调试 tracing 写入日志；需要完整日志排查问题时可手动开启。
- **新增崩溃诊断线索** — 应用异常退出前会记录日志大小、内存占用、子进程 / 渲染进程退出等信息，便于后续定位偶发闪退。

### 已知问题

以下问题已记录、不影响主流程，仍在跟进（欢迎到 GitHub Issues 反馈复现细节）：

- Windows 上服务商编辑窗口右上角关闭按钮在个别情况下点击无反应（仍在 Windows 真机验证中）。
- 流式回复期间继续追加消息进队列的行为异常（核查中）。
- MCP 在设置页能看到，但运行时模型调不到，需要把 MCP 配置到项目路径才识别（排查中）。

**反馈入口**：欢迎在 [GitHub Issues](https://github.com/op7418/CodePilot/issues) 提交问题与复现步骤。

## 下载地址

### macOS
- [Apple Silicon (M1/M2/M3/M4)](https://github.com/op7418/CodePilot/releases/download/v0.55.2/CodePilot-0.55.2-arm64.dmg)
- [Intel](https://github.com/op7418/CodePilot/releases/download/v0.55.2/CodePilot-0.55.2-x64.dmg)

### Windows
- [Windows 安装包](https://github.com/op7418/CodePilot/releases/download/v0.55.2/CodePilot.Setup.0.55.2.exe)

## 安装说明

**macOS**: 下载 DMG → 拖入 Applications → 首次启动如遇安全提示，在系统设置 > 隐私与安全中点击"仍要打开"
**Windows**: 下载 exe 安装包 → 双击安装

## 系统要求

- macOS 12.0+ / Windows 10+ / Linux (glibc 2.31+)
- 需要配置 API 服务商（Anthropic / OpenRouter 等）
- 推荐安装 Claude Code CLI 以获得完整功能
