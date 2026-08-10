# Fork 自更新与发布流水线（youcho2/CodePilot）

> 创建时间：2026-08-10
> 最后更新：2026-08-10
> 总状态：🔄 Phase 0 ✅ 已完成（fork 发布流水线端到端跑通，首个 Release `v0.66.0-y.1` 已产出 arm64 DMG）；Phase 1/2 待开始 — 方向 Path B（半自动，不 notarize），Path A 作为需 Apple Developer 账号的可选后续。fork 只出 macOS arm64。

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
| Phase 0 | Fork 发布流水线打通（启用 Actions / 版本号策略 / 首个 Release 实测） | ✅ 已完成 | `v0.66.0-y.1` tag → CI 绿 → Release 已建，`/releases/latest` 正确返回，arm64 DMG/zip 产出 |
| Phase 1 | 更新检查源指向 fork（改 `GITHUB_REPO`）+ 无 Release 时的降级文案 | ✅ 已完成 | `route.ts` `GITHUB_REPO` → `youcho2/CodePilot`；fork 已有 Release，降级用现成 `noUpdatePayload`；UI 跳转链接（AboutSection 等）仍指上游，装饰性，暂不改 |
| Phase 2 | Path B 半自动：app 内下载 DMG + 进度 + 自动打开/Finder 高亮 | 🟡 Code complete + Tests pass | 新增 `appUpdate` IPC（下载+进度+打开），非侵入不触发 native 模式；UI 复用进度条 + 「拖入 Applications」文案。运行时点击 smoke 待 y.2 packaged app |
| Phase 3 | （可选）Path A 真·自动更新：重写 `electron/updater.ts` + 公证流水线 | ⏸ 暂缓 | 取决于是否办 Apple Developer 账号 |

## 决策日志

- 2026-08-10：确立主线为 Path B（半自动，不 notarize），Path A 作为需 Apple Developer 账号的可选后续。理由：省成本、与上游现状一致、前端已就绪、macOS 静默更新绕不开 notarize 是苹果硬限制。
- 2026-08-10：**版本号必须与上游岔开**（见下"版本策略"）。更新检查用 `compareSemver(fork最新Release, 当前app版本)`，且 `build.yml` 有硬门禁 `package.json version == tag version`；若 fork 沿用上游 `0.66.0` 会判"无更新"并与上游 tag 撞车。
- 2026-08-10：`GITHUB_REPO` 的切换**必须在 fork 已有至少一个 Release 之后**再做（Phase 1 依赖 Phase 0），否则 fork Releases 为空 → 检查恒返回"已是最新"，反而丢掉现在能看到上游更新的能力。
- 2026-08-10（首个 fork tag CI 失败 → 修复）：`v0.66.0-y.1` 首跑 CI，`verify-source` ✅（版本门禁 OK），但 mac/win/linux build job 全 ❌，`release` skipped。根因是 **"Upload source maps to Sentry" 步在 fork 缺 `SENTRY_AUTH_TOKEN` 时硬失败**（`next build` 本身成功），级联跳过 Package/Release。修复：给 `build.yml` 三处 sourcemap 上传步加 guard——无 `SENTRY_AUTH_TOKEN` 则打印跳过并 `exit 0`（fork 不接上游 Sentry，未来配了 secret 自动启用）。两个 packaged telemetry smoke 步有 `if: workflow_dispatch && telemetry_smoke` 守护，tag push 不触发，无需改。tag y.1 未产出任何 Release，移动 tag 安全。
- 2026-08-10（Phase 2 code complete）：实现 Path B 半自动下载。设计上刻意用**独立** `appUpdate` IPC（`electron/updater.ts` 的 `downloadAndOpenInstaller`：https 流式下载+重定向+host 白名单校验→进度事件→`shell.openPath`），**不**复用 `updater` 命名空间，避免把 `isNativeUpdater` 翻真而破坏现有浏览器检查。渲染层 `useUpdateChecker` 浏览器分支改为：有 `appUpdate` 就 app 内下载+进度+打开，否则回退 `window.open`；`UpdateDialog` 复用进度条并加「安装包已打开，拖入 Applications；若提示已损坏右键打开」文案（en/zh）。改动：electron updater/main/preload、electron.d.ts、useUpdateChecker、UpdateDialog、i18n。踩坑：① 全套单测一度 545 失败，查明是 better-sqlite3 ABI 中间态（143/node25）glitch，`npm rebuild` 后恢复，与改动无关；② 因上一轮把 build.yml 改 mac-only，三条发布 workflow 契约测试（electron-packaging-hygiene / telemetry-build-wiring / telemetry-smoke）失效，按 mac-only 更新并保留安全不变量（source-maps-private / auth-token-server-only / mac 严格门禁）。全套 5184 pass / 0 fail。**运行时点击下载 smoke 待 y.2 packaged app 验收。**
- 2026-08-10（Phase 0 ✅ 完成）：mac-only run 全绿（verify-source/build-macos/release 均 success），Release `CodePilot v0.66.0-y.1` 建成（`prerelease=false, draft=false`），资产 `CodePilot-0.66.0-y.1-arm64.dmg`(160MB) + `.zip` + `SHA256SUMS.txt`。实测 `/releases/latest` 正确返回该版本 —— 证明 `--latest` + `-y.N` 版本线对 app 更新检查（`/releases/latest` + `compareSemver`）成立，Phase 1 前提就绪。中途踩坑两处已修（Sentry sourcemap guard + Windows PowerShell shell）后因用户决定 mac-only 而整体简化。旧遗留全平台 run 由用户取消，无冲突 Release。
- 2026-08-10（用户决定：只支持 macOS arm64）：Windows source-map 步用 PowerShell 再次失败后，用户决定 fork 只出 macOS Apple-Silicon 包。重构 `build.yml`：删掉 `build-windows` / `build-linux` 两个 job，`build-macos` 改 `--mac --arm64`（去掉 x64）、verify 步 arch 循环只留 arm64，`release` 的 `needs` 只留 `[build-macos]`，头部注释与 `workflow_dispatch` 选项同步收窄。js-yaml 校验通过（jobs: verify-source/build-macos/release）。产物只有 `CodePilot-<ver>-arm64.dmg` + zip。
- 2026-08-10（第二轮 CI：mac/linux ✅，Windows 仍 ❌ → 修复）：guard 用 bash 语法（`[ -z ]`/`exit 0`），但 **Windows runner 默认 shell 是 PowerShell**，解析失败；mac/linux 默认 bash 所以过了。修复：三处 sourcemap 上传步显式加 `shell: bash`。
- 2026-08-10（Phase 0 部分实施）：核对 `build.yml` —— `gh release create ... --latest`（非 `--prerelease`），故 `0.66.0-y.1` 这种预发布号仍会被标为 latest，`/releases/latest` 能返回；版本门禁 `package.json==tag`，tag 用 `v0.66.0-y.1`；CI 用 node 20（better-sqlite3 编译无 node26 问题）。确认 `compareSemver`（`src/lib/compare-semver.ts`）已正确处理 `-y.N`（`y.2>y.1`、`y.10>y.9` 数字序、`0.66.0-y.1<0.66.0`），无需改实现，新增 5 条锁定测试（`compare-semver.test.ts`，15/15 通过）。已把 `package.json` + `package-lock.json`(2 处) 版本改为 `0.66.0-y.1`，`RELEASE_NOTES.md` 改为 fork 版说明。待用户手动启用 fork Actions 后打 tag 实测 CI。

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
| 2026-08-10 | GitHub Actions (macos-15) | GitHub Releases | n/a | GITHUB_TOKEN 自动注入 | push tag `v0.66.0-y.1` → build mac arm64 → 建 Release | ✅ | run 31368329059 全绿；Release `v0.66.0-y.1`（arm64 dmg 160MB + zip）；`/releases/latest` 返回该版本 |
| 2026-08-10 | GitHub Actions (macos-15) | GitHub Releases | n/a | GITHUB_TOKEN 自动注入 | push tag `v0.66.0-y.2`（含 Phase 1+2）→ build → 建 Release | ✅ | run 31371231801 全绿；Release `v0.66.0-y.2`（arm64 dmg 160MB + zip） |
| 2026-08-10 | Electron packaged (arm64) | n/a | n/a | n/a | 用户装 y.2 packaged app，运行正常 | ✅ | 用户确认「已安装验证了，没有问题」 |
| _进行中_ | Electron packaged (arm64) | GitHub Releases | n/a | n/a | y.2 检测到 y.3 → 点「安装更新」→ app 内下载+进度+打开 → 拖入 Applications | ⏳ | 已发 y.3 供 y.2 检测；完整 detect→download→open 待用户在 y.2 上点一次验收 |
