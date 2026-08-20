import { NextRequest, NextResponse } from 'next/server';
import { getDb, updateSdkSessionId } from '@/lib/db';
import { restoreCheckpoint } from '@/lib/file-checkpoint';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/chat/messages/edit — prepare the DB for re-sending an edited
 * *last* user message.
 *
 * This endpoint ONLY does the truncate half of "edit + resend". The caller
 * (ChatView.handleEditResend) issues a normal `sendMessage(newContent)`
 * afterwards, which re-inserts a fresh user row and starts a new stream —
 * so we deliberately do NOT touch `content` here.
 *
 * What it does, atomically enough for a single-writer SQLite:
 *   1. Resolve the *last real* user prompt (skips runtime-switch and
 *      image-gen sentinel rows, which render as non-bubbles in the UI).
 *   2. Restore file checkpoints to that message's pre-turn state (native
 *      runtime only — Claude Code SDK files are handled by the SDK's own
 *      rewind path; Codex is blocked in the UI, see below).
 *   3. Delete that row AND everything after it (rowid >= target), dropping
 *      the old user turn + its assistant reply.
 *   4. Clear `sdk_session_id` so Claude Code starts a FRESH SDK session on
 *      the next send and re-seeds context from the (now truncated) DB
 *      history instead of resuming the stale server-side transcript. This
 *      mirrors the auto-compaction invalidation in /api/chat/route.ts.
 *
 * Codex is intentionally NOT supported: its history lives server-side in the
 * app-server thread and `thread/start` does not replay DB history, so a
 * clean rollback isn't possible yet (tracked as Phase 2). The composer hides
 * the edit affordance under codex_runtime; this route stays defensive but
 * assumes the caller already gated it.
 */
export async function POST(request: NextRequest) {
  try {
    const { sessionId, expectedMessageId } = await request.json();

    if (!sessionId) {
      return NextResponse.json({ ok: false, error: 'sessionId is required' }, { status: 400 });
    }

    const db = getDb();

    // Last real user prompt: newest user row that isn't a UI-only sentinel.
    // `[` is a literal in SQLite LIKE (only % and _ are wildcards), so these
    // prefix filters match the exact sentinel shapes MessageItem hides.
    const target = db.prepare(
      `SELECT rowid, id, content FROM messages
       WHERE session_id = ? AND role = 'user'
         AND content NOT LIKE '[__RUNTIME_SWITCH__%'
         AND content NOT LIKE '[__IMAGE_GEN_NOTICE__%'
       ORDER BY rowid DESC LIMIT 1`
    ).get(sessionId) as { rowid: number; id: string; content: string } | undefined;

    if (!target) {
      return NextResponse.json({ ok: false, error: 'No editable user message found' }, { status: 404 });
    }

    // Guard against a race where the client's last-user bubble drifted from
    // the DB's. Only enforced when the client passed a real (persisted) id —
    // an optimistic `temp-*` id can't be verified, so we trust "last user".
    if (
      typeof expectedMessageId === 'string' &&
      expectedMessageId &&
      !expectedMessageId.startsWith('temp-') &&
      expectedMessageId !== target.id
    ) {
      return NextResponse.json(
        { ok: false, error: 'stale', message: 'Last user message changed — reload and retry' },
        { status: 409 },
      );
    }

    // Restore files to the target message's checkpoint (best-effort; returns
    // [] when no native checkpoint exists, e.g. Claude Code / Codex turns).
    const session = db.prepare(
      'SELECT working_directory, sdk_cwd FROM chat_sessions WHERE id = ?'
    ).get(sessionId) as { working_directory?: string; sdk_cwd?: string } | undefined;
    const cwd = session?.working_directory || session?.sdk_cwd || process.cwd();
    let filesChanged: string[] = [];
    try {
      filesChanged = restoreCheckpoint(sessionId, target.id, cwd);
    } catch (err) {
      console.warn('[messages/edit] checkpoint restore failed (continuing):', err);
    }

    // Drop the old user turn + its reply + anything after (inclusive).
    db.prepare(
      'DELETE FROM messages WHERE session_id = ? AND rowid >= ?'
    ).run(sessionId, target.rowid);

    // Force a fresh SDK session so the truncated DB history is authoritative.
    updateSdkSessionId(sessionId, '');

    return NextResponse.json({ ok: true, messageId: target.id, content: target.content, filesChanged });
  } catch (error) {
    console.error('[messages/edit] Failed to prepare edit:', error);
    return NextResponse.json({ ok: false, error: String(error) }, { status: 500 });
  }
}
