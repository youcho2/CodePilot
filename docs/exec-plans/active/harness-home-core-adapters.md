# Harness Home Program A — Core、Repository 与 Adapter Kits

> 创建时间：2026-07-30
> 最后更新：2026-07-30
> 状态：📋 待 Shared Phase 0 门禁；**未授权产品代码实施**
> 父计划：[harness-home-user-owned-core.md](harness-home-user-owned-core.md)
> 基线：正式 v0.62 发布线；实施时必须从当时最新 `main` 新建隔离 worktree

## 目标

建立用户所有、与 Agent 框架和模型解耦的 Harness 核心层，并把“导入外部 Harness 资产”与“接入完整执行 Runtime”拆成两个成本等级不同的 adapter kit。

本计划只负责：

- Harness Home shared contracts；
- file-backed Canonical Repository；
- migration / dual-read；
- `HarnessAdapter` L0/L1；
- `RuntimeAdapter` L2/L3；
- CodePilot Full Reference Implementation；
- write model、SecretStore 和 conformance。

Asset DB/Gallery 演进见 [harness-home-asset-library.md](harness-home-asset-library.md)，设计方法产品化见 [harness-home-design-method.md](harness-home-design-method.md)。

## 状态

| Phase | 内容 | 状态 | 入口门禁 |
|-------|------|------|----------|
| A0 | Shared Phase 0 inventory 与 enforcement anchors | 🔄 待完成 | 父计划全部 Phase 0 checkbox |
| A1 | Domain contracts、scope、provenance、reference status | 📋 待开始 | A0 全绿 |
| A2 | File repository、write model、SecretStore、migration | 📋 待开始 | A1 contract frozen |
| A3 | HarnessAdapter L0/L1 + per-adapter conformance | 📋 待开始 | A2 dry-run/round-trip 通过 |
| A4 | RuntimeAdapter L2/L3 + CodePilot Full Reference | 📋 待开始 | A3 边界与 touchpoint budget 通过 |

## 用户会看到什么

首轮不增加 Harness Home 页面。逐阶段可见结果：

- diagnostics 能说明 Harness root、source、冲突和 Secret unresolved 状态；
- 导入前有 dry-run，导入不删除外部源；
- 同一 canonical Memory/Skill/MCP 可投影到不同 Runtime；
- 不支持能力有明确原因；
- 接第四个框架可以先交付 L0/L1，不必同时完成聊天 Runtime。

## 明确不做

- 不在主目录直接实施。
- 不自动覆盖 `.claude` / `.codex` 或其他外部框架目录。
- 不读取对方 auth 文件绕过授权协议。
- 不将 API key、OAuth token 或 authorization header 写入 Harness root。
- 不承诺任意框架都成为 Full Runtime。
- 不用 prompt 声称未真实 mount 的工具可执行。
- 不实现 Runtime 动态加载任意第三方 JS；首版可使用编译期 registry。

## A0 — 开工门禁

A1 开工前，父计划必须完成：

1. Memory / Skill / MCP / Runtime / Artifact / Secret source-of-truth inventory；
2. 第四个框架 L0/L1 与 L3 touchpoint 基线；
3. D1–D7 和 adapter 边界的 enforcing file+symbol；
4. file repository write model 决策；
5. SecretStore 决策；
6. producer-backed Asset kind inventory。

未完成项不能以“实现过程中再看”绕过。

## A1 — Shared contracts

目标目录建议：

```text
src/lib/harness-home/
├── contracts.ts
├── scope.ts
├── provenance.ts
├── manifest.ts
├── projection.ts
├── validation.ts
└── registry.ts
```

必须定义：

- `HarnessHomeRef` 与 schema version；
- definition / state / asset indexes；
- global / assistant / project / runtime-overlay scope；
- provenance；
- `SecretRef`；
- `AssetRef`；
- `RuntimeProjection`；
- canonical capability maturity 与 `referenceStatus`；
- unknown Runtime / unknown overlay 的 round-trip 行为。

稳定能力约束：

```text
stable canonical capabilities ⊆ CodePilot executable capabilities
```

`draft + pending` 可以存在于 catalog 和开发 diagnostics，但不能进入稳定 Settings coverage、模型上下文或用户承诺。

### A1 完成标准

- Contract 中没有 `.claude` / `.codex` 路径。
- Contract 中没有固定三 Runtime 的 record key。
- 未注册 Runtime overlay 可无损 round-trip。
- Secret 明文进入 manifest/export model 时 fail-closed。
- D1–D7 各有自动化或明确人工门禁。
- 现有 Runtime 与 UI 行为零变化。

## A2 — Canonical Repository 与写模型

### Repository 边界

`HarnessRepository` 默认实现为用户可选择根目录的 file repository。SQLite 只保存：

- repository registry；
- content hash / search index；
- session / job / asset 关联；
- migration/write journal；
- cache generation；
- 不得成为 identity / memory / skill / method 的唯一副本。

### 日常写模型

必须实现并测试以下 contract：

1. **单写者**
   - 一个 Harness root 同时只允许一个 writer lease；
   - lock 至少记录 instance id、process identity、startedAt 和 schema version；
   - 其他实例进入只读或显式 takeover 流程，不静默抢锁。
2. **事务写**
   - 多文件写入先进入同 root 的 staging transaction；
   - journal 记录 expected old hash、new hash、files 和 terminal state；
   - durable flush 后以 atomic rename/replace 提交；
   - 启动时识别 prepared / committed / orphaned transaction。
3. **外部编辑**
   - `fs.watch` 只触发 debounce，不作为事实源；
   - 打开 root、窗口重新聚焦、watch event 和写前都按 manifest generation/content hash 对账；
   - 外部改动与本地未提交写冲突时进入 conflict，不 last-write-wins。
4. **多实例 / worktree**
   - 主目录与开发 worktree 不得同时持有同一真实 Harness root 的写 lease；
   - 测试使用隔离临时 root；
   - packaged app 与 dev app 争用时默认 fail-closed，并给出持有者 breadcrumb。
5. **索引失效**
   - SQLite index 带 source generation/hash；
   - hash 不一致时先标 stale，再重建；不能展示旧索引为最新事实。

### SecretStore

Phase A2 不预设“DB 一定正确”或“OS keychain 一定正确”。必须基于 A0 inventory 选择并记录：

- `SecretStore.get/set/delete/resolve` abstraction；
- `secretRef` namespace、scope 和 version；
- API key / OAuth bundle / env-only / external-owned 四类解析路径；
- 换机导入的 unresolved 状态和重新授权；
- logout/revoke/delete 的清理语义；
- diagnostics/export/log 的统一脱敏；
- OS keychain/safeStorage 不可用时的 fail-closed 行为。

Harness export 只能包含 `secretRef` 与重新授权提示。

### Migration

- dry-run first；
- copy/reference，不删源；
- provenance/source breadcrumb；
- content hash 去重；
- 同名不同内容进入 conflict；
- journal 可重跑、可恢复；
- 过渡期 canonical-first dual-read；
- 达到迁移门禁前旧 loader 保持可用。

### A2 完成标准

- fixture 能生成完整 manifest。
- 重复迁移 idempotent。
- 半写/崩溃可恢复，无 silently mixed generation。
- 外部编辑可被 hash/rescan 发现。
- 两实例不能同时写同一 root。
- 导出扫描不到 Secret。
- 干净临时目录导入后恢复 identity / memory / skill metadata / MCP descriptor / method refs。

## A3 — HarnessAdapter L0/L1

```ts
interface HarnessAdapter {
  descriptor: HarnessAdapterDescriptor;
  discover(input: DiscoverInput): Promise<DiscoveredHarnessAssets>;
  importPlan(input: ImportInput): Promise<ImportPlan>;
  exportPlan?(input: ExportInput): Promise<ExportPlan>;
  project(input: ProjectionInput): Promise<HarnessProjectionOverlay>;
}
```

目标目录：

```text
src/lib/harness-home/adapters/<framework-id>/
├── descriptor.ts
├── discover.ts
├── import.ts
├── export.ts
└── fixtures/
```

### L0/L1 Conformance Suite

每个 adapter 必须重复运行，而不是只验证首批 source adapter：

1. descriptor completeness；
2. discovery 只读且 path boundary fail-closed；
3. provenance/source breadcrumb 完整；
4. Secret 明文扫描与 external-owned credential 隔离；
5. dry-run 与 apply 结果一致；
6. import idempotency；
7. same-name/different-content conflict；
8. canonical → external → canonical round-trip；
9. unknown field/overlay 保留；
10. partial failure 不修改源、不产生假 success；
11. unsupported mapping 有原因；
12. export 必须显式触发且不覆盖未确认外部改动。

### Touchpoint acceptance

新增 L0/L1 framework 默认只能修改：

- adapter 自身目录；
- descriptor registry；
- fixture / conformance tests。

以下文件不得因为新增 L0/L1 framework 被修改：

- `src/lib/harness/context-compiler.ts:compileContext`；
- `src/lib/harness/capability-matrix.ts:*`；
- `src/components/settings/RuntimeCapabilityList.tsx:RuntimeCapabilityList`；
- `src/lib/harness/artifact-contract.ts:ARTIFACT_CONTRACTS`；
- `src/components/ai-elements/artifact.tsx:Artifact*`；
- 其他已有 adapter。

Changed-files guard 必须由调用者提供明确 base commit 和 allowlist。任何例外都进入计划决策日志，不能静默放宽。

## A4 — RuntimeAdapter 与 Full Reference

```ts
interface RuntimeDescriptor {
  id: string;
  displayName: string;
  integrationLevel: 'bridge' | 'full';
  capabilities: RuntimeCapabilityDeclaration[];
  harnessProjectionModes: ProjectionMode[];
  session: SessionDriver;
  events: EventMapper;
  permissions: PermissionMapper;
  artifacts: ArtifactSupportDeclaration[];
}
```

实施前先 POC：

- `RuntimeId` 从 closed union 迁到 registered/validated opaque id；
- DB wire compatibility；
- i18n / Settings descriptor 派生；
- capability matrix descriptor 派生；
- unknown runtime fail-closed；
- packaged Electron 显式注册。

### L2/L3 Conformance Suite

1. descriptor completeness；
2. context projection；
3. executable = truly mounted；
4. referenceStatus stable/pending 诚实；
5. unsupported reason；
6. tool start/result pairing；
7. permission mapping；
8. session resume；
9. interrupt / terminal state；
10. artifact round-trip；
11. unknown event preservation；
12. Asset reference/materialization；
13. external Harness perception；
14. Secret isolation。

### CodePilot Full Reference

- CodePilot 从 canonical repository 读取 identity/rules、memory、skills、MCP descriptors、methods 和 Asset refs。
- 新建 Skill/MCP 默认写 canonical repository；外部 export 是用户明确动作。
- Stable capability 必须真实 mount 并通过 conformance。
- Draft pending capability 不进入稳定 coverage。
- Runtime 切换不改写 canonical 数据。

## 验证分层

| 层 | 内容 |
|----|------|
| Tier 0 | schema/scope/provenance/SecretRef/referenceStatus/descriptor 纯测试 |
| Tier 1 | repository、write journal、migration、dual-read、L0/L1 conformance、touchpoint guard |
| Tier 2 | 三 Runtime 真实凭据、permission、resume、interrupt、packaged registration |
| Security gate | export scan、path traversal、lock takeover、SecretStore unavailable |

## Smoke Ledger

| Date | Phase | Runtime / Adapter | 凭据形态 | 场景 | Result | Evidence |
|------|-------|-------------------|----------|------|--------|----------|
| _待执行_ | A3 | fourth-framework L1 fixture | none | discover → dry-run → import → round-trip | ⏳ | test command / fixture hash |
| _待执行_ | A4 | CodePilot / Claude / Codex | real credential | canonical memory/skill/MCP projection | ⏳ | session ids / logs / screenshots |

## 决策日志

- 2026-07-30：从 umbrella 拆出独立工程 program，避免与 Asset DB 和 Design R&D 共用状态。
- 2026-07-30：L0/L1 import/export 与 L3 Runtime 使用两套 conformance；数据迁移不再是弱门禁。
- 2026-07-30：file-as-source-of-truth 必须有单写者、journal、atomic write、hash/rescan 和多实例 contract。
- 2026-07-30：SecretStore 在 inventory 后拍板；manifest 永远只持有 `secretRef`。
- 2026-07-30：Full Reference 允许 draft pending，但 stable canonical 必须在 CodePilot executable。
