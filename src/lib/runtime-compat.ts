/**
 * Runtime Compatibility Matrix — single source of truth.
 *
 * Every consumer (Provider Card badges, Models page filter+badges, chat
 * picker, provider-resolver) must call into here so the labels and gates
 * stay consistent. The matrix has two layers:
 *
 *   - Provider layer: one of `ProviderRuntimeCompat` per provider record.
 *   - Model layer: a bag of capability flags per `ModelRuntimeCompat`.
 *
 * Heuristics (deliberately simple — explicit list rather than inference):
 *   image-image protocols                          → media_only
 *   anthropic-official / bedrock / vertex preset   → claude_code_ready
 *   anthropic protocol + meta.claudeCodeVerified   → claude_code_verified
 *   anthropic protocol w/ any other preset         → claude_code_experimental
 *   openrouter Anthropic Skin (no /v1)             → openrouter_anthropic_skin
 *   openrouter OpenAI Skin (/v1) / openai-compat / google chat → codepilot_only
 *   no matched preset                              → unknown
 */
import type { ApiProvider, ProviderRuntimeCompat, ModelRuntimeCompat } from '@/types';
import { findMatchingPresetForRecord, type VendorPreset } from '@/lib/provider-catalog';

export interface ProviderCompatRecord {
  provider_type: string;
  base_url: string;
}

const CLAUDE_CODE_READY_PRESETS = new Set(['anthropic-official', 'bedrock', 'vertex']);

/**
 * OpenRouter exposes two HTTP "skins" off the same domain:
 *   - `https://openrouter.ai/api`      — Anthropic-compatible (`/v1/messages`),
 *                                        the path OpenRouter's own Claude Code
 *                                        integration doc recommends. Reaches
 *                                        Claude Code Runtime.
 *   - `https://openrouter.ai/api/v1`   — OpenAI-compatible (`/chat/completions`).
 *                                        CodePilot Runtime only.
 *
 * The default OpenRouter preset shipped in `provider-catalog.ts` uses the
 * Anthropic skin. Users editing the URL or pasting from OpenAI tutorials
 * can land on the `/v1` form, which we route as `codepilot_only`.
 *
 * Detection is intentionally URL-shape based: the path either ends with
 * `/api` (Anthropic skin) or includes `/api/v1` / ends with `/v1`
 * (OpenAI-compatible skin). Trailing slashes are normalized so
 * `https://openrouter.ai/api/` still matches.
 */
function isOpenRouterAnthropicSkinUrl(baseUrl: string): boolean {
  const trimmed = baseUrl.replace(/\/+$/, '').toLowerCase();
  if (!trimmed.includes('openrouter.ai')) return false;
  // Anthropic skin: ends with `/api`, NOT `/api/v1`.
  return /\/api$/.test(trimmed);
}

/**
 * True for OpenRouter providers whose base_url is the Anthropic skin
 * (`https://openrouter.ai/api`). Exported so call sites that want the
 * fact-check (e.g. resolver behavior) can reuse the same predicate as
 * the compat tier.
 */
export function isOpenRouterAnthropicSkinRecord(record: ProviderCompatRecord): boolean {
  const preset = findMatchingPresetForRecord(record);
  if (preset?.key !== 'openrouter') return false;
  return isOpenRouterAnthropicSkinUrl(record.base_url);
}

export function getProviderCompat(record: ProviderCompatRecord): ProviderRuntimeCompat {
  // Image protocols short-circuit — never participate in chat-side runtimes.
  if (record.provider_type === 'gemini-image' || record.provider_type === 'openai-image') {
    return 'media_only';
  }
  const preset: VendorPreset | undefined = findMatchingPresetForRecord(record);
  if (!preset) return 'unknown';
  if (CLAUDE_CODE_READY_PRESETS.has(preset.key)) return 'claude_code_ready';
  if (preset.protocol === 'anthropic') {
    // Verified Code Plan / Coding presets get a distinct tier so users
    // can tell "GLM Coding Plan that we've tested end-to-end" apart from
    // "generic anthropic-thirdparty wrapper that may or may not work".
    return preset.meta?.claudeCodeVerified
      ? 'claude_code_verified'
      : 'claude_code_experimental';
  }
  if (preset.protocol === 'openrouter') {
    // OpenRouter's `https://openrouter.ai/api` skin speaks Anthropic wire
    // protocol per their Claude Code integration doc; route it as a
    // distinct claude_code-capable tier rather than codepilot_only. The
    // `/v1` skin (OpenAI-compatible) keeps the codepilot_only path.
    return isOpenRouterAnthropicSkinUrl(record.base_url)
      ? 'openrouter_anthropic_skin'
      : 'codepilot_only';
  }
  if (preset.protocol === 'openai-compatible' || preset.protocol === 'google') {
    return 'codepilot_only';
  }
  return 'unknown';
}

/** Convenience for callers holding a full `ApiProvider`. */
export function getProviderCompatFromApi(provider: ApiProvider): ProviderRuntimeCompat {
  return getProviderCompat({ provider_type: provider.provider_type, base_url: provider.base_url });
}

/**
 * Model-layer compat. We don't try to introspect every upstream model —
 * we project from provider compat + model id heuristics + any catalog
 * capability flags the caller passes through.
 */
export function getModelCompat(args: {
  modelId: string;
  upstreamModelId?: string;
  providerCompat: ProviderRuntimeCompat;
  /** Catalog `capabilities` if available. */
  capabilities?: {
    reasoning?: boolean;
    toolUse?: boolean;
    supportsEffort?: boolean;
    supportsAdaptiveThinking?: boolean;
  };
}): ModelRuntimeCompat {
  const { modelId, upstreamModelId, providerCompat, capabilities } = args;

  if (providerCompat === 'media_only') {
    return { media: true };
  }

  const compat: ModelRuntimeCompat = { chat: true };

  // Tool-use defaults to true unless catalog explicitly says otherwise.
  // Most modern chat models carry tools — opting out is the rare case.
  if (capabilities?.toolUse !== false) compat.tool_capable = true;
  if (capabilities?.reasoning || capabilities?.supportsEffort || capabilities?.supportsAdaptiveThinking) {
    compat.thinking_capable = true;
  }

  switch (providerCompat) {
    case 'claude_code_ready':
      // Anthropic official / Bedrock / Vertex — `@ai-sdk/anthropic` can also
      // talk to these directly without the Claude Code subprocess, so the
      // model is reachable from CodePilot Runtime too. Marking both lets a
      // user on Native runtime configure only Anthropic and still see models.
      compat.claude_code_compatible = true;
      compat.codepilot_runtime_compatible = true;
      break;
    case 'claude_code_verified':
    case 'claude_code_experimental':
      // Anthropic-compat brand presets (Kimi / GLM / MiniMax / Volcengine /
      // Xiaomi MiMo / Bailian / DeepSeek Coding Plan / etc.). These are
      // mostly `sdkProxyOnly` historically, but `ClaudeCodeCompatAdapter`
      // (src/lib/claude-code-compat/) now lets CodePilot Runtime speak the
      // same Anthropic wire format as the Claude Code subprocess — see
      // `provider-transport.ts::isNativeCompatible('claude-code-compat')`
      // and `provider-resolver.ts` routing third-party Anthropic proxies
      // to sdkType='claude-code-compat'. So both runtimes can reach these
      // providers; we mark both flags. Verified vs experimental still
      // differ only in UI tone ("兼容" vs "实验"), not in routing.
      compat.claude_code_compatible = true;
      compat.codepilot_runtime_compatible = true;
      break;
    case 'openrouter_anthropic_skin':
      // OpenRouter Anthropic skin (`/api`, no `/v1`). Reachable from
      // Claude Code Runtime per OpenRouter's own integration doc; mark
      // claude_code_compatible so the runtime filter keeps these rows in
      // the Claude Code picker. We do NOT also flag
      // codepilot_runtime_compatible — CodePilot Runtime expects the
      // OpenAI-compat `/v1` skin URL form, and silently accepting an
      // Anthropic-shaped URL would route CodePilot through the wrong
      // path. Users wanting both runtimes should configure two providers
      // (one per skin URL).
      compat.claude_code_compatible = true;
      break;
    case 'codepilot_only':
      // Provider-layer codepilot_only means the provider doesn't speak the
      // Claude Code wire format, period. We deliberately do NOT lift
      // `anthropic/claude-*` rows back into `claude_code_compatible` here
      // even though some aggregators (OpenRouter) expose an
      // anthropic-compat endpoint — that exposes a hidden contradiction:
      // the Provider Card / Models page label this provider "OpenAI 兼容"
      // and the tooltip says "不进入 Claude Code 流程", but a smuggled
      // claude alias would still surface in the Claude Code picker and
      // route through a path the user didn't ask for.
      // Users who want to use Claude models through OpenRouter / a relay
      // should configure an explicit `anthropic-thirdparty` preset
      // pointing at the relay's anthropic-compat endpoint — that maps to
      // claude_code_experimental and is a single, coherent provider
      // identity in the UI.
      compat.codepilot_runtime_compatible = true;
      break;
    case 'unknown':
      // We don't know the right answer — let the user verify. Both
      // runtimes keep the model visible until they hide it explicitly.
      compat.claude_code_compatible = true;
      compat.codepilot_runtime_compatible = true;
      break;
  }

  return compat;
}

/**
 * Display labels — keeps wording consistent across Provider Card, Models
 * page filter, and any future telemetry. UI calls these directly so a
 * future copy change touches one place.
 */
export function compatLabel(compat: ProviderRuntimeCompat, isZh: boolean): string {
  switch (compat) {
    case 'claude_code_ready':        return isZh ? 'Claude Code 直连' : 'Claude Code direct';
    case 'claude_code_verified':     return isZh ? 'Claude Code 兼容' : 'Claude Code compat';
    case 'claude_code_experimental': return isZh ? 'Claude Code 实验' : 'Claude Code experimental';
    case 'openrouter_anthropic_skin':
      return isZh ? 'OpenRouter · Claude Code 兼容' : 'OpenRouter · Claude Code compat';
    case 'codepilot_only':           return isZh ? '仅 CodePilot Runtime' : 'CodePilot Runtime only';
    case 'media_only':               return isZh ? '图片生成' : 'Image gen';
    case 'unknown':                  return isZh ? '需验证' : 'Needs verification';
  }
}

/** Tooltip-length explanation — used on hover and in filter help. */
export function compatTooltip(compat: ProviderRuntimeCompat, isZh: boolean): string {
  switch (compat) {
    case 'claude_code_ready':
      return isZh
        ? '官方 Anthropic API / Bedrock / Vertex，Claude Code 直接接入，工具 / thinking 完整支持'
        : 'Official Anthropic API / Bedrock / Vertex — Claude Code talks to it directly, full tool + thinking support';
    case 'claude_code_verified':
      return isZh
        ? '已实测的 Anthropic 兼容厂商（GLM / Kimi / Volcengine / MiniMax / 百炼 / 小米 MiMo / DeepSeek 等 Code Plan / Coding 套餐），工具调用 / thinking / 模型别名行为已验证'
        : 'Verified Anthropic-compatible vendor (GLM / Kimi / Volcengine / MiniMax / Bailian / Xiaomi MiMo / DeepSeek Coding Plans) — tool calling, thinking, and alias mapping confirmed in practice';
    case 'claude_code_experimental':
      return isZh
        ? '通用 Anthropic 兼容第三方模板或自定义网关，工具调用 / thinking / 模型别名行为取决于该网关实现，建议测试后再用于关键场景'
        : 'Generic Anthropic-compatible template or custom gateway — tool / thinking / aliases depend on the vendor implementation, test before relying on it for critical work';
    case 'openrouter_anthropic_skin':
      return isZh
        ? '通过 OpenRouter Anthropic Skin 接入 Claude Code；建议优先使用 anthropic/claude-* 模型。其它厂商的模型仍可通过 OpenRouter 调用，但工具调用 / thinking 行为取决于具体上游。'
        : 'Reaches Claude Code via the OpenRouter Anthropic skin — best suited to anthropic/claude-* models. Other models route through OpenRouter too, but tool calling / thinking behavior depends on the upstream vendor.';
    case 'codepilot_only':
      return isZh
        ? 'OpenAI 兼容协议，仅在 CodePilot Runtime 下可用（不会出现在 Claude Code Runtime 的模型选择器中）'
        : 'OpenAI-compatible protocol — only reachable from CodePilot Runtime; never shown in the Claude Code Runtime picker';
    case 'media_only':
      return isZh
        ? '图片生成服务，只用于媒体创作功能，不出现在聊天模型选择器'
        : 'Image-generation service — used by media features only, never appears in chat pickers';
    case 'unknown':
      return isZh
        ? '自定义地址或未识别的预设，是否兼容 Claude Code 取决于该网关实现，建议测试连接后再启用关键模型'
        : 'Custom URL or unrecognized preset — Claude Code compatibility depends on the gateway, test before relying on it';
  }
}

/** Tone for badges — matches the design system status palette.
 *
 *  Phase 1 Step 2 收敛 round 4 (2026-05-06): keep this for callers that
 *  still want the full-background pill (e.g. select-item pickers where
 *  the colored chip helps comprehension). For inline status tags in
 *  card / section headers prefer `compatDotColor` + plain label —
 *  Codex's spec calls out that full-bg pills are visually loud when
 *  there's only 1-2 tags on a row.
 */
export function compatTone(compat: ProviderRuntimeCompat): string {
  switch (compat) {
    case 'claude_code_ready':        return 'bg-status-success-muted text-status-success-foreground';
    case 'claude_code_verified':     return 'bg-status-info-muted text-status-info-foreground';
    case 'claude_code_experimental': return 'bg-status-warning-muted text-status-warning-foreground';
    case 'openrouter_anthropic_skin':
      // Same tone as `claude_code_verified` — the runtime guarantee is
      // the same (Anthropic skin works with Claude Code per OpenRouter
      // docs); only the brand-name flavor differs.
      return 'bg-status-info-muted text-status-info-foreground';
    case 'codepilot_only':           return 'bg-primary/10 text-primary';
    case 'media_only':               return 'bg-muted text-muted-foreground';
    case 'unknown':                  return 'bg-muted text-muted-foreground';
  }
}

/** Just the dot color — for "colored dot + plain text" inline status
 *  tags. Caller renders e.g. `<span class="size-1.5 rounded-full {dot}" />`
 *  next to a muted-foreground label. */
export function compatDotColor(compat: ProviderRuntimeCompat): string {
  switch (compat) {
    case 'claude_code_ready':        return 'bg-status-success-foreground';
    case 'claude_code_verified':     return 'bg-status-info-foreground';
    case 'claude_code_experimental': return 'bg-status-warning-foreground';
    case 'openrouter_anthropic_skin': return 'bg-status-info-foreground';
    case 'codepilot_only':           return 'bg-primary';
    case 'media_only':               return 'bg-muted-foreground';
    case 'unknown':                  return 'bg-muted-foreground';
  }
}
