## CodePilot v0.66.0-y.6（Fork 版）

> 基于上游 CodePilot v0.66.0 的个人 fork 构建。本版新增「归档代替删除」。

### 本版新增（Fork）

- **归档代替删除对话** — 会话列表和顶栏的「删除」改为「归档」（软删除）：会话及其消息仍保留在本地数据库，只是从列表隐藏，可在数据库层面恢复，不再硬删除丢数据。

### 承接前版功能（Fork）

- 更新下载走系统代理（Clash / VPN），加速国内下载（对装上本版后的下一次更新生效）。
- 可关闭的 Provider 密钥本地加密（设置 → 通用；全新安装默认关，老用户可手动关，关闭自动迁移已加密 key 为明文）。
- 更新装完自动退出（对下一次更新生效）。
- 会话列表 ≥7 天时间显示为紧凑日期。
- 一键更新：检测新版本 → app 内下载 arm64 安装包（带进度）→ 自动打开安装；检查更新指向本 fork 的 Releases。
- 应用内网络代理；Claude Code CLI 登录作为 Provider；默认面板与已完成工具默认折叠。

### 说明

- 本 fork 只发布 **macOS Apple Silicon（arm64）** 构建。
- 构建为 ad-hoc 签名、未 notarize：首次打开若提示应用「已损坏 / 无法验证开发者」，右键点按选择「打开」，或执行 `xattr -dr com.apple.quarantine /Applications/CodePilot.app`。

### 上游基线

完整的上游 v0.66.0 更新内容见上游仓库 op7418/CodePilot 的 v0.66.0 Release。
