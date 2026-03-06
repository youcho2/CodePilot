import { NextRequest, NextResponse } from 'next/server';
import { getSetting } from '@/lib/db';
import { getLatestSessionByWorkingDirectory, createSession } from '@/lib/db';

export async function POST(request: NextRequest) {
  try {
    const workspacePath = getSetting('assistant_workspace_path');
    if (!workspacePath) {
      return NextResponse.json({ error: 'No workspace path configured' }, { status: 400 });
    }

    const body = await request.json().catch(() => ({}));
    const { mode } = body as { mode?: 'onboarding' | 'checkin' };

    // For onboarding: always create new session
    // For checkin: reuse latest session if exists
    let session;
    if (mode === 'checkin') {
      session = getLatestSessionByWorkingDirectory(workspacePath);
    }

    if (!session) {
      const model = typeof body.model === 'string' ? body.model : '';
      const provider_id = typeof body.provider_id === 'string' ? body.provider_id : '';
      session = createSession(undefined, model, undefined, workspacePath, 'code', provider_id);
    }

    return NextResponse.json({ session, isNew: !session.sdk_session_id });
  } catch (e) {
    console.error('[workspace/session] POST failed:', e);
    return NextResponse.json({ error: 'Failed to create/find session' }, { status: 500 });
  }
}
