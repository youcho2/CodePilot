# 基础体验更新事实基线：模型、推理强度、权限与会话命名

> 日期：2026-07-17
> 性质：当前代码 + 官方资料 + 本地只读 POC 的调研基线；实现进度以关联 active plans 为准。
> 关联计划：[模型目录与推理强度](../exec-plans/active/model-capability-reasoning-refresh.md) · [跨 Runtime 权限模式](../exec-plans/active/runtime-permission-modes.md) · [自动会话命名](../exec-plans/active/automatic-chat-titles.md)

## 结论摘要

1. **推理强度控件不是从零开发。** `MessageInput` 已在模型声明 `supportsEffort` 时把强度选择器放在模型选择器右侧；当前问题主要是模型目录、能力元数据和 Runtime wire contract 漂移。
2. **GLM-5.2、Kimi for Coding（最新模型渠道）、GPT-5.6、Claude Sonnet 5 都有正式官方依据。** 但不同供应商支持的档位不同，不能用一个固定的 Low/Medium/High/Max 菜单伪造统一能力。
3. **Codex 当前有两个模型入口。** `codex_account` 动态读取 app-server `model/list`；旧 `openai-oauth` 仍是硬编码目录。二者必须收敛，否则同为“OpenAI/Codex”却看到不同模型。
4. **“替我审批”不能等同于完全访问。** Claude Agent SDK 已有 `permissionMode: 'auto'`；Codex 有 approval policy + auto reviewer；AI SDK Native 只有 per-tool approval primitives，需要 CodePilot 自建 reviewer 才能提供同等语义。
5. **当前已有自动标题，但只是首消息截断。** 新对话存在两条不一致的 50 字截断链路；语义命名前必须先统一标题事实源、UI 刷新和手动改名优先级。

## 建议迭代编排

| 迭代 | 必做范围 | 可并行项 | 退出条件 |
|---|---|---|---|
| Iteration A：事实源与基础一致性 | 模型计划 Phase 0（Codex schema / GPT-5.6）+ Phase 1（GLM/Kimi 目录）；标题 Phase 0；权限 Phase 0 live schema / contract POC | Sonnet 5 contract 准备 | UI 不再读取空 capability；标题即时同步；权限三档有可验证 wire mapping |
| Iteration B：用户能力落地 | Sonnet 5；Claude/Codex auto reviewer；标题 provenance + 同 provider 语义生成 | 真实凭据 smoke 可按 provider 分批 | 三条主路径各有反例测试和 smoke；不支持的 Runtime 明确降级 |
| Iteration C：长期收敛 | Native reviewer 是否实施；capability normalization / upstream fixture；标题设置与观测 | 可按使用数据决定是否进入 | reviewer 安全门槛通过，或正式记录 Native 不支持；上游变化有 drift guardrail |

Iteration A 不应被“做统一抽象”拖住：先修已出现的 Codex schema drift 和旧目录。Iteration B 才把用户可见能力完整铺开。Native reviewer 风险最高，保留到 POC 结论明确之后。

## 模型与推理强度

| 渠道 / 模型 | 官方事实 | 当前仓库事实 | 计划结论 |
|---|---|---|---|
| GLM-5.2 | GLM Coding Plan 已提供 GLM-5.2；Claude Code `/effort` 中 low/medium/high 映射为 high，xhigh/max/ultracode 映射为 max | GLM CN/Global 仍以 GLM-5-Turbo / GLM-5.1 为目录，且无 effort capability | 更新目录与 role mapping；UI 只表达真实有效档位 high/max，并说明映射，不展示伪精度 |
| Kimi for Coding | Kimi Code 概览把 `kimi-for-coding` 定义为稳定渠道 ID，后端随模型升级自动更新（K3 已于 2026-07-16 发布）；推理强度官方现状：仅 K3 支持、唯一可配值 max（low/high 标为后续），K3 文档写明 null/undefined → max；官方概览与模型配置页对 `kimi-for-coding` 底层版本描述互相冲突 | Kimi Coding Plan 仍显示旧底层模型名，只有 `sonnet` alias，无 upstream/capability source breadcrumb | 默认请求使用 `kimi-for-coding`，用户界面只显示 `Kimi for Coding`；不展示或跟踪 K3 等底层版本。强度菜单当前只显示 Auto/Max；Auto 是 CodePilot"不显式指定"语义（非官方档位），实际落点以 live smoke 定案 |
| GPT-5.6 | GPT-5.6 Sol/Terra/Luna 已发布；API 档位包含 none/low/medium/high/xhigh/max；Codex 侧可有额外产品档位 | `openai-oauth` 目录停在 5.5；`codex_account` 动态目录方向正确，但 app-server schema 已漂移；Runtime 仍把 xhigh/max 降为 high | 以 app-server `model/list` 为 Codex Account 真源；兼容新旧 schema；按模型 allowlist 透传，不再全局 clamp；Codex 专属 `ultra` 不冒充普通 API effort |
| Claude Sonnet 5 | `claude-sonnet-5` 已发布，1M context，adaptive thinking；manual extended thinking 不再支持 | Sonnet 5 未进入 catalog / model context / sanitizer | 作为完整模型契约接入，不能只加下拉条目；同步 thinking、sampling、context 与回归测试 |
| Claude Fable 5 | `claude-fable-5` 已 GA，1M context，adaptive thinking always-on，支持 effort | catalog、context、sanitizer 和测试已有接入 | 作为已存在基线重新做真实请求验证，不重复造第二套入口 |

### Codex 本地只读 POC

使用应用内 `/Applications/ChatGPT.app/Contents/Resources/codex`（`codex-cli 0.144.2`）和隔离的临时 `CODEX_HOME` 运行 `initialize + model/list`，未读取用户凭据：

- 返回 `gpt-5.6-sol`（默认）、`gpt-5.6-terra`、`gpt-5.6-luna`，以及 5.5 / 5.4 / 5.4-mini / 5.2。
- GPT-5.6 Sol 返回 low / medium / high / xhigh / max / ultra，默认 low。
- 当前响应元素字段是 `{ reasoningEffort, description }`；仓库 `src/lib/codex/models.ts` 仍读取 `e.effort`。因此模型可被发现，但能力列表会变成空值。
- 此 POC 证明当前二进制的目录能力，不证明每个真实账号的 entitlement；产品仍需对版本、登录状态和 rollout 差异诚实降级。

### 仓库关键触点

- 能力门禁与控件位置：`src/components/chat/MessageInput.tsx:1053-1055,1217-1222`。
- Codex 动态目录与 schema 漂移：`src/lib/codex/models.ts:66-97,151-160`。
- 旧 OAuth 硬编码目录：`src/app/api/providers/models/route.ts:15-24,353-362`。
- Codex 全局 effort clamp：`src/lib/codex/effort.ts:23-43`、`src/lib/codex/runtime.ts:934-951`。
- GLM/Kimi 旧目录：`src/lib/provider-catalog.ts:558-635`。
- Claude 现有目录与 Fable：`src/lib/provider-catalog.ts:348-424`。
- effort 菜单硬编码五档回退（伪档位来源，须随 Phase 0 收编）：`src/components/chat/EffortSelectorDropdown.tsx:36`。
- Native 路径对 adaptive 家族丢弃显式 effort（catalog 声明五档但实际不下发，模型计划 Phase 2 裁决）：`src/lib/agent-loop.ts:408-425`。

### Kimi 稳定渠道产品契约

Kimi 官方概览把 `kimi-for-coding` 定义为稳定渠道 ID，并明确后端会随着模型升级更新映射，客户端无需改配置。CodePilot 据此采用更简单的产品合同：

- 用户只选择和看到 `Kimi for Coding`，它始终表示该渠道当前提供的最新模型。
- 请求固定使用上游稳定 ID `kimi-for-coding`，不新增显式 `k3` 内置模型项。
- 不把 API/SDK 返回的底层版本改写成用户可见模型名，也不为底层版本切换增加兼容分支。
- 推理强度与底层模型名解耦，按 `Kimi for Coding` 渠道当前的 capability 决定菜单；现阶段为 Auto/Max。Auto 是 CodePilot 的"不显式指定"选项（不下发 effort），不是 Kimi 官方档位；官方现状为仅 K3 支持、唯一可配值 max，K3 文档写明 null/undefined → max，但官方概览与模型配置页对该渠道底层版本描述互相冲突——Auto 是否实际落到 Max 以真实 smoke 定案。effort 下发链路需验证 Agent SDK `queryOptions.effort` 与 `CLAUDE_CODE_EFFORT_LEVEL` env override 的优先级与 Kimi 兼容性，不预设 env-only。

因此，Kimi 后端升级底层模型时无需修改 CodePilot 模型目录；只有渠道 ID 或用户可见能力合同变化时才需要跟进。

## 权限模式

### 语义分层

| 用户选项 | 执行语义 | Claude Code | Codex | CodePilot Native |
|---|---|---|---|---|
| 需要时询问我 | 安全规则可自动通过，其余请求用户确认 | SDK `default`；当前仓库实际传 `acceptEdits`，行为比文案更宽 | approval policy `on-request` + reviewer `user`，保留 workspace sandbox | 现有 permission registry + rule engine |
| 替我审批 | Runtime 的 reviewer 对请求逐项批准/拒绝；不是 blanket allow | SDK `permissionMode: 'auto'`（0.2.111 类型已包含） | `approval_policy=on-request` + `approvals_reviewer=auto_review` 的等价配置 | AI SDK 7 无 session-level reviewer；只有 tool `needsApproval`，需 CodePilot 自建且先 POC |
| 完全访问 | 跳过权限检查，危险且需二次确认 | `bypassPermissions` + dangerous flag | danger-full-access / never-ask 等价组合，具体 wire 以 app-server schema 为准 | 现有 `bypassPermissions` |

当前 DB 字段只有 `default | full_access` 的产品语义；前端、API、task inheritance、bridge、permission prompt 都写死了二元 union。Codex Runtime 当前也没有按 `permission_profile` 生成 thread config。引入 `auto_review` 是跨 Runtime 的 Tier 2 权限改动，不是只加一个菜单项。

Codex 的 approval 与 sandbox 是两条独立轴：每个 `turn/start` 应显式携带 `approvalPolicy` + `sandboxPolicy`，`thread/start/resume` 同时设置初始默认；`approvals_reviewer=auto_review` 需先用最低支持版本验证能否作为 per-thread config override。禁止用会写用户全局配置的接口模拟 session 选项。

Claude 还有一个前置风险：当前 bare `allowedTools` 会在 permission mode / callback 之前自动批准整组工具。接 `permissionMode: 'auto'` 前必须把 mutating MCP 从 bare allowlist 移出，否则 reviewer 根本看不到这些请求。

### AI SDK 7 判断

仓库已经升级到 `ai ^7.0.11`、`@ai-sdk/anthropic ^4.0.5`、`@ai-sdk/openai ^4.0.5`。AI SDK 的 tool approval（agent 级 `toolApproval` 与工具级 `needsApproval` 两种入口，POC 需评估后选定接入点）可以表达“这个调用需要批准”和 approval round-trip，但不会替 CodePilot 提供 Claude/Codex 那种模型审批器。因此计划中 Native 分支必须满足二选一：

- 实现受限、可审计、fail-closed 的 reviewer；或
- UI 明确标记当前 Runtime 不支持“替我审批”，回退到按规则询问。

不得为了界面一致把 `needsApproval: false` 当成 auto reviewer。

## 自动会话命名

### 当前事实

- 新对话直接发送：`src/app/chat/page.tsx:861-875` 创建 session 时用 `content.slice(0, 50)`。
- 先创建空会话再发送：DB 默认 `New Chat`，首个真实用户消息后由 `src/app/api/chat/route.ts:353-359` 截断 50 字。
- 两条路径的省略号、刷新时机和事件通知不一致；顶部标题可能停留在 `New Chat`，侧栏最多等轮询刷新。
- 第三条截断链路：导入会话 `src/app/api/claude-sessions/import/route.ts:50-56` 同样 slice(0,50)+省略号，应一并收编进统一纯函数（origin 记 `import`，不参与语义重命名）。
- 现有主链路截断基于发给模型的 `content` 全文而非 `displayOverride`，标题可能包含 `[Referenced Directories]` 等隐藏展开段（隐私瑕疵，Phase 0 修复）。
- 系统会话（Bridge / task / heartbeat / worktree）和导入会话已有显式标题，不应被自动生成覆盖。
- `updateSessionTitle` 是无条件 UPDATE，当前没有 `title_origin`、claim 或 CAS；异步生成会覆盖用户手动改名。

### 推荐合同

1. 首条真实、可见、非 autoTrigger 用户消息持久化后，立即生成确定性 fallback 标题。
2. 语义标题在首轮主回答完成后后台生成，不阻塞正文首 token。
3. 标题 prompt 只使用用户可见文本（优先 `displayOverride`），不读取附件内容/路径、system prompt、thinking、tool result 或隐藏的 skill expansion。
4. 只使用当前 session 的 provider；禁止复用会跨 provider 回退的 auxiliary resolver。
5. 增加 title provenance + 原子更新：只允许 `fallback -> generated`，manual/system/import 永远不可被异步结果覆盖。
6. 超时、离线、限流、空输出都静默保留 fallback；每 session 最多一次、禁 tools/MCP/联网/高推理。
7. 本地 `chat_sessions.title` 是 canonical；如需同步 Codex thread，只做 `thread/name/set` best effort，失败不回滚本地标题。

## 官方来源

- [GLM-5.2 模型](https://docs.bigmodel.cn/cn/guide/models/text/glm-5.2)
- [GLM Claude Code 适配与 effort 映射](https://docs.bigmodel.cn/cn/guide/develop/claude)
- [Kimi Code 概览（稳定渠道 ID 与持续模型升级）](https://www.kimi.com/code/docs/)
- [OpenAI 模型目录（GPT-5.6）](https://developers.openai.com/api/docs/models)
- [Claude 最新模型总览](https://platform.claude.com/docs/en/about-claude/models/overview)
- [Claude Sonnet 5 迁移说明](https://platform.claude.com/docs/en/about-claude/models/whats-new-sonnet-5)
- [Claude effort](https://platform.claude.com/docs/en/build-with-claude/effort)
- [AI SDK Tool Approvals](https://ai-sdk.dev/docs/agents/tool-approvals)
- [Codex 配置参考（approval / reviewer / sandbox）](https://learn.chatgpt.com/docs/config-file/config-reference)（原 developers.openai.com/codex/* 已 308 迁移至 learn.chatgpt.com/docs/*）
- [Codex app-server API](https://developers.openai.com/codex/app-server/)（同上，已迁移至 learn.chatgpt.com/docs/*）
- [Claude Agent SDK permissions](https://code.claude.com/docs/en/agent-sdk/permissions)（原 platform.claude.com 路径已 307 迁移）
- [Codex app-server README](https://github.com/openai/codex/blob/main/codex-rs/app-server/README.md)

## 尚待真实凭据验证

- GLM-5.2 CN / Global Coding Plan 的 alias、`[1m]` 变体和两档 wire 映射。
- Kimi for Coding 在 CodePilot Claude Code proxy 路径的稳定 ID、固定展示名、Auto/Max wire/default 和缓存失效提示；确认底层模型版本不会进入用户可见目录；`queryOptions.effort` 与 `CLAUDE_CODE_EFFORT_LEVEL` 的优先级及 Auto 实际落点（是否 Max）。
- GPT-5.6 在真实 Codex Account 登录下的 entitlement、全部 reasoning levels 和 turn/start 参数。
- Sonnet 5 / Fable 5 在 Claude Code 与 Native 两条路径的 thinking/effort/sampling 请求形状。
- Claude/Codex auto reviewer 的批准、拒绝、超时、不可用和审计事件。
- Codex `item/permissions/requestApproval` 的 response 形状：当前统一返回 `{ decision }`（`approval-bridge.ts:275-293`）是否被上游接受；GrantedPermissionProfile 的正确形状。
