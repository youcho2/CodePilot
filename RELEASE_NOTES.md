## CodePilot v0.66.0-y.7（Fork 版）

> 基于上游 CodePilot v0.66.0 的个人 fork 构建。本版改进更新下载体验。

### 本版改进（Fork）

- **更新下载可暂停 / 继续 / 取消** — 下载安装包时可随时暂停、继续（断点续传，不用从头下）或取消。
- **下载更流畅** — 修复下载进度上报过于频繁导致的自我拖慢。
- **下载中检查更新不再假死** — 下载进行中再点「检查更新」会重新打开进度对话框，而不是看似无反应。

### 承接前版功能（Fork）

- 归档代替删除对话（软删除，数据保留在本地、从列表隐藏）。
- 更新下载走系统代理（Clash / VPN），检查更新指向本 fork 的 Releases。
- 可关闭的 Provider 密钥本地加密（设置 → 通用；全新安装默认关）。
- 更新装完自动退出；会话列表 ≥7 天时间显示为紧凑日期。
- 应用内网络代理；Claude Code CLI 登录作为 Provider；默认面板与已完成工具默认折叠。

### 说明

- 本 fork 只发布 **macOS Apple Silicon（arm64）** 构建。
- 构建为 ad-hoc 签名、未 notarize：首次打开若提示应用「已损坏 / 无法验证开发者」，右键点按选择「打开」，或执行 `xattr -dr com.apple.quarantine /Applications/CodePilot.app`。

### 上游基线

完整的上游 v0.66.0 更新内容见上游仓库 op7418/CodePilot 的 v0.66.0 Release。
