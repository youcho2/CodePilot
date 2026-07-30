# Harness Home Guardrail

Harness Home is the framework-neutral, user-owned source of truth for portable identity, Memory, Skills, MCP descriptors, creative methods and references to durable Assets. Read this file before changing `src/lib/harness-home/**`, adding a Harness adapter, or wiring canonical data into a Runtime.

## 1. 词汇表

| 词汇 | 含义 |
|------|------|
| Canonical repository | User-owned file root containing `manifest.json` and referenced content. SQLite is never the only copy. |
| Manifest generation | Monotonic integer committed after all content files; readers use it as the visible transaction boundary. |
| HarnessAdapter | L0/L1 discovery/import/export/projection for an external Harness; it does not implement chat execution. |
| RuntimeAdapter | L2/L3 execution integration for session, stream, permission, artifact and interrupt. |
| Runtime overlay | Opaque Runtime-specific data preserved separately from canonical shared content. |
| SecretRef | Portable `secret://` identity. It never contains a resolved value. |
| Writer lease | Single-writer lock for one canonical realpath. |
| Prepared journal | Durable intent plus staged bytes used to resume a partial multi-file transaction. |
| Reference status | `pending`, `executable` or `rejected`; a stable canonical capability must be executable in CodePilot. |

## 2. 不变量 / 契约表

| # | Contract |
|---|----------|
| 1 | Core contracts contain no external-framework home paths and no fixed Runtime record keys. Runtime/framework IDs are opaque strings validated by registries. |
| 2 | Unknown manifest fields and Runtime overlays round-trip without loss. Unknown executable behavior still fails closed. |
| 3 | `stable` canonical capability implies `referenceStatus=executable`. Draft/pending capability cannot enter stable Settings coverage or executable model context. |
| 4 | Manifest and canonical repository writes reject inline Secret material. Diagnostics/export contain only SecretRef and availability metadata. |
| 5 | A realpath has at most one writer. A second instance becomes read-only or fails. Takeover requires exact holder identity, provably dead PID and explicit confirmation. |
| 6 | Multi-file write order is staging → prepared journal → content atomic rename → manifest atomic rename → committed journal. Manifest is always last. |
| 7 | `fs.watch` is a hint only. Open/focus/pre-write/explicit refresh must use generation and content hashes. External edits never become silent last-write-wins. |
| 8 | Existing path components may not be symlinks. Repository-relative refs may not be absolute, contain `..`, or target `.harness-home`. |
| 9 | Migration is dry-run first, copy-only, idempotent and conflict-aware. It does not delete or rewrite the external source. |
| 10 | New L0/L1 framework work defaults to its adapter directory, one registry entry and conformance fixtures. Context Compiler, Settings coverage and Artifact renderer are outside the allowed boundary. |
| 11 | Runtime overlays may override projection for the active Runtime but never overwrite the canonical base definition/state. |
| 12 | Creative Method and durable Taste Memory require evidence. A durable user preference requires explicit confirmation and remains revocable. |

## 3. 关键文件 + 责任

| File | Responsibility |
|------|----------------|
| `src/lib/harness-home/contracts.ts` | Portable schema, scope, provenance, capability, Method and Taste evidence shapes |
| `manifest.ts` | Known-field validation, unknown-field preservation and manifest Secret gate |
| `scope.ts` | Built-in → user → assistant → project → matching Runtime overlay order |
| `validation.ts` | Secret scan, Full Reference rule and evidence validation |
| `repository/file-repository.ts` | Repository identity, generation check, consistency diagnostics and commit orchestration |
| `repository/writer-lease.ts` | Single-writer ownership and explicit dead-holder takeover |
| `repository/transaction.ts` | Prepared/committed/orphaned journal and crash recovery |
| `migration.ts` | Dry-run/apply, idempotency and same-name/different-content conflicts |
| `secret-store.ts` | Value-free metadata plus explicit resolve/mutate facade |
| `codepilot-secret-store.ts` | Compatibility resolver over v0.62 Settings/Provider/env/external-owned stores |
| `registry.ts` | Open descriptor registries for Harness and Runtime adapters |

## 4. 改动检查表

- [ ] Contract change preserves unknown fields and overlays.
- [ ] New field has a portable meaning and does not expose a local absolute path or Secret.
- [ ] Repository write verifies current manifest hash/generation and every referenced content hash.
- [ ] New transaction path keeps manifest last and recovery idempotent.
- [ ] New credential namespace declares resolve, mutation, reauthorization and cleanup semantics.
- [ ] New L0/L1 adapter passes the shared conformance suite and does not modify forbidden touchpoints.
- [ ] New Runtime descriptor keeps unsupported capabilities explicit and passes permission/event conformance.
- [ ] New Asset kind is producer-backed and is registered in Program B, not added as a speculative enum here.
- [ ] New Taste/Method persistence includes evidence, scope and revoke behavior.
- [ ] Tests use isolated temporary roots; never point at a real user Harness root.

## 5. 常见坑

- Treating a successful `fs.watch` event as proof that an index is current.
- Deleting a lock by age alone. A slow or suspended live process is still the writer.
- Writing the manifest before content and exposing a mixed generation after a crash.
- Resolving a SecretRef for diagnostics and accidentally serializing the returned value.
- Parsing only known Runtime overlays and dropping fields from an uninstalled adapter.
- Calling an L0/L1 scanner a Runtime integration, then branching in Context Compiler and Settings.
- Treating a selected image or one-off edit as a permanent user preference.
- Adding `component`, `document` or `html_bundle` before a real materializer/validator/consumer exists.

## 6. 测试覆盖

| Contract | Test |
|----------|------|
| Neutral contract, unknown overlay, scope, Full Reference, SecretRef, Taste evidence | `src/__tests__/unit/harness-home-contract.test.ts` |
| Single writer/read-only fallback/explicit takeover | `src/__tests__/unit/harness-home-repository.test.ts` |
| Dry-run/idempotency/conflict/full portable refs | `harness-home-repository.test.ts` |
| Crash recovery/manifest-last/external edit | `harness-home-repository.test.ts` |
| Symlink boundary and inline Secret rejection | `harness-home-repository.test.ts` |
| SecretStore value-free diagnostics/read-only namespaces | `harness-home-repository.test.ts` |
| Per-adapter L0/L1 behavior | `harness-home-adapter-conformance.test.ts` |

Required local verification for core/repository changes:

```bash
npm run typecheck
npx eslint src/lib/harness-home src/__tests__/unit/harness-home-*.test.ts
CODEX_DISABLED=1 npx tsx --test --import ./src/__tests__/db-isolation.setup.ts src/__tests__/unit/harness-home-*.test.ts
```

Run full `npm run test` before closing a phase or changing existing Runtime/DB/MCP behavior.

## 7. 设计决策日志

- 2026-07-30 — Harness Home is a domain aggregate, not a required page. UI entry remains a separate product decision.
- 2026-07-30 — User files are canonical; SQLite may index but cannot become the only copy of identity, Memory, Skill or Method.
- 2026-07-30 — Full Reference permits draft/pending catalog entries, while stable capabilities must be executable in CodePilot.
- 2026-07-30 — The write model uses a single writer, same-root staging, durable journal, manifest-last commit, hash reconciliation and explicit dead-holder takeover.
- 2026-07-30 — The initial SecretStore is a compatibility facade over existing v0.62 stores. No silent credential migration or external auth-file read is allowed.
- 2026-07-30 — L0/L1 Harness adapters are separated from L2/L3 Runtime adapters to keep new framework integration bounded.
