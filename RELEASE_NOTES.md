## CodePilot v0.66.0-y.2（Fork 版）

> 基于上游 CodePilot v0.66.0 的个人 fork 构建。本版打通「检查更新 → app 内一键下载安装」的自更新闭环。

### 本版新增（Fork）

- **一键更新（半自动）** — 检测到新版本后，点「安装更新」即可在 app 内直接下载对应的 arm64 安装包并显示进度，下载完成后自动打开，拖入「应用程序」即可完成更新；不再需要手动去浏览器下载。
- **检查更新指向本 fork** — 更新检查现在读取本 fork 的 Releases（独立 `-y.N` 版本线），不再跟随上游。

### 承接上一版（Fork）

- **应用内网络代理** — 设置 → 通用里可配置出站网络代理，应用到所有出站路径（native / OAuth / model-discovery），honor NO_PROXY 保护本机回环。
- **Claude Code CLI 登录作为 Provider**（SDK Runtime）。
- **默认面板与已完成工具默认折叠**。

### 说明

- 本 fork 只发布 **macOS Apple Silicon（arm64）** 构建。
- 构建为 ad-hoc 签名、未 notarize：首次打开若提示应用「已损坏 / 无法验证开发者」，右键点按选择「打开」，或执行 `xattr -dr com.apple.quarantine /Applications/CodePilot.app`。

### 上游基线

完整的上游 v0.66.0 更新内容见上游仓库 op7418/CodePilot 的 v0.66.0 Release。
