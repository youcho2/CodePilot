# 跨 Runtime 权限模式：按规则询问 / 替我审批 / 完全访问

> 创建时间：2026-07-17
> 最后更新：2026-07-17
> 状态：📋 调研完成，待 Claude Code 实施
> 风险等级：Tier 2（权限边界 / Runtime）
> 事实基线：[基础体验更新事实基线](../../research/foundation-experience-refresh-2026-07-17.md)

## 用户问题与争议

当前会话权限选择只有“默认”和“完全访问”。用户希望 Codex 与 Claude Code 都能提供上游已经支持的 auto——由 Runtime 替用户逐项审批，而不是关闭所有权限检查；并要求评估 AI SDK Native 是否能同步。

关键取舍：**替我审批是 reviewer，完全访问是 bypass，两者不能共享实现或文案。** Claude/Codex 有上游原语；AI SDK Native 没有现成的 session-level auto reviewer，必须 POC 后再宣称支持。

## 状态

| Phase | 内容 | 状态 | 用户能看到什么 |
|---|---|---|---|
| Phase 0 | 统一权限语义与事件合同 | 📋 待开始 | 三个选项的风险和行为清晰、不互相冒充 |
| Phase 1 | Claude Code auto | 📋 待开始 | 会话可选“替我审批”，SDK reviewer 批准/拒绝可见 |
| Phase 2 | Codex auto | 📋 待开始 | Codex thread 使用 auto reviewer，而非完全访问 |
| Phase 3 | Native AI SDK POC/实现 | 📋 待开始 | 支持则提供同义选项；不支持则诚实标记 |
| Phase 4 | 继承、Bridge、后台任务与回归 | 📋 待开始 | 前台/后台/远程路径不绕过用户选择 |

## Phase 0：语义合同

推荐 canonical profile（UI 文案不直接复用存储枚举）：

- `default` / **需要时询问我**：安全操作直接执行，有风险的操作先征求用户同意。
- `auto_review` / **替我审批**：把本来需要用户确认的请求交给受限 reviewer；仍受 workspace/sandbox 约束，拒绝、超时或 reviewer 不可用均 fail closed。
- `full_access`：跳过确认；危险选项，保留二次确认和醒目状态。

执行前必须复核当前 `default -> acceptEdits` 的实际语义；如果默认已自动接受写文件，UI 的“按确认规则执行”不能继续含糊。

### 执行清单

- [ ] 扩展共享类型、API validation、session create/update、task inheritance、worktree derive、bridge 和 UI union；同时收紧 `src/types/index.ts:735` 处宽松的 `permission_profile?: string` 声明。
- [ ] 定义 canonical runtime event：review requested / approved / denied / unavailable / timeout，含 reviewer source breadcrumb。
- [ ] Plan mode 始终优先，不因 auto_review/full_access 获得执行能力。
- [ ] AskUserQuestion、credential、外部发布/付费/高影响操作列为不可由 generic reviewer 自动批准的 human-only 类别。
- [ ] 权限选择变化只影响后续请求；in-flight prompt 的处理规则必须明确并测试。

## Phase 1：Claude Code

- [ ] 将 `auto_review` 映射到 Agent SDK `permissionMode: 'auto'`，不设置 dangerous bypass flag。
- [ ] 先审计并收窄 bare `allowedTools`：mutating MCP / notification / CLI / dashboard 不能在 classifier 前被整组自动批准。
- [ ] SDK 不支持/版本过低时禁用选项并解释，不静默回落为 full access 或 acceptEdits。
- [ ] 把 SDK reviewer 决策映射到 canonical audit event；UI 能区分“模型代审拒绝”和“用户拒绝”。
- [ ] 复核 DB provider、env provider、resume、headless task、heartbeat 的 settingSources 和权限继承。

## Phase 2：Codex

- [ ] 从当前 app-server 生成 schema/官方文档确认 camelCase enum、`approvals_reviewer` per-thread override 和最低支持版本。
- [ ] 每个 `turn/start` 显式传 `approvalPolicy + sandboxPolicy`；`thread/start/resume` 同源设置初始默认，解决切档后立即发送和 stale resume。
- [ ] `auto_review` 使用 on-request + auto reviewer + workspaceWrite；`full_access` 必须同时使用 never + dangerFullAccess，绝不共用开关。
- [ ] 禁止调用会写用户全局 `~/.codex/config.toml` 的接口；per-thread reviewer override 不被支持时显示不可用/要求升级。
- [ ] thread start/resume 都携带一致配置；profile 变化时旧 thread 不得保留 stale permission policy，需重新配置或新建 thread。
- [ ] 现有 command/file approval、permissions request、MCP elicitation 都纳入矩阵；未知类型 fail closed。
- [ ] 修正 `item/permissions/requestApproval` 的 response 合同：当前已映射为真实审批 prompt（`src/lib/codex/event-mapper.ts:773-786`），但批准/拒绝统一返回 `{ decision }`（`src/lib/codex/approval-bridge.ts:275-293`），与注释所述 permissions + scope / GrantedPermissionProfile 形状疑似不符——必须 live 验证上游是否接受该形状，按 schema 修正，并同步清理 `runtime.ts:401-405`、`approval-bridge.ts:264-268` 的过时"等效 decline"注释。
- [ ] UI/API 只在 app-server 声明支持时显示可用，不根据 Codex brand 猜测。

## Phase 3：AI SDK Native

### POC 问题

- AI SDK 的两种审批入口——agent 级 `toolApproval` 与工具级 `needsApproval`——各自能否无损接入现有 permission registry、暂停/恢复与 HMAC/nonce 防重放？POC 需评估两种入口后选定 Native 接入点。
- reviewer 使用哪个模型、哪些输入、是否允许工具、如何限制成本/延迟？
- reviewer prompt 如何抵抗 tool name/input 中的提示词注入？
- 如何保证未知工具、解析失败、timeout、provider failure 全部拒绝？

### 实施门槛

- [ ] reviewer 仅看到结构化、最小化的 permission facts，不读取 secrets、完整对话或工具输出。
- [ ] deny-by-default，固定输出 schema，禁 tools/MCP/network，短 timeout，per-session 有界并发。
- [ ] 高风险类别 human-only；规则层明确 auto-safe 的读操作无需浪费 reviewer 调用。
- [ ] 若 POC 不满足安全/延迟门槛，Native 明确显示“不支持替我审批”，保留 default/full_access。

## Phase 4：验证与 Guardrail

- [ ] 单测 profile validation、DB roundtrip、session/worktree/task inheritance、profile 切换。
- [ ] Runtime contract：Claude/Codex/Native 对 approve/deny/timeout/unavailable 的 canonical event 一致。
- [ ] 表驱动断言 3 Runtime × 3 profile × plan/code 的具体 wire options，禁止只测 UI label。
- [ ] 反例：auto reviewer 不得批准 credential、付费、发布、删除/越界写、未知 permission kind。
- [ ] 反例：full_access 不能改变 Plan mode；auto_review 不能设置 bypass flag。
- [ ] 反例：Claude auto 下 mutating MCP 不在 bare allowlist；Codex reviewer 变化不保留 stale thread snapshot。
- [ ] Bridge/IM 与后台任务不得因没有前台 UI 而自动升级到 full_access。
- [ ] `npm run test` + 三 Runtime 真实 smoke；权限相关日志做脱敏审查。
- [ ] 更新 permission guardrail / handover，记录 source breadcrumb 与版本门槛。

## 验收标准

- 用户能准确预测三个权限选项；“替我审批”任何路径都不是 blanket allow。
- Claude/Codex reviewer 的每次批准或拒绝可审计、可区分来源。
- Runtime 不支持时显式说明，不做跨模式静默降级。
- reviewer 错误、timeout、未知类型全部 fail closed。
- profile 在新会话、既有会话、resume、task、worktree、Bridge 路径一致。

## Smoke Ledger

| Date | Runtime | Provider | Model | 凭据形态 | 场景 | Result | Evidence |
|---|---|---|---|---|---|---|---|
| _待跑_ | claude_code | Anthropic/env | current supported | login/key | auto approve + auto deny + human-only | 📋 | |
| _待跑_ | codex_runtime | Codex Account | current supported | login | auto reviewer + command/file/MCP | 📋 | |
| _待跑_ | codepilot_runtime | same-session provider | supported | key | POC fail-closed matrix | 📋 | |
| _待跑_ | bridge / 后台 task | any | any | any | 无前台 UI 路径不自动升级权限（Phase 4 反例） | 📋 | |

## 决策日志

- 2026-07-17：确认 Claude Agent SDK 0.2.111 类型已包含 `permissionMode: 'auto'`；列为直接适配，不复刻 reviewer。
- 2026-07-17：确认 AI SDK 7 tool approval 不是 session-level auto reviewer；Native 必须先 POC，不能为了 UI 对齐把 tool approval disabled 当 auto。
- 2026-07-17：采用三档 canonical profile；Plan mode和 human-only 操作保持更高优先级。
- 2026-07-17：Codex 采用 per-turn 权限两轴 + thread 初始默认；reviewer per-thread config 必须 live probe，不写用户全局 config。
- 2026-07-17：Claude 接 auto 前先收窄 bare `allowedTools`，否则 classifier 会被绕过。
- 2026-07-17（审查裁决）：Claude Code 审查发现 `item/permissions/requestApproval` 现状描述过时（P2-1 接受）——已弹真实审批但 response 统一返回 `{ decision }` 形状疑似错误，Phase 2 基线由"等效 decline"改写为"live 验证 + 修正形状"。Native POC 需同时评估 agent 级 `toolApproval` 与工具级 `needsApproval` 两种入口（AI SDK 7.0.11 两者均支持）。Smoke Ledger 补 Bridge/后台任务反例行。
