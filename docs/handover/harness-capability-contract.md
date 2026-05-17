# Harness Capability Contract

> 产品思考见 [docs/insights/harness-capability-contract.md](../insights/harness-capability-contract.md)
> 执行计划：[docs/exec-plans/active/phase-5d-harness-capability-contract.md](../exec-plans/active/phase-5d-harness-capability-contract.md)
> 相关：[docs/handover/codex-tool-bridge.md](./codex-tool-bridge.md)（Phase 5c Codex bridge 实现）/ [docs/handover/provider-proxy-bridge.md](./provider-proxy-bridge.md)（Codex Responses proxy 协议层）

## 这层做什么

把 CodePilot 自有能力（Memory / Tasks / Widget / Media / Notify / Dashboard / CLI tools）的**跨 Runtime 行为契约**钉死成单一来源，让 ClaudeCode SDK Runtime / Native Runtime / Codex Runtime 看到的同一个 CodePilot 能力是真的同一个能力，不是三份漂移的实现。

不替换现有 MCP 服务器、AI SDK tools 或 Codex bridge factory；只声明它们必须满足的契约 + 用测试守住。

## Context Compiler（Phase 5d Phase 2，2026-05-17）

`src/lib/harness/context-compiler.ts` 是单一纯函数 `compileContext(input): CompiledContext`，三个 Runtime 都通过它读取本轮应该注入什么。

**输入**：`{ sessionId, workingDirectory, runtimeId, providerId, model, userPrompt, enabledCapabilities, assistantMemory?, permissionProfile?, tokenBudget, flags? }`。Compiler 不做 IO；assistantMemory 等动态内容由调用方预取后传入。

**输出**：`{ basePrompt, capabilityFragments, artifactContracts, memoryFragments, workspaceFragments, toolDescriptors, runtimeHints, budget, systemPromptText, diagnostics }`。

**硬约束**：
- artifactContract 在 capabilityFragments **之前**（避免长 prompt 末尾丢失 wire format）
- 每个 `fragmentId` 在 CompiledContext 中只能出现一次
- 同一 `fragmentId` 在不同 RuntimeId 下编出来的 `text` 严格相等
- 若 capability fragment 的 text 内含 artifact contract 的 `canonicalJson`，编译失败（防止 wire-format 在 final prompt 中出现两次 — slice 2c 已经 strip 了 `WIDGET_SYSTEM_PROMPT` 的内嵌 spec，artifactContract 是唯一 wire-format 持有者）
- `runtimeHints` 只放 IDs / refs / 适配器选项，禁止 prose / tool schema paraphrase

**三 Runtime 怎么消费（全部通过 `compileContext`）**：

- **ClaudeCode SDK Runtime** (`src/lib/claude-client.ts`)：MCP server 注册（transport 层）按既有 gating 逻辑跑（workspace / keyword / always）；每命中一类，capability id 加入 `enabledCapabilities` Set。所有 MCP server 注册完之后调一次 `compileContext({ runtimeId: 'claude_code', enabledCapabilities, ... })`，把 `compiled.systemPromptText` 追加到 `queryOptions.systemPrompt.append`。**slice 2c 后再无 per-capability `+ _SYSTEM_PROMPT` 内联拼接**。
- **CodePilot Native Runtime** (`src/lib/builtin-tools/index.ts getBuiltinTools()`)：per-group condition（always / workspace / { keywords }）仍由该函数决定；命中后通过 `capabilityIdForGroup(group.name)` 映射到 capability id 进 `enabledCapabilities`；末尾调 `compileContext({ runtimeId: 'codepilot_runtime', enabledCapabilities, ... })`，`compiled.systemPromptText` 作为 `systemPrompts[0]` 返回。session-search / ask-user-question 等未入 capability contract 的 group 仍按 raw `group.systemPrompt` 进入后续 entries。
- **Codex Runtime bridge** (`src/lib/codex/proxy/unified-adapter.ts` + `builtin-bridge.ts`)：bridge 自身不持有 `_PROMPT` 标量（slice 2e 删除）。`createCodePilotBuiltinTools().systemPrompt` 恒为 `''`。`unified-adapter` 按 **bridge mount → translateResponsesTools → compileContext → bodyWithBridgePrompt → buildMessages(bodyWithBridgePrompt)** 这个顺序跑，让 `compiled.systemPromptText` 通过 `body.instructions` 进入 `messages[]` 的 role:system 槽位（这样 Anthropic-compat / CodePlan / chat-completions 路径也能看到 capability prompt，不再只走 OpenAI Responses 的 `providerOptions.openai.instructions`）。`enabledCapabilities` 由 `capabilitiesFromBridgeToolNames(bridge.toolNames)` 反推，跟 bridge 真实 mount 的工具集对齐。

**Expected Differences Ledger**（`src/lib/harness/expected-differences.ts`）：

是 2b 等价测试的白名单，登记 Compiler 输出与某 Runtime 当前 implementation 之间的合理差异。slice 7b 引入时初始 4 条；slice 2d 消化掉三条 Native paraphrase 后只剩 1 条 `image_generation` MediaBlock 的 `follow_up`（Native 的 image_generation 还返回 text，没构造 MediaBlock；属于 tool-result shape 问题，不是 prompt drift，slice 后续 follow_up）。

**测试覆盖**：

- `harness-context-compiler.test.ts`（23 pins）：catalog hygiene、widget wire-format 单源（#10）、ordering、budget、cross-runtime fragment text identity、tool descriptors、runtimeHints boundary（#11 — 类型层 + 运行时层 + source-grep）、ledger 一致性（#12）
- `harness-context-compiler-equivalence.test.ts`（9 pins）：compilerSource / runtimeSource 文件可读 + export 可静态发现、capability_fragment_replaced 真有 drift、ledger ↔ slice ownership 对齐
- `harness-capability-contract.test.ts` 增量：bridge 不再持有 _PROMPT 标量、Native 三文件 re-export canonical、ClaudeCode source-pin

## 三层模型

每个能力按三层定义：

| 层 | 内容 | 如何固定 |
|---|---|---|
| Tool schema | 工具名、参数 schema、描述 | 各 Runtime 的 factory 函数（MCP / AI SDK tool / bridge tool）继续保留实现；契约声明 `toolNames`，drift 测试断言这些名字真的注册了 |
| Context instruction | system prompt fragment（capability 文本提示） | 单一权威文件持有完整 fragment；另外两个 Runtime 通过 TS import 引用同一常量，禁止改写 |
| UI artifact contract | tool 结果格式 + canonical 事件 + 前端渲染路径 | 契约声明 `toolResultShape` / `canonicalEventTypes` / `uiRenderPath` / 可选 `artifactContract`；renderer 与契约由 contract test 校验 |

Widget 的 `show-widget` JSON 示例需要 round-trip 校验：契约持有 `canonicalJson`，测试用 `JSON.parse` 解开，再喂给 `parseAllShowWidgets` 必须返回一个 `widget` segment（不是 `malformed_widget`）。

## 文件总览

| 文件 | 角色 |
|---|---|
| `src/lib/harness/capability-contract.ts` | 唯一目录。每个能力一个 `CapabilityContract` 条目，导入并暴露权威 prompt fragment + 三 Runtime 暴露方式。 |
| `src/lib/widget-guidelines.ts` | Widget 权威源。`WIDGET_SYSTEM_PROMPT` / `WIDGET_WIRE_FORMAT_SPEC` / `CANONICAL_SHOW_WIDGET_JSON` 在这里；Native + Codex bridge 通过 import 消费。 |
| `src/lib/memory-search-mcp.ts` | Memory 权威源 (`MEMORY_SEARCH_SYSTEM_PROMPT`)。 |
| `src/lib/notification-mcp.ts` | Tasks + Notify 权威源 (`NOTIFICATION_MCP_SYSTEM_PROMPT`)。 |
| `src/lib/builtin-tools/media.ts` | 媒体（image gen + import）权威源 (`MEDIA_SYSTEM_PROMPT`)。MCP 端没有等价文件 — tech-debt：未来补 `media-mcp.ts` 让它和其它能力同形。 |
| `src/lib/dashboard-mcp.ts` | Dashboard 权威源 (`DASHBOARD_MCP_SYSTEM_PROMPT`)。Codex bridge 未实现，状态 `deferred`。 |
| `src/lib/builtin-tools/widget-guidelines.ts` | Native Runtime widget。re-export 权威 prompt，不再持有 abridged 副本。 |
| `src/lib/codex/proxy/builtin-bridge.ts` | Codex Runtime bridge。`WIDGET_PROMPT = CANONICAL_WIDGET_SYSTEM_PROMPT`（slice 7 修过的最小漂移点）。 |
| `src/__tests__/unit/harness-capability-contract.test.ts` | 契约测试套。catalog 完整性 / 工具名一致性 / drift 检测 / Widget JSON round-trip / 媒体 render path / 状态分类。 |

## 当前能力矩阵

由 `HARNESS_CAPABILITIES` 数组持有；如下表是 2026-05-16 slice 7 状态。任何更新先改契约 + 跑测试，不要直接改 MCP / Native / bridge。

| Capability | Status | Tool names | ClaudeCode SDK | Native | Codex Proxy | 备注 |
|---|---|---|---|---|---|---|
| widget | live | `codepilot_load_widget_guidelines` | MCP `createWidgetMcpServer` | AI SDK `createWidgetGuidelinesTools`（re-export 权威 prompt） | bridge `buildWidgetGuidelinesTool`，`WIDGET_PROMPT = canonical` | slice 7 de-drifted；artifact contract = `show-widget` fence，JSON.parse-safe 示例 |
| memory | live | `codepilot_memory_recent`、`codepilot_memory_search`、`codepilot_memory_get` | MCP `createMemorySearchMcpServer` | AI SDK `createMemorySearchTools`（仍有 prompt drift） | bridge `buildMemoryRecentTool` / `buildMemorySearchTool` / `buildMemoryGetTool` | workspace-gated；Native + bridge prompt 与 MCP 仍漂移，slice 8 tech-debt |
| tasks_and_notify | live | `codepilot_notify`、`codepilot_schedule_task`、`codepilot_list_tasks`、`codepilot_cancel_task` | MCP `createNotificationMcpServer` | AI SDK `createNotificationTools` | bridge `buildNotifyTool` / `buildScheduleTaskTool` / `buildListTasksTool` / `buildCancelTaskTool`（全部 4 个 mount） | slice 4 已修 durable / list / cancel parity；slice 7b 把 `codepilot_hatch_buddy` 拆到 `assistant_buddy` capability |
| assistant_buddy | deferred | `codepilot_hatch_buddy` | MCP `createNotificationMcpServer`（同源 MCP server） | AI SDK `createNotificationTools` | unsupported — bridge 未挂载；Codex Runtime 用户切到 ClaudeCode / Native 触发 hatch | slice 7b 新增；hatch buddy 在 bridge 的归属（Harness capability vs assistant workspace flow）待 Phase 2-3 拍板 |
| image_generation | live | `codepilot_generate_image` | MCP `createImageGenMcpServer`（通过 MEDIA_RESULT_MARKER 注入 SSE media） | AI SDK `createMediaTools` (image key)（仅返回文本，无 MediaBlock — drift tech-debt） | bridge `buildImageGenerationTool`（带 MediaBlock + materialize） | slice 2 + 4 已修 |
| media_import | live | `codepilot_import_media` | MCP `createMediaImportMcpServer`（owns MEDIA_MCP_SYSTEM_PROMPT；claude-client.ts 注册为 `codepilot-media`） | AI SDK `createMediaTools` (import key) | bridge `buildImportMediaTool`（slice 4 已按 mimeType 推断 type） | slice 7b 修正 — 早期把 ClaudeCode SDK 错标 unsupported，真实有 MCP 实现 |
| dashboard | deferred | `codepilot_dashboard_*` ×5 | MCP `createDashboardMcpServer` | AI SDK `createDashboardTools` | unsupported — 写操作需要 bridge permission round-trip 设计 | Phase 5d Phase 3 之后再开 |
| cli_tools | deferred | `codepilot_cli_tools_*` ×6 | MCP `createCliToolsMcpServer` | AI SDK `createCliToolsTools` | unsupported — install/update/remove 需要 permission 契约 | 同上 |

## 契约测试都测什么

`harness-capability-contract.test.ts` 锁定的不变量：

1. **Catalog hygiene** — 每个 entry 字段齐全；id 唯一；非 live 必须有 `deferredReason`。
2. **严格 live 语义（slice 7b）** — `status === 'live'` 必须**所有声明 runtime exposure 都不是 `unsupported`**。任何"live 但某 runtime unsupported"的混合口径都自动 fail；要么把 unsupported runtime 实现掉，要么把 status 改成 `deferred`，要么拆 capability。
3. **Tool-name agreement** — live capability 声明的工具名必须在至少一个 wired 文件源中出现。
4. **Bridge drift 严格检测** — bridge `WIDGET_PROMPT` 必须是 `CANONICAL_WIDGET_SYSTEM_PROMPT` 的 import + 直接赋值；Native widget 同样必须 re-export 权威。
5. **Widget JSON round-trip** — 契约里的 `canonicalJson` 走 `JSON.parse` 不抛；走 `parseAllShowWidgets` 必须返回 widget segment（不是 malformed）。
6. **Media render path** — `toolResultShape === 'media'` 的 capability，`uiRenderPath` 必须提到 `MediaPreview`。
7. **状态-暴露一致性** — deferred 必须至少一个 runtime 标 unsupported；unsupported 必须带 `notes` 解释。
8. **runtime 真实挂载（slice 7b 收紧）** — `createCodePilotBuiltinTools` 必须**真的 mount 每一个**`codex_proxy.kind === 'bridge_executable'` capability 的 `toolNames`，**不接受 notes 例外**。不挂载的工具要么改 bridge factory，要么把那个 runtime 标 `unsupported`，要么拆出 deferred capability（参考 `assistant_buddy`）。

## 接入新 Runtime 的硬性流程

> 这部分对应 Phase 5d Phase 5 的 Playbook。新 Runtime（Hermes / Gemini / OpenClaw 等）落地前必须按此走。

1. **Snapshot 上游协议** — 把目标 Runtime 的 SDK / protocol fixture 拷到 `资料/<runtime>/`。Codex `tool_spec.rs` enum 是最近一次的真实参照（参考 `资料/codex/codex-rs/tools/src/tool_spec.rs`）。
2. **填 Runtime Capability Inventory** — 对每个 `live` capability 决定：原生支持 / 通过 bridge 执行 / 当前 unsupported with reason。
3. **修改契约** — 给每个 capability 的 `exposure` map 加一个新的 runtime key（先 `unsupported with notes`，再逐项升级）。
4. **跑 contract tests** — `npm run test`。测试不会过的 capability，要么写实现，要么明确 unsupported。
5. **跑 smoke matrix** — capability 全部 live 之后才跑真实凭据 smoke。**禁止反过来：先 live smoke 再补字段**（这是 Phase 5c 三天救火的根因）。
6. **打开 picker** — smoke 全过、契约绿，才把 Runtime 在 Settings / Runtime picker 标可用。

## 当前已知 tech-debt

| 项 | 影响 | 解决方向 |
|---|---|---|
| Native widget 早期有 abridged prompt，slice 7 已 re-export 权威 | 已修 | — |
| Native memory + tasks 仍有自己的 prompt（drift） | 模型在 Native Runtime 下读到的规则与 ClaudeCode/Codex 不同 | slice 8：让 builtin-tools/memory-search.ts + builtin-tools/notification.ts 从 MCP 文件 re-export |
| `image_generation` Native exposure 不返回 MediaBlock | Native Runtime 下用户看不到图片卡（要看 marker text） | slice 8：让 Native execute 也构造 MediaBlock 走 ai-sdk tool result |
| `media_import` 在 builtin-tools/media.ts 仍有自己的 Native prompt（drift from MCP-side MEDIA_MCP_SYSTEM_PROMPT） | Native 模型读到的导入工作流提示比 MCP 短 | slice 8：让 builtin-tools/media.ts 从 media-import-mcp.ts re-export，或为 import / generate 分别拆 prompt |
| `assistant_buddy` (codepilot_hatch_buddy) 未接 Codex bridge | Codex Runtime 用户无法直接 hatch buddy | Phase 5d Phase 2-3 阶段决策：是 Harness capability 还是 assistant workspace flow |
| Dashboard / CLI tools 无 Codex bridge | Codex Runtime 用户调不动这两族工具 | 需要先定 bridge 端 permission round-trip 协议 |
| `cli_tools` 没有独立 `_SYSTEM_PROMPT` export | 契约的 systemPromptFragment 暂为空字符串 | slice 8：从 MCP factory 提取 |

## 与既有契约的关系

- `RuntimeRunEvent` / `AgentRuntime`（`src/lib/runtime/contract.ts`） — 是输出面契约（runtime 发什么事件给 UI）。Harness Capability Contract 是**输入面 + 中间面**契约（UI 上看到的"一项能力"在每个 runtime 各自怎么挂、提示什么、产出什么）。两层互不替代，配合用。
- `Provider Proxy Bridge`（`docs/handover/provider-proxy-bridge.md`） — Codex Responses proxy 的协议层（八个 hook）。Capability Contract 是其上一层：proxy 让 Codex 能跑 CodePilot provider 的请求；bridge 是 proxy 上挂的 CodePilot 能力适配器。
- `Codex Tool Bridge`（`docs/handover/codex-tool-bridge.md`） — Phase 5c 的具体实现交付。Phase 5d 把 5c 的经验抽成契约。
