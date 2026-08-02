## CodePilot v0.64.0

> 重建可信、匿名的错误监控与崩溃定位链路，并恢复 Linux x64 / arm64 官方安装包。

### 新增功能

- **恢复 Linux 官方版本** — GitHub Release 重新提供 x64 与 arm64 的 AppImage、deb、rpm 安装包，不再要求 Linux 用户自行从源码构建。
- **三层故障定位** — 界面、内置本地服务和 Electron 主进程的正式版本错误现在都能映射回真实源码位置；原生崩溃也可以通过 minidump 定位。
- **版本稳定性统计** — 在用户允许“匿名错误上报与崩溃率统计”时，只记录匿名的应用进程 session，用于观察版本采用率和 crash-free sessions；不采集用户 ID、安装 ID 或行为轨迹。

### 修复问题

- **减少 Sentry 噪音** — 用户取消、缺少凭据、认证/额度/权限问题、Provider 测试失败等可预期结果不再冒充产品崩溃。
- **修复错误分组失真** — 同一根因不再被动态文案、请求 ID 或供应商原始响应拆成大量重复问题；有真实调用栈的故障继续按源码位置分组。
- **隔离开发与衍生版本** — 本地开发、Preview 和普通 Fork 默认不会向 CodePilot 官方 Sentry 项目发送事件，正式版本数据不再被这些环境污染。
- **加强遥测隐私** — 清理 prompt、响应正文、本地路径、URL、高基数 ID 和控制台面包屑；默认关闭 PII、截图、性能追踪和用户行为采集。

### 优化改进

- Sentry SDK 已升级并适配当前 Electron / Next.js 三层运行结构。
- 正式构建会在打包前上传调试信息，上传失败会阻断发版；安装包内会再次检查，确保不携带源码映射文件。
- Linux 两种架构均在对应原生 Ubuntu runner 构建，并检查安装包架构、SQLite 原生模块 ABI 与内置服务启动，避免“有文件但不能运行”的假成功。

### 已知限制

- 本版 Sentry 只能提供版本采用率、session 数和 crash-free sessions，不能代表自然人用户量，也不能用于统计 DAU/MAU 或功能使用情况。
- 发布后的真实问题优先级需要等待当前正式版本积累约 72 小时的干净数据后再判断。
- Linux 包未签名；首版恢复以 Ubuntu 22.04 / glibc 2.35 为兼容基线，桌面环境差异仍需发布后继续收集反馈。

## 下载地址

### macOS
- [Apple Silicon (M1/M2/M3/M4)](https://github.com/op7418/CodePilot/releases/download/v0.64.0/CodePilot-0.64.0-arm64.dmg)
- [Intel](https://github.com/op7418/CodePilot/releases/download/v0.64.0/CodePilot-0.64.0-x64.dmg)

### Windows
- [Windows 安装包](https://github.com/op7418/CodePilot/releases/download/v0.64.0/CodePilot.Setup.0.64.0.exe)

### Linux x64
- [AppImage](https://github.com/op7418/CodePilot/releases/download/v0.64.0/CodePilot-0.64.0-x86_64.AppImage)
- [deb](https://github.com/op7418/CodePilot/releases/download/v0.64.0/CodePilot-0.64.0-amd64.deb)
- [rpm](https://github.com/op7418/CodePilot/releases/download/v0.64.0/CodePilot-0.64.0-x86_64.rpm)

### Linux arm64
- [AppImage](https://github.com/op7418/CodePilot/releases/download/v0.64.0/CodePilot-0.64.0-arm64.AppImage)
- [deb](https://github.com/op7418/CodePilot/releases/download/v0.64.0/CodePilot-0.64.0-arm64.deb)
- [rpm](https://github.com/op7418/CodePilot/releases/download/v0.64.0/CodePilot-0.64.0-aarch64.rpm)

## 安装说明

**macOS**：下载 DMG → 拖入 Applications → 首次启动如遇安全提示，在系统设置 > 隐私与安全中点击“仍要打开”

**Windows**：下载 exe 安装包 → 双击安装

**Linux**：AppImage 添加可执行权限后直接运行；Debian/Ubuntu 安装 deb；Fedora/RHEL 系安装 rpm

## 系统要求

- macOS 12.0+ / Windows 10+ / Linux (glibc 2.35+)
- 需要配置 API 服务商或受支持的套餐凭据
- 推荐安装 Claude Code CLI 以获得完整功能
