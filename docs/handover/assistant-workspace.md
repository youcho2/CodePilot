# 助理工作区 — 交接文档

## 概述

助理工作区让用户指定一个目录存放 AI 人格/记忆文件（soul.md、user.md、memory.md、claude.md），在助理项目会话中自动注入系统提示词。附带对话式引导问卷（10 题）和每日轻量问询（3 题）。

## 目录结构

```
workspace/
├── claude.md          # 执行规则
├── soul.md            # 人格风格
├── user.md            # 用户画像
├── memory.md          # 长期记忆
└── .assistant/
    └── state.json     # 状态持久化
```

## 核心模块

### `src/lib/assistant-workspace.ts`

| 函数 | 职责 |
|------|------|
| `validateWorkspace(dir)` | 检查目录和文件状态 |
| `initializeWorkspace(dir)` | 补建缺失模板 + state.json |
| `loadWorkspaceFiles(dir)` | 读 4 文件，每文件上限 8000 chars |
| `assembleWorkspacePrompt(files)` | XML 标签拼接，总上限 40000 chars |
| `loadState(dir)` / `saveState(dir, state)` | 读写 `.assistant/state.json` |
| `needsDailyCheckIn(state)` | 判断是否需要每日问询（前置检查 onboarding 完成） |
| `generateDirectoryDocs(dir)` | 扫描子目录生成 README.ai.md + PATH.ai.md |

文件兼容映射：lowercase canonical → uppercase fallback（如 `soul.md` → `Soul.md` → `SOUL.md`）。

### Prompt 注入（`src/app/api/chat/route.ts`）

仅当 `session.working_directory === getSetting('assistant_workspace_path')` 时注入：
1. 工作区文件内容（`<assistant-workspace>` XML）
2. 引导/问询指令（`<assistant-project-task>`）

普通项目聊天完全不受影响。

### 自动触发链路

1. **Mount 触发**：`ChatView` mount 时 500ms 延迟检测，使用 `startStream()` 直接发送（非 `sendMessage`）
2. **Focus 兜底**：`MessageInput` onFocus 首次触发，防 mount 未生效
3. **防重复**：`assistantTriggerFiredRef`（组件级 ref）防止同一 mount 周期内重复触发；`state.hookTriggeredSessionId` 按 session 粒度防止跨页面重复
4. **autoTrigger 标志**：触发时携带 `autoTrigger: true`，后端跳过保存用户消息和标题更新，实现"AI 先说话"体验
5. **hookTriggeredSessionId 清理**：引导/问询完成后前端调用 `POST /api/workspace/hook-triggered` 发送 `{ sessionId: '__clear__' }` 清除标记，确保下次进入可再次触发
6. **最新会话校验**：每日问询仅在该工作区最新会话中触发，旧会话打开不会劫持问询（通过 `GET /api/workspace/latest-session` 校验）

### 确定性落盘

AI 在对话中输出 `onboarding-complete` / `checkin-complete` 代码块 → 前端 `detectAssistantCompletion()` 解析 → 调 POST `/api/workspace/onboarding` 或 `/api/workspace/checkin` → 后端 AI 生成文件内容（失败回退原始答案）→ 清除 `hookTriggeredSessionId`。

## API 端点

| 路由 | 方法 | 职责 |
|------|------|------|
| `/api/settings/workspace` | GET | 返回路径 + 文件状态 + state |
| `/api/settings/workspace` | PUT | 保存路径，可选初始化 |
| `/api/workspace/session` | POST | 创建或复用助理会话（onboarding 新建，checkin 复用） |
| `/api/workspace/onboarding` | POST | 接收答案 → AI 生成 soul.md + user.md |
| `/api/workspace/checkin` | POST | 接收答案 → AI 更新 memory.md + user.md |
| `/api/workspace/hook-triggered` | POST | 设置/清除 hookTriggeredSessionId（`__clear__` 哨兵值清除） |
| `/api/workspace/latest-session` | GET | 返回指定 workingDirectory 的最新会话 ID |
| `/api/workspace/docs` | POST | 刷新目录文档 |

## 状态字段（`.assistant/state.json`）

```typescript
interface AssistantWorkspaceState {
  onboardingComplete: boolean;
  lastCheckInDate: string | null;    // "YYYY-MM-DD"
  schemaVersion: number;             // 当前 1
  hookTriggeredSessionId?: string;   // 防重复触发
}
```

## 关键约束

- 引导与问询互斥：onboarding 完成当天不触发 daily check-in
- 每日问询复用最后一条会话，不新建
- `hookTriggeredSessionId` 按 session 粒度防重复，换 session 可重新触发；完成后自动清除
- `autoTrigger` 贯穿 ChatView → stream-session-manager → chat/route.ts，跳过用户消息保存和标题更新
- 每日问询不受 `messages.length > 0` 限制，可在有历史消息的复用会话中触发
- 文件截断策略：每文件 8000 chars（head 6000 + truncated marker + tail 1800）
