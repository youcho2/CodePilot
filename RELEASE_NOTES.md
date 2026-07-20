## CodePilot v0.58.2

> 修复 macOS 上 Codex CLI 发现与自动恢复问题，并让 Codex Runtime 和账户连接失败都给出可判断、可重试的反馈。

### 修复问题

- **修复新版 OpenAI 客户端内置 Codex CLI 无法识别** — CodePilot 现在会发现当前 `ChatGPT.app` 内置的 CLI，同时兼容旧版 `Codex.app`、用户级 Applications 安装和 PATH 中的独立 CLI。
- **修复多个 Codex CLI 共存时误用旧版本** — 自动发现会比较所有可用候选的真实版本并选择较新版本；相同版本仍保持 PATH 优先，避免改变既有自定义安装行为。
- **修复卸载或升级 CLI 后仍卡在旧路径** — Runtime 刷新会重新扫描候选。旧路径消失、新客户端安装或同一路径完成升级后，无需重启 CodePilot 即可从失败状态恢复；正在正常运行的 Codex 会话不会被刷新中断。
- **修复添加 Codex Account 点击后没有反应** — 登录失败时添加窗口会保留，直接显示错误原因并提供重试入口；接口没有返回有效登录会话时也不会再静默结束。
- **修复 macOS 发布包被本地工作树污染** — Electron 构建会先清理旧产物，并通过严格 allowlist 移除误追踪的本地代理目录、用户数据、Git 元数据或嵌套发布产物。

### 优化改进

- **Codex Runtime 来源更透明** — 设置页会展示实际选中的 CLI 路径、探测版本或 app-server 版本，启动失败也会保留对应路径，方便判断 CodePilot 到底使用了哪个 Codex。
- **刷新语义更准确** — 普通状态读取保持只读；用户主动点击刷新时才强制重新探测版本。已有健康 app-server 会继续运行，避免打断活跃任务。

### 已知问题

- Windows 继续支持 PATH 中的 Codex CLI；Windows 版 ChatGPT/Codex 客户端是否内置 CLI 以及具体路径仍待真机确认，本版本没有猜测性加入未验证路径。

## 下载地址

### macOS
- [Apple Silicon (M1/M2/M3/M4)](https://github.com/op7418/CodePilot/releases/download/v0.58.2/CodePilot-0.58.2-arm64.dmg)
- [Intel](https://github.com/op7418/CodePilot/releases/download/v0.58.2/CodePilot-0.58.2-x64.dmg)

### Windows
- [Windows 安装包](https://github.com/op7418/CodePilot/releases/download/v0.58.2/CodePilot.Setup.0.58.2.exe)

## 安装说明

**macOS**：下载 DMG → 拖入 Applications → 首次启动如遇安全提示，在系统设置 > 隐私与安全中点击“仍要打开”
**Windows**：下载 exe 安装包 → 双击安装

## 系统要求

- macOS 12.0+ / Windows 10+ / Linux (glibc 2.31+)
- 需要配置 API 服务商（Anthropic / OpenRouter 等）
- 推荐安装 Claude Code CLI 以获得完整功能
