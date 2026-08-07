# 0.65 Production Observation Remediation

> 创建时间：2026-08-07
> 最后更新：2026-08-07

## 状态

| Phase | 内容 | 状态 | 备注 |
|---|---|---|---|
| Phase 0 | 只读生产数据取证与代码调用链核对 | ✅ 已完成 | official `codepilot-desktop` / production / `codepilot@0.65.0`；未修改 Sentry 外部状态 |
| Phase 1 | IP/Geo 隐私 tombstone + Electron Release Health 启动 session | ✅ 已完成 | 保持 U0，不新增 user/install id 或行为分析 |
| Phase 2 | Windows 外链打开拒绝的有界失败处理 | ✅ 已完成 | 消费 Promise rejection，并给用户明确系统提示 |
| Phase 3 | `AI_MissingToolResultsError` 工具历史完整性修复 | ✅ 已完成 | 修未来持久化与既有损坏历史，不屏蔽错误 |
| Phase 4 | Tier 2 回归、守卫与发布后 cohort 验证 | 🔄 进行中 | `v0.66.0` tag CI 与跨平台 packaged gates 已通过；真实 Sentry 24h/72h cohort 与用户路径 smoke 待执行 |

## 用户结果

- 用户会看到：Windows 没有可处理 HTTP(S) 链接的默认应用时，CodePilot 不再产生未处理 Promise rejection，并会显示可行动的失败提示。
- 用户会看到：停止、异常中断或事件丢失留下的残缺工具调用，不再让下一条消息直接失败；历史中只补“本回合结束前未收到结果”的诚实错误结果，不宣称工具成功或失败执行。
- 后台结果：Sentry error event 明确携带 `user.ip_address = null`，阻止服务端根据连接地址补 IP/Geo；Electron main session 在启动时立即发送，使长驻托盘应用无需等退出也能形成 Release Health 分母。
- 本轮明确不做：不新增 DAU/MAU、installation id、设备指纹、行为事件；不批量 resolve Sentry Issue；不把 GPU/React/MCP 噪声或 Provider 错误扩大成同一轮无关重构。

## Signal → Triage → Fix → Verify → Guardrail

### Signal

2026-08-07 对 official `codepilot-desktop` 做只读复核：

- 0.65 的真实 Next server error event 在 `sendDefaultPii:false` 且 sanitizer 删除 `user` 后，Sentry 仍出现 IP 与国家/地区，证明“删除 user”不足以阻止 ingest 推断。
- `codepilot@0.65.0` 的 project release metadata 为 `hasHealthData:false`；Electron SDK 默认 `MainProcessSession` 只有退出/异常时才发送，长驻托盘模型不能依赖干净退出形成及时分母。
- `AI_MissingToolResultsError` 在 0.65 仍活跃；真实 symbolicated stack 在 AI SDK `convertToLanguageModelPrompt` 检测到 assistant tool-call 在下一条 user/system/end 前没有匹配 tool-result。
- Windows `shell.openExternal()` 拒绝被全局 `unhandledrejection` 捕获；两个主窗口导航入口都丢弃了返回 Promise。

### Triage

1. **隐私**：代码侧必须发送显式 null tombstone，不能把字段删除后交给服务端猜测；Sentry project 的 Prevent Storing IP Addresses 仍是发布侧纵深防御，代码不能冒充已修改外部设置。
2. **Release Health**：继续只留一个 Electron `MainProcessSession`，但把默认实例替换为 `sendOnCreate:true`；renderer/server session 仍关闭。
3. **工具历史**：`stream-session-manager` 会持久化只有 `tool_use`、没有 `tool_result` 的终止回合；下一轮 `buildCoreMessages` 原样重放，触发 SDK 结构校验。未来写入与 legacy replay 两侧都要修复。
4. **外链**：安全白名单无需变化；只为已经判定为 HTTP(S) external 的调用补 Promise 所有权、稳定日志和本地化失败提示。

### Fix

- `sanitizeTelemetryEvent` 用 `{ ip_address: null }` 替换全部 user 内容；保留无身份、无 did 的 U0 语义。
- Electron integration 配置将唯一 `MainProcessSession` 替换为 `Sentry.mainProcessSessionIntegration({ sendOnCreate:true })`，不得追加第二个 producer。
- 抽出可行为测试的 external opener，统一两个入口；错误日志不含 URL、query 或原始系统错误正文。
- terminal persistence 对无匹配结果的 tool use 追加 app-owned、`is_error:true` 的缺失结果；模型历史装配再修复旧数据，并丢弃无法安全表达的 orphan result。

### Verify

- 定向：telemetry contract/sanitizer/build wiring、Electron navigation、stream final content、message builder、context pruner/Native loop pairing。
- 全量：`npm run test`。
- 构建：`npm run build`；若工作区已有无关变更导致失败，必须单独记录，不把失败冒充本轮通过。
- 发布后：单一新 stable release 验证 event 无 IP/Geo、release `hasHealthData:true`、MissingToolResults 不再新增、Windows packaged 外链失败有提示且无 unhandled rejection。

2026-08-07 本地结果：

- 两次经工具捕获超大默认 TAP stdout 的 `npm run test` 都完成 typecheck 与 harness boundary，但单测汇总为 5146 pass / 1 fail / 1 skip；约 28 万 token 的截断输出未保留失败名。
- 同一 5148 个文件集改用 JUnit、TAP-to-file，以及最后的 TAP stdout + JUnit 双 reporter 独立重跑，均为 5147 pass / 0 fail / 1 skip。失败对 reporter/输出时序敏感，当前没有可复现到具体用例的产品回归；本计划不把它冒充全量默认命令零失败。
- 真实 SDK/transport 对照测试通过：损坏历史在修复前触发 `AI_MissingToolResultsError`、修复后到达 mock model；Sentry Node envelope 明确序列化 `user.ip_address:null` 且不含 id/email。
- `npm run build` 通过；保留一条既有 Next NFT whole-project trace warning，不冒充本轮新增失败。
- `npm run lint:docs-drift`、`npm run lint:hooks`、`git diff --check` 均通过。
- `v0.66.0` 发版候选重新验证：typecheck、Harness boundary、5148 单测（5147 pass / 0 fail / 1 skip）与 production build 全部通过。

### Guardrail

- `SentryTelemetry.md` 增加 infer-IP tombstone 与 main session send-on-create 契约。
- `ElectronMain.md` 增加所有 `shell.openExternal` Promise 必须被消费且失败不得记录 URL 的契约。
- `StreamSession.md` 增加 persisted/replayed tool-call 必须有真实或 app-owned missing result 的契约。

## Smoke Ledger（真实凭据 / UI / E2E 验证记录）

| Date | Runtime | Provider | Model | 凭据形态 | 场景 | Result | Evidence |
|---|---|---|---|---|---|---|---|
| 2026-08-07 | Sentry API | official `codepilot-desktop` | `codepilot@0.65.0` | 本地只读 token | MissingToolResults symbolicated event + user/IP/Geo + release health metadata | ✅ 只读取证完成 | event `55fe138bafc54c7dbf7912ed76c6bbcd`；输出已脱敏，未写 Sentry |
| 2026-08-07 | local Node + Next production build | local checkout | `codepilot@0.65.0` | 无真实用户凭据 | unit/typecheck/harness、真实 SDK/transport contract、production build、docs/hook/diff gates | ✅ 本地门禁通过 | 单测稳定重跑 5147 pass / 0 fail / 1 skip；`npm run build` 通过 |
| 2026-08-07 | local Node + Next production build | local checkout | `codepilot@0.66.0` RC | 无真实用户凭据 | 发版版本 typecheck / Harness boundary / 5148 单测 / production build | ✅ 本地门禁通过 | 5147 pass / 0 fail / 1 skip；build 136 pages；既有 NFT warning 保留 |
| 2026-08-07 | Electron packaged CI | official stable | `codepilot@0.66.0` | official release secrets | macOS/Windows/Linux 双架构 build、source map、package version/native ABI/server startup、macOS packaged Sentry fixtures | ✅ CI packaged gates pass | [Build & Package #31155340623](https://github.com/op7418/CodePilot/actions/runs/31155340623)；[Release v0.66.0](https://github.com/op7418/CodePilot/releases/tag/v0.66.0)；12 assets uploaded |
| _待观察_ | Electron packaged / Sentry API | official stable | `codepilot@0.66.0` | 用户 opt-in + 只读 Sentry token | no-IP event / startup session / MissingToolResults 24h/72h cohort / Windows external-open + interrupted tool replay | ⏳ | CI synthetic 证明打包链路；仍不替代真实用户状态、Windows 交互和发布后 cohort |

## 决策日志

- 2026-08-07：不把本轮并入 `sentry-telemetry-reliability.md` 的产品缺陷主线；该计划继续负责遥测可信度，本计划承接干净数据暴露出的跨模块产品修复。
- 2026-08-07：不删除残缺 tool-call 后假装历史完整；用明确 app-owned error result 表达“未收到结果”，既保持配对协议，也不伪造执行成功。
- 2026-08-07：不依赖长驻应用最终退出发送 session；启动即发送一次，退出/崩溃仍由同一个 session producer 更新状态。
- 2026-08-07：不在本地代码任务中擅自修改 Sentry project 设置；Prevent Storing IP Addresses 作为发布侧待核验纵深防御保留。
- 2026-08-07：用户在 Code complete + Tests pass + Review passed 后明确授权 push 与发版；目标版本确定为 `v0.66.0`。该授权接受以 tag CI 产出 packaged artifacts，但不把尚未发生的真实 Sentry cohort / Windows packaged 验证提前写成 Smoke passed。
- 2026-08-07：`d983917f` 已推送 main 并标记 `v0.66.0`；Build & Package run `31155340623` 的 verify-source、macOS、Windows、Linux x64/arm64 与 release job 全部 success。GitHub Release 为非 draft、非 prerelease，12 个安装包/校验和 assets 均 uploaded。状态可记为 Shipped，但本计划 Phase 4 仍等待真实 Sentry cohort 与用户交互 smoke。
