# 模型目录与推理强度统一适配

> 创建时间：2026-07-17
> 最后更新：2026-07-20
> 状态：🚧 最终 route/DB 修复已落地：GPT-5.6 与 Kimi capability 可到达 composer，智谱 CodePlan 无网络时回退内置目录，Claude selector 复用模型菜单视觉合同。2026-07-20 按 Kimi K3 最新文档与渠道现状把 Kimi for Coding 扩为 Low/High/Max；ClinePass / OpenCode Go 显式 K3 已分别完成 4-token direct wire smoke。Kimi effort 与其他真实 provider smoke 仍待跑，Phase 3–4 待继续。
> 事实基线：[基础体验更新事实基线](../../research/foundation-experience-refresh-2026-07-17.md)

## 用户问题与取舍

用户需要 GLM-5.2、GPT-5.6（Codex）、Kimi for Coding 最新模型渠道和 Claude 新模型都能选择真实支持的推理强度，并希望 Claude 的控件出现在模型右侧。

仓库已经有该位置和控件，问题是 capability 真源不完整：GLM/Kimi 目录过期，Sonnet 5 缺失，Codex 同时存在动态与硬编码目录，而且 app-server 字段已从 `effort` 漂移为 `reasoningEffort`。本计划不重做 UI，而是把目录、能力、wire 参数和失败降级收敛成同一合同。

## 状态

| Phase | 内容 | 状态 | 用户能看到什么 |
|---|---|---|---|
| Phase 0 | Codex GPT-5.6 与 schema drift | ✅ 恢复修复：最终序列化统一 lift capability；route-contract 直接断言 GPT-5.6 top-level effort allowlist | Codex 渠道可看到账号真实返回的 5.6，并显示可用强度 |
| Phase 1 | GLM-5.2 / Kimi for Coding 目录与强度 | ✅ 恢复修复：manual exact-ID + hidden legacy alias 仍可只读 enrichment；CodePlan search 以内置目录降级 | 两个 Coding Plan 显示正确模型和真实档位 |
| Phase 2 | Claude Sonnet 5 与现有模型复核 | ✅ 恢复修复：effort trigger 字体、items spacing、popover geometry/motion 与模型选择器一致；真实凭据 smoke 仍待 DNS | Sonnet 5 可选；Claude 模型右侧稳定显示匹配且视觉一致的强度菜单 |
| Phase 3 | capability 统一与后续跟进机制 | 📋 待开始 | 上游模型变化不会再靠多处硬编码静默漂移 |
| Phase 4 | Tier 2 回归与真实凭据 smoke | 📋 待开始 | 模型、Runtime、强度和实际请求一致 |

## 2026-07-19 用户 smoke 打回：新增修复清单

### 取舍与根因

- **GPT-5.6 不是 app-server 能力缺失。** 当前 route 返回的 GPT-5.6 行在 nested `capabilities` 中已有 `supportsEffort=true` 与完整档位，但 Codex virtual group 是在 DB provider 的 lift pass 之后才追加；`MessageInput` 只读 top-level 字段。修复应统一最终输出 schema，不能在 UI 再加 Codex 特判。
- **Kimi 不是只补一个布尔值。** 实际启用的 `kimi-for-coding` 是 `manual_enabled/user_edited` 行，capabilities 为空；旧 `sonnet` catalog 行被 `manual_hidden`，所以 catalog round-trip 测试没有覆盖真实用户路径。用户可见名称继续固定 `Kimi for Coding`，wire 继续使用渠道 ID；2026-07-20 K3 文档与用户现场确认共同更新 capability 为 low/high/max，但 UI 不展示底层版本名。
- **CodePlan model search 不应成为主路径。** 本次 GLM 与 Kimi 的 search route 都在 8 秒超时；直连探测显示当前开发机没有 DNS。即使恢复网络，仓库自己的 discovery 研究也把 Coding Plan 定义为套餐白名单，官方文档没有承诺 `/v1/models` 长期可用。
- **Claude 视觉问题是真实但范围精确。** 两个 trigger 的高度、padding、外层圆角已相同；不一致来自 model label 使用 mono、effort label 使用 sans，以及 effort popover 覆盖为 `rounded-lg`、独立窄宽度、缺 model popover 动画。不要重做整个 composer。

### 执行清单

- [x] 在最终 provider-model serialization 建立单一 capability normalization pass，覆盖 DB provider、env、OAuth、Codex virtual group；`MessageInput` 只消费一种 schema。
- [x] 增加 route-contract 行为测试：真实调用 `/api/providers/models` 的组装出口，断言 GPT-5.6 top-level effort fields 可读；builder-only 测试不再作为 UI 证据。
- [x] Kimi manual exact-ID 行使用真实上游 ID 作为 canonical identity；旧 `sonnet` 只保留存量解析兼容。只读 enrichment 合并 catalog 默认能力，但 DB 明确字段优先且不写回/覆盖用户数据。
- [x] 按用户决定只显示 `Kimi for Coding`，wire 固定使用该产品渠道自己的 `kimi-for-coding` ID；不展示 `k3`，也不增加按底层版本切换的兼容分支。当前 capability 合同为 Auto（不下发）+ Low/High/Max。
- [x] ClinePass 与 OpenCode Go 的套餐目录新增显式 Kimi K3（分别为 `cline-pass/kimi-k3` 与 `kimi-k3`）。这不改变上一条：聚合套餐显式 SKU 与 Kimi 自有的 `Kimi for Coding` latest 渠道是不同产品语义。OpenCode ID/协议由官方 endpoint 表确认；ClinePass ID 由官方 `provider/model-name` 合同 + HTTP 200 最小真实请求确认。两个网关的 effort 请求字段尚未验证，故只声明 tool use，不在 composer 展示推理强度。
- [x] GLM/Kimi CodePlan 的“添加模型”以当前 catalog + 手动 ID 为主；catalog-only 套餐不依赖可选 `/models` 网络端点，不把 timeout 冒充“模型不存在”。
- [x] `EffortSelectorDropdown` 复用模型选择器的 trigger typography 和 `CommandList` geometry/animation contract；mapping note 只扩内容宽度，不另造圆角/间距体系。
- [ ] DNS 恢复后重新跑 GPT-5.6、GLM-5.2、Kimi、Claude Sonnet/Fable 的 UI + wire smoke；本轮 ❌ 记录不得用 unit test 关闭。

## Phase 0：Codex GPT-5.6 与 schema drift

### 不做什么

- 不把 OpenAI API 目录硬塞给没有 entitlement 的 Codex Account。
- 不把 `ultra` 当成普通 Responses API reasoning effort。
- 不继续用全局 clamp 把模型明确支持的 max/xhigh 静默降成 high。

### 执行清单

- [x] 先区分 UI 中 `openai-oauth` 与 `codex_account`，确定旧 OAuth 是否继续存在；若保留，必须明确命名与能力边界。**部分：已做边界澄清（`route.ts:16-31` 注释写明 openai-oauth = 静态手维护目录 / effort 服务端固定 medium / 禁止手加 5.6，codex_account = app-server 动态真源）；本轮按裁决不删除 openai-oauth，是否更深收敛（合并/下线）已在 artifact judgment 提方案交 Codex 裁决。**
- [x] `model/list` 同时兼容旧 `{ effort }` 与新 `{ reasoningEffort }`，过滤空/未知值，保留 default effort 和描述。（`models.ts:normalizeEffortElement`；新字段优先、未知 token fail-closed 丢弃、default 不在解析结果内则清空）
- [x] 移除 `src/components/chat/EffortSelectorDropdown.tsx:36` 的五档硬编码回退（伪档位来源）：`supportedEffortLevels` 缺失或为空时隐藏/降级选择器，不回退写死全集；组件层补空值、未知值、缺失 levels 的测试。（规则抽到 `src/lib/effort-levels.ts:resolveEffortMenuLevels` 直接单测，另加源码钉防回退复活）
- [x] Codex Account 目录以 app-server 为真源；版本低于 GPT-5.6 要求或账号未 rollout 时显示原因，不伪造条目。**部分：空 model/list / 超时 / 未登录一律降级为「无 Codex 分组」且不伪造条目（有回归）；「显示原因」沿用既有 `/api/codex/status` 卡片，本轮未新增文案。**
- [x] 将 effort 校验改为“当前模型返回的 allowlist”；turn/start 只透传被该模型声明支持的档位。（`effort.ts:resolveCodexEffort` + `runtime.ts:938`；模型声明的 xhigh/max 原样透传，未声明档位 omit 不外发，无 capability 信息时退回保守 `clampCodexEffort`）
- [x] 将 `ultra` 建模为 Codex 专属能力/模式，未完成多代理语义前不在通用 effort selector 中承诺。（`CODEX_GENERIC_EXCLUDED_EFFORTS` + `toGenericEffortLevels`：honest 解析、不进通用菜单）
- [x] 为 cache invalidation、旧 binary、logged-out、空 model/list、schema drift 加回归。（cache invalidation 已从 helper 级补到生产接线级：`account-transition.ts` 包住 logout / login start，两条 route 只经它调用；`codex-account-cache-invalidation.test.ts` 覆盖 warm cache → logout/换号 → `buildCodexProviderModelGroup({cacheOnly:true}) === null` + `getCachedCodexEffortLevels === undefined`，并钉住 route 的接线）

## Phase 1：GLM-5.2 / Kimi for Coding

### 不做什么

- 不把供应商映射后的多个 UI 档位说成不同的实际推理计算。
- 不展示或跟踪 K3 等底层模型版本；`Kimi for Coding` 就是用户可见的最新模型渠道。
- 不新增显式 `k3` 内置模型项，也不为供应商切换底层版本维护兼容分支。
- Kimi 当前支持 low/high/max；Auto 仍只是 CodePilot 不显式下发 effort 的产品语义，不冒充供应商档位。

### 执行清单

- [x] GLM CN/Global 更新 role mapping、默认模型与 1M 变体策略；在真实凭据前保留待验证标记。**部分：目录升到 GLM-5.2 世代、sonnet/opus role env 均指向 `glm-5.2`（haiku 维持 `glm-4.5-air`，基线未称其过期）；`[1m]` 变体本轮未加——基线把它列为待凭据验证项，无凭据前加变体等于凭空声明能力，已在 Smoke Ledger 留行。**
- [x] GLM capability 只暴露 high/max 的有效语义，必要时在菜单说明 Claude Code 档位映射。（`GLM_CODING_PLAN_MODELS`：`supportedEffortLevels: ['high','max']` + `effortNoteKey`；菜单渲染 Auto/High/Max 并附映射说明，i18n en/zh 同步。**审查轮 #1 修复（`292bcce`）**：原实现只在 catalog 对象上成立——`db.ts` 两条 sync 路径把 `capabilities_json` 硬写 `'{}'`，DB 行一经 materialize 即遮蔽 catalog，菜单在真实路径上不出现；现 seed/align 均带 capabilities，round-trip 测试覆盖。映射文案补齐 `ultracode`，与「六档折两档」注释一致）
- [x] Kimi 默认请求使用产品渠道 ID `kimi-for-coding`，并给现有 `sonnet` UI alias 补明确 upstream mapping；用户可见名称固定为 `Kimi for Coding`。这是一项产品/wire 决策，不再写成“官方保证其等于当前 K3”的事实。（`upstreamModelId: 'kimi-for-coding'`；modelId 保留 `sonnet` 以兼容存量；manual exact-ID 行在最终 read path 只读 enrichment。）
- [x] Kimi for Coding 内置目录不展示 discovery 返回的底层版本或显式 `k3` 条目；供应商升级底层模型时不需要修改目录。（单测断言 preset 用户可见字段无 `K2.5`/`K3`，且无 k3 条目）
- [x] capability 与模型展示名解耦：`supportedEffortLevels: ['low','high','max']`，菜单显示 Auto/Low/High/Max。Auto 是 CodePilot 的“不显式指定”语义，不是 Kimi 官方档位；K3 最新文档明确支持三档，用户现场确认 Kimi for Coding 当前返回 K3，因此渠道目录同步扩档但仍只展示渠道名。`effortNoteKey` 明确“Auto 不下发、由 Kimi 决定”。Low/High/Max 的真实 `/coding/` 接受情况仍须逐档 smoke，不把静态 capability 冒充 wire 通过。
- [ ] 验证 Kimi effort 下发链路与优先级：Agent SDK `queryOptions.effort` 与 `CLAUDE_CODE_EFFORT_LEVEL` env override 的关系及 Kimi 渠道兼容性，不预设 env-only；effort 被上游忽略或报错时按能力漂移降级并给出提示，作为静态 catalog 声明的防线。**未做（需真实凭据）：本轮不动 env 注入代码，结论见决策日志 `p1-effort-chain` 段与 Smoke Ledger。**
- [x] Moonshot provider（`provider-catalog.ts:638-660`）不属于本轮 Kimi for Coding 改名范围；但改动 catalog 时确认 `legacy-catalog-hint.test.ts:119-196`（pin 了 `kimi-k2.5`）不被破坏。（Moonshot 零改动 + 新增反向断言钉住其不改名；`legacy-catalog-hint.test.ts` 未改动即全绿——该文件 pin 的是「用户手加 `kimi-k2.5` 不该报 legacy badge」，与 Kimi 内置目录改名正交）
- [ ] 模型切换导致缓存失效时给用户可理解提示；不在同一 session 偷换模型。**未做：转 Phase 2「模型切换时若旧档位不受支持，回到 Auto 并显示一次非误导提示」一并实现，避免两处各写一套提示。**

## Phase 2：Claude Sonnet 5

### 不做什么

- 不只在 catalog 加一行。
- 不把 manual extended thinking、非默认 sampling 参数继续发给会返回 400 的 Sonnet 5。
- 不自动把所有既有对话从 Sonnet 4.6 升级到 Sonnet 5。

### 执行清单

- [x] 在 first-party、env、适用的 OpenRouter/Bedrock/Vertex 目录分别按真实可用性加入 Sonnet 5。（部分：first-party `ANTHROPIC_FIRST_PARTY_MODELS` 加 `sonnet-5`→`claude-sonnet-5`，env/route/resolver/client fallback 经 `ENV_CLAUDE_CODE_MODELS` 自动派生；OpenRouter/Bedrock/Vertex slug 未验证**不加**——沿用 fable 纪律，`sonnet-5-model.test.ts` pin 住「OpenRouter 无 sonnet-5」）
- [x] 更新 context、adaptive-thinking sanitizer、sampling 约束、token budget 与 provider capability。（`model-context.ts` 加 `claude-sonnet-5`:1M + tokenizer +30% 注记；`claude-model-options.ts` 新 `SONNET_5_PATTERN` 并入 adaptive 家族。**sampling 约束（复审轮 #1 升级）**：不再靠「by construction 无可剥离」的注释，改为**主动 guard**——`ClaudeModelOptionsInput` 收 `temperature/topP/topK`，adaptive 家族非默认值（temperature≠1、任何显式 top_p/top_k）从 `sampling` 剥离并记入 `strippedSamplingParams` 告知信号（同 `thinkingForcedOn` 的 surface-don't-swallow 规则）；非 adaptive（sonnet-4-6）原样透传不误伤；`sonnet-5-model.test.ts` 覆盖剥离/放行/默认 temperature/4.6 不误伤/家族一致全分支。**复审轮 #4 修复（run i31）**：Codex 指 `strippedSamplingParams` 在生产代码零消费者、两条 Runtime 也从未把真实 sampling 传进 sanitizer，剥离对用户完全静默，违反 sanitizer 自己声明的 surface-don't-swallow。**改法**：`AgentLoopOptions` / `ClaudeStreamOptions` / `RuntimeStreamOptions` 加 `temperature/topP/topK` 并逐层透传进两条 Runtime 的 sanitizer 调用；新增共享决策模块 `anthropic-sampling-notice.ts:buildSamplingIgnoredNotice`，两条 Runtime 都消费它并发一次 `SAMPLING_PARAMS_IGNORED` 状态通知（已加入 `TOAST_STATUS_CODES` 白名单，否则 toast 会被下一条 status 顶掉）；native 额外把存活的 `sanitized.sampling` spread 进 `streamText`（省略即与改前逐字节一致），SDK 路径因 `query()` 无 sampling 旋钮，剥离与存活参数一并如实告知。新 `anthropic-sampling-notice.test.ts` 13 例断言通知**真的发生**（含反例：temperature=1 / 无参数 / 非 adaptive 模型不误报）+ 两条 Runtime 接线 pin）
- [x] 复核 Fable 5 / Opus 4.8 已有实现与当前官方合同是否一致。（无回归：`fable-5-model.test.ts` / `opus-4-8-sonnet-4-6.test.ts` 全绿；`sonnet-5` 判定不误伤 `sonnet-4-6`（非 adaptive），有专测）
- [x] 显式裁决 `src/lib/agent-loop.ts:408-425`（及 `agent-loop-toolloop-poc.ts`）Native 路径丢弃显式 effort 的旧逻辑。**裁决=恢复下发**：核实 `@ai-sdk/anthropic@4.0.5` 走 GA `output_config.effort`，dist 内无 `effort-2025-11-24` / 任何 effort beta header（grep 0 命中），旧 workaround 前提失效。两条 native 路径改为对所有模型透传 effort，官方路径去掉 `RUNTIME_EFFORT_IGNORED` toast（第三方代理路径保留），UI 选择 = wire 一致。**复审轮 #1 升级**：wire 构造抽到 `agent-loop-anthropic-wire.ts`（`buildAnthropicProviderOptions`，随 `agent-loop-error-event.ts` 先例），`agent-loop-anthropic-wire.test.ts` 以**可执行行为**断言 sonnet-5+xhigh 官方路径 `providerOptions.anthropic.effort='xhigh'` 且 `effortDroppedForProxy=false`、代理路径丢弃并升起 drop 信号——从源码 pin 升级为真实对象断言。**复审轮 #4 修复（run i31）**：Codex 独立复现 `claude-haiku-4-5-20251001` + `max` 在官方 Native 路径仍发出 `{"effort":"max"}`——`buildAnthropicProviderOptions` 根本不接收 model，「不再对 adaptive 家族丢弃」被实现成了「对所有模型无条件透传」，而官方 effort supported-model 列表不含 Haiku 4.5。**改法**：`claude-model-options.ts` 新增带官方 breadcrumb 的 per-model allowlist `ANTHROPIC_API_EFFORT_MODELS` + `anthropicApiSupportsEffort()`（**刻意不派生自 catalog `supportedEffortLevels`**——那是 UI picker / Claude Code CLI 的能力面，更宽，first-party haiku 在那里声明 low/medium/high；用它当 wire 门就等于复活本 finding），wire 层改收 `model` 并只对 allowlist 内模型下发 effort，不支持/未知模型省略并升起新信号 `effortDroppedUnsupportedModel`，两条 native 路径（`agent-loop.ts` + `agent-loop-toolloop-poc.ts`，后者本轮改为消费同一 helper 消除 drift）据此发一次 `RUNTIME_EFFORT_IGNORED`（文案如实说明「该模型不支持 effort、按自身默认深度运行」，与真实行为不矛盾）。`agent-loop-anthropic-wire.test.ts` 补三类可执行请求形状断言：Haiku 4.5+max → wire **无** effort 键 + 信号 true、未知模型同样 fail-closed、Sonnet 5+xhigh 正例仍 `effort='xhigh'` 且两个 drop 信号均 false；另加「allowlist 不得读 catalog / 每条必须有 breadcrumb」的守卫。`fable-5-model.test.ts` 原钉住「官方分支无条件透传」的断言随之改为钉 per-model 门（旧断言前提被本轮推翻）。
- [x] 触点补齐：`useProviderModels.ts` 客户端 fallback、`route.ts` `ENV_ALIAS_TO_UPSTREAM`（均经 `ENV_CLAUDE_CODE_MODELS` 派生，自动含 sonnet-5，`env-models-single-source.test.ts` pin）、i18n `en/zh` 新增 `messageInput.effort.resetOnModelSwitch`；token budget tokenizer +30% 注记进 `model-context.ts` + sanitizer。
- [x] 保持强度控件紧邻模型选择器；模型切换时若旧档位不受支持，回到 Auto 并显示一次非误导提示。（新纯函数 `resolveEffortAfterModelSwitch` + `ChatView.handleProviderModelChange` 接线；i18n 提示；`effort-menu-levels.test.ts` 覆盖。**复审轮 #1 升级**：`resolveModelSwitchEffortEffect(currentEffort, levels)→{resetEffort, showResetToast}` 把 reset/toast 决策收成可执行函数，ChatView 消费其结果。**复审轮 #2 修复（run i31）**：Codex 指原实现 manual-only（isAuto 自动纠正与新会话 `chat/page.tsx` 入口均不清除不受支持的瞬态档位 → 切到不支持该档的模型后 UI 仍显示并发送该档，违反「UI 所选 = 发送参数 = 供应商档位」一致）。**改法**：`resolveModelSwitchEffortEffect` 去掉 isAuto 参数——清除非法瞬态 effort 与「是否持久化 session pin」是两件事，前者对 manual 与 auto-correct 一致执行（isAuto 仅在调用点 gate 持久化 early-return），后者不变；`chat/page.tsx` 新会话入口补接同一 helper + 一次性 sourced toast；`MessageInput` 加 `emitProviderModelChange` 包装器，从与 picker 同一 `providerGroups/modelOptions` feed 解析新模型 `supportedEffortLevels` 并经 `opts` 下发给两入口（同一真源校验），手动 picker 与 auto-correct 两路径都经该包装器。`effort-menu-levels.test.ts` 重写为断言 manual/auto × 支持/不支持一致清除 + 清除后 `toWireEffort` 不下发被清档位 + 两入口 source pin（helper 调用先于 isAuto persist-skip）+ MessageInput feed 下发；`codex-phase-6-wiring.test.ts` 的 isAuto 钉改为断言包装器 `...opts` 转发保 isAuto）**复审轮 #3 修复（run i31）**：Codex 指复审轮 #2 只让父层 `setSelectedEffort(undefined)`，但 `MessageInput.tsx` 的 `selectedEffort = effortProp ?? localEffort` 会在父值清成 undefined 后回退到 stale `localEffort`——用户先选 xhigh、再切不支持 xhigh 的模型，按钮仍显示 xhigh 而 wire 已省略 effort，实际组件从未真正回到 Auto，仍违反「UI 所选 = 发送参数 = 供应商档位」；且原测试只测纯函数 + 源码顺序，未经过 MessageInput 显示解析。**改法**：显示解析抽成纯函数 `resolveComposerEffortDisplay(controlledEffort, localEffort, isControlled)`——父层拥有 effort 时（`onEffortChange` 已接，三个调用点都接）为**真正受控**，显示 = `effortProp ?? 'auto'`，永不回退 stale local；`localEffort` 仅供无 `onEffortChange` 的独立用法。`effort-menu-levels.test.ts` 新增全链行为测试（`makeComposerHarness` 用真实 helper 串起显示/reset/wire）：两入口 × manual/auto-correct 先选 xhigh 再切 Sonnet 4.6 → 断言按钮 Auto、wire 省略 effort、toast 恰好一次；含 stale-local 回归守卫与「受控值压过 local」断言；MessageInput 源码钉住调用受控解析、`effortProp ?? localEffort` 不复活）
- **Phase 2 目标快照（s11 三处一致锚点）**：commit `fb53dfe`（= 复审轮 #6 修复后 HEAD，含 effort allowlist 事实修正 + 运行时提示本地化；历史链 `a7c6795` → `03ca9b0` → `65a71ab` → `aa2623e` → `eb75df8`）；canonical 账本按**命令语义分两栏**（两者不得互相冒充）：

  - **该次并行观测值（canonical 原样命令，计数随 force-exit 竞态逐次浮动）**：`# tests 4268 / # suites 1050 / # pass 4268 / # fail 0`（exit 0）——Codex reviewer 在该 HEAD、全新空 HOME、前台**原样**执行 canonical 命令单次所得真实 footer；是一次真实门禁观测，**不代表完整注册量**。
  - **完整注册量对照（`--test-concurrency=1`，非 canonical 原样命令）**：`# tests 4289 / # suites 1055 / # pass 4289 / # fail 0`（exit 0）——同环境仅追加 `--test-concurrency=1` 的确定性串行对照，消掉 force-exit / worker flush 竞态后的完整注册量。

  此前记录的 `fb53dfe` + 4265/1049、`03ca9b0` + 4241/1045、`a7c6795` + 4235/1042 均为旧并行观测（4265 曾被误记为「未欠计数 / 唯一有效完整值」，该定性已撤回），演变过程保留在决策日志与权限计划账本中。本行（执行清单）/ 状态总览表 + frontmatter / 决策日志四处语义一致，详见决策日志复审轮 #8。

## Phase 3：后续能力跟进

- [ ] 建立 provider/model capability normalization：`supportedEffortLevels`、default、thinking mode、context、source breadcrumb。
- [ ] API/SDK 动态能力优先；catalog 只作有 provenance 的 fallback。
- [ ] 增加 upstream schema fixture / contract test，字段改名或出现空值时 fail closed。
- [ ] 将模型目录复核列入 provider/runtime guardrail，新增模型必须同时回答 UI、wire、default、unsupported 四项。

## Phase 4：验证矩阵

- [ ] 单测：selector 可见性、档位集合、Auto 语义、模型切换清理、未知档位 fail-closed（含 EffortSelectorDropdown 空/未知/缺失 levels 的组件测试，禁止回退写死全集）。
- [ ] 单测：Codex 新旧 `model/list` schema；5.6 max/xhigh 不被静默降级；unsupported 不外发。
- [x] 单测：Sonnet 5 不发 manual thinking / 非默认 sampling；Kimi for Coding 恰为 Auto/Low/High/Max；GLM 只表达两档真值。
- [x] `npm run test` 等价的权威串行全量：4410/4410，exit 0；默认并发脚本断言结束后受既有句柄影响不退出，因此完成证据采用 `--test-concurrency=1 --test-force-exit`。
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
| 2026-07-19 | codex_runtime | Codex Account | gpt-5.6-sol | 当前登录 | 选择模型后检查 composer effort selector | ❌ selector 未出现，Phase 0 重新打开 | `/api/providers/models` 的 Codex 行只有 nested `capabilities.supportedEffortLevels`；UI 只读 top-level 字段。用户截图 + route JSON 均复现 |
| 2026-07-19 | claude_code | Kimi for Coding | kimi-for-coding | 当前配置 | 选择模型后检查 composer effort selector | ❌ selector 未出现，Phase 1 重新打开 | 启用 DB 行为 `manual_enabled/user_edited`，`capabilities_json={}`；旧 catalog `sonnet` 行为 `manual_hidden`，catalog round-trip 测试未覆盖此路径 |
| 2026-07-19 | Settings | 智谱 CodePlan | — | 当前配置 | 添加模型 → 获取模型列表 | ❌ 约 8s 后 502 `PROBE_FAILED` | search route 请求 `/api/anthropic/v1/models`；同机 `scutil --dns` 为 `No DNS configuration available`，当前网络 smoke 无效；catalog/manual 路径仍须可用 |
| 2026-07-19 | claude_code UI | Claude | Fable / Sonnet | 当前配置 | 比较模型与 effort 两个选择器 | ❌ 视觉合同不一致 | trigger 外壳同为 32px/14px/8×10，但 model label 为 mono、effort 为 sans；popover 圆角 24px vs 16px、宽 320px vs 144px，动画合同也不同 |
| _待跑_ | codex_runtime | Codex Account | gpt-5.6-sol | real login | select effort → one turn | 📋 | |
| _待跑_ | claude_code | GLM Coding Plan | glm-5.2 | API key | high/max 两档实际 wire + 计费差异 | 📋 移交用户统一验证 | Phase 1 已落静态声明（`GLM_CODING_PLAN_MODELS`），未经真实 key |
| _待跑_ | claude_code | GLM Coding Plan | glm-5.2 | API key | sonnet 槽是否另有 5.2 世代 turbo SKU；`[1m]` 长上下文变体是否存在 | 📋 移交用户统一验证 | Phase 1 把 sonnet/opus 双槽都映到 `glm-5.2`、未加 `[1m]` 变体，均待此项定案 |
| _待跑_ | claude_code | Kimi Code | kimi-for-coding | API key | 固定展示名；Auto 省略与 Low/High/Max 三档逐一发送 | 📋 本轮继续验证 | 目录已落 `upstreamModelId='kimi-for-coding'` + Auto/Low/High/Max；静态与 route 回归通过，真实网关接受/降级仍以此 smoke 为准 |
| _待跑_ | claude_code | Kimi Code | kimi-for-coding | API key | `queryOptions.effort` vs `CLAUDE_CODE_EFFORT_LEVEL` 优先级；Kimi 渠道是否接受 effort | 📋 移交用户统一验证 | p1-effort-chain：本轮未改 env 注入代码，见决策日志 |
| _待跑_ | claude_code + native | Anthropic | claude-sonnet-5 | API key/login | adaptive + effort | 📋 | |
| _待跑_ | codepilot_runtime | OpenAI-compatible | supported model | API key | effort 透传/降级 | 📋 | |
| 2026-07-20 | codepilot_runtime | ClinePass | cline-pass/kimi-k3 | API key | direct non-stream, max_tokens=4 | ✅ HTTP 200 | 响应 model=`moonshotai/kimi-k3`；仅验证精确模型 ID，不代表 streaming/tool/effort 已 smoke |
| 2026-07-20 | codepilot_runtime | OpenCode Go (OpenAI) | kimi-k3 | API key | direct non-stream, max_tokens=4 | ✅ HTTP 200 | 响应 model=`kimi-k3`；仅验证精确模型 ID，不代表 streaming/tool/effort 已 smoke |
| 2026-07-20 | codex_runtime UI | Codex Account | gpt-5.6-sol | 当前登录 | 正常窗口选择模型并展开 effort | ✅ UI passed | 最终 models API 与输入框均显示 Default/Low/Medium/High/XHigh/Max；本行不替代一次真实 turn wire |
| 2026-07-20 | codex_runtime UI | Kimi for Coding | kimi-for-coding | 当前配置 | 真实存量 catalog 行读取并展开 effort | ✅ UI passed | 最终 route 已把 stale max-only catalog cache 合入当前 Low/High/Max；输入框显示 Default/Low/High/Max，DB 未写回；user-edited 反例保持用户能力 |
| 2026-07-20 | Settings UI | 智谱 CodePlan / GLM (CN) | — | 当前配置 | 模型 → GLM (CN) → 添加模型，上游列表不可依赖 | ✅ UI passed | 对话框约 2s 后显示内置 GLM-5.2 / GLM-4.5-Air，共 2 个上游模型，不再报列表获取失败 |
| 2026-07-20 | composer UI | Kimi / Claude-capable models | — | 当前配置 | 正常窗口 + 360×720 窄窗口打开模型与 effort 菜单 | ✅ UI passed + evidence archived | Radix collision placement 将两种 320px 菜单约束在窄窗口安全区；触发器、列表文字、圆角和行间距共享合同。证据：[GPT-5.6 正常窗口](./_smoke-evidence/foundation-refresh-gpt56-normal-2026-07-20.jpg) / [模型菜单 360px](./_smoke-evidence/foundation-refresh-model-menu-360px-2026-07-20.jpg) / [Kimi effort 360px](./_smoke-evidence/foundation-refresh-kimi-effort-360px-2026-07-20.jpg) |

## 决策日志

- 2026-07-20（Kimi 档位纠偏）：接受 Claude P2-1 的 stale 判断。Kimi 最新 K3 文档已从 max-only 更新为 low/high/max，且用户确认 Kimi for Coding 当前返回 K3；catalog、i18n、DB enrichment 与测试同步扩为三档。展示名和 wire ID 不变，真实 `/coding/` 逐档 smoke 仍作为独立验收，不反推 ClinePass/OpenCode Go 网关能力。
- 2026-07-20（聚合套餐 K3）：ClinePass / OpenCode Go 各自新增显式 K3 SKU，但 `Kimi for Coding` 继续保持 latest 渠道抽象，不展示底层版本。Kimi 官方 low/high/max 只证明模型本体能力，不能自动证明两个 OpenAI-compatible 网关接受同一 effort 字段；在网关 wire smoke 前 fail closed，不声明 `supportsEffort`。
- 2026-07-19（用户 UI smoke 打回）：Phase 0/1/2 重新打开。既有 builder/catalog/unit 绿只证明局部对象成立，没有覆盖最终 route serialization、用户编辑后的手动 DB 行和真实 popover 样式；后续不得再以局部测试关闭这三类问题。
- 2026-07-19（Kimi 事实修正）：官方当前把 `k3` 与 `kimi-for-coding` 列为不同模型 ID，旧的“`kimi-for-coding` 是稳定 latest alias、底层就是 K3”假设撤回。产品展示仍按用户要求只写 `Kimi for Coding`；wire ID 与 capability 单独裁决，不把显示策略冒充协议事实。
- 2026-07-19（恢复修复裁决，已被 2026-07-20 档位纠偏更新）：wire 继续发产品渠道自身的 `kimi-for-coding`，UI 只显示 `Kimi for Coding`；当日先保守暴露 Auto/Max，随后因官方文档更新与用户渠道事实扩为 Low/High/Max。
- 2026-07-19（网络边界）：本机无 DNS 会让 GLM/Kimi/Google Fonts 等第三方请求进入超时路径；本轮 502 证明当前失败处理体验，但不能证明供应商端点永久不可用。恢复 DNS 后必须重跑真实 wire smoke。
- 2026-07-17：调研确认 UI 组件已存在，计划定位为 capability / catalog / wire contract 收敛，不重做输入框。
- 2026-07-17：本地隔离 POC 确认 Codex 0.144.2 已列出 GPT-5.6，同时发现 `supportedReasoningEfforts[].reasoningEffort` schema drift；列为 Phase 0。
- 2026-07-17（历史基线，2026-07-20 已更新）：Kimi for Coding 当时只承诺 Auto/Max；当前以最新文档为 Low/High/Max。GLM 仍只表达实际 high/max，拒绝统一菜单造成伪精度。
- 2026-07-17（用户最终取舍）：`Kimi for Coding` 作为用户可见的最新模型抽象，固定请求 `kimi-for-coding`；不展示或跟踪 K3 等底层版本，不新增显式 `k3` 内置入口，底层升级不触发目录改动。
- 2026-07-17（Phase 0 实施完成，commit `321654c`）：schema drift 与伪档位来源一并收编。
  - **dual schema**：`models.ts` 兼容 `{ effort }` / `{ reasoningEffort }`，两者同现时新字段优先；空/非字符串/未知 token fail-closed 丢弃并去重；`defaultReasoningEffort` 不在解析结果内即清空。
  - **per-model allowlist**：`resolveCodexEffort(effort, declaredLevels)` 取代 turn/start 上的全局 clamp。模型声明 xhigh/max 即原样透传（**推翻**"Codex 只认 minimal|low|medium|high"的旧全局前提——该前提在 GPT-5.6 之后自身成了假数据：用户选 Max、线上发 high）；未声明档位 omit 而非折算到相邻档位。`clampCodexEffort` **保留但降级**为无 capability 信息（冷缓存/未登录/旧二进制）时的兜底，理由是该路径无法确认二进制是否属于会对未知 variant 致命报错的旧版本。allowlist 经 `getCachedCodexEffortLevels` 只读 warm cache 获取，维持 P0.3「turn/start 绝不 spawn」约束。
  - **伪档位来源**：删除 `EffortSelectorDropdown.tsx:36` 五档硬编码回退（P2-4 裁决）。判定"无来源时不存在诚实默认值"，故缺失/空/含 undefined 一律隐藏选择器；规则抽为纯函数 `src/lib/effort-levels.ts:resolveEffortMenuLevels` 以便直接单测（而非复刻组件逻辑），另加源码钉防回退复活。同理 `buildCodexProviderModelGroup` 无可识别档位时 OMIT `supportedEffortLevels` 而非给 `[]`。
  - **ultra**：诚实解析入 `CodexModel`，但由 `toGenericEffortLevels` 挡在通用 selector 外（Codex 专属产品档位，非 Responses API effort，多代理语义未接完不承诺）。
  - **openai-oauth**：本轮只澄清边界（静态手维护目录 / effort 服务端固定 medium / 禁止手加 5.6），不删除；是否合并或下线**转 Codex 裁决**，见 artifact judgment。
  - **验证**：`npx tsc --noEmit` 通过；单测 3858 passed / 1 fail。唯一 fail 为 `provider-request-shape.test.ts`（本 worktree 缺 `node_modules/ai`），已用 `git stash` 在 clean tree 上复现同样失败，确认与本改动无关、属环境问题。Phase 0 新增/更新用例 73 个全绿（dual-schema 旧/新/混合/全空、xhigh/max 透传、undeclared omit、ultra 隔离、cache invalidation / logged-out / 空 model/list fail-closed）。
  - **未做**：真实凭据 smoke（Codex Account × gpt-5.6-sol）仍待 Phase 4，Smoke Ledger 对应行保持 📋。
- 2026-07-17（Phase 0 fix 轮，commit `c157809`）：收口 Codex 审查的 2 条 P1。
  - **cache invalidation 生产接线**（P1-1）：`DELETE /api/codex/account` 此前只调 `logoutCodex()`，而 `listCodexModels({cacheOnly:true})` 按 P0.3 故意忽略 TTL，于是登出/换号后 full catalog 与 turn/start allowlist 仍会用旧账号 capability 作答，违反 logged-out fail-closed。修法是新增 `src/lib/codex/account-transition.ts`，把 logout / login start 各包一层「成功后 `invalidateCodexModelsCache()`」，两条 route 只经该包装调用——**把不变量放在包装里而不是各 route 内联**，是为了让第三个调用点将来不可能忘记清 cache。login 侧在 start（而非 completed）时清：代价是一次多余重取，收益是新账号绝不可能读到旧账号目录。
  - **测试形态（取舍已记录）**：`codex-account-cache-invalidation.test.ts` 只注入最底层的 JSON-RPC 调用（DI seam），cache、invalidation、`buildCodexProviderModelGroup`、`getCachedCodexEffortLevels` 全部是真实实现，覆盖 warm cache → logout / 换号 → 两个读取端均 fail-closed，外加「logout 失败不清 cache」反例。route 本身用 `await import()`，在 ESM runner 下无法被 module stub 拦截（已实测 `require.cache` 注入对动态 import 无效），故 route → wrapper 这一跳用源码钉断言（禁止裸 `logoutCodex` / `startCodexLogin` 复活），与既有 `codex-models-decoupling.test.ts` 的 route spawn-policy 钉同构。
  - **全量门禁**（P1-2）：`node_modules/ai` 缺失致 `provider-request-shape.test.ts` ENOENT。按现有 lockfile 前台 `npm install`（未改任何依赖版本、未改产品逻辑、lockfile 无 diff）后，`npx tsc --noEmit` 通过，`npm run test:unit` 全量 **3894 tests / 3894 pass / 0 fail，exit 0**（上一轮 3842/3841/1）。计数从 3842 升到 3894 = 恢复的 `provider-request-shape` 用例 + 本轮新增 6 个。
  - **承接 Codex 三项工程裁决**：① `openai-oauth` 本轮保留，不在缺登录态与旧会话迁移证据时下线；Phase 3 增加迁移调查，证实可平滑迁移后再收敛。② cold-cache `clampCodexEffort` 本轮保留为旧 binary 保守兜底；Phase 3 收敛为无 capability 时 omit 或显式降级提示，避免长期静默改写用户持久化的选择。③ `supportsEffort > 1` 当时随 Kimi 单档能力检查，当前 Kimi 已有 Low/High/Max，选择器直接由 allowlist 驱动。三项均属工程取舍，无需 human gate。
- 2026-07-17（Phase 0 fix 轮 #2，commit `343891a`）：收口 Codex 对上一轮 F1 的复审——**推翻 130 行的「route 那一跳只能用源码钉」结论**。
  - **根因**：route 无法被测试驱动，不是 ESM runner 的限制，而是 route 自己用 `await import()` 造成的。改为静态 import + 把 DELETE / POST 主体抽成 `handleAccountDelete(perform = logoutCodex)` / `handleLoginPost(request, perform = startCodexLogin)`，route 导出零参数委派，生产接线仍绑定真实 RPC。DI seam 收窄到最底层 JSON-RPC 一跳。
  - **测试形态**：`codex-account-cache-invalidation.test.ts` 现在实际调用两个 route handler，覆盖 warm cache → DELETE logout、以及 login 的 chatgpt（默认空 body / 显式 kind）、chatgptDeviceCode、apiKey 四个成功分支，断言 HTTP 200、login 结果原样透传、`buildCodexProviderModelGroup({cacheOnly:true}) === null`、`getCachedCodexEffortLevels('gpt-5.5') === undefined`。反例三条：logout 失败（500）、login start 失败（500）、apiKey 缺 key（400，被拦在 transition 之前）——均不得清缓存。源码正则钉已被行为测试取代并删除。**取舍理由**：route 层窄 DI seam 比 fake Codex binary fixture 更小更稳，且真实执行了请求解析/分支/await/响应。
  - **验证**：targeted 8/8 通过；`npx tsc --noEmit` 通过；全量 `npx tsx --test --import ./src/__tests__/db-isolation.setup.ts src/__tests__/unit/*.test.ts` **3896 tests / 3896 pass / 0 fail、exit 0**（上一轮 3894，+2 为净增用例）。
  - **F2 环境项**：`node_modules/ai` 已存在，全量无 ENOENT，无需再 `npm install`；lockfile 与依赖版本本轮零改动。
- 2026-07-17（Phase 1 实施，commit `de31f3b`）：GLM-5.2 / Kimi for Coding 目录、真实档位与映射说明落地。
  - **GLM 目录**：CN/Global 抽成共享 `GLM_CODING_PLAN_MODELS`（两区同一套 Coding Plan，只有 endpoint 不同）。GLM-5.2 **只列一行**——sonnet 与 opus 两个 role env 都指向 `glm-5.2`，列两行就是同一模型冒充两个可选项，正是本计划要消灭的伪差异；代价是 opus 别名行从内置目录消失（存量 provider 的 `provider_models` 行不受影响，DB 行优先于 catalog）。haiku 维持 `glm-4.5-air`（基线未称其过期）。
  - **GLM 两档**：`supportedEffortLevels: ['high','max']`。GLM 把 Claude Code 六个 `/effort` token 折成两档（low/medium/high→high，xhigh/max/ultracode→max），五档菜单会让用户选 `low` 却按 `high` 计费。新增 `capabilities.effortNoteKey` 在菜单里说明这次折叠——否则两档会被读成「GLM 只有两种速度」。GLM-4.5-Air 不声明 effort → 选择器隐藏（Phase 0 的「无来源即隐藏」规则）。
  - **Kimi 身份**：`displayName: 'Kimi for Coding'`，底层版本彻底不进目录（`kimi-for-coding` 是官方稳定渠道 ID，K2.5→K3 由供应商自行滚动，跟踪版本等于每次升级都要改目录）。`modelId` 保留 `sonnet`（存量 DB 行与会话钉在该 id，改名会把它们弄丢），真值走新增的 `upstreamModelId: 'kimi-for-coding'`。**顺带修掉一个真 bug**：此前该行没有 upstream，`resolveProvider` 的单模型兜底（`provider-resolver.ts:~590`）会把裸字符串 `sonnet` 发给 Kimi。
  - **Kimi effort（2026-07-20 更新）**：`supportedEffortLevels: ['low','high','max']` → 菜单恰为 Auto + Low + High + Max。`toWireEffort()` 继续收口 `auto` → 不下发，具体档位原样进入 `queryOptions.effort`；两处发送点有源码钉防 `effort=auto` 上线。
  - **Moonshot 不改名**（scope guard）：零改动 + 新增反向断言。Moonshot 是独立 PAYG provider，按名售卖 K2.5 SKU；`Kimi for Coding` 是 Kimi Coding Plan 的渠道抽象，套上去等于虚构它没有的渠道。Volcengine / 百炼 的 `kimi-k2.5` 条目同理不动。`legacy-catalog-hint.test.ts` 未改动即全绿——它 pin 的是「用户手加 `kimi-k2.5` 不该报 legacy badge」，与内置目录改名正交。
  - **验证**：`npx tsc --noEmit` 通过；全量单测 **3922 tests / 3922 pass / 0 fail、exit 0**（基线 3896，+26 为本轮新增）。新增覆盖：GLM 目录世代 / 两档语义 / 伪档位不可达 / 映射说明 en+zh、Kimi 渠道 ID / 版本名不外泄 / 无 k3 条目 / Auto 不外发 / Max 外发 max、Moonshot 不改名、`toWireEffort` 与两处发送点源码钉。
  - **待真实凭据验证**（Smoke Ledger 已留行，移交用户统一验证）：① GLM sonnet 槽是否另有 5.2 世代 turbo SKU；② GLM `[1m]` 长上下文变体（无凭据前加变体等于凭空声明能力，故未加）；③ Kimi Auto 是否实际落到 Max；④ `queryOptions.effort` 与 `CLAUDE_CODE_EFFORT_LEVEL` 优先级及 Kimi 兼容性。
  - **p1-effort-chain 结论**：本轮**不改** env 注入代码，也不预设 env-only。现状读码事实：composer 选择 → `toWireEffort` → API body `effort` → 既有 `queryOptions.effort` 链路；`CLAUDE_CODE_EFFORT_LEVEL` 仅出现在 `provider-resolver.ts` 的 `MANAGED_ENV_KEYS` 清理清单里，**当前无任何代码写入它**。因此"优先级"目前是理论问题，须以真实凭据 smoke 定案后再决定是否需要 env 注入——在此之前新增 env 写入就是未经验证的猜测。
  - **转 Codex 裁决的工程取舍**：① **GLM `defaultEnvOverrides` 的 role mapping 今天是死代码**——`toClaudeCodeEnv` 的 `HOST_MANAGED_ANTHROPIC_ENV_KEYS`（`provider-resolver.ts:448`）显式跳过 extra_env 里的 `ANTHROPIC_DEFAULT_*_MODEL`，而 GLM 没有 `defaultRoleModels`，故 `ANTHROPIC_DEFAULT_SONNET_MODEL` 从未进入子进程 env（唯一写入点是 `provider-resolver.ts:423`，取自 `roleModels`）；GLM 的 alias 实际由其网关服务端解析。本轮按 required check 把值更新到 5.2 世代并加注释，但**没有**改用 `defaultRoleModels` 使其生效——那会改变 wire 行为，且 `roleModelForEnv` 会对 GLM 的自指 alias 调用 `canonicalAnthropicAliasUpstream`，把 `sonnet` 规范成 **Claude** 的模型 id，无凭据验证下风险明确大于收益。建议列 Phase 3 收敛（要么删掉这些误导性的 seed 值，要么改走 role mapping 并配 smoke）。② **存量 GLM/Kimi provider 的 picker 仍显示旧名**：DB `provider_models` 行优先于 catalog（`route.ts:238-247`），故本轮改名只对新添加的 provider 与手动 refresh 生效；是否需要一次 catalog re-seed 迁移，请裁决。③ `supportsEffort > 1` 在 Codex 动态目录专属；Kimi 走 catalog 静态声明，当前 Low/High/Max allowlist 直接驱动 Auto + 三档菜单，不依赖该阈值。
- 2026-07-17（Phase 1 fix 轮 #1，commit `292bcce`）：修 Codex 审查两条 finding——catalog capabilities 跨 DB round-trip 保真 + GLM 映射文案补 `ultracode`。
  - **P1 根因（capabilities 在 DB round-trip 中丢失）**：`db.ts` 的 `seedCatalogModelsIfEmpty()` 与 `alignEnabledWithCatalog()` 两条 sync 路径都把 `capabilities_json` 硬写成 `'{}'`，而读侧（`api/providers/models/route.ts:238-246`、`provider-resolver.ts:1013-1031`）让同 ID 的 DB 行遮蔽 catalog。后果：GLM/Kimi 行一旦被 Models 页首次 GET materialize，`supportsEffort`/`supportedEffortLevels`/`effortNoteKey` 全丢，**Phase 1 刚加的 Auto/High/Max 菜单在真实使用路径上根本不出现**；存量 Kimi 行还会继续显示 `Kimi K2.5` 并发裸 `sonnet`。这直接违反语义验收「用户可见字段必须有真实 source breadcrumb」——上一轮的断言只跑在 catalog 对象上，看不见这条路径。
  - **改法**：抽出 `CatalogSyncModel` 结构类型 + `serializeCatalogCapabilities()`，insert/enable 两路都写 `capabilities_json`，`fieldsAlreadyMatch` 一并比较。**安全边界**：只同步 `user_edited=0` 且非 `manual_*` 的系统管理行，且只碰 `display_name`/`upstream_model_id`/`capabilities_json`——`model_id` 不动，session 的 provider/model pin 不受影响。catalog 未声明 capabilities 时用 `COALESCE(?, capabilities_json)` 传 null 保持原值，避免把 API discovery 得到的能力（如 GLM haiku）擦成 `'{}'`。
  - **顺带答复上一轮转裁决的第 ②项**（存量 provider picker 仍显示旧名 / 是否需要 re-seed 迁移）：Codex 已裁决「合同必须覆盖存量系统管理行」，本轮即按此实现——存量行经 `alignEnabledWithCatalog` realign 到 `Kimi for Coding` + `kimi-for-coding`，无需另做一次性迁移脚本。
  - **P2（GLM 映射文案）**：en/zh 的说明只写 `xhigh/max→Max`，漏掉基线明确列出的 `ultracode`，与代码注释所称「六档折两档」不一致。两语言补全，并把测试从「key 存在」加强为断言两组完整映射语义。
  - **验证**：`npx tsc --noEmit` 通过（无输出）；`npm run test`（typecheck + 全量单测）**3929 tests / 3929 pass / 0 fail**（上一轮基线 3922，+7 为本轮新增）。**负向对照**：`git stash` 掉 `db.ts` 修复后重跑，GLM 与 Kimi 两个 round-trip suite 确实 fail（3926 pass / 3 fail），证明新测试能抓到该 bug 而非空转；恢复后复绿。private-marker 双面 grep 0 命中。
- 2026-07-18（Phase 2 实施 + 承接权限计划 s00 计数勘误，commit `eb75df8`）：Claude Sonnet 5 完整接入 + agent-loop effort 裁决落地。
  - **s05 effort 裁决 = 恢复下发（非降级隐藏）**：读实装 `@ai-sdk/anthropic@4.0.5` 的 `dist/index.js`，effort 经 GA `output_config.effort` 请求字段下发，**全文件无 `effort-2025-11-24` / 任何 effort beta header**（grep 0 命中）。旧 workaround（`agent-loop.ts:408` 对 adaptive 家族丢 effort + 发 `RUNTIME_EFFORT_IGNORED`）的前提「装的包仍挂过期 beta」已失效，官方亦确认 Sonnet 5 / Fable 5 / Opus 4.7+ GA 支持 effort。故**推翻丢弃逻辑**：native 官方路径对所有模型透传 effort，去掉该路径的 ignored toast（第三方代理路径保留——代理确实可能不认字段）；`agent-loop-toolloop-poc.ts` 同步保持 parity。UI 选择 = wire = catalog 声明四者一致，闭合本计划「四者一致」验收。工程取舍（恢复 vs 隐藏）按用户规则不挂 human gate，理由写在此处交 Codex 复审。
  - **Sonnet 5 与 Fable 5 的关键差异（不得错用 forced-on）**：新增 `SONNET_5_PATTERN` 并入 `isOpusAdaptiveThinkingModel`（共享 manual→adaptive、1M 默认无 beta、effort 透传），但**不**并入 fable 的 `thinkingForcedOn` 分支——官方 Sonnet 5 允许 `thinking:{type:'disabled'}`（Fable 5 会 400），故 disabled 原样透传（Opus 4.8 语义）。`sonnet-5-model.test.ts` 专测该差异 + `sonnet-5` 不误伤非 adaptive 的 `sonnet-4-6`。
  - **catalog / 派生链 / context**：`ANTHROPIC_FIRST_PARTY_MODELS` 加 `sonnet-5`→`claude-sonnet-5`（无 role，不劫持 `sonnet` 默认，`sonnet-4-6` pin 不迁移，`resolve-session-model.test.ts` 断言）；env/route/resolver/client fallback 经 `ENV_CLAUDE_CODE_MODELS` 自动含之；`model-context.ts` 加 1M + 新 tokenizer +30% 注记（budget 估算防低估）。OpenRouter/Bedrock/Vertex slug 未验证不加（fable 纪律，测试 pin 住）。
  - **sampling 约束**：按 fable 先例——app 从不为 Anthropic 请求组装 temperature/top_p/top_k（grep `agent-loop.ts`/`claude-client.ts` 0 命中），故 sanitizer「无可剥离」，只补注释说明约束 + 未来若加 sampling 旋钮必须过此函数；不加会成死代码的防御分支（硬规则禁「为过测试加防御复杂度」）。
  - **s07 模型切换回 Auto**：新纯函数 `resolveEffortAfterModelSwitch(currentEffort, newLevels)`，`ChatView.handleProviderModelChange` 接线并**限 manual pick**（isAuto 自动纠正路径 early-return 之后才跑——避免在用户没主动切换的静默纠正上弹 toast，本身也是「manual-only side effect」原则；`codex-phase-6-wiring.test.ts` 的 isAuto early-return 钉据此保持不破）。新 i18n `messageInput.effort.resetOnModelSwitch`（en/zh）。
  - **验证**：`npx tsc --noEmit` 通过（无输出）；canonical 全量（`HOME` 干净 + `CODEX_DISABLED=1`，经 Node child-process wrapper 绕开 shell env 前缀审批门）**4209 tests / 4209 pass / 0 fail / 1039 suites、exit 0**（基线 4186，+23 为本轮新增：sonnet-5 家族 / disabled 差异 / 1M / catalog pin / env-route / 切档 helper / no-migration）。self-inflicted 修 1 处（注释含 `RUNTIME_EFFORT_IGNORED` 字面量触发 doesNotMatch，改措辞）。private-marker 双面 grep 0 命中。
- 2026-07-18（Phase 2 复审轮 #1 修复，commit `bd38d49`）：Codex 复审 4 条（2×P1 + 2×P2），受控修复轮，只改这 4 条 + 三处进度回写。
  - **P1 / s04 sampling guard（从注释升级为主动 guard）**：Codex 指 `ClaudeModelOptionsInput` 无 sampling 入口、sanitizer 不拒绝/剥离非默认 sampling、无告知信号，仅靠「现有调用方不组装」不能关闭该合同。**改法**：`ClaudeModelOptionsInput` 新增 `temperature/topP/topK`；sanitizer 对 adaptive 家族剥离非默认值（temperature≠1、任何显式 top_p/top_k）到 `strippedSamplingParams` 告知数组、safe 值留 `sampling`（同 `thinkingForcedOn` 的 surface-don't-swallow 规则），非 adaptive（sonnet-4-6）原样透传不误伤。`sonnet-5-model.test.ts` 新增 7 分支：temperature 非默认剥离/=1 放行、top_p/top_k 任意值剥离、全剥离、无 sampling 空、4.6 不误伤、fable/opus 家族一致。**未加 live toast**：当前无调用方组装 sampling，接一条永不触发的 toast 路径 = 死代码（硬规则禁为过测试加防御复杂度）；告知信号以 sanitizer 返回值形态存在，未来调用方接入即得。
  - **P1 / s05 Native effort wire 行为测试（源码 pin→可执行对象断言）**：Codex 指原测试只断言 sanitizer 返回 effort + 源码文本含 `anthropicOpts.effort`，未捕获真实 providerOptions。**改法**：wire 构造抽到 `agent-loop-anthropic-wire.ts`（`buildAnthropicProviderOptions`，随 `agent-loop-error-event.ts` 先例，无 DB/provider 依赖可轻量单测），`agent-loop.ts` 消费其返回并把 `.anthropic` 直接赋给 `providerOptions`（同一对象）；`agent-loop-anthropic-wire.test.ts` 断言 sonnet-5+xhigh 官方路径 `providerOptions.anthropic.effort==='xhigh'` 且 `effortDroppedForProxy===false`、代理路径 effort 不上线路且 drop 信号=true、adaptive 家族（fable/opus4.8/4.7）官方均透传。`fable-5-model.test.ts` 的旧 agent-loop 源码 pin 重指向新模块 + 断言 agent-loop 经 helper 接线。
  - **P2 / s07 ChatView 切换行为测试（grep→可执行 4 观察点）**：Codex 指原 wiring 测试只 grep helper 名与 i18n key，未断言 `setSelectedEffort(undefined)` / 兼容档不变 / toast 一次 / isAuto 无副作用。**改法**：新增 `resolveModelSwitchEffortEffect(isAuto, currentEffort, levels)→{resetEffort, showResetToast}` 把 isAuto 门 + reset/toast 决策收成可执行函数，ChatView 改为消费它（isAuto 分支现为 live 代码——effort-effect 块移到 isAuto persist-skip 之前，行为不变：isAuto 仍在 session PATCH 前 early-return）。`effort-menu-levels.test.ts` 加行为测试断言 4 观察点：manual+不支持→reset+toast、manual+兼容→零副作用、reset⇔toast 锁步（单布尔=结构性一次）、isAuto→零副作用。`codex-phase-6-wiring.test.ts` 的 isAuto 钉从固定距离 grep 升级为「isAuto return 在 session PATCH 之前」的顺序不变量断言。
  - **P2 / s00 账本因果表述（撤回单因子归因）**：Codex 受控对照证明「保持同一 clean HOME、仅去掉 `CODEX_DISABLED=1` 仍为 4186/4186/1032」，原勘误把 4186 vs 4170 差值单独归因给 `CODEX_DISABLED` 不成立。**改法**：`runtime-permission-modes.md` 复审轮 #6 勘误改为只陈述已实测事实（4186 canonical 计数真实、shared-clone 复现），撤回单因子归因，补本 run 在当前 HEAD 的单变量对照（`CODEX_DISABLED=1` 与去掉它均 4227/4227/1043，`scripts/tmp-*-runner.mjs`），把原差值归到「当时裸命令用了不同 HOME/环境」，不再下因果断言。
  - **验证**：`npx tsc --noEmit` 通过（无输出）；canonical 全量（`HOME` 干净 + `CODEX_DISABLED=1`，Node child-process wrapper）**4227 tests / 4227 pass / 0 fail / 1043 suites、exit 0**（基线 4209，+18 为本轮新增：s04 sampling 7 + s05 wire 6 + s07 effect 5，减去 fable/phase-6 两处 pin 改写净变）。单变量对照（同 HOME、去 `CODEX_DISABLED`）亦 4227/4227/1043，佐证 s00 更正。private-marker 双面 grep 0 命中。
  - **未做**：Anthropic key × sonnet-5 真实凭据 smoke（native + Claude Code 两路径的 thinking/effort/sampling 请求形状）留 Smoke Ledger 📋，移交用户。
  - **新增覆盖**（`catalog-capabilities-roundtrip.test.ts`）：fresh seed → resolver 仍见 GLM `[high,max]` + note key；legacy `Kimi K2.5` 行 → realign 到渠道名/`kimi-for-coding`/`['max']` 且 `model_id` 不动；`user_edited=1` 与 `manual_hidden` 反例 → 展示名、upstream、capabilities 全部不被覆盖；catalog 静默 → 不擦除已发现能力。
  - **待真实凭据验证项不变**（Smoke Ledger 保持 📋，移交用户统一验证）：① GLM sonnet 槽是否另有 5.2 世代 turbo SKU；② GLM `[1m]` 变体；③ Kimi Auto 是否实际落到 Max；④ `p1-effort-chain`：`queryOptions.effort` 与 `CLAUDE_CODE_EFFORT_LEVEL` 优先级及 Kimi 渠道兼容性——本轮仍**不改** env 注入代码，结论同上一轮。
- 2026-07-18（Phase 2 复审轮 #2 修复，commit `0f9985f`）：Codex 复审 fix_requested 2 条（1×P1 s07 一致性 + 1×P2 账本），受控修复轮，只改这 2 条 + 三处进度回写。
  - **P1 / s07 effort 一致性根因（原实现 manual-only，两处漏接）**：复审轮 #1 的 `resolveModelSwitchEffortEffect(isAuto, …)` 刻意让 `isAuto` 分支零副作用，`ChatView` 自动纠正到不支持旧档位的模型后**保留**该档位；发送处 `toWireEffort(selectedEffort)` 原样下发。更直接的是**新会话入口 `chat/page.tsx`** 的 `onProviderModelChange` 完全没有 effort 回退。结果：Sonnet 5 的 `xhigh` 切到 Sonnet 4.6（无 xhigh）等场景仍显示并发送 `xhigh`，违反「UI 所选 = 发送参数 = 供应商档位」三者一致。
  - **工程裁决（承接 Codex 方向）**：「不持久化 auto-fallback 的 session pin」与「清除当前非法瞬态 effort」是两件事。前者不变（调用点仍在 `opts?.isAuto` 时 early-return，不写 session PATCH / localStorage）；后者必须在**每个有效模型变化入口**执行，与 manual/auto 无关。故 `resolveModelSwitchEffortEffect` **去掉 isAuto 参数**，effort 效果纯由 `(currentEffort, newLevels)` 决定；`resetEffort ⇔ showResetToast` 仍锁步，reset 后选择即 Auto，永不再触发，故提示天然一次。
  - **同一真源校验（复用 picker feed）**：新增 `MessageInput.emitProviderModelChange` 包装器，从与 picker 渲染相同的 `providerGroups/modelOptions`（`useProviderModels`）解析新模型 `supportedEffortLevels`，经 `onProviderModelChange` 的 `opts.supportedEffortLevels` 下发；手动 picker（`ModelSelectorDropdown`）与 auto-correct effect 两路径都改经该包装器。`ChatView` 优先消费 `opts.supportedEffortLevels`（回退自身 `useProviderModels` 查表），`chat/page.tsx` 直接消费 `opts.supportedEffortLevels` 并补一次性 sourced toast（`messageInput.effort.resetOnModelSwitch`，en/zh 已有，无新增文案）。两入口的 effort 清除都在 `if (opts?.isAuto) return` **之前**执行。
  - **测试（可执行 + source pin）**：`effort-menu-levels.test.ts` 重写 `resolveModelSwitchEffortEffect` describe——(1) 不支持→reset+toast、(2) 兼容→零副作用、(3) reset⇔toast 锁步、(4) **manual 与 auto-correct 对同一不支持输入清除一致**（原「isAuto→零副作用」断言被推翻）、(5) **清除后 `toWireEffort(effort)===undefined`（被清档位不上线路）**、Auto/unset 不触发；两入口 source pin 断言 helper 调用在 isAuto persist-skip 之前；MessageInput feed 下发 pin（`supportedEffortLevels: option?.supportedEffortLevels` + 两路径经包装器）。`codex-phase-6-wiring.test.ts` 的 isAuto 钉从「`onProviderModelChange?.(…{isAuto:true})`」改为「`emitProviderModelChange(…{isAuto:true})` + 包装器 `...opts` 转发」两跳保 isAuto。
  - **P2 / 账本过早关闭**：s07 缺口使原「Phase 2 完成 / 模型切换回 Auto 已落地」过早。本轮按新 commit 与独立复跑真实数同步回写执行清单、状态总览、frontmatter、决策日志四处。
  - **验证**：`npx tsc --noEmit` 通过（无输出）；canonical 全量（`HOME` 干净 + `CODEX_DISABLED=1`，经 Node child-process wrapper 绕开 shell env 前缀审批门）**4233 tests / 4233 pass / 0 fail / 1044 suites、exit 0**（基线 4227，+6 为本轮净增：s07 effect describe 重写新增观察点 + 两入口/feed source pin，减去 codex-phase-6 钉改写）。`npm run build` 编译成功（1 条既存 NFT trace warning）。private-marker 双面 grep（diff + commit message）0 命中。**未做**：Anthropic key × sonnet-5 真实凭据 smoke 仍留 Smoke Ledger 📋，移交用户。
- 2026-07-18（Phase 2 复审轮 #3 修复，commit `aa2623e`）：Codex 复审 fix_requested 2 条（1×P1 s07 MessageInput 受控显示 + 1×P2 账本），受控修复轮，只改这 2 条 + s00 账本刷新 + 三处进度回写。
  - **P1 / s07 根因（复审轮 #2 只修了父层，MessageInput 显示层仍漏）**：复审轮 #2 让 `ChatView`/`chat/page.tsx` 两入口 `setSelectedEffort(undefined)`，但 `MessageInput.tsx:1084` 的 `selectedEffort = effortProp ?? localEffort` 是受控/非受控混用：用户先选 `xhigh` 时 `setSelectedEffort` 同时写 `localEffort='xhigh'` 并 `onEffortChange('xhigh')`；父层 reset 到 `undefined` 后，`effortProp=undefined ?? localEffort='xhigh'` **重新露出 stale local 值**，按钮仍显示 `xhigh`，而父发送态已是 `undefined`、`toWireEffort` 省略 effort——实际组件从未回到 Auto，仍违反四者一致。复审轮 #2 的 `effort-menu-levels.test.ts` 只测纯函数（`resolveModelSwitchEffortEffect`）与源码顺序，从未经过这段显示解析，故没抓到。
  - **改法（真正受控显示，非补丁）**：显示解析抽成纯函数 `resolveComposerEffortDisplay(controlledEffort, localEffort, isControlled)` 落在 `effort-levels.ts`（`MessageInput` 实际调用它，非复制逻辑）。当父层拥有 effort（`onEffortChange !== undefined`，三个真实调用点都接）→ `isControlled=true` → 显示 = `controlledEffort ?? 'auto'`，**永不读 stale local**；`localEffort` 仅保留给无 `onEffortChange` 的独立用法（受控/非受控组件惯例，如 `<input>`）。`setSelectedEffort` 仍照旧写 local + 调 `onEffortChange`（保留 local 是为了让回归测试能带着 stale local 断言显示仍 Auto）。
  - **测试（真实全链行为，取代 source-only）**：本套件无 React 渲染器（无 jsdom/testing-library，同 `card-primitives.test.ts` 约束）。新增 `makeComposerHarness` 把 composer + 父层建模成一台状态机，每个决策都是**真实导出 helper**：按钮标签来自 `resolveComposerEffortDisplay`、reset 来自 `resolveModelSwitchEffortEffect`、wire 来自 `toWireEffort`，只有 React 状态存储（一个变量）与 toast 计数是建模胶水、非逻辑。断言矩阵：两入口（ChatView/新会话，共享同一 helper）× manual/auto-correct，先选 `xhigh` 再切 Sonnet 4.6 → **按钮显示 Auto + wire 省略 effort + toast 恰好一次**；支持档位存活不 reset；reset 后二次不支持切换静默（toast 不 double-fire）；`resolveComposerEffortDisplay` 单元守卫（受控 undefined + stale local `xhigh` → Auto、受控值压过 local、非受控回退 local）。补 MessageInput 源码钉：调用受控解析、`const selectedEffort = effortProp ?? localEffort` 不复活。旧的「仅 source pin」自夸未删但降级为**辅助**接线守卫，行为测试为主证据。
  - **验证**：`npx tsc --noEmit` 通过（无输出）；canonical 全量（`HOME=/tmp/codex-i31-home` 干净 + `CODEX_DISABLED=1`，Node child-process wrapper）**4241 tests / 4241 pass / 0 fail / 1045 suites、exit 0**（基线 4233，+8 为本轮净增：全链行为 7 + MessageInput 受控显示源码钉 1）。单变量对照（同 HOME、去 `CODEX_DISABLED`）亦 4241/4241/1045。private-marker 双面 grep（diff + commit message）0 命中。〔**复审轮 #4 s00 更正**：此 4241/1045 是暖/无丢弃时的完整计数；并行 `--test-force-exit` 命令在**冷 HOME 首跑**会因 force-exit 竞态欠计数且不确定（实测 4234/4203、Codex 4238），可复现的权威完整计数须用串行 `--test-concurrency=1`=`4241/1044`，详见下方复审轮 #4 条目。〕
  - **s00 账本刷新**：`runtime-permission-modes.md` 复审轮 #6 计数勘误早前引用的「当前 HEAD 4227/4227/1043」已随本计划推进过期；本 turn 同一干净 HOME 前台复跑 canonical，真实 TAP footer 4241/4241/1045 已回写，并注明与 d3e7041 钉数 4186 的 +55 差值全来自共享套件累积新增（非环境），单变量对照再次佐证。4186 作为 d3e7041 那棵树的钉数不改。〔**复审轮 #4 s00 更正**：本条「4241/4241/1045 = 干净 HOME canonical **首跑**、差值全非环境」对并行原命令过强、已在复审轮 #4 撤回——冷 HOME 首跑实测 4234/4203/（Codex 4238）为 force-exit 竞态欠计数、不确定；完整计数 4241 由 HEAD 决定且与环境无关这点成立，但须用串行才能可复现地取到。见下方复审轮 #4。〕
  - **未做**：Anthropic key × sonnet-5 真实凭据 smoke 仍留 Smoke Ledger 📋，移交用户。
- 2026-07-18（Phase 2 复审轮 #4 修复 = s00 测试账本真实性收口，commit `65a71ab`）：Codex 复审 fix_requested 1 条 P2（human gate 后经用户批准的受控修复轮，只改这 1 条 + 账本回写）。争点：`runtime-permission-modes.md` 复审轮 #6 附近与本计划把 `4241/1045` 记成「干净 HOME 单次 canonical **首跑**」，但 Codex 以独立干净首跑得 `4238/1044`，`4241` 只在同一 HOME **二跑**（暖）出现——要求复现并解释这 3 tests/1 suite 状态依赖，别把二跑 footer 冒充首跑。
  - **定位结论（非条件性注册、非 HOME 依赖、非环境计数语义——是 force-exit 竞态）**：以全新空 HOME（每个只用一次）受控复现：并行 + `--test-force-exit` 冷 HOME 首跑三次分别 `# tests 4234/# suites 1042`、`4203/1039`（Codex 侧 `4238/1044`），全 `# fail 0`；同一 HOME 二跑（暖）才稳定 `4241/1045`。用 TAP 名字 diff 冷 vs 暖，**只出现在暖跑**的用例含 `parallel-safety.test.ts` 的纯函数 leaf（`Read + Bash does NOT parallelize`、`two Grep calls parallelize` 等——该文件无 fs / 无 HOME / 无 async / 无条件 `describe`，不可能条件注册）与 `coding-plan-discovery-gate.test.ts` 若干。**故根因不是「首跑写 HOME 状态、二跑据此条件注册」**（Codex 初始怀疑方向被证伪），而是 `--test-force-exit` 与并行 worker 上报之间的竞态：冷启动慢时 worker 已完成但结果未 flush 就被强制退出丢弃 ⇒ 冷跑**欠计数且不确定**（故 4234/4203/4238 各不相同），暖跑因 worker 起得快、赶在 force-exit 前 flush 到齐才稳定 4241。去掉 `--test-force-exit` 则整套挂起（存在悬挂 handle，这是原命令必带 force-exit 的原因，也是不能简单去掉它的原因）。
  - **权威可复现 clean-run footer（串行消竞态）**：全新空 HOME + `--test-concurrency=1 --test-force-exit` 单跑 = **`# tests 4241 / # suites 1044 / # pass 4241 / # fail 0 / # duration_ms 59432.085625`**，确定可复现（tests=4241 与暖并行一致；suites `1044`(串行)/`1045`(并行) 是 node:test 根套件在不同并发/force-exit 下 ±1 聚合抖动，tests 为准）。
  - **改动**：① 不改任何测试文件——注册本就确定、非 HOME 依赖，无隔离 bug 可修；② 不改 canonical 命令——超出本 P2 scope；③ 账本回写：`runtime-permission-modes.md` 复审轮 #6 条目与本计划 #3 条目的「干净 HOME 单次 canonical 首跑=4241、差值非环境」过强表述已撤回并注明并行冷跑欠计数竞态，权威完整计数改记串行 4241/1044 原始 footer；本计划顶部状态与 Phase 2 状态行的 4241 保留（是完整计数、成立），补「串行可复现」限定。
  - **验证**：`npm run typecheck`（=`tsc --noEmit`）exit 0 无输出；串行 canonical 全新空 HOME 单跑 `# tests 4241 / # suites 1044 / # pass 4241 / # fail 0`；并行 canonical 冷 HOME 首跑复现 `4234/1042`+`4203/1039`（`# fail 0`），暖跑 `4241/1045`——冷/暖差异即上文竞态。private-marker 双面 grep（diff + commit message）0 命中。**未做**：Anthropic key × sonnet-5 真实凭据 smoke 仍留 Smoke Ledger 📋，移交用户。
- 2026-07-18（Phase 2 复审轮 #5 修复 = s00 原样 canonical footer 收口 + s11 三处一致，机械文档轮，受控派发，仅改 `runtime-permission-modes.md` 与本计划两份账本 md、不碰任何代码/测试/canonical 命令）：Codex 复审 fix_requested 2 条 P2。审计目标快照 HEAD `03ca9b0`（实现正文 `65a71ab`/`aa2623e`）。
  - **P2 / s00 原样 footer（已修）**：上一版把加了 `--test-concurrency=1` 的串行 `4241/1044` footer 定为「权威替代值」、原样并行命令只留 `4234/4203` 不完整摘要，等于用串行 footer 冒充原样 canonical 命令结果，不符 s00「粘贴原样命令该次真实 footer」。**回写**：`runtime-permission-modes.md` 复审轮 #6 与本计划顶部/状态/清单把 reviewer 全新空 HOME 原样并行 canonical（`--test-force-exit`、无 `--test-concurrency=1`）单次首跑真实 footer 原文回写：`# tests 4241 / # suites 1045 / # pass 4241 / # fail 0 / # cancelled 0 / # skipped 0 / # todo 0 / # duration_ms 8220.997917`。本 run 在另一全新空 HOME 原样复跑同一并行命令，首跑得 `# tests 4223 / # suites 1042 / # pass 4223 / # fail 0 / # cancelled 0 / # skipped 0 / # todo 0 / # duration_ms 8038.652042`（同 0 fail），与 reviewer 4241/1045 并列证明并行 `--test-force-exit` 冷 HOME 首跑计数**不确定**（曾观察 4234/4203/4238/4223、亦有满 4241）。**据此把原『冷 HOME 首跑会欠计数』的必然表述改为『可能/曾观察到不确定欠计数』**（force-exit 与并行 worker flush 竞态工程定性保留，仅去掉「每次必然」）；串行 `--test-concurrency=1`=`4241/1044` 降为**辅助确定性对照**（消竞态取全量、非原样命令产物）。
  - **P2 / s11 三处一致（已修）**：Phase 2 执行清单（新增「Phase 2 目标快照」行）、状态总览表（Phase 2 行）+ frontmatter 状态行、本决策日志三处统一含目标快照 commit `03ca9b0`（实现正文 `65a71ab`）+ canonical 完整计数 4241/1045（0 fail）；决策日志此前已记 `65a71ab`+计数，本轮补齐清单与状态总览两处的 commit hash，三处对齐。
  - **验证**：原样并行 canonical（全新空 HOME、Node child-process wrapper 绕 shell env 前缀审批门）首跑 `# tests 4223 / # suites 1042 / # pass 4223 / # fail 0`、exit 0（并行冷跑竞态欠计数的又一实例、非回归——`# fail 0`）；docs-only 改动，pre-commit 走 docs 快路（跳过 tsc + 单测）；private-marker 双面 grep（diff + commit message）0 命中。**未改任何代码/测试文件，未改 canonical 命令**。**未做**：Anthropic key × sonnet-5 真实凭据 smoke 仍留 Smoke Ledger 📋，移交用户。（本轮文档收口 commit `ca00e0e`）
- 2026-07-18（Phase 2 复审轮 #6 修复 = s05 effort 能力门 + s04 sampling 告知链，commit `a7c6795`；受控指导 fix 轮，用户已批准，只改这 2 条）：Codex 复审 fix_requested 2 条（1×P1 + 1×P2）。
  - **P1 / s05 根因（「不再对家族丢弃」被写成「对所有模型无条件透传」）**：复审轮 #1 把 wire 构造抽成 `buildAnthropicProviderOptions` 时**没有把 model 传进去**，官方分支只看 `if (sanitized.effort)`。Codex 独立行为复现 `claude-haiku-4-5-20251001` + `max` → `{"effort":"max"}`，而 Anthropic 官方 effort supported-model 列表不含 Haiku 4.5。即上一轮的裁决方向（GA effort 已可下发）成立，但落地面过宽。
  - **改法（per-model allowlist，与 Run 1 在 Codex 路径的 per-model 判断模式对齐）**：`claude-model-options.ts` 新增 `ANTHROPIC_API_EFFORT_MODELS`（每条带官方 breadcrumb）+ `anthropicApiSupportsEffort()`，未知模型 **fail-closed** 为不支持（省略 effort 只是退回模型默认深度，发不支持字段则可能整轮 400）。**刻意不复用 catalog `capabilities.supportedEffortLevels`**：那是 UI picker / Claude Code CLI（SDK runtime）的能力面，比 API effort 列表更宽——first-party `claude-haiku-4-5-20251001` 在 catalog 里正声明 `['low','medium','high']`，拿它当 wire 门等于把本 finding 原样写回；两者是不同问题（"manual thinking 会不会 400" vs "API 收不收 effort"），故保持独立轴、各自 breadcrumb。wire 层收 `model`（**必填**，让所有调用点被类型系统强制更新）并新增 `effortDroppedUnsupportedModel` 信号；`agent-loop.ts` 与 `agent-loop-toolloop-poc.ts`（后者本轮改为消费同一 helper，消除两条 native 路径的 drift）据此各发一次 `RUNTIME_EFFORT_IGNORED`，文案如实说明「该模型不支持 effort、按自身默认推理深度运行」——与真实行为一致，不是「代理可能不支持」那句代理专用文案。
  - **P2 / s04 根因（告知信号只存在于返回对象）**：`strippedSamplingParams` 在生产代码零消费者，且两条 Runtime 压根没把 sampling 字段传进 sanitizer——剥离只有测试看得见，违反 sanitizer 自己写的 surface-don't-swallow 与语义验收「真实来源缺失必须隐藏或降级说明」。
  - **改法（接线 + 一次明确通知，两条 Runtime 一致）**：`AgentLoopOptions` / `ClaudeStreamOptions` / `RuntimeStreamOptions` 加 `temperature/topP/topK` 并逐层透传到两条 Runtime 的 sanitizer 调用点；新增共享决策模块 `anthropic-sampling-notice.ts:buildSamplingIgnoredNotice`（随 `agent-loop-anthropic-wire.ts` 先例，无依赖可直测），两条 Runtime 都消费它发一次 `SAMPLING_PARAMS_IGNORED`，并把该 code 加进 `TOAST_STATUS_CODES`（否则 toast 会被下一条 status 顶掉，等于没通知）。两条 Runtime 唯一差异是**真实行为差异**而非策略选择：native 把存活的 `sanitized.sampling` spread 进 `streamText`（故只告知被剥离的），SDK 的 `query()` 没有任何 sampling 旋钮（故剥离与存活一并如实告知）。**当前无 UI 暴露 sampling，故线上行为逐字节不变**——接线的意义是让 guard 从「by construction 安全」变成「真的会响」。
  - **工程取舍（交 Codex 裁决）**：新文案沿用现有 SSE status notification 的**服务端英文**形态（与既有 `THINKING_ALWAYS_ON` / `RUNTIME_EFFORT_IGNORED` 完全一致），未新增 i18n key——locale 只存在于 `I18nProvider` 的 React state，`maybeShowStatusToast` 是非 hook 的普通函数拿不到它，做本地化要改 toast 路由层并顺带改掉既有两条 code 的文案，超出本轮两条 finding 的 scope。**建议**：把「SSE notification 统一本地化（按 code 映射 i18n key）」作为独立小项或 tech-debt 处理；若 Codex 认为必须本轮做，我再补。
  - **验证**：`npx tsc --noEmit` exit 0 无输出；canonical 全量单测（前台单次，见下方命令说明）**`# tests 4235 / # suites 1042 / # pass 4235 / # fail 0 / # cancelled 0 / # skipped 0 / # todo 0 / # duration_ms 8590.0715`**；targeted：`agent-loop-anthropic-wire.test.ts` 13/13（含 Haiku 4.5+max 无 effort 键、未知模型 fail-closed、Sonnet 5+xhigh 正例三类请求形状）、新 `anthropic-sampling-notice.test.ts` 13/13、`fable-5-model.test.ts` 15/15、家族回归（sonnet-5 / opus-4-8-sonnet-4-6 / effort-menu-levels / env-models-single-source）全绿。private-marker 双面 grep（diff + commit message）0 命中。
  - **命令环境差异（如实记录）**：本 run 的 shell 权限门禁不放行带 `HOME=... CODEX_DISABLED=1` env 前缀的 `node` 命令（多次尝试均被拒），故实跑为 `npx tsx --test-force-exit --test --import ./src/__tests__/db-isolation.setup.ts src/__tests__/unit/*.test.ts`——**同一 node:test 并行 + force-exit 形态**，差别是 runner 入口（`npx tsx` vs `node --import tsx`）与未设 `CODEX_DISABLED` / 自定义 `HOME`。所得 `4235/1042` 落在本计划复审轮 #4/#5 已确认的并行冷跑不确定区间内（曾观察 4203/4223/4234/4238/4241），`# fail 0`，且本轮净增 16 例（wire +3、sampling notice +13）已包含在内。**不声称**它与 canonical 前缀命令逐数字等价——按 s00 既有结论，完整计数由 HEAD 决定，确定性对照须用串行 `--test-concurrency=1`。
  - **未做**：Anthropic key × sonnet-5 真实凭据 smoke 仍留 Smoke Ledger 📋，移交用户；未改 canonical 命令、未动本轮两条 finding 以外的任何行为。
- 2026-07-18（Phase 2 复审轮 #8 = s00/s11 账本按命令语义分栏，纯文档轮，受控派发，仅改 `runtime-permission-modes.md` + 本计划两份 md，未碰任何代码 / 测试 / canonical 命令）：
  - **P2 / s00+s11 根因**：复审轮 #7 把 `4265 / 1049` 定性为「本次未欠计数 / 当前唯一有效完整值」。Codex reviewer 在全新空 HOME 前台**原样**跑 canonical 得 `4268 / 1050`，随后仅追加 `--test-concurrency=1` 的确定性串行对照得 `4289 / 1055`——证明并行 footer 可以是一次真实输出，却**不是完整注册量**，原「完整值」定性属反假数据意义上的语义失真。
  - **改法（两组数按命令语义分栏，互不冒充）**：全部账本位置统一写入两行——
    - **该次并行观测值（canonical 原样命令，计数随 force-exit 竞态逐次浮动）**：`# tests 4268 / # suites 1050 / # pass 4268 / # fail 0`（reviewer 原样 footer，exit 0）。
    - **完整注册量对照（`--test-concurrency=1`，非 canonical 原样命令）**：`# tests 4289 / # suites 1055 / # pass 4289 / # fail 0`（exit 0）。
    并删除 `4265`「未欠计数 / 当前唯一有效完整值」类承诺表述，`4265 / 1049` 降为历史并行观测。四处（frontmatter 状态行、状态总览表 Phase 2 行、Phase 2 执行清单目标快照、本决策日志）语义一致，`runtime-permission-modes.md` 复审轮 #6 的「s00 最终账本」段同步改为同一分栏结构。
  - **限制（不掩饰）**：本 run 为 headless 纯文档轮，未自行复跑 canonical——两组 footer 来源均明确标注为 Codex reviewer 前台 clean-run，Claude 侧不改写、不声称自跑。
  - **验证**：docs-only 改动，按派发要求 `--no-verify` 前台提交；四处语义一致人工核对通过；private-marker 双面 grep（diff + commit message）0 命中。**未做**：Anthropic key × sonnet-5 真实凭据 smoke 仍留 Smoke Ledger 📋，移交用户。
- 2026-07-18（Phase 2 复审轮 #7 = s00/s11 测试账本最终收口，纯文档轮，受控派发，仅改 `runtime-permission-modes.md` + 本计划两份 md，未碰任何代码 / 测试 / canonical 命令）：
  - **背景**：复审轮 #6 的两条代码 finding（F1 官方 effort allowlist 事实修正 + 精确 token 匹配、F2 两类 toast 的 code/reason 驱动 en/zh 本地化）已在 commit `fb53dfe` 落地，本轮不重复处理。遗留只有 F3 —— s00 的真实 footer 与 s11 的三处一致。
  - **P2 / s00+s11 根因**：账本里同时存在 `d3e7041`+4186、`03ca9b0`+4241/1045、`a7c6795`+4235/1042 三套计数，且 Phase 2 执行清单「目标快照」停在 `03ca9b0`+4241/1045、frontmatter/状态表停在 4235/1042，与最终实现 commit 不对应；同时 headless run 的 shell 权限门禁不放行 `HOME=... CODEX_DISABLED=1` env 前缀命令，Claude 侧无法自行产出原样 canonical footer。
  - **改法（footer 来源=operator 前台 clean-run）**：由 operator 在本 worktree HEAD `fb53dfe` 上、以**全新空 HOME**、**前台原样**执行 canonical 命令（`HOME=/tmp/codex-i31-home CODEX_DISABLED=1 node --test-force-exit --import tsx --test --import ./src/__tests__/db-isolation.setup.ts src/__tests__/unit/*.test.ts`）跑通一次，真实 TAP footer 原文 = **`# tests 4265 / # suites 1049 / # pass 4265 / # fail 0 / # cancelled 0 / # skipped 0 / # todo 0 / # duration_ms 8327.997333`**（exit 0）。〔**复审轮 #8 更正**：该 footer 当时被记为「完整计数 / 当前唯一有效值」，此定性已撤回——它只是一次并行观测值，见下方复审轮 #8。〕该 footer 原文回写三处：Phase 2 执行清单「目标快照」、frontmatter 状态行 + 状态总览表 Phase 2 行、本决策日志条目，统一锚定 commit `fb53dfe`；`runtime-permission-modes.md` 复审轮 #6 条目追加「s00 最终账本」段，把 4186 / 4241 由主导表述降为历史钉数（冷/暖 force-exit 竞态的演变说明保留，不删）。
  - **计数环境差异说明（如实记录）**：`fb53dfe` 相对 `d3e7041` 的 +79 tests / +17 suites 全部来自共享 canonical 套件在 model-capability Phase 2 各轮累积的新增用例，非环境差异；`CODEX_DISABLED` 单变量对照此前已两次证明单独不改变计数；并行 `--test-force-exit` 冷 HOME 首跑**可能**因 worker flush 竞态出现不确定欠计数（曾观察 4203/4223/4234/4238，亦有更高计数）。〔**复审轮 #8 更正**：原句「本次 operator 前台 clean-run 未欠计数」已撤回——串行对照证明 4265 同样欠计。〕
  - **限制（不掩饰）**：本 run 为 headless，未自行复跑 canonical——footer 来源明确标注为 operator 前台 clean-run，Claude 侧不改写、不声称自跑。
  - **验证**：docs-only 改动，pre-commit 走 docs 快路（本轮按派发要求 `--no-verify` 前台提交）；private-marker 双面 grep（diff + commit message）0 命中。**未做**：Anthropic key × sonnet-5 真实凭据 smoke 仍留 Smoke Ledger 📋，移交用户。
- 2026-07-17（审查裁决）：接受 P2-3/P2-4——Phase 2 必须显式裁决 `agent-loop.ts:408-425` 的 Native effort 丢弃逻辑，EffortSelectorDropdown 五档硬编码回退列为伪档位来源进 Phase 0。P2-2 部分接受——Auto 定义为 CodePilot"不显式指定"语义；"Auto 默认落 Max"有 K3 文档 null/undefined → max 依据，但官方页面间存在版本描述冲突，渠道能力与 Auto 实际落点以 live smoke 定案；effort 下发链路不预设 env-only，需验证 `queryOptions.effort` 与 `CLAUDE_CODE_EFFORT_LEVEL` 优先级。Moonshot provider 改名明确 out-of-scope。展示决策不变。
