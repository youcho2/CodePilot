# Context Accounting Runtime Contract

> 创建：2026-05-19（v1）
> 重写：2026-05-19（v2 — Codex review pass，修 4 P1 + 1 P2）
> 父计划：[`phase-6-context-visualization.md`](./phase-6-context-visualization.md)
> 触发：用户 Codex review (2026-05-19) — Phase 6 Tier 2 (`a4fa2d4`) 实施了 `context_breakdown` 持久化链路，但**真实 smoke 证明**普通消息和 humanizer-zh Skill 消息的 `context_breakdown` **完全相同**：Skills 行统计的是固定 compiler capability prompt（一直存在的 hardcoded harness 输出），不是实际 Skill 注入 / 调用。这是 "界面有数字，但数字不是用户以为的那个东西" 的 hallucination 风险，违反 `feedback_no_hallucination` 元规则。
> 先读：[`docs/guardrails/Runtime.md`](../../guardrails/Runtime.md)、[`docs/handover/harness-capability-contract.md`](../../handover/harness-capability-contract.md)、[`docs/guardrails/MCP.md`](../../guardrails/MCP.md)、[`docs/exec-plans/completed/phase-5e-runtime-harness-architecture.md`](../completed/phase-5e-runtime-harness-architecture.md)

## 用户视角 — 为什么 Phase 6 Tier 2 不算真正完成

升级前（Phase 6 Tier 2 落地后的现状 `a4fa2d4`）：
- 普通消息 vs humanizer-zh Skill 消息的 popover **完全一样**
- "Skills 1.5K" 永远是同一数字 — 因为它读的是 `budget.perCategory.capabilityFragments`（compiler 把 capability descriptor 包装成 system prompt 段），跟用户实际调没调 Skill **完全无关**
- 同理：tools = 0（placeholder），mcp = `mcpServerNames.length * 200`（粗略估值跟实际 schema tokens 差很远）
- 结果：用户切 Skill 会话期待看到差异 → 看到没差 → 不信任 popover 数字
- 这违反 `feedback_no_hallucination`：UI 暗示"这是真实分类数字"，实际是 "compiler 内部 hardcoded + 粗估"

**v2 review pass 进一步确认**：所谓"保留 system_prompt / rules / memory 真实"也站不住脚：
- `compiled.workspaceFragments` 当前是空数组 → workspaceRuleTokens 永远是 0（不是真实 workspace rules）
- ClaudeCode adapter 当前没传 assistantMemory → memoryTokens 是 compiler 内部估算，不反映实际 memory 注入
- `compiled.basePrompt` 当前为空，`artifactContracts` 是 compiler artifact 片段——这两个加起来不包含 Claude Code preset / SDK 实际 system prompt。UI 显示 "系统提示 313" 让用户以为是完整 system prompt，实际只是片段
- → Phase 0 不能宣称这三个是真实，跟 Skills/MCP 是同质错误

## 升级后用户能看到什么

| 用户场景 | 现状（Tier 2 + Phase 0 v2） | Phase 5 全部接通后 |
|---|---|---|
| 发"你好"普通消息 | popover 显示对话历史 + 缓存两行；其余全部隐藏 | 同左（普通消息没真实注入 skill/tool/mcp/rule，自然不显示）|
| 发 `/humanizer-zh` 触发 Skill | popover 仍只显示对话历史 + 缓存（不暴露假 Skills 1.5K）| Skills 行出现且反映**本轮实际注入** Skill prompt 大小（区别于 available skill list）|
| 切到 MCP-heavy 工作流 | 同上（无误导）| MCP 行显示真实 MCP tool schemas 总 tokens |
| 切到 Native runtime | 同上 | Native adapter 产出 snapshot 或显式标 unsupported；不暴露假数据 |
| 切到 Codex Account session | 同上 | memory unsupported（hide）；其余按 codex_account 范围接通 |
| 切到 Codex + CodePilot bridge | 同上 | memory bridge 接通（Phase 5e 已支持）；popover 按 bridge 实际反映 |
| 某类别 Runtime 不支持 | hide（不暴露 0） | 同左 |

## 不做什么

- 不做账单级精度：跟 server 实际 tokenization 仍有 char/4 估算偏差，跟 cost API 同源即可
- 不强制所有 Runtime 必须支持所有类别：显式声明 unsupported 是合规，UI 据此 hide
- 不重构 send path 整体结构：只引入新 contract 抽象 + 三 Runtime adapter 各自实现 produce()
- 不动 conversation / cache_or_previous / pending 三类（这些来自 baseline + composer，跟 Runtime 无关）
- 不立即在 Phase 0 修真实接通：Phase 0 仅止损（隐藏假数据），真实接通是 Phase 2-4 范围
- **不允许 Phase 0 保留任何"半真半假"字段**——只保留 conversation / cache（baseline 数据来源真实），其他全部 hide 直到 Phase 2+ 真接通

## 怎么验收（每 Phase 独立）

- **Phase 0 止损**：发任意消息后 popover 只显示对话历史 + 缓存 / 上轮两行；不再看到 Skills / Tools / MCP / 系统提示 / 规则 / Memory 假数据
- **Phase 1 Contract**：`src/lib/harness/context-accounting.ts` 导出 `RuntimeContextAccountingSnapshot` + `ContextAccountingEntry` + `producedBy: RuntimeId` 类型；至少 1 个 unit test pin shape；guardrail Runtime.md 加 reference
- **Phase 2 ClaudeCode**：发 humanizer-zh Skill 后 Skills 行出现且**大于**普通消息基线；该字段 source 明确写 `sdk-turn/loaded-skill`（不是 available list）
- **Phase 3 Native**：Native session 切过去后 popover 类别数字非 placeholder
- **Phase 4 Codex**：
  - Codex Account session：memory 行 unsupported 隐藏；其他按 codex_account 范围
  - Codex + CodePilot bridge：memory 行真实接通（Phase 5e bridge 已支持）
  - Codex native app-server 自有能力：按 app-server 实际能力声明 unsupported / 接通
  - **run_completed 时 result.usage.context_breakdown 必须落库**（Codex 不能只靠 live `context_usage` event 实时预览，最终账本必须由 result event 持久化）
- **Phase 5 收口**：三 Runtime Smoke Ledger 三条；Phase 6 文档 Phase 4 验收段引用本计划

## 详细设计

### 设计目标 / 命名约定

1. **Contract first**：先定义"snapshot 是什么 / 字段含义 / unsupported 怎么表达 / Skills available vs loaded 怎么区分"——三个 Runtime 一起遵守
2. **真实数据来源可追踪**：每个字段必须能 trace 到具体源（`source: 'sdk-init/available-skills' | 'sdk-turn/loaded-skill' | 'mcp-server-schemas' | 'workspace-rules-fs/CLAUDE.md' | ...`）；source 区分 "可用 vs 实际本轮注入"
3. **unsupported 是 first-class**：Runtime 可声明 "I don't know how to count this kind"，UI 据此隐藏行，不伪装
4. **result event 是唯一持久化入口**：live `context_usage` event 只做实时预览；Codex 现在 live event + run_completed 不带 usage 的设计要改成 adapter 缓存最后一次 + run_completed → result 写入
5. **`producedBy` 必须用 RuntimeId**：`'claude_code' | 'codepilot_runtime' | 'codex_runtime'`（项目当前 RuntimeId 约定）。**禁止**再引入 `'native'` 之类别名（之前已踩过 RuntimeId vs 别名混乱坑）。子分类用 `providerBackend?: 'codex_account' | 'codepilot_proxy' | ...` 字段表达，不混入 producedBy
6. **Skills 必须区分 available vs loaded/invoked**：
   - `sdk-init/available-skills`：模型每轮都看到的 skill descriptor 列表（包括没调用的）
   - `sdk-turn/loaded-skill`：本轮实际注入的 skill 正文/规则
   - UI 显示的 Skills **只反映 loaded/invoked**（用户期望"我调用 Skill 后数字变化"）。available list 即使要展示也必须是另一个 kind 或 sub-detail，不能跟 invoked 混
7. **同类原则适用于其他 kind**：tools (available descriptor vs invoked call)、mcp (available server vs invoked tool call)、memory (snapshot 内容 vs 本轮 search 命中) — UI 必须只反映本轮实际进入上下文的 tokens

### Phase 0 — 止损（紧急、独立 commit）

**用户能看到什么**：popover 立刻只显示 **对话历史 + 缓存 / 上轮** 两行。不再显示 Skills / Tools / MCP / 系统提示 / 规则 / Memory（这 6 个全部隐藏，直到 Phase 2-4 真接通）。

**不做什么**：不动 Contract spec、不动其他 Runtime、不删 walkContextUsage / hook wire（管道保留），不修 UI 渲染逻辑（hideZero=true 已经做了 hide）

**为什么这 6 个全要隐藏（不是只隐藏 3 个）**：
- Skills：`budget.perCategory.capabilityFragments` 是 compiler hardcoded 输出，跟用户调没调 Skill 无关 → 不真实
- Tools：永远 0 placeholder → 不真实
- MCP：`mcpServerNames.length * 200` 粗估 → 不真实
- **系统提示**：`compiled.basePrompt` 当前为空 + `artifactContracts` 仅是片段，**不**包含 Claude Code preset / SDK 实际 system prompt → 数字会让用户以为是完整 system prompt，实际不是
- **规则**：`compiled.workspaceFragments` 当前是**空数组**，永远是 0 → 显示 0 等同 hideZero hide，但保留字段会让用户期待"工作区规则"实际并未在统计中
- **Memory**：ClaudeCode adapter 没传 assistantMemory，所以读 `compiled.memoryFragments` 是 compiler 内部估算，**不**反映实际 memory 注入

**实施清单**：
- `src/types/index.ts:ContextBreakdownSnapshot` 全字段改可选（兼容 Phase 1 contract）
- `src/lib/claude-client.ts` 删除整个 snapshot computation 块（line ~1138-1162）+ result event 不再附加 `context_breakdown`（保留 baseline + cache + pending wire 不动）
- **不**修 UI：现有 `hideZero=true` 默认行为已经 hide 0/undefined 行
- 更新 tech-debt #21：本来描述 placeholder 待 Phase 1c，现在改为"由 Phase 2-4 Contract 实施接管"

**关键测试**：手动启动 dev server，发任意消息，popover 只显示对话历史 + 缓存两行。无新 unit test 必要（Phase 0 是删字段，hideZero 已经测过）。

### Phase 1 — Define Runtime Contract

新建 `src/lib/harness/context-accounting.ts`：

```ts
import type { RuntimeId } from '@/lib/runtime/effective'; // or wherever it lives

export type ContextAccountingKind =
  | 'system_prompt' | 'tools' | 'rules' | 'skills' | 'mcp'
  | 'memory' | 'files_attachments';

/** Per-kind accounting entry — only real, current-turn data. */
export interface ContextAccountingEntry {
  tokens: number;
  /**
   * Trace source — MUST distinguish "available" vs "loaded/invoked".
   * Examples:
   *   'sdk-init/available-skills'    — every-turn list (NOT displayed)
   *   'sdk-turn/loaded-skill'         — this turn's actual injection
   *   'mcp-server-schemas'            — all schemas (every turn)
   *   'mcp-turn/invoked-tool'         — this turn's MCP tool call
   *   'workspace-rules-fs/CLAUDE.md'  — file-system source
   */
  source: string;
  /** Optional sub-detail (e.g. each loaded Skill name + size). */
  detail?: string;
}

/** Runtime-produced snapshot. Each kind is either real entry OR unsupported. */
export interface RuntimeContextAccountingSnapshot {
  entries: Partial<Record<ContextAccountingKind, ContextAccountingEntry>>;
  /** Kinds this Runtime explicitly can't count. UI hides these rows. */
  unsupported: readonly ContextAccountingKind[];
  /** RuntimeId — project convention 'claude_code'|'codepilot_runtime'|'codex_runtime'. */
  producedBy: RuntimeId;
  /** Optional sub-classification (Codex Account vs CodePilot proxy etc). */
  providerBackend?: 'codex_account' | 'codepilot_proxy' | 'native_app_server' | string;
}
```

每个 Runtime adapter 必须实现：
```ts
function produceContextAccountingSnapshot(
  input: AdapterInput
): RuntimeContextAccountingSnapshot
```

**验收**：
- Contract type 落地 + 单元测试 pin shape（≥ 3 测试：entries shape / unsupported semantics / producedBy 必填 RuntimeId）
- walkContextUsage 返回值 + hook 喂改成消费新 snapshot（取代旧 `ContextBreakdownSnapshot`）
- guardrail Runtime.md 加 reference 指向 Contract

### Phase 2 — ClaudeCode Adapter 实施

**前置：先确认 SDK 字段事实**

Phase 2.0 一步 POC：跑一条 chat 把 SDK init message + run-level messages dump 到日志，**实际看到 SDK 提供什么字段**。下面的来源 spec 是**待 POC 确认**的预期；如果字段名 / 语义不符就调整。

| Kind | 真实来源（**待 POC 确认**） | source breadcrumb | 备注 |
|---|---|---|---|
| `system_prompt` | SDK 实际发出的 system prompt 完整文本（含 Claude Code preset + `adapted.systemPromptAppend`）char/4 | `sdk-actual-system-prompt` | 必须是 SDK 实际看到的，不能用 `compiled.basePrompt + artifactContracts` 片段 |
| `tools` | SDK Options.tools 的 tool definition JSON（**非 MCP**，且**本轮真实注入** vs available list 待 POC 区分） | `sdk-options-tools/<available\|invoked>` | 区分"可用 tool descriptor"和"本轮调用的 tool"；UI 显示后者 |
| `rules` | CLAUDE.md + workspace `.cursor/rules/`（文件系统直读，非 `compiled.workspaceFragments` 空数组） | `workspace-rules-fs/CLAUDE.md` | `compiled.workspaceFragments` 当前空，必须直接 fs 读 |
| `skills` | **本轮实际注入** Skill 正文 char/4（SDK turn-level loaded-skill metadata，待 POC 确认 SDK 是否暴露） | `sdk-turn/loaded-skill` | **不**计入 available skill descriptors（那是每轮固定的） |
| `mcp` | SDK Options.mcpServers tool list 各 tool schema JSON char/4；区分 available schemas vs 本轮 invoked tool calls | `mcp-server-schemas/<available\|invoked>` | 同 tools 区分 |
| `memory` | assistant memory snapshot tokens（adapter 必须传 assistantMemory；`compiled.memoryFragments` 当前 ≈ 0） | `assistant-memory-snapshot` | adapter 改 signature 加 assistantMemory 参数 |

**风险 / POC 步骤**：
- SDK initMsg.skills / turn-level loaded skill 字段是否存在 — Phase 2.0 必须 POC 确认
- 如果 SDK 只暴露 available list，不暴露 invoked → 必须从其他地方（如 tool_use 事件流）反推
- 如果完全反推不到 → 该字段标 unsupported，**绝不允许伪装** available-list 当 invoked

### Phase 3 — Native Adapter 实施

Native runtime 通过 AI SDK 自建：
- tools: AI SDK `tools` 参数的 schema JSON
- system_prompt: 自建 system prompt template
- mcp: 通过 harness bundle 拿到的 MCP 描述
- skills: harness bundle 的 user/external extensions kind=skill
- memory: 同 ClaudeCode

同样要区分 available vs 本轮 invoked，POC 先确认每个字段实际可拿到的形态。

### Phase 4 — Codex Adapter 实施

Codex Runtime 必须按 provider backend 拆三种场景，不能一概用 "Codex unsupported memory" 盖过去。

#### Phase 4a — codex_runtime + codex_account（OAuth 登录态）

- `producedBy: 'codex_runtime'`, `providerBackend: 'codex_account'`
- memory：**unsupported**（Codex Account 是 perception_only，不接 CodePilot memory bridge）
- skills / mcp / tools：按 app-server 实际能力声明 — Phase 5e 已确认大部分 perception-only / unsupported
- rules / system_prompt：从 Codex app-server init metadata 拿

#### Phase 4b — codex_runtime + codepilot_proxy/provider（用户用 OpenRouter/OpenAI 等 provider 通过 Codex CLI）

- `producedBy: 'codex_runtime'`, `providerBackend: 'codepilot_proxy'`
- memory：**接通**（Phase 5e 已通过 CodePilot bridge 支持 memory_recent / memory_search）
- skills / mcp / tools：按 CodePilot bridge 实际暴露的能力计，跟 ClaudeCode runtime 同源（capability matrix）
- rules：同 ClaudeCode（workspace-rules-fs）

#### Phase 4c — Codex native app-server 自有能力

- `producedBy: 'codex_runtime'`, `providerBackend: 'native_app_server'`
- 按 app-server 自身能力（不走 CodePilot bridge）声明
- 大部分字段可能 unsupported（app-server 不暴露细分）

#### result event 持久化策略（Phase 4 通用）

Codex 当前 `context_usage` 是 live event，`run_completed` 的 result **不带 usage**。这跟设计原则 #4（result 是唯一持久化入口）冲突。

修法：
- Codex adapter 必须**缓存**最后一次 `usage_updated` event + bridge/proxy accounting snapshot
- 在 `run_completed` → 转换成 result event 时**写入** `result.usage.context_breakdown`（用缓存的最后一次）
- 否则 DB 没最终账本，`useContextUsage` 看到 token_usage = null，breakdown 整个失效

实施位置（推定，需 verify）：`src/lib/codex/runtime.ts` 或 `src/lib/codex/event-mapper.ts` 在 `run_completed` 处理处加 snapshot 缓存读取 + 嵌入 usage。

### Phase 5 — Smoke + closeout

三 Runtime 各跑一条真实 smoke：
- ClaudeCode：普通"你好" baseline + humanizer-zh Skill 调用对比，验证 Skills 行**仅在 Skill 调用后出现**且数字反映本轮注入大小（不是 available list）
- Native：Native session 配 MCP server，验证 MCP 行非 placeholder
- Codex 三场景：
  - codex_account session — memory 不显示行（unsupported）
  - codex + codepilot_proxy session — memory 接通显示真实
  - codex native app-server — 按实际能力

Smoke Ledger 落 Phase 6 文档 + 本文档；Phase 6 closeout 后归档。

## Smoke Ledger（Phase 5 时填）

| Date | Runtime | Provider | Model | 凭据形态 | 场景 | Result | Evidence |
|------|---------|----------|-------|---------|------|--------|----------|
| _示例_ | claude_code | Claude Code | Opus | 本机登录 | humanizer-zh skill | ✅ | screenshot + popover Skills source=sdk-turn/loaded-skill 且 > 普通消息 baseline + console clean except #20 |

## 决策日志

- 2026-05-19（v1）：User Codex review 指出 Phase 6 Tier 2 (`a4fa2d4`) "数字不是用户以为的那个东西"。triggering 本计划。拆 6 Phase（0 止损 + 1 Contract + 2 ClaudeCode + 3 Native + 4 Codex + 5 closeout），Phase 0 紧急独立 commit。
- 2026-05-19（v1）：unsupported 是 first-class 状态而非"显示 0"——避免 hallucination 风险。
- 2026-05-19（v1）：tech-debt #21（tools/mcp placeholder）被本计划吸收。
- 2026-05-19（**v2 Codex review pass**）：接受 4 P1 + 1 P2 findings 全部修订：
  - **P1 Phase 0 范围扩大**：v1 错误宣称 system_prompt / rules / memory "保留真实"，事实是 `workspaceFragments` 空数组、adapter 没传 assistantMemory、`basePrompt` 为空——这三个跟 skills/mcp 一样不真实。Phase 0 改成**只保留 conversation + cache 两行**，其他全部隐藏直到 Phase 2-4 真接通
  - **P1 Phase 2 Skills 语义**：必须区分 `sdk-init/available-skills`（每轮固定，不显示）vs `sdk-turn/loaded-skill`（本轮注入，显示）；source breadcrumb 强制区分；同理 tools / mcp 区分 available 和 invoked
  - **P1 Phase 4 Codex 拆三场景**：不能一概 "Codex unsupported memory"。codex_account 才 unsupported；codex + codepilot_proxy 经 Phase 5e bridge 支持 memory；native app-server 按 app-server 实际能力
  - **P1 producedBy 命名**：`'claude_code' | 'codepilot_runtime' | 'codex_runtime'` 走 RuntimeId 类型，禁止 'native' 别名；子分类用 `providerBackend?: ...`
  - **P2 Codex result event 持久化**：Codex adapter 必须缓存最后一次 usage_updated + run_completed → result.usage.context_breakdown 落库，否则 DB 没最终账本
