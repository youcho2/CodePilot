## CodePilot v0.66.0-y.1（Fork 版）

> 基于上游 CodePilot v0.66.0 的个人 fork 构建，在上游全部能力之上叠加了以下 fork 自有改动。首个自更新流水线验证版本。

### Fork 自有改动

- **应用内网络代理** — 设置 → 通用里可直接配置出站网络代理，应用到所有出站路径（native / OAuth / model-discovery），并 honor NO_PROXY 保护本机回环流量；无需依赖登录 shell 或系统代理。
- **Claude Code CLI 登录作为 Provider** — 在 SDK Runtime 下正确识别并复用 Claude Code CLI 的登录态作为一个 Provider。
- **默认面板与已完成工具默认折叠** — 聊天界面默认保持面板与已完成工具的折叠态，减少视觉噪音。

### 说明

- 本版本用于验证 fork 自身的发布与更新流水线（检查更新指向本 fork 的 Releases）。
- macOS 构建为 ad-hoc 签名、未 notarize：首次打开若提示"已损坏 / 无法验证开发者"，请右键 →「打开」，或执行 `xattr -dr com.apple.quarantine /Applications/CodePilot.app`。

### 上游基线

完整的上游 v0.66.0 更新内容（Windows 稳定性、Provider 密钥加密、搜索回退、Sentry 遥测等）见上游仓库 op7418/CodePilot 的 v0.66.0 Release。
