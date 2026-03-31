/**
 * Notification Manager — unified multi-channel notification dispatch.
 *
 * Three channels by priority:
 * - low: Toast only (in-app, non-intrusive)
 * - normal: Toast + Electron system notification
 * - urgent: Toast + Electron system notification + Telegram (if configured)
 */

/**
 * Send a notification through appropriate channels based on priority.
 *
 * Note: This runs in the Next.js server process. Toast and Electron notifications
 * are dispatched via API response / IPC. Telegram is called directly.
 */
export async function sendNotification(opts: {
  title: string;
  body: string;
  priority: 'low' | 'normal' | 'urgent';
  action?: { type: string; payload: string };
}): Promise<{ sent: string[] }> {
  const sent: string[] = [];

  // Channel 1: In-app notification is handled by the API caller
  // (the notify API returns the notification data, frontend shows Toast)
  sent.push('api_response');

  // Channel 2: Telegram for urgent (direct server-side call)
  if (opts.priority === 'urgent') {
    try {
      const { notifyGeneric } = await import('@/lib/telegram-bot');
      await notifyGeneric(opts.title, opts.body);
      sent.push('telegram');
    } catch {
      // Best effort — Telegram may not be configured
    }
  }

  return { sent };
}

/**
 * Format a notification for display.
 */
export function formatNotification(title: string, body: string): string {
  return body ? `${title}: ${body}` : title;
}
