## CodePilot v0.66.0-y.3（Fork 版）

> 基于上游 CodePilot v0.66.0 的个人 fork 构建。本版修复会话列表时间显示，并作为 y.2 → y.3 一键自动更新的验证版本。

### 本版修复（Fork）

- **会话列表时间显示** — 7 天以上的会话原先只显示年份（如「2026」），现改为紧凑日期：当年显示「月/日」（如 `7/31`），跨年显示带两位年份（如 `7/6/25`）。

### 自更新闭环（Fork）

- **一键更新（半自动）** — 检测到新版本后点「安装更新」即可在 app 内直接下载 arm64 安装包（带进度），完成后自动打开，拖入「应用程序」即可完成更新。
- **检查更新指向本 fork** 的 Releases（独立 `-y.N` 版本线）。

### 承接前版（Fork）

- 应用内网络代理（设置 → 通用，覆盖所有出站路径，honor NO_PROXY）。
- Claude Code CLI 登录作为 Provider（SDK Runtime）。
- 默认面板与已完成工具默认折叠。

### 说明

- 本 fork 只发布 **macOS Apple Silicon（arm64）** 构建。
- 构建为 ad-hoc 签名、未 notarize：首次打开若提示应用「已损坏 / 无法验证开发者」，右键点按选择「打开」，或执行 `xattr -dr com.apple.quarantine /Applications/CodePilot.app`。

### 上游基线

完整的上游 v0.66.0 更新内容见上游仓库 op7418/CodePilot 的 v0.66.0 Release。
