# AI SDK 7 Provider Request-Shape 能力矩阵（Phase 2 取证）

> 创建时间：2026-07-03
> 所属计划：[AI SDK 7 Runtime 接入 + 自动化 Loop 实践](../exec-plans/active/ai-sdk-7-runtime-loop-adoption.md) Phase 2
> 取证方式：targeted test + sanitized fixture（非推断、非文档转述）
> 测试：`src/__tests__/unit/provider-request-shape.test.ts`（29 用例）
> Fixture：`src/__tests__/fixtures/provider-request-shape/*.json`（28 个）

## 取证方法与边界

- 向 `src/lib/ai-provider.ts` 使用的同一批 provider factory（相同 beta header、相同 `.chat()` / `.responses()` wire 选择）注入 mock `fetch`，用 `generateText` / `streamText` 携带 `src/lib/agent-loop.ts` 实际组装的 `providerOptions` 发起调用，捕获**真实出网 HTTP 请求**（URL / header / JSON body）。
- Fixture 已脱敏：凭据类 header（`authorization` / `x-api-key` / `api-key` / `chatgpt-account-id`）只保留名字、值记为 `[REDACTED]`；body 中超过 200 字符的字符串会被替换为长度标记；所有 prompt / 附件均为合成探针（1×1 PNG、14 字节空 PDF）。测试内含 fixture 卫生用例，CI 强制校验。
- 重新生成：SDK 升级后跑 `UPDATE_REQUEST_SHAPE_FIXTURES=1 npx tsx --test src/__tests__/unit/provider-request-shape.test.ts`，diff fixture 后重审本文档。
- **本矩阵只证明"我们把什么放上了 wire"。上游 / 网关是否接受这些字段需要真实凭据 smoke，属于 human gate，本轮不下结论（见文末"未决项"）。**

版本快照：`ai@7.0.11` / `@ai-sdk/anthropic@4.0.5` / `@ai-sdk/openai@4.0.5` / `@ai-sdk/openai-compatible@3.0.3`（每个 fixture 的 `meta` 都内嵌版本，升级即 drift 报警）。

## 矩阵总览

| 维度 | Anthropic Messages（官方） | OpenAI Responses（Codex OAuth 路径） | OpenAI Chat Completions（openai-compatible 网关 / OpenRouter 类，**现行 app 路径**） | @ai-sdk/openai-compatible（候选 adapter，非 app 路径） |
|------|--------------------------|-----------------------------------|--------------------------------------------------|--------------------------------------------------|
| reasoning | ✅ `body.thinking` `{type:'enabled', budget_tokens}` / `{type:'adaptive'}` | ✅ `body.reasoning.effort`（SDK 自动追加 `reasoning.summary:'detailed'` + `include:['reasoning.encrypted_content']`） | ✅ `body.reasoning_effort`（顶层，OpenAI 官方形态） | ✅ `body.reasoning_effort` |
| effort | ✅ `body.output_config.effort`，**无任何 effort beta header**（详见发现 1） | ✅ 同上（reasoning.effort 即 effort） | ✅ 同上 | ✅ 同上 |
| tool choice | ✅ `tool_choice` `{type:'auto'}` / `{type:'any'}` / `{type:'tool', name}`；带 tools 时 SDK 自动追加 `structured-outputs-2025-11-13` beta（发现 2） | ✅ `'auto'` / `'required'` / `{type:'function', name}`；tools 为扁平 `{type:'function', name, …}` | ✅ `'auto'` / `'required'` / `{type:'function', function:{name}}`；tools 为嵌套 `{type:'function', function:{…}}` | ✅ 同 Chat Completions |
| file input（image） | ✅ content block `{type:'image', source:{type:'base64', media_type, data}}` | ✅ `{type:'input_image', image_url:'data:image/png;base64,…'}` | ⚠️ **`image_url.url` 为裸 base64，缺 `data:` 前缀**（发现 3，疑似 upstream bug） | ✅ `image_url.url` 为规范 data URL |
| file input（PDF） | ✅ `{type:'document', source:{type:'base64', media_type:'application/pdf'}}`，SDK 自动追加 `pdfs-2024-09-25` beta | ✅ `{type:'input_file', filename, file_data:'data:application/pdf;base64,…'}` | ✅（形状上）`{type:'file', file:{filename, file_data:data URL}}`；网关接受度未知 | ✅ 同左 |
| stream 差异 | ✅ `streamText` 与 `generateText` body 完全一致，仅多 `stream:true`（fixture `anthropic-stream-parity` 用 deepEqual 证明） | 未单测（同一 SDK 映射层） | 未单测 | 未单测 |

每格证据 fixture：`anthropic-reasoning-thinking-enabled` / `anthropic-reasoning-thinking-adaptive` / `anthropic-effort-high` / `anthropic-context-1m-beta` / `anthropic-tool-choice-{auto,required,named,none-no-tools}` / `anthropic-file-{image,pdf}` / `anthropic-stream-parity`；`openai-responses-{reasoning-effort,tool-choice-auto,tool-choice-required,tool-choice-named,file-image,file-pdf}`；`openai-chat-{reasoning-effort,tool-choice-auto,tool-choice-required,tool-choice-named,file-image,file-pdf}`；`compat-{reasoning-effort,tool-choice-auto,tool-choice-named,file-image,file-pdf}`。

## 关键发现（按影响排序）

### 发现 1（P1，利好）：`@ai-sdk/anthropic@4.0.5` 的 effort 走 `output_config.effort`，不再附加任何 effort beta header

fixture `anthropic-effort-high` 显示：`providerOptions.anthropic.effort='high'` → `body.output_config.effort='high'`，出网 header 仅 `anthropic-beta: interleaved-thinking-2025-05-14`（我们自己配置的），**没有** `effort-2025-11-24`。

影响：`src/lib/agent-loop.ts`（~L367-391）目前为 Opus 4.7+ / Fable 5 在 native 路径**丢弃显式 effort** 并弹 `RUNTIME_EFFORT_IGNORED`，理由是"installed @ai-sdk/anthropic 仍附带 deprecated effort-2025-11-24 beta"。该前提在 4.0.5 上已不成立。升级采用后可考虑撤掉这个 gate、恢复 native effort 直通——但 `output_config.effort` 是否被官方 API 按预期接受，需一条真实凭据 smoke 确认（human gate），不在本轮下结论。

### 发现 2（P1，风险）：带 tools 的 Anthropic 请求会被 SDK 自动追加 `structured-outputs-2025-11-13` beta；带 PDF 会自动追加 `pdfs-2024-09-25`

fixture `anthropic-tool-choice-{auto,required,named}` 的 header 均为 `structured-outputs-2025-11-13,interleaved-thinking-2025-05-14`。这些自动 beta 会原样发给**第三方 Anthropic 代理**（GLM 类 base_url 网关）。代理对未知 beta header 的行为（忽略 / 400）未知 → 第三方代理路径的 tools / PDF 能力必须 capability-gated，直到有真实代理 smoke。

### 发现 3（P1，采用阻断项）：现行网关路径（`@ai-sdk/openai@4.0.5` `.chat()`）把 image 发成裸 base64

fixture `openai-chat-file-image`：`message-builder.ts` 产出的 `{type:'file', data:<base64>, mediaType:'image/png'}` 部件在 chat completions wire 上变成

```json
{ "type": "image_url", "image_url": { "url": "iVBORw0KGgo…" } }
```

缺 `data:image/png;base64,` 前缀。已在包源码确认（`node_modules/@ai-sdk/openai/dist/index.js` ~L307：`url: … : convertToBase64(part.data.data)`）；同版本的 Responses 路径和 `@ai-sdk/openai-compatible@3.0.3` 都正确生成 data URL。标准 OpenAI-compatible 网关大概率拒绝或错读裸 base64 URL。

未决基线：main 上的 `@ai-sdk/openai@3.0.34`（ai@6 基线）同一输入的行为本轮无法取证（沙箱不可读主目录 node_modules / 不可 npm pack），**无法断言这是"升级引入的回归"还是既有行为**。升级采用（Phase 3+）前必须：查 upstream issue / 比对 v3 映射 / 或跑一条真实网关 image smoke。在此之前，AI SDK 7 branch 上"网关 + 图片附件"应视为 broken。

### 发现 4（P2）：Codex Responses 路径 system prompt 双发

fixture `openai-responses-reasoning-effort`：`agent-loop.ts` 同时传 `system: effectiveSystemPrompt`（→ `input[0]` `role:'developer'`）和 `providerOptions.openai.instructions`（→ `body.instructions`），同一段 system prompt 在 wire 上出现两次。是否造成 token 双计费 / 语义冲突取决于 Codex backend 的优先级规则，需真实 smoke 确认；修复取舍（去掉哪一个）留给 review。

### 发现 5（信息）：named tool choice 三种 wire 形态互不相同

Anthropic `{type:'tool', name}`；Responses `{type:'function', name}`（扁平）；Chat Completions `{type:'function', function:{name}}`（嵌套）。SDK 已正确按 wire 翻译，`streamText` 层的 `toolChoice` 语义跨 provider 一致——未来 capability UI 不需要按 provider 区分 tool choice 语义。

## 能力开放建议（默认开放 vs capability-gated）

| 能力 | 建议 | 依据 |
|------|------|------|
| Anthropic 官方：thinking / tool choice / image / PDF | 可默认开放 | wire 形态与官方文档一致，fixture 齐 |
| Anthropic 官方：effort | 待 1 条真实 smoke 后开放 | `output_config.effort` 新形态，接受度未实测（发现 1） |
| Anthropic 第三方代理：tools / PDF / effort | capability-gated | SDK 自动 beta header 对代理行为未知（发现 2）；agent-loop 现行的代理降级逻辑保留 |
| Codex Responses：reasoning / tool choice | 可默认开放 | 与现行生产 providerOptions 完全一致，仅确认了映射 |
| Codex Responses：file input | capability-gated | 形状正确但 Codex backend 接受度未测；另有发现 4 待收口 |
| 网关（现行 .chat 路径）：tool choice / reasoning_effort | 可默认开放（形状标准） | 标准 OpenAI 形态 |
| 网关：image | **视为 broken，gate 到发现 3 收口** | 裸 base64 URL |
| 网关：PDF | capability-gated | 网关普遍不实现 file part |
| `@ai-sdk/openai-compatible` 替换 `.chat()` | Phase 3 决策项 | image 映射正确是替换的直接论据；但需评估 metadata/usage 等其余差异 |

## 未决项（human gate，不猜）

1. **真实凭据 smoke**（计划 Phase 2 验收项）：Anthropic 官方 ×1（重点 `output_config.effort` + adaptive thinking）、OpenAI ×1、主流网关（OpenRouter 类）×1（重点 image data URL / reasoning_effort 透传）。需要用户提供 key，结果回填计划 Smoke Ledger。
2. 发现 3 的基线比对（main ai@6 是否同样裸 base64）与 upstream issue 检索。
3. 发现 4 的产品取舍：Responses 路径去掉 `system` 还是 `instructions`。

以上三项完成前，本矩阵中"接受度"类结论一律按 unsupported / gated 处理，不得写入用户可见 UI。
