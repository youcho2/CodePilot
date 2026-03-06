import { NextResponse } from 'next/server';
import { getSetting } from '@/lib/db';
import { generateDirectoryDocs } from '@/lib/assistant-workspace';

export async function POST() {
  try {
    const workspacePath = getSetting('assistant_workspace_path');
    if (!workspacePath) {
      return NextResponse.json(
        { error: 'No assistant workspace path configured' },
        { status: 400 },
      );
    }

    const files = generateDirectoryDocs(workspacePath);
    return NextResponse.json({ files });
  } catch (e) {
    console.error('[workspace/docs] Failed to generate directory docs:', e);
    return NextResponse.json(
      { error: 'Failed to generate directory docs' },
      { status: 500 },
    );
  }
}
