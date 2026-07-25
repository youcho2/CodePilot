# Runtime Compatibility Filtering — 护栏

CodePilot 有两条 chat 运行路径：**Claude Code Runtime**（SDK 子进程）和 **CodePilot Runtime**（@ai-sdk/* 直连）。Provider / Model / Composer 三层过滤契约必须严格对齐，否则 picker 看到的、resolver 选中的、wire 上发出去的会出现三方不一致，长期看就是用户报"模型选了 A，实际请求 B"或者"切了 runtime 但 picker 还是老模型"。

## 1. 词汇表

| 名称 | 取值 | 来源 |
|---|---|---|
| `agent_runtime` setting | `'auto' \| 'native' \| 'claude-code-sdk'` | DB `settings` 表，用户在 Settings → CLI 设置 |
| Concrete runtime | `'native' \| 'claude-code-sdk'` | `resolveRuntime()` 输出（`runtime/registry.ts`） |
| `ChatRuntime` | `'claude_code' \| 'codepilot_runtime'` | `chat-runtime.ts` 把 concrete 映射到 chat-side 词汇 |
| `ChatRuntimeParam` | `ChatRuntime \| 'auto'` | API query / hook 参数；`'auto'` = server 端用 `getActiveChatRuntime()` 自己解析 |
| `ProviderRuntimeCompat` | `claude_code_ready` / `claude_code_verified` / `claude_code_experimental` / `codepilot_only` / `media_only` / `unknown` | `getProviderCompat()` (`runtime-compat.ts`) |
| `ModelRuntimeCompat` | `{ chat?, tool_capable?, thinking_capable?, claude_code_compatible?, codepilot_runtime_compatible?, media? }` | `getModelCompat()` (`runtime-compat.ts`) |

## 2. 三层过滤契约

### 2.1 Settings 全量 vs Composer runtime-filtered

| 入口 | 调用 | 看到什么 |
|---|---|---|
| Settings → Providers 全局默认模型选择器 | `fetch('/api/providers/models')`（**不传** `?runtime=`） | 完整 catalog，所有 provider 所有 enabled 模型 |
| Settings → Models 页 | 直接 fetch + 自己 filter，不通过 hook | 完整 catalog，按用户操作（runtime filter dropdown / 搜索 / enabled tab）筛 |
| Composer / chat picker | `useProviderModels(providerId, modelName)` 默认 `runtime: 'auto'` → `?runtime=auto` | 服务端按 active runtime 过滤后的 enabled 模型 |
| chat 主入口 send 路径 | `resolveProvider({ ..., runtime: getActiveChatRuntime() })`（`/api/chat/route.ts` + `bridge/conversation-engine.ts`） | server 端按 runtime gate 选 default model + availableModels |

**不变量**：Composer / chat send 路径**永远**带 active runtime；Settings 全局默认选择器**永远**不带（避免 user 看不到他想设为默认的 codepilot_only 模型）。这两条对调过任何一次都会出 bug。

### 2.2 Compat tier × runtime 必须命中表

| `ProviderRuntimeCompat` | runtime=`claude_code` 时该出现？ | runtime=`codepilot_runtime` 时该出现？ |
|---|---|---|
| `claude_code_ready` (Anthropic / Bedrock / Vertex) | ✅ 必须 | ✅ 必须（`@ai-sdk/anthropic` 也能直调） |
| `claude_code_verified` (GLM / Kimi / Volcengine 等已实测 Code Plan) | ✅ 必须 | ❌ 整组 drop（多数 sdkProxyOnly） |
| `claude_code_experimental` (anthropic-thirdparty wildcard) | ✅ 必须 | ❌ 整组 drop |
| `codepilot_only` (OpenRouter / OpenAI-compat / Google chat) | ❌ 整组 drop | ✅ 必须 |
| `media_only` | ❌ 整组 drop | ❌ 整组 drop（不进 chat picker） |
| `unknown` (custom URL 没匹配预设) | ✅ 必须（双向兼容，UI 标"需验证"） | ✅ 必须 |

**已知陷阱（已修，别走回头路）**：
- 之前 `getModelCompat` 的 `codepilot_only` 分支有 alias lift 让 `anthropic/claude-*` 标 `claude_code_compatible`，导致 OpenRouter 的 claude 模型在 `claude_code` runtime 下能被选中——但 OpenRouter 整组在 group-layer 已被 drop，user 选了又跑不通。Codex 2026-04-26 review 指出后已删（`runtime-compat.ts:128` 注释）。**不要再加回去**。要让 OpenRouter 的 claude 走 Claude Code，方案是单独配 `anthropic-thirdparty` preset 指向 OpenRouter 的 anthropic-compat endpoint。

### 2.3 API 失败 ≠ 空集合（不能静默伪造 env fallback）

`/api/providers/models?runtime=...` 三种返回，hook + chat-page init 必须分清：

| 来源 | hook 行为 (`useProviderModels`) | chat-page init 行为 |
|---|---|---|
| HTTP 200 + `groups: [...]` 非空 | `setProviderGroups(data.groups)`、`fetchState='loaded'` | 走 validation chain，应用 global default / saved provider |
| HTTP 200 + `groups: []` (runtime filter 后真空) | `setProviderGroups([])`、`fetchState='loaded'` → `noCompatibleProvider=true` | 清 `currentProviderId/Model` + `noCompatibleProvider=true` + 引导 UI |
| HTTP error / parse fail / network down | catch 分支合成 `[{ provider_id: 'env', models: DEFAULT_MODEL_OPTIONS }]`、`fetchState='failed'` | 走 localStorage best-effort fallback |

**不变量**：成功返回的空集合**绝对不能**触发"合成 env + sonnet/opus/haiku"逻辑——那等于把刚被 server 端 runtime gate 过滤掉的模型偷渡回来。仅 `catch` 分支可以走 env synthetic fallback。

### 2.4 同 Runtime 子 Agent 路由

| 层 | 契约 |
|---|---|
| 父主控 | 当前会话已选 Runtime / Provider / Model 不变；delegate 不允许偷换父会话路由 |
| CodePilot Runtime | managed `Agent` 使用全 CodePilot-compatible catalog 的精确 `provider_id + model`；child 工具装配与模型调用必须同时切到目标 Provider。省略两者才继承父路由 |
| Claude Code Runtime | 精确模型委派必须走 `codepilot_spawn_subagent`：route 来自全部 Claude Code picker 未置灰模型，handler exact 校验 Provider+Model 后启动独立 SDK subprocess；child 继承父 query 的 built-ins、MCP、permission profile 与 approval callback，并移除 Agent/Task。route 只证明 catalog-compatible，不证明账号 entitlement；SDK terminal 必须检查 `is_error` / `api_error_status` |
| Codex Runtime | CodePilot Provider 会话通过 builtin proxy bridge 新建显式目标 Provider+Model 的 child thread，继承父 sandbox / approval、Codex 原生工具与全部 MCP，并按 thread ID 隔离父子事件；CodePilot 不再按联网/写入/Shell 等类别建立第二套 capability gate。app-server 的 `web_search` 只在目标 SDK 有真实 hosted tool 时翻译。Codex Account 只归一化原生 `collabAgentToolCall` |
| 展示 | requested 与 effective 分离；Native 以执行结果 breadcrumb 证明 effective，其他 Runtime 拿不到就只显示 requested |

**不变量**：同 Runtime 不等于任意 model string，也不等于同 Provider。managed route 必须来自该 Runtime picker 未置灰/兼容集合并同时命中 `provider_id + model`，执行层的工具装配、凭据解析和模型调用必须全部使用目标 Provider；只传 `sonnet / haiku` 等重复 alias 不足以证明模型身份。不能按品牌误杀 Kimi / GLM / DeepSeek，也不能把不可达模型静默改成 Sonnet/inherit。Claude 原生 AgentDefinition 与 Codex 原生 spawn 即使接受 model，也不能被当作 CodePilot 跨 Provider 路由；Runtime 未返回 effective 事实时 UI 留空；一旦 Runtime 明确报告了不同模型，必须以 `ROUTE_MISMATCH` 终止当前 attempt，不能接受 fallback。catalog 命中不等于 entitlement 成功；任何结构化 provider error 都不能归为 completed。

Claude managed subprocess 的调用方仍必须完整声明 `required_capabilities`，该字段只核对 Claude SDK 父 query 的真实工具 surface，不是固定只读开关。Codex managed child 不暴露这个字段：Codex app-server 是 native tools、MCP、sandbox 与 approval 的唯一能力事实源，CodePilot 只负责目标 Provider+Model 路由与 transport，不预判或裁剪工具类别。两条路径在真实工具缺失时都必须诚实失败，不能用训练知识或本地旧内容冒充实时检索。每个调用仍是 one-shot foreground attempt，不能 placeholder / stand-by / resume；同一用户任务的显式 retry 必须复用前次返回的 `logicalRunId`，不同任务不得复用。Runtime Adapter 不能只信调用方：复用 active/settling logical run 必须返回 `LOGICAL_RUN_STILL_RUNNING`，复用 completed logical run 必须返回 `LOGICAL_RUN_ALREADY_COMPLETED`，且两者都不得调用 Provider 或把拒绝记录成新的 attempt。

三 Runtime 的依赖编排不能由各自 SDK 猜测。一个 dependency graph 使用共同的 `workflow_id`，每个 child 使用唯一 `task_key`，边由 `depends_on` 声明；Adapter 先创建 durable queued run，再统一调用 `resolveSubagentDependencies()`。只有上游同 workflow task 已 durable completed 且存在结果时，CodePilot 才把结果作为带 provenance 的 data 注入实际 child prompt 并切换到 executing。SDK tool call 串行不等于结果自动传递；调用方必须先发 upstream，缺失上游只给并行 handler 5 秒创建宽限，不能让 dependent-first 在串行 Runtime 上长期阻塞。未声明依赖的 wait/stand-by prompt、失败依赖、重复 task key 与 self/indirect cycle 必须在 Provider 启动前 fail closed。

## 3. 关键文件 + 不变量

| 模块 | 文件 | 不变量 |
|---|---|---|
| ChatRuntime 词汇 | `src/lib/chat-runtime.ts` | 必须 import 自 `'./runtime'`（barrel）而非 `'./runtime/registry'`，否则 `registerRuntime()` 副作用不触发 → `resolveRuntime()` 抛 "No agent runtime registered" |
| Provider compat tier | `src/lib/runtime-compat.ts` `getProviderCompat()` | preset.protocol='anthropic' 必须按 `meta.claudeCodeVerified` 拆 verified vs experimental；`codepilot_only` 分支**不能**有 claude alias lift |
| Model compat flags | `src/lib/runtime-compat.ts` `getModelCompat()` | `claude_code_ready` 双向兼容（claude_code + codepilot_runtime）；`verified` / `experimental` 仅 `claude_code_compatible`；`codepilot_only` 仅 `codepilot_runtime_compatible` |
| Server filter | `src/app/api/providers/models/route.ts` | 仅当传 `?runtime=` 才过滤；过滤后空 group **必须** drop（`.filter(g => g.models.length > 0)`），否则 hook 仍会 cross-wire |
| Hook contract | `src/hooks/useProviderModels.ts` | 暴露 `fetchState / resolvedProviderId / resolvedModel / providerWasFilteredOut / noCompatibleProvider` 五字段；区分 `providerId === undefined`（fallback chain）vs `providerId === ''`（env 历史会话）vs 显式值 |
| Composer send | `src/components/chat/ChatView.tsx` `doStartStream` / `sendMessage` | 三道 gate：`fetchState === 'idle'` / `noCompatibleProvider` / `loaded && (!resolvedProviderId \|\| !resolvedModel)`；wire 用 resolved pair 而非 raw |
| Composer disabled | `src/components/chat/ChatView.tsx` `MessageInput.disabled` | `noCompatibleProvider \|\| providerFetchState === 'idle'` —— idle 也禁用，避免 send 按钮看似可用但底层吞 |
| New session init | `src/app/chat/page.tsx` | 两处 init handler 必须用 `?runtime=auto`；空集合 → `setNoCompatibleProvider(true)`，不走 localStorage fallback |
| Auto-trigger | `src/hooks/useAssistantTrigger.ts` | welcome / heartbeat 必须吃 resolved pair + 在 `fetchState !== 'loaded' \|\| noCompatibleProvider` 时 return |
| Chat API resolver | `src/app/api/chat/route.ts` 第 263 行 | `resolveProvider({ runtime: getActiveChatRuntime() })` —— 别忘了传 |
| Bridge engine | `src/lib/bridge/conversation-engine.ts` | 同上 |

## 4. 加 / 改新功能时必须检查

- 新增 provider preset：在 `provider-catalog.ts` 加 `meta.claudeCodeVerified: true` 当且仅当**实测**端到端跑通 tool calling / thinking / 模型别名。否则保持 `experimental`
- 新增 runtime path（如未来加 OpenAI Responses / Codex / Hermes runtime）：
  - 在 `runtime/index.ts` 注册
  - 在 `chat-runtime.ts` `getActiveChatRuntime()` 加 mapping
  - 在 `runtime-compat.ts` 加新 ProviderRuntimeCompat tier + getModelCompat 分支
  - 更新本文 §2.2 命中表
- 新增 `useProviderModels` consumer：
  - 默认走 `runtime: 'auto'`（chat picker 行为）
  - 想看全集才显式传 `null`，并在代码里写注释说明为什么需要全集
- 新增 chat 入口（除现有 chat-route / bridge 外）：
  - 调 `resolveProvider()` 时**必须**传 `runtime: getActiveChatRuntime()`
  - send 路径前必须 gate `noCompatibleProvider` + `fetchState`
- 新增 sub-agent adapter：必须定义 model allowlist / alias canonicalization / effective provenance，并消费共同 workflow/task/dependency compiler；未证明的能力 fail closed，不得实现第四套 queued/依赖等待语义

## 5. 常见坑

1. **直接 import `./runtime/registry` 而非 `./runtime` barrel** → `resolveRuntime()` 抛 "No agent runtime registered"。但 `claude-client.ts` 是个例外（与 sdk-runtime 循环依赖），它故意只 import registry，靠 caller 触发 barrel
2. **把 `providerId === ''` 当 falsy** → 历史 env-mode session（`provider_id=''`）被 localStorage / global default 抢走。区分 `=== undefined`（caller 没给）vs `=== ''`（env 显式选）
3. **Hook fetchState 初始 `'loaded'`** → 挂载第一帧 picker 误判 `noCompatibleProvider=true`，让 send 被吞。必须 `'idle'` 起步
4. **`fetchAll` 重新拉时不重置 `fetchState`** → `provider-changed` 事件 refetch 期间旧 groups 仍生效，runtime gate 短暂打开。每次 fetchAll 头部 `setFetchState('idle')`
5. **没 abort 旧 fetch** → 慢的旧请求晚到覆盖新请求结果。`useRef<AbortController>` + 每次 fetchAll 头部 `controller.abort()`，`.then` / `.catch` 检查 `signal.aborted`
6. **catch 合成 env synthetic 后下游 derivation 仍按"groups 空 = noCompatibleProvider"判** → 矛盾。`noCompatibleProvider = fetchState === 'loaded' && providerGroups.length === 0`，failed 状态里 groups.length=1 不算 noCompatibleProvider
7. **MessageInput auto-correct fire `onProviderModelChange(currentProviderIdValue, fallback)` 时，`currentProviderIdValue` 是 hook 内部 fallback group 的 id 而非 prop providerId** → 写回 session 的是 fallback provider，正确。但 Composer 顶层那次 `useProviderModels` 必须返回**同步过的** resolved pair，不能让 ChatView 的 `currentProviderId` state 落后于 hook 的 resolved 信号 → ChatView 用 useEffect 监听 `providerWasFilteredOut` + PATCH session 同步
8. **父模型在一个 turn 内同时生成 A/B tool input，SDK 随后按 A→B 串行执行** → B 的 prompt 仍在 A 结果产生前冻结，不能据此宣称 B 获得 A 输出。依赖必须走 `workflow_id/task_key/depends_on` 与 app-side durable handoff。

## 6. 测试覆盖

| 测试文件 | 覆盖 |
|---|---|
| `src/__tests__/unit/chat-runtime.test.ts` | `getActiveChatRuntime()` 不抛 + 各 setting 下返回值 + param helpers |
| `src/__tests__/unit/provider-resolver.test.ts` | `getProviderCompat` 5 态 + `getModelCompat` alias-lift 删除回归 + runtime gate skip + hidden+runtime stack + env session env normalize |
| `src/__tests__/unit/runtime-selection.test.ts` | inlined `predictNativeRuntime` (registry side effects 隔离) |
| `src/__tests__/unit/sdk-availability.test.ts` | sdk-runtime 直接 import（被 barrel registerRuntime 调用前先 init），测 isAvailable 各路径 |
| `src/__tests__/unit/subagent-orchestration.test.ts` | Provider+Model route、三 Runtime 工具/权限继承、hosted search、requested/effective view |

加新 runtime gate 行为的功能时，至少加一组 unit test 覆盖三场景：(1) loaded + 兼容 → 通过；(2) loaded + 不兼容 → gate 拦；(3) idle → gate 拦。

## 7. 设计决策日志

- **2026-04-26** 拆 verified vs experimental，理由：所有 anthropic-thirdparty 被一刀切橙色 warning，主流 Code Plan provider 视觉看像 error。verified 用 info 蓝 + "Claude Code 兼容"，experimental 仍橙 + "Claude Code 实验"
- **2026-04-26** 删 `getModelCompat` codepilot_only 的 claude alias lift。理由：与 provider-layer "不进入 Claude Code 流程" 语义打架，且 group-layer 已 drop 整组，alias 留着是死代码 + 可能误导
- **2026-04-26** `claude_code_ready` 双向兼容（既 `claude_code_compatible` 又 `codepilot_runtime_compatible`）。理由：`@ai-sdk/anthropic` 能直调 Anthropic / Bedrock / Vertex，native runtime 用户配 Anthropic 不该看到 0 模型
- **2026-04-26** API 空集合 server-side drop（不返回 `models: []`）。理由：hook 兜底逻辑会把空 group fallback 到 `DEFAULT_MODEL_OPTIONS`，相当于偷渡 sonnet/opus/haiku 进 picker
- **2026-04-26** Hook 加 `fetchState`、`AbortController`、`requestedProviderId vs preferredProviderId` 拆分，全部因 Codex review 指出竞态 / 语义错位
- **2026-04-26** `chat-runtime.ts` 必须 import barrel（`./runtime`）。理由：runtime/index.ts 的 `registerRuntime` 副作用是注册唯一入口，跳过 → empty registry → 500
- **2026-07-22—23** 子 Agent 首版保持 same-runtime，但用户复测纠正了“same-runtime = same-provider”的错误假设。CodePilot Native、Claude managed subprocess、Codex CodePilot-Provider proxy child 都必须使用 Runtime-compatible exact Provider+Model route；合法集合与 picker 未置灰状态同源。AgentDefinition full model string 与 Codex 原生 spawn 都不能承担 CodePilot 跨 Provider 路由，因为它们不能可靠切换父 endpoint/provider config。Codex Account 只展示原生 collab，不冒充跨 CodePilot Provider 成功。
- **2026-07-23** 用户真实 smoke 发现 SDK `success` envelope 可携带 `is_error=true` 的 403，且父 Agent 把 one-shot subprocess 当作待命/续跑 worker，造成 3 个逻辑 Agent 产生 6 次调用。终态收口到结构化 SDK 字段；managed tool 加 one-shot 与 capability 声明，unsupported 能力 fail closed。
- **2026-07-23** Codex 真实会话 `1d154cca69c53c23091b43d8f55100a6` 暴露两层错误：proxy 内已执行的 `codepilot_spawn_subagent` 被再次回传给 app-server，得到 `unsupported call`；dynamic MCP bridge 又只允许 Memory namespace。修复后所有 bridge-executed tool 都在 Codex-bound stream 中抑制，所有 namespaced MCP 调用都交回 Codex MCP manager；Codex child 不再要求 `required_capabilities` 或维护第二套工具 allowlist，只禁止递归 spawn。
- **2026-07-24** 会话 `3f0085c5fc664deca85005d70b1abfca` 证明 one-shot prompt 指导不能完成结果 handoff：DeepSeek tool input 在 Qwen 输出前已冻结，串行执行后仍只能自行重搜。三 Runtime 现统一使用 workflow/task/dependency durable compiler；Adapter 不再各自解释“等待上游”的自然语言。
