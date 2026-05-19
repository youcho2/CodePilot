# Context Accounting Runtime Contract

> 创建：2026-05-19
> 父计划：[`phase-6-context-visualization.md`](./phase-6-context-visualization.md)
> 触发：用户 Codex review (2026-05-19) — Phase 6 Tier 2 (`a4fa2d4`) 实施了 `context_breakdown` 持久化链路，但**真实 smoke 证明**普通消息和 humanizer-zh Skill 消息的 `context_breakdown` **完全相同**：Skills 行统计的是固定 compiler capability prompt（一直存在的 hardcoded harness 输出），不是实际 Skill 注入 / 调用。这是 "界面有数字，但数字不是用户以为的那个东西" 的 hallucination 风险，违反 `feedback_no_hallucination` 元规则。
> 先读：[`docs/guardrails/Runtime.md`](../../guardrails/Runtime.md)、[`docs/handover/harness-capability-contract.md`](../../handover/harness-capability-contract.md)、[`docs/guardrails/MCP.md`](../../guardrails/MCP.md)、[`docs/exec-plans/active/development-harness-optimization.md`](./development-harness-optimization.md)

## 用户视角 — 为什么 Phase 6 Tier 2 不算真正完成

升级前（Phase 6 Tier 2 落地后的现状 `a4fa2d4`）：
- 普通消息 vs humanizer-zh Skill 消息的 popover **完全一样**
- "Skills 1.5K" 永远是同一数字 — 因为它读的是 `budget.perCategory.capabilityFragments`（compiler 把 capability descriptor 包装成 system prompt 段），跟用户实际调没调 Skill **完全无关**
- 同理：tools = 0（placeholder），mcp = `mcpServerNames.length * 200`（粗略估值跟实际 schema tokens 差很远）
- 结果：用户切 Skill 会话期待看到差异 → 看到没差 → 不信任 popover 数字
- 这违反 `feedback_no_hallucination`：UI 暗示"这是真实分类数字"，实际是 "compiler 内部 hardcoded + 粗估"

## 升级后用户能看到什么

| 用户场景 | 现状 | 升级后 |
|---|---|---|
| 发"你好"普通消息 | popover Skills 1.5K | popover **不显示** Skills 行（真实未调 Skill）|
| 发 `/humanizer-zh` 触发 Skill | popover Skills 仍 1.5K | popover Skills 显示真实增量（reflect 真正注入的 Skill prompt 大小）|
| 切到 MCP-heavy 工作流 | popover MCP 显示粗略估值 | popover MCP 显示真实 MCP tool schemas 总 tokens |
| 切到 Native runtime | popover Skills/MCP/Tools 全 0（claude-client.ts 才填，其他 Runtime 不填）| Native adapter 产出自己的 snapshot 或显式标 unsupported |
| 切到 Codex runtime | 同上 | Codex adapter 产出 snapshot 或 unsupported |
| 某类别 Runtime 不支持 | 显示 0（暗示 "这一项你没用"，但实际可能只是 Runtime 不报数）| UI 显式隐藏行，不暴露假数据 |

## 不做什么

- 不做账单级精度：跟 server 实际 tokenization 仍有 char/4 估算偏差，跟 cost API 同源即可
- 不强制所有 Runtime 必须支持所有 10 类：每个 Runtime 可显式声明 unsupported，UI 据此 hide
- 不重构 send path 整体结构：只引入新 contract 抽象 + 三 Runtime adapter 各自实现 produce()
- 不动 conversation / cache_or_previous / pending 三类（这些来自 baseline + composer，跟 Runtime 无关）
- 不立即修 Phase 0 之外的 Runtime（Native / Codex 实施分独立 Phase）

## 怎么验收（每 Phase 独立）

- **Phase 0 止损**：发"你好"普通消息，popover **不**显示 Skills/Tools/MCP 三行（之前显示假数字 1.5K + 0 + N×200）
- **Phase 1 Contract**：`src/lib/harness/context-accounting.ts` 导出 `RuntimeContextAccountingSnapshot` + `ContextAccountingSource` 类型；至少 1 个 unit test pin shape 不变；guardrail StreamSession.md 链 + Runtime.md 加 reference
- **Phase 2 ClaudeCode**：发"你好"普通消息 popover 只看到 system_prompt + memory + rules + conversation；发 humanizer-zh Skill 后 Skills 行出现且数字反映真实 Skill prompt 大小（跟普通消息不同）
- **Phase 3 Native**：Native session 切过去后 popover 类别数字非 placeholder
- **Phase 4 Codex**：Codex session 同上；Codex Account / proxy 各跑一条
- **Phase 5 收口**：三 Runtime Smoke Ledger 三条；Phase 6 文档 Phase 4 验收段引用本计划

## 详细设计

### 设计目标

1. **Contract first**：先定义"snapshot 是什么 / 字段含义 / unsupported 怎么表达"——三个 Runtime 一起遵守
2. **真实数据来源可追踪**：每个字段必须能 trace 到具体源（`source: 'sdk-init/skills' | 'mcp-server-schemas' | 'workspace-rules-fs' | ...`），UI 调试时能看
3. **unsupported 是 first-class**：Runtime 可声明 "I don't know how to count this kind"，UI 据此隐藏行，不伪装
4. **result event 是唯一持久化入口**：live `context_usage` event 只做实时预览，最终 snapshot 必须由 result event 落进 `token_usage.context_breakdown`

### Phase 0 — 止损（紧急、独立 commit）

**用户能看到什么**：popover 不再显示 Skills / Tools / MCP 三行（直到 Phase 2 真接通）。System prompt / Rules / Memory 仍显示真实数据。

**不做什么**：不动 Contract spec、不动其他 Runtime、不删 walkContextUsage / hook wire（管道保留）

**怎么验收**：
1. 发"你好"普通消息，popover 看不到 Skills / Tools / MCP 行（hideZero=true 默认隐藏）
2. 浏览器 console clean except tech-debt #20
3. 旧 row 没 snapshot 字段：popover 同样不显示这三行（向后兼容）

**实施清单**：
- `src/types/index.ts:ContextBreakdownSnapshot` 全字段改可选
- `src/lib/claude-client.ts` snapshot computation 删除三个误报字段：
  - 删 `skillsHarnessTokens`（capabilityFragments 不等于 Skill invocation）
  - 删 `toolDescriptorTokens`（永远 0 placeholder，本来就是误导）
  - 删 `mcpDescriptorTokens`（`mcpServerNames.length * 200` 粗估）
  - **保留** `systemPromptTokens` + `workspaceRuleTokens` + `memoryTokens`（这三个有真实数据来源）
- 更新 tech-debt #21：本来描述 placeholder 待 Phase 1c，现在改为"Phase 6.5 Contract Phase 2-4 完整实施"

### Phase 1 — Define Runtime Contract

新建 `src/lib/harness/context-accounting.ts`：

```ts
export type ContextAccountingKind =
  | 'system_prompt' | 'tools' | 'rules' | 'skills' | 'mcp'
  | 'memory' | 'files_attachments';

/** Per-kind accounting entry. */
export interface ContextAccountingEntry {
  tokens: number;
  /** Trace source for debug ("sdk-init/skills" | "mcp-server-schemas" | ...). */
  source: string;
  /** Optional sub-detail (e.g. each loaded Skill name + size). */
  detail?: string;
}

/** Runtime-produced snapshot. Each kind is either real entry OR unsupported. */
export interface RuntimeContextAccountingSnapshot {
  entries: Partial<Record<ContextAccountingKind, ContextAccountingEntry>>;
  /** Kinds this Runtime explicitly can't count. UI hides these rows. */
  unsupported: readonly ContextAccountingKind[];
  /** Runtime id for debugging. */
  producedBy: 'claude_code' | 'native' | 'codex_proxy';
}
```

每个 Runtime adapter 必须实现：
```ts
function produceContextAccountingSnapshot(
  input: AdapterInput
): RuntimeContextAccountingSnapshot
```

**验收**：
- Contract type 落地 + 单元测试 pin shape（≥ 3 测试：entries shape / unsupported semantics / producedBy 必填）
- walkContextUsage 返回值 + hook 喂改成消费新 snapshot（取代旧 `ContextBreakdownSnapshot`，保持向后兼容旧 row）
- guardrail Runtime.md 加 reference 指向 Contract

### Phase 2 — ClaudeCode Adapter 实施

按 user spec 的真实来源：

| Kind | 真实来源 | source breadcrumb |
|---|---|---|
| `system_prompt` | `compiled.basePrompt` + `compiled.artifactContracts` (Phase 0 已保留) | `compiler.budget.basePrompt+artifactContracts` |
| `tools` | SDK Options.tools 的 tool definition JSON（非 MCP）char/4 | `sdk-options-tools` |
| `rules` | CLAUDE.md + workspace `.cursor/rules/` 内容 char/4（已保留 workspaceFragments[kind=rule]） | `workspace-rules-fs` |
| `skills` | SDK initMsg.skills（运行时实际 loaded skills 列表）+ scan `.claude/skills/*.md` filesize | `sdk-init-skills` |
| `mcp` | SDK Options.mcpServers tool list 各 tool schema JSON char/4 | `mcp-server-schemas` |
| `memory` | assistant memory snapshot tokens（保留 memoryFragments） | `compiler.memoryFragments` |

**风险**：SDK initMsg.skills 字段当前未确认存在；可能需要走 SDK init result event 读 metadata。需 Phase 2.0 一步 POC verify。

### Phase 3 — Native Adapter 实施

Native runtime 通过 AI SDK 自建：
- tools: AI SDK `tools` 参数的 schema JSON
- system_prompt: 自建 system prompt template
- mcp: 通过 harness bundle 拿到的 MCP 描述
- skills: harness bundle 的 user/external extensions kind=skill
- memory: 同 ClaudeCode

### Phase 4 — Codex Adapter 实施

Codex runtime 通过 app-server JSON-RPC：
- 大部分 kind 通过 app-server tokenUsage events 拿
- skills / mcp / tools: 通过 proxy translator + harness bridge + tool descriptors 估算
- 不支持的 kind 显式 `unsupported`（Codex 当前不接 CodePilot memory → memory unsupported）

### Phase 5 — Smoke + closeout

三 Runtime 各跑一条真实 smoke：
- ClaudeCode: humanizer-zh Skill 会话发送，验证 Skills 行 > 0 且大于普通消息基线
- Native: Native session 配 MCP server，验证 MCP 行非 placeholder
- Codex: Codex Account session，验证 Memory unsupported（不显示行）

Smoke Ledger 落 Phase 6 文档 + 本文档；Phase 6 closeout 后归档。

## Smoke Ledger（Phase 5 时填）

| Date | Runtime | Provider | Model | 凭据形态 | 场景 | Result | Evidence |
|------|---------|----------|-------|---------|------|--------|----------|
| _示例_ | claude_code | Claude Code | Opus | 本机登录 | humanizer-zh skill | ✅ | screenshot + popover Skills > 普通消息 baseline + console clean except #20 |

## 决策日志

- 2026-05-19: User Codex review 指出 Phase 6 Tier 2 (`a4fa2d4`) "数字不是用户以为的那个东西"。triggering 本计划。
- 2026-05-19: 拆 6 Phase（0 止损 + 1 Contract + 2 ClaudeCode + 3 Native + 4 Codex + 5 closeout），Phase 0 紧急独立 commit。
- 2026-05-19: 真实数据来源 spec 由 user 直接给出（initMsg.skills / MCP schemas / CLAUDE.md / workspace rules / memory snapshot）。
- 2026-05-19: unsupported 是 first-class 状态而非"显示 0"——避免 hallucination 风险。
- 2026-05-19: tech-debt #21（tools/mcp placeholder）被本计划吸收，#21 entry 更新指向本计划而非独立修法。
