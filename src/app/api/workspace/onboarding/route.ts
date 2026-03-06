import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { getSetting, getDefaultProviderId } from '@/lib/db';
import { loadState, saveState } from '@/lib/assistant-workspace';
import { generateTextFromProvider } from '@/lib/text-generator';

const QUESTIONS = [
  'assistant.onboardingQ1',
  'assistant.onboardingQ2',
  'assistant.onboardingQ3',
  'assistant.onboardingQ4',
  'assistant.onboardingQ5',
  'assistant.onboardingQ6',
  'assistant.onboardingQ7',
  'assistant.onboardingQ8',
  'assistant.onboardingQ9',
  'assistant.onboardingQ10',
];

const QUESTION_LABELS = [
  'How should I address you?',
  'What name should I use for myself?',
  'Do you prefer "concise and direct" or "detailed explanations"?',
  'Do you prefer "minimal interruptions" or "proactive suggestions"?',
  'What are your three hard boundaries?',
  'What are your three most important current goals?',
  'Do you prefer output as "lists", "reports", or "conversation summaries"?',
  'What information may be written to long-term memory?',
  'What information must never be written to long-term memory?',
  'What three things should I do first when entering a project?',
];

export async function GET() {
  return NextResponse.json({
    questions: QUESTIONS.map((key, i) => ({
      key,
      label: QUESTION_LABELS[i],
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

    // Build Q&A text for the prompt
    const qaText = QUESTION_LABELS.map((q, i) => {
      const key = `q${i + 1}`;
      return `Q: ${q}\nA: ${answers[key] || '(skipped)'}`;
    }).join('\n\n');

    let soulContent: string;
    let userContent: string;

    try {
      const providerId = getDefaultProviderId() || '';
      const model = getSetting('default_model') || 'claude-sonnet-4-20250514';

      const soulPrompt = `Based on the following user onboarding answers, generate a concise "soul.md" file that defines an AI assistant's personality, communication style, and behavioral rules. Write in second person ("You are..."). Keep it under 2000 characters. Use markdown headers and bullet points.\n\n${qaText}`;

      const userPrompt = `Based on the following user onboarding answers, generate a concise "user.md" profile that captures the user's preferences, goals, and boundaries. Write in third person. Keep it under 2000 characters. Use markdown headers and bullet points.\n\n${qaText}`;

      [soulContent, userContent] = await Promise.all([
        generateTextFromProvider({ providerId, model, system: 'You generate configuration files for AI assistants. Output only the file content, no explanations.', prompt: soulPrompt }),
        generateTextFromProvider({ providerId, model, system: 'You generate user profile documents. Output only the file content, no explanations.', prompt: userPrompt }),
      ]);
      // Fallback if AI returned empty
      if (!soulContent.trim() || !userContent.trim()) {
        throw new Error('AI returned empty content');
      }
    } catch (e) {
      console.warn('[workspace/onboarding] AI generation failed, using raw answers:', e);
      // Fallback: write raw answers
      soulContent = `# Soul\n\n## Communication Style\n- Address user as: ${answers.q1 || 'not specified'}\n- Assistant name: ${answers.q2 || 'not specified'}\n- Style: ${answers.q3 || 'not specified'}\n- Approach: ${answers.q4 || 'not specified'}\n`;
      userContent = `# User Profile\n\n## Preferences\n- Boundaries: ${answers.q5 || 'not specified'}\n- Goals: ${answers.q6 || 'not specified'}\n- Output format: ${answers.q7 || 'not specified'}\n- Memory allowed: ${answers.q8 || 'not specified'}\n- Memory forbidden: ${answers.q9 || 'not specified'}\n- Project entry: ${answers.q10 || 'not specified'}\n`;
    }

    // Write files
    fs.writeFileSync(path.join(workspacePath, 'soul.md'), soulContent, 'utf-8');
    fs.writeFileSync(path.join(workspacePath, 'user.md'), userContent, 'utf-8');

    // Update state
    const today = new Date().toISOString().slice(0, 10);
    const state = loadState(workspacePath);
    state.onboardingComplete = true;
    state.lastCheckInDate = today; // Skip daily check-in on the day of onboarding
    saveState(workspacePath, state);

    return NextResponse.json({ success: true });
  } catch (e) {
    console.error('[workspace/onboarding] POST failed:', e);
    return NextResponse.json({ error: 'Onboarding failed' }, { status: 500 });
  }
}
