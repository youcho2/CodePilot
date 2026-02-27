# Agent Tooling & TodoWrite Bridge

## Architecture Overview

```
SDK TodoWrite tool_use
  → PostToolUse hook (claude-client.ts)
    → Emits tool_result SSE (deduped)
    → Emits task_update SSE { session_id, todos[] }
      → collectStreamResponse (route.ts)
        → syncSdkTasks() persists to DB
      → Frontend SSE consumer (useSSEStream.ts)
        → onTaskUpdate dispatches 'tasks-updated' event
          → TaskList re-fetches from /api/tasks
```

## TodoWrite Field Mapping

| SDK TodoWrite field | Local tasks table column | Notes |
|---------------------|-------------------------|-------|
| `id`                | `id` (prefixed `sdk-`)  | Prefixed to avoid collision with user tasks |
| `content`           | `title`                 | Main display text |
| `status`            | `status`                | Mapped via `mapStatus()` |
| `priority`          | `description`           | Optional context |

### Status Mapping

| SDK status    | Local TaskStatus |
|---------------|------------------|
| `pending`     | `pending`        |
| `in_progress` | `in_progress`    |
| `completed`   | `completed`      |
| Other         | `pending`        |

## Idempotency

`syncSdkTasks()` uses a **replace-all** strategy within a transaction:
1. `DELETE FROM tasks WHERE session_id = ? AND source = 'sdk'`
2. `INSERT` all todos from the latest TodoWrite payload

This is naturally idempotent — calling it multiple times with the same data produces identical results. User-created tasks (`source = 'user'`) are never affected.

## tool_result Three-Layer Dedup

Both `PostToolUse` hook and `user` message handler in the SDK can emit the same `tool_result`. Three layers prevent duplicates:

### Layer 1: claude-client.ts (SSE emission)
- `emittedToolResultIds` Set — checks before enqueueing any `tool_result` SSE event
- Both PostToolUse and user message handler check this Set

### Layer 2: route.ts (DB persistence)
- `seenToolResultIds` Set in `collectStreamResponse()` — skips duplicate `tool_use_id` before writing to `contentBlocks`

### Layer 3: ChatView.tsx (UI state)
- `onToolResult` checks `prev.some(r => r.tool_use_id === id)` before adding to state

## SSE Event Types

| Event             | Source            | Purpose |
|-------------------|-------------------|---------|
| `text`            | stream_event      | Streaming text delta |
| `tool_use`        | assistant message  | Tool invocation |
| `tool_result`     | PostToolUse / user | Tool execution result (deduped) |
| `tool_output`     | stderr callback    | Raw tool output |
| `tool_timeout`    | tool_progress      | Tool execution timeout |
| `task_update`     | PostToolUse        | TodoWrite sync trigger |
| `status`          | system message     | Session init, notifications |
| `result`          | result message     | Final result with usage stats |
| `permission_request` | canUseTool      | Permission approval needed |
| `mode_changed`    | system status      | SDK mode change |
| `error`           | catch block        | Error occurred |
| `done`            | stream end         | Stream complete |

## Troubleshooting

### Tasks not appearing after TodoWrite
1. Check server console for `[claude-client]` logs — ensure PostToolUse fires
2. Verify `task_update` SSE event in browser DevTools Network tab
3. Check `syncSdkTasks()` runs in `collectStreamResponse` (server-side tee'd stream)
4. Verify `tasks-updated` CustomEvent fires in browser console

### Duplicate tool results
1. Check `emittedToolResultIds` Set size in server logs
2. Compare SSE event count before/after (should be halved for tools)
3. Query `messages` table: `SELECT content FROM messages WHERE content LIKE '%tool_result%'` — each `tool_use_id` should appear once

### SDK upgrade issues
- Current: v0.2.62 (upgraded from v0.2.33)
- Rollback: `npm install @anthropic-ai/claude-agent-sdk@0.2.33`
- Key integration points: `canUseTool`, `PostToolUse`, `Notification`, `tool_progress`, `system`, `result`
