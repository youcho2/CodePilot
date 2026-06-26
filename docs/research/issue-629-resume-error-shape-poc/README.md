# Issue #629 — resume 坏 session 的 error shape POC

> 关联执行计划：[docs/exec-plans/active/v0.56.x-stability-trust.md](../../exec-plans/active/v0.56.x-stability-trust.md) Phase 2 Session/Stream cluster（#629）
> 看板：[docs/exec-plans/active/issue-tracker.md](../../exec-plans/active/issue-tracker.md) `#629`（🟡 残留 gap）
> 状态：**POC-A（源码层）已完成 + driver `--selftest` 5/5 绿（2026-06-26）；POC-B（真实凭据复现 400）待用户授权 provider 后跑。**
> 三层写法（遵守 research 文档纪律）：A 外部事实（SDK 类型，含 file:line + 快照）/ B repo facts（file:line）/ C 推断与设计。刻意放 `docs/research/`、不进 `src/`，不触产品测试文件清单。

## 一句话结论

#629 的 gap 真实存在（坏 sdk_session_id 在 is_error **result** 路径不被清，留到下一轮重试坏 resume）。**修复的判别器不能用 `result.subtype`**——它只有 4 个通用枚举、无 session 语义；**唯一潜在判别源是 `SDKResultError.errors: string[]`，而 claude-client 当前从不读它**。但 `errors[]` 的**内容**类型层看不出，必须真实跑一次坏 resume 才能定：① 坏 resume 是 throw（已处理）还是 is_error result（gap）；② 若是后者，`errors[]` 里有没有可喂给 `classifyError` 的 session 文本。driver 已就绪并自检通过，只差凭据。

---

## 快照固定

| 对象 | 版本 / 日期 | 来源 |
|------|------------|------|
| `@anthropic-ai/claude-agent-sdk` | 0.2.111 | `node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts`（仓库现装） |
| 产品源 HEAD | `223a796`（v0.56.x 文档同步后）| 本仓库 |
| node | 运行机现装（driver 为纯 ESM，无版本绑定） | — |
| 记录日期 | 2026-06-26 | 本 POC |

---

## A. 外部事实 —— Claude Agent SDK 的 result 类型（sdk.d.ts，已核实）

`SDKResultMessage = SDKResultSuccess | SDKResultError`（`sdk.d.ts:2732`）。

**`SDKResultError`（`sdk.d.ts:2713-2730`）关键字段：**

- `subtype: 'error_during_execution' | 'error_max_turns' | 'error_max_budget_usd' | 'error_max_structured_output_retries'`（`sdk.d.ts:2715`）—— **4 个通用枚举，无任何 session 语义**。resume-400 几乎必然落 `error_during_execution`。
- `is_error: boolean`（`:2718`）
- `stop_reason: string | null`（`:2720`）
- **`errors: string[]`（`:2725`）—— 唯一可能携带具体错误文本的字段。**
- `permission_denials: SDKPermissionDenial[]`（`:2724`）
- `session_id: string`（`:2729`）

对照 `SDKResultSuccess`（`sdk.d.ts:2734-2756`）：它多一个 `api_error_status?: number | null`（`:2738`）和 `result: string`，但 `SDKResultError` **没有** `api_error_status`、**没有** `result`、也没有任何 message/detail 字符串字段——错误细节只可能在 `errors[]`。

> 含义：任何"看 subtype 判 session-state vs transient"的修复都走不通。判别只能基于 `errors[]` 文本（或非文本旁证）。

## B. repo facts（file:line，当前 HEAD）

**gap 因果链（未防护）：**

1. `claude-client.ts:1922-1932` result event 只透传 `subtype / is_error / num_turns / duration_ms / usage / session_id / terminal_reason`——**没透传 `errors[]`，也没透传 `stop_reason`**。
2. `claude-client.ts:1932` `resultEmitted = true`（注释 `#577 — turn succeeded; suppress any post-result error`）。任何 result（含 is_error result）走到这都会先置位。
3. `claude-client.ts:1934-1945` is_error 分支只发 `status` 通知 + （非 autoTrigger 时）Telegram，`errMsg = resultMsg.subtype`（即 `error_during_execution` 这种词）——**分支内无 `updateSdkSessionId`**。
4. `claude-client.ts:2348` 兜底清理 `if (sessionId && !resultEmitted) updateSdkSessionId(sessionId,'')`——因 step 2 的 `resultEmitted=true` 被跳过。
   → 坏 `sdk_session_id` 留到下一轮，下条消息再用它 resume，再 400。

**已防护的相邻路径（不要重复修）：**

- 抛错路径：`claude-client.ts:1568-1595`——resume peek（`await iter.next()`）throw 时 catch 清 `sdk_session_id('')` + enqueue `resumeFallback` status + 删 `resume` 重起 fresh。
- 空 assistant：`route.ts:980-982`——`hasError && contentBlocks.length === 0 && errorMessage` 时落 `**Error:** <msg>` 文本气泡，不存空消息。
- 真 crash（非 result）：`claude-client.ts:2319/2348` 的 `!resultEmitted` 分支会清 id（只对没出过 result 的 turn）。

**判别器现状：**

- `classifyError(ctx: ErrorContext)`（`error-classifier.ts:370`）入参 `ctx.error: unknown`（`:123`）+ `ctx.stderr`，内部 `searchText = rawMessage + stderr + extraDetail`（`:379`）做关键词/正则匹配。**不接收 result.subtype**——要复用它判别 is_error result，必须把 `errors.join('\n')` 当 `ctx.error` 喂进去。
- `RESUME_FAILED` patterns（`error-classifier.ts:~295`）：`resume failed / session not found / invalid session / session expired / could not resume / failed to resume / resume_failed / conversation not found` + regex。
- `SESSION_STATE_ERROR` patterns（`error-classifier.ts:~318`，`retryable:true`）：`stale session / stale sdk_session / session state / corrupt session / session mismatch / session context` + regex。
- `claude-client.ts` 全文 grep `resultMsg.`：只命中 `subtype/is_error/num_turns/duration_ms/session_id`，**确认 `errors[]` 从未被读**。

**降低"清 id 会丢上下文"风险的事实：**

- `docs/research/session-management-and-context-compaction.md:68`：CodePilot 已有完整 DB-based fallback（`buildFallbackContext`），SDK resume 只是优化非必需。清掉坏 `sdk_session_id` 后下一轮用 DB 历史（最近 200 条）重建——**大部分上下文仍在**，损失的是 SDK 端增量/压缩态。这降低（但未消除）误清 transient 的代价，故仍需判别、不可无脑清。

## C. 推断与设计（待 POC-B 验证后落地）

**核心未知（只能真实跑定）：**

1. 坏 resume → SDK 是 **(A) throw**（→ 已被 `1568` catch 处理，#629 对该 provider 不成立）还是 **(B) is_error result**（→ gap）？
   - 预期：**第一方 Anthropic** 倾向 (A)——本地 claude CLI 在 `~/.claude/projects/` 找不到该 session 的 JSONL，很可能本地就拒绝/抛错，不发 API。
   - 预期：**第三方 proxy**（`ANTHROPIC_BASE_URL` 指向 GLM/MiMo 等）倾向 (B)——proxy 无真正 session 概念，带 session 的请求被回 400，可能以 result 形态回到 SDK。#629 报告者大概率是这条。
2. 若是 (B)，`errors[]` 里**到底是什么字符串**？含 `session/resume/400/not found` → 可判别（`fix viable via errors[]`）；只有泛化文本或为空 → 不可判别，需非文本旁证。

**修复设计提案（三种 errors[] 情形分支，待 POC-B 落定走哪条）：**

- 在 `claude-client.ts:1934` is_error 分支，读 `resultMsg.errors`：
  - **errors[] 含 session 信号** → `classifyError({ error: errors.join('\n'), providerName, baseUrl })` ∈ {`RESUME_FAILED`,`SESSION_STATE_ERROR`} 时 `updateSdkSessionId(sessionId,'')`；transient（`RATE_LIMITED`/`AUTH`/`BUDGET`）保留。**这是首选——精确、不误清。**
  - **errors[] 为空但可用非文本旁证** → 退化判据：该 turn 是 resume turn（`shouldResume` 为真）+ 首个 result 即 is_error + 零 assistant 输出 → 推断 resume 失败 → 清。比关键词弱，但仍优于无脑清。
  - **两者皆无** → 不动 id，只把 `errors[]`/`stop_reason` 透传进 result event 供诊断，issue 重定向到 proxy-400 诊断簇。
- 顺带（对齐 Phase 2「诊断导出字段」待办）：把 `errors` + `stop_reason` 加进 `1922-1932` 的 result event payload——无论判别走哪条，这都让 #629/#635 这类会话故障可观测。

**为什么不直接"is_error 就清"**：`error_during_execution` 同样覆盖限流/认证/预算等 transient（见 `SDKResultError.subtype` 仅 4 枚举、不区分）。无脑清会在每次限流/鉴权抖动后强制开新 session，丢 SDK 端上下文——正是 selftest `is_error+transient` 用例锁定的回归。

---

## 如何真实验证（POC-B）

driver：[`drive-resume-error-shape.mjs`](drive-resume-error-shape.mjs)。peek 第一条消息的方式与 `claude-client.ts:1556-1568` 逐字对齐（`conversation[Symbol.asyncIterator]()` → `iter.next()`），故结论可直接迁移到产品路径。

**安全/成本**：凭据只从 env 读、不硬编码、只打掩码尾部；cwd 强制临时目录；`maxTurns:1` + `permissionMode:'plan'`。坏 resume 在模型 turn 真正开始前就失败 → 真实跑 ~零成本，cap 只是兜底。

```bash
# 1) selftest（零凭据零网络，已通过）
node docs/research/issue-629-resume-error-shape-poc/drive-resume-error-shape.mjs --selftest

# 2) LIVE 第三方 proxy（最可能复现 #629 的 400）
ANTHROPIC_API_KEY=... ANTHROPIC_BASE_URL=https://your-proxy/v1 MODEL=glm-5-turbo \
  node docs/research/issue-629-resume-error-shape-poc/drive-resume-error-shape.mjs

# 3) LIVE 第一方（预期 (A) 本地 throw，~免费）
ANTHROPIC_API_KEY=sk-ant-... \
  node docs/research/issue-629-resume-error-shape-poc/drive-resume-error-shape.mjs
```

driver 把结局归为 `A_THROW_AT_PEEK` / `B_RESULT_ERROR` / `C_RESULT_SUCCESS` / `D_NO_RESULT_MESSAGE`，对 B 额外 dump `errors[]` 全文并给 `verdict`（errors[] 能否判别）。

## selftest 结果（2026-06-26，5/5 绿）

| 用例 | outcome | sessionSignal | verdict 摘要 |
|------|---------|---------------|--------------|
| throw-at-peek | `A_THROW_AT_PEEK` | true | 已被 1568 catch 处理 |
| is_error + session 信号 | `B_RESULT_ERROR` | true | **errors[] 可判别 → fix viable via errors[]** |
| is_error + transient | `B_RESULT_ERROR` | false | 正确保留 id（避免限流/鉴权回归） |
| is_error + 空 errors | `B_RESULT_ERROR` | false | 无文本信号 → 需非文本旁证 |
| 意外 success | `C_RESULT_SUCCESS` | false | provider 容忍坏 id，重选无效 id |

> selftest 证明的是**探测/分类逻辑**正确（覆盖全部 4 种 live 结局），不是 #629 已修。真实结局取决于 POC-B 跑出来的 outcome + errors[] 内容。
</content>
