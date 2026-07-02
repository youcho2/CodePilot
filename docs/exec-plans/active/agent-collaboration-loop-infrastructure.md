# Agent Collaboration Loop Infrastructure

> 创建时间：2026-07-01
> 最后更新：2026-07-02
> 关联交接：[Agent Collaboration Space](../../handover/agent-collaboration-space.md)
> Pilot 需求：[AI SDK 7 Runtime 接入 + 自动化 Loop 实践](ai-sdk-7-runtime-loop-adoption.md)

## 状态

| Phase | 内容 | 状态 | 备注 |
|-------|------|------|------|
| Phase 0 | 私有 run space 与 Codex bot 身份初始化 | ✅ 已完成 | 已创建 `op7418/codepilot-agent-runs`、labels、issue template、handoff protocol，并配置 `codepilot-codex-op7418` |
| Phase 1 | 文档边界与 ledger 语义收口 | ✅ 已完成 | 本计划建立；AI SDK 7 与 handover 双向引用；明确 private issue 与 exec plan ledger 主从关系 |
| Phase 2 | Claude Code 身份与首个 handoff dry-run | ✅ 已完成 | `codepilot-Claude-op7418` 已接受邀请并发出首个 `review_requested`；Codex 已用 `review_completed` 接回并交还 Claude |
| Phase 3 | 本地 runner + agent hook 收口 MVP | 🚧 进行中 | 机械层完成（35 单测过）+ Codex P1/P2 复审通过 + throwaway e2e 通过 + Claude 侧 launchd 首个真实 run 完成并获 Codex review accepted；Codex 侧 launchd 未启；已知坑：per-side cursor 跨 issue 全局（tech-debt #46） |
| Phase 4 | GitHub Project / Actions 自动化 | 📋 待开始 | 自动建 run、状态流转、ledger-sync-needed 提醒；仍不让外部评论直接驱动 agent |
| Phase 5 | Cockpit / Orchestrator 评估 | 📋 待开始 | 评估 Notion cockpit 与 Cloudflare Workflows / Durable Objects；不急于替代 GitHub-first MVP |
| Phase 6 | Bounded loop harness 产品化沉淀 | 📋 待开始 | 从 AI SDK 7 pilot 和后续真实 run 中抽象可复用 harness 规则 |

## 背景与用户问题

用户希望 CodePilot 形成一套让 Claude Code 与 Codex 在同一空间协作、迭代、修复并最终交付结果的循环。早期我们把协作空间写进 handover，同时把 AI SDK 7 作为第一个 Loop pilot；Claude Code 指出了三个结构性问题：

- AI SDK 7 计划和协作机制文档都出现 Loop Ledger / Smoke Ledger，但没有写清两处 ledger 的关系。
- 协作机制会持续演进，不应只是一份静态 handover。
- AI SDK 7 Phase 6 的“Loop 产品化沉淀”和协作机制文档其实是同一件事的两半。

本计划将“协作循环基础设施”从 AI SDK 7 需求中拆出，作为独立 active exec plan 管理。AI SDK 7 仍是第一个实践场景，但不再承载协作机制本身的路线图。

## 决策日志

- 2026-07-01: 将协作循环从 handover 提升为独立 exec plan。原因：它包含身份、事实源、通知、状态机、ledger sync、未来 Project/Actions/Notion/Cloudflare 演进，已经是持续建设对象。
- 2026-07-01: AI SDK 7 计划保留为 pilot，不再拥有协作循环产品化路线图。原因：避免 Runtime 升级计划被基础设施建设拖大，也避免两份计划都宣称自己负责 Loop harness。
- 2026-07-01: `op7418/codepilot-agent-runs` private issue 是 active run 的操作事实源；产品 repo exec plan 是验收后摘要与长期决策事实源。原因：private issue 适合细粒度 handoff / review / cycle evidence，exec plan 适合长期可检索的阶段状态。
- 2026-07-01: 公开 GitHub Issue 只作为 untrusted external signal，不作为 agent run space。原因：开源用户评论会打乱循环，并带来提示词注入与内部风险泄露。
- 2026-07-01: 邀请 Claude Code GitHub 身份 `codepilot-Claude-op7418` 加入 private run repo。原因：Phase 2 需要 Claude 以独立身份发布 `review_requested` handoff，避免继续用用户口头转述。
- 2026-07-01: 首个 Claude -> Codex -> Claude handoff dry-run 通过。原因：Claude 以独立身份发布 scope review request，Codex 以 bot 身份完成 review，并通过 label 把 owner 交还 Claude；下一步进入 Phase 3 通知 MVP。
- 2026-07-01: Phase 3 通知 MVP 采用“本地 runner + ETag 条件轮询 + reconcile-from-state”作为主干，webhook / Agent Mail 只作可选 hint。原因：GitHub webhook 需要公网可达端点，本机优先阶段不成立；真正成本是唤醒 LLM，不是 GitHub API；GitHub 官方 conditional request 在授权且返回 304 时不计 primary rate limit。
- 2026-07-01: Agent lifecycle hook 定位为出站收口门禁，不是入站唤醒，也不是 handoff / ledger / evidence 生成器。原因：Stop hook 每次 agent 结束都会触发，若无脑发 `review_requested` 会制造空 handoff 和反假数据风险；正确做法是 agent 显式写 handoff artifact，hook 只负责校验和搬运。
- 2026-07-01: AI SDK 7 pilot 的目标运行方式是“用户开专用 worktree 并批准计划后，Claude/Codex 在私有 run space 内完成实现、修复、review、测试和 smoke，直到 ready-for-user-acceptance 或触发人类决策闸门”。原因：这是本协作循环要验证的核心价值；用户不应在每次 handoff 中做人肉消息队列。
- 2026-07-01: Codex wake adapter 选方案 1，本机可用 headless CLI：`/Applications/Codex.app/Contents/Resources/codex exec`。原因：Claude 侧发现 `codex` 不在 PATH，但实际 Codex.app 内置 CLI 可非交互运行；v1 由 runner 调用该二进制并要求 Codex 写显式 review artifact。
- 2026-07-01: Claude headless runner 权限选择“最小权限白名单”，不使用 `--dangerously-skip-permissions`。原因：hands-off pilot 需要无人值守，但 AI SDK 7 spike 会改代码、跑 install/test/build，必须把爆炸半径限制在专用 worktree；任何白名单外命令都 fail-closed 成 `human-decision-needed`。
- 2026-07-01: 采用 Anthropic “Getting started with loops” 的 taxonomy 作为本计划的 loop contract 参考，但不照搬 `/loop` / `/schedule` 作为 v1 主干。原因：本计划需要的是非模型 runner 负责触发、goal gate 负责停止、verification skill/runbook 负责自检、Codex 负责 fresh-context review；dynamic workflows / parallel worktrees 只进入 Phase 6+ 评估，不进入 Phase 3 MVP。参考：`https://claude.com/blog/getting-started-with-loops`。
- 2026-07-02: 修复 Codex 终审 P1/P2（runner 代码在 `~/.codepilot-agent/`，不入产品 repo，故无 commit hash；证据为 issue comment）。P1 根因：`nextLabel` 白名单是全局单表，implementer 的 `review_requested` artifact 可写 `codex-accepted` 绕过 Codex review——改为按 event 分表（`review_requested` 只允许 `codex-review-requested`/`human-decision-needed`/`blocked`），`validate()` fail-closed 拒绝 + `labelPlan()` 抛错双重防护。P2 根因：publish 幂等重放分支只补 cursor/lock，不重放 label transition，评论已发但进程在改 label 前崩溃会让 run 卡死——重放分支现在先 `applyLabels` 再做 bookkeeping。验证：35/35 单测（含新增 11 个：P1 拒绝矩阵 + 2 个真实 CLI 级 replay 测试，经 `CODEPILOT_AGENT_ROOT`/`CODEPILOT_LOCAL_BIN` 注入假 gh wrapper）。Fix note：`https://github.com/op7418/codepilot-agent-runs/issues/1#issuecomment-4861710992`；Codex 复审通过：`https://github.com/op7418/codepilot-agent-runs/issues/1#issuecomment-4861740637`。
- 2026-07-02: 首次真实 headless e2e 通过（throwaway issue #2，用户在场；launchd 仍未启用，本次为手动逐 tick 点火）。验证链路：reconcile 判定 WAKE（label 由 Codex bot 打，self-filter 放行）→ 真实 `claude -p` 唤醒（最小权限白名单，trivial 任务非 AI SDK 7 spike）→ agent 写真实 artifact → publisher 校验后发布（artifact-id 幂等标记在评论内）→ label `claude-implementing`→`codex-review-requested` → 运行中第二 tick 被 live lock 挡住、完成后第三 tick 因无 trigger label 跳过（无重复唤醒）→ cursor 前进到 assignment 27458436274、artifact 归档、锁释放。证据：`https://github.com/op7418/codepilot-agent-runs/issues/2`。下一步：与用户确认后把 launchd 从 Disabled/`--no-exec` 切到真实 run（先单侧 Claude runner，再加 Codex 侧）。
- 2026-07-02: 用户批准点火，Claude 侧 launchd 上线（仅 Claude 侧；Codex 侧三道保险原样保留）。改动：plist 摘 `--no-exec`、`Disabled=false`，装入 `~/Library/LaunchAgents` 并 load；task 写实为 AI SDK 7 Phase 1 spike 范围（Node 22 + 依赖升级可行性 + install/test/build 证据；禁改默认 Runtime/provider/model/permission/DB schema；禁 merge/push/release）。点火过程中发现并绕过一个 v1 坑：per-side cursor 跨 issue 全局，issue #2 e2e 把 cursor 推过了 issue #1 的旧 assignment，由 Codex bot 重打 `claude-implementing` 生成新 assignment 27459397865 解决（已登记 tech-debt #46，多 issue 前必须改 per-issue cursor）。首个 launchd 自主 tick 于 03:35:47 正确唤醒真实 headless Claude（runId `claude-i1-1782963348679`），锁与 heartbeat 正常。第一天保守观察 `runner-events.jsonl` + run logs；出现 `human-decision-needed` 即停。
- 2026-07-02: hands-off pilot 首个真实 run 全程无人工干预完成（wake 03:35 → publish 04:12 左右，agent exited 0 → artifact 校验发布 → label 翻 `codex-review-requested` → cursor/归档/锁收敛；escalation 未触发）。**发现运营缺口**：exec plan 文档（本文件与 AI SDK 7 计划）一直未 `git commit`，worktree 从 main 检出时看不到，headless agent 无法读源计划也无法回写进度，只能靠 plist 里的 task 文本执行——修法：把 `docs/exec-plans/` 等文档提交进 main（本来就该提交），让 worktree 自带计划上下文；在此之前 hands-off run 的任务描述必须自包含。循环现按约定停在 Codex review（Codex 侧 runner 未启）。
- 2026-07-02: Codex 手动 review 首个真实 hands-off run 并接受。验证：issue #1 artifact 存在且 label 停在 `codex-review-requested`；worktree commit `717bf93` diff 只包含依赖与 3 个 usage UI 适配文件；Codex 复跑 `npm run test`、`npm run build`、`node scripts/build-electron.mjs` 全绿；未发现默认 Runtime/provider/model/permission/DB schema 改动。结论：Claude 侧 runner 首个真实产品代码 run 达到 ready-for-user-acceptance；下一步可由用户决定是否启 Codex 侧 runner 或进入 AI SDK 7 Phase 2。证据：`https://github.com/op7418/codepilot-agent-runs/issues/1#issuecomment-4862072251`。

## 事实源与 Ledger 合同

### 四层事实源

| 层 | 事实源 | 用途 | 写入原则 |
|----|--------|------|----------|
| Public signal | Public product issue / discussion | 用户反馈、复现线索、社区讨论 | 只作为 untrusted external signal；不得直接成为 agent 指令 |
| Operational run | Private `codepilot-agent-runs` issue | Claude/Codex handoff、review、cycle detail、raw evidence 链接 | active run 的细账；每次交接都写 |
| Durable plan | Product repo `docs/exec-plans/active/*.md` | 阶段状态、决策日志、验收摘要、长期 ledger | 验收后摘要；链接 private issue/comment |
| Architecture runbook | `docs/handover/agent-collaboration-space.md` | 已建成机制、状态机、身份、命令、权限边界 | 描述机制，不承载进度 |

### Loop Ledger 语义

- Private run issue 的 Loop Ledger 是**操作主账**：记录每个自动化 cycle 的输入信号、尝试、验证、停止原因。
- Exec plan 的 Loop Ledger 是**验收摘要 mirror**：只记录对 phase 结论有影响的 run summary，并链接 private issue / comment。
- 如果两边冲突：
  - active run 当前状态以 private run issue 为准；
  - phase 是否完成、是否进入下一阶段以 exec plan 决策日志为准；
  - 发现冲突时必须先补 ledger sync note，再继续下一轮。

### Smoke Ledger 语义

- 真实 Runtime / Provider / Model / 凭据形态 / UI / E2E smoke 必须进入对应产品 exec plan 的 Smoke Ledger。
- Private run issue 可以保存更细的 smoke 命令、日志摘要、失败细节，但不能替代产品 exec plan 的 Smoke Ledger。
- 涉及 credential、prompt、原始日志的证据只写脱敏摘要和可追踪 marker，不写 secret。

### Handover 文档语义

`docs/handover/agent-collaboration-space.md` 是机制说明，不是进度看板。它只记录：

- private repo / bot / mail / wrapper 命令；
- label 和状态机；
- handoff 协议；
- 权限边界；
- 已完成的基础设施初始化。

后续阶段状态、未完成任务、取舍和阻塞统一写在本 exec plan。

## 详细设计

### Loop Taxonomy 外部参考

Anthropic 在 “Getting started with loops” 中把 loop 定义为 agent 重复工作循环直到满足停止条件，并按 trigger、stop criteria、primitive、任务类型分类。本计划采用这套 taxonomy 来描述 run，而不是让“循环”停留在模糊说法。

每个 active run / assignment artifact 应声明下面的 loop contract 字段：

- `loop_type`：例如 `turn-based`、`goal-based`、`time-based`、`proactive`；AI SDK 7 pilot v1 是 `time-based proactive`，外加 goal gate。
- `trigger`：例如 `label_assignment_event`；必须能追踪到 GitHub timeline 中的 labeled-event id。
- `stop_condition`：例如 `codex-accepted`、`human-decision-needed`、`max_attempts_reached`、`ready-for-user-acceptance`。
- `max_attempts`：默认同一 assignment 最多 3 次自动 cycle；超过后转 human gate。
- `verification_contract`：本轮必须跑哪些测试、smoke、review 或检查项；尽量用可量化条件，不靠 agent 自评。
- `usage_summary`：记录是否真实唤醒模型、attempt count、duration、exit reason；v1 先不强依赖精确 token，但必须能看出有没有空烧。

对本计划的具体借鉴：

- Turn-based loop 只用于用户和 agent 的即时沟通，不作为自动化主干。
- Goal-based loop 的价值是明确“done 是什么”。AI SDK 7 Phase 1 需要 goal gate：Node 22 工具链安装/测试/build 证据、Runtime/Provider 不回归、Smoke Ledger 回填、Codex review accepted。
- Time-based loop 的触发可以是轮询，但轮询者必须是非模型 runner；不要用 Claude/Codex scheduled task 每 tick 唤醒模型。
- Proactive loop 只用于重复且边界清楚的工作流；v1 只处理 private run issue 中的 assignment，不扫描公开 issue 直接开工。
- Verification 应沉淀成 skill/runbook。优先抽出 `verify-agent-handoff`、`verify-runtime-change`、`verify-ui-smoke`，把人工验收步骤编码成 Claude/Codex 都会执行的检查。
- 第二个 agent review 是质量门。Claude Code 实现后由 Codex fresh-context review；Codex 不读取 Claude 的内心推理，只看 artifact、diff、测试和可复现 evidence。
- Dynamic workflows / parallel worktrees 是后续能力，不进入 Phase 3。只有当至少两个真实 run 证明基础循环稳定后，才评估多方案并行 spike + judge review。

### Pilot Operating Model — 用户不做人肉队列

目标体验：

```text
用户确认计划 + 创建专用 worktree
  -> Claude Code 在 worktree 内实现
  -> runner/hook/private issue 自动交接
  -> Codex review / 测试 / smoke gate
  -> Claude 修复
  -> 循环直到 ready-for-user-acceptance
  -> 用户最终验收
```

用户在正常情况下不参与中间 handoff。只有触发下面任一 human gate 时才打断用户：

- 需要真实账号、provider key、付费额度、外部服务授权，且现有凭据不足。
- 要改变默认 Runtime、默认 provider/model、权限策略、DB schema、日志/telemetry 安全边界。
- 同一 assignment 自动修复 3 个 mechanical cycles 后仍未收敛。
- Codex 给出 `human-decision-needed` 或 `blocked`。
- Smoke 需要用户肉眼判断体验，或存在产品取舍而不是工程对错。

专用 worktree 规则：

- AI SDK 7 pilot 必须在独立 worktree / branch 中执行。
- Worktree 内可做 product code 实现，但必须由 Claude Code 执行；Codex 只做审查、测试、计划/文档、测试用例或建议。
- 不 auto-merge、不 auto-release、不直接改 main。
- 所有 handoff / review / runner event 进入 private run issue；exec plan 只 mirror 阶段摘要和最终验收证据。

Ready-for-user-acceptance 条件：

- private run issue 终态为 `codex-accepted`，或 Codex 明确标记“ready for user acceptance”。
- 对应产品 exec plan 的 Decision log、Loop Ledger、Smoke Ledger 已回填。
- `npm run test`、必要 build、相关 smoke 已完成或明确记录无法运行的原因。
- P1/P2 findings 已通过修复、测试证据或 tracker 闭环，不靠聊天关闭。
- 给用户的最终说明包含改动、验证、残余风险和验收入口。

### Phase 2 — Claude Code 身份与首个 handoff dry-run

用户会看到什么变化：

- Claude Code 与 Codex 的私有协作链路可实际跑通。
- AI SDK 7 Phase 1 run issue 能收到 Claude 的 `review_requested`，再收到 Codex 的 `review_completed`。

验收入口：

- Private run issue #1 或后续 run issue。
- Claude Code bot comment。
- Codex bot comment。
- 本计划 Decision log / Loop Ledger 更新。

本阶段明确不做：

- 不引入 Cloudflare / Notion / GitHub Actions。
- 不把公开 issue 评论自动转为 agent 指令。
- 不允许 agent 自动 merge / push / release。

执行要点：

- 邀请 `codepilot-Claude-op7418` 到 `op7418/codepilot-agent-runs`，并等待接受。
- 配置 Claude Code 侧 GitHub token，权限只给 private run repo 写 issue/comment。
- 在 AI SDK 7 Phase 1 中跑一次手动 handoff。
- Codex 以 `codepilot-codex-op7418` 回 review。

### Phase 3 — 本地 runner + agent hook 收口 MVP

用户会看到什么变化：

- Claude Code 完成后不再靠用户口头转述，而是由 Claude 侧/ Codex 侧本地 runner 发现 private issue 状态变化后唤醒对应 agent。
- Codex review 后也能通过 label/comment 明确把任务交还 Claude 或交给用户判断。
- 轮询不直接唤醒模型；只有 reconcile 当前 label 状态后发现“确实有自己要处理的新工作”才启动 agent。
- Agent hook 在 agent 停止时只校验/搬运 agent 显式产出的 handoff artifact；没有 artifact 就不发 review/comment。

验收入口：

- `codex-review-requested` label 出现后，Codex runner 能发现并只唤醒一次 Codex。
- `fix-requested` / `codex-accepted` / `human-decision-needed` 三种结果能被 Claude runner 或用户识别。
- 同一 issue 存在活跃 run lock 时，runner 不得启动第二个并发 agent run。
- `codex-accepted` 不会静默悬空：它必须被归类为终态，并通知用户或推进下一 phase。
- Claude / Codex agent 显式写出 handoff artifact 时，Stop hook 能校验必填字段并发布到 private issue。
- agent 没写 handoff artifact 时，Stop hook 不得自动生成 `review_requested` / `review_completed`。
- repeated poll / duplicate mail / delayed event 不会导致重复唤醒。
- actor 是自己的事件不会触发自己再次运行。
- 断点重启后不会重复处理同一个 assignment，也不会漏掉同名 label 的第二次 assignment。

本阶段明确不做：

- 不做常驻模型 daemon；只做非模型 runner。
- 不做 GitHub Actions relay；Actions/webhook/mail 先全部视为可选降延迟层，不进 v1。
- 不做 GitHub webhook / tunnel / Cloudflare Worker；本机入站只走轮询。
- 不用 Claude/Codex scheduled task 当廉价探测器；模型定时任务每 tick 都是一次模型唤醒，不能用来轮询。
- 不做无人值守自动执行。
- 不做跨账号 secret 自动分发。

v1 硬规则：

- 每个 assignment 必须有 loop contract。Runner event、handoff artifact、review artifact 至少记录 `loop_type`、`trigger`、`assignment_id`、`stop_condition`、`max_attempts`、`attempt_count`、`verification_contract`。
- Trigger 认当前 label 状态，不认 comment delta。Comment 是载荷和 evidence，不是唯一触发源。
- Runner 是入站唤醒者。它是 `launchd` / cron 启动的非模型 shell 进程，负责 ETag 轮询、状态重建、去重、actor/self 过滤、锁和 cursor。
- Run 级锁必须覆盖整个 agent run。Runner 启动 agent 前获取 `runId + assignee` lock；agent 本轮结束后由 Stop hook 释放。锁存在期间，下一次 poll 不得再启动同一 issue 的并发 run。锁需包含 owner、assignment id、started_at、heartbeat/ttl、agent command。
- Assignment label 和 in-progress 状态分离。Labels 只表达“当前派给谁/需要谁处理”；进行中状态由 run lock 表达。不要用 `claude-implementing` 同时表示“待 Claude 处理”和“Claude 正在运行”。
- Trigger 绑定 label event id。Runner 不只看“当前 labels 包含 X”，还必须读取 issue events/timeline 中最近一次 matching `labeled` event id，把它作为 assignment instance id；触发条件是“当前 label 仍存在且 assignment id > last-handled assignment id”。
- Agent hook 是出站收口门禁。它只能校验和搬运 agent 显式产出的 artifact，不能自动编写 handoff、ledger、evidence。
- Hook fail-closed。若 artifact 声称要发布 handoff 但缺少 runId、verdict、changed files、verification、risk、next action 等必填字段，hook 阻止发布并要求 agent 修正 artifact。
- Artifact 发布幂等必须使用 GitHub 侧幂等键。每个 artifact 必须带 `artifact_id`，发布到 issue 时正文包含 `<!-- artifact-id: ... -->`；发布前先查 issue comments 是否已有同 id。不要只依赖本地 published marker。
- GitHub webhook / Agent Mail / Actions 都只是 hint。收到 hint 也必须重新 reconcile private issue 当前状态。
- Agent Mail push 能力未验证前，不作为设计前提；若只有 `message +list`，它只是另一个轮询目标。

设计原则：

- 检测状态变化和唤醒 LLM 分离。runner 只做 GitHub/Agent Mail 状态读取、去重、actor 过滤、构造最小上下文；agent 只在命中时启动。
- Reconcile-from-state 是主干。所有通知都是幂等 hint，最终以 private issue labels/comments 重建状态；重复、丢失、乱序通知都不改变事实源。
- Exactly-once 是 assignment-level，不是 label-name-level。两次 `fix-requested` 是两个不同 assignment，必须由 label event id 区分；同一次 `fix-requested` 被重复 poll 不得重复唤醒。
- ETag 条件轮询是 v1 backbone。runner 对 GitHub REST `GET` 保存 ETag，并用 `If-None-Match`；授权请求返回 `304 Not Modified` 时不计 GitHub primary rate limit（GitHub REST best practices: `https://docs.github.com/en/rest/using-the-rest-api/best-practices-for-using-the-rest-api#use-conditional-requests-if-appropriate`）。
- 防自触发第一道防线在 runner。Codex runner 忽略 actor 为 `codepilot-codex-op7418` 的新事件；Claude runner 忽略 actor 为 `codepilot-Claude-op7418` 的新事件。Agent hook 可二次校验，但不能替代 runner 过滤。
- 模型预算单独核算。GitHub API 请求预算和 LLM/token 预算分开记录；runner 不把整条 issue 历史喂给 agent，只传 `runId`、新评论 URL、当前 labels、上一处理 cursor。
- Agent Mail 可作 push hint，但不是免 runner 的银弹。邮件内容可以包含 runId/comment URL/next action；仍需本地 runner 消费和 reconcile。

建议 v1 runner 形态：

| Runner | 触发方式 | 监听状态 | 命中后动作 |
|--------|----------|----------|------------|
| Codex runner | `launchd` / cron，每 2-5 分钟 | 当前 labels 含 `codex-review-requested`，最近 matching labeled-event id 未处理，且 last relevant actor 不是 `codepilot-codex-op7418`，且无 active run lock | 获取 Codex run lock；用最小上下文唤醒 Codex review；Codex 显式写 `review_completed` artifact；Stop hook 校验/发布/释放锁 |
| Claude runner | `launchd` / cron，每 2-5 分钟 | 当前 labels 含 `claude-implementing` 或 `fix-requested`，最近 matching labeled-event id 未处理，且 last relevant actor 不是 `codepilot-Claude-op7418`，且无 active run lock | 获取 Claude run lock；唤醒 Claude 继续实现或修复；Claude 显式写 `review_requested` artifact；Stop hook 校验/发布/释放锁 |
| Human queue | 手动或低频扫描 | `human-decision-needed` / `blocked` / `codex-accepted` | 通知用户；`codex-accepted` 视为终态，可由用户确认关闭 run 或推进下一 phase |

执行要点：

- 为每侧 runner 持久化 cursor：last seen issue updated_at、last seen comment id、ETag、last handled label event id / assignment id。
- 为每个 active run 持久化锁：issue、runId、assignee、assignment id、started_at、heartbeat/ttl、agent command、state。Stop hook 成功或失败都必须释放锁；异常退出由 ttl + stale lock recovery 处理，但 stale recovery 只能重新 reconcile，不得直接启动第二个 run。
- 第一次实现只扫 private repo 中 open issue，或只扫 active run issue #1；不要扫公开 repo。
- 每次唤醒记录一行 runner event：runner、issue、label、actor、comment URL、reason、agent command、result。
- 记录首次通知延迟、重复唤醒次数、每次唤醒喂给 agent 的上下文大小、attempt count、duration、exit reason。若连续失败或无 artifact 达到 `max_attempts`，自动转 `human-decision-needed`，不得无限重唤醒。
- Define artifact paths before enabling hooks, for example:
  - Claude handoff artifact: `.codepilot-agent/outbox/claude/review_requested.json`
  - Codex review artifact: `.codepilot-agent/outbox/codex/review_completed.json`
  - Runner cursor: `.codepilot-agent/state/{agent}/runner-state.json`
- Hook 发布前必须删除或归档已发布 artifact，并写 published marker，避免同一 artifact 被重复发布。
- Hook 发布前必须先用 `artifact_id` 查询 private issue comments；若已存在 `<!-- artifact-id: ... -->`，视为已发布并只补本地 marker / 归档，不得重复评论。
- webhook / Agent Mail / Actions 后续只用于降低延迟：收到 hint 后立即 reconcile；不直接相信 payload。

### Phase 4 — GitHub Project / Actions 自动化

用户会看到什么变化：

- private run repo 有可视化队列和状态字段。
- 常见状态同步由 GitHub 自动化辅助完成，减少手工 label 漏改；runner backbone 仍以本地 reconcile 为准。

验收入口：

- Project board 有 Backlog / Claude Implementing / Codex Review Requested / Fix Requested / Accepted / Blocked。
- 新 run issue 自动进入 Project。
- label 改变能更新 status field。

本阶段明确不做：

- 不把 GitHub Actions 变成能改产品代码的执行器。
- 不把 GitHub Actions schedule 当唯一通知机制；GitHub schedule 最小粒度和运行可靠性不适合作为唯一 runner。
- 不从 public issue comment 直接触发 implementation。
- 不存 secrets 到 repo 文件。

执行要点：

- 创建 private Project。
- 加 status fields 与自动化。
- 可选增加 `ledger-sync-needed` label。
- 对 Runtime / Provider / Permission 相关 run 自动要求 Codex review。

### Phase 5 — Cockpit / Orchestrator 评估

用户会看到什么变化：

- 有一份是否引入 Notion 或 Cloudflare 的决策，而不是凭热情造平台。

验收入口：

- 对比 Notion Developer Platform、GitHub Project、Cloudflare Workflows / Durable Objects。
- 明确 MVP 是否继续 GitHub-first。

本阶段明确不做：

- 不在没有 handoff dry-run 数据前引入 durable orchestrator。
- 不把 Notion 设为代码审查事实源。

执行要点：

- Notion 只评估 cockpit / 周报 / 产品路线图同步。
- Cloudflare 只评估 durable workflow / wait-for-event / human approval。
- GitHub private run repo 默认继续作为工程事实源。

### Phase 6 — Bounded loop harness 产品化沉淀

用户会看到什么变化：

- AI SDK 7 pilot 中验证过的协作模式，会沉淀为可复用 bounded loop harness。
- 后续 Runtime / Provider / Issue triage / Security scan 可以复用同一套协作协议。

验收入口：

- 至少 2 个真实 run 完成：一个实现类，一个 review/fix 类。
- 每个 run 都有 private issue 操作主账和 exec plan 摘要 mirror。
- 有明确 stop condition、budget、human decision gate。

本阶段明确不做：

- 不做“主聊天自己无限循环”。
- 不做无人值守自动发布。
- 不让 agent 自行扩大 scope。

执行要点：

- 总结 AI SDK 7 pilot 的有效/无效 loop。
- 更新 handoff protocol。
- 写 guardrail 或 handover，描述如何给新需求创建 run。

## Claude Code 接手提示

接手本计划时，请先复述：

1. 这是协作循环基础设施计划，不是 AI SDK 7 Runtime 升级计划。
2. AI SDK 7 只是第一个 pilot；Runtime 技术判断仍由 AI SDK 7 计划管理。
3. Private run issue 是操作主账；exec plan 是验收摘要与长期决策；handover 是机制说明。

首个建议任务：

- 完成 `codepilot-Claude-op7418` 身份配置。
- 在 AI SDK 7 Phase 1 run issue 中发第一条真实 `review_requested`。
- 等 Codex 用 `codepilot-codex-op7418` 完成 review。
- 回填本计划 Loop Ledger。

## Smoke Ledger（真实凭据 / UI / E2E 验证记录）

> 协作基础设施本身通常不产生 Runtime smoke；涉及 GitHub bot / private repo / notification / UI cockpit 的真实验证记录在这里登记。产品 Runtime / Provider smoke 仍登记到对应产品 exec plan。

| Date | Runtime | Provider | Model | 凭据形态 | 场景 | Result | Evidence |
|------|---------|----------|-------|---------|------|--------|----------|
| 2026-06-29 | agent_run_space | GitHub | n/a | `codepilot-codex-op7418` PAT in macOS Keychain | read/write private run issue #1 | ✅ | `https://github.com/op7418/codepilot-agent-runs/issues/1#issuecomment-4830806953` |

## Loop Ledger（自动化循环记录）

> Private run issue 是操作主账；这里记录已验收的 run summary mirror。每行必须链接 private issue 或 comment。

| Date | Loop | Input Signal | Auto Cycles | Stop Reason | Result | Evidence |
|------|------|--------------|-------------|-------------|--------|----------|
| 2026-07-01 | docs-ledger-alignment | Claude Code 指出 AI SDK 7 plan / handover ledger 语义不清 | 0/3 | docs contract written | ✅ | `https://github.com/op7418/codepilot-agent-runs/issues/1#issuecomment-4850322052` |
| 2026-07-01 | claude-identity-invite | 用户注册 `codepilot-Claude-op7418` 并要求邀请 | 0/3 | invitation accepted | ✅ | `https://github.com/op7418/codepilot-agent-runs/issues/1#issuecomment-4850742907` |
| 2026-07-01 | first-handoff-dry-run | Claude posted `review_requested` for AI SDK 7 Phase 1 scope | 0/3 | scope accepted, owner returned to Claude | ✅ | `https://github.com/op7418/codepilot-agent-runs/issues/1#issuecomment-4850888856` |
| 2026-07-01 | notification-mvp-design | Claude 指出 webhook/local runner/ETag/self-trigger/budget split 风险 | 0/3 | Phase 3 design updated | ✅ | `https://github.com/op7418/codepilot-agent-runs/issues/1#issuecomment-4851234071` |
| 2026-07-01 | hook-gate-design | Claude 指出 Stop hook 不能自动生成 handoff / ledger / evidence | 0/3 | hook artifact gate written | ✅ | `https://github.com/op7418/codepilot-agent-runs/issues/1#issuecomment-4851532321` |
| 2026-07-01 | runner-lock-design | Claude 指出 run lock、label assignment、accepted terminal、label-event cursor、artifact-id 幂等风险 | 0/3 | Phase 3 constraints written | ✅ | `https://github.com/op7418/codepilot-agent-runs/issues/1#issuecomment-4851995590` |
| 2026-07-01 | hands-off-pilot-model | 用户希望 worktree 内 Claude/Codex 自行实现、review、修复、测试、smoke，直到最终验收 | 0/3 | operating model written | ✅ | `https://github.com/op7418/codepilot-agent-runs/issues/1#issuecomment-4852091552` |
| 2026-07-01 | codex-wake-adapter | Claude 询问 Codex 如何被程序化启动，本机 `codex` 不在 PATH | 0/3 | local headless Codex CLI found | ✅ | `https://github.com/op7418/codepilot-agent-runs/issues/1#issuecomment-4852616686` |
| 2026-07-01 | claude-permission-profile | Claude 询问无人值守 `claude -p` 权限档位 | 0/3 | minimal whitelist selected | ✅ | `https://github.com/op7418/codepilot-agent-runs/issues/1#issuecomment-4853517272` |
| 2026-07-02 | first-real-headless-e2e | Codex 终审通过后手动逐 tick 点火（throwaway issue #2，用户在场） | 1/3 | full chain verified: wake→artifact→publish→label→dedup→lock release | ✅ | `https://github.com/op7418/codepilot-agent-runs/issues/2#issuecomment-4861760914` |
| 2026-07-02 | phase3-runner-final-review | Claude 修复 Codex 终审 P1/P2：event-scoped `nextLabel` 与 idempotent publish replay | 0/3 | Codex review accepted; ready for supervised throwaway e2e | ✅ | `https://github.com/op7418/codepilot-agent-runs/issues/1#issuecomment-4861740637` |
| 2026-07-02 | first-product-hands-off-run | Claude side launchd autonomously executed AI SDK 7 Phase 1 spike on issue #1 | 1/3 | Codex accepted; loop stopped at review boundary | ✅ | `https://github.com/op7418/codepilot-agent-runs/issues/1#issuecomment-4862072251` |
