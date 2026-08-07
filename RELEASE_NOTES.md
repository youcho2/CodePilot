## CodePilot v0.66.0

> 重点提升 Windows 与 macOS 的运行稳定性、凭据安全和故障可恢复性，推荐所有桌面端用户升级。

### 新增功能

- **Windows 运行环境诊断与修复** — 设置页可以识别 Codex CLI 缺失、PowerShell 不可用和 Sandbox 未就绪等状态，并提供与当前平台匹配的恢复指引；桌面端安装流程会展示真实进度和失败原因。
- **Provider 密钥加密存储** — 桌面端使用本机数据密钥保护 Provider API Key；升级、回滚后再升级以及单条旧数据损坏时均会尽量恢复，不再因一条异常记录阻断应用启动。
- **无 ripgrep 时的内置搜索回退** — Windows 等缺少 `rg` 的环境仍可使用文件搜索与文本搜索，并具备超时、中断和结果上限保护。

### 修复问题

- **避免 macOS 钥匙串弹窗阻断对话** — 当默认钥匙串缺失或未配置时，CodePilot 会为 Claude Code 子进程启用受限保护，避免反复弹出“找不到用于储存的钥匙串”；健康钥匙串环境不受影响。
- **修复 Windows 路径与编辑兼容性** — 正确处理盘符、UNC、WSL 路径、大小写和 CRLF 文件，避免工作目录漂移、文件误判或多行编辑产生混合换行。
- **修复搜索导致界面卡死** — 内置文本搜索在遇到高开销正则时会在独立线程内按时终止，不再锁死整个服务；停止操作也能真实中断搜索。
- **修复不完整工具调用导致下一轮失败** — 停止生成或流式传输中断后，残缺的工具调用会以诚实的“未收到结果”状态闭合；旧会话中的同类损坏记录也会在重放时安全修复。
- **修复 Windows 外部链接异常** — 系统没有默认浏览器或无法处理网页链接时，不再产生未处理异常，并会显示可操作的中英文提示。
- **修复本地 HTML 预览边界** — 拒绝 UNC、设备路径及越界基础目录，降低非预期网络访问和本地文件暴露风险。
- **修复跨平台安装提示** — macOS 与 Linux 不再看到 Windows PowerShell 安装命令，未安装状态与恢复卡片使用同一套平台判断。
- **修复运行状态误报** — Sandbox、CLI 探针和日志位置只展示有真实来源的结果，不再把普通命令缺失误报为 Sandbox 故障，也不再显示未实际执行的成功状态。

### 优化改进

- 错误报告会在客户端明确禁止 IP 与地理位置推断，不采集用户身份、安装标识或行为分析数据。
- 桌面端启动时即可建立一次匿名 Release Health session，使常驻托盘应用也能更及时地反映版本稳定性。
- 优化 Provider、Native Runtime 与 ToolLoop 的错误归因和去重，减少把用户取消、配置问题或上游故障误报成产品缺陷。
- 加强跨平台打包、符号链接安全、测试发现和 pre-commit 门禁，Windows 与 Unix 使用同一套 fail-closed 验证规则。

### 已知限制

- macOS 钥匙串保护目前覆盖“默认钥匙串缺失、未配置或探测失败”；钥匙串文件存在但被锁定、单个条目权限损坏时，系统仍可能显示原生访问提示。
- Windows 的部分 Sandbox 能力取决于系统版本、PowerShell 和 Codex CLI 的实际安装状态；设置页会在无法确认时显示诊断状态，而不会伪装为已就绪。

## 下载地址

### macOS
- [Apple Silicon (M1/M2/M3/M4)](https://github.com/op7418/CodePilot/releases/download/v0.66.0/CodePilot-0.66.0-arm64.dmg)
- [Intel](https://github.com/op7418/CodePilot/releases/download/v0.66.0/CodePilot-0.66.0-x64.dmg)

### Windows
- [Windows 安装包](https://github.com/op7418/CodePilot/releases/download/v0.66.0/CodePilot.Setup.0.66.0.exe)

### Linux x64
- [AppImage](https://github.com/op7418/CodePilot/releases/download/v0.66.0/CodePilot-0.66.0-x86_64.AppImage)
- [deb](https://github.com/op7418/CodePilot/releases/download/v0.66.0/CodePilot-0.66.0-amd64.deb)
- [rpm](https://github.com/op7418/CodePilot/releases/download/v0.66.0/CodePilot-0.66.0-x86_64.rpm)

### Linux arm64
- [AppImage](https://github.com/op7418/CodePilot/releases/download/v0.66.0/CodePilot-0.66.0-arm64.AppImage)
- [deb](https://github.com/op7418/CodePilot/releases/download/v0.66.0/CodePilot-0.66.0-arm64.deb)
- [rpm](https://github.com/op7418/CodePilot/releases/download/v0.66.0/CodePilot-0.66.0-aarch64.rpm)

## 安装说明

**macOS**：下载 DMG → 拖入 Applications → 首次启动如遇安全提示，在系统设置 > 隐私与安全中点击“仍要打开”

**Windows**：下载 exe 安装包 → 双击安装

**Linux**：AppImage 添加可执行权限后直接运行；Debian/Ubuntu 安装 deb；Fedora/RHEL 系安装 rpm

## 系统要求

- macOS 12.0+ / Windows 10+ / Linux (glibc 2.35+)
- 需要配置 API 服务商或受支持的套餐凭据
- 推荐安装 Claude Code CLI 以获得完整功能
