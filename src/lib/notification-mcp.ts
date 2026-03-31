/**
 * codepilot-notify MCP — in-process MCP server for notifications and scheduled tasks.
 *
 * Provides 4 tools:
 * - codepilot_notify: Send an immediate notification
 * - codepilot_schedule_task: Create a scheduled task
 * - codepilot_list_tasks: List scheduled tasks
 * - codepilot_cancel_task: Cancel a scheduled task
 *
 * Globally registered: available in all contexts (no keyword gating).
 */

import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';

export const NOTIFICATION_MCP_SYSTEM_PROMPT = `## 通知与定时任务

你可以发送通知和创建定时任务：

- codepilot_notify: 立即发送通知给用户（支持系统通知和应用内提示）
- codepilot_schedule_task: 创建定时任务（支持 cron 表达式、固定间隔、一次性定时）
- codepilot_list_tasks: 查看已有的定时任务
- codepilot_cancel_task: 取消定时任务

使用场景：
- 用户说"提醒我..."或"X 分钟后..." → 用 codepilot_schedule_task（schedule_type: "once"）
- 用户说"每天/每小时..." → 用 codepilot_schedule_task（schedule_type: "cron" 或 "interval"）
- 任务完成需要告知用户 → 用 codepilot_notify
- 用户问"有哪些定时任务" → 用 codepilot_list_tasks`;

export function createNotificationMcpServer() {
  return createSdkMcpServer({
    name: 'codepilot-notify',
    version: '1.0.0',
    tools: [
      // Tool 1: Immediate notification
      tool(
        'codepilot_notify',
        'Send an immediate notification to the user. Supports system notification, in-app toast, and Telegram (for urgent). Use when a task completes, something needs attention, or user asked to be notified.',
        {
          title: z.string().describe('Notification title'),
          body: z.string().describe('Notification body text'),
          priority: z.enum(['low', 'normal', 'urgent']).optional().default('normal')
            .describe('low=toast only, normal=toast+system, urgent=toast+system+telegram'),
        },
        async ({ title, body, priority }) => {
          try {
            const res = await fetch('http://localhost:3000/api/tasks/notify', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ title, body, priority }),
            });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            return { content: [{ type: 'text' as const, text: `Notification sent: "${title}"` }] };
          } catch (err) {
            return { content: [{ type: 'text' as const, text: `Failed to send notification: ${err instanceof Error ? err.message : 'unknown'}` }] };
          }
        },
      ),

      // Tool 2: Schedule a task
      tool(
        'codepilot_schedule_task',
        'Create a scheduled task. Supports cron expressions (e.g. "0 9 * * *" for daily 9am), fixed intervals (e.g. "30m", "2h"), or one-time timestamps (ISO format). The task prompt will be executed by AI when triggered.',
        {
          name: z.string().describe('Task name (e.g. "Drink water reminder")'),
          prompt: z.string().describe('The instruction to execute when triggered'),
          schedule_type: z.enum(['cron', 'interval', 'once']).describe('Schedule type'),
          schedule_value: z.string().describe('cron: "0 9 * * *", interval: "30m"/"2h", once: ISO timestamp like "2026-03-31T15:00:00"'),
          priority: z.enum(['low', 'normal', 'urgent']).optional().default('normal'),
          notify_on_complete: z.boolean().optional().default(true),
        },
        async ({ name, prompt, schedule_type, schedule_value, priority, notify_on_complete }) => {
          try {
            const res = await fetch('http://localhost:3000/api/tasks/schedule', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ name, prompt, schedule_type, schedule_value, priority, notify_on_complete: notify_on_complete ? 1 : 0 }),
            });
            if (!res.ok) {
              const err = await res.json().catch(() => ({}));
              throw new Error(err.error || `HTTP ${res.status}`);
            }
            const data = await res.json();
            return { content: [{ type: 'text' as const, text: `Task "${name}" scheduled. ID: ${data.task.id}, next run: ${data.task.next_run}` }] };
          } catch (err) {
            return { content: [{ type: 'text' as const, text: `Failed to schedule task: ${err instanceof Error ? err.message : 'unknown'}` }] };
          }
        },
      ),

      // Tool 3: List tasks
      tool(
        'codepilot_list_tasks',
        'List all scheduled tasks with their IDs, schedules, status, and next run time.',
        {
          status: z.enum(['active', 'paused', 'completed', 'disabled', 'all']).optional().default('all')
            .describe('Filter by status'),
        },
        async ({ status }) => {
          try {
            const url = status && status !== 'all'
              ? `http://localhost:3000/api/tasks/list?status=${status}`
              : 'http://localhost:3000/api/tasks/list';
            const res = await fetch(url);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data = await res.json();
            const tasks = data.tasks || [];
            if (tasks.length === 0) {
              return { content: [{ type: 'text' as const, text: 'No scheduled tasks found.' }] };
            }
            const formatted = tasks.map((t: { id: string; name: string; schedule_type: string; schedule_value: string; status: string; next_run: string; last_status?: string }, i: number) =>
              `${i + 1}. [${t.id}] ${t.name}\n   Type: ${t.schedule_type} (${t.schedule_value})\n   Status: ${t.status} | Next: ${t.next_run}${t.last_status ? ` | Last: ${t.last_status}` : ''}`
            ).join('\n\n');
            return { content: [{ type: 'text' as const, text: formatted }] };
          } catch (err) {
            return { content: [{ type: 'text' as const, text: `Failed to list tasks: ${err instanceof Error ? err.message : 'unknown'}` }] };
          }
        },
      ),

      // Tool 4: Cancel task
      tool(
        'codepilot_cancel_task',
        'Cancel (delete) a scheduled task by its ID.',
        {
          task_id: z.string().describe('The task ID to cancel'),
        },
        async ({ task_id }) => {
          try {
            const res = await fetch(`http://localhost:3000/api/tasks/${task_id}`, { method: 'DELETE' });
            if (!res.ok) {
              const err = await res.json().catch(() => ({}));
              throw new Error(err.error || `HTTP ${res.status}`);
            }
            return { content: [{ type: 'text' as const, text: `Task ${task_id} cancelled.` }] };
          } catch (err) {
            return { content: [{ type: 'text' as const, text: `Failed to cancel task: ${err instanceof Error ? err.message : 'unknown'}` }] };
          }
        },
      ),
    ],
  });
}
