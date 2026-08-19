# Session Usage Cockpit — 会话级订阅用量

> 产品思考见 [docs/insights/session-usage-cockpit.md](../insights/session-usage-cockpit.md)

composer 右下角「用量」popover（`UsageCockpit`），按**当前会话解析出的 Runtime + Provider** 展示订阅账户的会话 / 周用量与剩余额度。目标：把 Claude Code `/usage` 与 Codex 配额搬到会话内，且**只**显示对当前会话真正适用的那个来源（反假数据）。

## 数据来源（每个都是实时读取）

| Runtime | 来源 | 端点 | 窗口 |
| --- | --- | --- | --- |
| `codex_runtime` | Codex app-server | `GET /api/codex/rate-limits`（`account/rateLimits/read`） | primary(5h) / secondary(7d) |
| `claude_code` + provider `env`/`''` | claude.ai 订阅 OAuth | `GET /api/claude-usage` → 内部 `GET https://api.anthropic.com/api/oauth/usage` | session(5h) / weekly_all / weekly_scoped(按模型) |
| 其他（native / 第三方 API Key） | 无订阅额度概念 | — | 诚实空态 |

两个上游都只报 `usedPercent`（0–100），**不报绝对 token**，所以「剩余」一律渲染为 `100 − used`%，绝不写 "N tokens"。

## Claude 侧关键实现（`src/lib/claude-usage.ts`）

`/usage` slash command 读的就是内部端点 `/api/oauth/usage`（从 `@anthropic-ai/claude-agent-sdk/cli.js` 逆出，未公开）。三个坑，均已按**真实响应**（2026-08-19 max 账号实测）落定：

1. **Token 存储**：macOS 在 keychain（`security find-generic-password -s "Claude Code-credentials" -w` → `claudeAiOauth.accessToken`）；Linux/Windows 在 `<CLAUDE_CONFIG_DIR|~/.claude>/.credentials.json`。二者都读，keychain 优先。
2. **必须用 `curl`，不能用 Node**：Anthropic edge 对 Node 的 TLS 指纹返回 `403 forbidden "Request not allowed"`（undici `fetch` 和 `https` 模块都被拦；真 CLI 跑在 Bun 上，TLS 栈被放行）。`curlGetJson()` shell 出系统 curl，token 走 `-K -`（stdin config）传入，**不进 argv/`ps`**。curl 缺失 → `reason:'unavailable'` 诚实降级。
3. **响应形状**：优先解析归一化的 `limits[]`（`{kind:'session'|'weekly_all'|'weekly_scoped', percent:0-100, resets_at:ISO字符串, scope.model.display_name, is_active}`）；无 `limits` 时回退顶层 `five_hour`/`seven_day.utilization`（也是 0–100）。`resets_at` 是 **ISO 字符串**（非 epoch）。

返回判别式：`{snapshot}` | `{snapshot:null, reason:'no-oauth'|'expired'|'unavailable'}`。`no-oauth` = 非 claude.ai 订阅登录（第三方/API Key），是「本来就没有额度」而非 0。

纯函数 `parseClaudeUsage(raw, subscriptionType, now)` 单独可测（`src/__tests__/unit/claude-usage-parse.test.ts`：scale、ISO 透传、scoped 模型名、空/垃圾输入→0 窗口）。

## Provider 门控（`UsageCockpit.usageKindFor`）

```
codex_runtime                                   → 'codex'
claude_code && providerId ∈ {undefined,'','env'} → 'claude'   // 仅 claude.ai 订阅路径
其他                                             → 'none'
```

为什么要额外看 provider：`claude_code` runtime 下会话仍可能用**第三方 provider**（自带 API Key），此时 claude.ai 账户额度与本会话无关，显示它属误导 → 归 `none`。即便门控放过，`readClaudeUsage()` 无 token 时也会返回 `no-oauth` 二次兜底。

## 接线点

- `src/lib/claude-usage.ts` — token 读取 + curl 取数 + `parseClaudeUsage`。
- `src/app/api/claude-usage/route.ts` — `GET`，nodejs / force-dynamic，恒 200 判别式 body。
- `src/components/chat/UsageCockpit.tsx` — runtime/provider 感知的 popover，open 时按 `kind` 拉取。
- `src/components/chat/ChatView.tsx`（两处 composer）、`src/app/chat/page.tsx`（新会话）— `<UsageCockpit runtime={sessionRuntimeParam} providerId={currentProviderId} />`。
- 复用 `src/components/settings/CodexQuotaWidget.tsx` 渲染 Codex 段。

## 运行期依赖 / 已知局限

- **依赖系统 `curl`**：桌面三平台默认自带；缺失时诚实空态，不崩。
- **端点未公开**：Anthropic 若改动 `/api/oauth/usage` 形状或鉴权，Claude 段降级为 `unavailable`；`parseClaudeUsage` 对缺字段容错（0 窗口→空态）。
- **无绝对 token**：只有百分比与重置时间，符合上游能力。
- **keychain 访问**：`security` CLI 读取；若系统弹权限框由用户授权一次。
