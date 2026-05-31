# Packaged 预览包运行时启动诊断（2026-05-31）

> 关联执行计划：[`exec-plans/active/preview-build-readiness.md`](../exec-plans/active/preview-build-readiness.md) Phase 1 packaged P0（Codex app-server / ClaudeCode "准备运行环境"）。
> 状态：**机制已从源码定位；根因待用户那台机器的「屏幕 reason 字符串 + app 日志」确认。** 本文给「症状 → 已确认机制 → 待确认点 → 需要哪几行日志」，确认后再决定改哪。

在「打包新版、已装 Codex 的另一台 Mac」上复现两个问题：

- **问题 A**：软件打开 / 每轮输出结束一段时间后 / 新建对话 → 输入框「正在准备运行环境」+ 模型下拉「模型加载中」，等一会才好。
- **问题 B**：Settings → 执行引擎 → Codex 显示「应用服务启动失败」（机器明明装了 Codex）。

---

## 背景：打包态 PATH 与二进制发现（两个问题共用）

- 从访达 / Dock 启动的打包 Electron **不继承 shell 的完整 PATH**（不读 `~/.zshrc`），裸 PATH 只有 `/usr/bin:/bin:...`。
- app 的补救：启动时跑一个 login shell 读 `userShellEnv` + `getExpandedShellPath()`，并注入 Next server 子进程——`electron/main.ts:839` 的 `startServer` env = `{ ...userShellEnv, ...sanitizedProcessEnv(), ...userShellEnv, PATH: constructedPath, HOME, CLAUDE_GUI_DATA_DIR, ... }`。**所以 Next server 进程的 `process.env.PATH` 已经是扩展后的 PATH，且有 `HOME`。**
- `findCodexBinary()`（`app-server-manager.ts:118`）查找顺序：`CODEX_DISABLED` → `CODEX_BIN` → **walk `process.env.PATH`**（=扩展 PATH）→ **macOS bundle fallback** `/Applications/Codex.app/Contents/Resources/codex`。
- Codex app-server 子进程由 `spawn(binary, ['app-server'], { env: { ...process.env, RUST_LOG } })` 启动（`app-server-manager.ts:192`）——继承 Next server 的好 env（扩展 PATH + HOME）。**所以「env 缺失」基本可排除。**

---

## 问题 A：「正在准备运行环境 / 模型加载中」延迟与重现

### 已确认机制（源码追踪）

1. **两个提示是同一件事**：`GET /api/providers/models` 这个请求在途。
   - 输入框占位符 `messageInput.placeholderLoading`（"Preparing runtime..."）的条件是 `isProviderLoading = fetchState === 'idle'`（`MessageInput.tsx:302`）；模型下拉的 `composer.modelLoading`（`ModelSelectorDropdown.tsx:187`）同源。
   - `useProviderModels` 的 `fetchAll()` **第一行就把 `fetchState` 置回 `idle`**，所以**每次该请求被触发，输入框立刻回到"准备运行环境"，直到请求返回 `loaded`**。不是真的在重启引擎。
2. **每次进会话页至少取两次**：`useGlobalAgentRuntime` 默认 `agentRuntime='claude-code-sdk'`，再异步 `fetch('/api/settings/app')` 解析真实 runtime；解析出与默认不同（如 Codex/Native）时 `sessionRuntimeParam` 变 → `useProviderModels(_, _, runtime)` 依赖 `[runtime]` 变 → **`fetchAll` 重跑** → 又闪一次"准备"。新建对话 = 新挂载 = 重来。
3. **慢源（runtime=Codex/auto 时）**：路由 `if (!runtimeFilter || runtimeFilter === 'codex_runtime')` → `buildCodexProviderModelGroup()` → `getCodexAppServer()` **冷启 spawn `codex app-server` + initialize 握手 + listModels RPC**（`models.ts:37`）。首次很慢；之后 `cached` 复用变快；只有 app-quit 主动 dispose，**但 `proc.once('exit')` 会在子进程退出时清 `cached`**（`app-server-manager.ts:215`）→ 下次取模型列表又冷启。

### 待确认（需日志）

- **"输出结束一段时间后又变准备中"** 的触发点：是 (a) Codex/SDK 子进程在一轮后退出 → 清缓存 → 下次冷启，还是 (b) 某状态变化让 `sessionRuntimeParam` 重算 → 重取？源码层两条都可能，要看日志里子进程是否"每轮后 exited 又 spawning"。

### 需要的日志 / 信息

- `[codex.app-server] spawning` 与 `[codex.app-server] exited` 的时间戳——看是否**每轮输出后退出又重 spawn**、`initialize` 等了多久。
- `/api/providers/models` 的请求耗时（开发者工具 Network 或服务端日志）。
- 当前用的 Runtime（Settings → 执行引擎）——决定是否命中 Codex 慢路径。

---

## 问题 B：Codex「应用服务启动失败」（已装 Codex）

### 已确认机制

- 「应用服务启动失败」= `CodexAvailability` 的 **`kind: 'spawn_failed'`**（`RuntimePanel.tsx:1305`），UI 同时显示 **`Codex 应用服务启动失败：{reason}`**（`RuntimePanel.tsx:1052`）。
- 「启动失败」**不等于「未安装」**：能到 spawn_failed 说明 `findCodexBinary` **已经找到了二进制**（否则是 `not_installed` / 未安装）。问题在找到之后的 **spawn / 子进程退出 / initialize**。
- `spawn_failed` 有**三个产生点**（`app-server-manager.ts`），各带不同 `reason`：

| # | 位置 | reason 形态 | 含义 |
|---|------|------------|------|
| 1 | :201 `spawn` 抛 | `spawn ENOENT` / `EACCES` / `EINVAL` | 找到的路径不对 / 不可执行 / env 异常 |
| 2 | :220 子进程启动后 `exit` | `exited with code=X signal=Y` | 二进制跑起来又立刻退出——**旧版本没有 `app-server` 子命令** / **仍带 `--listen` 的过时构建**（参数被拒）/ 启动期 panic |
| 3 | :237 `initialize()` 抛 | `Codex app-server initialize failed: …` | app-server 起来了但 **JSON-RPC initialize 握手失败**（协议 / 版本不匹配 / 超时） |

- spawn env 充分（见背景：Next server 已带扩展 PATH + HOME，spawn 继承）→ **排除 env 缺失**。

### 三种 reason → 三种根因 → 对策

| reason 你会看到 | 根因 | 对策 |
|----------------|------|------|
| `spawn ENOENT` / 路径相关 | 命中的 codex 路径不对（如 bundle fallback 指向了不可用的二进制，或 `CODEX_BIN` 设错） | 在那台机器终端 `command -v codex` + `codex --version`；核对 app 实际用的路径（日志 `[codex.app-server] spawning { binary }`）|
| `exited with code=…`，**日志/stderr 含 `unexpected argument '--listen'`** | **这个"新版"其实没含 `6923f13`**（又是过时构建——和上次坏包同病）| 用 `preview-build.yml` 重新构建（它的 **gate A 会挡 `<6923f13` 的 commit**）；核对打包用的 commit ≥ `6923f13` |
| `exited with code=…`，**无 `--listen`** | 安装的 Codex **太旧 / 没有 `app-server` 子命令**，或启动期 panic | `codex --version`；确认该版本支持 `codex app-server`（stdio）|
| `initialize failed: …` | **协议 / 版本不匹配**：客户端 `CodexAppServerClient.initialize()` 发的 clientInfo / 协议版本与该 Codex 的 app-server 不兼容 | 看 init 报错细节；可能需按该 Codex 版本适配 initialize 协议 |

### 分诊关键：`reason` 字符串就在屏幕和日志里

- **屏幕**：Settings → 执行引擎 → Codex 那条「Codex 应用服务启动失败：**<这里就是 reason>**」。
- **日志** grep：`Codex app-server spawn failed` / `Codex app-server initialize failed` / `[codex.app-server] exited` / `unexpected argument`。

**一句 reason 基本就能定到上面四行之一。**

### 与 preview-build 的关系（重要）

- 如果 reason 指向 **`--listen` / proc exit**，说明你这个"新版"**仍是过时构建**（没含 `6923f13`）——这正是上次坏包的同一类问题。**走 `preview-build.yml`（workflow_dispatch）重新构建**：它的 `verify-source` gate A（`git merge-base --is-ancestor 6923f13 HEAD` + `grep --listen`）会**拒绝构建早于修复的 commit**，从源头杜绝再出过时包。
- 如果 reason 指向 **initialize / 版本**，那是真·兼容问题，与构建无关，需单独适配。

---

## 下一步（需要你给我）

1. **问题 B 的 reason 字符串**：Settings → 执行引擎 → Codex 那行冒号后面的全部文字（或截图）。**这一项最关键，基本一句定根因。**
2. **那台机器的 app 日志**，grep 这些关键字贴给我：
   - `[codex.app-server]`（spawning / exited / 时间）
   - `Codex app-server`（spawn failed / initialize failed）
   - `unexpected argument`
   - `/api/providers/models`（耗时）
   - `not_installed` / `未安装`
3. **当前 Runtime**：Settings → 执行引擎 截图（是 Codex / ClaudeCode / Native）。
4. **`codex --version`**：在那台机器终端跑一下（确认装的 Codex 版本 + 是否支持 `codex app-server`）。
5. **打包用的 commit**：那个"新版"是从哪个 commit 打的（确认是否 ≥ `6923f13`）。

拿到 1 + 2，问题 B 当场可定根因；拿到问题 A 的 spawn/exit 时间线，可定"输出后重现"是子进程退出重启还是重复取模型。然后再决定改代码哪里（备选方向：packaged 下保持 app-server 常驻 / runtime 异步解析不重复触发模型请求 / 按 Codex 版本适配 initialize）。
