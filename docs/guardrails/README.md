# Guardrails 目录

模块级开发契约。每份文档锁住一个跨多个文件的不变量集合，目的是让未来改这块代码的人（AI 或人类）能在动手前快速校准"这里有哪些不能碰的边"。

## 文件清单

- [`Runtime.md`](./Runtime.md) — Provider / Model / Composer 的 runtime 过滤契约。改 `chat-runtime.ts` / `runtime-compat.ts` / `useProviderModels.ts` / `ChatView` 任意一个前必读
- [`ProviderManagement.md`](./ProviderManagement.md) — Settings > Providers 信息架构、preset 匹配、provider_models 表关系、删除安全。改 `ProviderManager.tsx` / `ProviderCard.tsx` / `provider-presets.tsx` / `provider-catalog.ts` / `/api/providers/*` 前必读
- [`ModelDiscovery.md`](./ModelDiscovery.md) — discover-models 三步流（probe / confirm / apply）+ user_edited 守护 + classification 分类。改 `model-discovery.ts` / `applyDiscoveryDiff` / refresh dialog 前必读
- [`ComposerModelSelection.md`](./ComposerModelSelection.md) — useProviderModels resolved pair 契约 + ChatView 三道 send gate + new chat page 自治路径。改 `useProviderModels.ts` / `MessageInput.tsx` / `ChatView.tsx` / `chat/page.tsx` / `useAssistantTrigger.ts` 前必读

## 写作规范

每份护栏文档至少包含：
1. **词汇表** — 这块代码用的所有专有名词 + 来源
2. **不变量 / 契约表** — 行为规则，越严格越好
3. **关键文件 + 责任** — 哪个不变量由哪个文件守
4. **改动检查表** — 加新功能时必须想到的点
5. **常见坑** — 被踩过的 / Codex review 指出过的反模式
6. **测试覆盖** — 每条契约对应哪个 test，回归时跑哪个文件
7. **设计决策日志** — 关键变更的日期 + 理由（为后人解释"为什么不那样做"）

## 跟其他 docs 的关系

- `design.md`：UI 视觉规范（颜色 / 圆角 / 间距）。本目录管行为契约
- `handover/`：模块完整架构（数据流 / schema / 入口路由）。本目录是其中"不变量"那一节的扩写
- `exec-plans/`：进行中的工作。本目录是已稳定的契约
