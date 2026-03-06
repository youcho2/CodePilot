import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import { getSetting, setSetting } from '@/lib/db';
import { validateWorkspace, initializeWorkspace, loadState } from '@/lib/assistant-workspace';

export async function GET() {
  try {
    const workspacePath = getSetting('assistant_workspace_path');
    if (!workspacePath) {
      return NextResponse.json({ path: null, files: {}, state: null });
    }

    const validation = validateWorkspace(workspacePath);
    const state = loadState(workspacePath);

    // Build file status with preview
    const fileStatus: Record<string, { exists: boolean; chars: number; preview: string }> = {};
    for (const [key, info] of Object.entries(validation.files)) {
      let preview = '';
      if (info.exists && info.path) {
        try {
          const content = fs.readFileSync(info.path, 'utf-8');
          preview = content.split('\n').slice(0, 3).join('\n');
        } catch { /* ignore */ }
      }
      fileStatus[key] = {
        exists: info.exists,
        chars: info.size,
        preview,
      };
    }

    return NextResponse.json({
      path: workspacePath,
      exists: validation.exists,
      files: fileStatus,
      state,
    });
  } catch (e) {
    console.error('[settings/workspace] GET failed:', e);
    return NextResponse.json({ error: 'Failed to load workspace info' }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    const { path: workspacePath, initialize } = body as { path: string; initialize?: boolean };

    if (!workspacePath || typeof workspacePath !== 'string') {
      return NextResponse.json({ error: 'Invalid workspace path' }, { status: 400 });
    }

    setSetting('assistant_workspace_path', workspacePath);

    let createdFiles: string[] = [];
    if (initialize) {
      createdFiles = initializeWorkspace(workspacePath);
    }

    return NextResponse.json({ success: true, createdFiles });
  } catch (e) {
    console.error('[settings/workspace] PUT failed:', e);
    return NextResponse.json({ error: 'Failed to save workspace settings' }, { status: 500 });
  }
}
