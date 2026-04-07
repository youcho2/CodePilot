import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { restoreCheckpoint } from '@/lib/file-checkpoint';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/chat/rewind — Rewind conversation to a previous user message.
 *
 * Truncates messages in DB after the rewind point and restores file checkpoints.
 */
export async function POST(request: NextRequest) {
  try {
    const { sessionId, userMessageId, dryRun } = await request.json();

    if (!sessionId || !userMessageId) {
      return NextResponse.json({ error: 'sessionId and userMessageId are required' }, { status: 400 });
    }

    const db = getDb();
    const targetRow = db.prepare(
      'SELECT rowid FROM messages WHERE session_id = ? AND id = ?'
    ).get(sessionId, userMessageId) as { rowid: number } | undefined;

    if (!targetRow) {
      return NextResponse.json({ canRewind: false, error: 'Message not found' });
    }

    if (dryRun) {
      return NextResponse.json({ canRewind: true, filesChanged: [] });
    }

    // Delete all messages after the target message
    db.prepare(
      'DELETE FROM messages WHERE session_id = ? AND rowid > ?'
    ).run(sessionId, targetRow.rowid);

    // Restore files to checkpoint state
    const session = db.prepare(
      'SELECT working_directory, sdk_cwd FROM chat_sessions WHERE id = ?'
    ).get(sessionId) as { working_directory?: string; sdk_cwd?: string } | undefined;
    const cwd = session?.working_directory || session?.sdk_cwd || process.cwd();
    const filesChanged = restoreCheckpoint(sessionId, userMessageId, cwd);

    return NextResponse.json({ canRewind: true, filesChanged });
  } catch (error) {
    console.error('[rewind] Failed to rewind:', error);
    return NextResponse.json({ canRewind: false, error: String(error) });
  }
}
