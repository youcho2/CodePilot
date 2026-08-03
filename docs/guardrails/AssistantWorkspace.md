# Assistant Workspace Guardrail

> **Status: Active contract** — 覆盖默认助理建立、旧目录 no-touch、规则文件解析、心跳 desired/actual 状态与系统通知可观测性。
> **为什么先读**：这条链同时触及用户文件、模型费用、后台调度和系统通知。任一层 fail-open 都可能覆盖用户目录、产生幽灵模型调用，或把页面提示伪装成系统通知成功。

## 1. 词汇表

| 词汇 | 含义 |
|------|------|
| Default assistant home | Electron 根据 `app.getPath('documents')` 解析的 `<Documents>/CodePilot/Assistant`，只用于没有任何 workspace 设置的新用户。 |
| Explicit workspace | 用户已经保存的任意非空 `assistant_workspace_path`；即使无效或暂时离线，也必须保留。 |
| Canonical instructions | 新目录使用的中立规则文件 `instructions.md`。 |
| Legacy rules | 旧目录中的 `claude.md`、`CLAUDE.md` 或 `AGENTS.md`；只读兼容，不自动改名。 |
| Desired state | `.assistant/state.json` 中用户是否启用心跳及其 cadence。 |
| Actual state | SQLite `scheduled_tasks` 中可执行的 heartbeat task 及 `next_run`。 |
| Silent heartbeat | 模型输出 trim 后严格等于 `HEARTBEAT_OK`。 |
| Meaningful alert | 非 silent heartbeat 产生的真实助理消息和 notification event。 |

## 2. 不变量 / 契约表

| # | 不变量 | 由谁守 |
|---|--------|--------|
| 1 | 只有 setting 缺失、空或全空白时才能 bootstrap；任意非空旧路径绝不迁移、替换或清理 | `bootstrapDefaultAssistantWorkspace` |
| 2 | 默认路径必须由 Electron fixed-path IPC 解析；Renderer/Next 不得传任意路径给该 IPC | `resolveDefaultAssistantHome` + preload bridge |
| 3 | bootstrap 使用进程 single-flight，最终选择用 DB commit-time CAS；并发显式 PUT 永远有最终决定权 | `bootstrapDefaultAssistantWorkspace` + `compareAndSetSettingIfBlank` |
| 4 | 默认初始化只创建中立最小文件，不创建 session、不调用模型、不启用 heartbeat、不发送通知、不初始化 Git | `initializeWorkspace` + bootstrap tests |
| 5 | 新目录只生成 `instructions.md`；legacy 文件只兼容读取。canonical 与 legacy 同存时只选择 canonical | `loadWorkspaceFiles` |
| 6 | Claude Code 只有在 SDK 会原生加载当前 cwd 的 `CLAUDE.md` 时才省略 CodePilot 的 rules 注入；`instructions.md`、非 cwd legacy 或其他 Runtime 仍由 Context Assembler 注入 | `assembleWorkspacePrompt(..., { omitRules })` + Runtime ownership gate |
| 7 | Onboarding 是渐进增强，不是聊天或心跳开关的门禁；heartbeat 默认关闭并显示模型成本提示 | Settings UI |
| 8 | `HEARTBEAT.md` 只描述检查内容；desired、schedule、run 和 delivery 分属 state file、task row、run log、notification delivery | workspace API + scheduler |
| 9 | 设置变更固定为 desired 原子落盘后 reconcile；reconcile 失败保留用户意图并返回 blocked，不能伪装 success | workspace PATCH + `reconcileAssistantHeartbeat` |
| 10 | heartbeat row 对 exact source 全库至多一条；迁移先重关联 run/event 再合并 duplicate 并建 partial UNIQUE index | DB migration |
| 11 | runner 在创建 session 和调用 Provider 前重读 desired；disabled/mismatch 以 `skipped_reconcile_drift` 收口，0 Provider、0 notification | agent task runner |
| 12 | empty checklist 以 `skipped_empty` 收口；只有 exact `HEARTBEAT_OK` silent。普通 `/api/chat` 不能伪造 heartbeat turn | heartbeat classifier + provider policy gate |
| 13 | 手动“立即检查”和 scheduler due 使用同一 row lock/run path；竞争只能有一个执行者 | `runScheduledTaskNow` |
| 14 | UI 必须分别显示 desired、actual、last run、last meaningful alert 与 native delivery；禁止从 `lastHeartbeatDate` 推断健康 | workspace summary + Settings |
| 15 | 测试系统通知写真实 event/delivery，但不调用模型、不创建聊天/记忆；“delivered”只表示 OS 接受，不表示用户已读 | notification test route + UI copy |

## 3. 关键文件 + 责任

| 文件 | 责任 |
|------|------|
| `electron/default-assistant-home.ts` | 默认目录纯解析函数 |
| `electron/main.ts`, `electron/preload.ts` | fixed-path IPC、native delivery owner 与点击 ready handshake |
| `src/lib/assistant-default-workspace.ts` | single-flight、初始化和 commit-time CAS |
| `src/lib/assistant-workspace.ts` | 模板、canonical/legacy resolver、原子 state 写入 |
| `src/lib/assistant-heartbeat.ts` | desired read、reconcile、task/desired 一致性与 outcome |
| `src/lib/task-scheduler.ts` | single task、cadence、manual/due 统一 run lock |
| `src/lib/agent-task-runner.ts` | pre-provider desired/empty gate、silent/speak-up 行为 |
| `src/app/api/settings/workspace/route.ts` | bootstrap、PATCH 顺序和 breadcrumbed summary |
| `src/lib/notification-manager.ts` | priority-to-channel policy 与 durable event creation |
| `src/app/api/tasks/notify/**` | channel-scoped claim/ack/test mutation boundary |

## 4. 改动检查表

- [ ] default bootstrap fixture 使用临时 Documents 和隔离 DB，绝不触碰真实 `~/Documents`。
- [ ] 非空、无效、离线旧路径仍保持选中，文件 hash 不变。
- [ ] bootstrap/PUT 各种 interleaving 下显式值最终胜出。
- [ ] 新模板无 framework 文件名；canonical + legacy 同存不重复注入。
- [ ] Claude Code rules ownership 改动有真实 SDK `settingSources` 证据，不靠 source shape 猜测。
- [ ] heartbeat cadence 不变时保留合法 `next_run`，改变时同 task id 重算。
- [ ] disabled/empty heartbeat 的 Provider observer 仍为 0 hit。
- [ ] native delivery 失败不能被 renderer toast 掩盖。
- [ ] Settings 不使用单个日期或客户端推断值表达 scheduler 健康。
- [ ] 文案不把 OS accepted 写成“用户已读”。

## 5. 常见坑

- 先检查 setting 为空再无条件 `setSetting`，会在初始化期间覆盖用户刚选的目录。
- 把目录初始化成功等同于用户已经完成 onboarding，或顺手创建一条假 session。
- 只让 FILE_MAP 单读一份规则，却忽略 Claude SDK 还可能原生装载 cwd `CLAUDE.md`。
- PATCH 先改 scheduler 再写 state，或 reconcile 失败后回滚用户文件，都会制造真源冲突。
- 让页面 mount/autoTrigger 重新成为 heartbeat 入口，会绕开 empty/disabled 费用门。
- 用 `Notification.show()` 方法返回代替 Electron `show` lifecycle event。
- 让 renderer 和 Main 根据窗口可见性抢同一 native 队列。

## 6. 测试覆盖

| 契约 | 测试 |
|------|------|
| Bootstrap、CAS、no-touch、neutral template | `default-assistant-bootstrap.test.ts`, `setting-compare-and-set.test.ts`, `assistant-workspace.test.ts` |
| Rules effective owner | `assistant-rules-effective-owner.test.ts` |
| Reconcile、unique、cadence、disabled/empty gate | `heartbeat-reconcile.test.ts`, `heartbeat-trigger-discipline.test.ts`, `scheduler-trigger-unification.test.ts` |
| Claim/retry、route trust、Main lifecycle/click | `notification-delivery-claim.test.ts`, `notification-claim-policy.test.ts`, `electron-notification-lifecycle.test.ts` |
| Test notification purity | `notification-test-route.test.ts` |
| 全量门禁 | `npm run test`, `npm run build` |

## 7. 设计决策日志

- 2026-08-03 — 新用户获得 Electron Documents 下的默认助理；旧用户任意非空路径 no-touch。
- 2026-08-03 — 新规则文件改为 `instructions.md`，legacy 文件只读兼容；真实 Claude CLI 证明 project `CLAUDE.md` 会由 SDK 原生加载，因此只在该精确 owner 条件下省略 CodePilot rules。
- 2026-08-03 — heartbeat 收敛为 scheduler 单入口，desired-first + execution-time gate 同时保护一致性和模型费用。
- 2026-08-03 — native delivery 改为 Electron Main 单 owner 的 durable claim/ack；设置页的测试入口不产生模型或聊天副作用。
