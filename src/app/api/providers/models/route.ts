import { NextResponse } from 'next/server';
import { getActiveProvider } from '@/lib/db';
import type { ErrorResponse } from '@/types';

// Default Claude model options
const DEFAULT_MODELS = [
  { value: 'sonnet', label: 'Sonnet 4.6' },
  { value: 'opus', label: 'Opus 4.6' },
  { value: 'haiku', label: 'Haiku 4.5' },
];

// Provider-specific model label mappings (base_url -> alias -> display name)
const PROVIDER_MODEL_LABELS: Record<string, { value: string; label: string }[]> = {
  'https://api.z.ai/api/anthropic': [
    { value: 'sonnet', label: 'GLM-4.7' },
    { value: 'opus', label: 'GLM-4.7' },
    { value: 'haiku', label: 'GLM-4.5-Air' },
  ],
  'https://open.bigmodel.cn/api/anthropic': [
    { value: 'sonnet', label: 'GLM-4.7' },
    { value: 'opus', label: 'GLM-4.7' },
    { value: 'haiku', label: 'GLM-4.5-Air' },
  ],
  'https://api.kimi.com/coding/': [
    { value: 'sonnet', label: 'Kimi K2.5' },
    { value: 'opus', label: 'Kimi K2.5' },
    { value: 'haiku', label: 'Kimi K2.5' },
  ],
  'https://api.moonshot.ai/anthropic': [
    { value: 'sonnet', label: 'Kimi K2.5' },
    { value: 'opus', label: 'Kimi K2.5' },
    { value: 'haiku', label: 'Kimi K2.5' },
  ],
  'https://api.moonshot.cn/anthropic': [
    { value: 'sonnet', label: 'Kimi K2.5' },
    { value: 'opus', label: 'Kimi K2.5' },
    { value: 'haiku', label: 'Kimi K2.5' },
  ],
  'https://api.minimaxi.com/anthropic': [
    { value: 'sonnet', label: 'MiniMax-M2.1' },
    { value: 'opus', label: 'MiniMax-M2.1' },
    { value: 'haiku', label: 'MiniMax-M2.1' },
  ],
  'https://api.minimax.io/anthropic': [
    { value: 'sonnet', label: 'MiniMax-M2.1' },
    { value: 'opus', label: 'MiniMax-M2.1' },
    { value: 'haiku', label: 'MiniMax-M2.1' },
  ],
  'https://openrouter.ai/api': [
    { value: 'sonnet', label: 'Sonnet 4.6' },
    { value: 'opus', label: 'Opus 4.6' },
    { value: 'haiku', label: 'Haiku 4.5' },
  ],
};

export async function GET() {
  try {
    const activeProvider = getActiveProvider();

    // No active provider or anthropic type -> default Claude models
    if (!activeProvider || activeProvider.provider_type === 'anthropic') {
      return NextResponse.json({
        models: DEFAULT_MODELS,
        provider_name: activeProvider?.name || 'Anthropic',
      });
    }

    // Custom/other provider -> match by base_url
    const matched = PROVIDER_MODEL_LABELS[activeProvider.base_url];
    if (matched) {
      return NextResponse.json({
        models: matched,
        provider_name: activeProvider.name,
      });
    }

    // Unknown provider -> return defaults with provider name
    return NextResponse.json({
      models: DEFAULT_MODELS,
      provider_name: activeProvider.name,
    });
  } catch (error) {
    return NextResponse.json<ErrorResponse>(
      { error: error instanceof Error ? error.message : 'Failed to get models' },
      { status: 500 }
    );
  }
}
