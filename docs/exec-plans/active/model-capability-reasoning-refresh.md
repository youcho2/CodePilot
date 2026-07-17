# 模型目录与推理强度统一适配

> 创建时间：2026-07-17
> 最后更新：2026-07-17
> 状态：📋 调研完成，待 Claude Code 实施
> 事实基线：[基础体验更新事实基线](../../research/foundation-experience-refresh-2026-07-17.md)

## 用户问题与取舍

用户需要 GLM-5.2、GPT-5.6（Codex）、Kimi for Coding 最新模型渠道和 Claude 新模型都能选择真实支持的推理强度，并希望 Claude 的控件出现在模型右侧。

仓库已经有该位置和控件，问题是 capability 真源不完整：GLM/Kimi 目录过期，Sonnet 5 缺失，Codex 同时存在动态与硬编码目录，而且 app-server 字段已从 `effort` 漂移为 `reasoningEffort`。本计划不重做 UI，而是把目录、能力、wire 参数和失败降级收敛成同一合同。

## 状态

| Phase | 内容 | 状态 | 用户能看到什么 |
|---|---|---|---|
| Phase 0 | Codex GPT-5.6 与 schema drift | 📋 待开始 | Codex 渠道可看到账号真实返回的 5.6，并显示可用强度 |
| Phase 1 | GLM-5.2 / Kimi for Coding 目录与强度 | 📋 待开始 | 两个 Coding Plan 显示正确模型和真实档位 |
| Phase 2 | Claude Sonnet 5 与现有模型复核 | 📋 待开始 | Sonnet 5 可选；Claude 模型右侧稳定显示匹配的强度菜单 |
| Phase 3 | capability 统一与后续跟进机制 | 📋 待开始 | 上游模型变化不会再靠多处硬编码静默漂移 |
| Phase 4 | Tier 2 回归与真实凭据 smoke | 📋 待开始 | 模型、Runtime、强度和实际请求一致 |

## Phase 0：Codex GPT-5.6 与 schema drift

### 不做什么

- 不把 OpenAI API 目录硬塞给没有 entitlement 的 Codex Account。
- 不把 `ultra` 当成普通 Responses API reasoning effort。
- 不继续用全局 clamp 把模型明确支持的 max/xhigh 静默降成 high。

### 执行清单

- [ ] 先区分 UI 中 `openai-oauth` 与 `codex_account`，确定旧 OAuth 是否继续存在；若保留，必须明确命名与能力边界。
- [ ] `model/list` 同时兼容旧 `{ effort }` 与新 `{ reasoningEffort }`，过滤空/未知值，保留 default effort 和描述。
- [ ] 移除 `src/components/chat/EffortSelectorDropdown.tsx:36` 的五档硬编码回退（伪档位来源）：`supportedEffortLevels` 缺失或为空时隐藏/降级选择器，不回退写死全集；组件层补空值、未知值、缺失 levels 的测试。
- [ ] Codex Account 目录以 app-server 为真源；版本低于 GPT-5.6 要求或账号未 rollout 时显示原因，不伪造条目。
- [ ] 将 effort 校验改为“当前模型返回的 allowlist”；turn/start 只透传被该模型声明支持的档位。
- [ ] 将 `ultra` 建模为 Codex 专属能力/模式，未完成多代理语义前不在通用 effort selector 中承诺。
- [ ] 为 cache invalidation、旧 binary、logged-out、空 model/list、schema drift 加回归。

## Phase 1：GLM-5.2 / Kimi for Coding

### 不做什么

- 不把供应商映射后的多个 UI 档位说成不同的实际推理计算。
- 不展示或跟踪 K3 等底层模型版本；`Kimi for Coding` 就是用户可见的最新模型渠道。
- 不新增显式 `k3` 内置模型项，也不为供应商切换底层版本维护兼容分支。
- 不预先展示 Kimi 文档标为“后续支持”的 low/high。

### 执行清单

- [ ] GLM CN/Global 更新 role mapping、默认模型与 1M 变体策略；在真实凭据前保留待验证标记。
- [ ] GLM capability 只暴露 high/max 的有效语义，必要时在菜单说明 Claude Code 档位映射。
- [ ] Kimi 默认请求使用稳定渠道 `kimi-for-coding`，并给现有 `sonnet` UI alias 补明确 upstream mapping；用户可见名称固定为 `Kimi for Coding`。
- [ ] Kimi for Coding 内置目录不展示 discovery 返回的底层版本或显式 `k3` 条目；供应商升级底层模型时不需要修改目录。
- [ ] capability 可读取 API/SDK 的渠道能力，但必须与模型展示名解耦；当前仅显示 Auto/Max。Auto 是 CodePilot 的"不显式指定"语义（不下发 effort），不是 Kimi 官方档位；官方现状为仅 K3 支持推理强度、唯一可配值 max（low/high 标为后续），K3 文档写明 null/undefined → max，但官方概览与模型配置页对 `kimi-for-coding` 底层版本描述互相冲突——渠道实际能力与 Auto 是否落到 Max 以 live smoke 定案，UI 文案不得把 Auto 说成供应商档位。
- [ ] 验证 Kimi effort 下发链路与优先级：Agent SDK `queryOptions.effort` 与 `CLAUDE_CODE_EFFORT_LEVEL` env override 的关系及 Kimi 渠道兼容性，不预设 env-only；effort 被上游忽略或报错时按能力漂移降级并给出提示，作为静态 catalog 声明的防线。
- [ ] Moonshot provider（`provider-catalog.ts:638-660`）不属于本轮 Kimi for Coding 改名范围；但改动 catalog 时确认 `legacy-catalog-hint.test.ts:119-196`（pin 了 `kimi-k2.5`）不被破坏。
- [ ] 模型切换导致缓存失效时给用户可理解提示；不在同一 session 偷换模型。

## Phase 2：Claude Sonnet 5

### 不做什么

- 不只在 catalog 加一行。
- 不把 manual extended thinking、非默认 sampling 参数继续发给会返回 400 的 Sonnet 5。
- 不自动把所有既有对话从 Sonnet 4.6 升级到 Sonnet 5。

### 执行清单

- [ ] 在 first-party、env、适用的 OpenRouter/Bedrock/Vertex 目录分别按真实可用性加入 Sonnet 5。
- [ ] 更新 context、adaptive-thinking sanitizer、sampling 约束、token budget 与 provider capability。
- [ ] 复核 Fable 5 / Opus 4.8 已有实现与当前官方合同是否一致。
- [ ] 显式裁决 `src/lib/agent-loop.ts:408-425`（及 `agent-loop-toolloop-poc.ts:222-273`）Native 路径对 adaptive 家族丢弃显式 effort 的旧兼容逻辑：其前提（stale `effort-2025-11-24` beta header）疑似已失效，官方现已确认 Sonnet 5 / Fable 5 支持 effort low–max。要么按当前官方 API 恢复下发，要么对 Native × adaptive 隐藏强度控件并说明；二选一，同一决策约束 Sonnet 5。当前 catalog 声明 supportsEffort 五档但 Native 实际不下发，已违反本计划"四者一致"验收。
- [ ] 触点补齐：`src/hooks/useProviderModels.ts:17` 客户端 fallback（历史曾漏 opus-4-8/fable-5）、`src/app/api/providers/models/route.ts` 的 `ENV_ALIAS_TO_UPSTREAM`、i18n `src/i18n/en.ts`/`zh.ts`（GLM 档位映射说明、Kimi Auto 语义文案）；token budget 复核需包含 Sonnet 5 新 tokenizer（同文本约 +30% token）对 context 估算的影响。
- [ ] 保持强度控件紧邻模型选择器；模型切换时若旧档位不受支持，回到 Auto 并显示一次非误导提示。

## Phase 3：后续能力跟进

- [ ] 建立 provider/model capability normalization：`supportedEffortLevels`、default、thinking mode、context、source breadcrumb。
- [ ] API/SDK 动态能力优先；catalog 只作有 provenance 的 fallback。
- [ ] 增加 upstream schema fixture / contract test，字段改名或出现空值时 fail closed。
- [ ] 将模型目录复核列入 provider/runtime guardrail，新增模型必须同时回答 UI、wire、default、unsupported 四项。

## Phase 4：验证矩阵

- [ ] 单测：selector 可见性、档位集合、Auto 语义、模型切换清理、未知档位 fail-closed（含 EffortSelectorDropdown 空/未知/缺失 levels 的组件测试，禁止回退写死全集）。
- [ ] 单测：Codex 新旧 `model/list` schema；5.6 max/xhigh 不被静默降级；unsupported 不外发。
- [ ] 单测：Sonnet 5 不发 manual thinking / 非默认 sampling；Kimi for Coding 只有 Auto/Max；GLM 只表达两档真值。
- [ ] `npm run test`。
- [ ] 真实 smoke：Claude Code × GLM/Kimi/Anthropic；Codex Runtime × Codex Account；Native × Anthropic/OpenAI-compatible。
- [ ] 每个 smoke 记录 Runtime / Provider / Model / UI 选择 / wire 参数 / 实际结果。

## 验收标准

- 用户在模型右侧看到的每个档位都有官方或运行时 source breadcrumb。
- UI 所选、session 持久化、发送参数、供应商实际档位四者一致；映射必须显式说明。
- 模型不支持或能力未知时隐藏/降级，不显示假选项。
- GPT-5.6、GLM-5.2、Kimi for Coding、Sonnet 5 各有至少一个真实凭据 smoke。
- 新模型不会改变旧会话已固定的 provider/model。

## Smoke Ledger

| Date | Runtime | Provider | Model | 凭据形态 | 场景 | Result | Evidence |
|---|---|---|---|---|---|---|---|
| 2026-07-17 | codex app-server probe | isolated/no login | gpt-5.6-sol/terra/luna | 无用户凭据 | initialize + model/list | ✅ 目录与新 schema 已确认；不代表账号 entitlement | codex-cli 0.144.2，本调研文档 POC |
| _待跑_ | codex_runtime | Codex Account | gpt-5.6-sol | real login | select effort → one turn | 📋 | |
| _待跑_ | claude_code | GLM Coding Plan | glm-5.2 | API key | high/max | 📋 | |
| _待跑_ | claude_code | Kimi Code | kimi-for-coding | API key | 固定展示名 + Auto/Max wire/default | 📋 | |
| _待跑_ | claude_code + native | Anthropic | claude-sonnet-5 | API key/login | adaptive + effort | 📋 | |
| _待跑_ | codepilot_runtime | OpenAI-compatible | supported model | API key | effort 透传/降级 | 📋 | |

## 决策日志

- 2026-07-17：调研确认 UI 组件已存在，计划定位为 capability / catalog / wire contract 收敛，不重做输入框。
- 2026-07-17：本地隔离 POC 确认 Codex 0.144.2 已列出 GPT-5.6，同时发现 `supportedReasoningEfforts[].reasoningEffort` schema drift；列为 Phase 0。
- 2026-07-17：Kimi for Coding 当前只承诺 Auto/Max；GLM 用实际 high/max 语义；拒绝统一菜单造成伪精度。
- 2026-07-17（用户最终取舍）：`Kimi for Coding` 作为用户可见的最新模型抽象，固定请求 `kimi-for-coding`；不展示或跟踪 K3 等底层版本，不新增显式 `k3` 内置入口，底层升级不触发目录改动。
- 2026-07-17（审查裁决）：接受 P2-3/P2-4——Phase 2 必须显式裁决 `agent-loop.ts:408-425` 的 Native effort 丢弃逻辑，EffortSelectorDropdown 五档硬编码回退列为伪档位来源进 Phase 0。P2-2 部分接受——Auto 定义为 CodePilot"不显式指定"语义；"Auto 默认落 Max"有 K3 文档 null/undefined → max 依据，但官方页面间存在版本描述冲突，渠道能力与 Auto 实际落点以 live smoke 定案；effort 下发链路不预设 env-only，需验证 `queryOptions.effort` 与 `CLAUDE_CODE_EFFORT_LEVEL` 优先级。Moonshot provider 改名明确 out-of-scope。展示决策不变。
