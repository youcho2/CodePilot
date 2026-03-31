import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { name, prompt, schedule_type, schedule_value, priority, notify_on_complete, session_id, working_directory } = body;

    if (!name || !prompt || !schedule_type || !schedule_value) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    // Calculate next_run
    let next_run: string;
    const now = new Date();

    if (schedule_type === 'once') {
      next_run = new Date(schedule_value).toISOString();
    } else if (schedule_type === 'interval') {
      const ms = parseInterval(schedule_value);
      next_run = new Date(now.getTime() + ms).toISOString();
    } else if (schedule_type === 'cron') {
      next_run = getNextCronTime(schedule_value).toISOString();
    } else {
      return NextResponse.json({ error: 'Invalid schedule_type' }, { status: 400 });
    }

    const { createScheduledTask } = await import('@/lib/db');
    const task = createScheduledTask({
      name, prompt, schedule_type, schedule_value, next_run,
      status: 'active',
      priority: priority || 'normal',
      notify_on_complete: notify_on_complete ?? 1,
      consecutive_errors: 0,
      session_id, working_directory,
    });

    // Ensure scheduler is running
    const { ensureSchedulerRunning } = await import('@/lib/task-scheduler');
    ensureSchedulerRunning();

    return NextResponse.json({ task });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Failed' }, { status: 500 });
  }
}

function parseInterval(value: string): number {
  const match = value.match(/^(\d+)(s|m|h|d)$/);
  if (!match) return 10 * 60 * 1000;
  const [, num, unit] = match;
  const multipliers: Record<string, number> = { s: 1000, m: 60000, h: 3600000, d: 86400000 };
  return parseInt(num) * (multipliers[unit] || 60000);
}

function getNextCronTime(expression: string): Date {
  // Simple cron parser for 5-field expressions: min hour dom month dow
  const parts = expression.trim().split(/\s+/);
  if (parts.length !== 5) return new Date(Date.now() + 3600000); // fallback 1h

  const now = new Date();
  // Try next 1440 minutes (24h) to find match
  for (let i = 1; i <= 1440; i++) {
    const candidate = new Date(now.getTime() + i * 60000);
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
    const [, step] = field.split('/');
    return value % parseInt(step) === 0;
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
