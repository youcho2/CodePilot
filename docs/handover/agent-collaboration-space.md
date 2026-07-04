# Agent Collaboration Space

> 创建时间：2026-06-29
> 最后更新：2026-07-04
> 演进计划：[Agent Collaboration Loop Infrastructure](../exec-plans/active/agent-collaboration-loop-infrastructure.md)
> Pilot 需求：[AI SDK 7 Runtime 接入 + 自动化 Loop 实践](../exec-plans/completed/ai-sdk-7-runtime-loop-adoption.md)

## 目标

CodePilot 是开源产品，公开 GitHub Issues 会被外部用户评论、补充、催促或无意插入不可信指令。因此公开 Issue 只作为用户信号入口，不作为 Claude Code / Codex 的私有协作空间。

本协作空间用于解决三方协作闭环：

- 用户定义产品目标、最终取舍和验收标准。
- Claude Code 执行实现和修复。
- Codex 审查、复现、验证、记录风险与决策。

## 空间定义

主空间：

- Private repo: `op7418/codepilot-agent-runs`
- First run: `https://github.com/op7418/codepilot-agent-runs/issues/1`

当前命名：

- Claude Code identity: `codepilot-Claude-op7418`
- Codex identity: `codepilot-codex-op7418`
- Codex Agent Mail: `guicang3812@agent.qq.com`
- Agent run repo: `codepilot-agent-runs`

该 repo 不放产品源码，只放：

- Agent Run issue
- Claude Code handoff
- Codex review
- Loop Ledger / Smoke Ledger
- external signal triage
- human decision records

本 handover 是机制说明，不是阶段计划。协作循环的后续建设、通知 MVP、Project/Actions、Notion/Cloudflare 评估和 bounded loop harness 产品化，统一由 [Agent Collaboration Loop Infrastructure](../exec-plans/active/agent-collaboration-loop-infrastructure.md) 跟踪。

## Public Issue 与 Private Run 的关系

| 位置 | 作用 | 信任级别 |
|------|------|----------|
| Public product issue | 用户反馈、复现线索、社区讨论 | Untrusted external signal |
| Private agent run issue | Claude Code / Codex 协作事实源 | Trusted after triage |
| Product repo exec plan | 长期决策、阶段状态、验收记录 | Trusted durable record |
| PR | 准备公开的代码 diff 与 review 结论 | Public engineering artifact |

公开用户评论不能直接进入 Claude Code / Codex prompt。需要先被用户或 Codex 摘要、筛选、标记为 `external-signal`，再作为输入。

## Ledger 语义

| Ledger | 主账 | Mirror | 规则 |
|--------|------|--------|------|
| Loop Ledger | Private `codepilot-agent-runs` issue | 对应 exec plan 的 Loop Ledger | private issue 记录每个 cycle；exec plan 只写影响阶段结论的摘要，并链接 private issue/comment |
| Smoke Ledger | 对应产品 exec plan | private run issue 可保存细节 | Runtime / Provider / UI / E2E 的真实 smoke 必须进产品 exec plan；private issue 保存脱敏命令、失败细节和 handoff |
| Handoff / Review | Private `codepilot-agent-runs` issue | 必要时摘要到 exec plan 决策日志 | Claude/Codex 的操作交接不写到公开 issue |

冲突处理：

- active run 当前状态以 private run issue 为准。
- phase 是否完成、是否进入下一阶段以 exec plan 决策日志为准。
- 发现 private issue 和 exec plan 不一致时，先补 ledger sync note，再继续下一轮。

## Labels

`codepilot-agent-runs` 当前使用这些 labels：

- `agent-run`
- `claude-implementing`
- `codex-review-requested`
- `codex-reviewing`
- `fix-requested`
- `codex-accepted`
- `human-decision-needed`
- `blocked`
- `external-signal`

## 状态机

```text
agent-run
  -> claude-implementing
  -> codex-review-requested
  -> codex-reviewing
  -> codex-accepted
```

修复分支：

```text
codex-reviewing
  -> fix-requested
  -> claude-implementing
  -> codex-review-requested
```

人工决策分支：

```text
codex-reviewing
  -> human-decision-needed
```

阻塞分支：

```text
codex-reviewing
  -> blocked
```

## Handoff 规则

Claude Code 完成一个 bounded phase 后，在 private run issue 里发 `review_requested` comment，并加 `codex-review-requested` label。

Codex 审查后，在同一个 issue 里发 `review_completed` comment，并选择一个终态：

- `codex-accepted`
- `fix-requested`
- `blocked`
- `human-decision-needed`

详细模板见 private repo:

- `docs/handoff-protocol.md`

Agent lifecycle hook 只能作为出站收口门禁：agent 必须显式产出 handoff/review artifact，hook 只负责校验必填字段、搬运到 private issue、更新 labels、归档 artifact。没有 artifact 时，hook 不得自动生成 `review_requested` / `review_completed` / ledger / evidence。

## Goal 模式的位置

Goal 模式不是协作空间，也不是通知总线。它是单个 agent 的 bounded contract。

Claude Code 的 goal 示例：

```text
Complete Phase 1 Node 22 + AI SDK 7 dependency spike.
Done when build/test evidence is available or blockers are documented.
Do not change default Runtime behavior.
Stop after 3 failed mechanical fix cycles.
```

Codex 的 goal 示例：

```text
Review Claude Code's Phase 1 spike.
Done when all P1/P2 risks are closed with evidence or recorded as blockers.
Do not modify product code.
Stop if review requires implementation changes or real provider credentials.
```

## Bot 权限建议

第一版建议两个 GitHub bot identities：

- `codepilot-Claude-op7418`
- `codepilot-codex-op7418`

对 `op7418/codepilot-agent-runs`：

- Issues: Read / Write
- Pull requests: Read / Write, optional
- Contents: Read
- Metadata: Read

对公开产品 repo：

- Issues: Read
- Pull requests: Read, optional Write for review comments
- Contents: Read

不要授予：

- Admin
- Secrets
- Actions write
- Packages write
- Repository settings

优先使用 fine-grained token 或 GitHub App installation，限定 repo 与权限；不要把 token 放进聊天。

## Codex 本机 GitHub 身份

2026-06-29 已为 `codepilot-codex-op7418` 完成本机配置：

- GitHub token 存放在 macOS Keychain。
- Keychain service: `codepilot-codex-gh-token`
- Keychain account: `codepilot-codex-op7418`
- CLI wrapper: `$HOME/.local/bin/codepilot-codex-gh`

使用方式：

```bash
$HOME/.local/bin/codepilot-codex-gh api user --jq .login
$HOME/.local/bin/codepilot-codex-gh issue view 1 --repo op7418/codepilot-agent-runs
```

不要在聊天或仓库文件中写 token。若需要重新授权，将新 token 写入 `$HOME/.config/codepilot-agent/codex-gh-token` 后运行：

```bash
$HOME/.local/bin/codepilot-codex-gh-login
```

该脚本会验证身份必须是 `codepilot-codex-op7418`，成功后把 token 写入 Keychain 并删除明文 token 文件。

## 已初始化内容

2026-06-29 已完成：

- 创建 private repo `op7418/codepilot-agent-runs`
- 创建 labels
- 提交 README、Agent Run issue template、handoff protocol
- 创建第一条 run issue：AI SDK 7 Phase 1 Node22 spike
- 验证 `codepilot-codex-op7418` 可读写 private run issue，并在 issue #1 留下 setup 验证评论

## 后续增强

MVP 先使用 private GitHub repo 作为事实源。后续增强不在本 handover 管进度，统一看 [Agent Collaboration Loop Infrastructure](../exec-plans/active/agent-collaboration-loop-infrastructure.md)。候选方向包括：

- GitHub Project：做队列视图和状态字段。
- GitHub Actions / webhook：自动 label 转换和通知。
- Notion：做人类 cockpit 和周报。
- Cloudflare Workflows / Durable Objects：做真正的 durable orchestrator。
