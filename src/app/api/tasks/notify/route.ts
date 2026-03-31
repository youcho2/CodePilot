import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { title, body: notifBody, priority } = body as { title: string; body: string; priority?: string };

    if (!title) {
      return NextResponse.json({ error: 'Missing title' }, { status: 400 });
    }

    // Telegram notification for urgent priority
    if (priority === 'urgent') {
      try {
        const { notifyGeneric } = await import('@/lib/telegram-bot');
        await notifyGeneric(title, notifBody || '');
      } catch { /* best effort */ }
    }

    return NextResponse.json({ success: true });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Failed' }, { status: 500 });
  }
}
