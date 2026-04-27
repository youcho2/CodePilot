# Provider 模型发现 — 调研 + 落地

> **范围**：状态管理 + 模型发现这条主线，不涉及订阅额度 / 计费。
> **目标**：Provider 详情页「刷新模型」按钮 + Settings > Models 独立管理页。
> **当前写入策略（Phase B 起）**：probe 仍 read-only，apply 层在 `manual_enabled` / `manual_hidden` 守卫下做**保守自动应用**。**Add Service 成功后自动发现 + 单服务商刷新 + 刷新全部**都默认走自动 apply；只有**按推荐整理**和高级 diff 对话框走预览-then-apply。
>
> 关键不变量：`applyDiscoveryDiff` 永远不会翻动 `enable_source IN ('manual_enabled','manual_hidden')` 或 `user_edited=1` 的行——只 `upstream_model_id` 和 `last_refreshed_at` 会推进。这一层数据保护是"静默 apply 也安全"的根基。

## 演进历史

这份文档经历了四个语义状态，记录下来避免后续 agent 把当前的自动 apply 误判成回归：

1. **Phase 1 初版（已淘汰）**：纯只读 spike — `POST /discover-models` 返回探测结果，不动 DB
2. **Phase 1 第二版（已淘汰）**：成功时**无差别 upsert** 全部模型到 `provider_models`，dialog 显示「已写入 N 个模型」。问题：再次刷新会回滚用户改名 / 隐藏，违反用户预期。
3. **Phase A：preview-only**：refresh 路由返回 **diff**，用户在 dialog 看完点 **Apply** 才单独 POST `/discover-models/apply`。"任何写入都要预览"作为强护栏存在。问题：日常刷新 + 新增服务商场景下，dialog 步骤过重，把"看一眼模型列表更新了没"变成了 5 次点击。
4. **Phase B 当前版（自动 apply + manual_* 守卫）**：probe 仍只读；apply 加了 5 态 `enable_source` 列（`recommended` / `manual_enabled` / `manual_hidden` / `discovered` / `catalog`）。`applyDiscoveryDiff` 在写入时**强制忽略** `manual_enabled` / `manual_hidden` 行的 `enabled` / `enable_source` 翻动；仅 system-managed (`recommended` / `discovered` / `catalog`) 行允许按当次 catalog 重新评估。

为什么从 Phase A 回到自动 apply 是安全的：差别在于"是否信任数据层守卫"。Phase A 把保护放在 UI 步骤里（必须看预览才能 apply），但用户其实并不在乎大多数刷新的内容（一个新模型多一个旧模型少一个）。Phase B 把保护下沉到 `applyDiscoveryDiff` 自身——只要存在 manual_* 标记就跳过翻动，即使前端"忘了" preview 用户选择也不会被回滚。这让保守自动应用既安全又轻量。

**仍需要 preview 的场景**（保留 dialog）：
- **按推荐整理（`alignEnabledWithCatalog`）**：会主动启用 / 隐藏 / 删除多行，影响范围大，必须显示 dryRun 计数后再写入。
- **高级 diff 对话框（`ProviderManager.handleDiscoverModels`）**：保留为 orphan 复盘 / 强制重置入口，普通用户用不到。

## 代码出口

| 模块 | 路径 |
|---|---|
| 探针 + 分类（read-only） | `src/lib/model-discovery.ts` |
| 刷新（返回 diff，不写库） | `POST /api/providers/[id]/discover-models` |
| 静态分类（不联网） | `GET /api/providers/[id]/discover-models` |
| 应用 diff（写库，manual_* 受保护） | `POST /api/providers/[id]/discover-models/apply` |
| Diff 应用核心（含 5 态 enable_source 守卫） | `applyDiscoveryDiff()` in `src/lib/db.ts` |
| Recommendation 判定（catalog + Claude alias） | `isRecommendedModel()` in `src/lib/catalog-recommend.ts` |
| 自动 apply 共享 helper | `src/lib/auto-discover-models.ts` (`runAutoDiscoverForProvider` + `probeAndApplyProvider`) |
| Add Service 成功 → 自动发现 | `ProviderManager.handlePresetAdd` |
| Models 页单服务商刷新 | `ModelsSection` section header `刷新` 按钮 |
| Models 页批量刷新 | `ModelsSection` 顶部 `刷新全部 (N)` 按钮 |
| 高级 diff 对话框（preview-first，保留为 orphan 复盘） | `ProviderManager.handleDiscoverModels` |
| 按推荐整理（preview-first，主动重置） | `ModelsSection` `按推荐整理` → `alignEnabledWithCatalog()` |

## 安全约束

- 服务端读取 `provider.api_key`，**不接受**请求体里的 key、**不在响应里回显** key
- 所有 fetch 用 `AbortSignal.timeout`（默认 8 s）
- Gemini probe 在响应里把 `?key=***` 用占位符代替，避免日志泄漏
- 任何不确定的 endpoint 一律标 `experimental` 而非 `api`，不强行宣称能力

## 写入语义（apply）

`applyDiscoveryDiff(providerId, upstreamModels, isRecommended)` 在 `provider_models` 上执行。`isRecommended` 是 caller 注入的 `(modelId) => boolean` 谓词（由 `isRecommendedModel` 基于 catalog + provider compat 计算），用来判定新行 / 待重新评估行的目标 enabled 状态。

| DB 当前状态 | 上游本次返回 | 行为 |
|---|---|---|
| 不存在 | 出现 | INSERT，`source='api'`、`user_edited=0`、`enabled=isRecommended()`、`enable_source='recommended'` 或 `'discovered'`、display_name = model_id |
| 存在 + system-managed (`enable_source IN ('recommended','discovered','catalog')` 且 `user_edited=0`) | 出现 | 走 `updatePristineStmt`：按当次 `isRecommended` 重新评估 enabled + enable_source；同步 upstream_model_id / source='api' / last_refreshed_at / display_name = upstream id |
| 存在 + user-managed (`enable_source IN ('manual_enabled','manual_hidden')` 或 `user_edited=1`) | 出现 | 走 `updatePreservedStmt`：仅 UPDATE `upstream_model_id` + `last_refreshed_at` + source；**`enabled` / `enable_source` / `display_name` / `capabilities` / `sort_order` 全部不动** |
| 存在 | 不出现（orphan） | 不动；UI 在 Models 页提示用户决定是否删除 |

返回 stats：`{ inserted, refreshedPristine, refreshedPreserved, recommendedEnabled, discoveredHidden }`。`recommendedEnabled` / `discoveredHidden` 目前只在 INSERT 路径递增（pristine flip 不计入；见 `tech-debt-tracker.md` 行 11）。

**两路用户标记机制**（任意一个就能保护行）：
- `user_edited=1`：任何 PATCH 行编辑（重命名 / 改 capabilities）触发，legacy 信号
- `enable_source IN ('manual_enabled','manual_hidden')`：用户在 Models 页切 enabled 开关时由 `updateProviderModelUserFields` 自动写入，Phase B 标准信号

`updateProviderModelUserFields` 触发后既写 `user_edited=1` 也根据本次 toggle 写 `enable_source`，所以 Phase A 之前的 legacy 行（`user_edited=1` 但 `enable_source='recommended'`）和 Phase B 之后的新行（双重打标）都受保护。

## 三类划分（静态）

按 catalog `protocol` + 预设 `key` 分类，不依赖网络可达性。

### 类别 A — 可 API 获取（probe = `api`）

| 预设 key | 协议 | 探测端点 |
|---|---|---|
| `openrouter` | openrouter | `${baseUrl}/v1/models` |
| `ollama` | anthropic（实际跑 ollama）| `${baseUrl}/api/tags`（无需鉴权）|
| `litellm` | anthropic（实际跑 OpenAI-compat）| `${baseUrl}/v1/models` |
| `gemini-image` | gemini-image | `https://generativelanguage.googleapis.com/v1beta/models?key=…` |
| `openai-image` | openai-image | `${baseUrl}/v1/models` |
| 任何 `protocol: 'openai-compatible'` 的预设 | openai-compatible | `${baseUrl}/v1/models` |

### 类别 B — 实验性 / 需特殊条件（probe = `experimental`）

| 预设 key | 协议 | 不确定性 |
|---|---|---|
| `anthropic-official` | anthropic | api.anthropic.com /v1/models 分页 + 与 org billing scope 绑定 |
| `anthropic-thirdparty` | anthropic | 多数兼容网关同时暴露 /v1/models，但不保证 |
| `glm-cn` / `glm-global` / `kimi` / `moonshot` / `minimax-*` / `volcengine` / `xiaomi-mimo*` / `bailian` | anthropic（品牌 Code Plan）| anthropic-compat 域名是否同时挂 OpenAI-compat /v1/models 看 vendor 各自实现 |
| `bedrock` / `vertex` | bedrock / vertex | 需要 SigV4 / GCP ADC，不能用普通 fetch |
| `gemini-image-thirdparty` / `openai-image-thirdparty` | (image) | 第三方网关协议不一致 |

### 类别 C — 不可获取，需手动维护（probe = `unsupported`）

| 来源 | 原因 | Fallback |
|---|---|---|
| OpenAI OAuth | 浏览器 web session，不暴露 OAuth 端点的模型列表 | SDK 内置默认 |
| Claude Code env | 环境变量驱动，模型由 SDK 内置定义 | SDK / catalog 内置默认 |
| 没匹配上预设、用户自填 base_url 的 custom 行 | 没有协议线索 | catalog + 手动 `provider_models` 表 |

## 实测（本机 dev DB 已配置的 10 家）

经过 diff → apply 闭环验证：

| Provider | 分类 | 探测结果 | 应用后行为 |
|---|---|---|---|
| Google Gemini (Image) | api | 200 OK，50 个模型 | 全部 INSERT（首次）/ refresh（再次刷新） |
| Volcengine Ark | experimental | 200 OK，116 个模型 | 同上 |
| GLM (CN) | experimental | 200 OK，7 个模型 | 同上 |
| Kimi Coding Plan | experimental | 200 OK，1 个模型 | 同上 |
| PipeLLM | experimental | 200 OK，5 个模型 | 同上 |
| Aiberm | experimental | 200 OK，131 个模型 | 同上 |
| Xiaomi MiMo Token Plan | experimental | 404（同 host 无 /v1/models）| 不写库 |
| MiniMax (Global) | experimental | 404 | 不写库 |
| OpenAI (Image) | api | 401（key 无效） | 不写库 |
| DeepSeek | experimental | 404 | 不写库 |

**结论**：6/10 真能拿到。"anthropic-compat 同 host 同时暴露 /v1/models" 的启发式有效；不暴露的 vendor（Xiaomi / MiniMax / DeepSeek 的 `/anthropic` 子路径）走手动维护。

## API 形状

```ts
// POST /api/providers/[id]/discover-models  →  无写入
{
  providerId, providerName, presetKey,
  classification: 'api' | 'experimental' | 'unsupported',
  protocol: 'openai-compatible' | 'anthropic' | 'gemini' | 'ollama' | …,
  endpoint?, ok?, modelCount?, sampleModels?, error?, notes?, suggestedFallback?, durationMs?,
  diff: Array<{
    modelId: string,
    upstreamModelId: string,
    status: 'new' | 'will-update' | 'preserve-edited' | 'hidden-but-upstream' | 'unchanged' | 'orphan',
    current?: { display_name, enabled, user_edited, source },  // 缺则代表 DB 里没这条
  }>,
}

// POST /api/providers/[id]/discover-models/apply  →  写库
// body: { upstreamModels: [{ modelId, upstreamModelId }, …] }
// 200: { providerId, inserted, refreshedPristine, refreshedPreserved }
```

UI 应当只挑用户实际想动的 `diff` 条目（默认 `new + will-update + preserve-edited + hidden-but-upstream`，跳过 `unchanged` 和 `orphan`）作为 apply body。

## Settings > Models 页面

新增独立页（`Brain` 图标，sidebar 第三项）。不在这里探针上游，单纯展示 `provider_models` + 暴露用户控制：

- **搜索**（model_id + display_name 全局搜）
- **Runtime 过滤**：全部 / Claude Code 可用 / Claude Code 实验 / CodePilot Runtime 可用 / 媒体 / 需验证
- **启用/隐藏** Switch（per row，写入时强制 `user_edited=1`）
- **重命名** display_name（同上）
- **排序**（上下箭头交换 sort_order）
- **手动添加** 模型（source='manual'，user_edited=1）
- **删除** 仅限 `source='manual'` 的行
- **来源徽章**：`api / catalog / manual / role_mapping / sdk_default`
- **Runtime 徽章**：`Claude Code` / `Claude Code 实验` / `CodePilot Runtime` / `媒体` / `需验证`
- **`已编辑` 徽章**：`user_edited=1` 的行
- **last_refreshed_at**：相对时间显示

## Runtime Compatibility 语义

模型发现只回答"上游有没有这些模型",不能单独回答"这些模型能不能用于 Claude Code"。兼容性需要由 catalog / preset / 手动验证共同决定。

### Provider 层

| 状态 | 含义 | 典型来源 |
|---|---|---|
| `claude_code_ready` | 可通过 Claude Code SDK / Anthropic-compatible env 稳定使用 | Anthropic 官方、已验证 Claude Code 兼容服务 |
| `claude_code_experimental` | 理论兼容,但 tool calling / thinking / model alias / timeout 可能不完整 | Anthropic-compatible relay、部分 Coding Plan |
| `codepilot_only` | 可由 CodePilot Runtime 管理,不应进入 Claude Code 路径 | OpenAI-compatible、Gemini、部分 OpenRouter / Relay、本地 Ollama |
| `media_only` | 图片、视频、embedding 等非聊天模型服务 | image/video provider |
| `unknown` | 自定义 base URL 或未验证网关 | manual provider |

### Model 层

| 标记 | 含义 |
|---|---|
| `chat` | 可以作为聊天 / coding model |
| `tool_capable` | 已知可用于工具调用 |
| `thinking_capable` | 已知可用于 thinking / reasoning |
| `claude_code_compatible` | 当前 runtime 为 Claude Code 时可展示 |
| `codepilot_runtime_compatible` | 当前 runtime 为 CodePilot Runtime 时可展示 |
| `media` | 只进入媒体功能,不进入聊天模型选择器 |

### 过滤优先级

1. `enabled=0` 的 hidden 模型优先级最高,必须压过 catalog fallback、role default、env default、SDK default。
2. 当前 runtime 过滤优先级高于来源过滤:Claude Code Runtime 下不展示 `codepilot_only` / `media` / `unknown` 模型。
3. `unknown` 不等于不支持;UI 文案用"需验证",不要写死"不可用"。
4. 连接测试 / 模型刷新只能提升 `verified_at` / `compatibility_source`,不能在没有明确证据时自动把 provider 标为 Claude Code ready。

## Schema 变更

`provider_models` 增加三列（迁移走 `PRAGMA table_info` 检测，已存在的库 `ALTER TABLE` 添加）：

```sql
source TEXT NOT NULL DEFAULT 'manual'
last_refreshed_at TEXT
user_edited INTEGER NOT NULL DEFAULT 0
```

旧数据默认 `source='manual'`、`user_edited=0`，第一次刷新 apply 会被识别为 pristine 然后 refresh 成 `source='api'`。

## 已知边界

- **Sample cap = 500**（`model-discovery.ts:SAMPLE_CAP`）：覆盖目前所有真实 provider 的模型数；超出会截断
- **Bedrock / Vertex 没真探**：分类标 `experimental` 但 `discoverModels` 走默认分支，需要 SDK 才能 `ListFoundationModels` / GCP ADC 列模型
- **Orphan 不自动清理**：上游下线一个模型时只在 diff 里标 `orphan`，由用户决定是否删除
- **首次刷新对旧自动写入数据**：第二版自动写入留下的行 source='manual'，第一次走新 flow 会被误识别为 user_edited=0 + 'will-update'，apply 后变 'unchanged'。**这是一次性现象**，不是 bug
- **Capability 自动识别 V1 不做**：现在 `capabilities_json` 始终 `{}`，UI 不展示也不让编辑；下一阶段补
