import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { getSetting, getDefaultProviderId } from '@/lib/db';
import { loadState, saveState } from '@/lib/assistant-workspace';
import { generateTextFromProvider } from '@/lib/text-generator';

const CHECK_IN_QUESTIONS = [
  'assistant.checkInQ1',
  'assistant.checkInQ2',
  'assistant.checkInQ3',
];

const CHECK_IN_LABELS = [
  'What did you work on or accomplish today?',
  'Any changes to your current priorities or goals?',
  'Anything you\'d like me to remember going forward?',
];

export async function GET() {
  return NextResponse.json({
    questions: CHECK_IN_QUESTIONS.map((key, i) => ({
      key,
      label: CHECK_IN_LABELS[i],
      index: i + 1,
    })),
  });
}

export async function POST(request: NextRequest) {
  try {
    const workspacePath = getSetting('assistant_workspace_path');
    if (!workspacePath) {
      return NextResponse.json({ error: 'No workspace path configured' }, { status: 400 });
    }

    const body = await request.json();
    const { answers } = body as { answers: Record<string, string> };

    if (!answers || typeof answers !== 'object') {
      return NextResponse.json({ error: 'Invalid answers format' }, { status: 400 });
    }

    const qaText = CHECK_IN_LABELS.map((q, i) => {
      const key = `q${i + 1}`;
      return `Q: ${q}\nA: ${answers[key] || '(skipped)'}`;
    }).join('\n\n');

    const today = new Date().toISOString().slice(0, 10);

    // Read existing files for context
    const memoryPath = path.join(workspacePath, 'memory.md');
    const userPath = path.join(workspacePath, 'user.md');
    let existingMemory = '';
    let existingUser = '';
    try { existingMemory = fs.readFileSync(memoryPath, 'utf-8'); } catch { /* new file */ }
    try { existingUser = fs.readFileSync(userPath, 'utf-8'); } catch { /* new file */ }

    try {
      const providerId = getDefaultProviderId() || '';
      const model = getSetting('default_model') || 'claude-sonnet-4-20250514';

      const memoryPrompt = `You maintain a memory.md file for an AI assistant. Given the user's daily check-in answers and the existing memory file, generate an UPDATED memory.md. Add new facts, update changed information, remove outdated items. Keep it organized with markdown headers. Keep under 4000 characters.\n\nExisting memory.md:\n${existingMemory || '(empty)'}\n\nToday's check-in (${today}):\n${qaText}`;

      const userPrompt = `You maintain a user.md profile for an AI assistant. Given the user's daily check-in answers and the existing profile, generate an UPDATED user.md. Only update sections affected by today's answers. Keep it organized with markdown headers. Keep under 2000 characters.\n\nExisting user.md:\n${existingUser || '(empty)'}\n\nToday's check-in (${today}):\n${qaText}`;

      const [newMemory, newUser] = await Promise.all([
        generateTextFromProvider({ providerId, model, system: 'You maintain knowledge files for AI assistants. Output only the file content, no explanations.', prompt: memoryPrompt }),
        generateTextFromProvider({ providerId, model, system: 'You maintain user profile documents. Output only the file content, no explanations.', prompt: userPrompt }),
      ]);

      if (!newMemory.trim()) {
        throw new Error('AI returned empty memory content');
      }
      fs.writeFileSync(memoryPath, newMemory, 'utf-8');
      if (existingUser && newUser.trim()) {
        fs.writeFileSync(userPath, newUser, 'utf-8');
      }
    } catch (e) {
      console.warn('[workspace/checkin] AI generation failed, appending raw answers:', e);
      // Fallback: append raw answers to memory.md
      const appendText = `\n\n## Check-in ${today}\n${qaText}\n`;
      fs.appendFileSync(memoryPath, appendText, 'utf-8');
    }

    // Update state
    const state = loadState(workspacePath);
    state.lastCheckInDate = today;
    saveState(workspacePath, state);

    return NextResponse.json({ success: true });
  } catch (e) {
    console.error('[workspace/checkin] POST failed:', e);
    return NextResponse.json({ error: 'Check-in failed' }, { status: 500 });
  }
}
