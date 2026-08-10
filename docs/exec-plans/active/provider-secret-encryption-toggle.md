# Provider 密钥加密开关（可关 safeStorage）

> 创建时间：2026-08-10
> 最后更新：2026-08-10
> 总状态：📋 实施中 — fork 默认关闭加密以消除 ad-hoc 签名下每次更新的钥匙串弹窗。

## 背景与动机

fork 为 macOS ad-hoc 签名（未 notarize），每次构建签名不同 → safeStorage 存的密钥的钥匙串 ACL 认不出新构建 → **每次更新首次启动都弹「CodePilot 想访问钥匙串」**。

`safeStorage` 的唯一用途：保护「加密 Provider API Key 的数据密钥」，让别人光拿到 `~/.codepilot/codepilot.db` 也偷不到 key（DatabaseSchema guardrail #21）。它**不是运行必需**——`main.ts:1680` 已有「钥匙串不可用 → `providerSecretEnvironment={}`」降级，此时 `encodeProviderSecret` 走 `legacy_plaintext`（API Key 明文入库）。

用户决策：把「本地加密 Provider 密钥」做成开关，**fork 默认关**（换取零钥匙串弹窗，代价是 API Key 明文落盘）。

## 设计

**mode 标记**：`app.getPath('userData')/provider-encryption.json = { enabled: boolean }`，由 Electron main 在启动时读取（决定是否初始化 safeStorage）。

**默认（标记文件不存在时）**：
- 存在 `provider-secret-key.v1.json`（老加密用户）→ 默认 **enabled=true**（grandfather，不破坏已加密的 key）。
- 否则（全新安装）→ 默认 **enabled=false**（fork 默认关；从不创建 key 文件、从不碰钥匙串）。

**启动（main.ts）**：keychain 可用 **且** enabled → `initializeProviderSecretEnvironment`（原行为）；否则 `providerSecretEnvironment={}`（明文）。

**关闭迁移（encrypted→plaintext，无额外弹窗）**：在**已加密启动**的会话里（key 已在 server env），用户在设置关开关 → server `disableProviderSecretEncryption(db)` 把每行密文解出改存明文（复用现有 decrypt）→ main 写 `enabled=false` → 重启后不再加载 key、永不弹。迁移用的是本次启动已加载的 key，**不产生额外弹窗**。

**开启迁移（plaintext→encrypted）**：main 写 `enabled=true` → 重启 → 启动加载 key（弹一次）→ 现有 `migrateProviderSecrets`（initDb 时跑）自动把明文加密。无需新逻辑。

## 状态

| Phase | 内容 | 状态 | 备注 |
|-------|------|------|------|
| P0 | electron：mode 读写 + 启动 gate + IPC | 🟡 Code complete + Tests pass | provider-secret-key.ts（read/write 默认 grandfather）/ main.ts（boot gate + get/set IPC）/ preload.ts / electron.d.ts |
| P1 | DB 反向迁移 `disableProviderSecretEncryption` | 🟡 Code complete + Tests pass | src/lib/db.ts；事务 + fail-closed 不毁密文；单测覆盖解密→明文 + 幂等 |
| P2 | 设置 API + UI 开关 + i18n | 🟡 Code complete + Tests pass | /api/settings/provider-encryption（disable 反向迁移，409=无 key）、GeneralSection ProviderEncryptionToggle、en/zh |

## 决策日志

- 2026-08-10：fork 默认关闭 Provider 密钥加密（消除 ad-hoc 每更新弹钥匙串）。安全代价：API Key 明文存于本地 db；用户在个人机上接受。默认逻辑用 grandfather（有 key 文件=老加密用户保持开）避免破坏已有加密 key。关闭迁移在加密会话内完成（复用已加载 key），无额外弹窗。
- 2026-08-10（P0–P2 code complete）：实现全链路。electron `readProviderEncryptionEnabled`（默认 grandfather）+ boot gate（关→`providerSecretEnvironment={}` 不碰钥匙串）+ `provider-encryption:get/set` IPC；preload/electron.d.ts 暴露 `providerEncryption`。db `disableProviderSecretEncryption`（密文→明文，事务，解密失败保留密文不毁 key）。API `/api/settings/provider-encryption`（disable 触发反向迁移，无 key 会话返回 409）。设置页 `ProviderEncryptionToggle`（Electron only，关时先调 API 迁移再写 flag，提示重启）+ en/zh。renderer typecheck 通过，electron 仅剩 3 个既有无关错误，单测 5191 pass/0 fail（含新反向迁移 + 幂等用例）。运行时 packaged 验收待 y.4。

## 验收标准

- 全新安装：默认关 → 启动**无**钥匙串弹窗；填 Provider key → db 内 `api_key_storage='legacy_plaintext'`、`api_key` 明文。
- 老用户关开关：Provider key 仍可用（迁移为明文），重启后**无**弹窗；反例：关之前的 key 在关之后仍能正常调用。
- 老用户重新开开关：重启后加密（弹一次），db 内回到 `safe_storage:*` 密文。

## Smoke Ledger

| Date | Runtime | Provider | Model | 凭据形态 | 场景 | Result | Evidence |
|------|---------|----------|-------|---------|------|--------|----------|
| _待跑_ | Electron packaged | — | — | — | 关加密→重启→无钥匙串弹窗 + Provider key 仍可用 | ⏳ | 待 y.4 packaged 验收 |
