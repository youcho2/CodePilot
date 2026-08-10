## CodePilot v0.66.0-y.5（Fork 版）

> 基于上游 CodePilot v0.66.0 的个人 fork 构建。本版让更新下载走系统代理，加速国内下载。

### 本版改进（Fork）

- **更新下载走系统代理** — app 内更新下载改用 Electron 网络栈，会经系统代理（Clash / VPN / PAC）下载，国内不再卡在直连 GitHub 上。（此改进对**你装上本版之后**的下一次更新下载生效。）

### 承接前版功能（Fork）

- 可关闭的 Provider 密钥本地加密（设置 → 通用；全新安装默认关，老用户可手动关，关闭自动迁移已加密 key 为明文）。
- 更新装完自动退出（对下一次更新生效）。
- 会话列表 ≥7 天时间显示为紧凑日期。
- 一键更新：检测新版本 → app 内下载 arm64 安装包（带进度）→ 自动打开安装。
- 检查更新指向本 fork 的 Releases；应用内网络代理；Claude Code CLI 登录作为 Provider；默认面板与已完成工具默认折叠。

### 说明

- 本 fork 只发布 **macOS Apple Silicon（arm64）** 构建。
- 构建为 ad-hoc 签名、未 notarize：首次打开若提示应用「已损坏 / 无法验证开发者」，右键点按选择「打开」，或执行 `xattr -dr com.apple.quarantine /Applications/CodePilot.app`。

### 上游基线

完整的上游 v0.66.0 更新内容见上游仓库 op7418/CodePilot 的 v0.66.0 Release。
