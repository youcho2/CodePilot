# Harness Home Program B — Producer-backed Asset Library

> 创建时间：2026-07-30
> 最后更新：2026-07-31
> 状态：🟡 B0–B3 code/tests 与本地 Electron/浏览器 UI smoke 完成；素材库 UI 简化、静态网页缩略图、自适应瀑布流与永久删除语义已落地；packaged app / 用户 human gate 待最终验收；用户已授权 Codex 直接实施，明确不启动 loop
> 父计划：[harness-home-user-owned-core.md](harness-home-user-owned-core.md)
> 依赖：[harness-home-core-adapters.md](harness-home-core-adapters.md) 的 `AssetRef` / scope / provenance / repository boundary

## 目标

把现有 Gallery 演进为用户长期拥有的通用 Asset Library，覆盖真实 producer 产出的图片、视频、音频和完整网页 bundle，并提供 lineage、引用、永久删除保护和跨 Runtime projection。

本计划不负责 Harness/Runtime adapter，也不负责 CodePilot Design Method 的审美内容。

## 状态

| Phase | 内容 | 状态 | 入口门禁 |
|-------|------|------|----------|
| B0 | Producer / consumer inventory 与 DB migration 设计 | ✅ 完成 | Shared Phase 0 Asset inventory |
| B1 | Asset registry、现有 media backfill、lineage | ✅ code/tests 完成 | Program A shared contract frozen |
| B2 | HTML bundle materializer 与 trust/CSP | ✅ code/tests 完成 | B1 + 现有 Artifact trust contract |
| B3 | Library/Gallery 渐进演进与 typed references | ✅ code/tests 完成 | B1/B2 数据门禁 |

## 用户会看到什么

- 素材库不再只像图片 Gallery；
- 图片、视频、音频和成功物化的网页结果可以在同一项目脉络中归档；
- 用户能看到 parent/derived-from、来源模型、方法版本和引用关系；
- 删除是有二次确认的永久删除；存在消费者时会阻止删除；
- 搜索与主要操作同层，类型筛选默认展开且有图标；
- 素材按最新时间进入自适应瀑布流；容器余宽均分给各列，拉宽时增列、缩窄时减列；
- 网页卡片展示真实页面标题，以一次性生成的固定 16:9 PNG 缩略图呈现，不在图库运行网页；
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
- 引用计数与安全永久删除。

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
- 删除必须二次确认；无活跃消费者时永久移除 Asset 记录和独占字节。
- 没有 registered producer 的 kind 无法写入。

### B1 实施证据

- `asset_records` 作为 `media_generations` 上的增量 typed index，旧表和旧字节不改；旧版仍能读取原 Gallery 数据。
- image / video / audio 只有已登记 producer 才能落库；`component` / `document` 未注册。
- 内置图片生成、MCP base64 保存、CLI/Codex 文件导入均在同一事务中写 media row 与 Asset provenance。
- backfill 只扫描 terminal `completed`，missing path 明确记为 `missing`，partial/failed 不伪造成 Asset。
- lineage、active reference、typed ref、消费者阻断与永久删除均由 `asset-library-conformance.test.ts` 覆盖。
- 兼容边界：既有 `lifecycle_state` / restore 路由暂留作旧 trashed record 的数据兼容，不再出现在素材库 UI；新删除路径会移除 Asset record、关联 source media row 和 Asset Library 独占字节，旧版本同样不会再显示已永久删除的内容。

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
- bundle 永久删除不会留下无来源的成功记录或孤立 Asset 目录。

### B2 实施证据

- Preview 与聊天网页卡片中的完整 workspace HTML，以及用户主动选定的 inline HTML 均可归档；两处复用同一客户端入口和服务端安全链路。服务端从真实 session 推导 workspace scope、Runtime、Provider、Model 与 project，不信任客户端自报 provenance。
- materializer 采用临时目录 → 有界复制 → 全 bundle hash → manifest → 原子 rename → DB transaction；相同来源与 hash 的重复请求返回同一 Asset。
- workspace HTML 以用户选定的入口文件为根，只闭包复制 HTML/CSS 实际引用的本地静态依赖，不把入口所在的整个 workspace 当作 bundle；限制文件数、单文件与总大小。被引用的 symlink、scope escape、`file:` / `javascript:`、外部 script、iframe/object/embed/form/base/meta refresh fail-closed。
- HTML Asset 的截图输入只使用现有 `/api/files/html-preview` strict 模式；Electron 在同源、workspace scope、无 interactive 参数的约束下用隔离隐藏窗口生成一次 1280×720 PNG。Gallery 与详情不嵌入 iframe，也不运行归档网页。
- partial / failed 不创建成功 Asset；入口或依赖丢失、字节改变会转为 `missing` / `modified`，不能生成 typed ref 或恢复为 active。

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

### B3 实施证据

- Gallery 原页面增量演进为 Asset Library；kind filters 由 `/api/assets/kinds` registry 返回，首版只有 image / video / audio / html_bundle。
- 图片、视频、真实 WAV、严格静态网页均有真实 preview；缺失/变化显示 integrity 原因，不渲染空白成功卡。
- 详情读取真实 source / project / Runtime / model / method / content hash、parent/child relation 与 active consumers。
- 搜索与收藏/排序位于同一主层，搜索框限制为中等宽度；类型胶囊在下一层永久展开、由 registry 派生并显示对应图标；筛选折叠按钮、开始/结束日期和 Trash 切换均已移除。
- 搜索覆盖 prompt / page title metadata / project / provider / model / method / producer；旧 Gallery row 通过 100 条/请求的 bounded backfill journal 渐进进入 Asset index。
- Gallery 使用测量式最短列瀑布流：数据库仍按 `created_at + id` 稳定排序，DOM 顺序保留 newest-first；列数由 240px 最小列宽决定，剩余容器宽度平均分配给现有列，不留下右侧空槽。
- HTML materializer 在归档时保存真实 `<title>`；旧 bundle 在读取时从实际入口 HTML 补取标题，最终才回退到真实入口文件名。网页归档/旧资产首次打开时经 Electron 隔离窗口生成一次 1280×720 PNG 并保存为 Asset 派生 preview；卡片和详情只读该图片，底部叠加真实标题，不显示“已归档/静态网页”胶囊。
- Gallery 对 legacy media 同时核对 kind、MIME 与文件扩展名；历史上被错误标成 `image/png` 的 `.html` 不再作为坏图压成细条，而是降级为有界占位卡。
- 删除不再进入 Trash lifecycle：详情先展示不可撤销提示，第二次点击才永久删除；活跃引用者仍会阻止删除，共享字节会保留。
- 现有图片生成会把已登记 reference path 解析成 parent Asset；MediaBlock 可携带 typed parent IDs；三 Runtime projection 继续使用 Program A 的同一 canonical `AssetRef`。

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
9. deletion/consumer protection；
10. trust/security policy；
11. missing file / partial failure；
12. unsupported Runtime degradation。

## 验证分层

| 层 | 内容 |
|----|------|
| Tier 0 | registry/descriptor、provenance、kind validation |
| Tier 1 | backfill、hash、lineage、permanent delete / consumer protection、typed references |
| Tier 2 | DB migration、真实 media producer、HTML materialization、packaged preview |
| Human gate | Gallery 多 kind 可读性、网页预览安全提示、创作链路理解 |

## Smoke Ledger

| Date | Kind | Producer | 场景 | Result | Evidence |
|------|------|----------|------|--------|----------|
| 2026-07-30 | image/video/audio | media saver / image generator / Codex import / legacy backfill | terminal write → hash → lineage → typed reference → trash/restore（历史 smoke；删除决策已在 2026-07-31 替代） | ✅ 当时通过 | 旧版 `asset-library-conformance.test.ts`；真实 PNG、MP4 bytes、WAV fixture + isolated SQLite |
| 2026-07-30 | html_bundle | workspace/inline materializer | complete → atomic bundle/hash/preview；partial/failure/symlink/scope/danger URL fail-closed | ✅ Tier 0/1：6/6 | `html-bundle-conformance.test.ts` |
| 2026-07-30 | all registered kinds | Asset/Gallery API + UI contracts | registry filters、search、provenance/lineage、consumer block、Trash/Restore、strict preview（历史 smoke；删除决策已在 2026-07-31 替代） | ✅ 当时通过 | 旧版 `asset-library-api.test.ts` / `asset-library-ui.test.ts` |
| 2026-07-30 | html_bundle | isolated local dev app | 两个真实 materialized bundle → 卡片预览 → detail provenance/parent lineage → search → Trash → Restore（历史 smoke；删除决策已在 2026-07-31 替代） | ✅ 当时通过；iframe `sandbox=""`；0 console errors | 独立 `CLAUDE_GUI_DATA_DIR` + migration disabled；临时数据库与 bundle 已在验收后删除 |
| 2026-07-30 | html_bundle | real workspace chat card | session `5caa4952ddda37df94da3cd11acf7cc4` 首次归档因误扫描 workspace 超过 512 文件而失败 → 改为入口依赖闭包 → API 真实归档 → 聊天卡片单按钮点击变为“已归档到素材库” | ✅ 目标测试 20/20；Browser smoke；真实 Asset `2dff7212-29f3-44a0-b4e2-5bb3420155ca` integrity `valid` | 520 个无关文件回归 fixture；真实用户数据保留该验收 Asset |
| 2026-07-30 | html_bundle | encoded data-SVG fragment | session `20107cbbbc77aeae80f675b1a035b2fc` 的 data URI 内含 `url(%23n)`，解码后的 SVG fragment 被误判为本地文件 `#n` → 解码后再次应用 fragment 语义 | ✅ 目标测试 21/21；真实 API + Browser card smoke；Asset `07e7b8a0-a486-496e-8ed9-04bdc28fe730` integrity `valid` | 精确 data-SVG regression fixture；真实用户数据保留该验收 Asset |
| 2026-07-31 | all registered kinds | Gallery UI + permanent delete | 默认展开的图标筛选、无日期/Trash UI、稳定 newest row-major grid、真实网页标题、固定 16:9 预览、二次确认永久删除、consumer/shared-byte block（历史 smoke；固定 grid 与 live iframe 已被下一条替代） | ✅ 当时目标测试 32/32、全量单测 4873/4873、生产 build | `asset-library-api.test.ts` 8/8；`asset-library-conformance.test.ts` 8/8；`asset-library-ui.test.ts` 8/8；`html-bundle-conformance.test.ts` 8/8；真实本地素材只读验收，未执行删除 |
| 2026-07-31 | html_bundle + media | Electron thumbnail capture / Gallery UI | 网页一次性串行截图并持久化 PNG；Gallery 0 iframe、无“已归档/静态网页”胶囊；搜索框收窄、筛选常显；容器测量式最短列瀑布流；脏历史 `.html`/`image` row fail-closed | ✅ 目标测试 37/37、全量单测 4876/4876、生产 build；真实 Electron 为 3 个旧网页 Asset 生成缩略图均 POST/GET 200；Browser smoke：700px = 2×317px、900px = 3×274px、1600px = 5×250px，余宽均分、0 iframe、无固定行空洞 | `asset-library-api.test.ts` 10/10；`asset-library-conformance.test.ts` 8/8；`asset-library-ui.test.ts` 8/8；`electron-main-security.test.ts` 3/3；`html-bundle-conformance.test.ts` 8/8；宽/窄窗口截图人工核对 |
| _待执行_ | all registered kinds | packaged app | multi-kind visual readability + HTML safety copy | ⏳ Human gate | screenshot / user feedback |

## 决策日志

- 2026-07-30：Asset Library 从 umbrella 拆为独立 DB/Gallery program。
- 2026-07-30：Asset kind 必须 producer-backed；扩展性通过 registry，不通过预埋假枚举值。
- 2026-07-30：`component` / `document` 没有真实 materialization pipeline，首版不进入 schema/UI。
- 2026-07-30：HTML bundle 是首个新增重点，但必须先完成 durable materializer 与 trust/CSP conformance。
- 2026-07-30：用户授权 Codex 在隔离 worktree 直接实施，明确不启动 loop。
- 2026-07-30：B1 采用增量 Asset index + 保留 `media_generations` 的兼容策略；删除默认只改变 Asset lifecycle，不删除旧 row 或本地字节。
- 2026-07-30：B2 只归档用户主动选定的完整 workspace/inline snapshot；归档 HTML 永远使用 strict sandbox/CSP，不继承 Preview 的 interactive script 偏好。
- 2026-07-30：真实 workspace 归档暴露“入口文件所在目录被误当成 bundle root”的缺陷；修复后 workspace materialization 必须从入口 HTML 计算本地资源闭包，无关文件不计入限额也不进入归档。Preview 与聊天卡片必须共用归档客户端，避免两个入口行为漂移。
- 2026-07-30：资源 URL 的安全分类必须在 percent-decoding 后重新识别 document fragment；`%23...` 属于 SVG/CSS 页内引用，不能作为本地文件进入依赖闭包。
- 2026-07-30：B3 沿用 Gallery 路由与页面，不另建平行 Asset UI；旧 row 采用 bounded on-read backfill，避免 schema init 或单个请求同步 hash 整个大库。
- 2026-07-30：隔离浏览器 smoke 发现详情 Dialog 缺少可访问描述，已补 `DialogDescription`；该 smoke 不替代 packaged app 与用户审美验收。
- 2026-07-31：用户取消素材库废纸篓。B1 的“默认可恢复删除”决策被本条替代：UI 仅提供二次确认永久删除；活跃 consumer 继续 fail-closed，Asset Library 独占字节与 source media row 一并删除。旧 lifecycle/restore 代码暂留只为读取历史 trashed records，不构成产品入口。
- 2026-07-31：用户首次要求窗口缩放改变列数而不是卡片尺寸，B3 从 CSS Columns 改为固定宽度 CSS Grid；该决策随后被用户对余宽和瀑布流的进一步反馈替代。
- 2026-07-31：HTML 卡片标题以归档入口的真实 `<title>` 为 source breadcrumb；新归档写入 manifest/metadata，旧归档按需读取入口文件，禁止统一伪造“预览”标题。
- 2026-07-31：用户明确要求恢复瀑布流，并要求不足以新增一列时由现有列等比吃满余宽。B3 改为 ResizeObserver 测量 + 最短列排布；newest-first 保留在 SQL 与 DOM 顺序，不再用固定 256px 卡宽制造右侧空槽。
- 2026-07-31：用户指出 Gallery 里的网页预览仍在运行和动画。网页卡片与详情从 live iframe 改为持久静态 PNG；截图只接受当前 CodePilot `127.0.0.1` 同源、workspace-scoped strict preview URL，串行执行且不接受 renderer 提供写入路径。
