import { useMemo } from 'react';
import type { Message } from '@/types';
import { getContextWindow } from '@/lib/model-context';

export interface ContextUsageData {
  modelName: string;
  contextWindow: number | null;
  /** Actual token usage from the last API response */
  used: number;
  /** Ratio of actual usage to context window */
  ratio: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  outputTokens: number;
  hasData: boolean;
  /** Warning state based on the higher of actual/estimated ratio */
  state: 'normal' | 'warning' | 'critical';
  /** Whether a session summary (compression) is active */
  hasSummary: boolean;
}

export function useContextUsage(
  messages: Message[],
  modelName: string,
  options?: { context1m?: boolean; hasSummary?: boolean },
): ContextUsageData {
  return useMemo(() => {
    const contextWindow = getContextWindow(modelName, { context1m: options?.context1m });
    const noData: ContextUsageData = {
      modelName,
      contextWindow,
      used: 0,
      ratio: 0,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
      outputTokens: 0,
      hasData: false,
      state: 'normal',
      hasSummary: options?.hasSummary || false,
    };

    // Find the last assistant message with token_usage
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i];
      if (msg.role !== 'assistant' || !msg.token_usage) continue;

      try {
        const usage = typeof msg.token_usage === 'string'
          ? JSON.parse(msg.token_usage)
          : msg.token_usage;

        const inputTokens = usage.input_tokens || 0;
        const cacheRead = usage.cache_read_input_tokens || 0;
        const cacheCreation = usage.cache_creation_input_tokens || 0;
        const outputTokens = usage.output_tokens || 0;
        const used = inputTokens + cacheRead + cacheCreation;
        const ratio = contextWindow ? used / contextWindow : 0;

        let state: 'normal' | 'warning' | 'critical' = 'normal';
        if (ratio >= 0.95) state = 'critical';
        else if (ratio >= 0.8) state = 'warning';

        return {
          modelName,
          contextWindow,
          used,
          ratio,
          cacheReadTokens: cacheRead,
          cacheCreationTokens: cacheCreation,
          outputTokens,
          hasData: true,
          state,
          hasSummary: options?.hasSummary || false,
        };
      } catch {
        continue;
      }
    }

    return noData;
  }, [messages, modelName, options?.context1m, options?.hasSummary]);
}
