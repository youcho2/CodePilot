# 自动会话命名

> 创建时间：2026-07-17
> 最后更新：2026-07-17
> 状态：📋 调研完成，待 Claude Code 实施
> 事实基线：[基础体验更新事实基线](../../research/foundation-experience-refresh-2026-07-17.md)

## 用户问题与取舍

用户希望聊天会话自动获得简洁、有语义的名称。当前并非完全没有自动命名，而是两条不一致的“首消息截 50 字”逻辑；标题更新也不能可靠同步到顶部和侧栏。

本计划先修标题事实源与竞态，再加模型生成。语义生成不能阻塞主回答，不能跨 provider 发送内容，不能覆盖手动/系统/导入标题。

## 状态

| Phase | 内容 | 状态 | 用户能看到什么 |
|---|---|---|---|
| Phase 0 | fallback 与 UI 同步统一 | 📋 待开始 | 首次发送后顶部/侧栏立即出现一致标题 |
| Phase 1 | title provenance 与原子更新 | 📋 待开始 | 手动改名永远不会被后台生成覆盖 |
| Phase 2 | 同 Provider 语义生成 | 📋 待开始 | 首轮完成后标题自动变成简洁摘要 |
| Phase 3 | Runtime 镜像、设置与观测 | 📋 待开始 | 可控、可诊断，不影响聊天主链路 |

## Phase 0：统一确定性 fallback

### 不做什么

- 不在创建 session 时和 chat route 各保留一套截断规则。
- 不用 expanded skill prompt、附件路径或隐藏元数据做标题。
- 不改 Bridge、task、heartbeat、worktree 的显式标题；import 标题可复用统一截断纯函数（其现有截断逻辑是第三条链路），但 origin 记为 `import`，不参与语义重命名。

### 执行清单

- [ ] 抽纯函数 `conversation-title`：输入用户可见文本，做 trim、单行化、Unicode/grapheme 安全截断和统一省略号；三条现有截断链路（`src/app/chat/page.tsx:864`、`src/app/api/chat/route.ts:355-359`、`src/app/api/claude-sessions/import/route.ts:50-56`）全部收编。
- [ ] 所有普通用户新会话先以 placeholder 创建，首条真实、非 autoTrigger 消息持久化后写 fallback。
- [ ] 优先使用 `displayOverride || content`；剥离附件 metadata，不读取文件内容或路径。现状两条主链路截断都基于发给模型的 `content` 全文（可能含 `[Referenced Directories]` 等隐藏展开段），属于本项要修复的隐私瑕疵。
- [ ] PATCH 重命名统一 trim、空值、长度与控制字符校验。
- [ ] 增加 `session_title` SSE/event 或完成后定向 re-fetch；顶部、侧栏、split view 同步，不依赖 5 秒轮询。

## Phase 1：provenance 与 CAS

推荐增加 `title_origin`：`placeholder | fallback | generated | manual | system | import`，以及必要的 generation claim/attempt 字段或等价原子状态。

- [ ] 手动 PATCH 与系统/导入创建原子写入 origin。
- [ ] 生成结果只允许 `fallback -> generated`；manual/system/import 不可被覆盖。
- [ ] per-session single-flight；session 删除、第二个结果、过期 claim 都 no-op。
- [ ] migration、类型、API、import/export、worktree derive 统一回归。

如果首版拒绝 schema 变更，只能用 expected-title CAS 作为有界降级，并必须在计划注明“用户手动改回相同 fallback”仍可能被覆盖；该方案不作为长期完成态。

## Phase 2：同 Provider 语义生成

### 生成合同

- 触发：首轮 assistant 正常结束后后台执行，不阻塞首 token/完成事件。
- 输入：仅首条可见用户文本；不含附件内容/路径、system、thinking、tool result、memory 或完整历史。
- Provider：只能当前 session provider；无可用安全通道就保留 fallback。禁止使用会扫描其他 provider 的 auxiliary fallback。
- 调用：每 session 最多一次；12–20 output tokens；禁 tools/MCP/network/reasoning；5–10 秒 timeout；全局并发 1–2。
- 输出：纯函数清洗引号、Markdown、换行、控制字符和超长文本；空/异常输出丢弃。
- 失败：静默保留 fallback，不弹 toast，不无限重试。

### Runtime 策略

- Claude Code：可复用无 session/tools/history 的轻量 SDK 调用，但必须固定同 provider。
- Native：使用同 provider text generator 的无工具路径。
- Codex Account：首版不额外开启 agent turn；先保留 fallback。未来有专用安全生成通道再启用。

## Phase 3：镜像、设置与观测

- [ ] 本地 DB title 始终 canonical；Codex thread 已存在时可 best-effort `thread/name/set`，失败不回滚。
- [ ] 评估“自动生成标题”设置与手动“重新生成”；默认值由用户决定后再实现。
- [ ] telemetry 只记 outcome、provider/model、source、latency，不记 prompt/title 原文。
- [ ] 观察生成延迟、失败率、手动覆盖率和 provider 限流影响，再决定是否支持重试或更多 Runtime。

## 验证矩阵

- [ ] 纯函数：中英/CJK/emoji grapheme、Markdown、多行、空白、超长、控制字符、引号、prompt injection 文本。
- [ ] 路由：仅首条真实用户消息触发；autoTrigger/heartbeat/task/import/bridge/worktree 不触发；`displayOverride` 优先。
- [ ] 隐私：附件 metadata/路径、hidden expansion、system/thinking/tool result 不进入生成输入；不得换 provider。
- [ ] DB race：manual rename in-flight 必胜；两个结果只写一个；timeout/删除 session 保留 fallback/no-op。
- [ ] UI/E2E：首发后顶部与侧栏立即 fallback，随后 generated 更新；刷新后一致；生成中改名不被覆盖。
- [ ] 成本/并发：每 session <= 1 次；全局有界；主回答不等待命名。
- [ ] `npm run test`；涉及 schema 时按 Tier 2 补 migration/rollback/导入导出测试。

## 验收标准

- 首条消息后不再长期显示 `New Chat`，所有入口使用同一 fallback 规则。
- 语义标题失败不影响消息发送、流式输出和 session 创建。
- 手动、系统、导入标题永不被异步生成覆盖。
- 不发生跨 provider 内容发送，且标题 prompt 不包含隐藏/敏感上下文。
- 标题更新即时同步到所有可见入口。

## Smoke Ledger

| Date | Runtime | Provider | Model | 凭据形态 | 场景 | Result | Evidence |
|---|---|---|---|---|---|---|---|
| _待跑_ | claude_code | same-session provider | small/current | key/login | first turn → fallback → generated | 📋 | |
| _待跑_ | codepilot_runtime | same-session provider | small/current | key | timeout/failure → fallback | 📋 | |
| _待跑_ | any | any | any | any | generation in-flight → manual rename | 📋 | |

## 决策日志

- 2026-07-17：调研确认当前已有两套 50 字截断逻辑；Phase 0 先统一事实源和 UI 同步，语义生成后置。
- 2026-07-17：本地 DB title 定为 canonical；Codex thread name 仅 best-effort 镜像。
- 2026-07-17：禁止复用跨 provider auxiliary fallback；隐私和手动改名优先于标题生成成功率。
- 2026-07-17（审查裁决）：确认截断链路实为三条（含 claude-sessions import），统一纯函数一并收编；import 标题 origin 记 `import`、不参与语义重命名。现状标题基于 `content` 而非 `displayOverride`，列为隐私修复点。

