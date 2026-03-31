import { NextResponse } from 'next/server';

/**
 * POST /api/workspace/hatch-buddy
 *
 * Generate a buddy for an existing assistant workspace that doesn't have one.
 * Uses workspace path + current timestamp as seed for deterministic generation.
 */
export async function POST() {
  try {
    const { getSetting } = await import('@/lib/db');
    const workspacePath = getSetting('assistant_workspace_path');
    if (!workspacePath) {
      return NextResponse.json({ error: 'No workspace configured' }, { status: 400 });
    }

    const fs = await import('fs');
    const path = await import('path');
    const { loadState, saveState } = await import('@/lib/assistant-workspace');
    const { generateBuddy, getPeakStatHint } = await import('@/lib/buddy');

    const state = loadState(workspacePath);

    // Don't regenerate if buddy already exists
    if (state.buddy) {
      return NextResponse.json({ buddy: state.buddy, alreadyHatched: true });
    }

    // Generate buddy
    const seed = workspacePath + ':' + new Date().toISOString();
    const buddy = generateBuddy(seed);

    // Save to state
    state.buddy = buddy;
    saveState(workspacePath, state);

    // Append peak stat personality hint to soul.md
    const soulVariants = ['soul.md', 'Soul.md', 'SOUL.md'];
    for (const variant of soulVariants) {
      const soulPath = path.join(workspacePath, variant);
      if (fs.existsSync(soulPath)) {
        const existingSoul = fs.readFileSync(soulPath, 'utf-8');
        if (!existingSoul.includes('## Buddy Trait')) {
          const hint = getPeakStatHint(buddy.peakStat as Parameters<typeof getPeakStatHint>[0]);
          fs.appendFileSync(soulPath, `\n\n## Buddy Trait\n${hint}\n`, 'utf-8');
        }
        break;
      }
    }

    return NextResponse.json({ buddy, alreadyHatched: false });
  } catch (e) {
    console.error('[workspace/hatch-buddy] POST failed:', e);
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Failed' }, { status: 500 });
  }
}
