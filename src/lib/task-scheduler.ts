/**
 * Task Scheduler — polls SQLite for due scheduled tasks and executes them.
 *
 * Architecture:
 * - Runs in Next.js server process via setInterval (10s poll)
 * - Uses globalThis to survive HMR in development
 * - Lightweight execution via generateTextFromProvider (no streaming UI)
 * - Exponential backoff on failure (30s → 1m → 5m → 15m)
 * - Auto-disables after 10 consecutive failures
 */

import type { ScheduledTask } from '@/types';
import crypto from 'crypto';

const POLL_INTERVAL = 10_000; // 10s
const GLOBAL_KEY = '__codepilot_scheduler__';
const BACKOFF_DELAYS = [30000, 60000, 300000, 900000]; // 30s, 1m, 5m, 15m
const MAX_CONSECUTIVE_ERRORS = 10;
const RECURRING_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

// ── Session-only tasks (in-memory, not persisted) ────────────────
const SESSION_TASKS_KEY = '__codepilot_session_tasks__';

function getSessionTasks(): Map<string, ScheduledTask> {
  if (!(globalThis as Record<string, unknown>)[SESSION_TASKS_KEY]) {
    (globalThis as Record<string, unknown>)[SESSION_TASKS_KEY] = new Map();
  }
  return (globalThis as Record<string, unknown>)[SESSION_TASKS_KEY] as Map<string, ScheduledTask>;
}

export function addSessionTask(task: ScheduledTask): void {
  getSessionTasks().set(task.id, task);
}

export function removeSessionTask(id: string): void {
  getSessionTasks().delete(id);
}

/**
 * Ensure the scheduler polling loop is running.
 * Safe to call multiple times — only starts once.
 */
export function ensureSchedulerRunning(): void {
  if ((globalThis as Record<string, unknown>)[GLOBAL_KEY]) return;
  (globalThis as Record<string, unknown>)[GLOBAL_KEY] = true;

  // One-time missed task recovery on startup
  handleMissedTasks().catch(err => console.error('[scheduler] Missed task recovery failed:', err));

  // Auto-expire recurring tasks on startup + hourly
  checkExpiredTasks().catch(() => {});
  const expiryIntervalId = setInterval(() => checkExpiredTasks().catch(() => {}), 3600_000); // hourly
  if (expiryIntervalId && typeof expiryIntervalId === 'object' && 'unref' in expiryIntervalId) {
    (expiryIntervalId as NodeJS.Timeout).unref();
  }

  const intervalId = setInterval(async () => {
    try {
      const { getDueTasks } = await import('@/lib/db');
      const dueTasks = getDueTasks();
      for (const task of dueTasks) {
        // Fire-and-forget: don't block the poll loop
        executeDueTask(task).catch(err =>
          console.error(`[scheduler] Task ${task.id} (${task.name}) failed:`, err)
        );
      }

      // Check session-only tasks too
      const sessionTasks = getSessionTasks();
      for (const [id, task] of sessionTasks) {
        if (task.status === 'active' && new Date(task.next_run) <= new Date()) {
          executeDueTask(task).catch(err =>
            console.error(`[scheduler] Session task ${id} failed:`, err)
          );
          // One-shot session tasks: remove after fire
          if (task.schedule_type === 'once') {
            sessionTasks.delete(id);
          }
        }
      }
    } catch (err) {
      console.error('[scheduler] Poll error:', err);
    }
  }, POLL_INTERVAL);

  // Prevent the interval from keeping the process alive
  if (intervalId && typeof intervalId === 'object' && 'unref' in intervalId) {
    (intervalId as NodeJS.Timeout).unref();
  }

  console.log('[scheduler] Started with 10s poll interval');
}

/**
 * Stop the scheduler polling loop.
 */
export function stopScheduler(): void {
  (globalThis as Record<string, unknown>)[GLOBAL_KEY] = false;
  console.log('[scheduler] Stopped');
}

/**
 * Execute a single due task.
 */
async function executeDueTask(task: ScheduledTask): Promise<void> {
  const { updateScheduledTask, insertTaskRunLog } = await import('@/lib/db');
  const startTime = Date.now();

  // Mark as running
  updateScheduledTask(task.id, { last_status: 'running' });

  try {
    // Lightweight execution via text generation (no streaming UI needed)
    const { generateTextFromProvider } = await import('./text-generator');
    const { resolveProvider } = await import('./provider-resolver');
    const resolved = resolveProvider();

    if (!resolved.hasCredentials) {
      throw new Error('No API credentials configured');
    }

    const result = await generateTextFromProvider({
      providerId: resolved.provider?.id || '',
      model: resolved.upstreamModel || resolved.model || 'sonnet',
      system: `You are executing a scheduled task. Be concise and direct.\nTask name: ${task.name}\nCurrent time: ${new Date().toLocaleString()}`,
      prompt: task.prompt,
      maxTokens: 1000,
    });

    // Success
    updateScheduledTask(task.id, {
      last_status: 'success',
      last_result: result.slice(0, 2000),
      last_run: new Date().toISOString(),
      last_error: undefined,
      consecutive_errors: 0,
    });

    // Log successful execution
    try {
      insertTaskRunLog({ task_id: task.id, status: 'success', result: result.slice(0, 2000), duration_ms: Date.now() - startTime });
    } catch { /* best effort logging */ }

    // Compute next run (for recurring tasks) or mark completed (for once)
    computeNextRun(task);

    // Notify on completion
    if (task.notify_on_complete) {
      await sendTaskNotification(
        `✅ ${task.name}`,
        result.slice(0, 200),
        task.priority as 'low' | 'normal' | 'urgent',
      );
    }

    // Insert result as assistant message in the task's session (or latest assistant session)
    try {
      const { addMessage, getSetting, getLatestSessionByWorkingDirectory } = await import('@/lib/db');
      const workspacePath = getSetting('assistant_workspace_path');
      let targetSessionId = task.session_id;

      if (!targetSessionId && workspacePath) {
        const session = getLatestSessionByWorkingDirectory(workspacePath);
        if (session) targetSessionId = session.id;
      }

      if (targetSessionId) {
        addMessage(targetSessionId, 'assistant', `📋 **${task.name}** (定时任务)\n\n${result}`);
      }
    } catch { /* best effort */ }

    console.log(`[scheduler] Task ${task.id} (${task.name}) completed`);
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : 'Unknown error';
    const errors = task.consecutive_errors + 1;

    updateScheduledTask(task.id, {
      last_status: 'error',
      last_error: errorMsg,
      last_run: new Date().toISOString(),
      consecutive_errors: errors,
    });

    // Log failed execution
    try {
      insertTaskRunLog({ task_id: task.id, status: 'error', error: errorMsg, duration_ms: Date.now() - startTime });
    } catch { /* best effort logging */ }

    // Exponential backoff
    applyBackoff(task.id, errors);

    // Notify on failure
    if (task.notify_on_complete) {
      await sendTaskNotification(
        `❌ ${task.name}`,
        errorMsg.slice(0, 200),
        'urgent',
      );
    }

    // Insert error as assistant message in the task's session
    try {
      const { addMessage, getSetting, getLatestSessionByWorkingDirectory } = await import('@/lib/db');
      const workspacePath = getSetting('assistant_workspace_path');
      let targetSessionId = task.session_id;

      if (!targetSessionId && workspacePath) {
        const session = getLatestSessionByWorkingDirectory(workspacePath);
        if (session) targetSessionId = session.id;
      }

      if (targetSessionId) {
        addMessage(targetSessionId, 'assistant', `❌ **${task.name}** (定时任务失败)\n\n${errorMsg}`);
      }
    } catch { /* best effort */ }

    console.error(`[scheduler] Task ${task.id} (${task.name}) error (${errors}x):`, errorMsg);
  }
}

/**
 * Deterministic jitter: same task always gets the same jitter offset.
 * Prevents thundering-herd when many tasks share the same interval.
 */
function getJitter(taskId: string, intervalMs: number): number {
  const hash = parseInt(taskId.slice(0, 8), 16) / 0xFFFFFFFF;
  const maxJitter = Math.min(intervalMs * 0.1, 15 * 60 * 1000); // 10% of interval, max 15min
  return Math.floor(hash * maxJitter);
}

/**
 * Compute and set the next_run time for a recurring task.
 */
async function computeNextRun(task: ScheduledTask): Promise<void> {
  const { updateScheduledTask } = await import('@/lib/db');
  const now = new Date();

  switch (task.schedule_type) {
    case 'once':
      updateScheduledTask(task.id, { status: 'completed' });
      return;

    case 'interval': {
      const ms = parseInterval(task.schedule_value);
      const lastRun = new Date(task.last_run || now.toISOString());
      let nextRun = new Date(lastRun.getTime() + ms);
      // Anchor-based: skip past missed runs
      while (nextRun <= now) nextRun = new Date(nextRun.getTime() + ms);
      // Apply deterministic jitter to avoid thundering-herd
      nextRun = new Date(nextRun.getTime() + getJitter(task.id, ms));
      updateScheduledTask(task.id, { next_run: nextRun.toISOString() });
      break;
    }

    case 'cron': {
      const nextRun = getNextCronTime(task.schedule_value);
      updateScheduledTask(task.id, { next_run: nextRun.toISOString() });
      break;
    }
  }
}

/**
 * Apply exponential backoff after task failure.
 */
async function applyBackoff(taskId: string, errors: number): Promise<void> {
  const { updateScheduledTask } = await import('@/lib/db');
  const delay = BACKOFF_DELAYS[Math.min(errors - 1, BACKOFF_DELAYS.length - 1)];
  const nextRun = new Date(Date.now() + delay);
  updateScheduledTask(taskId, { next_run: nextRun.toISOString() });

  // Auto-disable after too many consecutive failures
  if (errors >= MAX_CONSECUTIVE_ERRORS) {
    updateScheduledTask(taskId, { status: 'disabled' });
    console.warn(`[scheduler] Task ${taskId} auto-disabled after ${errors} consecutive failures`);
  }
}

/**
 * Send a notification via the notify API (which handles Toast + Electron + Telegram).
 */
async function sendTaskNotification(title: string, body: string, priority: 'low' | 'normal' | 'urgent'): Promise<void> {
  try {
    await fetch('http://localhost:3000/api/tasks/notify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, body, priority }),
    });
  } catch {
    // Best effort — don't let notification failure affect task execution
  }
}

// ── Missed task recovery ──────────────────────────────────────────

/**
 * One-time recovery for tasks that were missed while the app was closed.
 * Finds past-due one-shot tasks and executes them immediately with a notification.
 */
async function handleMissedTasks(): Promise<void> {
  const { getDueTasks, getSetting, getLatestSessionByWorkingDirectory, addMessage } = await import('@/lib/db');

  // Find one-shot tasks that are past due (missed while app was closed)
  const dueTasks = getDueTasks();
  const missedOnce = dueTasks.filter(t => t.schedule_type === 'once');

  if (missedOnce.length === 0) return;

  console.log(`[scheduler] Found ${missedOnce.length} missed one-shot task(s)`);

  const workspacePath = getSetting('assistant_workspace_path');

  for (const task of missedOnce) {
    // Notify user about missed task
    const message = `⏰ **过期提醒: ${task.name}**\n\n你有一个定时任务在 app 关闭期间到期了：\n\n> ${task.prompt}\n\n这个任务将立即执行。`;

    try {
      let targetSessionId = task.session_id;
      if (!targetSessionId && workspacePath) {
        const session = getLatestSessionByWorkingDirectory(workspacePath);
        if (session) targetSessionId = session.id;
      }
      if (targetSessionId) {
        addMessage(targetSessionId, 'assistant', message);
      }
    } catch { /* best effort */ }

    // Execute the missed task immediately
    executeDueTask(task).catch(err =>
      console.error(`[scheduler] Missed task ${task.id} execution failed:`, err)
    );
  }
}

/**
 * Auto-expire recurring tasks older than 7 days (unless marked permanent).
 */
async function checkExpiredTasks(): Promise<void> {
  const { listScheduledTasks, updateScheduledTask } = await import('@/lib/db');
  const now = Date.now();
  const activeTasks = listScheduledTasks({ status: 'active' });

  for (const task of activeTasks) {
    if (task.schedule_type === 'once') continue; // once tasks complete themselves
    if (task.permanent) continue; // permanent tasks never expire

    const age = now - new Date(task.created_at).getTime();
    if (age > RECURRING_MAX_AGE_MS) {
      updateScheduledTask(task.id, { status: 'disabled' });
      console.log(`[scheduler] Task ${task.id} (${task.name}) auto-expired after 7 days`);

      // Notify
      try {
        await sendTaskNotification(`⏰ ${task.name}`, 'This recurring task has auto-expired after 7 days. Recreate it if needed.', 'low');
      } catch { /* best effort */ }
    }
  }
}

// ── Utility functions ──────────────────────────────────────────────

/**
 * Parse interval string like "30m", "2h", "1d" to milliseconds.
 */
export function parseInterval(value: string): number {
  const match = value.match(/^(\d+)(s|m|h|d)$/);
  if (!match) return 10 * 60 * 1000; // default 10m
  const num = parseInt(match[1]);
  const unit = match[2];
  const multipliers: Record<string, number> = { s: 1000, m: 60000, h: 3600000, d: 86400000 };
  return num * (multipliers[unit] || 60000);
}

/**
 * Simple 5-field cron expression parser.
 * Finds the next matching minute within the next 48 hours.
 */
export function getNextCronTime(expression: string): Date {
  const parts = expression.trim().split(/\s+/);
  if (parts.length !== 5) return new Date(Date.now() + 3600000); // fallback 1h

  const now = new Date();
  // Check up to 2880 minutes (48h)
  for (let i = 1; i <= 2880; i++) {
    const candidate = new Date(now.getTime() + i * 60000);
    candidate.setSeconds(0, 0); // align to minute boundary
    if (matchesCron(candidate, parts)) return candidate;
  }
  return new Date(now.getTime() + 3600000); // fallback
}

function matchesCron(date: Date, parts: string[]): boolean {
  const [min, hour, dom, month, dow] = parts;
  return matchField(date.getMinutes(), min)
    && matchField(date.getHours(), hour)
    && matchField(date.getDate(), dom)
    && matchField(date.getMonth() + 1, month)
    && matchField(date.getDay(), dow);
}

function matchField(value: number, field: string): boolean {
  if (field === '*') return true;
  if (field.includes('/')) {
    const [base, step] = field.split('/');
    const stepNum = parseInt(step);
    if (base === '*') return value % stepNum === 0;
    return value >= parseInt(base) && (value - parseInt(base)) % stepNum === 0;
  }
  if (field.includes(',')) {
    return field.split(',').map(Number).includes(value);
  }
  if (field.includes('-')) {
    const [start, end] = field.split('-').map(Number);
    return value >= start && value <= end;
  }
  return parseInt(field) === value;
}
