import { NextRequest, NextResponse } from 'next/server';
import { addMessage, updateMessageContent, getSession } from '@/lib/db';

export const runtime = 'nodejs';

/**
 * POST /api/chat/messages
 * Persist a message to the DB without triggering the model.
 * Used by image-gen mode to write user/assistant messages directly.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { session_id, role, content, token_usage } = body as {
      session_id: string;
      role: 'user' | 'assistant';
      content: string;
      token_usage?: string;
    };

    if (!session_id || !role || !content) {
      return NextResponse.json(
        { error: 'session_id, role, and content are required' },
        { status: 400 },
      );
    }

    const session = getSession(session_id);
    if (!session) {
      return NextResponse.json({ error: 'Session not found' }, { status: 404 });
    }

    const message = addMessage(session_id, role, content, token_usage ?? null);
    return NextResponse.json({ message });
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Failed to save message';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

/**
 * PUT /api/chat/messages
 * Update the content of an existing message.
 * Used to replace image-gen-request with image-gen-result after generation.
 */
export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    const { message_id, content } = body as {
      message_id: string;
      content: string;
    };

    if (!message_id || !content) {
      return NextResponse.json(
        { error: 'message_id and content are required' },
        { status: 400 },
      );
    }

    updateMessageContent(message_id, content);
    return NextResponse.json({ ok: true });
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Failed to update message';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
