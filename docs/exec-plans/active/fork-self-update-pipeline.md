# Fork 自更新与发布流水线（youcho2/CodePilot）

> 创建时间：2026-08-10
> 最后更新：2026-08-10
> 总状态：📋 待开始（Phase 0 先行）— 方向倾向 Path B（半自动，不 notarize），Path A（真·静默自动更新）作为可选后续，取决于是否办 Apple Developer 账号。

## 背景与上下文（务必先读）

本仓库是 `op7418/CodePilot` 的 fork（`origin=youcho2/CodePilot`，`upstream=op7418/CodePilot`，见 [`docs/rules/fork-sync.md`](../../rules/fork-sync.md)）。用户诉求：**app 里"检查新版本"按钮，点一下能直接更新软件。**

调研结论（source breadcrumbs）：

- **前端 UI 其实已经做好了**：`src/hooks/useUpdate.ts` 的 `UpdateContextValue` 已含 `downloadUpdate()` / `quitAndInstall()` / `downloadProgress` / `readyToInstall` / `isNativeUpdate`；`src/components/layout/UpdateDialog.tsx`、`UpdateBanner.tsx`、`src/hooks/useUpdateChecker.ts` 都在。
- **原生自动更新被特意禁用**：`electron/updater.ts` 是 no-op，注释写明根因——macOS 构建签了 Developer ID 但**没 notarize**，Squirrel.Mac 静默替换后过不了 Gatekeeper，所以退化为"检查 + 提示手动下载"。`electron-updater@6.8.3` 已装但未用。
- **检查逻辑指向上游**：`src/app/api/app/updates/route.ts:6` `GITHUB_REPO = "op7418/CodePilot"`，调 GitHub Releases API 比对版本（`compareSemver`）、按架构挑资产（`selectRecommendedReleaseAsset`）、返回 `downloadUrl`。当前点按钮 = 给上游官方 DMG 的下载链接（`isNativeUpdate:false`）。
- **发布 CI 已随 fork 存在且几乎零基建**：`.github/workflows/build.yml` 在 push `v*` tag 时构建 mac(arm64+x64)/Win/Linux，用 `gh release create` + `secrets.GITHUB_TOKEN`（**GitHub Actions 自动注入，无需配置**）在**当前仓库**建 Release；正文取 `RELEASE_NOTES.md`；`CSC_IDENTITY_AUTO_DISCOVERY:"false"`（**上游自己也未用真证书 / 未 notarize**）。Sentry 相关 secrets 仅用于 source-map 上传，缺失不阻断构建（Phase 0 需实测确认）。

### 两条路（已与用户讨论）

| | Path A｜真·静默自动更新 | Path B｜半自动（本方案主线） |
|---|---|---|
| 机制 | electron-updater / Squirrel.Mac，后台下载→重启安装 | app 内下载 DMG + 进度 + 自动打开，用户拖进 Applications |
| macOS 硬门槛 | **必须 notarize**（Apple Developer $99/年 + Developer ID 证书 + notarize 凭据），否则更新后 app 被 Gatekeeper 判"已损坏" | 不需要 notarize；但下载的 ad-hoc 签名包首次打开仍有 Gatekeeper 摩擦（右键打开 / `xattr -dr com.apple.quarantine`） |
| Windows | 不需要 notarize，NSIS + electron-updater 直接可静默更新（未签名只触发一次 SmartScreen） | 同 mac，下载 + 打开安装 |
| 工作量 | 重写 `electron/updater.ts` + IPC + 签名/公证流水线 + feed 发布 | 前端已就绪，主要是 IPC 下载 + 打开 + 改 feed 源 |

**倾向 Path B**：省 $99/年与公证配置；上游用户现状也是手动装。若用户后续办了 Apple Developer 账号，再走 Path A（本计划 Phase 3 预留）。

## 状态

| Phase | 内容 | 状态 | 备注 |
|-------|------|------|------|
| Phase 0 | Fork 发布流水线打通（启用 Actions / 版本号策略 / 首个 Release 实测） | 📋 待开始 | 需用户在 GitHub 启用 fork Actions |
| Phase 1 | 更新检查源指向 fork（改 `GITHUB_REPO`）+ 无 Release 时的降级文案 | 📋 待开始 | 依赖 Phase 0 有 Release 后才切，否则永远"已是最新" |
| Phase 2 | Path B 半自动：app 内下载 DMG + 进度 + 自动打开/Finder 高亮 | 📋 待开始 | 复用现有 `downloadUpdate()` 接口；需 electron IPC |
| Phase 3 | （可选）Path A 真·自动更新：重写 `electron/updater.ts` + 公证流水线 | ⏸ 暂缓 | 取决于是否办 Apple Developer 账号 |

## 决策日志

- 2026-08-10：确立主线为 Path B（半自动，不 notarize），Path A 作为需 Apple Developer 账号的可选后续。理由：省成本、与上游现状一致、前端已就绪、macOS 静默更新绕不开 notarize 是苹果硬限制。
- 2026-08-10：**版本号必须与上游岔开**（见下"版本策略"）。更新检查用 `compareSemver(fork最新Release, 当前app版本)`，且 `build.yml` 有硬门禁 `package.json version == tag version`；若 fork 沿用上游 `0.66.0` 会判"无更新"并与上游 tag 撞车。
- 2026-08-10：`GITHUB_REPO` 的切换**必须在 fork 已有至少一个 Release 之后**再做（Phase 1 依赖 Phase 0），否则 fork Releases 为空 → 检查恒返回"已是最新"，反而丢掉现在能看到上游更新的能力。

## 详细设计

### Phase 0 — Fork 发布流水线

**用户会看到什么**：push 一个 fork tag 后，`youcho2/CodePilot` 的 Releases 页自动出现带 DMG/zip 的 Release。
**本阶段不做**：不改 app 内检查逻辑（仍指上游）。

步骤：
1. **用户操作**（我做不了）：在 `github.com/youcho2/CodePilot` → Settings → Actions → 允许 Actions（fork 默认关闭）。
2. **版本策略**：给 fork 独立版本线。方案：`package.json` version 用 `-ych.N` 预发布后缀（如 `0.66.0-ych.1`），或直接进位到上游未占用的号段。每次发版递增。需确认 `compareSemver`（`src/lib/compare-semver.ts`）对预发布后缀的比较行为，避免 `0.66.0-ych.1` 被判 < `0.66.0`。→ Phase 0 先加一条针对性单测。
3. **首个 Release 实测**：改 version + 写 `RELEASE_NOTES.md` → commit（在 `codepilot/main`）→ `git tag <fork版本> && git push origin <tag>` → 观察 `build.yml` 是否绿、Release 是否带正确命名资产（`CodePilot-<version>-<arch>.dmg`）。
4. **实测确认**：Sentry secrets 缺失时 `build.yml` 是否仍绿（若阻断则加 guard 或补空 secret）。

### Phase 1 — 检查源指向 fork

**用户会看到什么**：app"检查新版本"开始对比 fork 的 Releases。
1. `src/app/api/app/updates/route.ts:6` → `GITHUB_REPO = "youcho2/CodePilot"`。
2. fork Releases 为空/私有/限流时已有 `noUpdatePayload` 降级（保持）。
3. （可选装饰）`AboutSection.tsx:413/422/431`、`ProviderDoctorDialog.tsx`、`FeatureAnnouncementDialog.tsx` 的 op7418 跳转链接按需改到 fork。
4. 注意：本改动在 `codepilot/main`，每次 rebase 上游此文件可能一行小冲突。

### Phase 2 — Path B 半自动下载安装

**用户会看到什么**：横幅点"更新"→进度条→下载完成自动打开 DMG（或 Finder 高亮），用户拖进 Applications。
1. 主进程加 IPC：`ipcMain.handle('update:download', url)` 用 Electron `net`/`session` 下载到临时目录，`webContents.send('update:progress', pct)` 回报进度；完成后 `shell.openPath(dmgPath)` 或 `shell.showItemInFolder`。
2. preload 暴露 `window.electron.downloadUpdate/onUpdateProgress`。
3. 前端 `useUpdate` 的 `downloadUpdate()` 接到 IPC（现在多半是浏览器 `window.open` 降级）；`downloadProgress` 绑进度事件。
4. 文案：明确告知"下载后需手动拖入 Applications；首次打开若提示已损坏，右键→打开"。

### Phase 3 —（可选，暂缓）Path A 真·自动更新

前置：用户办 Apple Developer Program（$99/年）+ Developer ID Application 证书 + notarize 凭据。
1. `electron/updater.ts` 用 `autoUpdater`（electron-updater）：`checkForUpdates → downloadUpdate → quitAndInstall`，事件经 IPC 给渲染层（`isNativeUpdate:true`）。
2. `electron-builder.yml`：`publish.owner/repo` → `youcho2`；`notarize:false` → 配置；`after-sign.js`/afterSign 接 notarize。
3. CI：`build.yml` 注入 `CSC_LINK`/`CSC_KEY_PASSWORD` + notarize 凭据 secrets；发布 `latest-mac.yml` + zip 到 fork Releases（zip 已在 target 内）。
4. Windows 可先单独启用（不需公证）。

## 验收标准

- Phase 0：fork tag → 绿 CI → Releases 出现命名正确的 DMG/zip。
- Phase 1：app 检查按钮命中 fork 最新 Release；版本比对方向正确（`-ych.N` 递增被判为"有更新"）。
- Phase 2：点更新→真实下载 fork DMG→进度到 100%→自动打开；反例：无网络/limit 时降级不崩。
- Phase 3（若做）：packaged 已 notarize app 在 /Applications 内点更新→重启后为新版本、能启动（过 Gatekeeper）。

## Smoke Ledger（真实凭据 / UI / E2E 验证记录）

> 跑了真实 smoke 后必须在这里登记一行。

| Date | Runtime | Provider | Model | 凭据形态 | 场景 | Result | Evidence |
|------|---------|----------|-------|---------|------|--------|----------|
| _示例_ | n/a | GitHub Actions | n/a | GITHUB_TOKEN 自动 | fork tag → Release | ⏳ | 待 Phase 0 |
