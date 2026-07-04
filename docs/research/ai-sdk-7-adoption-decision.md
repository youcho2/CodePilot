# AI SDK 7 Native Runtime 采用决策（Phase 5 决策门）

> 创建时间：2026-07-04（Phase 5，run issue #10）
> 关联执行计划：[AI SDK 7 Runtime 接入](../exec-plans/active/ai-sdk-7-runtime-loop-adoption.md) Phase 5
> 输入证据：Phase 1-5 全部 ledger/测试/smoke（逐条结论标注来源）
> **本文档是建议，不是执行**：默认 Runtime 的任何切换留人类闸门（Loop Operating Rules），本 phase diff 未触碰默认聊天路径。

## 结论：**partial**（采用依赖升级与外围能力；不替换默认 agent loop）

| 决策项 | 结论 | 证据来源 |
|--------|------|---------|
| ① `ai@7` + `@ai-sdk/*` 依赖升级 | **go**（已在 spike 分支落地，可随分支合并） | Phase 1：3497 基线测试升级前后全过 + `npm run build` + Electron bundle（决策日志 2026-07-02，issue #1）；Phase 2-5 全部工作都跑在 ai@7 上，当前全量 3598+ 测试绿 |
| ② Provider 参数能力（reasoning/effort/tool choice/files） | **go（capability-gated）**——按矩阵逐渠道开放，不做假支持 | Phase 2：29 sanitized fixture + [矩阵](./ai-sdk-7-provider-request-shape-matrix.md)；live smoke 网关实测（OpenRouter reasoningTokens=117 语义生效、named tool_choice 生效；issue #6）；官方一方 key smoke 仍是 open gate（发版前必补，见 rollback 节） |
| ③ image 裸 base64 收口 | **go**（wrapper 已落地，upstream 修复自动 no-op） | Phase 2 fix 轮：`openai-chat-image-normalizer.ts` + 12 测试 + upstream drift 报警 fixture（issue #6，Codex accepted） |
| ④ timeout 原因码 / approval HMAC / trace 脱敏 | **go**（默认值已经用户确认：HMAC 默认开、trace 默认关、timeout 预算默认关） | Phase 4：3594 测试（timeout 17 + approval 12 + trace 4）+ Codex 两轮 review 修复 P1（first-token 计时起点、guardStream 挂死）后 accepted（issue #8）；[可发布清单](./ai-sdk-7-phase4-shippable-capabilities.md) |
| ⑤ `@ai-sdk/mcp` adapter | **no-go（现在）**——保持 POC，生产 MCP 零改动 | Phase 4：POC 复用生产 `wrapWithPermissions`，smoke 3/3，但仅 devDependency、无生产收益证据（issue #8） |
| ⑥ **默认 agent loop 替换为 ToolLoopAgent** | **no-go（现在）**——维持手写 `agent-loop.ts` | 本文档核心论证，见下节；Phase 3 partial adopt 结论（issue #7）+ Phase 5 gap 收口与三场景对照（issue #10） |

## ⑥ 的论证：为什么不替换默认 loop

**能力面：替换不带来新能力。** 两个实现底层同为 `streamText`；Phase 4 的四项能力
（timeout / approval HMAC / trace / MCP POC）全部落在手写 loop 上，没有任何已立项
能力被证明必须依赖 ToolLoopAgent（Phase 4 issue #8 accepted；gap #3 降级论证）。

**风险面：差异集中在错误/中断尾部——最影响用户信任的路径。** Phase 3 side-by-side
实证：naive 替换会把失败轮/中断轮的 usage 持久化成正常轮形状（假数据面，gap #1/#2）。
补偿可行且已被 8 条 parity 测试锁定，但那是**维护成本**（每次 SDK 升级都要重新验证
尾部语义），不是一次性成本。

**Parity 完成度（若未来要替换，harness 已就绪）：**
- 逐事件 SSE / 逐请求 wire deepEqual / DB 逐字节 / permission approve/deny/abort
  全序列 parity——`toolloop-poc-parity.test.ts` 8/8（2026-07-04 复跑绿，issue #10）。
- 三类真实场景对照（Phase 5 required checks，OpenRouter chat skin /
  claude-haiku-4.5，证据 `_smoke-evidence/ai-sdk7-phase5-decision-smoke.json`）：
  - **长文本**：7060/7318 字符流式输出，归一化事件序列相同
    （`status,rewind_point,text*,status,result,done`），result 携带 usage，
    input_tokens 完全相同（9821），output 差异为 sampling。
  - **tool call + approval 批准分支**：两 loop 都发 permission_request →
    程序化 allow → Bash 真执行（tool_result 均含 `APPROVAL-MARKER-9152`）→
    finishReasons `tool-calls,stop` → result/done，序列相同。
  - **tool call + approval 拒绝分支**：两 loop 的 deny 均以
    `Permission denied by user: …` 进 tool_result，loop 继续、模型如实汇报、
    done 收尾，序列相同。
  - **abort → continue**：中断轮两 loop 都以 done 收尾、无 error 气泡
    （中断落纯文本步 → 双方都发 result，与 gap #2 记录的不对称语义一致）；
    同 session 续发 `RESUMED OK` 一次通过（prod/poc output_tokens 均为 6）——
    loop 层无卡死残留。范围注记：composer `phase` 卡死属
    stream-session-manager/UI 层，本对照证明的是 loop 层前置条件
    （流以 done 关闭 + 同 session 可续发）。
- Gap list 全部处置完毕：P1×3 关闭（#1/#2 补偿+测试锁定；#3 降级论证——Phase 4
  已证 approval HMAC 不需要 SDK 停机语义），P2×4 关闭或 backlog（#7 → tech-debt
  #49），P3×2 关闭。见 [parity gaps 文档 Phase 5 处置节](./ai-sdk-7-toolloop-parity-gaps.md)。

**结论**：收益 ≈ 0、风险集中在信任路径、补偿有持续维护成本 → 维持手写 loop。
POC adapter + parity 套件 + Phase 5 对照 smoke 脚本保留为迁移 harness：未来若 SDK
出现只在 Agent 层暴露的必需能力（如 SDK 级 per-tool timeout），重启评估时直接以
它们为回归门禁。

## 若未来走替换路线的前置条件（从 backlog 拉回）

1. gap #4：引入 client-executed tool 前补 no-execute 工具续跑判据 parity 用例。
2. gap #5：补 >RECENT_TURNS_TO_KEEP（16 条）长轮的 wire parity fixture 用例。
3. 官方一方 Anthropic / OpenAI key 的 live smoke（Phase 2 open gate）。
4. 全量 parity 套件 + Phase 5 对照 smoke 在目标 SDK 版本上重跑绿。

## Rollback plan

分层回滚，从轻到重（当前状态：均未触发，本 phase 无默认路径改动可回滚）：

| 层 | 触发条件 | 回滚动作 | 依据 |
|----|---------|---------|------|
| 能力开关层 | Phase 4 某项能力在真实使用中出问题 | 各能力自带默认关/可关开关：timeout 预算默认全关（`CODEPILOT_NATIVE_TIMEOUTS` / options.timeouts 不配即关）；trace 默认关（`CODEPILOT_AISDK_TRACE=1` 显式开）；approval HMAC 是 route 层校验，回滚=revert 单 commit（无 DB schema 依赖，token 无状态） | Phase 4 设计（[可发布清单](./ai-sdk-7-phase4-shippable-capabilities.md)）；用户已确认默认值（2026-07-04 决策日志） |
| wrapper 层 | `@ai-sdk/openai` 升级修复 image bug | fixture `openai-chat-file-image-upstream-bare-base64` drift 报警 → 撤 `withChatImageDataUrlFetch` wrapper（wrapper 对已带 `data:` 前缀输入自动 no-op，不撤也不双前缀） | Phase 2 fix 轮设计（issue #6） |
| runtime switch 层 | （未来）若替换默认 loop 后出现语义回归 | POC 与生产 loop 共享 `AgentLoopOptions` 契约——切换点是 route 层单一 import（`runAgentLoop` ↔ `runToolLoopAgentPoc` 形态）；建议实施时做成 feature flag（env 或 settings），回滚=翻 flag，不需要 revert | Phase 3 adapter 设计：同输入类型、同 SSE 契约（parity 测试锁定） |
| known-good version 层 | ai@7 依赖本身出不可补偿回归 | 回退 `package.json`/lockfile 到 main 的 `ai@^6.0.169` 基线 commit（spike 分支未合并前 main 即 known-good；合并后以合并前最后一个 main commit 为 known-good tag）；破坏面已知且机械：`LanguageModelUsage` 4 行 usage 字段适配反向改回 | Phase 1 spike：唯一破坏面记录（决策日志 2026-07-02） |

## 遗留 open gate（不阻塞本决策，默认开放/发版前必补）

- 官方一方 Anthropic / OpenAI key live smoke（Phase 2 起持续 open，本机无凭据）。
- 网关对 image data URL 的真实接受度（wrapper 输出形状的 live 验证）。
- ClinePass / OpenCode Go final 复测已完成（2026-07-04）：真实 `/api/chat` UI 后端路径已验证通过——ClinePass GLM-5.2 与 OpenCode Go Anthropic MiniMax M3 均 HTTP 200、SSE `result/done` 收尾、marker 命中。证据见 `docs/exec-plans/completed/_smoke-evidence/ai-sdk7-final-ui-api-provider-smoke-2026-07-04.json`。
- direct SDK smoke 的剩余债务要与产品路径分开看：OpenCode Go Anthropic 的 direct `@ai-sdk/anthropic` 404 是 smoke harness 绕过 resolver 后打错执行面（产品路径走 `claude-code-compat`，会补 `/v1/messages`）；ClinePass direct 非流式 `generateText()` 仍受 `data` 信封影响，需确认是否有标题/摘要/诊断等辅助路径会使用该 provider（tech-debt #48）。
- tool-error part 吞掉的 UX 债（tech-debt #49，独立于本决策）。
