# AI SDK 7 ToolLoopAgent Side-by-Side POC — Parity Gap List 与结论

> 创建时间：2026-07-03（Phase 3，run issue #7）
> 关联执行计划：[AI SDK 7 Runtime 接入](../exec-plans/active/ai-sdk-7-runtime-loop-adoption.md) Phase 3
> POC 模块：`src/lib/experimental/agent-loop-toolloop-poc.ts`（纯实验路径，默认聊天零改动）
> Parity 证据：`src/__tests__/unit/toolloop-poc-parity.test.ts`（8 测试）+ golden `src/__tests__/fixtures/toolloop-poc-parity/sse-golden-tool-turn.json`
> Live 证据：`scripts/smoke-ai-sdk7-phase3-poc.ts` → `docs/exec-plans/active/_smoke-evidence/ai-sdk7-phase3-poc-smoke.json`

## 结论：**partial adopt**（可替换、但不建议现在替换）

ToolLoopAgent **能够**承载 Native Runtime 的 agent loop：在同一 canned wire 下，
POC 与生产 `agent-loop.ts` 达成了逐事件 SSE parity、逐字段 wire parity（两条 loop
发出的请求体 deepEqual）、DB history 逐字节 parity 和 permission
approve/deny/abort 全序列 parity；真实网关上 text-only / tool call / approval
denied 三场景一次通过。**但**达成 parity 需要两处「尾部语义补偿」（gap #1/#2），
它们恰好落在错误/中断这类最影响用户信任的路径上——SDK 内建 loop 在这两处的默认行
为与手写 loop 不同，naive 替换会直接破坏 SSE/DB 契约。

推荐路线：
1. **不替换** `agent-loop.ts` 为默认实现（Phase 5 决策门维持现状开局）。两个实现
   底层同为 `streamText`，替换本身不带来新能力，却把错误/中断尾部换成需要补偿的语义。
2. **保留** POC adapter + parity 测试套件作为迁移 harness：若 Phase 4 的 timeout /
   toolApproval(HMAC) / DevTools 能力最终要求 SDK 内建 loop（例如 SDK 级 per-tool
   timeout 只在 Agent 层暴露），届时以本 adapter 为起点，parity 套件即回归门禁。
3. Phase 4 第一批能力（timeout、approval HMAC、DevTools、`@ai-sdk/mcp`）优先在现
   有手写 loop 上落地——没有证据表明它们必须依赖 ToolLoopAgent。

**no-go 不成立**（没有发现不可补偿的阻断）；**立即 replace 不成立**（收益不抵尾部
语义风险 + 补偿维护成本）。

## Parity Gap List

分级：P0 = 采用阻断（未发现）；P1 = 破坏用户可见契约、必须补偿或决策；P2 = 语义
差异已论证等价/不可达，留档防漂移；P3 = 观察项。
状态：`已补偿` = POC adapter 内已镜像并有测试锁定；`open` = 留给 Phase 4/5 决策。
**Phase 5 收口（2026-07-04，run issue #10）：全部 gap 已处置——见下方「Phase 5 处置」一节逐条论证；表格保持 Phase 3 原状态作历史记录。**

| # | 级别 | 状态 | 差异 | 影响（若 naive 替换） | 证据 |
|---|------|------|------|----------------------|------|
| 1 | P1 | 已补偿 | Provider 错误轮：`agent-loop` 在 `await result.finishReason` 处抛出（NoOutputGeneratedError）→ catch 尾部发 `AGENT_ERROR` error 事件、**不发 result 事件**；ToolLoopAgent 的 fullStream 遇错**正常收尾不抛** | 失败轮会多发一个 result 事件 → chat route 把失败轮的 usage/context_accounting 持久化成正常轮形状（假数据面） | parity 测试「provider error turn」首跑 diff（prod: error+AGENT_ERROR+done vs poc: error+EMPTY_RESPONSE+result+done）；补偿后 8/8 过。补偿点：POC 空响应检查改为 await 同一 promise |
| 2 | P1 | 已补偿 | abort 时末步仍有 pending tool call：`agent-loop` 会尝试继续 while-loop → AbortError → catch 尾部**不发 result**；ToolLoopAgent 优雅收尾 → naive adapter 发出了 result（含 Bash 工具的 context_accounting） | 用户 Stop 后仍持久化半截 usage 行；与现有「中断轮不落 result」语义漂移 | parity 测试「abort while approval is pending」首跑 diff；补偿：`signal.aborted && lastStepHadToolCalls` → 走 agent-loop 的 catch 尾部路径。注意 abort 落在**无** tool call 的步（纯文本中断）时两边都**发** result——该不对称已由「abort mid-stream」测试锁定 |
| 3 | P1 | open（Phase 4/5 决策） | approval 机制取向：CodePilot 在 wrapped `execute()` 内阻塞等待（permission_request/registry/5min timeout 全部同一条活流）；SDK 原生 `toolApproval`/`needsApproval` 会**停机**（loop 终止，需带 approval response 重新 `stream()`） | 若 Phase 4 approval HMAC 走 SDK 原生机制：SSE 事件形态（tool-approval-request part）、composer 可发送态语义、timeout 语义全变，等于换掉权限边界的交互模型 | POC 刻意不用 SDK approval（adapter 头注释）；本轮 approve/deny/abort parity + registry timeout 既有测试（permission-registry-finalize.test.ts）证明 in-execute 路线 parity 完整 |
| 4 | P2 | open | loop 续跑判据：`agent-loop` 看「上一步是否发出 tool CALL」；ToolLoopAgent 看「上一步是否有 tool RESULT」（无 execute 的工具会停机） | 当前 assembleTools 产出的工具全部带 execute → 不可达；未来引入 client-executed tool 时两者行为分叉 | ai@7.0.11 ToolLoopAgent docstring + adapter 注释；无运行时 repro（不可达） |
| 5 | P2 | open | 逐步剪枝：`agent-loop` 每步对全量历史的**新拷贝**跑 `pruneOldToolResults`；POC 用 `prepareStep` 返回 messages override（**carry forward**，剪枝结果黏着） | 论证等价：pruner 只重写 keep-window（16 条）之外的消息，出窗后不会回窗，故黏着与重剪结果一致。但测试只覆盖 ≤2 步轮次，>16 消息的长轮无 fixture 证据 | adapter 头注释推理；若走替换路线需补一个 >RECENT_TURNS_TO_KEEP 的长轮 wire parity 用例 |
| 6 | P2 | 已确认无差异 | doom-loop「检测」在 `agent-loop` 里是死代码（算 key 从不 break），POC 未搬运 | 无行为差异 | agent-loop.ts:592-600 阅读确认（仅注释与赋值，无动作） |
| 7 | P2 | 已确认无差异 | tool 执行抛错：两边都不转发 fullStream 的 `tool-error` part（switch default 吞掉）→ UI 收不到该工具的 tool_result | 既有 quirk，两边一致（parity 保持）；独立于本 POC 的潜在 UX 债 | 两个 switch 的 default 分支源码对照；未在本轮修（超出 POC 边界） |
| 8 | P3 | 观察 | ToolLoopAgent 会加 agent 归因请求头（agentHeaders → user-agent 链）；请求**体**已证逐字段相等，请求头未全量比对 | 网关按 UA 指纹分流时可能出现差异；本轮 OpenRouter live 未见异常 | wire parity 断言（body deepEqual）+ live smoke 3/3 200 |
| 9 | P3 | 观察 | `onRuntimeStatusChange` 尾部：agent-loop 在 abort 时序列为 streaming→idle(onAbort)→error(catch 尾部)；POC 已镜像该 quirk（abort part → idle，随后 error） | 无 SSE 面差异；status 回调仅日志/遥测用途 | adapter 8a 注释；SSE parity 测试间接锁定（事件面一致） |

## Phase 5 处置（2026-07-04，run issue #10）

> 决策门要求：P1 全部修复或降级论证、P2/P3 归档 backlog 或关闭。最终采用结论见
> [ai-sdk-7-adoption-decision.md](./ai-sdk-7-adoption-decision.md)。

| # | 级别 | Phase 5 处置 | 论证与证据 |
|---|------|-------------|-----------|
| 1 | P1 | ✅ 关闭（补偿+测试锁定） | 补偿代码在 POC adapter（`agent-loop-toolloop-poc.ts` 第 8 节：空响应检查 await 同一 `result.finishReason` promise，错误轮走 catch 尾部不发 result）。2026-07-04 复跑 `npx tsx --test toolloop-poc-parity.test.ts` 8/8 全绿，「provider error turn」测试持续锁定该补偿；机械性确认：补偿是逐行镜像 agent-loop 的既有 throw 路径，无新分支语义 |
| 2 | P1 | ✅ 关闭（补偿+测试锁定） | 补偿代码在 POC adapter 第 8a 节（`signal.aborted && lastStepHadToolCalls` → 走 catch 尾部路径不发 result）。同上 8/8 复跑锁定（「abort while approval is pending」+「abort mid-stream」两测试覆盖对称两侧）；Phase 5 live smoke abort-continue 场景两 loop 行为一致（中断落纯文本步 → 双方都发 result，与既定不对称语义一致） |
| 3 | P1 | ✅ 关闭（降级论证：维持 in-execute 路线，不采用 SDK toolApproval） | 论证：该 gap 的风险前提是「若 approval HMAC 必须走 SDK 原生 toolApproval」——Phase 4 已用事实否定该前提：approval HMAC（`permission-approval-token.ts`，篡改/伪造 403、过期 410、重放 409，12 测试 + route 强制校验）完整落在 **in-execute** 路线上，issue #8 Codex accepted。SDK 停机语义没有任何已立项能力依赖它。in-execute 路线的 parity 证据：unit（approve/deny/abort-while-pending 全序列 + registry 5min timeout 契约）+ Phase 5 live 批准/拒绝两分支两 loop 契约一致（见 smoke evidence）。处置：不迁移 approval 交互模型；若未来能力确需 SDK 停机语义，按决策文档 rollback plan 重开评估 |
| 4 | P2 | 📦 backlog（替换路线前置条件） | 当前 `assembleTools` 产出的工具全部带 execute → 差异不可达（Phase 3 论证未变）。归档为「若未来选择替换路线且引入 client-executed tool，必须先补 no-execute 工具的续跑判据 parity 用例」 |
| 5 | P2 | 📦 backlog（替换路线前置条件） | 等价性论证维持（pruner 只重写 keep-window 外消息，出窗不回窗）；>16 消息长轮 fixture 用例列为替换路线的 must-have 前置（写入决策文档 partial 路线条件），本 phase 按「不替换」结论不补 |
| 6 | P2 | ✅ 关闭 | doom-loop 检测在 agent-loop 内是死代码（只算 key 从不 break），无行为差异；Phase 3 源码对照结论未变 |
| 7 | P2 | 📦 backlog → tech-debt #49 | 两 loop 一致吞掉 `tool-error` part（parity 保持），是独立于采用决策的既有 UX 债；已入 `docs/exec-plans/tech-debt-tracker.md` #49（含修法方向） |
| 8 | P3 | ✅ 关闭（观察无异常） | 请求体逐字段相等已证；Phase 5 live smoke 四场景两 loop 的 `input_tokens` 逐场景完全相同（9821/19699/19685/9826），且全部 200——UA 归因头未引发网关分流差异的又一实证 |
| 9 | P3 | ✅ 关闭 | `onRuntimeStatusChange` 尾部 quirk 已在 adapter 镜像（8a 注释），SSE 事件面无差异，仅日志/遥测用途；SSE parity 测试间接锁定 |

Phase 5 live 对照证据：`scripts/smoke-ai-sdk7-phase5-decision.ts` →
`docs/exec-plans/active/_smoke-evidence/ai-sdk7-phase5-decision-smoke.json`
（OpenRouter chat skin / claude-haiku-4.5，长文本 / approval 批准 / approval 拒绝 /
abort→continue 四场景，prod `runAgentLoop` vs POC `runToolLoopAgentPoc` 逐场景
contractMatch=true；DB 只读、输出零凭据形态）。

## 证据索引（逐项可追溯）

- **SSE parity（逐事件类型）**：`toolloop-poc-parity.test.ts` 6 个 SSE 场景——
  text-only / tool 轮（text delta、tool_use、tool_result、step_complete
  finishReason `tool-calls`→`stop`）/ 401 错误轮 / abort 中断轮 / approval
  approve / deny——normalized 全序列 `deepEqual` + committed golden
  `sse-golden-tool-turn.json`（含全部事件类型的确切 payload 形状）。
- **Wire parity**：同套测试捕获两条 loop 的真实出网请求，逐请求
  `deepEqual(body)`（system/messages/tools/tool_choice/max_tokens），两步轮两请求全比。
- **DB history parity**：chat route SSE 消费逻辑的忠实复刻断言持久化 content
  （structured JSON blocks）+ token_usage + context_accounting 逐字节一致，且
  `buildCoreMessages` 重建的下一轮 wire 历史 `deepEqual`（message / part /
  tool invocation / context accounting 不丢不变形）。
- **Permission parity**：真实 `assembleTools` 权限包装（非 mock）下
  approve（tool 真执行）/ deny（deny 文案进 tool_result、loop 继续）/
  abort-while-pending（registry 落 `aborted`、流以 done 收尾、无 error 气泡）
  全序列一致 + `permission_requests` 表终态一致；timeout 由两条 loop **共享**的
  `wrapWithPermissions` + `permission-registry`（`permission-registry-finalize.test.ts`
  的 5min timeout / onTimeout / permission_resolved 契约）按构造覆盖。
- **Live smoke**（OpenRouter chat skin，anthropic/claude-haiku-4.5，DB 只读取
  凭据、app 数据目录隔离到临时目录、输出全 scrub）：text-only（`POC OK`，
  usage 真实回报）、tool call（Read 真执行，marker 命中，finishReasons
  `tool-calls`→`stop`）、approval denied（permission_request → 程序化 deny →
  `Permission denied by user` 进 tool_result → 模型如实汇报被拒 → done）。
  3/3 一次通过，报告见 `_smoke-evidence/ai-sdk7-phase3-poc-smoke.json`。

## 边界确认

- 默认聊天路径零改动：本轮 diff 只新增文件（`src/lib/experimental/`、测试、
  fixture、smoke 脚本、文档）；`agent-loop.ts` / `native-runtime.ts` /
  runtime 注册 / permission / DB schema / SSE 语义 / checkpoint / rewind 均未触碰；
  无任何用户可见开关。
- POC 入口仅两个：unit 测试与 smoke 脚本；应用代码无 import。
