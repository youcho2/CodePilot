# Harness Home Program B — Producer-backed Asset Library

> 创建时间：2026-07-30
> 最后更新：2026-07-30
> 状态：📋 待 Program A shared contract；**未授权产品代码实施**
> 父计划：[harness-home-user-owned-core.md](harness-home-user-owned-core.md)
> 依赖：[harness-home-core-adapters.md](harness-home-core-adapters.md) 的 `AssetRef` / scope / provenance / repository boundary

## 目标

把现有 Gallery 演进为用户长期拥有的通用 Asset Library，覆盖真实 producer 产出的图片、视频、音频和完整网页 bundle，并提供 lineage、引用、删除保护和跨 Runtime projection。

本计划不负责 Harness/Runtime adapter，也不负责 CodePilot Design Method 的审美内容。

## 状态

| Phase | 内容 | 状态 | 入口门禁 |
|-------|------|------|----------|
| B0 | Producer / consumer inventory 与 DB migration 设计 | 📋 待开始 | Shared Phase 0 Asset inventory |
| B1 | Asset registry、现有 media backfill、lineage | 📋 待开始 | Program A shared contract frozen |
| B2 | HTML bundle materializer 与 trust/CSP | 📋 待开始 | B1 + 现有 Artifact trust contract |
| B3 | Library/Gallery 渐进演进与 typed references | 📋 待开始 | B1/B2 数据门禁 |

## 用户会看到什么

- 素材库不再只像图片 Gallery；
- 图片、视频、音频和成功物化的网页结果可以在同一项目脉络中归档；
- 用户能看到 parent/derived-from、来源模型、方法版本和引用关系；
- 删除前显示消费者，默认可恢复；
- 同一 Asset 可继续用于图片变体、视频或网页创作。

## 明确不做

- 不归档流式 token、partial HTML 或失败 tool output。
- 不另造一套与 Gallery 平行的资产 UI。
- 不在没有真实 producer 时先加入 `component` / `document` schema 或筛选项。
- 不在缺少 trust/CSP/source scope 时把 HTML 当安全静态文件打开。
- 不将 base64 大对象塞进 manifest。
- 不在 migration/backfill 可回滚前替换旧表。

## Producer-backed kind registry

Kind 注册必须同时声明：

```ts
interface AssetKindDescriptor {
  id: string;
  producers: string[];
  materializer: string;
  validator: string;
  previewConsumer: string;
  inputConsumers: string[];
  trustPolicy: string;
  conformanceSuite: string;
}
```

首轮裁决：

| Kind | 当前事实 | 首版状态 |
|------|----------|----------|
| `image` | `saveMediaToLibrary` / image generator / Gallery 已有真实持久化 | 可进入初始 registry，需 backfill tests |
| `video` | MediaBlock / Gallery 已有展示与保存链路 | 可进入初始 registry，需 producer inventory |
| `audio` | Media contract 已表达，需核对所有 producer/preview | 仅 inventory 全绿后注册 |
| `html_bundle` | 已有 Artifact trust/CSP 基础，但 durable materializer 需实现 | B2 完成后注册 |
| `web_snapshot` | 必须先指名 capture/materializer/validator | 候选，不预注册 |
| `component` | 无独立 materialization pipeline | 不进入首版 schema/UI |
| `document` | 无独立 materialization pipeline | 不进入首版 schema/UI |

Registry 扩展可以向前兼容，但 UI、API 和 schema 只能暴露已注册 kind。

## B0 — Inventory 与 migration plan

盘点并记录：

- `src/lib/db.ts:media_generations / media_jobs / media_job_items`；
- `src/lib/media-saver.ts:saveMediaToLibrary`；
- `src/lib/codex/media-import.ts:materializeCodexEventMedia`；
- Gallery route、serve route、detail/grid；
- HTML preview / Artifact trust、CSP 和 source scope；
- 每个 kind 的 producer、failure terminal state、preview 和 downstream consumer。

Migration plan 必须包含：

- 新旧表关系；
- backfill source breadcrumb；
- content hash 与重复数据；
- rollback / restart；
- 旧版本读取新 DB 的兼容边界；
- large file path 与 missing file 状态；
- 引用计数与删除恢复。

## B1 — Asset registry、backfill 与 lineage

`AssetRecord` 至少记录：

- id、registered kind、producerId；
- stable path / content hash / MIME；
- dimensions / duration / preview（适用时）；
- Harness / project / session / turn；
- Runtime / Provider / Model；
- prompt / reference / method version；
- parent / derived-from；
- selected / rejected / rating；
- trust / CSP / source scope；
- license / source URL（适用时）。

Backfill 原则：

- 现有 Gallery 数据字节级不改；
- 重复运行 idempotent；
- path missing 不伪造 success；
- hash 相同可共享 content ref，但 provenance 不合并丢失；
- 旧 ID 和用户 favorite/tags 可追溯；
- migration journal 可恢复。

### B1 完成标准

- 现有 media 数据无损 backfill。
- image → derived image → video lineage 可查询。
- 删除 Asset 前能列出引用者。
- 默认走可恢复删除。
- 没有 registered producer 的 kind 无法写入。

## B2 — HTML bundle

HTML / web result 只有同时满足以下条件才 materialize：

1. 生成已完整结束，不是 partial preview；
2. 文件写入稳定 bundle，并有 content hash；
3. trust tier、CSP、baseDir/source scope 已记录；
4. validator 检查入口文件、资源边界和危险 URL；
5. preview 使用现有隔离边界；
6. failure 只保留 run log，不创建成功 Asset。

`web_snapshot` 与 `html_bundle` 不默认等价。只有真实 capture pipeline 存在时才注册 `web_snapshot`。

### B2 完成标准

- 完整网页结果可 materialize、重开和再次引用。
- partial/failure 不进入 Asset Library。
- HTML Asset 不绕过既有 trust/CSP/scope。
- bundle 删除/移动不会留下无来源的成功记录。

## B3 — Gallery 渐进演进

- 复用 Gallery 页面与现有 media preview；
- kind filters 从 registry 派生；
- unsupported preview 显示真实原因，不显示空白成功卡；
- Asset 可作为 typed reference 进入后续 turn；
- Runtime 不支持该 media input 时返回明确 degradation；
- 不依赖模型猜本地路径。

### B3 完成标准

- 一条 image → derived image → video → html_bundle 链路可见。
- CodePilot、Claude、Codex projection 引用同一 AssetRef。
- 用户能检索来源、方法、项目和 parent。
- 未注册 kind 不出现在筛选器或创建 API。

## Conformance Suite

每个 Asset kind 必须通过：

1. descriptor completeness；
2. producer terminal-state mapping；
3. materializer idempotency；
4. hash/path validation；
5. provenance completeness；
6. preview consumer；
7. typed-reference round-trip；
8. lineage parent existence；
9. deletion/recovery；
10. trust/security policy；
11. missing file / partial failure；
12. unsupported Runtime degradation。

## 验证分层

| 层 | 内容 |
|----|------|
| Tier 0 | registry/descriptor、provenance、kind validation |
| Tier 1 | backfill、hash、lineage、delete/recover、typed references |
| Tier 2 | DB migration、真实 media producer、HTML materialization、packaged preview |
| Human gate | Gallery 多 kind 可读性、网页预览安全提示、创作链路理解 |

## Smoke Ledger

| Date | Kind | Producer | 场景 | Result | Evidence |
|------|------|----------|------|--------|----------|
| _待执行_ | image/video | existing media pipeline | backfill → lineage → typed reference | ⏳ | asset ids / DB snapshot / screenshot |
| _待执行_ | html_bundle | HTML materializer | complete/partial/failure 三路径 | ⏳ | bundle hash / CSP evidence / screenshot |

## 决策日志

- 2026-07-30：Asset Library 从 umbrella 拆为独立 DB/Gallery program。
- 2026-07-30：Asset kind 必须 producer-backed；扩展性通过 registry，不通过预埋假枚举值。
- 2026-07-30：`component` / `document` 没有真实 materialization pipeline，首版不进入 schema/UI。
- 2026-07-30：HTML bundle 是首个新增重点，但必须先完成 durable materializer 与 trust/CSP conformance。
