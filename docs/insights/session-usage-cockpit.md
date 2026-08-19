# Session Usage Cockpit — 产品思考

> 技术实现见 [docs/handover/session-usage-cockpit.md](../handover/session-usage-cockpit.md)

## 解决什么问题

用户在会话里最关心两件事之一是「我这周的订阅额度还剩多少、会不会突然被限流」。原来要看用量得离开会话去跑 `/usage`（Claude）或翻 Settings（Codex）。把它放到 composer 右下角，随手可查，且与当前正在用的模型/服务商对齐。

## 为什么按会话 Runtime + Provider 门控，而不是都显示

前一版把 Claude 段和 Codex 段**无条件**并列显示。问题：一个 Codex 会话看到空的 Claude 段，或一个第三方 API Key 会话看到 claude.ai 的账户额度——**用户会以为那是本会话的额度**。这正是项目「反假数据」红线：用户看到的数字必须是本会话真实适用的来源。所以：

- Codex 会话只看 Codex；claude.ai 订阅会话只看 Claude；第三方/自带 Key 会话诚实说「本 Runtime 用你自己的 API Key，无订阅额度」。
- `claude_code` runtime 下若挂第三方 provider，也不显示 claude.ai 额度——账户额度 ≠ 本会话来源。

## 为什么 Claude 侧敢做「实时查询」而不是只用流式快照

调研发现两条路：SDK 在流式回复中透出的 `rate_limit_event`（只有回复后才有、且仅 claude.ai 路径），以及 `/usage` 命令背后的内部端点 `/api/oauth/usage`。用户明确要「查询 /usage 里的会话/周/剩余」——即点开即查的实时语义。选了实时端点（方案 A），代价是依赖一个未公开接口。这是一次**知情的取舍**：能力对齐用户预期优先，同时用容错解析 + 诚实降级把「接口变动」风险关进笼子，不让它退化成假数据。

## 踩坑复盘（为什么值得记）

1. **Node 取不到、curl 能取**：同样的 token 和 header，curl 200、Node（undici + https 模块）一律 403 "Request not allowed"。根因是 Anthropic edge 的 TLS 指纹拦截——真 CLI 跑在 Bun 上被放行，我们的 Next Node server 被拦。结论：这类「官方自家客户端能用、你的 runtime 用不了」的接口，先验证**你的实际运行时**能不能打通，别拿 curl 验证过就以为 Node 也行。
2. **minified 源码不能当契约**：从 SDK bundle 逆出的字段里，`utilization` 有 `*100` 和直接当百分比两种用法，靠猜必然做出假数据。最后是**打了一次真实请求**才定死 scale（0–100）和 `resets_at`（ISO 字符串）。反假数据的前提是拿到真样本。
3. **安全细节**：token 经 curl stdin config 传入而非命令行参数，避免出现在进程列表里。

## 已知局限与未来方向

- 依赖系统 `curl` 与未公开端点；两者任一不可用时空态降级，不误导。
- 上游只给百分比、无绝对 token，所以「剩余」是百分比而非额度数值。
- 未做本地缓存/轮询：每次 open 实时拉取，简单且新鲜；若未来要做限流预警条，可在此之上加轻量缓存 + 阈值高亮。
- Claude 的 `weekly_scoped` 已带模型维度（如 Opus/Fable 周额度），未来可与模型选择器联动，选哪个模型高亮对应的周窗口。
