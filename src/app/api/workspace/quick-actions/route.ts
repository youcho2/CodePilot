import { NextResponse } from 'next/server';

export async function GET() {
  try {
    const { getSetting } = await import('@/lib/db');
    const workspacePath = getSetting('assistant_workspace_path');

    if (!workspacePath) {
      return NextResponse.json({ actions: [] });
    }

    const fs = await import('fs');
    const path = await import('path');
    const { loadDailyMemories } = await import('@/lib/assistant-workspace');

    const actions: string[] = [];

    // 1. Extract unchecked TODOs from recent daily memories
    try {
      const dailyMemories = loadDailyMemories(workspacePath, 3);
      for (const daily of dailyMemories) {
        const todos = daily.content.match(/- \[ \] (.+)/g);
        if (todos) {
          for (const todo of todos.slice(0, 2)) {
            const item = todo.replace('- [ ] ', '').trim();
            if (item.length > 5 && item.length < 60) {
              actions.push(item);
            }
          }
        }
      }
    } catch { /* skip */ }

    // 2. Extract goals from user.md
    try {
      const userVariants = ['user.md', 'User.md', 'USER.md'];
      for (const variant of userVariants) {
        const userPath = path.join(workspacePath, variant);
        if (fs.existsSync(userPath)) {
          const content = fs.readFileSync(userPath, 'utf-8');
          const goalMatch = content.match(/## (?:Current Goals|当前目标)\n([\s\S]*?)(?=\n##|$)/);
          if (goalMatch) {
            const firstGoal = goalMatch[1].trim().split('\n')[0]?.replace(/^[-*] /, '').trim();
            if (firstGoal && firstGoal.length > 3 && firstGoal.length < 60) {
              actions.push(firstGoal);
            }
          }
          break;
        }
      }
    } catch { /* skip */ }

    // 3. Add a locale-agnostic "review this week" action
    // Frontend resolves the display text via i18n key 'assistant.quickActions.reviewWeek'
    actions.push('__review_week__');

    // Deduplicate and limit to 3
    const unique = [...new Set(actions)].slice(0, 3);

    return NextResponse.json({ actions: unique });
  } catch (e) {
    console.error('[workspace/quick-actions] GET failed:', e);
    return NextResponse.json({ actions: [] });
  }
}
