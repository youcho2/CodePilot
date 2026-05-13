# Phase 5 — Codex Runtime 接入

> 创建时间：2026-05-12
> 最后更新：2026-05-13
> 状态：📋 计划已写入，待审批 / 待开工
> 协作边界：Codex 负责计划制定、方案审查和 Review；ClaudeCode 负责执行代码改动、测试和提交整理。除非用户明确重新授权，Codex 只改 `docs/` 下的计划 / 交接 / review 文档。
> 上下文同步：本计划不是只给 ClaudeCode 的任务列表。执行前必须读完“讨论脉络”与“Runtime Contract Hardening”，理解为什么 Codex 不能降级成 `Codex Account only`，也不能用三套 runtime 私有语义直接污染 UI。

## 讨论脉络

这段是给 ClaudeCode 的上下文，不是实现 checklist。

1. 起点：用户希望 Phase 5 变成 Codex Runtime 接入，而不是原先排在 Phase 5 的上下文可视化。
2. 初版判断：Codex 先作为 `Codex Account` 模型入口会更小，provider proxy 可后移。ClaudeCode 也指出 provider proxy 是独立大工程，担心用户价值不够清晰、三 Runtime invariant 复杂度过高。
3. 用户修正：这个收窄不符合产品定位。Codex 有自己的 Agent 能力和插件 / 工具生态，应该像 ClaudeCode 一样成为同等级 Runtime，而不是轻量模型入口。
4. 当前决定：Phase 5 仍然是完整 Codex Runtime。可以按里程碑执行，但完成口径必须包括 Codex app-server、Codex Account 模型、Codex 原生工具 / 命令 / 插件式 item / 文件改动 / 权限事件，以及 CodePilot provider proxy MVP。
5. 风险判断：ClaudeCode 对复杂度的担心成立。现在已有 ClaudeCode + CodePilot Runtime 两套 permission / model / session / tab metadata invariant；直接加 Codex 会制造 P0 风险。
6. 因此增加前置：Phase 0.5 Runtime Contract Hardening。它不是可选清理，而是接 Codex 前的工程安全带。先收口 session / permission / model / event / preview metadata 契约，再接 Codex app-server。
7. 审查重点：实现报告不能只说“加了 Codex Runtime”。必须说明三 Runtime invariant 如何被统一、哪些 UI 组件没有吃 Codex 私有字段、未知 Codex item 如何 fallback、provider proxy 覆盖与 unsupported reason 如何呈现。

## 一句话目标

把 Codex 像当前 Claude Code 一样接入为 CodePilot 的一个同等级 Runtime 框架：用户登录 Codex 后，CodePilot 能读取 Codex 账号可用模型；用户可以在 Runtime Selector 里选择 Codex Runtime；Codex 原生的执行能力、工具 / 插件事件、权限语义和 thread/session 生命周期都要进入 CodePilot 的现有 UI；同时通过 CodePilot provider proxy，让 Codex Runtime 也能使用 CodePilot 现有服务商 / CodePlan 模型。

这不是“Codex 输出格式适配”，也不是“上下文可视化”。上下文可视化顺延到后续 Phase；本阶段只做 Runtime 接入。

## 用户价值

ClaudeCode 和 Codex 不是互相替代的两个按钮，而是两种不同 Agent runtime：

- **复用 Codex 账号与模型**：已登录 Codex 的用户不需要在 CodePilot 里重新配置同一套 Codex 模型。
- **获得 Codex 原生能力**：Codex 的 app-server 暴露 thread / turn / item / command / file-change / token usage / account / model 等结构化能力，能比文本 CLI 更完整地映射进 CodePilot。
- **保留 CodePilot 工作区体验**：用户仍在 CodePilot 的 chat、文件树、Markdown / Artifact 预览、任务和通知里工作，而不是在 Codex 与 CodePilot 之间切换上下文。
- **为多 Runtime 打基础**：ClaudeCode、CodePilot Runtime、Codex Runtime 并列后，后续 Gemini / OpenClaw / Hermes 类 runtime 才有统一入口和验收标准。
- **最终复用现有 provider**：Codex Runtime 不能只停留在 Codex Account；本阶段完成口径包含 CodePilot provider proxy 的 MVP，让 Codex Runtime 至少能跑通一类 CodePilot 已配置模型，并对暂不支持的 provider 给出明确原因。

## 调研结论

| 结论 | 依据 | 影响 |
|---|---|---|
| 主协议应使用 `codex app-server` JSON-RPC，而不是 `codex exec` 文本输出 | `资料/codex/codex-rs/app-server/README.md`、`资料/codex/sdk/python/README.md`、`资料/codex/sdk/python/docs/api-reference.md` | 能稳定拿到 thread / turn / item / token usage / account / model 事件，不需要解析终端文本。 |
| Codex 原生模型从 `model/list` 读取 | `资料/codex/codex-rs/app-server-protocol/schema/typescript/v2/Model.ts`、`资料/codex/codex-rs/app-server/src/models.rs` | 登录 Codex 后先把 Codex account 的模型作为 `Codex Account` provider group 暴露到 CodePilot 模型选择器。 |
| Codex 登录状态通过 `account/read` 和 login flow 获取，不读本地 token 文件 | `资料/codex/codex-rs/app-server/README.md`、Python SDK account API | 避免直接读取 `~/.codex` 敏感文件；Settings 只显示 app-server 返回的账号状态。 |
| Codex provider 配置当前以 Responses wire API 为中心 | `资料/codex/codex-rs/model-provider-info/src/lib.rs` | CodePilot 现有 Anthropic / ClaudeCode-compatible / CodePlan provider 不能直接全量塞给 Codex；需要本地 Responses-compatible proxy/adapter。 |
| `model/list` 模型结构不直接暴露 context window | `Model.ts` 里只有 displayName / modalities / reasoning / service tiers 等；context 可从 token usage event 的 `modelContextWindow` 补充 | 第一版模型卡不承诺容量；运行后用 token usage 事件回填上下文容量。 |
| Codex 的工具 / 插件能力必须走结构化事件，不做文本模拟 | app-server notification 有 thread / turn / item 事件；Codex SDK 负责实际工具 / 命令 / 文件事件生命周期 | CodePilot 需要接收并渲染 Codex 原生 item，而不是把 Codex 降级成普通 text completion。 |

## 用户会看到什么变化

1. Settings → Runtime 出现 `Codex Runtime` 状态卡：能看到 Codex CLI / app-server 是否可用、当前是否登录、登录方式入口、版本信息和最近错误。
2. Settings → Models / Chat 模型选择器出现 `Codex Account` 模型组：用户登录 Codex 后，能看到 Codex 内置模型（含 displayName、reasoning effort、service tier 等可见能力）。
3. Chat composer 的 Runtime Selector 增加 `Codex Runtime`：选择后，新消息通过 Codex app-server thread/turn 执行。
4. Codex Runtime 的输出进入现有聊天 UI：assistant delta、工具 / 命令事件、插件事件、文件改动、token usage、错误状态都映射到 CodePilot 现有事件面。
5. Codex Runtime 运行目录、权限策略、会话绑定与 CodePilot 当前会话一致：不会默认跑到主目录，不会绕开 Worktree 隔离。
6. Codex Runtime 不止能跑 Codex Account 模型；通过本阶段的 provider proxy MVP，至少能跑通一类 CodePilot 已配置 provider。暂不支持的 provider 必须显示原因，不能假装可用。

## 状态

| Phase | 内容 | 状态 | 备注 |
|---|---|---|---|
| 0 | POC 与契约确认 | 📋 待开始 | 验证本机 `codex app-server`、`account/read`、`model/list`、`thread/start`、`turn/start` 最小闭环。 |
| 0.5 | Runtime Contract Hardening | 📋 待开始 | 三 Runtime 前置安全带：session / permission / model / event / preview metadata 统一契约。 |
| 1 | Codex app-server 管理层 | 📋 待开始 | 进程发现 / 启停 / JSON-RPC client / 健康检查 / Settings 状态卡。 |
| 2 | 账号与模型同步 | 📋 待开始 | `account/read` + login flow + `model/list` → CodePilot ProviderModelGroup。 |
| 3 | Codex Runtime Adapter | 📋 待开始 | Runtime registry 接入；thread / turn / event stream 映射到现有 SSE / DB。 |
| 4 | Codex 原生能力 / 插件事件接入 | 📋 待开始 | command / tool / file change / permission / plugin-like item 映射到 CodePilot UI。 |
| 5 | CodePilot provider proxy for Codex | 📋 待开始 | 本地 Responses-compatible proxy，让 Codex Runtime 可用 CodePilot 现有 provider；这是同级 Runtime 的完成条件之一。 |
| 6 | UI / Electron / 测试收口 | 📋 待开始 | Runtime Selector、模型选择、错误横幅、Electron smoke、文档归档。 |

## 详细设计

### Phase 0 — POC 与契约确认

目标是先证明协议和数据结构，不动主业务链路。

1. 在本 worktree 下做只读 POC 脚本或测试夹具，启动 / 连接 `codex app-server`。
2. 验证 `account/read`：
   - 未登录时能得到明确状态。
   - 已登录时能得到 account / auth 模式 / 是否需要 OpenAI auth。
   - 不读取 `~/.codex` token 文件。
3. 验证 `model/list`：
   - 记录 `id`、`displayName`、`supportedReasoningEfforts`、`defaultReasoningEffort`、`serviceTiers`、`inputModalities`、`isDefault`。
   - 明确 `modelContextWindow` 不在模型列表中，运行时从 token usage event 补。
4. 验证最小 thread：
   - `thread/start` 指定 `cwd`。
   - `turn/start` 发一条简单 prompt。
   - stream notifications 能拿到 assistant delta、turn completed、token usage。
5. 形成 guardrail：
   - 代码里不能把 `codex exec` 作为主 Runtime 协议。
   - 代码里不能直接读取 `~/.codex` token / auth 文件。

### Phase 0.5 — Runtime Contract Hardening

这是 Phase 5 的工程安全带。Codex 进来后会同时存在 ClaudeCode Runtime、CodePilot Runtime、Codex Runtime 三套执行语义；如果继续让 UI 和模型列表直接理解 runtime 私有字段，会把 permission / model / tab metadata / session resume invariant 放大成三倍。

前置审计范围：

| 区域 | 当前风险 | 需要收口的契约 |
|---|---|---|
| `src/lib/chat-runtime-shared.ts` | `ChatRuntime` 仍是 `claude_code | codepilot_runtime` 二值；client 入口散落 runtime 判断。 | 扩展到统一 runtime id，并提供只读 helpers；UI 只能用 helper，不写字符串分支。 |
| `src/lib/runtime/types.ts` | `RuntimeStreamOptions.runtimeOptions` 是松散袋子；runtime 私有 session id 容易外泄到 UI。 | 增加 `RuntimeSessionRef` / `RuntimeRunEvent` / `RuntimeCapabilities` 等窄契约；私有 metadata 只在 adapter-owned namespace 下。 |
| `src/types/index.ts` / `src/lib/runtime-compat.ts` | 兼容矩阵目前是 `claude_code_compatible` / `codepilot_runtime_compatible` 布尔叠加。 | 模型输出 `supportedRuntimes[]` + `unsupportedReasonByRuntime`；旧布尔只做迁移兼容，不再新增第三个散布尔。 |
| Permission UI / registry | ClaudeCode、Native、Codex 的 approval / sandbox 语义不同。 | Adapter 统一输出 `permission_request` / `permission_granted` / `permission_denied` / `permission_unavailable`，UI 不判断来源 runtime。 |
| Event stream | 当前 SSE 事件既承载 SDK 事件，也承载 Native 事件；Codex item 若直接塞 UI 会污染。 | Adapter 统一输出 `assistant_delta`、`tool_started`、`tool_completed`、`command_started`、`file_changed`、`usage_updated`、`run_completed`、`run_failed`。 |
| Preview / Tab metadata | Phase 4 的 PreviewSource / Tab trust tier 已经稳定，不能再挂 runtime 私货。 | Codex 文件 / Artifact / plugin item 必须翻译成通用 `file_changed` / `artifact_created` / `preview_source`，Panel state 不出现 Codex-specific 字段。 |

实施要求：

1. 先写 contract types / adapter boundary，再接 Codex。
2. Chat UI、RunCockpit、RunCheckpoint、ModelPicker、PermissionPrompt 不得新增 “if runtime is codex then ...” 的散落逻辑；必要分支集中在 runtime adapter / resolver / mapping 层。
3. Session metadata 统一：
   - CodePilot session 只知道 `runtimeId` 与通用 `runtimeSessionRef`。
   - Claude SDK session id、Native internal state、Codex thread id / turn id 均藏在 adapter-owned metadata 下。
   - Runtime 切换时不覆盖其他 runtime 的 metadata。
4. Permission 统一：
   - Codex approval / sandbox / command confirm 先映射到 CodePilot 内部 permission event。
   - 不确定语义时走 `permission_unavailable` 或 conservative prompt，不自动放行。
5. Model compatibility 统一：
   - `/api/providers/models?runtime=...` 基于 `supportedRuntimes` 和 per-runtime unsupported reason 过滤。
   - 旧 `claude_code_compatible` / `codepilot_runtime_compatible` 仅作 back-compat 输入，不再作为新 UI 的唯一输出。

Guardrail tests：

- `runtime-contract-shape.test.ts`：禁止新增第三个 `*_runtime_compatible` 布尔作为主契约；必须存在 `supportedRuntimes` / `unsupportedReasonByRuntime` 或等价结构。
- `runtime-ui-isolation.test.ts`：扫 ChatView / MessageInput / RunCockpit / RunCheckpoint / PreviewPanel，禁止直接分支 Codex-specific event / metadata；允许 RuntimeSelector 显示 label。
- `runtime-session-metadata.test.ts`：Codex thread id / Claude SDK session id / Native state 必须存放在 runtime-scoped metadata，不能平铺进 panel / preview tab state。
- `permission-event-contract.test.ts`：Codex / ClaudeCode / Native permission source 都映射到同一内部 permission event union。
- `runtime-event-contract.test.ts`：Codex item unknown type 必须落 fallback block，不得丢弃。

验收：

- 在不接 Codex 的情况下，ClaudeCode + CodePilot Runtime 现有消息发送、模型过滤、权限弹窗、Preview 自动刷新全部不回归。
- 加入 `codex_runtime` label 后，UI 不需要在多个组件里新增 codex 专用分支。
- 任何 Codex-specific 字段只出现在 `src/lib/codex/*` 或 runtime adapter 层；如果出现在 Chat / Preview 组件，需要 review finding 阻断。

### Phase 1 — Codex app-server 管理层

新增一个小而清晰的 Codex Runtime 基础设施层，不直接耦合 Chat UI。

候选模块：

| 模块 | 职责 |
|---|---|
| `src/lib/codex/app-server-client.ts` | JSON-RPC v2 client；方法封装：account、models、thread、turn、interrupt。 |
| `src/lib/codex/app-server-manager.ts` | 查找 `codex` binary；启动 / 复用 app-server；退出清理；错误分类。 |
| `src/lib/codex/types.ts` | CodePilot 内部 Codex event / model / account 类型，隔离上游 schema 漂移。 |
| `src/app/api/codex/status/route.ts` | Settings 状态查询；只暴露脱敏状态。 |
| `src/app/api/codex/login/*` | 触发 Codex login flow；只走 app-server account API。 |

关键规则：

- 不把 app-server 绑死到 dev server 生命周期；Electron 后续也要能复用。
- 不在 renderer 直接 spawn Codex；进程管理只在 server / Electron main 安全侧。
- 所有日志脱敏：不要打印 access token、refresh token、完整 auth headers。
- app-server 不可用时 UI 显示“未安装 / 不可用 / 版本过旧”，而不是让 Runtime 列表消失。

### Phase 2 — 账号与模型同步

先让用户看见“Codex 登录后 CodePilot 能读到 Codex 模型”。

1. Settings → Runtime / Providers 增加 Codex Account 状态：
   - 未安装 Codex：显示安装指引。
   - 未登录：显示登录按钮。
   - 已登录：显示账号摘要和模型同步状态。
2. 新增 Codex 模型同步路径：
   - `model/list(includeHidden=false)` → `ProviderModelGroup`。
   - Provider group 建议命名：`Codex Account`。
   - 模型 id 使用 app-server `Model.id` / `Model.model` 保持可追踪。
   - `displayName`、reasoning effort、modalities、service tiers 映射到 UI metadata。
3. Runtime compatibility：
   - 增加 `codex_runtime_compatible` 标记或等价能力字段。
   - Codex Account 模型默认只对 Codex Runtime 可见。
   - 不影响 `claude_code` / `codepilot_runtime` 的现有列表。
4. 缓存策略：
   - 短 TTL，手动刷新按钮。
   - account updated / logout 后清理缓存。

验收：

- 未登录时 `/api/providers/models?runtime=codex_runtime` 不返回假模型，只返回清楚的未登录状态或空组 + actionable issue。
- 登录后模型选择器能看到 Codex Account 的模型。
- 切回 Claude Code / CodePilot Runtime 时，不被 Codex-only 模型污染。

### Phase 3 — Codex Runtime Adapter

把 Codex 接入现有 Runtime registry，让它成为可选择的执行引擎。

候选改动点：

| 区域 | 预期改动 |
|---|---|
| Runtime types / registry | 新增 `codex_runtime` label、display name、capability。 |
| `streamClaude` / runtime selector | 分支到 Codex adapter，不再混在 ClaudeCode SDK 逻辑里。 |
| Session persistence | 保存 Codex thread id / turn id / sdk-like session id；支持 resume。 |
| Event mapper | app-server notification → CodePilot SSE / DB message / tool event。 |
| Permission mapping | Codex approval / sandbox events → CodePilot PermissionPrompt 或 waiting state。 |
| Token usage | `thread/tokenUsage/updated` → `TokenUsage`，捕获 `modelContextWindow`。 |

事件映射草案：

| Codex app-server event | CodePilot 行为 |
|---|---|
| `thread/started` | 写入 session runtime state / codex thread id。 |
| `turn/started` | 标记当前 run active。 |
| `item/agentMessage/delta` | assistant streaming delta。 |
| `item/started` / `item/completed` command/tool/file change | 映射到现有 tool / command / diff / file-changed UI。 |
| `thread/tokenUsage/updated` | 更新 token usage；如果有 context window，优先写入。 |
| `turn/completed` | finalize assistant message + run done。 |
| error / interruption | RunCheckpoint / banner / retry action。 |

会话规则：

- `cwd` 必须来自当前 CodePilot session working directory / `sdk_cwd`，不能默认主目录。
- Codex thread id 绑定 CodePilot chat session。
- 新会话首次 Codex message 走 `thread/start`；已有 Codex session 走 `thread/resume` + `turn/start`。
- Runtime 切换不应覆盖旧 runtime 的 session id；每个 runtime 独立保存自己的 thread metadata。

### Phase 4 — Codex 原生能力 / 插件事件接入

这一阶段回答“为什么 Codex 是同级 Runtime，而不是另一个文本模型入口”。

1. 工具 / 命令事件：
   - Codex app-server 的 item lifecycle 进入现有 tool / command UI。
   - shell / command 输出不混入 assistant 文本；保留结构化事件和状态。
   - 文件改动触发 `codepilot:file-changed`，复用 Phase 4 Markdown / Artifact 自动刷新。
2. 插件 / 扩展能力：
   - Codex 暴露的 plugin-like item 或外部能力事件必须被保留为结构化块。
   - CodePilot UI 不认识的 item 类型先显示可读 fallback，不直接丢弃。
   - 事件落库时保留 raw type / id / status，方便后续补 richer renderer。
3. 权限与 sandbox：
   - Codex approval / sandbox event 映射到 CodePilot 现有 PermissionPrompt 或明确 waiting state。
   - 不确定语义时采取保守策略：要求用户确认，不自动放行。
4. 线程与恢复：
   - Codex thread / turn 生命周期和 CodePilot session 绑定。
   - 中断 / resume / retry 不污染 ClaudeCode Runtime 的 session metadata。

验收：

- Codex Runtime 执行一个会列文件或读文件的任务，UI 中能看到结构化 command / tool 过程，而不是只看到最后文本。
- Codex 修改 Markdown 后，PreviewPanel 自动刷新。
- 未识别的 Codex item 不丢失，至少以 fallback block 可见。
- 需要审批的动作能到达 CodePilot permission UI 或明确 waiting state。

### Phase 5 — CodePilot provider proxy for Codex

这是“Codex Runtime 下也能使用我们现在已经可以用的这些模型”的关键，但不能在 Phase 2 就假装已经完成。

现实约束：

- Codex provider config 当前围绕 Responses wire API。
- CodePilot 现有 provider 包含 OpenAI-compatible、Anthropic-compatible、ClaudeCode-compatible、CodePlan 等多类。
- 因此直接把 CodePilot provider 写进 Codex config 不足以覆盖全部模型。

计划：

1. 新增本地 CodePilot Responses-compatible proxy：
   - Codex app-server 看到它像一个 Responses provider。
   - proxy 内部调用 CodePilot provider resolver / transport。
   - 第一批优先支持标准 messages / OpenAI-compatible providers。
2. 对 ClaudeCode-compatible / CodePlan provider：
   - 复用现有 `claude-code-compat` adapter 能力，或加 Responses → internal messages → provider transport 转换层。
   - 明确哪些 provider 首批可用，哪些需要后续补齐。
3. Codex provider config 注入策略：
   - 优先运行时 config override，不直接改用户 `~/.codex/config.toml`。
   - 如果 Codex app-server 不支持 runtime provider injection，再评估临时 shadow config，但必须避免污染用户全局 Codex 设置。
4. UI 表达：
   - `Codex Account` = Codex 原生模型。
   - `CodePilot via Codex` = 通过本地 proxy 暴露给 Codex Runtime 的 CodePilot 模型。
   - 模型不可用时显示原因：provider 不支持 Responses proxy / credentials missing / adapter missing。

验收：

- Codex Runtime 可以用 Codex 内置模型跑通一条 chat。
- Codex Runtime 可以至少用一个 CodePilot 已配置的 OpenAI-compatible provider 跑通一条 chat。
- ClaudeCode-compatible / CodePlan provider 如果未全部完成，UI 必须明确标注 unsupported reason，不能静默显示又运行失败。

### Phase 6 — UI / Electron / 测试收口

UI 和交互：

1. Runtime Selector 显示 `Codex Runtime`，并区分状态：
   - Ready
   - Codex not installed
   - Not logged in
   - App-server failed
   - Model unavailable
2. Model picker：
   - Codex Runtime 下默认展示 Codex Account 模型。
   - provider proxy 完成后展示 CodePilot via Codex 模型组。
3. RunCockpit / RunCheckpoint：
   - 显示 Codex Runtime 当前 thread / model / usage / permission 状态。
   - app-server 不可用时给出清晰修复入口。
4. Electron：
   - packaged app 能找到 bundled 或用户安装的 `codex`。
   - 关窗常驻不杀 app-server orphan。
   - 退出 CodePilot 时优雅停止 Codex app-server 子进程。

测试：

| 测试 | 覆盖 |
|---|---|
| `codex-app-server-client.test.ts` | JSON-RPC request / notification / error / timeout。 |
| `codex-model-mapping.test.ts` | Model schema → ProviderModelGroup。 |
| `codex-runtime-events.test.ts` | app-server events → CodePilot SSE / DB。 |
| `codex-auth-guard.test.ts` | 禁止直接读取 token 文件；只用 account API。 |
| `codex-provider-proxy.test.ts` | CodePilot provider → Responses proxy contract。 |
| Browser/CDP smoke | Settings status、模型列表、Runtime 切换、chat streaming。 |
| Electron smoke | packaged / electron dev 下 app-server 生命周期。 |

## 不做什么

- 不把 `codex exec` 文本输出解析作为主 Runtime 协议；最多作为诊断 fallback。
- 不直接读取、复制、修改用户 `~/.codex` token / auth 文件。
- 不把 Codex 降级为“只读 Codex Account 模型的 completion 入口”；同级 Runtime 必须接入 Codex 原生工具 / 命令 / 文件 / 权限事件。
- 不承诺所有 CodePilot provider 都能在第一版 provider proxy 下运行；但 Phase 5 完成口径必须至少有一个 CodePilot provider proxy MVP，并且对 unsupported provider 给出明确原因。
- 不替换 Claude Code Runtime / CodePilot Runtime 的默认路径；Codex 是新增 runtime。
- 不做 Codex cloud/web agent 产品化，只接本地 Codex CLI / app-server。
- 不做上下文可视化；它顺延到后续 Phase。
- 不做多 Agent 编排 / OpenClaw / Hermes 兼容；Codex Runtime 稳定后再单独立项。

## 验收路径

1. Settings → Runtime：未安装 Codex 时显示“Codex not found”与安装指引。
2. Settings → Runtime：已安装未登录时，点击登录，完成后 `account/read` 状态更新。
3. Settings → Models：登录后出现 `Codex Account` 模型组；模型名称和 reasoning effort 正确。
4. Chat 新会话：切到 `Codex Runtime` + Codex Account 模型，发送“说一句 hello”，能流式返回。
5. Chat 旧会话：Codex thread id 能 resume；第二条消息带上历史上下文。
6. 文件/命令/插件事件：让 Codex 读目录、运行一个安全命令或触发一个 Codex 原生 item，CodePilot 显示结构化过程块；未知 item 有 fallback，不被吞掉。
7. 文件改动：让 Codex 修改一个 workspace Markdown 文件，PreviewPanel 收到 `codepilot:file-changed` 并刷新。
8. 权限事件：触发需要审批的命令，CodePilot 显示 PermissionPrompt 或明确的 waiting state，不静默失败。
9. 切 Runtime：从 Codex Runtime 切回 CodePilot Runtime，不丢旧 Codex thread metadata；切回 Codex 后可继续。
10. Provider proxy：至少一个 CodePilot OpenAI-compatible provider 能在 Codex Runtime 下完成一条消息；ClaudeCode-compatible / CodePlan 未覆盖时 UI 显示 unsupported reason。
11. Electron：`npm run electron:dev` 下 Codex Runtime 可用；退出 CodePilot 后没有 orphan app-server。

## 风险与降级

| 风险 | 降级策略 |
|---|---|
| 用户未安装 Codex CLI | UI 显示安装指引；Codex Runtime 不出现在可选 ready runtime 里。 |
| 用户未登录 Codex | `model/list` 不伪造模型；显示登录入口。 |
| app-server schema 变动 | 内部 `src/lib/codex/types.ts` 做窄类型适配；contract tests pin 关键字段。 |
| provider proxy 不能覆盖 ClaudeCode-compatible 模型 | UI 标 unsupported reason；先支持 Codex Account + OpenAI-compatible。 |
| 权限 / sandbox 语义不完全一致 | Phase 3 先 conservative：不确定时要求用户审批，不自动放行。 |
| Electron packaged 找不到 `codex` binary | Settings 提供路径检测 / 手动配置；不阻塞其他 runtime。 |

## 决策日志

- 2026-05-12：Phase 5 改为 **Codex Runtime 接入**。上下文可视化顺延到后续 Phase；本阶段目标是让 Codex 像 Claude Code 一样成为可选 Runtime，并优先读取 Codex 登录账号自带模型。
- 2026-05-12：主协议选择 `codex app-server` JSON-RPC，而不是 `codex exec` 文本输出。原因：app-server 暴露 account / model / thread / turn / token usage 等结构化事件，能稳定映射进 CodePilot Runtime。
- 2026-05-12：Codex 内置模型先作为 `Codex Account` provider group 暴露；CodePilot 现有 provider 通过后续 Responses-compatible proxy 接给 Codex Runtime，避免在第一批过度承诺所有模型都可用。
- 2026-05-12：接受用户修正：Codex 不能降级成 `Codex Account only` 的轻入口。Phase 5 完成口径改为“与 ClaudeCode 同等级 Runtime”：必须覆盖 Codex 原生工具 / 命令 / 插件式 item / 文件改动 / 权限事件，并交付 CodePilot provider proxy MVP；里程碑可以分批实现，但不能把 proxy 和原生能力永久移出 Phase 5。
