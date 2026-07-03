# AI SDK 7 Phase 4 — 第一批可发布小能力清单

> 创建时间：2026-07-03（Phase 4，run issue #8）
> 关联执行计划：[AI SDK 7 Runtime 接入](../exec-plans/active/ai-sdk-7-runtime-loop-adoption.md) Phase 4
> 证据：`native-timeout-reasons.test.ts` / `permission-approval-token.test.ts` /
> `aisdk-trace-redaction.test.ts` / `mcp-sdk-adapter-poc.test.ts` +
> `_smoke-evidence/ai-sdk7-phase4-mcp-poc-smoke.json`

判定口径：**可发布 = 默认行为零变化 + targeted tests 全绿 + 不触碰
credential / 日志脱敏边界 / 权限默认值 / 用户可见文案承诺**。凡是需要产品
拍板才能"默认开"的部分，逐条列阻断与保守替代。

## ✅ 可发布（默认行为零变化）

### 1. approval HMAC 加固（②）— 可发布，且默认即生效

- **内容**：`/api/chat/permission` 现在强制校验无状态 HMAC approval token
  （`src/lib/permission-approval-token.ts`）：篡改/伪造 → 403、持久化
  `expires_at` 过期 → 410、重放 → 409（DB status 单次翻转锚定）。token 随
  `permission_request` SSE 下发、renderer 回传，四个签发点（agent-tools /
  claude-client / codex approval-bridge / codex mcp-elicitation）+ 两个回传点
  （chat page / stream-session-manager）全部接线。
- **为什么默认生效仍算零变化**：合法 UI 流程自动携带 token，用户无感知；
  改变的只是"猜到/枚举 id 就能批准"这一攻击面。服务端内部 resolver
  （Telegram/Discord broker、registry timeout/abort）不走 HTTP route，不受影响。
- **证据**：`permission-approval-token.test.ts` 12 测试逐攻击面断言；
  `toolloop-poc-parity.test.ts` permission 场景全绿（token 已进 parity 契约，
  哪条 loop 不发 token 会 fail）。
- **残余风险**：token 为 per-process secret，进程重启后旧 token 全部失效——
  与现状一致（重启本来就 abort 全部 pending 权限请求）。

### 2. Native timeout 原因码管道（①）— 管道可发布，默认预算全关

- **内容**：`src/lib/native-timeout.ts` 四类原因码
  connect / first-token / tool-execution / total-run，语义契约 + source
  breadcrumb 写在模块头；agent-loop 接线（combined abort signal +
  fullStream 观察点）；SSE error 事件携带
  `category: TIMEOUT_* + timeout:{reason,budgetMs,source}`；经 chat route
  现有 error fallback 落 `messages.content`（DB / SSE / UI 读同一份 JSON，
  无二次推导）；`error-classifier.ts` 新增四个分类。
- **默认**：所有预算 undefined = 完全不armed，行为与改动前逐字节一致
  （测试钉死）。启用途径：`AgentLoopOptions.timeouts` 或
  `CODEPILOT_NATIVE_TIMEOUTS` env JSON（开发/诊断用）。
- **关键实现事实（收尾轮发现并修复的 P1）**：ai@7 只把 abort signal *传给*
  工具的 `execute()`，仍会 await 其 promise——无视 signal 的挂死工具会让
  `fullStream` 永不结束，仅 abort 不能解锁消费循环（首版实现在 hung-tool
  测试上真实挂死）。修复：controller 增加 `guardStream`（预算触发时 race
  流读取；无预算时原样透传、零开销），预算定时器不再 `unref`（空闲事件循环
  中 unref 定时器永不触发，race 会悬死）。
- **关键实现事实（fix 轮修复的 P1，Codex review #8）**：首版在
  `onStepRequest()`（请求发出时）就 arm first-token 定时器，导致连接黑洞
  在只配 `firstTokenMs`（或 `firstTokenMs < connectMs`）时被误分类为
  `TIMEOUT_FIRST_TOKEN`——违反"first-token = provider 已响应但无输出"的
  语义契约。修复：first-token 定时器只由 `start-step` part（响应到达信号）
  arm，请求阶段绝不 arm；黑洞 + 只配 firstTokenMs → 不触发任何 timeout
  （该窗口归 connect 管），黑洞 + 双预算 → 只可能触发 connect。
- **证据**：`native-timeout-reasons.test.ts`——控制器逐信号单测 +
  guardStream 挂死流解锁/无预算透传两条 + 真实 runAgentLoop 端到端四类各一
  （scripted fetch，含 hung-tool）+ 落库读回断言 + 反例组（健康轮不误报、
  用户 abort 不误分类为 timeout、黑洞 + 只配 firstTokenMs 不触发、黑洞 +
  firstTokenMs < connectMs 端到端仍分类为 TIMEOUT_CONNECT、first-token
  计时起点在 start-step 而非请求时刻）。

### 3. 脱敏 AI SDK trace（③）— 能力可发布，默认关

- **内容**：`src/lib/aisdk-trace.ts`——ai@7 Telemetry integration 的
  fail-closed 结构化脱敏（安全元数据 allowlist，其余一律 sha256 digest；
  content 子树整体折叠；最终行再过 `sanitizeLogLine`）；agent-loop 仅在
  `CODEPILOT_AISDK_TRACE=1` 时挂载，默认不传 telemetry 选项。
- **证据**：`aisdk-trace-redaction.test.ts`——真实 ai@7 telemetry 事件样本
  内容抽查（种入 key/Bearer/prompt/tool 载荷的子串比对 + 4 条形态 grep）+
  正向断言 trace 仍有诊断价值（model id / tool name / 事件类型存活）+
  default-off 钉死。
- **刻意不做**：raw trace 开关（prompt 可见）——那是日志脱敏边界的人工决策。

## 🚧 POC 验证通过、但不随本批发布

### 4. @ai-sdk/mcp adapter（④）— POC 走通，不动生产 MCP 路径

- **走通证据**：read-only（fixture_read_note）+ write/approval
  （fixture_write_note deny/approve）经 `@ai-sdk/mcp createMCPClient` +
  **真实生产 `wrapWithPermissions`**（非复刻）跑通：unit（InMemoryTransport
  真实 JSON-RPC 会话）+ smoke（真实 stdio 子进程,
  `_smoke-evidence/ai-sdk7-phase4-mcp-poc-smoke.json` 3/3，deny 反例从服务进程
  外部验证写入未发生，approval token 交叉验证通过）。
- **零退化**：生产文件 `mcp-connection-manager.ts` / `mcp-tool-adapter.ts`
  零改动（diff 可证）；既有 MCP 测试全绿。`@ai-sdk/mcp@2.0.7` 仅
  devDependency，应用 bundle 不增长。
- **不发布原因（阻断）**：生产替换需要补 server 生命周期管理
  （sync/dispose/reconnect 对齐 mcp-connection-manager 语义）+ SSE/HTTP
  transport 与 OAuth 面验证——Phase 5 决策门内容。
- **保守替代**：维持现状双轨——生产走 @modelcontextprotocol/sdk，POC 留作
  迁移 harness（与 Phase 3 ToolLoopAgent partial adopt 同构）。

## ⛔ 阻断项与保守替代（逐条）

| # | 项 | 阻断原因 | 保守替代 |
|---|----|----------|----------|
| 1 | timeout 预算默认值（如 connect 30s / total-run 10min） | 默认开会中断此前"永远等待"的长跑轮，属用户可见行为变化 + 预算数值是产品取舍；tool-execution 预算与 5 分钟审批等待互相咬合（语义契约已注明） | 管道随本批发布、预算默认全关；数值提案（connect 60s / first-token 120s / tool-execution 0 / total-run 0）交 Codex/用户裁决后一行配置开启 |
| 2 | timeout 的用户可见文案（`describeNativeTimeout` 英文一行 + `TIMEOUT_*` 类别名） | 触及"用户可见文案"停止条件；现沿用 error-classifier 既有英文 userMessage 模式、未进 i18n | 文案仅在预算被显式开启后才可能出现（默认关=不可见）；i18n 化随默认值决策一并做 |
| 3 | trace raw 模式 / trace 落独立文件 | 触及日志脱敏边界（prompt 可见开关）与新日志面（rotation/清理策略） | 只发布脱敏 console trace；raw 模式挂 human gate |
| 4 | `@ai-sdk/mcp` 替换生产 MCP 路径 | 见上节阻断原因 | 双轨 + parity harness，Phase 5 决策门再评 |
| 5 | timeout 原因码进 Settings/UI 展示面（badge、诊断页） | 大 UI 改版禁区；且语义契约需先过「语义验收与反假数据」评审 | SSE/DB 里的结构化 JSON 已就位，UI 消费是纯增量 |

## 语义契约备忘（用户会怎么理解）

- `TIMEOUT_CONNECT`＝"provider 在 N ms 内没回 HTTP 响应头"（锚点：
  fullStream `start-step`，它只在 doStream resolve 后出现）。
- `TIMEOUT_FIRST_TOKEN`＝"回了头但 N ms 内没有任何模型输出 part"。计时
  起点是 `start-step`（响应到达），不是请求发出——所以它**永远不可能**在
  provider 还没响应时触发；连接黑洞只配 firstTokenMs 时不触发任何 timeout。
- `TIMEOUT_TOOL_EXECUTION`＝"单个工具从 tool-call 到 tool-result 超 N ms"，
  **含审批等待时间**（in-execute 阻塞审批的结构性事实，已写进契约）。
- `TIMEOUT_TOTAL_RUN`＝"整轮（全部 step+工具）超 N ms"。
- 全部原因码由触发的定时器直接赋值，**绝不从错误文本正则反推**。
