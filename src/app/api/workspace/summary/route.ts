import { NextResponse } from 'next/server';

export async function GET() {
  try {
    const { getSetting } = await import('@/lib/db');
    const workspacePath = getSetting('assistant_workspace_path');

    if (!workspacePath) {
      return NextResponse.json({ configured: false });
    }

    const fs = await import('fs');
    const path = await import('path');
    const { loadState } = await import('@/lib/assistant-workspace');

    // Check path exists
    if (!fs.existsSync(workspacePath)) {
      return NextResponse.json({ configured: false });
    }

    const state = loadState(workspacePath);

    // Extract assistant name from soul.md
    let assistantName = '';
    const soulVariants = ['soul.md', 'Soul.md', 'SOUL.md'];
    for (const variant of soulVariants) {
      const soulPath = path.join(workspacePath, variant);
      if (fs.existsSync(soulPath)) {
        const content = fs.readFileSync(soulPath, 'utf-8');
        // Look for "My name is XXX" or "name is XXX" pattern
        const nameMatch = content.match(/(?:My name is|name is|名字是|叫)\s+([^.\n,]+)/i);
        if (nameMatch) {
          assistantName = nameMatch[1].trim().replace(/[.。]$/, '');
        }
        break;
      }
    }

    // Count memory files
    let memoryCount = 0;
    const dailyDir = path.join(workspacePath, 'memory', 'daily');
    if (fs.existsSync(dailyDir)) {
      memoryCount = fs.readdirSync(dailyDir).filter(f => f.endsWith('.md')).length;
    }
    // Count memory.md as 1
    const memoryVariants = ['memory.md', 'Memory.md', 'MEMORY.md'];
    for (const v of memoryVariants) {
      if (fs.existsSync(path.join(workspacePath, v))) {
        memoryCount++;
        break;
      }
    }

    return NextResponse.json({
      configured: true,
      name: assistantName || '',
      onboardingComplete: state.onboardingComplete,
      lastHeartbeatDate: state.lastHeartbeatDate,
      heartbeatEnabled: state.heartbeatEnabled,
      memoryCount,
    });
  } catch (e) {
    console.error('[workspace/summary] GET failed:', e);
    return NextResponse.json({ configured: false });
  }
}
