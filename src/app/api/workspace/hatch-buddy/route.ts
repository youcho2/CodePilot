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

    // Insert celebration message into chat
    try {
      const { addMessage, getLatestSessionByWorkingDirectory } = await import('@/lib/db');
      const { SPECIES_LABEL, RARITY_DISPLAY, STAT_LABEL } = await import('@/lib/buddy');
      const session = getLatestSessionByWorkingDirectory(workspacePath);
      if (session) {
        const speciesName = SPECIES_LABEL[buddy.species as keyof typeof SPECIES_LABEL]?.zh || buddy.species;
        const rarityInfo = RARITY_DISPLAY[buddy.rarity as keyof typeof RARITY_DISPLAY];
        const statsText = Object.entries(buddy.stats)
          .map(([stat, val]) => `${STAT_LABEL[stat as keyof typeof STAT_LABEL]?.zh || stat}: ${val}`)
          .join(' \u00B7 ');

        const message = `\uD83C\uDF89 **\u4F60\u7684\u52A9\u7406\u4F19\u4F34\u5B75\u5316\u4E86\uFF01**\n\n${buddy.emoji} **${speciesName}** ${rarityInfo?.stars || ''} ${rarityInfo?.label.zh || buddy.rarity}\n\n${statsText}\n\n\u4ECE\u73B0\u5728\u5F00\u59CB\uFF0C\u8FD9\u4E2A ${speciesName} \u5C06\u4F5C\u4E3A\u4F60\u7684\u52A9\u7406\u4F19\u4F34\uFF0C\u966A\u4F34\u4F60\u7684\u6BCF\u4E00\u6B21\u5BF9\u8BDD\u3002`;

        addMessage(session.id, 'assistant', message);
      }
    } catch { /* best effort */ }

    return NextResponse.json({ buddy, alreadyHatched: false });
  } catch (e) {
    console.error('[workspace/hatch-buddy] POST failed:', e);
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Failed' }, { status: 500 });
  }
}
