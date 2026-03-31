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

const POLL_INTERVAL = 10_000; // 10s
const GLOBAL_KEY = '__codepilot_scheduler__';
const BACKOFF_DELAYS = [30000, 60000, 300000, 900000]; // 30s, 1m, 5m, 15m
const MAX_CONSECUTIVE_ERRORS = 10;

/**
 * Ensure the scheduler polling loop is running.
 * Safe to call multiple times — only starts once.
 */
export function ensureSchedulerRunning(): void {
  if ((globalThis as Record<string, unknown>)[GLOBAL_KEY]) return;
  (globalThis as Record<string, unknown>)[GLOBAL_KEY] = true;

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
  const { updateScheduledTask } = await import('@/lib/db');

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
