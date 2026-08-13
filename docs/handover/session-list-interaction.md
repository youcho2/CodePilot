> 产品思考见 [docs/insights/session-list-interaction.md](../insights/session-list-interaction.md)

# 会话列表交互 + 未读系统 技术交接

会话列表(侧栏)的交互改造与未读(unread)状态系统。两块:
1. **hover 快捷操作**:悬停会话直接显示「分屏 + 归档」图标按钮(去掉原三点菜单)。
2. **右键完整操作 + 未读系统**:右键菜单承载完整操作集,新增「已读会话」「删除会话(硬删)」;侧栏用蓝点 + 加粗标题提示「你在看别的会话时,某会话的回复跑完了」。

对应 commit:`ae5f0de0`。

## 交互变更

| 位置 | 改造前 | 改造后 |
|------|--------|--------|
| hover 会话条目 | 出现一个三点菜单按钮(`DotsThree`),点开才能选 | 右侧直接显示两个图标按钮:**分屏**(`Columns`)+ **归档**(`archive`),直接可点 |
| 右键会话条目 | ContextMenu,内容与三点菜单一致(分屏/重命名/复制ID/归档) | 完整操作集:**分屏 / 重命名 / 复制ID / 已读会话 / 归档 / 删除会话** |

- 三点菜单(`DropdownMenu`)及其 `menuOpen` state 已整体删除;`showActions = isHovered || isDeleting`。
- hover 的「分屏」按钮在 `isActive || !canSplit` 时 disabled(与原菜单项一致)。
- 右键「已读会话」在 `!unread` 时 disabled(已读态置灰)。
- 右键「删除会话」用 `text-destructive` 样式 + `delete` 图标,区别于「归档」。

## 数据流:未读系统

```
stream 结束(某会话回复跑完,且不是当前打开的会话)
  → ChatListPanel 客户端检测(prevStreamingRef diff)
  → markSessionUnread(id):乐观本地置 unread=1 + fire-and-forget PATCH {unread:true}
  → API PATCH → updateSessionUnread(id, true) → UPDATE chat_sessions SET unread=1
  → 下次 fetchSessions 读回 session.unread=1
  → SessionListItem 收到 unread={!!session.unread && !isActive} → 渲染蓝点 + 加粗标题

打开该会话 / 右键「已读会话」
  → markSessionRead(id):乐观本地置 unread=0 + PATCH {unread:false}
  → updateSessionUnread(id, false) → UPDATE ... SET unread=0
```

### DB(`src/lib/db.ts`)
- **schema 迁移**:`migrateDb` 中 `safeAddColumn` 新增 `chat_sessions.unread INTEGER NOT NULL DEFAULT 0`。默认 0 → **升级后旧会话不显未读**。
- **`updateSessionUnread(id, unread: boolean)`**:`UPDATE chat_sessions SET unread=? WHERE id=?`。**有意不写 `updated_at`** — 标记读/未读不重排侧栏(未读是状态,不是活动)。

### 类型(`src/types/index.ts`)
- `ChatSession.unread?: number`(SQLite INTEGER 读回为数字;`1`=未读,`0`/`undefined`=已读)。

### API(`src/app/api/chat/sessions/[id]/route.ts`)
- **PATCH**:`body.unread !== undefined` → `updateSessionUnread(id, !!body.unread)`。
- **DELETE**:
  - `?hard=true` → `deleteSession(id)`:**物理删除** row + messages,不可恢复。
  - 默认(无 flag) → `updateSessionStatus(id, 'archived')`:**软删除**,数据留在 SQLite,`getAllSessions` 过滤掉 `status='archived'`。

### 客户端检测(`src/components/layout/ChatListPanel.tsx`)
- **未读检测**:`prevStreamingRef: Set<string>` 记录上一轮流式会话集(`activeStreamingSessions` + `streamingSessionId`)。每轮 diff:上一轮在流式、这一轮不在、且 `id !== openSessionId` 的会话 → `markSessionUnread(id)`。
- **openSessionId**:从 `pathname` 正则 `^/chat/(.+)$` 提取当前打开会话。
- **自动已读**:`useEffect([openSessionId, sessions])` → `markSessionRead(openSessionId)`(依赖 `sessions` 以覆盖「已打开时又被 fetch 回未读」;`markSessionRead` 对已读态 no-op)。
- **乐观更新**:`markSessionRead`/`markSessionUnread` 先改本地 `sessions` state,再 fire-and-forget PATCH(`.catch(()=>{})`);已是目标态则跳过 PATCH。
- **硬删除**:`handleHardDeleteSession` → `confirm(t('chatList.deleteConfirm'))` → `DELETE ?hard=true` → 本地移除 + 出分屏(`removeFromSplit`)+ 若正打开则 `router.push('/chat')`。
- **prop 传递**:`unread={!!session.unread && !isActive}`(当前打开的会话永不显示未读)。

### 渲染(`src/components/layout/SessionListItem.tsx`)
- 状态点优先级:`isSessionStreaming` > `needsApproval` > `unread`。蓝点 `bg-primary`,仅在 `unread && !isSessionStreaming && !needsApproval` 时显示。
- 未读标题:`font-semibold text-sidebar-foreground`(否则 `font-normal`)。

## i18n(`src/i18n/en.ts` / `zh.ts`)
- `chatList.deleteConfirm` — 硬删确认文案(强调「永久移除/无法恢复」)。
- `chatList.markAsRead` — 「已读会话 / Mark as Read」。

## 触及文件
```
src/lib/db.ts                              # unread 列迁移 + updateSessionUnread
src/types/index.ts                         # ChatSession.unread?: number
src/app/api/chat/sessions/[id]/route.ts    # PATCH unread + DELETE ?hard=true
src/components/layout/ChatListPanel.tsx    # 未读检测 + 硬删 + 读/未读回调接线
src/components/layout/SessionListItem.tsx  # hover 按钮 + 右键菜单 + 蓝点/加粗
src/i18n/en.ts, src/i18n/zh.ts             # deleteConfirm / markAsRead
```

## 语义契约 / 已知局限
- **unread 是实测状态**,来源 `db.chat_sessions.unread`,由本客户端观测到的 stream 生命周期驱动 —— 不是估算、不是固定值。
- **盲区(已记录,未伪造覆盖)**:纯 bridge 后台写入(本端从未观测到 streaming 的会话)不在触发范围,不会点亮未读。这是明确的语义边界,而非用假 0 掩盖。
- **无 MCP 工具**:本功能纯前端交互 + 一个 DB 列 + 一个 API 分支,不涉及 MCP server/tool。
- 未做:未读**计数**(数字 badge)、跨设备同步。见 insights「未来方向」。

## 验证
- Code complete + tsc + 5191 单测通过(node 24)。
- Smoke passed(作者在真实 Electron app 实测):hover 分屏/归档、右键 6 项、硬删确认物理删除、未读正反两路(不在场跑完→蓝点;在场看完→无蓝点)、打开/「已读会话」清除、排序不变。
