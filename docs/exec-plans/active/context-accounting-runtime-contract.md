# Context Accounting Runtime Contract

> 创建：2026-05-19（v1）
> 重写：2026-05-19（v2 — Codex review pass，修 4 P1 + 1 P2）
> 增补：2026-05-20（v6 — 用户真实 UI smoke 暴露源错位，加 Phase 7）
> 父计划：[`phase-6-context-visualization.md`](./phase-6-context-visualization.md)
> 触发：用户 Codex review (2026-05-19) — Phase 6 Tier 2 (`a4fa2d4`) 实施了 `context_breakdown` 持久化链路，但**真实 smoke 证明**普通消息和 humanizer-zh Skill 消息的 `context_breakdown` **完全相同**：Skills 行统计的是固定 compiler capability prompt（一直存在的 hardcoded harness 输出），不是实际 Skill 注入 / 调用。这是 "界面有数字，但数字不是用户以为的那个东西" 的 hallucination 风险，违反 `feedback_no_hallucination` 元规则。
> v6 二次触发：用户 2026-05-20 真实 UI smoke 暴露 Phase 2-4 设计只覆盖 "badge picker 预选" 一条路径，**用户自然语言**让 Claude 自主 invoke Skill/MCP 这条主流路径 producer 永远看不到 → 仍违反"数字反映用户实际工作量"的语义契约。
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

| 用户场景 | 现状（Tier 2 + Phase 0 v2） | Phase 5 接通后（badge path）| Phase 7 接通后（auto-invoke path）|
|---|---|---|---|
| 发"你好"普通消息 | popover 显示对话历史 + 缓存两行；其余全部隐藏 | 同左 + rules 真实（CLAUDE.md filesize）| 同左（无 tool_use → skills/mcp/tools 都不显示）|
| popover 选 `/humanizer-zh` badge 发送 | popover 仍只显示对话历史 + 缓存（不暴露假 Skills 1.5K）| **Skills 行出现** 反映本轮 SKILL.md filesize | 同左（badge 路径仍 work；Phase 7 不破坏）|
| **自然语言提 "用 humanizer-zh 优化"**（不点 badge） | popover 不出 Skills 行 | **仍不出**（Phase 2-4 限制；用户最反馈痛点）| **Skills 行出现**（producer 扫 assistant message `tool_use` blocks 提取 `Skill { skill: 'humanizer-zh' }`）|
| Widget 生成（Claude 自主调 `mcp__codepilot-widget__...`） | MCP 行 unsupported 隐藏 | 同左（Phase 2-4 spec 仍 unsupported）| **MCP 行出现** 含 codepilot-widget / codepilot-memory 等 server 名 + invocation 次数 |
| Claude 调 Bash 5 次 / Read 10 次 | Tools 行 unsupported 隐藏 | 同左 | **Tools 行出现** 含 Bash×5 / Read×10 breakdown |
| 切到 Native runtime | 同上 | rules 真实；其他 unsupported | Phase 7.5 评估（Native agent-loop 没 SDK tool_use 抽象；可能保留 unsupported）|
| 切到 Codex Account session | 同上 | rules 真实；其他 unsupported；providerBackend='codex_account' | Phase 7.5 评估（Codex 用 `usage_updated` event 已能拿真实 turn-level 数；不走 message tool_use scan 路径）|
| 切到 Codex + CodePilot bridge | 同上 | memory bridge 接通（Phase 5e 已支持）；popover 按 bridge 实际反映 | 同左 |
| 某类别 Runtime 不支持 | hide（不暴露 0） | 同左 | 同左（unsupported first-class 保留）|

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

> **v6 现状（2026-05-20）**：Phase 2 实施按 badge picker 路径完成（用户主动选 Skill 时计入）。Phase 2.0 POC 实际确认：SDK 不暴露 turn-level loaded-skill 元数据；可用的等效信号是 SDK assistant message 内的 `tool_use` blocks。覆盖 auto-invoke 主流路径转 [Phase 7](#phase-7--producer-时机从发送前移到答复后v6-增补)。下面的来源 spec 是 v2 review 时的预期，记录原始决策上下文；实际实现细节看 Phase 7 + commit `5c356e8` 之前的链。

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
- ClaudeCode：普通"你好" baseline + humanizer-zh Skill **badge picker** 调用对比，验证 Skills 行仅在 badge 选 Skill 后出现且数字反映 SKILL.md 大小
- Native：Native session 配 MCP server，验证 MCP 行非 placeholder
- Codex 三场景：
  - codex_account session — memory 不显示行（unsupported）
  - codex + codepilot_proxy session — memory 接通显示真实
  - codex native app-server — 按实际能力

> **v6 现状**：Phase 5 cover **badge picker** 路径已 partial 完成（v5 producer canonicalize + v5 hotfix client bundle 修复后；待 user 真实凭据 smoke 填 Ledger）。**auto-invoke 主流路径**（用户自然语言 / Claude 自主调 MCP / Tool）转 [Phase 7.6](#phase-7--producer-时机从发送前移到答复后v6-增补)。Phase 5 closeout 等 Phase 7 完成后一并归档。

Smoke Ledger 落 Phase 6 文档 + 本文档；Phase 6 closeout 后归档。

## 实施状态（2026-05-20）

| Phase | 内容 | Commit | 状态 |
|---|---|---|---|
| Phase 0 | 止损 — 删 假数据 snapshot + ContextBreakdownSnapshot 字段全可选 | `4fcc09e` | ✅ |
| Phase 1 | RuntimeContextAccountingSnapshot contract type + walkContextUsage + hook wire + 10 unit tests | `a997e33` | ✅ |
| Phase 2 | ClaudeCode adapter `produceClaudeCodeAccountingSnapshot` + 6 unit tests + send-path wire（**badge path only**） | `7c2937e` → v3 `92a777a` → v4 `c35918b` → v5 `27b5629` → v5 hotfix `5c356e8` | ✅ 部分（badge picker 选 skill → entries.skills 已 verify；auto-invoke path 仍漏，转 Phase 7） |
| Phase 3 | Native (agent-loop.ts) `produceNativeAccountingSnapshot` + send-path wire | `ebe0071` | ✅ |
| Phase 4 | Codex (runtime.ts) `produceCodexAccountingSnapshot` + usage cache + run_completed → supplementary result event with usage+context_accounting | `ebe0071` | ✅ |
| Phase 5 | Smoke + closeout（badge path 已 verify；auto-invoke path 反例归 Phase 7.6） | 待 | 📋 部分 |
| **Phase 7** | **Producer 时机从「发送前」迁到「答复后」— 扫 SDK assistant message `tool_use` blocks 统计真实 Skill/MCP/Tools 调用** | — | 📋 |

## 每 Runtime 每 kind 状态（实施总账）

> Phase 7 后此表的 ClaudeCode 列会变 — `skills/mcp/tools` 三项从 unsupported 改为 real (auto-invoke scan)。Phase 7 实施完成时同步更新本表。

| Kind | ClaudeCode (Phase 2) | ClaudeCode (Phase 7 目标) | Native (Phase 3) | Codex codex_account (Phase 4a) | Codex codepilot_proxy (Phase 4b) | 真实 source |
|---|---|---|---|---|---|---|
| `system_prompt` | unsupported | unsupported（SDK 不暴露）| unsupported | unsupported | unsupported | 全 SDK preset opaque from 我们侧 |
| `tools` | unsupported | **✅ real (auto-invoke)** | unsupported | unsupported | unsupported | Phase 7: 扫 `tool_use` 内置 tool 名 (Bash/Read/Edit/Grep/...) + per-call args/result chars/4 |
| `rules` | ✅ real (CLAUDE.md filesize) | ✅ real（保留）| ✅ real | ✅ real | ✅ real | `workspace/CLAUDE.md` fs.statSync |
| `skills` | ✅ real (badge picker path) | **✅ real (badge + auto-invoke)** | unsupported | unsupported | unsupported | Phase 7 加: `tool_use.name === 'Skill'` → input.skill 名 → discoverSkills lookup → SKILL.md filesize |
| `mcp` | unsupported | **✅ real (auto-invoke)** | unsupported | unsupported | unsupported | Phase 7: `tool_use.name` 前缀 `mcp__<server>__<tool>` → per-call args + tool_result chars/4 |
| `memory` | unsupported | unsupported | unsupported | unsupported | unsupported (待 Phase 6.x bridge wire) | adapter 没传 assistantMemory |
| `files_attachments` | unsupported | unsupported | unsupported | unsupported | unsupported | composer pending 走 ContextBreakdownInputs.pending（已 Phase 6 Tier 2 wire） |

**说明**：
- "unsupported" = Runtime 明确声明不计 → UI hide 行，不显示 0 假数据
- "real" = 该 Runtime 从真实 data source 读 token 估算 → UI 显示真实数字
- `system_prompt / tools / mcp / memory` 全 unsupported 是 Phase 0-4 当前架构限制
- **Phase 7（v6 增补）会解锁 ClaudeCode 列的 `tools` / `mcp` / `skills`（auto-invoke）**：扫 assistant message `tool_use` blocks 提取 invocation-level token；`system_prompt / memory / files_attachments` 仍 unsupported（不在 Phase 7 范围）
- 远期 Phase 6.x / 8 接通 SDK 更深字段 / harness bundle / MCP loader schema 后扩展剩余 unsupported 项
- ClaudeCode 是唯一接通 skills 的 Runtime（slash-command 检测限定到 Claude Code 入口）；Native + Codex producer 没有 raw userPrompt 可访问，等 Phase 6.x adapter input 扩展

## Source Breadcrumb（每 real entry 必带）

| Kind | source value | 含义 |
|---|---|---|
| skills (ClaudeCode) | `workspace/.claude/skills/<name>/SKILL.md` (workspace) OR absolute path (global / agents) | MessageInput badge label → discoverSkills() lookup 真实 filePath |
| rules (all 3 Runtimes) | `workspace/CLAUDE.md` | workspace 根的 CLAUDE.md 文件 |

未来扩展 (Phase 6.x):
- `sdk-actual-system-prompt` — SDK 实际看到 system prompt（待 SDK 暴露）
- `mcp-server-schemas/available` — MCP server tool schemas
- `assistant-memory-snapshot` — adapter assistantMemory wire 后

## 测试覆盖

| 测试文件 | 测试数 | 覆盖 |
|---|---|---|
| `src/__tests__/unit/context-accounting.test.ts` | 10 | Contract shape pin (producedBy 仅 3 RuntimeIds; source breadcrumb required; unsupported first-class; available vs invoked 语义；snapshotToCompilerInputs 各分支) |
| `src/__tests__/unit/claude-code-context-accounting.test.ts` | 6 | ClaudeCode producer (普通消息 vs skill 消息 DIFFERENT snapshot；slash-command scan；source breadcrumb 格式) |
| 现有 `context-breakdown.test.ts` | 19 | Phase 6 Tier 2 contract 仍 valid (compiler inputs 形态不变) |
| 现有 `context-breakdown-list-i18n.test.ts` | 6 | i18n 元规则 |
| 现有 `run-cockpit-unknown-capacity.test.ts` | 4 | Popover fallback 仍 OK |

## Smoke Ledger（等 Codex / user 跑真实凭据 smoke 填）

每行 Evidence 列必须含：
1. **DB 行验证**: latest assistant message 的 `token_usage.context_accounting` 完整 JSON dump（含 producedBy / providerBackend / unsupported list / entries map with sources）
2. **Popover 验证**: 截图 + DOM 摘要（哪些行可见 / 隐藏 / 数字 + source breadcrumb 一致）
3. **Console 口径**: "console clean except tech-debt #20"

| Date | Runtime | Provider | Model | 凭据形态 | 场景 | Result | Evidence |
|------|---------|----------|-------|---------|------|--------|----------|
| _示例_ | claude_code | Claude Code | Opus | 本机登录 | 普通"你好" vs `/humanizer-zh xxx` | ✅ | `token_usage.context_accounting`: 普通: { entries: { rules: {tokens: 234, source: 'workspace/CLAUDE.md'} }, unsupported: [tools/mcp/memory/system_prompt/files_attachments/skills], producedBy: 'claude_code' } vs Skill: { entries: { rules: {...same}, skills: {tokens: 580, source: 'workspace/.claude/skills/humanizer-zh/SKILL.md', detail: 'humanizer-zh'} }, ... } |
| 待 | claude_code | — | — | — | 普通消息 baseline | 📋 | |
| 待 | claude_code | — | — | — | /humanizer-zh skill 调用 | 📋 | Skills 行必须出现且数字 = SKILL.md char/4 |
| 待 | codepilot_runtime | — | — | — | Native + MCP 工具 | 📋 | rules 真实；其他 unsupported hide |
| 待 | codex_runtime | codex_account | — | OAuth | 普通消息 | 📋 | rules 真实；其他 unsupported；providerBackend='codex_account' |
| 待 | codex_runtime | (codepilot proxy) | — | API key | 普通消息 | 📋 | rules 真实；其他 unsupported；providerBackend='codepilot_proxy'；result event 含 usage（Phase 4 P2 修复验证）|

## Phase 7 — Producer 时机从「发送前」移到「答复后」（v6 增补）

### 用户视角

#### 用户能看到什么

升级前（Phase 2-4 落地后）只在用户**主动用 badge picker 选 skill** 时显示 Skills 行。但用户最自然的工作方式是**自然语言提到 skill 名 / 让 Claude 自主决定调哪些 MCP / Tool**，这条主流路径 popover 完全看不到。

Phase 7 后：

- popover Skills 行：**Claude 实际 invoke 的所有 Skill**（无论用户用 badge 选还是自然语言触发都会出）
- popover MCP 行：**本轮调用的 MCP server / tool 清单 + 每个 invocation 估算 token**（之前永远 hide）
- popover Tools 行：**本轮调用的内置工具次数**（Bash×N / Read×N / Edit×N，之前永远 hide）

#### 不做什么

- 不做账单级精度：仍 char/4 估算，跟 server tokenization 有偏差
- 不试图统计 MCP **schema 注入** 的系统提示部分 token（那属于 system_prompt，Phase 2-4 已声明 unsupported；Phase 7 只统计 invocation-level token，即 args + tool_result 内容）
- 不为 "available 但未 invoke 的 skill/MCP/tool" 显示行 — 只统计实际发生的 tool_use
- 不动 badge picker 路径（保留作为 UX 保证，picker 主动选时也会被 tool_use 扫描覆盖到 — 数据来源一致）
- 不动 Native (`agent-loop.ts`) 时机：Native 没 SDK 抽象的 `tool_use` block；Phase 7.5 评估是否需要补 agent-loop 自己的 tool-call record
- 不动 Codex (`runtime.ts`) 时机：Codex 已有 `usage_updated` event 拿 turn-level 数；不需要 tool_use scan 路径
- 不预先 trigger producer — 只在 SDK result event 内跑一次

#### 怎么验收

- **铁证 #1（Skills 自然语言）**：复制本计划触发证据的同一 prompt "你好帮我创建一个当前目录内容的可视化解释组件，然后随便写点啥调用 humanizer-zh 优化"，修复前 DB row entries.skills 空，修复后 entries.skills 含 humanizer-zh + SKILL.md 真实 filesize
- **铁证 #2（MCP）**：Widget 生成场景 entries.mcp 非空 + source 含 `codepilot-widget`、`codepilot-memory` server 名 + invocation count
- **铁证 #3（Tools）**：任何调用 Bash 的对话 entries.tools 非空 + detail 含 "Bash × N"
- **反例 baseline**：发"你好" 不触发任何 tool_use → entries.skills/mcp/tools 都 omit（防 hallucination 加 0）
- **回归 baseline**：badge picker 选 humanizer-zh 仍 work（与 auto-invoke 数据等价）
- **harness contract**：`src/__tests__/unit/harness-capability-contract.test.ts` pass（CLAUDE.md `feedback_no_live_smoke_driven_patching`：harness contract 变更必须先过 contract test 再 burn 真实凭据 smoke）
- **Smoke Ledger** 加 Phase 7.6 三行（Skills 自然语言 / MCP / Tools 各一）

#### 价值类型

**A 类（用户可见 UI）**：直接修复用户最反馈的痛点 — popover 数字反映的不是 Claude 真实工作量。

### 实施路径（技术细节，不需要用户审查）

> 以下内容是给开发者看的，描述代码层面如何接通；用户验收只看上一段「怎么验收」铁证。

#### 数据源 (SDK 实际能给的)

SDK assistant message content 是 `Array<ContentBlock>`，包含 `text / thinking / tool_use / tool_result` 几类。Phase 7 producer 扫 `tool_use` blocks：

| tool_use.name 模式 | 归类 | 提取字段 |
|---|---|---|
| `Skill` | `entries.skills` | `input.skill`（skill 名）→ discoverSkills lookup → SKILL.md filesize |
| `mcp__<server>__<tool>` | `entries.mcp` | server / tool 名（前缀 split）+ per-call input args 字符长度 + 对应 tool_result chars |
| 其他（`Bash` `Read` `Edit` `Grep` `Glob` `WebFetch` ...）| `entries.tools` | tool 名 + per-call input args + tool_result chars |

#### Producer 时机迁移

当前 `src/lib/claude-client.ts:1158` 在 streamClaude 起点跑 produce。改为：

1. streamClaude 入口处 **删除** 当前 produce 调用（line 1100-1166 块）；保留 `adaptForClaudeCode` / extensions 扫描（那些是 system prompt 注入相关，不依赖 tool_use）
2. 在 streaming 循环里（line 1585 附近 `if (block.type === 'tool_use')`）累积 tool_use blocks 到本地 array `accumulatedToolUses: Array<{ name: string; input: unknown; tool_use_id: string }>`
3. 在 streaming 循环里 `tool_result` block 也累积（line 1674 附近）到 `accumulatedToolResults: Map<tool_use_id, { content: string }>` （tool_result 是 user 消息内的；同一 stream 内可达）
4. result event handler (line 2162) 调 producer 新入口 `produceFromAssistantHistory({ workspacePath, toolUses, toolResults, selectedSkills })`
5. result event handler line 1845-1846 sites（main + alt path）把 snapshot 嵌进 `usage.context_accounting`

#### Producer 新入口 API

```ts
// src/lib/harness/claude-code-context-accounting.ts
export interface ProducerToolUseRecord {
  name: string;
  input: unknown;
  tool_use_id: string;
}
export interface ProducerToolResultRecord {
  content: string;
}
export interface ProducerInputAutoInvoke {
  workspacePath: string;
  toolUses: ReadonlyArray<ProducerToolUseRecord>;
  toolResults: ReadonlyMap<string, ProducerToolResultRecord>;
  selectedSkills?: readonly string[];  // 保留 badge 路径；与 tool_use Skill 合并 dedup
}
export function produceClaudeCodeAccountingSnapshot(
  input: ProducerInputAutoInvoke,
): RuntimeContextAccountingSnapshot;
```

Token 估算公式 (POC):
- Skill: `discoverSkills().find(s.name === input.skill).filesize / 4`
- MCP per call: `(JSON.stringify(input).length + (toolResults.get(tool_use_id)?.content.length ?? 0)) / 4`
- 内置 tool per call: 同 MCP 公式

#### 子阶段拆分

| 子阶段 | 内容 | 验收 |
|---|---|---|
| 7.1 POC + fixture | 从当前 DB row `487c190a72ce51e030e706ca7ab3cea8` content 抽 4 个 tool_use blocks 存 `src/__tests__/fixtures/widget-message-tool-uses.json` 作为 golden fixture | fixture 文件存在；shape 验证测试 pass |
| 7.2 contract 扩展 | `PHASE_2_UNSUPPORTED` 列表 - 去掉 `tools` `mcp`；保留 `system_prompt` `memory` `files_attachments`；contract unit test 同步更新 | `context-accounting.test.ts` 仍 pass |
| 7.3 producer 新入口 | 加 `produceFromAssistantHistory` (或 producer 签名扩展)；保留 `selectedSkills` 兼容（badge 路径）；与 tool_use Skill dedup | 6 个新 unit test：Skill auto-invoke / MCP × 2 server / Bash × N / 空 tool_uses → 不计 / dedup badge + tool_use / unknown skill → 不计 |
| 7.4 claude-client 时机迁移 | streamClaude line 1100-1166 produce 调用删；累积 tool_use + tool_result；result event line 2162 调新入口 | typecheck pass；现有 smoke 不回归 |
| 7.5 Native / Codex 评估 | Native agent-loop 是否能补 tool_use scan？Codex usage_updated 是否已覆盖？写决策不实施 | 决策写入本计划 decision log |
| 7.6 Smoke Ledger 三反例 | Skills 自然语言 / MCP Widget / Tools Bash 三条真实凭据 smoke，DB row dump + popover 截图 | Smoke Ledger 三行 Evidence 列填齐 |
| 7.7 harness contract | `harness-capability-contract.test.ts` pass | 测试列表跑全绿 |

#### 影响范围 (改动文件)

- `src/lib/harness/claude-code-context-accounting.ts` — producer 新入口
- `src/lib/claude-client.ts` — produce 时机迁移 + tool_use/tool_result 累积
- `src/__tests__/unit/claude-code-context-accounting.test.ts` — 新增 6 test
- `src/__tests__/fixtures/widget-message-tool-uses.json` — 新 fixture
- 不改：`src/components/chat/MessageInput.tsx`（badge picker 路径保留）、`ChatView.tsx`、`stream-session-manager.ts`、`/api/chat`、`src/types/index.ts`（contract 字段不变）

#### 风险 / 已知局限

- **MCP schema 注入仍 unsupported**：用户期待"MCP-heavy 工作流影响 system_prompt 大"无法覆盖；这是 Phase 8 范围（需要从 MCP loader 拿 server tool schemas）
- **tool_result 不一定在同 stream 内可达**：parent_tool_use_id 跨边界场景需要查；7.1 POC 必须 verify Widget message 全部 tool_use 都有对应 tool_result
- **estimate 精度**：char/4 + JSON 序列化估算与 server tokenization 偏差 5-15%；可接受（跟 Phase 2-4 一致基线）
- **Skill 同名歧义**：tech-debt #22 已记录；Phase 7 producer 复用 discoverSkills 仍受影响

### 不在 Phase 7 范围

- MCP server tool schemas 系统提示注入估算 → 留 Phase 8
- Native runtime tool-call 时机 → 7.5 决策后再起独立 phase
- Codex runtime → 当前 usage_updated 已覆盖；不在 Phase 7 范围
- Memory / files_attachments 接通 → Phase 6.x 范围

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
- 2026-05-20（**Phase 0-4 实施完成**）：5 个 commit 串成 Phase 0→1→2→3→4 chain：
  - `4fcc09e` Phase 0 止损（删假数据 + 字段 optional）
  - `a997e33` Phase 1 Contract type + 16 unit tests (10 accounting + 6 走 hook 已有)
  - `7c2937e` Phase 2 ClaudeCode adapter (skills real source via slash-command + rules via CLAUDE.md) — **deprecated by 2026-05-20 v3 fix below**
  - `ebe0071` Phase 3 Native + Phase 4 Codex (rules real source；Codex usage cache + supplementary result event for P2 fix)
  - 实施现状：每 Runtime 每 kind 状态表 + source breadcrumb 标准 + 测试覆盖见上方"实施状态"段；Smoke Ledger 待 Codex/user 真实凭据 smoke 填
- 2026-05-20（**v3 Codex review pass**）：接受 1 P1 + 1 P2 finding：
  - **P1 Skills 仅覆盖手打 `/skill` 窄路径，不覆盖真实 Agent Skill badge 选择路径**：用户用 UI 选 Agent Skill 时 dispatchBadge 实际发的是 `Use the humanizer-zh skill. User context: ...`，不是 `/humanizer-zh`。Phase 2 commit 7c2937e 的 SLASH_COMMAND_RE 完全 miss 这条真实路径。修法：删 prompt regex，从 MessageInput badge 元数据作为结构化字段 (`selectedSkills`) 通过 send-path 传到 producer；producer 用 `discoverSkills()`（已覆盖 project / global / installed / agents skill 目录）按 name lookup 拿 SKILL.md 真实 filePath
  - **P2 "SDK POC 已完成"口径不成立**：SDK 实际只暴露 available skills/tools/mcp_servers 列表元数据，没暴露 turn-level loaded-skill。Phase 2 实施其实是 fs 启发式 + 现在改为 badge 结构化 metadata。文档口径修正为 "starts from MessageInput badge metadata; SDK doesn't expose turn-level loaded-skill; no prompt-text guessing"
- 2026-05-20（**v3 P1 修复 commit 92a777a**）：
  - producer 签名加 `selectedSkills?: readonly string[]` 参数；用 discoverSkills() lookup filePath；删 SLASH_COMMAND_RE 完全（手打 `/skill` 也 hide，避免猜测）
  - 5 文件 plumbing：MessageInput badges → onSend → ChatView/page sendMessage → stream-session-manager body → /api/chat → streamClaude options → producer
  - 新回归测试：dispatchBadge real prompt + structured selectedSkills 必须产 skills entry；手打 `/skill` 无 selectedSkills 必须 hide
- 2026-05-20（**v4 P1 修复 commit c35918b**）：ChatView 已有会话发送链路 plumb 完整：QueuedMessage interface 加字段 / doStartStream 6th param / 三处 caller (直发 + enqueue + dequeue) 都传 selectedSkills。同时修 v3 漏的 typecheck error (selectedSkills 在 doStartStream scope 内未声明)。
- 2026-05-20（**v4 P2 deferred → tech-debt #22**）：selectedSkills 仍是 `readonly string[]`。同名 skill 在 project + global 重复时按 discoverSkills() 优先级选第一个，可能跟 picker 里点的不一致。**短期接受**（user OK）— 单 skill 场景不触发；同名重复时数字仍真实，只 source breadcrumb 可能指错 SKILL.md，不算 hallucination。**升级方向**（tech-debt #22）：`string[]` → `{ name, sourcePath }[]`，picker 存 SkillDefinition.filePath，全链 plumb 到 producer，producer 用 sourcePath 直接 statSync 不再二次 lookup。
- 2026-05-20（**v5 P1 修复 commit `27b5629`**）：badge picker 存 `command: '/humanizer-zh'`（slash 前缀），producer 原 strict 比对 SkillDefinition.name 失败。加 `canonicalizeSkillName(value)` = `value.trim().replace(/^\/+/, '')` + 大小写不敏感 lookup；新加 5 个 regression test（slash 前缀 / 大小写 / 防御性空格 / slash-only / source breadcrumb 格式）。
- 2026-05-20（**v5 hotfix commit `5c356e8`**）：v5 引入 client bundle 致命错误。MessageInput.tsx 加的 `await import('@/lib/harness/claude-code-context-accounting')` 把 producer module → discoverSkills → `node:fs` 拖进客户端 bundle，触发 `Module not found: 'fs'` → 整个 /chat 页面 HTTP 500。修法：MessageInput 改 inline `(v) => v.trim().replace(/^\/+/, '')` 不 import 任何 server-only module；producer 自留 canonicalize export 给 server caller 用，client + server 各一份（**enforced boundary**）。教训：Next.js client bundle traces 所有 reachable imports (static + dynamic)；dynamic import 不 escape bundle inclusion；想当然用 `await import()` 跨 client-server 边界会出事。
- 2026-05-20（**v6 触发：用户真实 UI smoke 暴露设计源错位**）：用户 prompt "你好帮我创建一个当前目录内容的可视化解释组件，然后随便写点啥调用 humanizer-zh 优化" → DB row `487c190a72ce51e030e706ca7ab3cea8` token_usage.context_accounting 只有 rules，缺 skills + mcp + tools。Assistant message content 实际 4 个 tool_use：Bash × 2 / mcp__codepilot-widget__codepilot_load_widget_guidelines / mcp__codepilot-memory__codepilot_memory_recent / Skill { skill: 'humanizer-zh' }。**根本原因**：Phase 2-4 producer 在 streamClaude 起点跑，源是 `options.selectedSkills`（badge picker 预选）；用户没用 badge，自然语言提到 skill 后 Claude 自主 invoke Skill tool — 这条 path producer 永远看不到。同理 MCP / 内置 Tool 永远 unsupported。Phase 2-4 仍属 partial：只 cover badge picker 路径，不 cover Claude 自主 invoke 主流路径。**决议**：加 Phase 7 (producer 时机迁到 SDK result event；扫 assistant message tool_use blocks)；Phase 7 不否定 Phase 2-4（badge 路径 dedup 合并），只补漏 auto-invoke 路径。

---

## Smoke Ledger 反例（v6 增补 — Phase 7 必须验证）

| Date | Runtime | 触发方式 | 场景 | Phase 2-4 现状 | Phase 7 目标 |
|------|---------|----------|------|----------------|--------------|
| 待 | claude_code | 自然语言 | "...用 humanizer-zh 优化" | entries.skills 空（DB 行 `487c190a` 证实）| entries.skills 含 humanizer-zh + SKILL.md filesize |
| 待 | claude_code | Claude 自主调 MCP | Widget 生成 | entries.mcp unsupported hide | entries.mcp 非空 + codepilot-widget / codepilot-memory server 名 + invocation 次数 |
| 待 | claude_code | Claude 自主调 Bash | 任何包含文件操作的对话 | entries.tools unsupported hide | entries.tools 含 Bash × N detail |
| 待 | claude_code | badge picker | popover 选 humanizer-zh | entries.skills 含 humanizer-zh ✓ | 同左（保留兼容；不破坏）|

> Evidence 必须含：(1) DB row token_usage.context_accounting 完整 JSON dump，(2) popover 截图 + DOM 摘要，(3) console clean except tech-debt #20
