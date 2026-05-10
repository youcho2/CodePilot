# Refactor Closeout / 重构收口计划（总控板）

> 创建：2026-05-06 · 最后更新：2026-05-10（新增 Phase 3 Step 4 待审批方案：后台 Agent 任务与助理心跳闭环）
> 这是日常入口；查历史细节请去 `completed/refactor-phase-*.md`，不要在本文件里翻 1000 行决策日志。

## 当前状态

| 顺序 | 主线 | 用户视角结果 | 状态 | 历史归档 |
|------|------|--------------|------|----------|
| 0 | 计划收敛 | Active 计划只剩本计划 + issue-tracker | ✅ 已完成（2026-05-06） | [phase-1](../completed/refactor-phase-1-models-providers.md) |
| 1 | 模型同步与渠道扩展 | 添加服务商不再被无关模型污染；OpenRouter 走搜索；默认模型不乱跳 | ✅ 主路径完成（catalog 主动核准持续跟踪 tech-debt #16） | [phase-1](../completed/refactor-phase-1-models-providers.md) |
| 2 | Runtime 与会话执行 | 每个会话能解释 / 能切换"执行引擎"；旧会话不被全局漂移；下一条消息生效 | ✅ Step 1-4c 全部完成（2026-05-07） | [phase-2](../completed/refactor-phase-2-runtime-session.md) |
| 3 | 后台常驻、全局定时任务、助理心跳与通知 | 关窗常驻菜单栏；reminder 不依赖 AI；本机通知 / Bridge 解耦；全局任务页；后台 Agent 任务 + 后台心跳 | ✅ 全部完成（2026-05-10）：Step 1-3 + IA 收尾 + Step 4a（任务会话壳 + 文本生成 + 心跳后台化）+ Step 4b（headless streamClaude + waiting_for_permission 可达 + WaitingForPermissionPanel） | [phase-3](../completed/refactor-phase-3-background-tasks-notifications.md) |
| 4 | 多 Agent、Codex 适配、Markdown / Artifact | 显式调用其它 Agent；Markdown / Artifact 稳定 | 📋 待开始（详见下方） | — |
| 5 | 上下文可视化 | 输入框右下角是组成条而不是单一百分比 | 📋 待开始（详见下方） | — |
| 6 | 视觉锚点与图标体系 | 点阵风格视觉记忆点 + HugeIcons 统一 | 📋 待开始（详见下方） | — |

## 下一步

**Phase 3 整条主线已收口完毕**（Step 1-3 + IA 收尾 + Step 4a + Step 4b）。下一步是从 Phase 4 / 5 / 6 中挑一条启动——按用户感知与依赖关系建议为：(a) **Phase 5 上下文可视化**（独立、用户每次发送都能感知、不依赖其它 Phase）；(b) **Phase 4 多 Agent + Markdown / Artifact 稳定性**（Markdown / Artifact 修复优先级高于多 Agent adapter）；(c) **Phase 6 视觉锚点**（最弱依赖，但需要先做 icon audit 才好开工）。等用户挑一条之后再写细化方案。

### Phase 3 Step 4a (实现完成 2026-05-10)：任务会话壳 + 文本生成

> **Step 4 → 4a/4b 拆分原因（Codex review）**：v2 计划承诺"走统一 Runtime / Agent 执行链、streamClaude、工具与权限事件"。实际实现中 `agent-task-runner.ts` 的底层模型调用仍是 `generateTextFromProvider`（一次性文本），所以后台任务**不能调用工具、不会触发权限请求、不可能进入真实的 `waiting_for_permission`**。Codex 抓出这条不一致后，我们诚实拆成两步——Step 4a 已落地的"任务会话壳 + 文本生成"是真东西且独立有用；Step 4b 留作后续单独评审。
>
> **Step 4a 已交付**（这一批）：
>
> - 架构外壳：每次 ai_task 执行写一条 `task_run_logs` running 行 + 把 user prompt + assistant response 持久化为该会话的 messages，两边都通过 `messages.task_run_id` 关联到 run 行。
> - `task.source` 分支：`'user'` 走 task-bound 会话（`chat_sessions.source='task'`，主聊天列表默认隐藏）；`'assistant_heartbeat'` 走 buddy session（**未存在时由 runner lazily create**，不再硬失败）。
> - HEARTBEAT_OK silent contract（exact trim-equality）。
> - `messages.task_run_id` + `<TaskRunMarker />` React-only 渲染（**不污染模型上下文**）。
> - Heartbeat 后台化：`ensureHeartbeatTask({enabled, intervalHours})` 幂等创建 / 删除 `kind='ai_task' + source='assistant_heartbeat'` 系统任务。
> - Settings → Assistant 心跳频率选择器（1h / 6h / 12h / 24h）。
> - Tasks 页 5 态状态徽章 + "Open session" 链接（ai_task）。
> - `/api/chat/sessions` 默认 `source='user'`（task 会话隐藏）；`/api/tasks/list` 默认隐藏 `assistant_heartbeat` 系统任务。
> - 应用层 `task_run_logs.status` 5 态白名单（无 DB CHECK，避免 SQLite 表重建）。
> - `/api/tasks/runs/[runId]` PATCH abandon 端点 + scheduler `waiting_for_permission → status='paused'` 路由 — **保留为 Step 4b 基础设施，4a 路径下不会被触发**。
>
> **Step 4a 不做（=Step 4b 范围）**：headless streamClaude runner、tool calls、真 permission events、`<TaskWaitingForPermissionPanel />` UI。
>
> **v2 → 4a 沿用的 5 条修订**：
> 1. 心跳不新增 `kind='heartbeat'` 枚举；统一用 `kind='ai_task' + source='assistant_heartbeat'`。
> 2. `waiting_for_permission` 不做 durable resume；状态机 + abandon 端点存在但 4a 不可达，留 4b 启用。
> 3. `task_run_logs.status` migration 不写 `ALTER CHECK`；应用层校验 + 联合类型。
> 4. 任务 / 心跳 marker 不用 sentinel string；`messages.task_run_id` 关联 + 渲染层组件。
> 5. `ChatSession.source='task'` 默认不进入主聊天列表。

### Phase 3 Step 4b (实现完成 2026-05-10)：headless streamClaude runner + WaitingForPermissionPanel

> **拆分背景**：v2 计划承诺"走统一 Runtime / Agent 执行链 + headless streamClaude + 工具与权限事件"。Step 4a 落地的是其中能独立交付的部分（任务会话壳 + 文本生成 + 心跳后台化 + marker 关联），Step 4b 是承诺里 4a 没覆盖的"真正后台 Agent 执行链"那一半。下面的详细方案描述的是 **Step 4b 待做的工作**——**不**反映 4a 的实现现状。

**目标（4b 完成后用户感受到的变化，相对 4a）**

- `reminder` 到点只提醒，不调用 AI。**(已在 4a)**
- `ai_task` 到点进入**真正的后台 Agent 执行链**——能调用工具、能触发权限请求、不再只是 `generateTextFromProvider` 一次文本生成。**(4b 范围)**
- 后台任务需要权限时**真实可达** `waiting_for_permission` 状态——不再是"铺了表面但触发不到"的预留路径；通知 urgent 弹出，点入会话看到 `[重跑] [放弃]` 选择面板。**(4b 范围)**
- 助理心跳走同款 Agent 执行链；HEARTBEAT_OK 沉默语义不变。**(4a 已实现 silent 沉默；4b 把底层换成 Agent 后行为不变)**
- Bridge 继续只是可选远端通知通道，不是本机任务 / 心跳的前置条件。**(已在 4a)**

**三者边界（reminder / ai_task / heartbeat）**

`kind` 枚举仍然只有两个：`reminder` 和 `ai_task`。心跳不引入第三个 kind——它是**一种特殊的 `ai_task`**，仅靠 `scheduled_tasks.source = 'assistant_heartbeat'` 区分。这样 `ScheduledTaskKind` 类型 / DB CHECK / `/api/tasks/schedule` schema / MCP `codepilot_schedule_task` tool schema / Tasks 页 UI 都不需要同步加 heartbeat 分支。

| 概念 | `kind` | `source` | 触发时机 | 调 AI | chat session | task_run_logs | 通知 priority |
|---|---|---|---|---|---|---|---|
| `reminder` | `reminder` | `'user'` | scheduler 到点 | ❌ | ❌ 不创建 | ✅ 1 行 | normal（fire-once） |
| `ai_task`（用户创建）| `ai_task` | `'user'` | scheduler 到点 | ✅ **走 agent runner** | ✅ 创建 / 复用 task-bound | ✅ 1 行 | normal（succeeded / failed）；urgent（waiting_for_permission） |
| heartbeat（系统注入）| `ai_task` | `'assistant_heartbeat'` | scheduler 周期触发（菜单栏常驻可后台） | ✅（HEARTBEAT.md 决定 silent / speak-up） | ✅ 复用 buddy session | ✅ 1 行 | 仅 speak-up 时发，normal |

**关键边界**：

- `reminder`：纯提醒。prompt 文本即通知正文，不需要 AI provider；"5 分钟后提醒喝水" 这种语义全走这条。
- `ai_task`：让助理在后台帮我做点事。**必须有 chat session 承载结果**（user prompt + assistant message + 工具调用记录），不能再是浮在外面的"一次性文本生成"。`task.session_id` 第一次执行时被填，之后复用；用户可以从 `/settings/tasks` 点入这个会话回看上下文。
- heartbeat 不是新 kind，是 `ai_task + source='assistant_heartbeat'` 的一个特例。差别完全靠 `runScheduledAgentTask` 在 `task.source === 'assistant_heartbeat'` 分支里处理：(a) 复用 buddy session 而不是创建 task-bound session；(b) 输出受 HEARTBEAT.md silent 契约约束（输出 trim 后精确等于 `HEARTBEAT_OK` 即静默不打扰，否则写 assistant message + 发 normal 通知）；(c) 系统注入 / 删除由 `ensureHeartbeatTask()` 管。`task.kind` 维持 `'ai_task'`，下游所有"是不是 AI 任务"的判断都不需要为心跳加例外。

**执行范围（高层 — Step 4a 已交付 + Step 4b 待做拼接）**

1. 后台 task runner：✅ Step 4a 已建外壳（`runScheduledAgentTask`、session 解析、message 关联）；🔄 Step 4b 把 `// 4. Model call` 从 `generateTextFromProvider` 换成 headless `streamClaude`，使其真正"走统一 Runtime / Agent 执行链"。
2. Run 状态机：✅ Step 4a 已铺好 5 态枚举 `running / succeeded / failed / waiting_for_permission / cancelled` + 应用层白名单；🔄 Step 4b 让 `waiting_for_permission` **真正可达**（4a 不可达，4b 在 streamClaude 接到 `permission_request` 时翻这个状态）。
3. 助理心跳后台化：✅ Step 4a 已交付（`ensureHeartbeatTask` 系统任务 + 频率配置 + lazy buddy session + HEARTBEAT_OK 静默契约）。4b 不动这条，只是底层走 Agent runner。
4. UI 收口：✅ Step 4a 已交付 Tasks 页 5 态徽章 + "Open session" 链接 + Assistant 页心跳频率选择器 + chat 里 React-only `<TaskRunMarker />`；🔄 Step 4b 新增 `<TaskWaitingForPermissionPanel />`（task-bound session 末尾若有 paused run，渲染 `[重跑] [放弃]`）。
5. MCP 口径：✅ 继续不变。`codepilot_schedule_task` 是创建任务的唯一入口；外部 Agent 可以创建任务，但不接管 CodePilot scheduler。

**详细拆解（Step 4b 范围）**

> 下方各小节描述 **Step 4b 待做的工作**。Step 4a 已经把外壳搭好（runner 文件存在、`task.source` 分支已落地、message 关联已布线、`waiting_for_permission` 状态枚举已铺好），所以 4b 不需要从零开始——只需要把 `agent-task-runner.ts` 的 `// 4. Model call` 那一段从 `generateTextFromProvider` 换成 headless `streamClaude`，并把 `permission_request` 事件接到已经预留的 paused 路径上。

##### 1. 后台 Agent task runner（4a 外壳 → 4b headless streamClaude 升级）

`src/lib/agent-task-runner.ts:runScheduledAgentTask(task, providedRunId?)` **已在 4a 落地**——session 解析、`addMessage` 链路、HEARTBEAT_OK 静默契约、`task.source` 分支都已工作。**Step 4b 待做的核心**是把第 4 步 "Model call" 从 `generateTextFromProvider` 升级为 headless `streamClaude`：

进入 runner 后再用 `task.source` 决定 session 行为（不是用 kind）：

- `task.source === 'user'` → task-bound 会话路径
- `task.source === 'assistant_heartbeat'` → buddy session 路径 + silent contract（详见 §4）

主流程（user source）：

1. `insertTaskRunLog({ task_id, status: 'running', started_at })` → 拿 runId。
2. 解析 task-bound session：`task.session_id` 已设 → 复用（`getSession`）；未设 → `createChatSession({ title: '[Task] ' + task.name, working_directory, source: 'task' })`，再 `updateScheduledTask(taskId, { session_id: newId })` 持久化绑定。
3. `addMessage(sessionId, 'user', task.prompt, { task_run_id: runId })` → 用户气泡持久化，并把这条消息和本次 run 关联（marker 渲染用，详见 §5）。
4. 调 headless 版 `streamClaude({ sessionId, sessionRuntimePin: task.runtime_pin || null, mode: 'background', permissionMode: 'default' })`。
5. 流事件累积：`text_delta` 累积 → done 时 `addMessage('assistant', assistantBuffer, { task_run_id: runId })`；`tool_use` / `tool_result` 一并落 message（同样带 task_run_id）；`permission_request` 未 resolve → 中断流（cleanly），run status='waiting_for_permission'，partial assistant text 标 incomplete 写入 message；`error` → run status='failed'。
6. `updateTaskRunLog(runId, { status, result, error, duration_ms, notification_event_id, ended_at })`。
7. 发通知（见 §3）。

##### 2. Run 状态机

- `task_run_logs.status` 扩到 5 态：`'running' | 'succeeded' | 'failed' | 'waiting_for_permission' | 'cancelled'`。
- **不动 SQLite CHECK 约束**（v1 写"ALTER CHECK"是错的，SQLite 不支持直接修改 CHECK；要改只能走 12-step 表重建）。当前 `task_run_logs.status` 是无 CHECK 的 `TEXT NOT NULL`（v6 / Phase 3 实现时只给 `notification_deliveries.status` 加了 CHECK）。Step 4 保留这个宽松：DB 列继续无 CHECK，约束完全在应用层。
- 应用层校验在 `db.ts` 的 `insertTaskRunLog` / `updateTaskRunLog` 里：参数 `status` 类型签名收紧到 5 态联合（TypeScript 强制），运行时 `if (!ALLOWED_STATUSES.has(status)) throw new Error(...)` 兜底（防止 untyped JS / 旧 callsite 漏掉）。
- 旧值兼容：旧 `task_run_logs.status` 历史值是 `'running' | 'success' | 'error'`。**新 callsite 一律写新枚举**，但旧行不动也不归一化（避免污染历史 / 触发不相关的迁移问题）。读侧：UI 的 5 态徽章有 `legacy / unknown` fallback，把读到的 `'success'` / `'error'` 老值映射成 `'succeeded'` / `'failed'` 显示色。
- 状态机转移合法：`running → succeeded / failed / waiting_for_permission / cancelled` ✅；`waiting_for_permission → succeeded / failed / cancelled` ✅；终态不可逆（沿用 v5 同款 helper）。
- **`scheduled_tasks.last_status` 不扩 5 态**——这一列在 DB 里有 CHECK 约束（`success / error / skipped / running`），SQLite 改 CHECK 要表重建，本步不做。Tasks 页**显示**的状态从最新 `task_run_logs` 行推导（5 态 + 老值映射）；`last_status` 继续按现行 4 态写：`succeeded` 写 `'success'`、`failed` 写 `'error'`、`waiting_for_permission` 不写 `last_status`（改写 `scheduled_tasks.status='paused'` 阻止 scheduler 复触发）、`cancelled` 不写 `last_status`。这条边界由 4a 已经实现并锁住，4b 不动。
- 如果未来想要 DB 级 CHECK 兜底，需要单独写一刀"task_run_logs 表重建迁移"，**不在 Step 4 范围**——v1 那个"ALTER CHECK"误写在这条 review 里被纠正。

##### 3. 通知集成

每个终态写 1 条 `notification_event`，payload 必带 `task_id` + `session_id`：

| 状态 | priority | 标题 | 正文 |
|---|---|---|---|
| succeeded | normal | `✓ {task.name}` | result 头 200 字 |
| failed | normal | `✗ {task.name}` | error 头部 |
| waiting_for_permission | **urgent** | `⚠️ {task.name} 需要权限` | `点开查看授权` |
| cancelled | (不发) | — | — |

`useNotificationClickRoute` 路由扩展：

- `status === 'waiting_for_permission'` → `/settings/tasks?focus={task_id}`（高亮该 row，提示用户点入解决）
- `status === 'succeeded' / 'failed'` && `session_id` → `/chat/{session_id}`（直达执行会话回看结果）
- `kind === 'reminder'` → `/settings/tasks?focus={task_id}`（沿用现有）
- `source === 'assistant_heartbeat' && speak-up` → `/chat/{buddy_session_id}`（**注意**：心跳是 `kind='ai_task' + source='assistant_heartbeat'`，不是新 kind；区分仅靠 `source`）

##### 4. Heartbeat 后台化

当前实现：`useAssistantTrigger.ts` 在 (a) 路由匹配 assistant workspace (b) 空会话 (c) `data.needsHeartbeat` 时触发 autoTrigger。后台触发不可达。

设计：心跳是一个**特殊的 ai_task**（`kind='ai_task' + source='assistant_heartbeat'`），由系统注入 `scheduled_tasks`，不引入新 kind。

- `scheduled_tasks` 加 `source TEXT NOT NULL DEFAULT 'user'` 列。**不加 CHECK 约束**（同 §2 理由——SQLite 改 CHECK 要表重建，本步避开）；应用层在 `createScheduledTask` / `updateScheduledTask` 校验 source 只能是 `'user'` 或 `'assistant_heartbeat'`，TypeScript 联合类型钉死。
- Assistant workspace state 加 `heartbeatIntervalHours`（默认 24，零或关闭即停后台执行）。
- 启动 / 设置变化时调 `ensureHeartbeatTask()`：`heartbeatEnabled === true && interval > 0` → 创建（或更新）一条 `{ kind: 'ai_task', source: 'assistant_heartbeat', schedule_type: 'cron', schedule_value: <hours-derived cron>, prompt: 'Read HEARTBEAT.md and respond per its silent contract' }` 系统任务；开关关闭 → `DELETE FROM scheduled_tasks WHERE source = 'assistant_heartbeat'`（source 是唯一标识，删除幂等）。
- 执行：`runScheduledAgentTask` 进入后用 `task.source === 'assistant_heartbeat'` 分支（**不是用 task.kind**——kind 仍是 ai_task）：
  - 不创建 task-bound session，复用 buddy session（4a 实现：`resolveBuddySessionId()` 先按 `assistant_workspace_path` + `includeSources: ['user']` 查最新会话，缺失时 lazy-create 一个 `source='user'` 的 "Assistant heartbeat" 会话）。
  - 调 streamClaude 拿模型输出 `assistantBuffer`。
  - **silent contract**：`assistantBuffer.trim() === 'HEARTBEAT_OK'` → 写 `task_run_log status='succeeded' result='silent'`，**不发通知**，**不写 assistant message**（保持 silent 对用户完全透明）。
  - **speak-up**：否则 `addMessage(buddySessionId, 'assistant', assistantBuffer, { task_run_id: runId })` + 发 normal 通知（`payload = { task_id, session_id: buddySessionId }`）。
- 不依赖 Bridge：所有判断都在 `notification-manager.sendNotification()` 之前完成，silent 直接 short-circuit；speak-up 才进入 deliveries 链路。

##### 5. UI 收口

- **TasksSection**：状态徽章扩到 5 态颜色（succeeded 绿 / failed 红 / running 蓝 / waiting_for_permission 黄 / cancelled 灰；老值 `'success'` / `'error'` 显示色映射到 succeeded / failed）；`ai_task` row 展开 run log 时每行加"打开执行会话"链接 `→ /chat/{run.session_id}`；`waiting_for_permission` row 加 warning 边框，提示"点入会话决定重跑或放弃"；过滤掉 `source='assistant_heartbeat'` 的系统任务（不让用户看到自己没创建的 row 增加 IA 噪声），心跳 run 历史只在 Settings → Assistant 心跳卡里通过"心跳运行历史"链接看（链接 push `/settings/tasks?source=assistant_heartbeat` 强制 source filter；本身 Tasks 页默认 hides）。
- **AssistantWorkspaceSection**：v9 / v12 的"无任务列表"决议保留；CheckInCard 下方加"心跳频率"输入（24 / 12 / 6 小时 / 自定义；零或关 = 停止后台心跳），存到 workspace state 后调 `ensureHeartbeatTask()`。
- **Chat marker（4a 已实现 — 不用 sentinel string，no per-marker fetch）**：v1 曾提议在 `message.content` 里写 `[__TASK_RUN__ ...]` / `[__HEARTBEAT_RUN__ ...]` 字面量让 MessageList 解析。这会**污染模型上下文**——下一轮发送时这些字面量进 prompt builder，模型可能尝试解析或复读。**4a 改成的结构化关联**（已落地、4b 沿用、不再修改）：
  - `messages` 表（**真实表名是 `messages`，不是 `chat_messages`**）加 `task_run_id TEXT DEFAULT NULL` 列（4a 通过 `safeAddColumn` 已落库）。soft reference，不加 FK，避免 task_run_logs 删除级联破坏历史 messages。
  - `addMessage(sessionId, role, content, tokenUsage?, metadata?: { task_run_id?: string \| null })`：4a 实现已经把 `task_run_id` 写到该列，**不动 `content` 文本**。
  - prompt builder 拼 LLM 上下文时只读 `content`，`task_run_id` 从来不进 prompt（`step4-architecture-invariants.test.ts` repo-wide 钉死）。
  - **inline-join，不是 per-marker fetch**：`/api/chat/sessions/[id]/messages` 在响应里多带一个 `taskRuns: Record<runId, TaskRunSummary>` map，`MessagesResponse.taskRuns` 类型已铺好；`db.getTaskRunSummariesByIds` 在一次 SELECT IN 里 join `scheduled_tasks` 拿 `name / kind / source`。MessageList 用 prop `taskRuns` 直接查，**TaskRunMarker 不自己 fetch**——避免 N+1。
  - MessageList 渲染时按消息顺序遍历；遇到 `task_run_id` 不为空且和**前一条**消息的 `task_run_id` 不同（或前一条为空）→ 在该消息**之前**插入 `<TaskRunMarker run={taskRuns[message.task_run_id]} />`（React-only，组件签名只接 `run: TaskRunSummary | undefined`，没 fetch / useEffect）。文案：
    - `task_source='user'` → "定时任务 · {当地时间} · {status 中文}"
    - `task_source='assistant_heartbeat'` → "心跳触发 · {当地时间} · {silent 时不会渲染；speak-up 时显示 '助理有事'}"
  - 点 marker 跳 `/settings/tasks?focus={run.task_id}`。
  - silent heartbeat run **不写 assistant message**（§4 已锁定），所以 silent run 不会产生 marker——用户看到的 buddy session 仍然是干净的助理对话。

##### 6. Task-bound chat session 在主聊天列表里的可见度

`ChatSession` 加 `source: 'user' | 'task'`（默认 `'user'`；`createSession` 第 8 个可选参数显式传）。**不引入 `'assistant'` 第三值**——buddy session 在 4a 实现里就是普通的 `source='user'` 会话，归入"用户可见"那一类；assistant 这条独立维度其实只存在于 `scheduled_tasks.source = 'assistant_heartbeat'`（任务侧），不在 chat session 表里再分一遍。

- `source='user'`：普通用户对话——主聊天列表（`ChatListPanel`）默认显示。**buddy session 也是这一类**：4a 的 `resolveBuddySessionId` lazy-create 走 `createSession(..., 'user')`，让心跳 speak-up 写到的会话天然出现在用户可见列表里（用户从主列表点开就能看到助理消息）。
- `source='task'`：`runScheduledAgentTask` 为 user-source ai_task 创建的执行会话——**主聊天列表默认隐藏**（`/api/chat/sessions` GET 默认 `includeSources=['user']`，过滤掉 task）。只通过 (a) `/settings/tasks` 行内"打开执行会话"链接、(b) 通知 click route、(c) 直接 URL `/chat/<sessionId>` 三条路径访问。

如果未来想把 task-bound session 显示到主列表，**必须加可见标记**（"任务"badge / 区别图标），不允许默默混进来。这条作为后续设计约束写在 `feedback_*` 用户记忆里。

4a 实现已落到 `/api/chat/sessions`（**不是 `/api/chat/sessions/list`**——后者不存在）：默认 `?source` 缺省 = `'user'`（task 隐藏）；`?source=task` 显式拉 task-bound 会话；`?source=all` 不过滤。底层 `getAllSessions({ includeSources })`。ChatListPanel 不需要传任何参数——服务端默认就过滤掉 task 会话了。

**不做**

- 不做 cron 表达式编辑器。
- 不做复杂多 Agent 协同或外部 scheduler 接管。
- 不恢复重表单创建任务 UI。
- 不把心跳塞回全局任务页。
- 不把 Bridge 变成本机通知前置。
- 不在后台 task 中支持需要 UI 的复杂权限审批（默认 default mode；要 elevation 必须用户主动从通知点入处理）。
- 不做心跳频率 < 1h 的支持（避免 background polling 过密）。
- 不做心跳 / 任务跨设备同步。
- **不做 durable agent state resume**——`waiting_for_permission` 状态下，不试图把 agent 流"接着跑"。现有 permission registry 是 live stream-bound promise，后台 stream 已经退出后没有任何"魔法接管"机制能让原 run 继续。Step 4 v2 只做"暂停 + 用户手动决定"：用户从通知 / Tasks 页进入 task-bound session，看到 partial assistant message + 一个 `[重跑此任务] / [放弃]` 行内 panel，由用户主动选；selecting 重跑 → 创建一个新 `runId` 从头跑（旧 run 永久停在 `waiting_for_permission` 作为历史），selecting 放弃 → 旧 run 翻 `cancelled`。真正的 durable resume（agent state 序列化 / replay）放 Phase 4+。

**详细验收路径（Step 4b）**

> 不要跳步——每条都要在 dev / Electron 实机上手动核对。下方 ✅ 标记的项 Step 4a 已经能在实机上看到；🔄 标记的项要等 Step 4b 实现 headless streamClaude 才会真实可达。

1. ✅ **reminder 不调 AI（行为不变，回归）**：在 chat 里说"5 分钟后提醒我喝水"→ `kind='reminder'` → 到点 macOS 通知弹出，正文 = prompt 文本；`generateTextFromProvider` 调用计数 = 0。
2. **ai_task 进真 Agent 执行链**：✅ Step 4a 已经走 `runScheduledAgentTask`、创建 task-bound session、写 user / assistant message、链回 task_run_log；🔄 Step 4b 把 model call 换成 headless `streamClaude`，能调用工具、能产出 `tool_use` / `tool_result` 消息记录。验收：在 chat 里说"明天早上 9 点帮我看一下 README 然后告诉我有没有 typo"→ 到点 → `runScheduledAgentTask` → headless streamClaude → 完成时 `/chat/<task.session_id>` 看到完整 user → tool_use → tool_result → assistant 对话（4a 只能看到 user → assistant 文本）；通知"✓ {task.name}"弹出 + session 链接。
3. **ai_task 失败路径**：✅ Step 4a 已能 fail（provider 错误、生成失败）；🔄 Step 4b 还会捕获工具调用失败（"调不存在的工具" 等场景）。验收：故意触发失败 → run `status='failed'` + `error` 字段填具体错误；通知 + Tasks 页 failed 徽章。
4. 🔄 **ai_task waiting_for_permission（4b 关键新行为）**：创建会请求 FileWrite 权限的 ai_task → 到点 → headless streamClaude 流到 `permission_request` → 后台 cleanly cancel（不等用户接受，因为没 UI 接受）→ run `status='waiting_for_permission'` + partial assistant text 标 incomplete 落 message（带 `task_run_id`）+ `scheduled_tasks.status='paused'`（4a 已铺，4b 才真实写入）。macOS **urgent** 通知 `⚠️ {task.name} 需要权限`；点通知 → 跳 `/settings/tasks?focus={taskId}` → row 黄色高亮；用户点 row → 进 task-bound chat session → 看到 partial assistant message 末尾 + inline `<TaskWaitingForPermissionPanel />` 提供 `[重跑此任务] [放弃]`。点"重跑此任务" → POST `/api/tasks/{id}/run` 创建新 runId 从头跑（旧 run 永久停在 `waiting_for_permission` 作为历史）；点"放弃" → PATCH `/api/tasks/runs/{runId}` 翻 cancelled。**4b 不实现 durable resume**——live permission registry 是 stream-bound promise，stream 已退出无法接管。
5. **heartbeat 后台触发**：✅ Step 4a 已交付——Settings → Assistant 打开心跳 + 频率 → 关窗（菜单栏常驻）→ 到点 fire；HEARTBEAT_OK 沉默不发通知；speak-up 写 buddy session message + normal 通知 + chat 里 React-only `<TaskRunMarker />`。Step 4b 不动这条；底层换 streamClaude 后行为不变。
6. ✅ **Settings → Assistant 不恢复任务列表**（Step 4a 已交付）：v13 layout + 心跳频率选择器；没有任务列表 / 删除按钮。
7. ✅ **/settings/tasks 状态显示**（Step 4a 已交付，4b 让黄色 waiting_for_permission 真实出现）：5 态徽章颜色；`ai_task` row 展开看到 session 链接；`source='assistant_heartbeat'` 的系统任务默认隐藏（`?source=assistant_heartbeat` 显式查看）。
8. **自动化测试与构建**：4a 已通过 `npm run test 1739/1739` + `npx next build`；🔄 Step 4b 完成时需新增针对 streamClaude 事件流的 mock 测试 + WaitingForPermissionPanel 契约。浏览器 smoke 走 1 + 2 + 6 + 7；Electron 手动 smoke 走 4 + 5（菜单栏常驻 + 后台 + 权限面板）。

**涉及的模块**

| 模块 | 改动方向 |
|---|---|
| `src/lib/agent-task-runner.ts` | **新文件**：`runScheduledAgentTask(task)`；headless streamClaude 包装；按 `task.source` 分支（user / assistant_heartbeat）；状态累积成 message + run_log |
| `src/lib/task-scheduler.ts` | `executeDueTask` `kind === 'ai_task'` 分支切到 agent-task-runner（`reminder` 不变）；新增 `ensureHeartbeatTask` / `removeHeartbeatTask`（用 `source='assistant_heartbeat'` 唯一标识，幂等创建 / 删除） |
| `src/lib/db.ts` | `scheduled_tasks` 加 `source TEXT NOT NULL DEFAULT 'user'`（**无 CHECK，应用层校验**）+ workspace state 加 `heartbeat_interval_hours`；`messages` 加 `task_run_id TEXT DEFAULT NULL`（soft reference，不加 FK）；`addMessage` 接受 `metadata: { task_run_id? }` 写入新列；`chat_sessions.source` 扩 `'user' \| 'task'`；`getAllSessions` 加 `includeSources` 过滤；`getLatestSessionByWorkingDirectory` 加 `includeSources` 过滤（heartbeat buddy 解析必传 `['user']`）；`getTaskRunSummariesByIds` 用于 `/api/chat/sessions/[id]/messages` inline join；`getTaskRunById` 用于 abandon 端点 |
| `src/lib/claude-client.ts` | `streamClaude` 加 `mode: 'background' \| 'interactive'`；background 模式 permission event → cleanly cancel stream + 抛 `PermissionRequiredError`（不走 SSE，不等 user resolve） |
| `src/types/index.ts` | `TaskRunStatus` 5 态联合 + `TASK_RUN_STATUS_VALUES` + `isTaskRunStatus`（应用层 `ALLOWED_TASK_RUN_STATUSES` Set 在 db.ts）；`ScheduledTaskSource = 'user' \| 'assistant_heartbeat'`；`ScheduledTask.source?`；`ChatSessionSource = 'user' \| 'task'`（**只有两值，无 `'assistant'`**——buddy session 复用 `'user'`）；`Message.task_run_id?`；`MessagesResponse.taskRuns?: Record<id, TaskRunSummary>`（4a 已铺，inline-join 用） |
| `src/lib/notification-manager.ts` | 不变（payload 已支持 task_id + session_id） |
| `src/hooks/useNotificationClickRoute.ts` | 路由扩展：waiting_for_permission → tasks 页 focus；ai_task succeeded / failed → /chat/{sessionId}；`source === 'assistant_heartbeat'` && speak-up → buddy session（**`source` 而非 `kind`**） |
| `src/app/api/chat/sessions/route.ts` | 4a 已实现：`?source` query 默认 `'user'`（task 隐藏）；`'task'` / `'all'` 显式请求；底层走 `getAllSessions({ includeSources })` |
| `src/components/layout/ChatListPanel.tsx` | 4a 已生效：调用方不需要改——直接用 `/api/chat/sessions` 默认行为，task-bound session 已被服务端 filter 掉 |
| `src/components/settings/TasksSection.tsx` | 状态徽章 5 态颜色（含老值映射）；`ai_task` run log 加 session 链接（4a 已交付）；🔄 4b 加 `waiting_for_permission` row 警告高亮；过滤掉 `source='assistant_heartbeat'` 系统任务（默认隐藏；URL `?source=assistant_heartbeat` 可显式查看心跳运行历史） |
| `src/components/settings/AssistantWorkspaceSection.tsx` + `WorkspaceStatusCards.tsx` | CheckInCard 下加 heartbeatIntervalHours 输入（4a 已交付）；🔄 4b 可选：加"查看心跳运行历史"轻 link（push `?source=assistant_heartbeat`） |
| `src/components/chat/TaskRunMarker.tsx` | 4a 已交付：组件签名 `({ run }: { run: TaskRunSummary \| undefined })` —— **从 prop 读，不 fetch**。React-only，**不读 / 不写 message.content**。N+1 已避免：数据靠 `/api/chat/sessions/[id]/messages` 一次响应里的 inline-joined `taskRuns` map 喂下来 |
| `src/components/chat/MessageList.tsx` | 4a 已交付：接受 `taskRuns` prop（`Record<runId, TaskRunSummary>`），按消息顺序遍历——当前条 `task_run_id` 与前一条不同（或前一条空）→ 在前面插 `<TaskRunMarker run={taskRuns[message.task_run_id]} />`；**不解析任何 sentinel string** |
| `src/lib/prompt-builder.ts`（或等价 LLM context 构造点）| 验证：构造 prompt 时只读 `message.content`，`task_run_id` 完全不进 prompt（contract test 钉死） |
| `src/components/chat/TaskWaitingForPermissionPanel.tsx` | **新文件**：当用户进 task-bound session 看到末尾 partial assistant message 后，渲染一个 inline panel 提供 `[重跑此任务] [放弃]` 按钮；重跑 → POST `/api/tasks/{id}/run` 创建新 runId；放弃 → PATCH 旧 run 翻 cancelled |
| `src/i18n/{zh,en}.ts` | 新增状态文案 + 心跳频率 + marker 文案 + 通知标题 + waiting_for_permission panel 文案 |

**风险与降级**

- **后台 streamClaude 没有 SSE 消费方**：现有 streamClaude 流到 renderer SSE。后台 task 跑时 renderer 可能在另一个 session 或根本没打开。需给 streamClaude 加 `mode: 'background'`，事件进 in-process listener 而非 SSE。降级：v1 background 模式只支持纯文本输出 + 简单 tool calls；复杂工具链作为 v2 增强。
- **权限请求处理（不做 durable resume）**：后台 task 请求权限时无 UI 接受 — 设计选择 = cleanly cancel stream + 进 `waiting_for_permission` 状态，让用户从通知 / 任务页进入会话**手动决定**重跑或放弃。**不实现"用户接受权限后自动从断点继续"**——current permission registry 是 stream-bound live promise，stream 退出后 promise 没有承接方，没有"魔法接管"机制；勉强写一套 durable agent state checkpoint / replay 已经超出 Step 4 scope。**绝对不静默 reject 让任务以为自己 succeeded**——partial state 永远落 message + run_log。durable resume 留 Phase 4+ 单独评估。
- **buddy session 跨工作区切换**：用户切了 assistant workspace 后，旧 buddy session 是否还能跑 heartbeat？设计：heartbeat task 创建时绑定当前 workspace，切换 workspace 时 `ensureHeartbeatTask` 重新评估并替换。
- **HEARTBEAT_OK silent contract 边界**：模型输出含 `HEARTBEAT_OK` 但仍有正文 → 算 silent 还是 speak-up？设计：**精确匹配 trim 后等于 `HEARTBEAT_OK`** 才是 silent，否则 speak-up（避免误判）。
- **runtime mismatch**：task.runtime_pin = 'codepilot_runtime' 但当前 CLI 不可用。设计：fall back 到 native；记录 fallback 到 run_log result 末尾。
- **status 枚举无 DB 兜底（部分列）**：`task_run_logs.status` 与 `scheduled_tasks.source` 都没有 DB CHECK（前者历史就没建，后者是 4a `safeAddColumn` 新加的且 SQLite 不支持 ALTER CHECK），所以这两列的合法值约束完全在应用层。降级：`insertTaskRunLog` / `updateTaskRunLog` / `createScheduledTask` 严格联合类型签名 + 运行时白名单校验；`task_run_logs.status` 旧值 `'success'` / `'error'` 在 UI 读侧映射到 `succeeded` / `failed` 显示色，DB 行不动也不归一化（避免迁移引入新 bug）。如果未来要加 DB-level 强制，单独写一刀表重建迁移。**`scheduled_tasks.last_status` 不在此列**——它从一开始就有 legacy CHECK（`'success' \| 'error' \| 'skipped' \| 'running'`），4a/4b 都不动它，5 态语义只在 `task_run_logs.status` 上展开（Tasks 页显示状态从最新 run 推导）。
- **prompt 上下文不能被 marker 污染**：v1 用 sentinel string 写入 `message.content` 让前端解析的方案被否决——会被下一轮 prompt builder 包进 LLM 上下文。4a 已经改成 `messages.task_run_id` 列 + React-only marker 渲染（inline-join via `MessagesResponse.taskRuns`，no per-marker fetch）；contract test (`step4-architecture-invariants.test.ts`) repo-wide 钉死无 sentinel 字面量 + `task_run_id` 永远不进 prompt。4b 沿用，不动。

**测试覆盖**

- `agent-task-runner.test.ts` (新)：mock streamClaude；`reminder` 不进入 runner（走原 reminder 路径）；`ai_task + source='user'` 创建 / 复用 task-bound session 并写 assistant message + run_log；`ai_task + source='assistant_heartbeat'` 复用 buddy session 不创建；text 累积成 message；error 路径写 specific error；`addMessage` 调用必须带 `task_run_id` metadata。
- `task-run-status-machine.test.ts` (新)：5 态联合类型 + 应用层白名单（pass: 5 态 / fail: 任意其它字符串）；转移合法性表（running → 4 终态合法；终态不可逆）；UI 老值映射 `success → succeeded` / `error → failed`；**不写"ALTER CHECK"相关测试**（DB 层不做约束）。
- `heartbeat-background.test.ts` (新)：`ensureHeartbeatTask` 在开关 / interval 切换时 idempotent（两次调用不创建第二行；删除幂等）；agent runner 见 `source='assistant_heartbeat'` 分支正确路由；silent 路径不写 message + 不发通知；speak-up 路径写 buddy session message（带 task_run_id metadata）+ 发通知。
- `tasks-section-status-display.test.ts` (新)：5 态徽章颜色 source-grep；ai_task row 必须含 session 链接；waiting_for_permission row 必须含 warning 类；TasksSection 默认 SQL filter 排除 `source='assistant_heartbeat'`。
- `heartbeat-interval-input.test.ts` (新)：Assistant 页输入存到 setting 并触发 `ensureHeartbeatTask`；零 / 关闭 → `removeHeartbeatTask` 调用；CheckInCard 下"查看心跳运行历史"link push `?source=assistant_heartbeat`。
- `chat-message-task-run-id.test.ts` (Step 4b 新增)：`addMessage` 接受 `task_run_id` metadata 写入 `messages.task_run_id` 列；`messages` schema 含该列；prompt builder 构造 LLM context 时只读 `content`，**source-grep 钉死 prompt 拼接路径不引用 `task_run_id`**（防回归到 sentinel pattern）。注：4a 已经在 `step4-architecture-invariants.test.ts` 钉了"无 sentinel 字面量"的 repo-wide 防线，本测试是 4b 加针对 prompt 拼接路径的更精细钉死。
- `task-session-list-filter.test.ts` (新)：`/api/chat/sessions/list` 默认 SQL where `source != 'task'`；显式 `?source=task` 才返回；ChatListPanel 的 fetch URL 不带 `source=task`；TasksSection 拉某 task 的执行会话 fetch 必须带 `?source=task&task_id=...`。
- `waiting-for-permission-panel.test.ts` (新)：task-bound session 末尾若有 `waiting_for_permission` partial assistant message → 渲染 inline panel 含"重跑" / "放弃"按钮；点"重跑" POST `/api/tasks/{id}/run` 创建新 runId；点"放弃" PATCH 旧 run 翻 cancelled；source-grep 不出现"agent resume" / "continue stream" 等暗示 durable resume 的字面量。

**审批信号**：以上是 v2 (review-fix-1) 待审批稿。等用户 review 确认 5 条修订都到位后再开 Step 2（实现 agent-task-runner）。在 v2 范围之外的扩展（cron 编辑器 / 多 Agent / durable agent state resume / 跨设备同步）按"不做"边界一律不动。
- 扩 `notification-ack.test.ts`：waiting_for_permission urgent priority 钉死。
- 扩 `useNotificationClickRoute.test.ts`：3 类路由（waiting_for_permission → tasks，ai_task succeeded → chat session，heartbeat speak-up → buddy）。


## 未闭环风险 / TODO

> 这一节是"还没修但有用户路径影响"的清单。修一条划掉一条（移到对应 phase archive 的决策日志）；不做的事请进"暂缓清单"或单独记入 `tech-debt-tracker.md`。

<!-- ✅ 2026-05-10 修完：chat/page.tsx 拆 NewChatPageInner + 外层 Suspense + useSearchParams 取代 stale useMemo([])；MessageInput 加 adoptedInitialValueRef + useEffect 在 prop 真正变化时 setInputValue。新增 `chat-prefill-warm-navigation.test.ts` 7 例契约。CDP 实机 smoke 留给用户在本地走 `npm run dev → /settings/tasks → 新建任务` 端到端确认。完整记录见 phase-3 archive 决策日志。 -->
<!-- ✅ 2026-05-10 修完：AssistantWorkspaceSection.tsx:547 整段 SettingsCard 换成单行 link button 跳 `/settings/tasks?source=assistant`，显示"共 N 个定时任务"或"还没有定时任务" + "在 设置 · 定时任务 中查看"。删除 handleDeleteTask + Trash icon + 3 条退役 i18n key（taskDelete / taskNextRun / noTasks），新增 3 条 link 文案 key (tasksLinkEmpty / tasksLinkCount / tasksLinkAction)。新增 `assistant-tasks-link-only.test.ts` 6 例契约。完整记录见 phase-3 archive 决策日志。 -->
<!-- ✅ 2026-05-10 修完：zh + en 的 `assistant.heartbeatDesc` 改为显式说明"在助理工作区开始新对话时触发（不是后台定时任务，关闭应用 / 离开工作区时不会主动跑）"。新增 `heartbeat-copy-honesty.test.ts` 7 例契约（双语必须含"不是后台定时任务" / "not a background timer"，必须 anchor 到"新对话" / "new chat" + "助理工作区" / "assistant workspace"，必须保留 silent / speak-up 半句，title 不变）。完整记录见 phase-3 archive 决策日志。 -->
<!-- ✅ 2026-05-10 v11 修完："复制对话 ID 报错"+"侧边栏与文件树互斥"两条 TODO 一起收掉。

复制 ID：根因是三个 callsite（UnifiedTopBar.handleCopyId / SessionListItem 下拉菜单"复制对话 ID" / ProjectGroupHeader 下拉菜单"Copy folder path"）都做 fire-and-forget `navigator.clipboard.writeText(value)`——Electron renderer 在 DropdownMenu blur 后页面失焦，writeText reject NotAllowedError，未 await 也未 catch → 未处理 promise rejection 变控制台 / Sentry 错误，用户没反馈。新增 `src/lib/clipboard.ts:copyWithToast` 统一 await + try/catch + showToast（success / warning fallback 把原文 inline 在 toast 文字里，方便手动复制），三处都改用它。新增 `common.copySuccess` / `common.copyFailed` 双语 i18n key。

互斥：根因是 `WORKSPACE_TAB_OPEN_EVENT` 事件路径绕过了 topbar 按钮的 mutex —— file-tree 点击 / MessageItem markdown / artifact 点击 / DiffSummary 卡片都派这个事件，`useWorkspaceSidebar` 把它翻成 `openDynamicTab` 直接 set `open: true`，于是 file tree + sidebar 同时挤压聊天区。新增 `RightRailMutexEnforcer` 组件挂在 `<WorkspaceSidebarProvider>` 内（这样它能同时读 PanelContext 和 sidebar context），用 `useEffect` 在两个状态都为 open 时强制 `setFileTreeOpen(false)`。Asymmetric on purpose：file-tree 唯一开启入口是 topbar 按钮，已同步关 sidebar，反向不需要 watcher。

测试：新增 `clipboard-toast-feedback.test.ts` 9 例 + `right-rail-mutex.test.ts` 6 例。完整记录见 phase-3 archive 决策日志。 -->
<!-- ✅ 2026-05-10 修完：v7 P2 的 Map projection 出口加上 `error` 解构，返回类型签名升为 `Array<{ channel; status; error? }>`，扩 `send-notification-dedup.test.ts` 2 例契约（签名 + 解构）。完整记录见 phase-3 archive 决策日志。 -->

## 验收入口

> 把每条主线"在哪个页面 / 命令能验"集中放这里。日常想确认某条是否还在工作，按这里走。

- **Phase 1**：Settings → Providers（添加套餐型服务商不报 discovery 失败）；Settings → Models（OpenRouter 走搜索；套餐型模型不出现 100+ 上游目录）；Chat 新会话默认模型按钮显示 `<provider>·<model>`。
- **Phase 2**：composer 工具栏 `[模式] [对话引擎] [权限]` 三联可见；切 RuntimeSelector → /chat 即时按新 runtime 过滤；删除当前会话 provider → 发送返回 409 INVALID_SESSION_PROVIDER 横幅；切换后 transcript 出现 "已切换执行引擎：X → Y" marker。
- **Phase 3**：创建一个"+1 分钟" reminder（不配 provider）→ 关窗 → 等到点 → macOS 系统通知弹出 → 点通知落到 `Settings → 定时任务` + 焦点该任务 + 展开看到 delivery log；浏览器直接 POST `/api/tasks/schedule` 带 `notify_on_complete: true` 返回 200 + DB row 1。

## 暂缓清单

不主动开工的（用户决议或不在本轮 6 条主线内）：

- Run Checkpoint Round 3（PermissionPrompt 视觉收编，2026-04-30 用户决定）
- 更多 Bridge 渠道（微信 / QQ Bridge — 单独计划在 active）
- 插件市场深度功能、浮窗助理、自动多 Agent 编排
- 全 provider billing / usage API
- Memory 管理面板
- 大规模官网 / 文档站工作

## Phase 4 / 5 / 6 待启动方案

> 这三个 Phase 的具体方案保留在本文件，等启动时再细化。Phase 1-3 完成、本节列出的尾巴清掉之后才考虑开工。

### Phase 4：多 Agent、Codex 适配、Markdown / Artifact

- **用户结果**：能显式说"让 Codex / OpenClaw 处理这部分"；Markdown / Artifact 不再切换错内容 / 预览空白。
- **要做**：定义 Local Agent Adapter 最小契约；Codex adapter 优先（连接 / 启动 / 传 prompt+cwd / 回收结果）；`@agent` 第一版只支持显式调用；Markdown / Artifact 稳定性清单。
- **不做**：主 Agent 自动派单；多 Agent 并行编排；要求外部 Agent 共享完整权限系统。

### Phase 5：上下文可视化

- **用户结果**：输入框右下角不只是百分比，而是组成条——历史 / 输入 / 附件 / 系统提示 / Memory 各占多少。上下文快满时知道删什么。
- **要做**：在现有 token estimate 上拆来源；Run 状态面板显示组成条 + 明细；Context chips / attachments / directory refs 共用同一估算数据；缺 model context length 时显"容量未知"但仍展示相对大小。
- **不做**：第一版 token 精确到账单级；为可视化重写 context assembler。

### Phase 6：视觉锚点与图标体系

- **用户结果**：点阵风格视觉记忆点（loading / 空状态 / 背景纹理）；图标统一到 HugeIcons。
- **要做**：先做视觉资产 + icon audit；HugeIcons 统一封装；点阵风格只在 3 个低风险位置试点；CDP 截图确认。
- **不做**：一口气全局重做 UI；点阵铺满所有卡片。

## 最近决策（最近 8 条）

> 完整决策日志按 Phase 归档，见 `completed/refactor-phase-*.md`。本节只保留最新 8 条，方便快速回顾上一刀做了什么。

- 2026-05-10：**Phase 3 尾巴 v13 — 撤回 v11 右栏互斥（产品决策反向）**。v11 把 FileTreePanel ↔ WorkspaceSidebar 在 topbar onClick 与新建的 `RightRailMutexEnforcer` 双层钉成 mutex（开一个自动关另一个），用户在 review 中明确指出方向反了：实际产品意图是**叠加**——用户希望同时浏览 file tree + 在 sidebar 上钉一个 markdown / artifact preview Tab，被强行关掉的体验比"两栏挤压聊天"更糟。v13 撤回：(a) `AppShell.tsx` 删 `RightRailMutexEnforcer` 函数定义 + provider tree 里的 `<RightRailMutexEnforcer />` mount；(b) `UnifiedTopBar.tsx` 文件树按钮 onClick 删 `if (next && ws?.state.open) ws.setOpen(false)`，简化为 `setFileTreeOpen(!fileTreeOpen)`；(c) sidebar 按钮 onClick 删 `if (next && fileTreeOpen) setFileTreeOpen(false)`，简化为 `ws.setOpen(!ws.state.open)`；(d) `ChatContentRow` 注释里"Mutual exclusion"段改成"v13 additive"。`right-rail-mutex.test.ts` 文件名留作 git 历史，内容反向：钉死 (i) 不许有 `RightRailMutexEnforcer` 函数 / mount；(ii) 文件树 onClick 不许含 `ws.setOpen(false)` 的 mutex 三件套；(iii) sidebar onClick 不许含 `setFileTreeOpen(false)` 的 mutex 三件套；(iv) 两个按钮各自的 toggle 调用还在；(v) `<WorkspaceSidebar />` 与 `<PanelZone />` 仍是 `isChatDetailRoute` 下的兄弟节点；(vi) `railVisible` 仍用 `||`（任一开就显示分割线）。`npm run test` 1723 通过 0 失败（v12 1724 → 1723 是 v11 旧契约里两条"必须同步 mutex"被反向断言替代，6 例对 6 例平衡，但 v11 多挂的"useWorkspaceSidebar 仍监听 WORKSPACE_TAB_OPEN_EVENT 作为 enforcer 存在理由"breadcrumb 已经无用、删掉，所以净 -1）；`npx next build` ✓ 9.2s。详见 [phase-3](../completed/refactor-phase-3-background-tasks-notifications.md)。
- 2026-05-10：**Phase 3 尾巴 v12 — 用户体感反馈两条**：(A) Assistant 页"定时任务"卡片 v9 改成的 link 入口直接**删除**——既然全局 `/settings/tasks` 已经存在且从 Settings sidebar 直达，Assistant 页再放一个跳转入口属于 IA 噪声，不展示助理特有信息。整段 SettingsCard / `tasks` state / `fetchTasks` callback / 对应 useEffect / `ScheduledTask` import / `assistant.scheduledTasks` + `tasksLink*` 三 key（双语）全部退役。(B) 心跳卡（`CheckInCard`）原本是 `flex items-center justify-between` 把"标题 + 描述 + 状态"整块挤在 Switch 左侧；v10 描述变长后挤到几乎贴 Switch。重排成顶部一行只放标题 + Switch，描述 + 状态 + 提示全宽换行；同时把 zh / en `assistant.heartbeatDesc` 精简到一句"在助理工作区开始新对话时触发——不是后台定时任务。无事保持静默（HEARTBEAT_OK），有事主动告知。"（双语对应"Triggers when you start a new chat in the assistant workspace — not a background timer. Stays silent (HEARTBEAT_OK) if all is clear; speaks up if something needs attention."）。v10 的 `heartbeat-copy-honesty.test.ts` 7 例契约（必含"不是后台定时任务"/"not a background timer" + "新对话"/"new chat" + "助理工作区"/"assistant workspace" + outcome 半句保留 + title 不变）都还满足，本批不需要改测试期望，只复用既有钉死。`assistant-tasks-link-only.test.ts` v9 钉的"必须有 link 入口"反过来——v12 重写为"完全不许有 scheduled-task 入口"：不许 `tasks.map` / 不许 `useState<ScheduledTask[]>` / 不许 `setTasks` / 不许 import `ScheduledTask` / 不许 `handleDeleteTask` / 不许 import `Trash` / 不许 router.push 到 `/settings/tasks` / 不许引用 7 条退役 i18n key（含 v9 新增的 3 条 + v9 自己退役的 3 条 + `scheduledTasks` 主标题）/ zh + en bundle 不许再定义这 7 条 key。`npm run test` 1724 通过 0 失败；`npx next build` ✓ 7.9s。详见 [phase-3](../completed/refactor-phase-3-background-tasks-notifications.md)。
- 2026-05-10：**Phase 3 尾巴 v11 — 复制 ID 报错 + 右栏互斥两条尾巴一起收**。复制 ID：三个 callsite (`UnifiedTopBar.handleCopyId` / `SessionListItem` 下拉 / `ProjectGroupHeader` 下拉) 都做 fire-and-forget `navigator.clipboard.writeText(value)`，Electron renderer 在 DropdownMenu blur 后页面失焦 → reject NotAllowedError → 未 await 也未 catch → unhandled rejection 进控制台 / Sentry，用户没反馈。新增 `src/lib/clipboard.ts:copyWithToast` 统一 await + try/catch + showToast（success → 成功提示；warning → 文案附原文 inline 让用户手动复制），三处都改用它，新增 `common.copySuccess` / `common.copyFailed` 双语 i18n key。互斥：根因是 `WORKSPACE_TAB_OPEN_EVENT` 事件路径绕过 topbar 按钮 mutex（按钮已经会关另一面板，但 file-tree 点 / MessageItem markdown 点 / DiffSummary 卡片派的事件经 `useWorkspaceSidebar.openDynamicTab` 直接 set `open:true`）。新增 `RightRailMutexEnforcer` 组件挂在 `<WorkspaceSidebarProvider>` 内（这样它能同时读 PanelContext 与 sidebar context），用 useEffect 在两个状态都 open 时强制 `setFileTreeOpen(false)`；asymmetric on purpose（file-tree 唯一开启入口是 topbar 按钮已同步 mutex）。新增 `clipboard-toast-feedback.test.ts` 9 例 + `right-rail-mutex.test.ts` 6 例契约。`npm run test` 1722 通过 0 失败；`npx next build` ✓ 8.3s。Phase 1-3 主线 + 全部 TODO 至此清空。详见 [phase-3](../completed/refactor-phase-3-background-tasks-notifications.md)。
- 2026-05-10：**Phase 3 尾巴 v10 — 助理心跳文案诚实化（IA 闭环 2/2）**。把 zh + en `assistant.heartbeatDesc` 从含糊的"每次访问时检查 HEARTBEAT.md" / "checks HEARTBEAT.md on each visit" 改成显式的"打开新对话时触发，不是后台定时任务"双语口径——肯定半句明确触发点（"在助理工作区开始新对话时" / "each time you start a new chat in the assistant workspace"），否定半句明确边界（"不是后台定时任务，关闭应用 / 离开工作区时不会主动跑" / "not a background timer — does not run when the app is closed or you are not in the workspace"），保留原有 silent / speak-up 后半段。新增 `heartbeat-copy-honesty.test.ts` 7 例契约钉死双语必含负面框架 + 触发点 + 工作区限定 + outcome 半句保留 + title 不变。`npm run test` 1707 通过 0 失败；`npx next build` ✓ 7.4s。Phase 3 IA 至此全部闭环（Tasks 页负责全局任务管理 + Assistant 页只剩心跳 / 主动问候 + 心跳文案不再让用户误以为后台定时器）。详见 [phase-3](../completed/refactor-phase-3-background-tasks-notifications.md)。
- 2026-05-10：**Phase 3 尾巴 v9 — Settings → Assistant 任务列表搬走（IA 闭环 1/2）**。`AssistantWorkspaceSection.tsx:547` 整段内联 task list + 状态徽章 + 删除按钮换成单行 link button 跳 `/settings/tasks?source=assistant`，显示"共 N 个定时任务"或"还没有定时任务" + "在 设置 · 定时任务 中查看"。删除 `handleDeleteTask` + `Trash` icon import + 3 条退役 i18n key（`taskDelete` / `taskNextRun` / `noTasks`），新增 3 条 link 文案 key（`tasksLinkEmpty` / `tasksLinkCount` / `tasksLinkAction`）。新增 `assistant-tasks-link-only.test.ts` 6 例契约（不许 `tasks.map` / 不许 `handleDeleteTask` / 不许 import Trash / 必须 router.push 到 /settings/tasks / 用新 i18n key / zh+en bundle 必须含新 key 且去掉旧 key + `{count}` 占位符校验）。`npm run test` 1700 通过 0 失败；`npx next build` ✓ 7.0s。剩 Phase 3 IA 尾巴：心跳文案诚实化（"后台定时器" → "工作区健康检查 / 主动问候"）。详见 [phase-3](../completed/refactor-phase-3-background-tasks-notifications.md)。
- 2026-05-10：**Phase 3 尾巴 v8 — `sendNotification` 返回 `deliveries` 保留 `error` 字段 + `/chat?prefill=…` warm-navigation 修复**。v7 P2 的 Map projection 出口只解构 `status` 把 `error` 字段丢了，外部 API 消费方看不到 Bridge 失败原因；改成 `error ? { channel, status, error } : { channel, status }` + 返回类型签名升为 `Array<{...; error?: string }>`，扩 `send-notification-dedup.test.ts` 2 例契约。同批修 `/chat?prefill=…` 输入框不回填：chat/page.tsx 拆出 `NewChatPageInner` + 外层 Suspense 包，改用 `useSearchParams()`（替换 stale `useMemo([])`）；MessageInput 加 `adoptedInitialValueRef` + `useEffect` 在 prop 真正变化时同步到 `inputValue`，新增 `chat-prefill-warm-navigation.test.ts` 7 例契约。`npm run test` 1694 通过 0 失败；`npx next build` ✓ 7.0s。详见 [phase-3](../completed/refactor-phase-3-background-tasks-notifications.md)。
- 2026-05-09：**Phase 3 Step 3 v7 review-fix（1 P0 SQLite bug + 1 P2 return-shape + 1 P3 类型清理）**。三层防御修 `notify_on_complete` boolean 灌进 SQLite（route + db + builtin tool）；`sendNotification` collector 换成 `Map<string, …>` 去重；`NotificationChannel` 联合类型剔除 `electron-bg-native` 字面量。`npm run test` 1687 通过 0 失败；`npx next build` ✓ 7.1s。详见 [phase-3](../completed/refactor-phase-3-background-tasks-notifications.md)。
- 2026-05-09：**Phase 3 Step 3 v6 review-fix（4 P2 + 1 product redesign）**。修 delivery log run-row 链路 / bg-poller channel 不一致 / builtin tool 忽略 durable=false / Settings hydration mismatch；任务页改为列表-only，新建任务 `prefill` 跳 chat。`npm run test` 1678 通过。详见 [phase-3](../completed/refactor-phase-3-background-tasks-notifications.md)。

## 审批原则（保留）

每一阶段开工前必须回答三件事：

1. **用户结果**：用户打开产品后会看到什么变化，哪些旧困惑会消失。
2. **验收路径**：用哪个页面、哪个按钮、哪个流程可以验证。
3. **不做什么**：本阶段明确不碰哪些诱人的支线。

如果一个任务只能描述成"改某个模块 / 抽某个接口"，但说不清用户会看到什么，就不能作为独立阶段开工。

## 文档拆分历史

- 2026-05-10：把 active/refactor-closeout.md 从 1017 行收口为约 100 行总控板。Phase 0+1 / Phase 2 / Phase 3 的全部计划文本与决策日志（共 48 条）按 Phase 拆到 `completed/refactor-phase-1-models-providers.md` / `refactor-phase-2-runtime-session.md` / `refactor-phase-3-background-tasks-notifications.md`。本文件只保留当前状态、未闭环风险、验收入口、最近 8 条决策、Phase 4-6 待启动方案。Review 同轮补两条 Phase 3 IA 尾巴到 TODO（Assistant 页任务列表残留 / Step 4 心跳文案诚实化），并把状态表 Phase 3 行从 ✅ 改成 🔄 以匹配实际未完成范围。
- 2026-05-10：v8 收两条 TODO（`/chat?prefill=…` warm-navigation 回填 + `notification-manager` deliveries 保留 error 字段），总测试 1687 → 1694。
- 2026-05-10：v9 收 Settings → Assistant 任务列表搬走（Phase 3 IA 闭环 1/2），总测试 1694 → 1700；TODO 减到 3 条。
- 2026-05-10：v10 收助理心跳文案诚实化（Phase 3 IA 闭环 2/2），总测试 1700 → 1707；TODO 减到 2 条（复制对话 ID / 侧边栏与文件树互斥）；状态表 Phase 3 行从 🔄 改回 ✅，整条 Phase 3 主线连同 IA 全部闭环。
- 2026-05-10：v11 一并收掉最后两条 TODO（复制 ID 报错 / 右栏 file-tree↔sidebar 互斥），新增 `lib/clipboard.ts:copyWithToast` 共享 helper + `RightRailMutexEnforcer` 组件；总测试 1707 → 1722；TODO 列表清空，下一步入口改为"挑一条 Phase 4-6 启动"。
- 2026-05-10：v12 用户体感反馈两条 — Assistant 页"定时任务"link 卡 v9 加的入口直接删（与 Settings sidebar 全局任务入口重复，IA 噪声），心跳卡（CheckInCard）布局换行让长描述不再挤 Switch + 文案精简到一句；总测试 1722 → 1724；新增的契约测试只是把 v9 的"必须有 link"反过来钉成"完全不许有 task 入口"。
- 2026-05-10：v13 review 反向 — 用户在 review 中指出 v11 把右栏 FileTree↔Sidebar 钉成 mutex 修反了方向：实际产品意图是叠加（用户希望同时浏览 file tree + 在 sidebar 上钉 markdown / artifact preview）。撤回 v11 的 `RightRailMutexEnforcer` + topbar 两个 onClick 的 mutex 三件套，`right-rail-mutex.test.ts` 文件名留作 git 历史，内容反向钉死"叠加可行 + 不许任一按钮自动关另一个"。总测试 1724 → 1723（净 -1：v11 多挂的 enforcer-存在理由 breadcrumb 已无用）。
