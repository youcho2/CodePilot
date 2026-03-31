import { NextResponse } from 'next/server';

/**
 * POST /api/workspace/hatch-buddy
 *
 * Generate a buddy for an existing assistant workspace that doesn't have one.
 * Uses workspace path + current timestamp as seed for deterministic generation.
 */
export async function POST(request: Request) {
  try {
    const { getSetting } = await import('@/lib/db');
    const workspacePath = getSetting('assistant_workspace_path');
    if (!workspacePath) {
      return NextResponse.json({ error: 'No workspace configured' }, { status: 400 });
    }

    const body = await request.json().catch(() => ({}));
    const { buddyName } = body as { buddyName?: string };

    const fs = await import('fs');
    const path = await import('path');
    const { loadState, saveState } = await import('@/lib/assistant-workspace');
    const { generateBuddy, getPeakStatHint } = await import('@/lib/buddy');

    const state = loadState(workspacePath);

    // If buddy already exists, update name if provided
    if (state.buddy) {
      if (buddyName) {
        state.buddy.buddyName = buddyName;
        saveState(workspacePath, state);
      }
      return NextResponse.json({ buddy: state.buddy, alreadyHatched: true });
    }

    // Generate buddy
    const seed = workspacePath + ':' + new Date().toISOString();
    const buddy = generateBuddy(seed);

    // Set buddy name if provided
    if (buddyName) buddy.buddyName = buddyName;

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

    // Insert celebration message with show-widget card into chat
    try {
      const { addMessage, getLatestSessionByWorkingDirectory } = await import('@/lib/db');
      const { SPECIES_LABEL, RARITY_DISPLAY, STAT_LABEL, getBuddyTitle, rarityColor: getRarityColorClass } = await import('@/lib/buddy');
      const session = getLatestSessionByWorkingDirectory(workspacePath);
      if (session) {
        const speciesName = SPECIES_LABEL[buddy.species as keyof typeof SPECIES_LABEL]?.zh || buddy.species;
        const rarityInfo = RARITY_DISPLAY[buddy.rarity as keyof typeof RARITY_DISPLAY];
        const title = getBuddyTitle(buddy as Parameters<typeof getBuddyTitle>[0]);
        const buddyDisplayName = buddy.buddyName || speciesName;

        // Build stat bars HTML for the widget
        const statEntries = Object.entries(buddy.stats) as [string, number][];
        const statBarsHtml = statEntries.map(([stat, val]) => {
          const label = STAT_LABEL[stat as keyof typeof STAT_LABEL]?.zh || stat;
          const isPeak = stat === buddy.peakStat;
          const barColor = isPeak ? '#6C5CE7' : '#ccc';
          return `<div style="display:flex;align-items:center;gap:8px;margin:4px 0"><span style="width:32px;font-size:11px;color:#888">${label}</span><div style="flex:1;height:6px;border-radius:3px;background:#eee;overflow:hidden"><div style="height:100%;border-radius:3px;background:${barColor};width:${val}%"></div></div><span style="width:24px;text-align:right;font-size:11px;color:#888">${val}</span></div>`;
        }).join('');

        // Rarity color
        const rarityColorMap: Record<string, string> = { common: '#888', uncommon: '#22c55e', rare: '#3b82f6', epic: '#a855f7', legendary: '#f59e0b' };
        const rarityHexColor = rarityColorMap[buddy.rarity] || '#888';
        const rarityBorder = buddy.rarity === 'legendary' ? 'border:2px solid #f59e0b;box-shadow:0 0 12px rgba(245,158,11,0.3)' : `border:1px solid ${rarityHexColor}33`;

        // Widget HTML
        const widgetHtml = `<div style="text-align:center;padding:24px 16px;font-family:system-ui;${rarityBorder};border-radius:12px"><div style="font-size:56px;margin-bottom:8px">${buddy.emoji}</div><div style="font-size:18px;font-weight:600">${buddyDisplayName}</div>${title ? `<div style="font-size:12px;color:#888;margin-top:2px">"${title}"</div>` : ''}<div style="font-size:12px;color:${rarityHexColor};font-weight:500;margin:4px 0">${rarityInfo?.stars || ''} ${rarityInfo?.label.zh || buddy.rarity} · ${speciesName}</div><div style="max-width:240px;margin:16px auto 0">${statBarsHtml}</div></div>`;

        const widgetJson = JSON.stringify({ title: 'buddy_reveal', widget_code: widgetHtml });
        const message = `🎉 **孵化成功！**\n\n你的助理伙伴诞生了！来认识一下吧：\n\n\`\`\`show-widget\n${widgetJson}\n\`\`\`\n\n${buddy.emoji} **${buddyDisplayName}** 是一只${title ? `"${title}"的` : ''}${speciesName}，稀有度为 ${rarityInfo?.stars || ''} ${rarityInfo?.label.zh || buddy.rarity}。\n\n从现在开始，${buddyDisplayName} 将作为你的助理伙伴，陪伴你的每一次对话。随着你们互动越多，它还会成长和进化哦！`;

        addMessage(session.id, 'assistant', message);
      }
    } catch { /* best effort */ }

    return NextResponse.json({ buddy, alreadyHatched: false });
  } catch (e) {
    console.error('[workspace/hatch-buddy] POST failed:', e);
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Failed' }, { status: 500 });
  }
}
