import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/chat/interrupt — Interrupt an active agent-loop session.
 *
 * Uses the native runtime's AbortController-based interrupt.
 */
export async function POST(request: NextRequest) {
  try {
    const { sessionId } = await request.json();

    if (!sessionId) {
      return NextResponse.json({ error: 'sessionId is required' }, { status: 400 });
    }

    const { getRuntime } = await import('@/lib/runtime');
    const nativeRt = getRuntime('native');
    if (nativeRt) {
      nativeRt.interrupt(sessionId);
    }

    return NextResponse.json({ interrupted: true });
  } catch (error) {
    console.error('[interrupt] Failed to interrupt:', error);
    return NextResponse.json({ interrupted: false, error: String(error) });
  }
}
