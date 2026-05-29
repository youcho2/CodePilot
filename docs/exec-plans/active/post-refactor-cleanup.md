# 重构收尾后遗留清理 / Post-Refactor Cleanup

> 创建时间：2026-05-29
> 最后更新：2026-05-29（草稿，待 Codex 审查）
> 父计划：[`refactor-closeout.md`](./refactor-closeout.md)（重构主体已收尾；本计划处理收口后的遗留项 + Opus 4.8 接入）

## 范围与来源

重构 6+ 主线已收口，Phase 7 视觉/图标也收口（图标归档、7b 收口于 0-2、7c 归档）。剩下的是一批**互相独立的遗留问题** + 一个**新输入（Opus 4.8）**。本计划只负责把它们拆成可审、可验收的小刀，**逐项可独立交付**，不强行捆绑。

来源：
- tech-debt tracker：[`#23`](./tech-debt-tracker.md) / `#34` / `#26` / `#27` / `#28` / `#30`
- design.md 设计规范缺口（2026-05-29 与用户讨论的结论：见下方 Phase E）
- Anthropic 于 2026-05-28 更新 Claude Opus 4.8 → 评估 CodePilot 是否需要接入

**本计划是草稿，交 Codex 审查后再开工。** 每个 Phase 都先写"用户能看到什么 / 不做什么 / 怎么验收"（用户审阅），技术细节单列"实现路径"小节（标注**不需用户审阅**，供 Codex / 实现者）。

## 状态

| Phase | 内容 | 类型 | 优先级 | 状态 |
|-------|------|------|--------|------|
| A | 模型目录：接入 Opus 4.8 + 修 Sonnet 4.6 别名（#23） | A 可见 | **高**（发送正确性 + 新模型） | 📋 待审 |
| B | 用户信任 bug：Mac 通知不弹（#34）+ pin-incomplete 误报（#27） | A 可见 | 高 | 📋 待审 |
| C | 能力/平台正确性：Plan 模式 Widget（#26）+ Windows shell 方言（#28） | A 可见 | 中 | 📋 待审 |
| D | 工程卫生：pre-commit enforce eslint（#30） | C 基础设施 | 中（enabler） | 📋 待审 |
| E | design.md 设计规范补全（横切 3 节） | C 基础设施/文档 | 中 | 📋 待审 |

**顺序建议**：A 优先（既修发送失败又上新模型，用户最可感）→ B（信任）→ C（能力/平台）；**D 建议尽早或并行**（它是 enabler——本轮已亲历 #30 放行了 drift 失败的提交，越早收紧后续每一刀越干净，但要先清存量 error）；E 可全程并行（纯文档）。各 Phase 无强依赖，可按资源穿插。

---

## Phase A：模型目录 — 接入 Opus 4.8 + 修 Sonnet 4.6 别名（#23）

> 为什么合并：两者是**同一条别名→upstream 解析链**（`ai-provider.ts` / `provider-catalog.ts` / `provider-resolver.ts` / `model-context.ts`），分开做会改两遍同一批文件、互相打架。

### 用户能看到什么
- **Settings → Models 里能看到并选用 Opus 4.8**；选它发消息能正常工作。
- **ClaudeCode runtime + Sonnet 4.6 发送不再失败**（现在会报 model 不存在，只能切别的模型）。
- 默认 / 推荐模型指向正确的新模型，不再悄悄落到老的 Sonnet 4.0。

### 不做什么
- 不改模型选择的 UI 布局（沿用现有 Models 页 / composer 模型选择器）。
- 不动其它 provider 的套餐型目录（那是 [`#16`](./tech-debt-tracker.md)，独立）。
- 不引入新的"自动切默认"行为——默认模型是否切到 4.8 是显式决策（见 Open Questions），遵守 [pinned 默认硬承诺] guardrail。

### 怎么验收
- Settings → Models 在 Anthropic / OpenRouter 下都能看到 Opus 4.8 条目。
- **真实凭据 smoke**（写入 Smoke Ledger）：
  - ClaudeCode runtime + Sonnet 4.6 → 两轮发送成功（修复 #23 的反例）。
  - Opus 4.8 → 发送成功，且上下文窗口按 1M 生效（若沿用 4.7 的 1M 待遇）。
- 回归测试：别名 `opus`/`sonnet` → upstream 解析断言更新；无残留 `claude-sonnet-4-20250514` 兜底。

### 实现路径（不需用户审阅，供 Codex / 实现者）
已核实的现状（file:line）：
- `src/lib/ai-provider.ts:96-97`：`sonnet: 'claude-sonnet-4-5-20250929'`、`opus: 'claude-opus-4-7'` —— opus 别名仍指 4-7，sonnet 仍指 4-5。
- `src/lib/provider-catalog.ts`：已有 `anthropic/claude-sonnet-4.6`(:285) / `anthropic/claude-opus-4.7`(:296) / `claude-sonnet-4-6`(:326) / `claude-opus-4-7`(:337)。**无任何 4.8 条目。**
- `src/lib/provider-resolver.ts:845`：`upstreamModelId: 'claude-sonnet-4-20250514'`（#23 的错误兜底）；`:855` opus→4-7。
- `src/lib/model-context.ts:18`：`claude-opus-4-7 → 1_000_000`；无 opus-4-8。
- `src/lib/onboarding-processor.ts:61` / `checkin-processor.ts:73`：fallback default `'claude-sonnet-4-20250514'`（Sonnet 4.0）。
- `provider-resolver.ts:507`：`modelId = ... || 'claude-sonnet-4-5-20250929'` 兜底。

改动点：
1. **新增 Opus 4.8 目录条目**：对照现有 4.7 条目，加 Anthropic 直连（`claude-opus-4-8`）+ OpenRouter skin（slug 待核对）；`supportedRuntimes` / `getModelCompat` tier 对齐。
2. **修 Sonnet 4.6 别名链（#23）**：`provider-resolver.ts:845` 与各 fallback 从 `claude-sonnet-4-20250514` 改为 `claude-sonnet-4-6`；`ai-provider.ts:96` sonnet 别名同步。
3. **model-context.ts**：`claude-opus-4-8` 加 1M 映射（沿用 4-7 待遇，beta header 是否仍需 `context-1m-*` 待核对）。
4. **别名 / 默认**：`ai-provider.ts:97` opus 别名是否切 4-8（见 Open Questions）；fallback default 不再用 Sonnet 4.0。
5. 测试：别名解析 + Bedrock/Vertex 前缀匹配（`model-context.ts:49` 注释的 `us.anthropic.claude-opus-4-*` 路径）回归 pin。

---

## Phase B：用户信任 bug — Mac 通知不弹（#34）+ pin-incomplete 误报（#27）

### 用户能看到什么
- **#34**：设置一个定时任务，到点后 **macOS 会弹出系统通知**（现在到点执行了但没通知，任务像"静默完成"）；若系统通知不可用，**至少聊天内 / 状态区有一个可见提醒**兜底。
- **#27**：默认模型只是"没固定全"时，Settings 的 Runtime / Health 不再吓人地说"该模型在当前执行环境不可用"，而是如实说"默认模型固定信息不完整，去 Models 页重新固定"。

### 不做什么
- #34 不重做整个通知系统、不加新通知渠道（只接通"任务触发 → 通知出口"这条断链）。
- #27 不改健康检查逻辑本身，只改**误导性文案 + 误判分级**；Auto 模式的 fallback 行为不动。

### 怎么验收
- **#34**：Mac dev（3001）建一个 3 分钟任务 → 到点 → 系统通知弹出（或聊天内可见 fallback）；加一个可复现 smoke：短周期任务触发后断言 notification dispatch / audit 事件产生。
- **#27**：构造半截 pin（`default_mode='pinned'` 有 `default_model` 缺 `default_model_provider`）→ Settings Runtime / Health 文案为"固定信息不完整"，不再归因 Runtime 不兼容；且 Runtime 页与 Health 页口径一致（不再一个说 fallback、一个说阻断）。

### 实现路径（不需用户审阅）
- #34：tracker 已列排查方向（任务触发链路是否调到 `codepilot_notify` / Electron main 通知 API / bridge 出口；macOS 通知权限 / bundle id / dev app 是否被系统允许；renderer↔main 通知 IPC 在后台 scheduler 触发时是否丢 BrowserWindow/session 上下文）。需先**定位断点**再修；统一任务触发后的通知出口 + 加可观测日志 + 系统通知不可用时落聊天内 fallback。
- #27：tracker 给了 4 条候选——(a) `pin-incomplete` 降级为 info，文案改"固定信息不完整"；(b) Runtime / Health 统一口径；(c) 数据层写 pinned 时强制同时写 `default_model_provider`；推荐 (a)+(b) 先做，(c) 作防御。遵守 [pinned 默认硬承诺] / [无幻觉] guardrail。

---

## Phase C：能力 / 平台正确性 — Plan 模式 Widget（#26）+ Windows shell 方言（#28）

### 用户能看到什么
- **#26**：在 Plan / 只读模式下，Native Agent **仍能生成 Widget**（现在 Plan 模式下做不了，用户以为 Native 不支持 Widget）。
- **#28**：**Windows 版**里，Agent 生成的脚本命令是 **PowerShell / Windows 兼容**语法，而不是 `export` / `rm -rf` / `/tmp` 这种 bash-only（现在直接复制会执行失败）。

### 不做什么
- #26 不放开 Plan 模式的"写"工具，只把**安全只读**的 Harness 能力（含 widget guideline 工具）保留进来。
- #28 不做 Windows 视觉/页面改造（那是另一回事）；只注入正确的 shell 方言上下文。

### 怎么验收
- **#26**：Plan 模式聊天里要求生成 Widget → 能正常出 widget；回归测试 `assembleTools({mode:'plan'})` 必含 `codepilot_load_widget_guidelines` 且 systemPrompts 含 `FINAL OUTPUT FORMAT`，同时**不含** image/dashboard/schedule 等 mutating 工具。
- **#28**：Windows fixture 回归——PowerShell 目标下禁止生成 `export`/`source`/`rm -rf`/`/tmp`；Settings/Runtime 能力说明显示当前目标 shell。

### 实现路径（不需用户审阅）
- #26（已核实 `agent-tools.ts:116` `if (options.mode === 'plan')` 早返硬编码只留 Read/Glob/Grep）：改为派生保留 `PERMISSION_SAFE_TOOLS`（`agent-tools.ts:53`）中的安全工具 + 其对应 compiler system prompt；mutating 工具继续禁用 / 走 ask。
- #28：在 Runtime/Harness context 注入 `platformShell`（zsh/bash/powershell/cmd），传给三 Runtime 的命令生成 + 工具提示；Windows 默认要求 PowerShell 兼容，检测到 WSL/Git Bash 才允许 bash；加 Windows fixture 回归。**注**：跨三 Runtime 注入，属 Tier 2，需读对应 guardrail + 真实/接近真实验证。

---

## Phase D：工程卫生 — pre-commit enforce eslint（#30）

### 用户能看到什么
- **用户不可见（类型 C 基础设施）**。价值：**防止坏提交悄悄溜过去**——本轮已亲历 #30：第一次提交时 docs-drift linter 失败，但提交照样成功（husky 只看最后一条命令退出码）。这意味着违反 drift / lint / 甚至 tsc 的提交都可能溜过。收紧后，违规提交会被挡住。

### 不做什么
- 不为了收紧 hook 而一次性挡死所有提交——**必须先清掉现存的 eslint error**，再串联。

### 怎么验收
- 故意制造一个 eslint error → `git commit` 被挡住（退出非 0）。
- 现存 error 清零后，`lint-staged` / `tsc` / drift 任一失败都能阻断提交。

### 实现路径（不需用户审阅）
已核实 `.husky/pre-commit` 是 4 行未串联（`node scripts/lint-hooks.mjs` / `npx lint-staged` / `npx tsc --noEmit` / `CODEX_DISABLED=1 npx tsx --test ...`），husky 以最后一条（unit test）退出码为准。
两步（tracker #30）：
1. **先清存量**：tracker 记录约 3 个 error（`card-primitives.tsx` 的 `react-hooks/refs`、`AppShell.tsx`/`AssistantPanel.tsx` unused-var 等）——需先确认当前确切清单再清。
2. **再收紧**：4 行用 `&&` 串联或加 `set -e`（或 `npx lint-staged || exit 1` 等价）。
附带：tracker 提到 unit 套件在 pre-commit 负载下偶发 flaky（重跑全绿），可一并排查。

---

## Phase E：design.md 设计规范补全（横切 3 节）

> 沿用 2026-05-29 与用户讨论的方向：design.md 保持"共享设计 canon"，**优先补横切规范**；面专属细节靠 "Anchor implementations" 链到既有 feature handover，不把 878 行翻倍成全量产品文档。

### 用户能看到什么
- **用户不可见（类型 C 文档基础设施）**。价值：后续做相关 UI 时能查到统一规范，不再各写一套、不再"管道通了但样式跑偏"。

### 不做什么
- 不把 design.md 扩成覆盖所有非 Settings 面的全量文档（除非用户后续要）。
- 不新写未实现的规范——**只沉淀已 shipped 的稳定模式**（design.md 自身纪律："Anything in here is implemented and shipping"）。

### 怎么验收
- design.md 新增 3 节、内容对得上现有实现；新做对应 UI 时能照着做。

### 实现路径（不需用户审阅）
第一批补 3 节（都已 shipped、稳定、目前只散在 handover）：
1. **浮动卡片布局**（7c：CardFrame 只投影 / CardSurface 只裁剪 / ResizeGutter 在 gap 几何中心）。
2. **Composer 底部工具栏规范**（含"默认无边框、hover / 非默认态才显结构；左侧可调、右侧只读状态"约定）。
3. **macOS 平台壳层 surface 规范**（哪些面上材质、内容区为何不上玻璃——含 Apple HIG 依据）。
A 类面专属（Chat 消息 / /plugins / Workspace / 素材库等）从 "Anchor implementations" 链到既有 handover/insights。

---

## 决策日志

- 2026-05-29：建本计划。重构主体收尾后，把 6 个遗留项（design.md + #23/#34/#26/#27/#28/#30）+ Opus 4.8 接入拆成 A-E 五个 Phase。#23 与 Opus 4.8 合并入 Phase A（同一别名解析链）。#30 标为 enabler 建议尽早。各 Phase 可独立交付，不强行捆绑。草稿待 Codex 审查后开工。

## Smoke Ledger（真实凭据 / UI / E2E 验证记录）

> 每跑一次真实 smoke 追加一行：Runtime / Provider / Model / 凭据形态 / 场景 / 结果 / 证据。

| Date | Runtime | Provider | Model | 凭据形态 | 场景 | Result | Evidence |
|------|---------|----------|-------|---------|------|--------|----------|
| _示例_ | claude_code | Anthropic | claude-opus-4-8 | API key | Opus 4.8 两轮发送 | ⏳ | 待 Phase A |

## Open Questions（待 Codex / 用户核对）

1. **Opus 4.8 是否设为默认 / `opus` 短别名指向**：建议把 `opus` 别名 + 推荐默认切到 `claude-opus-4-8`（最新），但 4.7 保留可选；是否切默认请用户拍板（涉及新会话默认行为）。
2. **Opus 4.8 的 OpenRouter slug** 与 **1M context 的 beta header**（是否仍需 `context-1m-2025-08-07`）：需对照 Anthropic / OpenRouter 官方文档核对，不臆测。
3. **#34 的真实断点**：通知没弹是"任务没调到通知出口"还是"系统通知权限/IPC 丢上下文"——需先定位再定修法。
4. **#30 存量 error 的确切清单**：开工前先 `npm run lint`/eslint 跑一遍确认当前 error 数与文件，再决定清理范围。
5. **Phase 拆分粒度**：A-E 是否进一步拆成独立 PR / 提交，由实现时按 Tier 决定（A/C 含 Tier 2，需 guardrail + smoke）。
