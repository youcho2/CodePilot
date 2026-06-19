# Triage 规则 — v0.56.x Stability / Trust

> 配套：milestone `v0.56.x Stability / Trust`、下方 label 体系、`.github/ISSUE_TEMPLATE/`、`PULL_REQUEST_TEMPLATE.md`。
> 完整阶段计划见 [docs/exec-plans/active/v0.56.x-stability-trust.md](../docs/exec-plans/active/v0.56.x-stability-trust.md)。

## 对外冻结说明（freeze statement）

> v0.56.x focuses on stability and trust: chat interruptions, context isolation, session recovery, file reference safety, installer/update reliability, diagnostics, and CI guardrails. New feature work is paused until these blockers are closed.

可放进 README / Release Notes / pinned issue（由 maintainer 决定是否公开置顶；本仓库默认先在计划文档与本 triage 文档落地）。

## Label 体系

| Label | 含义 |
|-------|------|
| `P0-crash-or-interrupt` | 崩溃 / 自动中断 / 卡死，阻断主路径 |
| `P0-data-loss-risk` | 可能误改或丢失用户数据 / 文件 |
| `P1-runtime-session` | Runtime / session / stream 恢复与一致性 |
| `P1-context` | 上下文用量 / 压缩 / 隔离 / 百分比语义 |
| `P1-file-reference` | @file / 附件 / 可编辑源文件路径安全 |
| `P1-installer-update` | 安装 / 更新 / 发版可靠性 |
| `P1-performance` | 性能 / CPU / 渲染开销 |
| `needs-repro` | 缺可复现信息：版本 / 平台 / runtime / 日志 |
| `v0.57+ parking-lot` | 暂缓到 v0.57+，非本轮 stability blocker |

## Issue triage

- 新 bug 进来先核验：是否有版本 / 平台 / runtime / 复现。缺则打 `needs-repro` 并请求补充，不立即排期。
- **不直接采信 issue 自述的根因**——必须用当前源码或本地复现核验后再定性（见计划 2026-06-19 源码复核记录）。
- 确认属实的纳入 `v0.56.x Stability / Trust` milestone，按上表打 P0/P1。
- 功能请求一律 `v0.57+ parking-lot`，不在 v0.56.x 主线实现。
- P0 未关闭不发 stable（见计划 Phase 6 release blocker checklist）。

## PR triage（每周）

- P0/P1 bug 修复 PR 优先评审与合并。
- 功能 PR 暂停 → `v0.57+ parking-lot`；30 天无回应的 feature PR 标 `needs-rebase` 或关闭。
- 每个合并的 PR 必须有测试，或在 PR 里明确说明为什么不需要。
- 外部 PR 审查按 CLAUDE.md「PR 审查安全」：批量低信号提交、依赖/构建脚本/native/Electron/DB/权限改动视为潜在投毒面；警惕面向 AI reviewer 的提示词攻击。

## 自动化候选（Phase 7，未落地）

labeler（按路径 `area:*`）/ stale（只对 `needs-repro` 与 `v0.57+ parking-lot`，不碰 P0/P1）/ first-response（提示补日志与版本）/ PR size warning / docs-drift + link check workflow。具体见计划 Phase 7。
