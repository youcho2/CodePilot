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

---

# 迭代二:归档即时化 + 项目持久化(空文件夹不消失)

对应 commit:`4cd16139`(归档去确认)+ 本次(项目持久化)。

## 变更 1:归档改为即时执行(去掉 confirm 弹窗)

归档是**软删除**(`status='archived'`,数据留在 SQLite,可恢复),原本每次点归档都弹 `confirm(chatList.archiveConfirm)`,价值低反而拖慢操作。三处归档入口统一去掉确认,**即时执行**:
- `ChatListPanel.handleDeleteSession` — 列表 hover 按钮 + 右键菜单归档。
- `UnifiedTopBar.handleDelete` — 顶栏归档当前会话(并从 `useCallback` 依赖数组移除已不再使用的 `t`)。

硬删除(`handleHardDeleteSession` / `chatList.deleteConfirm`)**不受影响**,仍保留确认。废弃的 i18n key `chatList.archiveConfirm` 已从 en/zh 删除。

## 变更 2:项目 = DB 里有任意会话的目录(含归档)

**问题(bug)**:项目(侧栏文件夹)没有独立持久化,完全由「可见会话」`groupSessionsByProject(filteredSessions)` 派生。`getAllSessions` 过滤掉 `archived` → 一个项目的会话全归档后,该 `working_directory` 无可见会话 → **文件夹直接消失**。

**方案(DB 派生)**:项目的存在 = DB 里该目录**有任意会话**(归档也算)。只有把该目录**全部会话硬删除**后,项目才真正消失。

### 数据流

```
侧栏刷新(mount / session-created|updated 事件 / 5s 轮询)
  → fetchSessions() 并行拉两条:
      GET /api/chat/sessions   → 可见(非归档)会话  → setSessions
      GET /api/chat/projects   → 全部目录(含归档)  → setKnownProjects
  → projectGroups useMemo:
      groupSessionsByProject(可见会话)  // 有可见会话的项目
      ∪ knownProjects 中「当前无可见会话」的目录 → 注入零会话空组
      (复用 workspacePath 的合成空组注入模式;按 latestUpdatedAt 重排)
  → 空项目文件夹保留,暴露「+ 新建会话」,直到被真正移除
```

### DB(`src/lib/db.ts`)
- **`getKnownProjects(opts?)`**:跨**全部**会话(含 `archived`)取 `DISTINCT working_directory`,`GROUP BY working_directory`,返回 `{workingDirectory, projectName, latestUpdatedAt}[]`。排除 `''`(No Project)桶;`source` 过滤默认 `['user']`,与 `getAllSessions` 一致。**无 schema 迁移**(纯读)。
- `latestUpdatedAt = MAX(updated_at)`(TEXT `'YYYY-MM-DD HH:MM:SS'` 字典序即时间序);`projectName` 取聚合列(每目录稳定,来自 working_directory 回填)。

### 类型(`src/types/index.ts`)
- `KnownProject { workingDirectory; projectName; latestUpdatedAt }` + `ProjectsResponse { projects: KnownProject[] }`。

### API(`src/app/api/chat/projects/route.ts`,新增)
- **GET** → `{ projects: getKnownProjects(...) }`。`source` 参数镜像 sessions 路由(omit/`user`/`task`/`all`)。

### 客户端(`src/components/layout/ChatListPanel.tsx`)
- `knownProjects` state;`fetchSessions` 改为 `Promise.all([sessions, projects])` 一起拉,每条刷新路径同步更新。
- `projectGroups` useMemo:注入 `knownProjects` 中不在可见 groups、且非 `workspacePath` 的目录为零会话组(`sessions: []`),再按 `latestUpdatedAt` 重排;依赖数组加 `knownProjects`。渲染层已能优雅处理零会话组(workspace 注入已验证:header + 新建按钮,无 session item)。
- **`handleRemoveProject` 语义变更**:从「归档全部会话」改为**硬删除全部会话**(`DELETE ?hard=true`),否则归档行会一直把空文件夹留住。这是现在**唯一**能真正移除项目的入口;确认文案换成 `chatList.removeProjectConfirm`(含「归档会保留空文件夹」提示)。删完 `fetchSessions()` 刷新。
- `handleHardDeleteSession` 成功后追加 `fetchSessions()`,让被清空的文件夹**即时**消失(否则要等 5s 轮询)。

### i18n
- 删除 `chatList.archiveConfirm`。
- 新增 `chatList.removeProjectConfirm`(`{name}` 参数,中英)。

## 触及文件(迭代二)
```
src/lib/db.ts                                # getKnownProjects()(纯读,无迁移)
src/types/index.ts                           # KnownProject / ProjectsResponse
src/app/api/chat/projects/route.ts           # 新增 GET
src/components/layout/ChatListPanel.tsx      # knownProjects + 空组注入 + 硬删 remove-project + 即时刷新
src/components/layout/UnifiedTopBar.tsx      # 顶栏归档去 confirm
src/i18n/en.ts, src/i18n/zh.ts               # -archiveConfirm / +removeProjectConfirm
src/__tests__/unit/known-projects.test.ts    # getKnownProjects 反例断言
```

## 语义契约 / 已知局限(迭代二)
- **归档全部会话 → 空文件夹保留**(可继续新建);**「Remove project」→ 硬删全部 → 项目真正消失**。后者是**行为变更**:从可恢复归档 → 不可恢复删除,已在确认文案说明。
- **项目来源是实测**:`db.getKnownProjects`(含归档),不是估算/固定值。
- **反例已测**(`known-projects.test.ts`):archived-only 项目仍返回(修复点)、hard-deleted 项目丢弃、`''` 桶排除、每目录去重且 `latestUpdatedAt` 有值。
- 已知边界:硬删单条会话清空项目后,靠 `fetchSessions()` 即时刷新;并发/离线极端下最坏等 5s 轮询收敛。空项目文件夹排序按其最后活动时间(含归档会话)。

## 验证(迭代二)
- Code complete + `tsc --noEmit` 通过 + `npm run test` 5307 通过(含新增 5 条 `getKnownProjects` 反例)。
- 待补:空文件夹实际渲染的真机视觉走查(逻辑复用已验证的 workspace 注入模式)。
