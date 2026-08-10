## CodePilot v0.66.0-y.4（Fork 版）

> 基于上游 CodePilot v0.66.0 的个人 fork 构建。本版新增「Provider 密钥加密开关」，并改进一键更新与会话时间显示。

### 本版新增 / 改进（Fork）

- **可关闭的 Provider 密钥本地加密** — 新增设置项「本地加密 Provider 密钥」。因本 fork 未 notarize，开启加密时 macOS 每次更新后可能重新要求授权钥匙串；关闭后 API Key 以明文存于本地数据库，不再弹钥匙串授权。**全新安装默认关闭**；已在使用加密的用户保持开启，可到「设置 → 通用」手动关闭（会自动把已加密的 key 迁为明文，无需重填）。
- **更新装完自动退出** — 下载安装包并打开后，应用会自动退出，便于把新版本拖入「应用程序」覆盖安装（此改进对**下一次**更新生效）。
- **会话列表时间显示** — 7 天以上的会话不再只显示年份，改为紧凑日期（当年 `月/日`，跨年带两位年份）。

### 自更新与前版功能（Fork）

- 一键更新：检测新版本 → app 内下载 arm64 安装包（带进度）→ 自动打开安装。
- 检查更新指向本 fork 的 Releases。
- 应用内网络代理；Claude Code CLI 登录作为 Provider；默认面板与已完成工具默认折叠。

### 说明

- 本 fork 只发布 **macOS Apple Silicon（arm64）** 构建。
- 构建为 ad-hoc 签名、未 notarize：首次打开若提示应用「已损坏 / 无法验证开发者」，右键点按选择「打开」，或执行 `xattr -dr com.apple.quarantine /Applications/CodePilot.app`。

### 上游基线

完整的上游 v0.66.0 更新内容见上游仓库 op7418/CodePilot 的 v0.66.0 Release。
