# AI SDK 7 Runtime 接入 + 自动化 Loop 实践

> 创建时间：2026-06-29
> 最后更新：2026-07-04
> 关联调研：[AI SDK 7 Runtime Adoption](../../research/ai-sdk-7-runtime-adoption-2026-06-29.md)
> 协作循环基础设施：[Agent Collaboration Loop Infrastructure](../../handover/agent-collaboration-space.md)

## 状态

| Phase | 内容 | 状态 | 备注 |
|-------|------|------|------|
| Phase 0 | 立项、调研归档、Loop 边界定义 | ✅ 已完成 | Codex 已完成调研与本执行计划；不改产品代码 |
| Phase 1 | Node 22 / AI SDK 7 依赖升级可行性 spike | ✅ 已完成 | Codex 复审通过（worktree commit `717bf93`）：`ai` ^6.0.169→^7.0.11 + 5 个 provider 包可安装/测试/构建，唯一破坏面 `LanguageModelUsage` 类型 4 行机械修复；3497 单测 + `npm run build` + Electron bundle 全绿；未 push/merge/release；下一阶段门禁是真实 provider smoke 与完整 packaging 取舍 |
| Phase 2 | Provider request-shape 能力矩阵 | ✅ 已完成 | 三件套全部 Codex accepted：①fixture 矩阵（`3008c1a`，30+12 用例 / 29 sanitized fixture，[矩阵文档](../../research/ai-sdk-7-provider-request-shape-matrix.md)）②image 裸 base64 收口（Codex 仲裁选 a，`cc8b68e` wrapper+守卫+回归测试）③live smoke（`d4ec1723`，本机 4 渠道，reasoning/effort/tool choice 三条 wire 实测被接受、reasoningTokens 语义实证；2 条网关 finding 转 tech-debt #47/#48）。2026-07-04 final smoke 复测确认：OpenCode Go OpenAI 仍绿；OpenCode Go Anthropic 与 ClinePass GLM-5.2 的真实 `/api/chat` UI 后端路径均绿。先前 direct SDK smoke 中的 OpenCode Go 404 是绕过 resolver 后误测 `@ai-sdk/anthropic` 直连路径；ClinePass `generateText()` 仍暴露非流式 `data` 信封兼容债，但不代表主聊天流不可用。**遗留 open gate（不阻塞收口，默认开放能力/发版前必补）**：官方一方 Anthropic/OpenAI key smoke、网关 image data URL 接受度、ClinePass 非流式/辅助路径兼容 |
| Phase 3 | Native Runtime ToolLoopAgent side-by-side POC | ✅ 已完成 | Codex accepted（8/8 checks，issue #7）：POC 达成逐事件 SSE / wire deepEqual / DB 逐字节 / permission 全序列 parity + 真实网关 3/3 场景；**结论 partial adopt**——能承载但依赖两处尾部语义补偿（gap #1/#2），不建议现在替换默认 loop；gap list 见 `docs/research/ai-sdk-7-toolloop-parity-gaps.md`（在 spike worktree 分支，随合并入 main） |
| Phase 4 | 第一批安全落地能力 | ✅ 已完成 | 2026-07-03 四件套实现+验证完成（issue #8 第二轮）：timeout 原因码（含收尾轮修复的 hung-tool 挂死 P1——guardStream）/ approval HMAC（403/410/409 三攻击面）/ trace 脱敏（fail-closed，默认关）/ `@ai-sdk/mcp` POC（生产零改动）；fix 轮（第三轮）修复 Codex P1：first-token 定时器改为只由 `start-step` arm，连接黑洞不再误分类为 TIMEOUT_FIRST_TOKEN，补 3 条控制器反例 + 1 条端到端反例；`npm run test` 3594/3594 + smoke 3/3；Codex 终审 accepted；可发布清单见 research 文档 |
| Phase 5 | Native Runtime 迁移 / 保守采用决策门 | ✅ 已完成 | 2026-07-04 三件套完成（issue #10）：①gap list 全处置（P1×3 关闭：#1/#2 补偿+8/8 parity 复跑锁定、#3 降级论证；P2/P3 关闭或 backlog，#7→tech-debt #49）②三类真实场景 prod vs POC 对照 4/4 contractMatch（长文本/approval 批准+拒绝/abort→continue，OpenRouter 真实渠道）③[采用决策文档](../../research/ai-sdk-7-adoption-decision.md)：**partial**——依赖升级+外围能力 go、默认 loop 替换 no-go（现在）+ 分层 rollback plan；用户已批准 partial，分支已合并，默认聊天路径零变化 |
| Phase 6 | 自动化 Loop 产品化沉淀 | 📋 待开始 | 已拆到 [Agent Collaboration Loop Infrastructure](../../handover/agent-collaboration-space.md)；本计划只保留 AI SDK 7 pilot 反馈 |

## 背景与用户问题

用户正在研究自动化 Loop，并希望把 AI SDK 7 接入作为一次真实实践：一方面 AI SDK 7 提供了 ToolLoopAgent、experimental HarnessAgent、`@ai-sdk/mcp`、approval、timeout、DevTools、reasoning effort 等新能力；另一方面 Runtime / Provider / Permission / MCP 属于 CodePilot 的核心可信边界，不能让自动化循环在没有清晰停止条件和验证凭据的情况下持续改动。

本计划的目标不是“立刻把 Runtime 全部换成 AI SDK 7”，而是把它拆成可观测、可回滚、可审查的 Loop 实验：

- 用 AI SDK 7 接入本身验证自动化 Loop 的价值。
- 用机械信号驱动自动迭代：typecheck、unit、fixture diff、SSE parity、request-shape diff、smoke ledger。
- 把产品判断、权限边界、默认 Runtime 切换保留给用户 + Claude Code + Codex review。
- 每轮 Loop 必须留下 ledger，不把结论只放在聊天里。

协作循环本身不再由本计划管理。Claude Code / Codex 的 private run space、handoff、review、ledger 主从关系、通知 MVP 和未来 GitHub Project / Notion / Cloudflare 演进，统一由 [Agent Collaboration Loop Infrastructure](../../handover/agent-collaboration-space.md) 管理。本计划只记录 AI SDK 7 Runtime 接入的技术决策、产品验收和 pilot 反馈。

参考材料：

- 用户提供的《代理循环架构-The Agent Loop Architecture》：强调 Loop / Skill / Orchestrator 三层、durable checkpoint、retry、observable run、agent 可持续改进 skill。
- 用户提供的《即将到来的循环-The Coming Loop》：提醒外层 harness loop 会放大“过度防御、复杂、只满足局部信号”的代码，需要 bounded / survivable harness 与人类判断。
- Vercel AI SDK 7 官方调研记录见关联调研文档。

## 决策日志

- 2026-06-29: 采用“受控 Loop 实践”，不采用无限自动化改 Runtime。原因：AI SDK 7 接入有大量可机械验证信号，适合 Loop；但 Runtime / Permission / Provider 是核心可信边界，默认切换必须有人审查。
- 2026-06-29: Native Runtime 优先，Codex Runtime / Claude Code Runtime 的 HarnessAgent 暂不作为替换路径。原因：现有 Codex Runtime 依赖 app-server JSON-RPC、approval bridge、provider proxy、MCP 注入、context accounting；AI SDK 7 HarnessAgent 当前仍偏实验 / POC。
- 2026-06-29: Phase 1 必须先做 Node 22 与构建链验证。原因：AI SDK 7 相关包当前要求 Node `>=22`，而项目仍有 Node 20 / Node 18 构建目标与 CI 配置。
- 2026-06-29: Provider request-shape 先于 Runtime loop 替换。原因：reasoning / effort / files / tool-call 参数是否真实传到目标 provider，会直接影响用户可见能力与“反假数据”验收。
- 2026-06-29: Codex 负责计划、审查、测试与文档；产品代码改动交由 Claude Code 实施。原因：遵守 AGENTS.md 的协作边界。
- 2026-07-01: 将协作循环基础设施拆到独立 exec plan。原因：private run space、bot 身份、handoff/review、ledger sync、通知和未来 orchestrator 是持续演进机制，不应混在 AI SDK 7 Runtime 升级计划里；本计划只作为 pilot。
- 2026-07-01: Phase 1 作为协作循环 hands-off pilot 执行。原因：用户希望在确认计划和创建专用 worktree 后，不再充当 Claude/Codex 中间消息队列；Claude/Codex 应在 private run issue 中完成实现、review、修复、验证和 smoke，直到 ready-for-user-acceptance 或触发 human gate。
- 2026-07-02: Phase 1 spike 由 hands-off runner 完成首跑（无人工干预：launchd tick 唤醒 → 实现 → 自验 → artifact → 自动发布）。结论：**升级可行且破坏面极小**——`ai` ^6.0.169→^7.0.11 + 5 个 `@ai-sdk/*` 包无 peer 冲突，`@ai-sdk/provider@4` 仍导出 `LanguageModelV3`（自定义 provider 包装层零改动）；唯一破坏面是 `LanguageModelUsage` 顶层 `cachedInputTokens`/`reasoningTokens` 移入嵌套 details，4 处编译错误 4 行机械修复。验证：升级前基线 3497 测试全过 → 升级后 3497 全过 + `npm run build` + Electron esbuild bundle。worktree commit `717bf93`（未 push）。Agent 上报三个剩余风险：本计划文档未提交进 git、worktree 内不可见（agent 无法回写进度，见协作计划同日决策）；无真实凭据未做 live provider smoke（建议作 Phase 1→2 门禁）；未跑完整 DMG/NSIS 打包。证据：`https://github.com/op7418/codepilot-agent-runs/issues/1#issuecomment-4862072251`。
- 2026-07-03: Phase 2 以 hands-off loop 启动（用户批准，干净开局）：不复用 issue #1，新开 run issue #6 作为 Phase 2 操作主账；worktree 先合入最新 main（`b2a48e3`，含全部计划文档）；两侧 launchd plist 指向 issue #6（源与装载经 `plutil -p` diff 确认同步）；验收契约首次以结构化 `--required-checks` 下发（8 条：三家 provider request-shape 逐参数证据、fixture 脱敏抽查、param 证据非推断、边界不变 diff 确认、human gate 遵守、tests green），publisher 对 accepted 硬门禁。范围：只做能力矩阵与 fixture 取证，不切默认 Runtime。证据：`https://github.com/op7418/codepilot-agent-runs/issues/6`。
- 2026-07-03: Phase 2 首轮实现被 Codex accepted，循环按设计停在 human gate。产出（commit `3008c1a`，34 文件 +2308 行）：Anthropic / OpenAI（chat + responses 两路径）/ OpenAI-compatible 的 sanitized request fixture（reasoning effort、tool choice auto/named/required、file image/pdf）+ `provider-request-shape.test.ts`（795 行）+ 能力矩阵。**required checks 硬门禁首次生产实战：8/8 全 pass 后 accepted 才放行**。真实发现：`@ai-sdk/openai@4.0.5` `.chat()` 路径 image 附件发裸 base64（`image_url.url` 缺 `data:` 前缀，包源码复现，矩阵按 broken/gated 处理）——正是本 Phase 要抓的"SDK 类型支持≠真实可用"实例。Codex 附 1 条 P3 非阻断（测试标题命名易误读，后续改名）。**循环停点**：Codex 以 `human-decision-needed` 交还用户——live smoke 需真实凭据（Anthropic / OpenAI / OpenRouter 类），且 image bug 收口方式是产品取舍；等用户决策后再继续。证据：`https://github.com/op7418/codepilot-agent-runs/issues/6#issuecomment-4868801912`。
- 2026-07-03: 用户对 Phase 2 live smoke 的 human gate 给出决策：用 CodePilot DB 已配置的 provider 跑冒烟（选项 a），不新发 key。约束与提示：部分渠道可能有额度问题，联不通要多重试几次、如实记录；ClinePass 与 OpenCode Go 两渠道用户确认可用（分别覆盖 openai-compatible 与 anthropic shape，OpenCode Go 另有 openai-compatible 端点）；OpenRouter 行覆盖 openrouter shape。执行发现并上报：DB 中 `CCsub` 行 base_url 字段误填了 API key（配置错位），冒烟跳过该行并待用户修复；agent 侧对 codepilot.db 只读、所有产出禁含 key。
- 2026-07-03: Phase 2 收口（Codex 终审 accepted，8/8 smoke required checks）。live smoke 结论：网关类渠道上 reasoning/effort（OpenRouter 实测 `usage.reasoningTokens=117` 语义生效）、tool choice（`finishReason=tool-calls`）、anthropic/openai-compatible/openrouter 三 shape 均有真实接受证据；失败如实记录并归因——OpenCode anthropic-skin tools 4xx 定位为网关上游转发问题（隔离 probe 排除我方 wire 形状与 beta header 假设，tools 保持 capability-gated）、ClinePass 500（重试 3 次，待渠道恢复复测）、CCsub base_url 误填 key 跳过待用户修。安全：DB 只读、全部产出经 key 子串比对 + 形态 grep 确认 CLEAN。工程仲裁（Codex）：保留 `scripts/smoke-ai-sdk7-phase2-live.mjs`（只读、脱敏、可复跑），合并前处理掉 untracked `.smoke-report.tmp.json`。Phase 2 达到进入 Phase 3 评估门槛；官方一方 key smoke 与网关 image data URL 接受度列为 open gate，默认开放用户可见能力或发版前必须补。证据：`https://github.com/op7418/codepilot-agent-runs/issues/6#issuecomment-4874082384`。
- 2026-07-03: Phase 2 fixture 取证完成（hands-off run issue #6，commit 见本 worktree）。产出：`src/__tests__/unit/provider-request-shape.test.ts`（29 targeted test，mock fetch 捕获真实出网请求）+ `src/__tests__/fixtures/provider-request-shape/`（28 个 sanitized fixture，含卫生自检用例）+ [矩阵文档](../../research/ai-sdk-7-provider-request-shape-matrix.md)。验证：`npm run test` 3526/3526 全绿（新增 29）。关键发现：(1) `@ai-sdk/anthropic@4.0.5` effort 走 `output_config.effort` 且**不带**任何 effort beta header——agent-loop 为 Opus 4.7+ 丢弃 native effort 的前提（"SDK 仍附 deprecated effort-2025-11-24 beta"）已失效，待 1 条真实 smoke 后可考虑撤 gate；(2) Anthropic 带 tools 请求被 SDK 自动追加 `structured-outputs-2025-11-13` beta、带 PDF 追加 `pdfs-2024-09-25`，第三方代理接受度未知 → 代理路径 tools/PDF 保持 capability-gated；(3) **采用阻断项**：`@ai-sdk/openai@4.0.5` `.chat()` 路径（现行网关路径）把 image 发成裸 base64（无 `data:` 前缀），Responses 路径与 `@ai-sdk/openai-compatible@3.0.3` 均正确——main 基线（ai@6）行为本轮沙箱内无法取证，升级采用前必须收口；(4) Codex Responses 路径 system prompt 双发（`input[developer]` + `instructions`），P2 待产品取舍。真实凭据 smoke 未跑（无凭据，不猜）→ Phase 2 保持 🚧，接受度结论一律按 gated 处理。
- 2026-07-03: 发现 3 本地收口（run issue #6 fix 轮，Codex 裁决 option a：本地 wrapper 而非 gated 等 upstream / patch node_modules）。改动：新增 `src/lib/openai-chat-image-normalizer.ts`（`withChatImageDataUrlFetch`：仅对 `…/chat/completions` 的 JSON body、仅当 `image_url.url` 为裸 base64 时按 magic-byte sniff（png/jpeg/webp/gif/svg）补 `data:<mime>;base64,` 前缀；schemed URL / 未识别字节原样透传，upstream 修复后自动 no-op 防双前缀），接入 `ai-provider.ts` 非 OAuth openai 网关分支；未触碰默认 Runtime/provider/model/permission/DB schema，无用户可见开关。P3 一并收口：request-shape 测试标题改为与断言一致（app 路径断言规范 data URL），另加显式命名 `upstream bare base64` 的无 wrapper 对照测试 + fixture `openai-chat-file-image-upstream-bare-base64`（SDK 升级修复后该 fixture drift 报警 → 撤 wrapper 信号）。验证：`npx tsx --test provider-request-shape` 30/30 + `openai-chat-image-normalizer` 12/12，`npm run test` 全绿（数字见 run issue #6 本轮 artifact）。网关对 data URL 的真实接受度仍是 human gate smoke，不在本轮下结论。
- 2026-07-03: Phase 2 live smoke 完成（run issue #6，用户批准使用本机已配置渠道；`scripts/smoke-ai-sdk7-phase2-live.mjs`——DB `api_providers` 只读打开、镜像 `ai-provider.ts` 的 provider 构造与 `agent-loop.ts` 的 providerOptions、`maxRetries:3` 指数退避、全输出脱敏只留响应 id/usage/状态码）。结论：(1) **三条 wire 的 reasoning/effort 与 tool choice 参数在真实网关全部按 fixture 形状发出且被接受**——OpenRouter `reasoning_effort` 实测语义生效（usage.reasoningTokens=117），OpenRouter / OpenCode(OpenAI skin) named tool_choice 均 finishReason=tool-calls 且调用了指定工具；(2) OpenCode Go anthropic skin 接受 `thinking:{enabled,budget_tokens}` 与 `output_config.effort`（200 未拒；effort 在 glm-5 上语义生效未证；**发现 1 的官方 Anthropic API 接受度仍未测——本机没有官方一方 key**）；(3) 当时记录两条网关 finding：**#47** direct SDK harness 对 OpenCode Go Anthropic 深路径打错 `/messages`、**#48** ClinePass direct 非流式路径无法解析 `{"data"}` 信封（请求已被计费）；2026-07-04 真实 `/api/chat` UI smoke 后已更正边界：#47 不是主聊天产品阻塞，#48 仅限非流式/辅助路径兼容债；(4) OpenCode anthropic skin 的 tools 转发网关侧损坏（401/400 跨模型跨 tool_choice 形态一致，且 no-beta 变体同样失败→发现 2 的"beta header 破坏代理"假设在此网关被**排除**，但其他代理/官方仍未测，代理 tools 保持 capability-gated）。CCsub 行 base_url 为凭据形态（配置错位）按指令跳过。剩余 open gate：官方一方 Anthropic effort / OpenAI / 网关 image data URL 接受度（本机无对应渠道）。
- 2026-07-03: Phase 3 ToolLoopAgent side-by-side POC 完成（run issue #7 首轮，commit `df080e0` + 本轮 smoke/gap-list commit）。产出三件套：①`src/lib/experimental/agent-loop-toolloop-poc.ts`——runAgentLoop 的 ToolLoopAgent 版镜像（仅实验路径，应用代码零 import，无用户可见开关；复用同一 createModel/assembleTools，approval 仍走 in-execute 阻塞而非 SDK toolApproval 停机语义）；②`toolloop-poc-parity.test.ts` 8 个 side-by-side 测试 + committed golden：SSE 逐事件（text/thinking/tool_use/tool_result/step_complete finishReason/error/abort/result/done）、wire 逐请求体 deepEqual、DB history（route 消费复刻 + buildCoreMessages 重建）逐字节、permission approve/deny/abort-while-pending 全等且 permission_requests 终态一致（timeout 由共享 registry 既有测试按构造覆盖）；③live smoke（OpenRouter chat skin / claude-haiku-4.5，DB 只读、数据目录隔离、输出 scrub）text-only + Read tool call + approval denied 3/3 一次通过。**真实发现（正是 side-by-side 的目的）**：ToolLoopAgent 在 provider 错误轮与 abort-带-pending-tool-call 轮会优雅收尾，而 agent-loop 走 throw→catch 尾部**不发 result 事件**——naive 替换会把失败/中断轮的 usage 持久化成正常轮（假数据面）；两处已在 adapter 内补偿并被测试锁定。**结论：partial adopt**——不替换默认 loop（同底层 streamText，替换无新能力却引入尾部语义风险），adapter+parity 套件保留为 Phase 4/5 的迁移 harness 与回归门禁；P0 阻断未发现。Gap list（P1×3 / P2×4 / P3×2，逐条溯源到测试或 smoke 报告）：[ai-sdk-7-toolloop-parity-gaps.md](../../research/ai-sdk-7-toolloop-parity-gaps.md)。验证：`npm run test` 3547/3547 全绿。
- 2026-07-03: Phase 3 收口（Codex accepted，8/8 checks，issue #7 两轮直过）。POC `src/lib/experimental/agent-loop-toolloop-poc.ts`（纯实验路径）+ 8 条 parity 测试 + golden fixture + 真实网关 3/3（text-only / tool call / approval denied）。结论 **partial adopt**：ToolLoopAgent 能承载 Native loop（SSE 逐事件、wire deepEqual、DB 逐字节、permission approve/deny/abort 全序列 parity），但依赖两处尾部语义补偿，替换默认 loop 收益不成立、风险面在细节语义——维持现状，Phase 5 决策门再评。已知覆盖弱点如实标注：permission timeout parity 为"按构造+既有测试"级。Codex 指令：按 partial adopt 进 Phase 4，默认一切不动。证据：`https://github.com/op7418/codepilot-agent-runs/issues/7#issuecomment-4874740131`。
- 2026-07-03: Phase 4 按 phase 自动推进规则启动（无需用户拍板，issue #8）。范围：timeout 原因码落库、approval HMAC 安全测试、DevTools/trace 默认脱敏、`@ai-sdk/mcp` read-only + write/approval 双 POC、产出可发布小能力清单；明确不做 WorkflowAgent/默认开 DevTools/改 MCP permission 默认/大 UI 改版；触及 credential、日志脱敏、权限默认值、用户可见文案即停（gap 或 human gate）。
- 2026-07-03: Phase 2-4 运行中问题清单补记。**技术事实**：① `@ai-sdk/openai@4.0.5` Chat Completions image input 曾发裸 base64，已由本地 wrapper 收口并以 fixture/test 锁住；② ToolLoopAgent side-by-side POC 证明正常路径可 parity，但错误/abort/pending tool-call 尾部语义需要补偿，故只 partial adopt、不替换默认 Runtime；③ Phase 4 触及 timeout / approval / trace / MCP adapter，凡涉及 credential、脱敏、权限默认、用户文案必须留 gap 或 human gate，不得用“测试绿”掩盖边界变化。**证据问题**：① live provider smoke 可能因 reviewer 环境 DNS/网络限制无法由 Codex 复跑，Codex 侧应审脱敏报告、fixture、无泄漏扫描与 required checks，而不是伪装成已真实打网关；② raw probe / 临时归因 id 需落脱敏文件或 issue comment，不能只出现在 narrative；③ Phase 4 单轮体量过大已回流协作计划，后续 AI SDK phase 应拆成更小 run（每轮 1-2 个能力 + 独立 required checks）。对应 runner/harness 债务见 `agent-collaboration-loop-infrastructure.md` 与 tech-debt #49。
- 2026-07-03: Phase 4 四件套实现完成 + 收尾轮验证（issue #8 第二轮；首轮完成实现但在 headless 模式把测试挂后台后退出，未 commit）。收尾轮审阅未提交改动确认自洽后，**在前台完整复跑时发现并修复一个首轮自称"验证过"但实际挂死的 P1**：hung-tool timeout 测试永不结束——ai@7 只把 abort signal 传给工具 `execute()` 仍 await 其 promise，无视 signal 的挂死工具让 `fullStream` 永不结束，`TIMEOUT_TOOL_EXECUTION` 触发后 loop 依然卡死（恰是该预算要防的场景）；修复=controller 新增 `guardStream`（预算触发时 race 流读取解锁消费循环；无预算原样透传零开销）+ 预算定时器去掉 `unref`（空闲事件循环中 unref 定时器永不触发）。产出：①`native-timeout.ts` 四类原因码（connect/first-token/tool-execution/total-run，语义契约+source breadcrumb 在模块头，默认全关）接线 agent-loop→SSE error→route error fallback 落库，`error-classifier` 增四类；②`permission-approval-token.ts` 无状态 HMAC approval token（篡改/伪造 403、持久化 expires_at 过期 410、重放 409），4 个签发点+2 个回传点全接线，route 强制校验；③`aisdk-trace.ts` fail-closed 结构化脱敏 trace（allowlist+digest+`sanitizeLogLine`，`CODEPILOT_AISDK_TRACE=1` 显式开、默认不传 telemetry 选项）；④`experimental/mcp-sdk-adapter-poc.ts` @ai-sdk/mcp POC（复用生产 `wrapWithPermissions` 非复刻，生产 MCP 文件零改动，`@ai-sdk/mcp@2.0.7` 仅 devDependency）+ stdio fixture server + smoke 脚本（挂为 `npm run smoke:mcp-poc`）。验证（全部前台阻塞跑完）：`npm run test` 3590/3590 全绿（新增 43：timeout 15+guardStream 2 / approval 12 / trace 4 / MCP POC 8 + parity token 契约）；`npm run smoke:mcp-poc` 3/3（read-only approve / write deny 反例服务端未写入 / write approve 落盘，approval token 交叉验证过），证据 `_smoke-evidence/ai-sdk7-phase4-mcp-poc-smoke.json`。可发布清单+阻断项：[ai-sdk-7-phase4-shippable-capabilities.md](../../research/ai-sdk-7-phase4-shippable-capabilities.md)。停止条件遵守：timeout 预算默认值/用户文案、trace raw 模式、MCP 生产替换均列为阻断项未擅动。待 Codex review。
- 2026-07-03: Phase 4 fix 轮完成（issue #8 第三轮，Codex fix_requested P1×1 + P2×1 全部收口）。**P1（timeout 语义验收失败）**：首版 `native-timeout.ts` 在 `onStepRequest()`（请求发出时）即 arm first-token 定时器，Codex 现场复现连接黑洞 + 只配 `firstTokenMs` 时被误分类为 `TIMEOUT_FIRST_TOKEN`——违反"first-token = provider 已响应但无输出"契约，source breadcrumb 落库即失真。根因：把"请求发出"当成了 first-token 计时起点，抢占了本属 connect 的窗口。修复：first-token 定时器只由 `start-step` part（响应到达信号）arm，请求阶段绝不 arm；加 `stepOutputSeen` 防迟到 start-step 重复 arm。反例测试补齐：黑洞+只配 firstTokenMs 不触发任何 timeout（该窗口归 connect）、黑洞+firstTokenMs<connectMs 控制器级与真实 runAgentLoop 端到端均分类为 TIMEOUT_CONNECT、first-token 计时起点在 start-step 而非请求时刻（预算 2 倍的预响应时间不消耗预算）。**P2**：shippable 清单同步——timeout 条目补记本 P1 与修复、语义契约备忘注明 first-token 计时起点。验证（全部前台）：Codex 原复现脚本 → `fired=null`；`npm run test` 3594/3594 全绿（+4 均为新反例）；`npm run smoke:mcp-poc` 3/3 allPass 证据刷新。commit 见本 worktree（fix 轮单 commit）。
- 2026-07-03: 用户交互走查抓到 ai@7 迁移回归（Codex Runtime 发"你好"即报 "System messages are not allowed in the prompt or messages fields"）。根因：ai@7 core 禁止 messages[] 携带 role:system，而 Codex proxy 的 buildMessages 仍把 body.instructions prepend 成 system message（Codex 定位方向正确）。修复：buildMessages → buildPrompt，在唯一 choke point 把 body.instructions 与 translate-input 产出的 system/developer 项统一抽进 streamText/generateText 的 `instructions` 选项（SDK 对 chat 家族会在 wire 上还原为 system message，P0"编译器 prompt 到达所有 provider 家族"不变量不变）；顺带全仓扫尾：agent-loop.ts 与 text-generator.ts 的已废弃 `system:` 别名改为 `instructions:`（wire 相同），确认无其他 role:system 构造点。防回归：buildPrompt 三态单测（"你好"场景/system+developer 抽取/无 system 来源）+ 旧 P0 pin 测试按新载具重写（含"两条发送路径必须带 instructions 选项"源码 pin）。验证：targeted 36/36 + 全量 3598/3598。
- 2026-07-04: Phase 4 收口（Codex 终审 accepted，8/8 checks，零 findings；ade3465 回归修复同轮核验通过；用户已确认四项安全默认值：HMAC 默认开/trace 默认关无 raw/timeout 预算默认关/MCP 仅 POC）。Phase 5 按自动推进规则启动（issue #10）：范围=修复 Phase 3 gap list 的 P1 机械项、三类真实场景对照（长文本/tool call+approval/abort 后续发）、Smoke Ledger 回填、产出 go/partial/no-go 决策文档 + rollback plan；本 phase 不切默认 Runtime，最终采用决策依规则转 human gate。
- 2026-07-04: Phase 5 决策门三件套完成（run issue #10 首轮，commit 见本 worktree Phase 5 单 commit）。**①gap 收口**：P1×3 全关闭——#1/#2 的 adapter 补偿由 `toolloop-poc-parity.test.ts` 8/8 复跑持续锁定；#3（approval 机制取向）降级论证关闭：Phase 4 已用事实否定「HMAC 需要 SDK toolApproval」前提（HMAC 完整落在 in-execute 路线且 accepted），不迁移 approval 交互模型。P2/P3：#6/#8/#9 关闭（#8 有 Phase 5 新实证——四场景两 loop input_tokens 逐场景完全相同），#4/#5 backlog 为替换路线前置条件，#7 归档 tech-debt #49。**②三类真实场景对照**（新脚本 `scripts/smoke-ai-sdk7-phase5-decision.ts`，prod `runAgentLoop` vs POC `runToolLoopAgentPoc` 同参数逐场景对照，OpenRouter chat skin / claude-haiku-4.5，DB 只读、证据零凭据形态 grep 确认）：长文本（7060/7318 字符，归一化事件序列相同，usage 契约一致）/ approval 批准（printf 触发 ask→allow→真执行，marker 双双命中；注意 `echo` 在默认规则自动放行不可用作探针）/ approval 拒绝（deny 文案进 tool_result 双侧一致）/ abort→continue（中断轮 done 收尾无 error 气泡、同 session 续发 `RESUMED OK` 一次通过）——4/4 contractMatch=true，output tokens 差异均为 sampling 如实记录。**③决策文档**：[ai-sdk-7-adoption-decision.md](../../research/ai-sdk-7-adoption-decision.md)，结论 **partial**（依赖升级 go / provider 能力 capability-gated go / Phase 4 外围能力 go / `@ai-sdk/mcp` 与默认 loop 替换 no-go-现在），含四层 rollback plan（能力开关→wrapper→runtime switch→known-good version）与替换路线前置条件清单。验证：`npm run test` 全绿（数字见 run issue #10 artifact）；smoke 修 2 处脚本层问题（echo 自动放行、marker 校验用全文）1 个 fix cycle 内收敛。默认 Runtime/聊天路径零变化；最终采用决策留人类闸门。
- 2026-07-04: Phase 5 收口（Codex accepted，8/8 checks，零 findings，一轮直过；commit `fd82742`）。产出：P1 parity gap 修复、三类真实场景 prod/POC 对照（长文本/tool call+approval 双分支/abort 后续发，abort 场景的 UI 层边界如实标注）、Smoke Ledger 回填、采用决策文档（结论 partial，六项逐条溯源）+ rollback plan。循环以 human-decision-needed 终止于设计内的用户闸门：采用建议待用户拍板；后续行动=用户批准后合并 spike 分支（用户发起）+ 发版前补官方一方 key smoke（open gate）。AI SDK 7 pilot 全部 phase 至此完成。
- 2026-07-04: 用户批准 partial 采用（pilot 终点闸门解除，issue #10 关闭）。采用：ai@7 依赖升级、provider 能力 capability-gated、image wrapper、Phase 4 四件套（按已确认默认值）；不采用：@ai-sdk/mcp adapter（留 POC）、默认 agent loop 替换。保留 gate：发版前官方一方 key smoke。后续：spike 分支合并回 main 由用户发起；合并完成后本计划移至 completed/。
- 2026-07-04: 合并后 final smoke 复跑完成（用户确认 ClinePass / OpenCode Go 凭据可用）。Phase 2 direct SDK smoke 报告落 `completed/_smoke-evidence/ai-sdk7-final-phase2-live-smoke-2026-07-04.json`：OpenCode Go (OpenAI) 3/3 绿（basic/reasoning/tool_choice）；OpenCode Go (Anthropic) raw/fallback `/v1/messages` 绿、thinking/effort 绿；ClinePass raw 200（`data` 信封、`content=ok`、有 usage），但 direct `generateText()` / `.chat()` 非流式探针仍 `Invalid JSON response`。用户随后用真实 UI 验证通过，Codex 复核发现前述 direct SDK 结论混淆了执行面：OpenCode Go Anthropic 在产品路径由 resolver 路由到 `claude-code-compat`（会补 `/v1/messages`），不是 direct `@ai-sdk/anthropic`；ClinePass 主聊天走 `/api/chat` streaming，可消费 GLM-5.2。补跑真实 UI 后端 smoke 报告落 `completed/_smoke-evidence/ai-sdk7-final-ui-api-provider-smoke-2026-07-04.json`：ClinePass GLM-5.2 与 OpenCode Go Anthropic MiniMax M3 均 HTTP 200、SSE 含 `result/done`、marker 命中，临时会话清理为 0。Phase 5 对照 smoke 复跑 `completed/_smoke-evidence/ai-sdk7-final-phase5-decision-smoke-2026-07-04.json`：长文本、approval allow/deny、abort→continue 四场景 prod/poc 均一次通过且 contractMatch=true。结论：AI SDK 7 partial 采用仍成立；#47 收敛为 smoke harness 执行面误用/工具能力 gate，不是主聊天产品阻塞；#48 收敛为 ClinePass 非流式/辅助路径兼容债，不是 GLM-5.2 主聊天不可用。
- 2026-07-04: 用户要求扩大到“真实浏览器调用和模拟测试，不只是连通性”。新增影响面 smoke 报告落 `completed/_smoke-evidence/ai-sdk7-impact-browser-and-simulation-smoke-2026-07-04.json`：①真实浏览器 UI 主聊天 ClinePass GLM-5.2 / OpenCode Go Anthropic MiniMax M3 均通过（assistant DB 消息命中 marker）；②真实浏览器 UI 工具权限 deny 通过（OpenCode Go OpenAI GLM-5.2 触发 Bash permission card，点击 Deny 后 assistant 得到 tool_result，随后同会话续发 marker 成功）；③真实浏览器 UI 长流 Stop/interrupt 失败（生成中控件仍叫“发送消息”，点击后重复写 user prompt；`/api/chat/interrupt` 返回 true 但 `runtime_status=streaming` 与 `session_runtime_locks` 残留，转 tech-debt #52）；④辅助 route `/api/media/jobs/plan` 对 OpenCode Go OpenAI 通过，但对 ClinePass GLM-5.2 / OpenCode Go Anthropic MiniMax M3 返回 `planning_start,error,done` 且未抽出 plan JSON，转 tech-debt #53。临时会话、消息、permission、lock 均已清理为 0。
- 2026-07-02: Codex 复审接受 Phase 1。复审复跑 `npm run test`（3497/3497）、`npm run build`、`node scripts/build-electron.mjs`，并确认 diff 只包含 `package.json` / `package-lock.json` / 3 个 usage UI 适配文件；未触碰默认 Runtime/provider/model/permission/DB schema。`review_requested + LanguageModelUsage` 语义核对通过：cache row 读取 `inputTokenDetails.cacheReadTokens`，reasoning row 读取 `outputTokenDetails.reasoningTokens`，与 AI SDK 7 `LanguageModelUsage` 类型一致。Phase 1 结论：可进入 Phase 2 provider request-shape / live smoke；不得因此直接切默认 Runtime。证据：`https://github.com/op7418/codepilot-agent-runs/issues/1#issuecomment-4862072251`。

## Loop Operating Rules

### 允许自动化继续的信号

Loop 只能在下面这些机械信号上自动迭代：

- `tsc` / `npm run test` / targeted unit tests 的失败与修复。
- dependency install / lockfile / build matrix 的确定性错误。
- provider request fixture 的结构 diff。
- Native Runtime SSE event parity diff。
- approval / timeout / MCP adapter 的可重复测试失败。
- lint-docs-drift / docs index drift。

### 必须停下来给人审查的信号

下面情况不得由 Loop 自动继续：

- 默认 Runtime、默认 provider、默认 model、权限策略发生变化。
- 日志脱敏、安全边界、credential、DB schema、migration 被触及。
- UI 文案承诺新增“安全、修复、诊断、导出、自动化”等用户信任语义。
- Loop 为了通过测试引入复杂分支、过度 defensive code、不可解释 fallback。
- 连续 3 次自动迭代仍未收敛，或同一失败原因重复出现。
- 需要真实账号 / 真实 provider key / 真实 MCP server 才能判断。

**工程取舍不停循环（用户规则，2026-07-03）**：bug 收口方式、实现路径选择、测试策略等有工程正解的取舍，由 Codex 在 review artifact 里裁决并记录（judgment 写方向与理由、nextAction 给指令），用 fix-requested / claude-implementing 推进循环；双方分歧走 loop 轮次讨论，3 轮不收敛才升级 human-decision-needed。human gate 收窄为：真实凭据、花钱/配额、发布、安全与权限边界、用户明确保留的产品方向。

### Loop 运行约束

- 每个 run 最多 3 个自动迭代 cycle，超过后进入人工 triage。
- Loop 不得 auto-merge、auto-push、auto-release。
- Loop 每轮必须记录：输入信号、尝试改动、验证命令、结果、下一步。
- 代码实现由 Claude Code 执行；Codex 可审查、跑测试、写计划 / 研究 / handoff / 测试用例。
- P1/P2 finding 不能靠聊天关闭，必须有修复、测试证据或 tracker。
- 所有 Runtime / Provider / MCP / Permission 的真实 smoke 必须进入 Smoke Ledger。

## 详细设计

### Phase 1 — Node 22 / AI SDK 7 依赖升级可行性 spike

用户会看到什么变化：

- 暂时不会看到 UI 或 Runtime 行为变化。
- 会得到一份 go / no-go 结果：AI SDK 7 能否在当前 Electron + Next.js + CI + packaging 链路下工作。
- 这是协作循环的第一个 hands-off pilot：用户只负责确认计划、创建/指定 worktree、最终验收；中间 Claude/Codex handoff 走 private run issue。

验收入口：

- `package.json` / lockfile 的 spike diff。
- CI matrix / Electron main build / renderer build / unit tests 的验证记录。
- 依赖升级失败时，要有具体阻断点和回滚建议。

本阶段明确不做：

- 不切换 Native Runtime 默认 loop。
- 不接入 HarnessAgent 到 Codex / Claude Code Runtime。
- 不改变 provider 默认模型、用户配置、DB schema。
- 不 auto-merge、不 auto-release、不直接改 main。

Loop 实践方式：

- Loop 输入：AI SDK 7 package set、Node 22 requirement、当前 build/test 失败。
- 自动迭代范围：依赖版本、类型错误、测试 import breakage、构建目标配置 spike。
- Stop condition：构建链全绿，或连续 3 次失败仍指向同一 Node / Electron / package blocker。

建议验证：

- `npm install` 或等价 lockfile 更新。
- `npm run test`
- renderer build / Electron main build 的现有命令。
- `node scripts/lint-docs-drift.mjs`

产物：

- Spike branch / patch summary。
- “是否进入 Phase 2”的决策日志。
- Private run issue 中的 Claude `review_requested`、Codex `review_completed`、必要修复循环和 final `codex-accepted` / `human-decision-needed`。
- Ready-for-user-acceptance 摘要：改动、验证、残余风险、用户验收入口。

### Phase 2 — Provider request-shape 能力矩阵

用户会看到什么变化：

- Settings / Runtime 能力说明未来可以更诚实地展示 reasoning / effort / files / tool support。
- 在本阶段结束前不承诺 UI 新能力。

验收入口：

- Provider matrix：Anthropic、OpenAI、OpenAI-compatible / OpenRouter 类 provider 对 AI SDK 7 参数的真实 request shape。
- sanitized request fixture：证明 reasoning / effort / tool choice / file input 是否真的传出。
- 兼容性结论：哪些能力可以默认开放，哪些只能 capability-gated。

本阶段明确不做：

- 不因为 AI SDK 7 类型支持就宣称三方 provider 支持。
- 不把 fixture 里的敏感 header、token、完整 prompt 写入仓库。
- 不新增用户可见开关，除非有真实 provider 验证。

Loop 实践方式：

- Loop 输入：provider capability list、fixture diff、现有 provider resolver 规则。
- 自动迭代范围：测试 fixture、capability matrix、request-shape adapter 的建议 diff。
- Stop condition：任一 provider 需要产品取舍，或 fixture 与真实 provider 行为不一致。

建议验证：

- Provider resolver targeted tests。
- Sanitized request snapshot tests。
- 至少 Anthropic + OpenAI 各一条真实 smoke；OpenAI-compatible 先以一个主流代理 provider 验证。

产物：

- Provider capability matrix。
- 若需要产品文案调整，开 P1/P2 finding 或 plan note，不在聊天里关闭。

### Phase 3 — Native Runtime ToolLoopAgent side-by-side POC

用户会看到什么变化：

- 默认聊天体验不变。
- 可能增加仅开发可见的 experimental path / test-only path，用来比较现有 `agent-loop.ts` 与 AI SDK 7 ToolLoopAgent。

验收入口：

- SSE parity：text delta、tool call、tool result、approval prompt、abort、error、finish reason。
- DB history parity：message / part / tool invocation / context accounting 不丢。
- Permission parity：approval 弹窗、拒绝、超时、中断都能回到可发送状态。

本阶段明确不做：

- 不替换 Codex Runtime。
- 不替换 Claude Code Runtime。
- 不把 ToolLoopAgent 作为默认 Native Runtime。
- 不压掉现有 CodePilot SSE / DB / checkpoint / rewind 语义。

Loop 实践方式：

- Loop 输入：golden transcript、tool-call scenario、permission scenario、abort scenario。
- 自动迭代范围：adapter POC 与 parity tests。
- Stop condition：差异涉及产品语义，例如用户看到的权限文案、tool event 顺序、history schema、session recovery。

建议验证：

- Native Runtime unit / integration tests。
- SSE golden snapshot。
- abort / stop / permission manual smoke。
- 真实 provider smoke 至少覆盖 text-only + one tool call + approval denied。

产物：

- ToolLoopAgent POC 结论：replace / partial adopt / no-go。
- Parity gap list，按 P0/P1/P2 标注。

### Phase 4 — 第一批安全落地能力

用户会看到什么变化：

- Native Runtime 错误和超时更清晰。
- 权限 approval token 更安全。
- 开发 / 调试时能看到更结构化的 AI SDK trace 或 step timeline。
- MCP tool adapter 更接近 AI SDK 7 的标准形态，但用户现有 MCP 行为不应退化。

验收入口：

- timeout：connect / first token / tool execution / total run 的原因码准确落库和展示。
- approval HMAC：token 过期、篡改、重复使用都被拒绝。
- DevTools / trace：默认不泄露 prompt、credential、secret。
- `@ai-sdk/mcp` POC：至少一个 read-only MCP tool 和一个 write/approval MCP tool 通过。

本阶段明确不做：

- 不做 WorkflowAgent cloud durable workflow。
- 不把 AI SDK DevTools 默认打开给普通用户。
- 不改变 MCP permission 默认策略。
- 不做大规模 UI 改版。

Loop 实践方式：

- Loop 输入：timeout failure、approval failure、MCP adapter failure。
- 自动迭代范围：测试、adapter 小修、文档 ledger。
- Stop condition：涉及 credential、日志脱敏、权限默认值、用户可见文案。

建议验证：

- timeout targeted tests。
- approval security tests。
- MCP read/write smoke。
- log redaction inspection。

产物：

- 第一批可发布小能力清单。
- 若不能发布，列出阻断与保守替代方案。

### Phase 5 — Native Runtime 迁移 / 保守采用决策门

用户会看到什么变化：

- 若 parity 与 smoke 通过：Native Runtime 可逐步切到 AI SDK 7 ToolLoopAgent backed implementation。
- 若不通过：保持现有 Runtime loop，只采用 provider/mcp/timeout/devtools 等低风险能力。

验收入口：

- Phase 1-4 所有 P0/P1 gap 已关闭。
- 至少覆盖三类真实场景：长文本、tool call + approval、abort / stop 后继续发送。
- Smoke Ledger 有真实 Runtime / Provider / Model / 凭据形态记录。

本阶段明确不做：

- 不为了“统一”强行替换 Codex / Claude Code Runtime。
- 不接受只靠单元测试、没有真实 smoke 的默认切换。
- 不把 WorkflowAgent 作为本地桌面主聊天执行引擎。

Loop 实践方式：

- Loop 输入：parity gap list、smoke result、user-visible regression。
- 自动迭代范围：只允许修复已分类的机械 parity gap。
- Stop condition：任一 P1/P2 用户信任问题未闭环。

产物：

- 迁移决策：go / partial / no-go。
- Rollback plan：feature flag、runtime switch、known-good version。

### Phase 6 — 自动化 Loop 产品化沉淀（已拆出）

用户会看到什么变化：

- 本计划不会继续扩成协作基础设施工程。
- AI SDK 7 的 pilot 结果会输入 [Agent Collaboration Loop Infrastructure](../../handover/agent-collaboration-space.md)，用于沉淀 bounded loop harness。

验收入口：

- 本计划记录 AI SDK 7 pilot 对 loop 的反馈：哪些自动化 cycle 有用，哪些需要人工停机。
- 协作循环计划记录机制层验收：private run issue、handoff、notification、ledger sync。

本阶段明确不做：

- 不在 AI SDK 7 计划中继续设计 GitHub Project / Actions / Notion / Cloudflare。
- 不把 Runtime 技术迁移和协作基础设施混成一个交付口径。

Loop 实践方式：

- AI SDK 7 Phase 1-5 每个 private run issue 的操作主账在 `op7418/codepilot-agent-runs`。
- 本计划只 mirror 影响 Runtime 迁移判断的 loop summary。
- 协作基础设施计划负责汇总和演进通用 harness。

产物：

- AI SDK 7 pilot feedback note。
- 指向协作基础设施计划的 ledger summary。

## 成本估算

### 快速实践版

| 范围 | 预估 | 适合目标 |
|------|------|----------|
| Phase 1 + Phase 2 | 1-2 天 | 判断 AI SDK 7 能否升级、provider 能力是否真实 |
| Phase 3 POC | 1-2 天 | 证明 ToolLoopAgent 是否能承载 Native Runtime |
| Phase 4 小能力 | 1-2 天 | 先落 timeout / approval / DevTools / MCP adapter 中最稳的部分 |

如果 Claude Code 专注实现、Codex 同步审查测试，最激进可以在 2-4 天拿到“能不能换”的硬结论。

### 稳妥发布版

| 范围 | 预估 | 适合目标 |
|------|------|----------|
| Phase 1-3 完整 parity | 3-5 天 | 不冒险切默认 Runtime，先跑出 POC 与 gap list |
| Phase 4 可发布能力 | 2-4 天 | 发布低风险增量，避免大爆炸迁移 |
| Phase 5 默认迁移 | 视 parity gap 决定 | 如果 gap 少，约 2-4 天；如果涉及 DB / permission / stop recovery，另算 |

这个估算不是因为写代码慢，而是因为这条链路一旦出错，用户看到的是“消息丢失、权限错误、工具误执行、停止后卡死、模型能力虚标”。Loop 能压缩机械验证时间，但不能省掉真实 smoke 与审查。

## 风险与防线

| 风险 | 表现 | 防线 |
|------|------|------|
| Loop 只优化局部信号 | 测试绿了，但用户路径退化 | 每阶段必须写用户可见变化和真实 smoke |
| 过度 defensive code | 为兼容所有 provider 堆复杂 fallback | Provider matrix + capability gate，不做假支持 |
| Runtime 语义漂移 | SSE / DB / permission / context accounting 顺序变化 | ToolLoopAgent side-by-side parity，不直接替换 |
| AI reviewer prompt injection | diff / 注释诱导跳过测试或放宽规则 | Codex review 按 AGENTS.md 和 CLAUDE.md 规则核对 |
| Node 22 hidden cost | Electron build / CI / native dependency 失败 | Phase 1 先做工具链 spike |
| 日志 / telemetry 泄露 | DevTools 或 trace 暴露 prompt / token | 默认关闭，先做 redaction inspection |
| Provider 能力虚标 | UI 承诺 reasoning / files，但代理 provider 不支持 | request fixture + real smoke 才开放 |

## Claude Code 接手提示

接手时不要只执行 checklist。请先复述：

1. 用户争议：代码可以很快写完，但 Runtime 默认迁移的成本主要在真实 smoke、provider request-shape、permission / stop / DB 语义。
2. 取舍理由：本计划把 AI SDK 7 作为 bounded loop 实验，而不是无限自动化改核心 Runtime。
3. 执行边界：先 Phase 1/2，拿 go / no-go；不要碰 Codex / Claude Code Runtime 替换；不要改默认用户体验。

首个建议任务：

- 建立一个 spike branch。
- 升级 Node / AI SDK 7 package set。
- 跑 build/test，记录所有失败。
- 只允许 Loop 自动修机械失败，最多 3 cycle。
- 把结果回填到本计划的决策日志和 Smoke Ledger。

## Smoke Ledger（真实凭据 / UI / E2E 验证记录）

> 跑了真实 AI SDK 7 / Runtime / Provider smoke 后必须在这里登记一行：Runtime / Provider / Model / 凭据形态 / 场景 / 结果 / 证据。不要把这类信息只留在聊天里。
> Private `codepilot-agent-runs` issue 可以保存更细的命令、handoff 和失败细节；本表是产品计划的验收摘要 mirror，必须链接 private issue/comment 或其他可追踪 evidence。
> 第一次跑前可保留下面这行示例不删；跑过后追加真实记录。

| Date | Runtime | Provider | Model | 凭据形态 | 场景 | Result | Evidence |
|------|---------|----------|-------|---------|------|--------|----------|
| _示例_ | native_runtime | Anthropic | claude-sonnet-4.5 | API key | text + one tool + approval denied | ✅ | run id / provider id / marker |
| 2026-07-03 | ai-sdk-7 spike（`scripts/smoke-ai-sdk7-phase2-live.mjs`，direct SDK harness，非 app 进程） | OpenCode Go (Anthropic)（anthropic Messages skin 网关） | glm-5 | DB `api_providers` readonly（x-api-key） | basic chat + thinking enabled(budget 1024) + `output_config.effort`(adaptive) | ✅（基础/thinking/effort 均 200 接受；effort 语义生效未证——reasoningText 0） | `chatcmpl-R8ye45HTW855FCSurjX6RYyJ` / `chatcmpl-RrV46vVDEoddPsIr1RE7kXni` / `chatcmpl-RQkYMwLNjgmT4T1b3fAxd3Eg`；**direct harness 注意**：直连 `@ai-sdk/anthropic` 会 POST `/zen/go/messages` 404，需 base+`/v1`；2026-07-04 真实 UI 路径已证明产品主聊天走 `claude-code-compat` 且可用 |
| 2026-07-03 | ai-sdk-7 spike（同上） | OpenCode Go (Anthropic)（anthropic skin） | glm-5 / deepseek-v4-flash / kimi-k2.5 | 同上 | tools + tool_choice（named/auto/无，含 no-beta / interleaved-only / SDK-equivalent 三种 beta header 变体） | ❌ 网关侧损坏：401 "Error from provider: API key invalid"（同 key 基础调用 200）或 400 "Upstream request failed"，跨模型跨变体一致；**与 wire 形状和 beta header 无关**（no-beta 也失败→发现 2 的 beta 假设在此网关排除，官方/其他代理仍未测） | request_id `chatcmpl-51047c43f0bf4e1f8f97f295cb151143`（401 样本） |
| 2026-07-03 | ai-sdk-7 spike（`@ai-sdk/openai-compatible` 候选 adapter） | OpenCode Go (OpenAI)（chat/completions skin） | glm-5 | DB readonly（Bearer） | basic + `reasoning_effort:low` + named tool_choice | ✅ 全过；tool_choice 实测生效（finishReason=tool-calls，调了 read_file）；附注：SDK deprecation——providerOptions key `'openai-compatible'` 应改 `'openaiCompatible'` | `chatcmpl-REhRr4LuVDojhWqzdRkjqGHf` / `chatcmpl-RvZTkjibiAZ1kZ3DuKmaBXQz` / `chatcmpl-RfqXyAapW4JXBHn2KFM5hLka` |
| 2026-07-03 | ai-sdk-7 spike（direct SDK `.chat()` 非流式路径） | ClinePass（api.cline.bot/api/v1） | anthropic/claude-haiku-4.5 等 4 个候选 | DB readonly（Bearer） | basic chat | ❌ 请求被接受但响应为非标准 `{"data":{…}}` 信封 → direct SDK "Invalid JSON response"（HTTP 200 已计费）；grok-code-fast-1 500×4（1+3 次指数退避重试）；`/v1` 变体 404 排除 base 配错。2026-07-04 真实 `/api/chat` streaming path 已证明 ClinePass GLM-5.2 主聊天可用，#48 限定为非流式/辅助路径债 | raw 证据 id `gen_01KWKEJ2MJT2FZ12MS1GCYT5TR`（envelope=wrapped-in-data） |
| 2026-07-03 | ai-sdk-7 spike（app `.chat()` 网关路径，矩阵 OpenRouter 列对齐） | OpenRouter（chat skin `https://openrouter.ai/api/v1`） | anthropic/claude-haiku-4.5 | DB readonly（Bearer） | basic + `reasoning_effort:low` + named tool_choice | ✅ 全过；reasoning_effort **实测语义生效**（usage.reasoningTokens=117，OpenRouter 翻成 thinking）；tool_choice finishReason=tool-calls | `gen-1783064164-ERI36clMYujIPlcmJQK3` / `gen-1783064166-h8Er6iJSZVOyCc4Fwxq1` / `gen-1783064168-MM0wSuRPi9FUwJKptuGi` |
| 2026-07-03 | ai-sdk-7 spike（raw Messages，as-configured 信息位） | OpenRouter（anthropic Messages skin `https://openrouter.ai/api`——DB 行现配 skin，app 走 claude-code-compat） | anthropic/claude-haiku-4.5 | DB readonly（x-api-key） | basic chat（手写 3 次指数退避重试策略） | ✅ 200（stop_reason end_turn）；本行只证 skin 连通，claude-code-compat adapter 本身未在本轮跑 | `gen-1783064170-ok8aYRImJQX4PJcWNWy6` |
| 2026-07-04 | **Final provider live smoke**（`scripts/smoke-ai-sdk7-phase2-live.mjs`，合并后复跑；真实 DB 只读、输出 scrub） | OpenCode Go (OpenAI) | glm-5 | DB readonly（Bearer） | basic + `reasoning_effort:low` + named tool_choice | ✅ 3/3：chat/completions 200；tool_choice finishReason=tool-calls 且调 `read_file`；仍出现 AI SDK deprecation（providerOptions key 应从 `openai-compatible` 迁到 `openaiCompatible`） | `completed/_smoke-evidence/ai-sdk7-final-phase2-live-smoke-2026-07-04.json` |
| 2026-07-04 | **Final direct SDK smoke**（direct `@ai-sdk/anthropic` + raw probe；合并后复跑） | OpenCode Go (Anthropic) | glm-5 | DB readonly（x-api-key） | direct SDK basic；fallback/raw `/v1/messages` basic + thinking/effort；named tool_choice | ⚠️ direct SDK harness 不是产品路径：direct `@ai-sdk/anthropic` 会 POST `/zen/go/messages` → 404；fallback/raw `/zen/go/v1/messages` 200；thinking/effort 200；named tool_choice 仍上游 401。真实 UI 路径见下一行，主聊天可用 | `completed/_smoke-evidence/ai-sdk7-final-phase2-live-smoke-2026-07-04.json` + `completed/_smoke-evidence/ai-sdk7-final-raw-gateway-probe-2026-07-04.json` |
| 2026-07-04 | **Final UI API smoke**（真实 `/api/chat` 后端路径；用户主分支 3000 环境） | OpenCode Go (Anthropic) | minimax-m3 | 临时 `source=task` session，DB provider 行（x-api-key），`runtime_pin=codepilot_runtime` | exact-marker chat：`CODEPILOT_OPENCODE_ANTH_SMOKE_OK` | ✅ HTTP 200；SSE `status,rewind_point,text*,status,result,done`；marker 命中；临时 session/message 清理为 0。产品路径经 resolver 走 `claude-code-compat`，会补 `/v1/messages`，不复现 direct SDK harness 的 404 | `completed/_smoke-evidence/ai-sdk7-final-ui-api-provider-smoke-2026-07-04.json` |
| 2026-07-04 | **Final direct SDK smoke**（direct `.chat()` + raw probe） | ClinePass（api.cline.bot/api/v1） | anthropic/claude-haiku-4.5 / openai/gpt-5-mini / minimax-m2.5 / x-ai/grok-code-fast-1 | DB readonly（Bearer） | direct `generateText()` basic chat | ⚠️ raw chat/completions 200、`data` 信封、`content=ok`、有 usage；direct 非流式 `.chat()` 对 3 个候选仍 `Invalid JSON response`，grok 候选 500×4。结论仅覆盖 direct 非流式/辅助路径，不代表主聊天不可用 | `completed/_smoke-evidence/ai-sdk7-final-phase2-live-smoke-2026-07-04.json` + `completed/_smoke-evidence/ai-sdk7-final-raw-gateway-probe-2026-07-04.json` |
| 2026-07-04 | **Final UI API smoke**（真实 `/api/chat` 后端路径；用户主分支 3000 环境） | ClinePass（api.cline.bot/api/v1） | cline-pass/glm-5.2 | 临时 `source=task` session，DB provider 行（Bearer），`runtime_pin=codepilot_runtime` | exact-marker chat：`CODEPILOT_CLINE_SMOKE_OK` | ✅ HTTP 200；SSE `status,rewind_point,text*,status,result,done`；marker 命中；临时 session/message 清理为 0。主聊天 streaming path 可用；剩余债务是 direct 非流式 `data` 信封兼容 | `completed/_smoke-evidence/ai-sdk7-final-ui-api-provider-smoke-2026-07-04.json` |
| 2026-07-04 | **Impact browser UI smoke**（真实浏览器填输入框并点击发送；当前主分支 3000 环境） | ClinePass | cline-pass/glm-5.2 | 临时 user session，DB provider 行（Bearer），`runtime_pin=codepilot_runtime` | 主聊天 exact-marker：`CODEPILOT_BROWSER_CLINE_OK` | ✅ assistant DB 消息命中 marker；usage/context accounting 落库；临时数据清理为 0 | `completed/_smoke-evidence/ai-sdk7-impact-browser-and-simulation-smoke-2026-07-04.json` |
| 2026-07-04 | **Impact browser UI smoke**（真实浏览器填输入框并点击发送） | OpenCode Go (Anthropic) | minimax-m3 | 临时 user session，DB provider 行（x-api-key），`runtime_pin=codepilot_runtime` | 主聊天 exact-marker：`CODEPILOT_BROWSER_OPENCODE_ANTH_OK` | ✅ assistant DB 消息命中 marker；产品路径继续经 `claude-code-compat`；临时数据清理为 0 | `completed/_smoke-evidence/ai-sdk7-impact-browser-and-simulation-smoke-2026-07-04.json` |
| 2026-07-04 | **Impact browser UI smoke**（真实浏览器工具权限卡） | OpenCode Go (OpenAI) | glm-5.2 | 临时 user session，DB provider 行（Bearer），`runtime_pin=codepilot_runtime` | Bash tool call → permission card → Deny → follow-up marker | ✅ Bash permission card 出现；浏览器点击 Deny；assistant 落 `Permission denied by user` tool_result；同会话续发 `CODEPILOT_BROWSER_AFTER_DENY_OK` 成功 | `completed/_smoke-evidence/ai-sdk7-impact-browser-and-simulation-smoke-2026-07-04.json` |
| 2026-07-04 | **Impact browser UI smoke**（长流 Stop / interrupt） | OpenCode Go (OpenAI) | glm-5.2 | 临时 user session，DB provider 行（Bearer），`runtime_pin=codepilot_runtime` | 长文本 streaming → 点击生成中控件 → `/api/chat/interrupt` fallback → 尝试续发 | ❌ 生成中控件仍暴露 `aria-label="发送消息"`；点击后未停止且重复写 user prompt；interrupt 返回 true 但 session 仍 `streaming` 且 lock 残留。转 tech-debt #52 | `completed/_smoke-evidence/ai-sdk7-impact-browser-and-simulation-smoke-2026-07-04.json` |
| 2026-07-04 | **Impact simulated route smoke**（产品辅助 route，不是主聊天） | ClinePass / OpenCode Go (Anthropic) / OpenCode Go (OpenAI) | cline-pass/glm-5.2 / minimax-m3 / glm-5.2 | 临时 sessions，真实 DB provider 行 | `/api/media/jobs/plan`：text-generator streaming + plan JSON 抽取 | ⚠️ OpenCode Go OpenAI ✅ `planning_start,text*,plan_complete,done`；ClinePass 与 OpenCode Go Anthropic ❌ `planning_start,error,done`，错误 `Failed to extract plan JSON from LLM response`。转 tech-debt #53 | `completed/_smoke-evidence/ai-sdk7-impact-browser-and-simulation-smoke-2026-07-04.json` |
| 2026-07-03 | **Phase 3 ToolLoopAgent POC 路径**（`scripts/smoke-ai-sdk7-phase3-poc.ts`——真实 app 路径：createModel→assembleTools 权限包装→ToolLoopAgent→SSE；app 数据目录隔离到临时 DB，真实 codepilot.db 只读取凭据） | OpenRouter（chat skin `https://openrouter.ai/api/v1`，openai-compatible protocol） | anthropic/claude-haiku-4.5 | DB readonly（Bearer；输出全 scrub，报告零凭据形态） | ①text-only ②Read tool call（真执行）③Bash approval denied（permission_request→程序化 deny） | ✅ 3/3 一次通过：①`POC OK`（usage 真实回报 in=9785/out=6）②finishReasons `tool-calls`→`stop`、marker 命中 ③`Permission denied by user` 进 tool_result、模型如实汇报被拒、流以 done 收尾 | `_smoke-evidence/ai-sdk7-phase3-poc-smoke.json`（含逐场景事件序列）+ run issue #7 |
| 2026-07-04 | **Phase 5 决策门对照**（`scripts/smoke-ai-sdk7-phase5-decision.ts`——prod `runAgentLoop` 与 POC `runToolLoopAgentPoc` 用同一 `AgentLoopOptions` 逐场景对照；app 数据目录隔离临时 DB，真实 codepilot.db 只读取凭据，证据文件零凭据形态 grep=0） | OpenRouter（chat skin `https://openrouter.ai/api/v1`，openai-compatible protocol） | anthropic/claude-haiku-4.5 | DB `api_providers` readonly（Bearer；输出全 scrub） | ①长文本（≥500 词，流式/收尾/usage 契约）②Bash approval **批准**分支（printf 探针→ask→allow→真执行）③Bash approval **拒绝**分支 ④abort 中断→同 session 续发 | ✅ 4/4 场景 prod/poc 双双一次通过且 contractMatch=true：归一化事件序列逐场景相同、input_tokens 逐场景完全相同（9821/19699/19685/9826）、tool_result 逐字相同（marker / deny 文案）、中断轮双侧 done 收尾无 error、续发 `RESUMED OK` 双侧命中；output tokens 差异为 sampling 如实记录 | `_smoke-evidence/ai-sdk7-phase5-decision-smoke.json`（含逐场景 facts + comparison notes）+ run issue #10 |
| 2026-07-04 | **Final Phase 5 decision smoke**（`scripts/smoke-ai-sdk7-phase5-decision.ts`，合并后复跑） | OpenRouter（chat skin `https://openrouter.ai/api/v1`，openai-compatible protocol） | anthropic/claude-haiku-4.5 | DB readonly（Bearer；临时 app DB；输出 scrub） | 长文本 / approval allow / approval deny / abort→continue | ✅ 4/4 场景 prod/poc 双双一次通过且 contractMatch=true；input_tokens 逐场景一致（9821/19699/19685/9826）；续发 `RESUMED OK` 双侧命中 | `completed/_smoke-evidence/ai-sdk7-final-phase5-decision-smoke-2026-07-04.json` |

## Loop Ledger（自动化循环记录）

> Private `codepilot-agent-runs` issue 是每次自动化 cycle 的操作主账；这里仅记录影响 AI SDK 7 阶段结论的 run summary mirror。没有 private issue/comment 链接的 Loop 不得用于推动 Phase 状态。

| Date | Loop | Input Signal | Auto Cycles | Stop Reason | Result | Evidence |
|------|------|--------------|-------------|-------------|--------|----------|
| _示例_ | ai-sdk-7-dependency-spike | `npm run test` type errors | 2/3 | tests green | ✅ | branch / run id / command output marker |
| 2026-07-01 | hands-off-pilot-model | 用户要求 AI SDK 7 worktree 同时验证 Claude/Codex 自动协作流程 | 0/3 | operating model written | ✅ | `https://github.com/op7418/codepilot-agent-runs/issues/1#issuecomment-4852091552` |
| 2026-07-02 | phase1-ai-sdk-7-dependency-spike | Claude side launchd hands-off run on issue #1 | 1/3 | Codex accepted Phase 1 go/no-go | ✅ | `https://github.com/op7418/codepilot-agent-runs/issues/1#issuecomment-4862072251` |
| 2026-07-03 | phase2-provider-request-shape | hands-off run issue #6：required checks 驱动的 fixture 取证 | 1/3 | fixture 矩阵完成，live smoke 触发 human gate（无真实凭据） | ✅（部分） | `https://github.com/op7418/codepilot-agent-runs/issues/6` + 本 worktree commit |
| 2026-07-03 | phase2-live-smoke | run issue #6 后续 assignment：用户批准用本机已配置渠道跑 live smoke | 1/3 | 4 渠道 live smoke 完成（18 主场景 + 7 隔离 probe），参数接受度回填矩阵；2 条网关 finding 转 tech-debt #47/#48 | ✅ | `https://github.com/op7418/codepilot-agent-runs/issues/6` + `scripts/smoke-ai-sdk7-phase2-live.mjs` + 本 worktree commit |
| 2026-07-03 | phase3-toolloop-poc | run issue #7 首轮 assignment：ToolLoopAgent side-by-side POC + 三类 parity 测试 + gap list | 1/3（2 处 parity fail→adapter 补偿→全绿，属机械信号自动迭代） | POC 三件套完成，parity 8/8 + live 3/3，结论 partial adopt 交 Codex 复审 | ✅ | run issue #7 + commit `df080e0` + [gap list](../../research/ai-sdk-7-toolloop-parity-gaps.md) |
| 2026-07-04 | phase5-decision-gate | run issue #10 首轮 assignment：P1 gap 收口 + 三类真实场景对照 + 采用决策文档 | 1/3（smoke 脚本层 2 处问题——echo 命中自动放行规则、marker 校验用 120 字符样本——1 个 fix cycle 收敛，属机械信号自动迭代） | 三件套完成：gap 全处置 + 对照 4/4 contractMatch + 决策 partial，交 Codex 复审；采用决策本身留人类闸门 | ✅ | run issue #10 + [决策文档](../../research/ai-sdk-7-adoption-decision.md) + `_smoke-evidence/ai-sdk7-phase5-decision-smoke.json` |
