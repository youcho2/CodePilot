# Phase 8 — Codex MCP / Memory 注入

> 创建时间：2026-05-21
> 最后更新：2026-05-27
> 状态：🚧 Phase 7 已收口，Phase 0 核心问题**已 live 验证通过**（真实 Codex `0.133.0` app-server，隔离 CODEX_HOME）：per-thread `config.mcp_servers` 注入可行、工具可调用、错误/elicitation/broken-server 均可见。唯一 auth-gated = 模型自主调用（需登录）。可进入 Phase 1。
> 上游：Phase 5 Codex Runtime / Phase 5e Runtime Harness Architecture / Phase 7 Icon System
> POC 记录：[docs/research/codex-mcp-injection-poc/](../../research/codex-mcp-injection-poc/)

## 用户目标

用户希望 CodePilot 成为本地 Agent 框架与自定义 Harness 的集中地：切到 Codex Runtime 后，不能只保留 Codex 自己的能力，也应该尽可能让 CodePilot Memory MCP、用户 MCP、工作区规则等可感知、可调用。朋友的同类实践表明 Codex 可以注入 MCP，因此本计划专门验证并补上 CodePilot 当前缺失的 Codex MCP 注入链路。

用户可见结果：

- 在 Codex Runtime 下，CodePilot Memory MCP 不再只是 Settings 里的“可感知不可执行”，而是在已验证路径下成为真正可调用工具。
- Codex Account 与 CodePilot provider proxy 两条路径分别给出明确能力状态：能注入就显示可调用，不能注入就说明具体原因和替代 Runtime。
- MCP 启动失败、OAuth / elicitation、权限请求不再静默卡住；用户能在 Settings 或聊天工具结果里看到可理解的状态。

## 为什么排在 Phase 7 后

当前主线是 Phase 7 图标体系与视觉锚点。Codex MCP 注入涉及 Runtime config、MCP bridge、权限 / elicitation、Settings capability matrix、真实凭据 smoke，风险面大于图标表意校准。为了避免两条大线互相污染，本计划只先登记事实、边界与执行顺序，等 Phase 7 UI 优化收口后再开工。

## 已确认事实

### Codex 侧支持 MCP 注入

不是“Codex 不允许注入上下文”。本地 vendored Codex schema 与文档显示 app-server / SDK 都支持 config override 与 MCP server：

- `资料/codex/codex-rs/app-server-protocol/schema/typescript/v2/ThreadStartParams.ts`：`thread/start` 支持 `config?: { [key: string]: JsonValue }`。
- `资料/codex/codex-rs/app-server-protocol/schema/typescript/v2/ThreadResumeParams.ts`：`thread/resume` 也支持 config override。
- `资料/codex/codex-rs/app-server/README.md`：列出 `mcpServerStatus/list`、`mcpServer/tool/call`、`mcpServer/resource/read`、`mcpServer/oauth/login`、`mcpServer/elicitation/request`。
- `资料/codex/codex-rs/config/src/mcp_types.rs`：定义 `mcp_servers` config，支持 stdio 与 streamable HTTP 类 transport。
- `资料/codex/sdk/typescript/README.md` 与 `src/exec.ts`：SDK 也能把 config override 下发给 Codex CLI。

结论：我们应该优先补 app-server `config.mcp_servers` 注入，而不是把 Runtime 主控面迁到 `@openai/codex-sdk`。

### CodePilot 当前缺的是注入链路

当前实现只给 Codex 注入 provider proxy：

- `src/lib/codex/provider-proxy.ts` 只构造 `config.model_providers.codepilot_proxy`。
- `src/lib/codex/runtime.ts` 的 `thread/start` / `thread/resume` 都复用该 Thread params，因此也只带 model provider config。
- `codex_account` 分支不注入 provider proxy，也没有注入 `mcp_servers`。
- `src/__tests__/unit/codex-user-mcp-wiring.test.ts` 目前明确 pin 住“Codex Runtime 不挂 CodePilot user MCP servers”。
- `src/lib/harness/user-codepilot-extensions.ts` 当前把 `mcp_server` 在 `codex_runtime` 下标成 `perception_only`，这是对现状的诚实描述，不是最终目标。

### 现有 Memory MCP 不能直接塞给 Codex

`src/lib/memory-search-mcp.ts` 当前用 Claude Agent SDK 的 `createSdkMcpServer()` 创建 in-process MCP server。它适合 ClaudeCode SDK 路径，但不是一个 Codex config 能直接启动的 stdio / HTTP server。

Phase 8 需要先做 wrapper / shim：

- stdio shim：启动一个 Node entry，内部挂 CodePilot Memory MCP。
- 或 streamable HTTP endpoint：由 CodePilot dev server / Electron server 暴露给 Codex。

选型必须由 POC 决定，不能在产品代码里猜。

### provider proxy bridge 与 Codex MCP 注入不是一回事

目前 Codex + CodePilot provider proxy 下已有 `codepilot_memory_*` AI SDK bridge tool。这条路径解决的是 `/api/codex/proxy/v1/responses` 中的 CodePilot built-in tools。

本计划解决的是另一层：通过 Codex 原生 `mcp_servers` config，让 Codex 自己感知并调用 MCP 工具，然后把 `mcpToolCall` / startup status / elicitation 映射回 CodePilot UI。

两条路最终可以并存，但 Settings 和测试必须区分来源，不能把 provider proxy bridge 的成功当作 Codex MCP 注入已完成。

## 非目标

- 不读取 `~/.codex/auth.json`、token、credentials、key、pem 等敏感文件。
- 不把 `@openai/codex-sdk` 作为 Runtime 主控面的替代方案；SDK 只作为 schema / POC / fixture 参考。
- 不在 POC 通过前把 `codex_runtime + mcp_server` 从 `perception_only` 翻成 executable。
- 不放宽 provider proxy parser 来“猜” namespace / MCP 工具格式。
- 不绕过权限、OAuth 或 elicitation；无法接 UI 时必须安全拒绝并可见说明。
- 不把 Codex 原生 plugins / skills 与 CodePilot MCP 混成一个概念。前者是 Codex Framework Harness，后者是 CodePilot Harness。

## 状态

| Phase | 内容 | 状态 | 用户可见结果 |
|-------|------|------|-------------|
| Phase 0 | MCP 注入 POC + schema fixture | ✅ 基本完成 | 无 UI 变化；live 验证：Codex `0.133.0` 接受 per-thread `config.mcp_servers` 注入、`mcpServer/tool/call` 命中 fixture、错误/elicitation/broken-server 均可见；仅模型自主调用 auth-gated（见 POC 记录） |
| Phase 1 | Codex MCP config builder + Memory MCP wrapper | 📋 待开始 | 无 UI 变化；产品代码有可测试的 `config.mcp_servers` 构造 |
| Phase 2 | Runtime start/resume 注入 | 📋 待开始 | Codex Account / proxy 路径可带 MCP config 启动与续聊 |
| Phase 3 | 事件、状态、elicitation / OAuth 桥接 | 📋 待开始 | MCP 启动状态、工具调用、权限请求不再静默 |
| Phase 4 | Settings capability matrix 翻转 | 📋 待开始 | Codex 下 Memory MCP 从“感知不可执行”变为已验证路径下“可调用” |
| Phase 5 | 真实 smoke + 归档 | 📋 待开始 | Smoke Ledger 有 Codex Account / proxy 两轮对话与 Memory MCP 调用证据 |

## Phase 0 — POC 与事实夹具

目标：先证明“Codex app-server + `config.mcp_servers` + CodePilot fixture MCP”能跑，而不是在主链路里盲写。

> ✅ **已 live 验证（2026-05-27）**，结论与事件样本见 [docs/research/codex-mcp-injection-poc/](../../research/codex-mcp-injection-poc/)。
> **关键修正（推翻下方旧假设）**：per-thread 注入的 server **不进** `mcpServerStatus/list`（实测对注入 server 返回 `data:[]`）；server 的 starting/ready/failed 状态走 `mcpServer/startupStatus/updated` **通知流**。凡涉及“查 list 断言”的任务以通知流为准（Phase 3 状态桥接同理）。模型**自主**调用为 auth-gated（需登录），其余项均已通过。

任务：

- 用临时 `CODEX_HOME` 与独立 test workspace 启动 Codex app-server，避免污染用户真实配置。
- 准备最小 MCP fixture server，优先 stdio；如果 stdio 失败，再评估 streamable HTTP。
- 发 `thread/start`，传入：
  - `config.mcp_servers.codepilot_memory_fixture`
  - `cwd`
  - `model`
- 监听 `mcpServer/startupStatus/updated` 通知，断言注入的 fixture server 报 `starting → ready`，并经 `mcpServer/tool/call` 调用其 tool 成功。（实测：per-thread 注入 server **不进** `mcpServerStatus/list`，不能用 list 断言。）
- 经 `mcpServer/tool/call` 直调 fixture memory tool（无需模型，已验证命中）；模型**自主**调用走 `turn/start`，为 auth-gated，待登录后补。
- 覆盖 broken optional / required MCP startup status，确认错误能被 app-server 暴露。
- 探测 `mcpServer/elicitation/request` 行为：如果 fixture 工具发 elicitation，当前 CodePilot 应安全拒绝并可见记录，而不是卡住。

验收：

- POC 产物放 `docs/research/` 或 unit fixture，不直接进产品路径。
- Smoke Ledger 记录 Codex CLI version、transport、thread id、`mcpServer/startupStatus/updated` 状态（starting/ready/failed）、事件样本。
- 如果 Codex 版本或 app-server schema 与 vendored source 不一致，先记录版本门槛，不继续产品化。

## Phase 1 — Codex MCP Config Builder

目标：把 CodePilot MCP 配置转成 Codex 能理解的 config，且来源可测试。

任务：

- 新建 `src/lib/codex/mcp-config.ts`：
  - `buildCodexMcpServersConfig(input)`
  - `buildCodexMemoryMcpConfig(input)`
  - `fingerprintCodexMcpConfig(config)`
- 支持 CodePilot `MCPServerConfig` 到 Codex `mcp_servers` 的安全映射：
  - `stdio`: `{ command, args, env }`
  - `http` / `sse`: 只在 POC 验证后支持；未验证 transport 显式 unsupported
- 为 CodePilot Memory MCP 提供 stdio 或 HTTP wrapper。不能直接把 `createSdkMcpServer()` 当成 Codex 可执行 server。
- 所有 env 注入必须脱敏；禁止把 auth/token 文件路径或内容塞进 config。
- 产出 `mcpConfigFingerprint`，供 start/resume 判断是否需要新 thread。

验收：

- 单测覆盖 stdio / http / unsupported / env redaction / fingerprint stable。
- Codex Memory MCP wrapper 有独立 fixture 测试。
- 旧的 `codex-user-mcp-wiring.test.ts` 不能直接删除，必须改成“有 MCP injection builder 时 scanner flip 与 runtime injection 成对发生”的 guardrail。

## Phase 2 — Runtime Start / Resume 注入

目标：让 Codex Runtime 真正在启动与续聊时携带 `config.mcp_servers`。

任务：

- 扩展 `buildCodexThreadParams()`：合并 `model_providers` 与 `mcp_servers`，两者互不覆盖。
- `thread/start` 与 `thread/resume` 都必须带相同 MCP config override；避免第一轮能用、第二轮丢 config。
- `codex_account` 分支也要注入 `mcp_servers`，但不注入 `model_providers.codepilot_proxy`。
- `codepilot_proxy` 分支同时带 provider proxy config 与 MCP config。
- Session ref metadata 存 `mcpConfigFingerprint`；workspace / MCP config 变化时清旧 thread 并 start fresh。

验收：

- Source / behavior tests pin：resume 不能只有 `{ threadId }`，必须带 MCP config。
- codex_account + proxy 两个分支分别有测试。
- 不改 `~/.codex/config.toml`；所有注入都是 per-thread config override。

## Phase 3 — Event / Permission / Elicitation Bridge

目标：MCP 可调用之后，状态和交互也必须可见，不允许静默失败。

任务：

- `mcpServer/startupStatus/updated` 不再纯 `return null`；至少映射到 status / unknown_item / Settings diagnostic。
- `mcpServer/oauth/login` 只给显式链接，不自动 `window.open`。
- `mcpServer/elicitation/request` 接入现有 permission / prompt flow，或安全 decline + 明确工具结果。
- `mcpToolCall` 输出里的 server / tool / arguments / error 要进入 canonical `tool_started` / `tool_completed`。
- 失败状态进入聊天可见错误或 Runtime capability diagnostic，不能只留 console。

验收：

- Fixture 覆盖 startup success / startup failure / tool success / tool error / elicitation safe decline。
- UI smoke 至少验证一条失败路径可见。

## Phase 4 — Harness Capability Matrix 翻转

目标：只有真实注入成功的能力，才在 Settings 与模型提示里显示 executable。

任务：

- 更新 `src/lib/harness/user-codepilot-extensions.ts`：
  - `mcp_server + codex_runtime` 从 `perception_only` 翻成 executable 只限已验证 transport / scope。
  - 未验证 transport 保持 perception_only，说明“Codex MCP 注入暂不支持此 transport”。
- 更新 capability matrix：
  - Codex Account + Memory MCP：如果 Phase 2/3 通过，显示可调用。
  - Codex + provider proxy + Memory MCP：区分 CodePilot built-in bridge 与 Codex MCP 注入两种来源。
- Settings 能力清单文案使用用户语言，不暴露 `mcp_server` / `codex_runtime` 等内部变量名。

验收：

- Settings UI 显示：
  - 可调用：Memory / User MCP（限定已验证路径）
  - 不可调用：具体原因 + 替代 Runtime
- matrix tests 与 scanner tests 同步，禁止“UI 显示可调用但 Runtime 没注入”。

## Phase 5 — Smoke Ledger 与归档

真实验证必须写入本文件，不只留在聊天里。

| Date | Runtime | Provider | Model | MCP transport | 场景 | Result | Evidence |
|------|---------|----------|-------|---------------|------|--------|----------|
| _待跑_ | codex_runtime | codex_account | Codex Account model | stdio fixture | Memory MCP recent/search 一轮调用 | 📋 | thread id / `mcpServer/startupStatus/updated` 通知 / DB usage / screenshot |
| _待跑_ | codex_runtime | codex_account | Codex Account model | stdio fixture | 同一 session 第二轮续聊仍可调用 MCP | 📋 | same thread/provider binding + resume payload evidence |
| _待跑_ | codex_runtime | CodePilot proxy | OpenRouter / GLM / Kimi 任一 | stdio fixture | Memory MCP 调用 + provider proxy 回复 | 📋 | proxy request id + mcp tool call event |
| _待跑_ | codex_runtime | codex_account | Codex Account model | broken optional server | Settings / chat 显示启动失败但不阻塞主回复 | 📋 | status event + screenshot |
| _待跑_ | codex_runtime | codex_account | Codex Account model | elicitation fixture | elicitation 被安全处理，不挂死 | 📋 | permission / decline event |

完成准则：

- 所有 smoke 行有真实证据。
- `codex-user-mcp-wiring.test.ts` 不再 pin “没有 MCP loader”，而是 pin “scanner executable 状态与 runtime injection 同源”。
- `docs/research/codex-sdk-app-server-coverage.md` 更新结论：SDK 仍非主控面，但 app-server MCP injection 已验证 / 或明确不可行。
- 本计划从 `active/` 移至 `completed/`，`docs/exec-plans/README.md` 与 `refactor-closeout.md` 同步。

## 风险与防线

- **MCP server 生命周期**：Codex 负责启动外部 MCP server，CodePilot 也有自己的 MCP connection manager。两个生命周期不能互相抢同一进程。
- **权限语义**：MCP tool 可能触发本地副作用，必须走 mutationLevel / permission policy；不可因为是 Codex 调用就默认 allow。
- **resume config 漂移**：MCP config 变化必须重开 thread，否则续聊可能绑定旧工具集。
- **Codex Account 差异**：Codex Account 不经过 provider proxy，但仍走 app-server；如果 MCP 注入在 Account 下失败，要记录真实原因，不用 provider proxy 成功覆盖。
- **Context accounting**：Memory MCP 被调用后，context breakdown 不应伪造 memory 注入；只有真实注入 / tool invocation 的 tokens 才显示。
- **UI 承诺**：Settings 一旦显示“可调用”，必须有 start/resume 注入 + smoke 证据支撑。

## 决策日志

- 2026-05-21：用户要求在 Phase 7 UI/icon 优化后补 Codex Runtime 的 MCP / Memory 注入问题。结论：Codex app-server 支持 `config.mcp_servers`，当前 CodePilot 缺的是注入链路与 Memory MCP wrapper；先登记 Phase 8，等 Phase 7 完成后按 POC → 产品化 → Settings 翻转推进。
- 2026-05-27：Phase 7 收口，进入 Phase 0。Codex review + 文档复核：
  - **文档事实核对全部属实**（vendored ThreadStart/Resume Params 的 `config` override、app-server README 的 5 个 MCP 方法、`mcp_types.rs` 的 stdio + streamable_http、产品侧只注 `model_providers`、Memory MCP 是 in-process `createSdkMcpServer`）。
  - **待 fold-in 的修订（复核发现，尚未改各 Phase 正文）**：
    1. guardrail 失真——`codex-user-mcp-wiring.test.ts` Test 1 锁的是 4 个 Claude SDK loader 符号，**抓不到** Codex 原生 `config.mcp_servers` 注入路径；Phase 1/5 改写 guardrail 时新断言必须挂在 thread params 出现 `mcp_servers` / `buildCodexMcpServersConfig` 上。
    2. Phase 1「sse」措辞——Codex 原生只有 `Stdio` + `StreamableHttp`，无独立 sse；应写「CodePilot http/sse → Codex streamable_http；Codex 无原生 sse」。
    3. Phase 1 新测试避让已有 `unit/mcp-config.test.ts`，建议命名 `codex-mcp-config.test.ts`。
    4. 风险表补：Codex 自己 spawn `config.mcp_servers` 的 stdio 进程，生命周期归 Codex，与 CodePilot connection manager 可能重复启动同一 Memory MCP；stdio wrapper 不可依赖被 spawn 时的 cwd/PATH。
  - **Phase 0 已 live 验证通过**：用户提供现有 codex 二进制（`/Applications/Codex.app/Contents/Resources/codex`，`0.133.0-alpha.1`），在隔离 `CODEX_HOME` 下跑通（产物 `docs/research/codex-mcp-injection-poc/`）：
    - `generate-ts` 核对：live `0.133.0` 的 `ThreadStartParams` 与 vendored 逐字一致，thread/MCP 关键方法都在；漂移项（`mcpServer/reload`→`config/mcpServer/reload`、`turn/start` 跑提示、新增 `getAuthStatus`）已记录。
    - `thread/start` 接受 `config.mcp_servers` 注入 → 注入 server **即时启动**（`mcpServer/startupStatus/updated` starting→ready）→ `mcpServer/tool/call` 命中 fixture（memory_search→mem-1、fail_always→isError、ask_user→elicitation 往返安全 decline）。
    - broken server 启动失败被通知暴露（`status:failed` + 详细 error），且不阻塞 thread。
  - **Phase 0 暴露的两处文档纠正**（已写进 POC 记录，待 fold-in 到 Phase 0/3 正文）：
    5. per-thread 注入 server **不进** `mcpServerStatus/list`（该 RPC 实测对注入 server 返回 `data:[]`）；状态/失败走 `mcpServer/startupStatus/updated` **通知流**。Phase 0 断言方式 & Phase 3 状态桥接要按通知改，不能轮询 list。
    6. 「工具可调用」（`mcpServer/tool/call`，无需 auth）≠「模型自主调用」（`turn/start` 走模型，需 OpenAI 登录）。后者实测 `401 Unauthorized`，仍待登录后验证；按边界**未读 `~/.codex/auth.json`**，仅用 `getAuthStatus` 记录未登录。
  - 全程守边界：未改产品 start/resume、未翻 Settings capability、未动 guardrail 测试、未污染真实 `~/.codex`（隔离 `CODEX_HOME`，驱动脚本带拒绝闸）。
  - **下一步**：(a) `thread/resume` 续聊带同份 MCP config 的验证；(b) 若用户授权在临时 CODEX_HOME `codex login`，补「模型自主调 memory_search」一行 smoke；(c) 进入 Phase 1（`buildCodexMcpServersConfig` + Memory MCP wrapper），按修订 1（guardrail 挂在新注入路径）做。
