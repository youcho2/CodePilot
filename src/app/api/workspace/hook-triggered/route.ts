import { NextRequest, NextResponse } from 'next/server';
import { getSetting } from '@/lib/db';
import { loadState, saveState } from '@/lib/assistant-workspace';

export async function POST(request: NextRequest) {
  try {
    const workspacePath = getSetting('assistant_workspace_path');
    if (!workspacePath) {
      return NextResponse.json({ error: 'No workspace path configured' }, { status: 400 });
    }
    const { sessionId } = await request.json();
    const state = loadState(workspacePath);
    // '__clear__' sentinel clears the field (used after onboarding/checkin completes)
    state.hookTriggeredSessionId = sessionId === '__clear__' ? undefined : sessionId;
    saveState(workspacePath, state);
    return NextResponse.json({ success: true });
  } catch (e) {
    console.error('[workspace/hook-triggered] POST failed:', e);
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}
