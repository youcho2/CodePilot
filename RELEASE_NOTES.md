## CodePilot v0.65.0

> 建立“默认个人助理 → 后台心跳 → 系统通知”的首个完整闭环，并改善 Codex 会话隔离与聊天反馈。

### 新增功能

- **开箱即用的个人助理** — 新用户首次使用时会自动创建默认助理目录，不再被强制要求先选择文件夹；已有助理路径的用户继续沿用原配置，不会被迁移或覆盖。
- **助理心跳** — 助理可以按设定周期读取 `HEARTBEAT.md`，在没有待办时安静跳过，在确有事项时生成一条可追踪的通知；设置页会展示启用、阻塞、上次运行和下次运行状态。
- **系统原生通知** — 助理提醒改由 Electron 调用 macOS、Windows 或 Linux 的系统通知，并支持系统提示音和点击回到对应内容；软件常驻后台时也能真正提醒用户。
- **多 Harness 指令镜像** — 助理目录以 `instructions.md` 为用户拥有的规则源，并为 Claude Code 与 Codex 维护受管的 `CLAUDE.md`、`AGENTS.md` 镜像；用户修改镜像发生冲突时会停止覆盖并明确提示。
- **Thinking 动画** — 等待首个响应和模型真实思考流式输出时显示轻量 Thinking Orb；保留原有文字语义，并自动尊重系统的“减少动态效果”设置。

### 修复问题

- **隔离 CodePilot 与 Codex Desktop 会话** — CodePilot 新建的 Codex 对话使用独立的会话与 SQLite 目录，不再自动出现在官方 Codex 客户端中；账号和用户拥有的 Harness 配置仍按可观测的镜像策略复用。
- **修复 Codex 模型首启缺失** — 打开聊天页时会主动预热 Codex 模型目录，不再需要先进入设置再返回聊天才能看到模型。
- **阻止协议内容泄漏到聊天** — MCP 启动、就绪、重试等结构化 runtime 状态不再以 JSON 原文显示给用户，两个聊天入口统一使用本地化的人类可读状态。
- **停止旧通知反复弹出** — 升级前遗留的非持久通知不会在新版本中被误当成待投递通知反复领取。
- **macOS 开发态通知诚实失败** — 无签名 dev 客户端不再伪装通知已成功展示；正式签名安装包仍走系统原生通知链路。

### 优化改进

- 助理设置页直接展示当前路径；“设置新的助理文件夹”会先说明切换影响，再打开系统目录选择器。
- 新建聊天页的“项目对话 / 个人助理”入口改成与输入框对齐的轻量描边卡片，移除重复说明和最近项目胶囊。
- 左侧个人助理引导改为无边框、无装饰图标的轻量布局，更贴近当前客户端的视觉规范。
- Thinking 状态结束时保持固定图标槽位，避免流式状态切换造成布局跳动。

### 已知限制

- 系统通知是否展示和是否播放声音仍受操作系统通知权限、专注模式及 Linux 桌面通知服务影响。
- 无签名 macOS dev 客户端无法代表正式包验证系统通知；请以本次 Release 的签名安装包为准。
- 隔离只影响后续由 CodePilot 创建的 Codex 对话；过去已经写入官方 Codex 目录的历史对话不会被自动删除。

## 下载地址

### macOS
- [Apple Silicon (M1/M2/M3/M4)](https://github.com/op7418/CodePilot/releases/download/v0.65.0/CodePilot-0.65.0-arm64.dmg)
- [Intel](https://github.com/op7418/CodePilot/releases/download/v0.65.0/CodePilot-0.65.0-x64.dmg)

### Windows
- [Windows 安装包](https://github.com/op7418/CodePilot/releases/download/v0.65.0/CodePilot.Setup.0.65.0.exe)

### Linux x64
- [AppImage](https://github.com/op7418/CodePilot/releases/download/v0.65.0/CodePilot-0.65.0-x86_64.AppImage)
- [deb](https://github.com/op7418/CodePilot/releases/download/v0.65.0/CodePilot-0.65.0-amd64.deb)
- [rpm](https://github.com/op7418/CodePilot/releases/download/v0.65.0/CodePilot-0.65.0-x86_64.rpm)

### Linux arm64
- [AppImage](https://github.com/op7418/CodePilot/releases/download/v0.65.0/CodePilot-0.65.0-arm64.AppImage)
- [deb](https://github.com/op7418/CodePilot/releases/download/v0.65.0/CodePilot-0.65.0-arm64.deb)
- [rpm](https://github.com/op7418/CodePilot/releases/download/v0.65.0/CodePilot-0.65.0-aarch64.rpm)

## 安装说明

**macOS**：下载 DMG → 拖入 Applications → 首次启动如遇安全提示，在系统设置 > 隐私与安全中点击“仍要打开”

**Windows**：下载 exe 安装包 → 双击安装

**Linux**：AppImage 添加可执行权限后直接运行；Debian/Ubuntu 安装 deb；Fedora/RHEL 系安装 rpm

## 系统要求

- macOS 12.0+ / Windows 10+ / Linux (glibc 2.35+)
- 需要配置 API 服务商或受支持的套餐凭据
- 推荐安装 Claude Code CLI 以获得完整功能
