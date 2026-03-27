import { NextResponse } from 'next/server';
import { CLI_TOOLS_CATALOG, EXTRA_WELL_KNOWN_BINS } from '@/lib/cli-tools-catalog';
import { generateTextViaSdk } from '@/lib/claude-client';
import { upsertCliToolDescription, getCustomCliTool } from '@/lib/db';

/**
 * Try to extract a JSON object from text that may be wrapped in markdown code blocks
 * or contain leading/trailing non-JSON content.
 */
function extractJson(raw: string): Record<string, unknown> {
  const trimmed = raw.trim();
  try { return JSON.parse(trimmed); } catch { /* continue */ }

  const fenceMatch = trimmed.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  if (fenceMatch) {
    try { return JSON.parse(fenceMatch[1].trim()); } catch { /* continue */ }
  }

  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start !== -1 && end > start) {
    try { return JSON.parse(trimmed.slice(start, end + 1)); } catch { /* continue */ }
  }

  throw new Error('AI response was not valid JSON');
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const catalogTool = CLI_TOOLS_CATALOG.find(t => t.id === id);
  const extraEntry = !catalogTool ? EXTRA_WELL_KNOWN_BINS.find(([eid]) => eid === id) : null;
  const customTool = !catalogTool && !extraEntry ? getCustomCliTool(id) : null;

  if (!catalogTool && !extraEntry && !customTool) {
    return NextResponse.json({ error: 'Tool not found' }, { status: 404 });
  }

  if (catalogTool && !catalogTool.supportsAutoDescribe) {
    return NextResponse.json(
      { error: 'Auto-describe not supported for this tool' },
      { status: 400 }
    );
  }

  try {
    const body = await request.json();
    const { providerId, model: requestModel } = body as { providerId?: string; model?: string };

    const toolName = catalogTool?.name ?? extraEntry?.[1] ?? customTool?.name ?? id;
    const binNames = catalogTool?.binNames.join(', ') ?? extraEntry?.[2] ?? customTool?.binName ?? id;
    const categories = catalogTool?.categories.join(', ') ?? 'general';
    const homepage = catalogTool?.homepage ?? 'N/A';

    const prompt = `You are a technical writer. Write a comprehensive, practical description of the CLI tool "${toolName}" (binary: ${binNames}).
Categories: ${categories}
Homepage: ${homepage}

Provide the description in both Chinese and English with the following structure:

1. intro: A brief introduction (2-3 sentences) explaining what the tool does
2. useCases: 3-5 practical use cases (short phrases)
3. guideSteps: 2-3 quick start steps
4. examplePrompts: 2-3 example prompts a user might say to an AI assistant to use this tool (each with a short label)

Respond in this exact JSON format (no markdown, no code fences, just raw JSON):
{
  "intro": { "zh": "中文简介", "en": "English intro" },
  "useCases": { "zh": ["用例1", "用例2", "用例3"], "en": ["Use case 1", "Use case 2", "Use case 3"] },
  "guideSteps": { "zh": ["步骤1", "步骤2"], "en": ["Step 1", "Step 2"] },
  "examplePrompts": [
    { "label": "Short label", "promptZh": "中文提示词", "promptEn": "English prompt" }
  ]
}`;

    let result: string;
    try {
      result = await generateTextViaSdk({
        providerId: providerId || undefined,
        model: requestModel || undefined,
        system: 'You are a technical documentation writer. Respond with raw JSON only, no markdown formatting.',
        prompt,
      });
    } catch (genError) {
      console.error(`[cli-tools/${id}/describe] generateTextViaSdk threw:`, genError);
      const msg = genError instanceof Error ? genError.message : 'Text generation failed';
      return NextResponse.json({ error: msg }, { status: 502 });
    }

    if (!result || !result.trim()) {
      return NextResponse.json(
        { error: 'AI returned an empty response. Please check your provider configuration.' },
        { status: 502 }
      );
    }

    const parsed = extractJson(result);

    // Extract and validate structured data — normalize to safe shapes
    const intro = parsed.intro as { zh?: string; en?: string } | undefined;
    if (!intro?.zh || !intro?.en) {
      return NextResponse.json(
        { error: 'AI response missing required intro fields' },
        { status: 502 }
      );
    }

    // Normalize arrays: ensure useCases, guideSteps are string arrays, examplePrompts is shaped correctly
    const rawUseCases = parsed.useCases as { zh?: unknown; en?: unknown } | undefined;
    const useCases = {
      zh: Array.isArray(rawUseCases?.zh) ? (rawUseCases.zh as unknown[]).filter((x): x is string => typeof x === 'string') : [],
      en: Array.isArray(rawUseCases?.en) ? (rawUseCases.en as unknown[]).filter((x): x is string => typeof x === 'string') : [],
    };

    const rawGuideSteps = parsed.guideSteps as { zh?: unknown; en?: unknown } | undefined;
    const guideSteps = {
      zh: Array.isArray(rawGuideSteps?.zh) ? (rawGuideSteps.zh as unknown[]).filter((x): x is string => typeof x === 'string') : [],
      en: Array.isArray(rawGuideSteps?.en) ? (rawGuideSteps.en as unknown[]).filter((x): x is string => typeof x === 'string') : [],
    };

    const rawPrompts = parsed.examplePrompts as unknown[] | undefined;
    const examplePrompts = Array.isArray(rawPrompts)
      ? rawPrompts
          .filter((p): p is Record<string, string> => typeof p === 'object' && p !== null && typeof (p as Record<string, string>).label === 'string')
          .map(p => ({ label: p.label, promptZh: p.promptZh || '', promptEn: p.promptEn || '' }))
      : [];

    const normalized = { intro: { zh: intro.zh, en: intro.en }, useCases, guideSteps, examplePrompts };

    // Build short summary from intro for card display
    const summaryZh = intro.zh;
    const summaryEn = intro.en;

    // Persist normalized structured description to database
    const structuredJson = JSON.stringify(normalized);
    upsertCliToolDescription(id, summaryZh, summaryEn, structuredJson);

    return NextResponse.json({
      description: { zh: summaryZh, en: summaryEn, structured: normalized },
    });
  } catch (error) {
    console.error(`[cli-tools/${id}/describe] Error:`, error);
    const message = error instanceof Error ? error.message : 'Description generation failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
