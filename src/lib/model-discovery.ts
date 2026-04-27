/**
 * Read-only model discovery — Phase 2 spike.
 *
 * Goal: probe a configured provider for its model catalogue without writing
 * anything to user state. Backs the upcoming Provider detail page + a
 * "refresh models" button. No schema changes; no auto-application of results.
 *
 * Safety contract (matches the spike brief):
 *   - never echoes the API key in the response
 *   - every fetch has an explicit timeout
 *   - no follow-on writes / silent updates to provider_models
 *   - protocols without a public/known model endpoint return
 *     `experimental` or `unsupported` instead of inventing a probe
 *
 * Expected callers:
 *   - `POST /api/providers/[id]/discover-models` (server route)
 *   - future "Refresh models" button on Provider detail page (still optional;
 *     UI must surface failures, not silently override stored models).
 */

export type DiscoveryClassification =
  /** Reliable public/compat endpoint we can probe with provided creds. */
  | 'api'
  /** Endpoint exists but auth is quirky / coverage uneven — try, mark experimental. */
  | 'experimental'
  /** No probe path — must use catalog or manual entry (OAuth web sessions, env-only, etc.). */
  | 'unsupported';

export type DiscoveryProtocol =
  | 'openai-compatible'
  | 'anthropic'
  | 'openrouter'
  | 'gemini'
  | 'ollama'
  | 'bedrock'
  | 'vertex'
  | 'unknown';

export interface DiscoveryError {
  code: string;
  message: string;
}

export interface DiscoveryResult {
  /** Static classification — what kind of probe is even feasible. */
  classification: DiscoveryClassification;
  /** Probe protocol that was attempted (or would be). */
  protocol: DiscoveryProtocol;
  /** Endpoint that was probed (apiKey query params redacted). */
  endpoint?: string;
  /** Did the probe succeed? Only meaningful when classification !== 'unsupported'. */
  ok?: boolean;
  modelCount?: number;
  /** Complete list of upstream model ids — used by `/discover-models` to
   *  build the apply/diff payload. NEVER read this from a UI (it can run
   *  to thousands of entries on aggregator providers); use `sampleModels`
   *  for display. Empty when `ok=false`. */
  fullModelIds?: string[];
  /** Capped slice of `fullModelIds` (first SAMPLE_CAP entries) for UI
   *  display — the diff dialog header, classification log, etc. The cap
   *  is just for response size; never use this slice as an authoritative
   *  set when computing what to write to DB or what counts as orphan. */
  sampleModels?: string[];
  error?: DiscoveryError;
  /** Human-readable hint for fallback / next step. */
  suggestedFallback?: string;
  /** Reasoning for the classification (surfaced in diagnostic UI). */
  notes?: string;
  /** Wall time of the actual fetch (ms). */
  durationMs?: number;
}

export interface DiscoveryInput {
  /** The catalog protocol of the provider. */
  protocol: string;
  /** Base URL — already trimmed of trailing slash. */
  baseUrl: string;
  /** API key. Pass undefined when there is no real key (env-only, OAuth, etc.). */
  apiKey?: string;
  /** Used by the Anthropic-compat / thirdparty probe to pick header style. */
  authStyle?: 'api_key' | 'auth_token';
  /** Catalog preset key; informs classification when protocol is ambiguous. */
  presetKey?: string;
  /** Per-call timeout. Defaults to 8s. */
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT = 8_000;
// Cap on the model id list returned to the caller. Used both for the dialog
// display and for the auto-persist path in the discover route, so it must be
// generous enough that most real catalogues come through unchopped (Aiberm
// returns ~131, OpenRouter > 200). Response stays small — these are short
// strings.
const SAMPLE_CAP = 500;

/**
 * Static classification — answers "is this provider even probable?" without
 * making a network call. Used to render the three-category breakdown in the
 * docs and to decide whether the route should attempt a live probe.
 */
export function classifyProvider(input: Pick<DiscoveryInput, 'protocol' | 'presetKey'>): {
  classification: DiscoveryClassification;
  protocol: DiscoveryProtocol;
  notes: string;
  suggestedFallback?: string;
} {
  const key = input.presetKey ?? '';
  const protocol = input.protocol;

  // OAuth login flows / env-driven Claude Code don't expose a model list endpoint.
  if (key === 'openai-oauth' || key === 'claude-code-env') {
    return {
      classification: 'unsupported',
      protocol: 'unknown',
      notes: 'OAuth web session / env-driven entry — no public model list endpoint.',
      suggestedFallback: 'Use SDK-built-in model defaults or curated catalog entries.',
    };
  }

  switch (protocol) {
    case 'openrouter':
      return {
        classification: 'api',
        protocol: 'openrouter',
        notes: 'OpenRouter exposes /v1/models publicly with API key.',
      };
    case 'openai-compatible':
      return {
        classification: 'api',
        protocol: 'openai-compatible',
        notes: 'OpenAI-compatible providers conventionally expose GET /v1/models.',
      };
    case 'openai-image':
    case 'gemini-image':
      // Image-generation providers can't be auto-discovered cleanly: the
      // upstream /v1/models or models.list endpoints return the entire
      // vendor catalogue (text, embedding, audio, image), not just image
      // models. Filtering by name is brittle. The catalog ships a curated
      // image-only list (`category: 'media'`), so treat that as the truth
      // and surface a "use catalog" message instead.
      return {
        classification: 'unsupported',
        protocol: 'unknown',
        notes: 'Image providers — upstream model lists mix text/embedding/audio entries, so discovery is disabled. Use the curated catalog list.',
        suggestedFallback: 'Catalog defaults seeded into provider_models on the Models page.',
      };
    case 'google':
      return {
        classification: 'api',
        protocol: 'gemini',
        notes: 'Gemini API exposes models.list (https://generativelanguage.googleapis.com/v1beta/models).',
      };
    case 'anthropic': {
      // Anthropic protocol is the ambiguous bucket — split by preset.
      if (key === 'ollama') {
        return {
          classification: 'api',
          protocol: 'ollama',
          notes: 'Ollama exposes /api/tags publicly (no auth).',
        };
      }
      if (key === 'litellm') {
        return {
          classification: 'api',
          protocol: 'openai-compatible',
          notes: 'LiteLLM proxy is OpenAI-compat — /v1/models works on most deployments.',
        };
      }
      if (key === 'anthropic-thirdparty') {
        return {
          classification: 'experimental',
          protocol: 'openai-compatible',
          notes: 'Most Anthropic-compat third-party gateways also expose /v1/models, but coverage is uneven.',
          suggestedFallback: 'Fall back to the curated catalog entries when the probe fails.',
        };
      }
      if (key === 'anthropic-official') {
        return {
          classification: 'experimental',
          protocol: 'anthropic',
          notes: 'api.anthropic.com /v1/models exists (2024+) but is paginated and tied to org billing scope.',
          suggestedFallback: 'Use SDK-built-in model defaults if the probe fails.',
        };
      }
      // Brand-specific anthropic-compat (kimi, moonshot, glm, minimax, volcengine, bailian, xiaomi-mimo*)
      // — most of these brand vendors also run an OpenAI-compat surface that exposes /v1/models
      // on the same host, but this isn't guaranteed in catalog config and varies per region.
      return {
        classification: 'experimental',
        protocol: 'openai-compatible',
        notes: 'Brand-specific Anthropic-compat preset — try OpenAI-compat /v1/models on the same host; not all vendors expose it.',
        suggestedFallback: 'Curated catalog model list is the reliable source.',
      };
    }
    case 'bedrock':
      return {
        classification: 'experimental',
        protocol: 'bedrock',
        notes: 'AWS Bedrock requires SigV4-signed ListFoundationModels; SDK-side only, not a plain HTTP probe.',
        suggestedFallback: 'Use AWS SDK in-process or rely on catalog.',
      };
    case 'vertex':
      return {
        classification: 'experimental',
        protocol: 'vertex',
        notes: 'Vertex AI requires Google ADC + project/region scope; no straightforward probe from the renderer.',
        suggestedFallback: 'Catalog or in-process @google-cloud/aiplatform.',
      };
    default:
      return {
        classification: 'unsupported',
        protocol: 'unknown',
        notes: `Unknown protocol "${protocol}" — no probe path defined.`,
      };
  }
}

/**
 * Top-level entry. Picks a probe based on `classifyProvider`, runs it with a
 * timeout, never surfaces secrets in the result.
 */
export async function discoverModels(input: DiscoveryInput): Promise<DiscoveryResult> {
  const { classification, protocol, notes, suggestedFallback } = classifyProvider(input);

  if (classification === 'unsupported') {
    return { classification, protocol, notes, suggestedFallback };
  }

  const timeoutMs = input.timeoutMs ?? DEFAULT_TIMEOUT;
  const baseUrl = input.baseUrl.replace(/\/+$/, '');
  const start = Date.now();

  try {
    let probe: Partial<DiscoveryResult>;
    switch (protocol) {
      case 'ollama':
        probe = await probeOllama(baseUrl, timeoutMs);
        break;
      case 'gemini':
        probe = await probeGemini(input.apiKey, timeoutMs);
        break;
      case 'anthropic':
        probe = await probeAnthropic(baseUrl, input.apiKey, input.authStyle, timeoutMs);
        break;
      case 'openrouter':
      case 'openai-compatible':
        probe = await probeOpenAICompat(baseUrl, input.apiKey, input.authStyle, timeoutMs);
        break;
      default:
        return { classification, protocol, notes, suggestedFallback };
    }

    return {
      ...probe,
      classification,
      protocol,
      notes,
      suggestedFallback,
      durationMs: Date.now() - start,
    };
  } catch (err) {
    return {
      classification,
      protocol,
      notes,
      suggestedFallback,
      ok: false,
      error: { code: 'unexpected', message: err instanceof Error ? err.message : String(err) },
      durationMs: Date.now() - start,
    };
  }
}

// ---------------------------------------------------------------------------
// Probes — each returns a partial DiscoveryResult that the caller merges with
// classification metadata. Errors are caught and converted into structured
// fields; secrets are never echoed.
// ---------------------------------------------------------------------------

async function probeOpenAICompat(
  baseUrl: string,
  apiKey: string | undefined,
  authStyle: 'api_key' | 'auth_token' | undefined,
  timeoutMs: number,
): Promise<Partial<DiscoveryResult>> {
  if (!apiKey) {
    return {
      ok: false,
      error: { code: 'missing-credentials', message: 'No API key on file — cannot probe.' },
    };
  }
  // Some catalog base_urls already include /v1 (e.g. openrouter.ai/api/v1),
  // others don't (e.g. api.example.com). Normalise to one /v1/models call.
  const url = baseUrl.endsWith('/v1') ? `${baseUrl}/models` : `${baseUrl}/v1/models`;
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (authStyle === 'auth_token') {
    headers.Authorization = `Bearer ${apiKey}`;
  } else {
    // OpenAI-compat default — most vendors accept Bearer; a few want X-Api-Key.
    headers.Authorization = `Bearer ${apiKey}`;
  }
  return fetchAndParse(url, { headers }, timeoutMs, parseOpenAIModelsBody);
}

async function probeOllama(
  baseUrl: string,
  timeoutMs: number,
): Promise<Partial<DiscoveryResult>> {
  const url = `${baseUrl}/api/tags`;
  return fetchAndParse(url, {}, timeoutMs, (json) => {
    const items = Array.isArray((json as { models?: unknown }).models)
      ? ((json as { models: unknown[] }).models)
      : [];
    const ids = items
      .map((m) => (typeof m === 'object' && m && 'name' in m ? String((m as { name: unknown }).name) : ''))
      .filter(Boolean);
    return { ids };
  });
}

async function probeGemini(
  apiKey: string | undefined,
  timeoutMs: number,
): Promise<Partial<DiscoveryResult>> {
  if (!apiKey) {
    return {
      ok: false,
      error: { code: 'missing-credentials', message: 'No API key on file — cannot probe.' },
    };
  }
  const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(apiKey)}`;
  // Don't echo the key back through the endpoint field.
  const redactedEndpoint = 'https://generativelanguage.googleapis.com/v1beta/models?key=***';
  const result = await fetchAndParse(url, {}, timeoutMs, (json) => {
    const items = Array.isArray((json as { models?: unknown }).models)
      ? ((json as { models: unknown[] }).models)
      : [];
    const ids = items
      .map((m) => (typeof m === 'object' && m && 'name' in m ? String((m as { name: unknown }).name) : ''))
      .filter(Boolean);
    return { ids };
  });
  return { ...result, endpoint: redactedEndpoint };
}

async function probeAnthropic(
  baseUrl: string,
  apiKey: string | undefined,
  authStyle: 'api_key' | 'auth_token' | undefined,
  timeoutMs: number,
): Promise<Partial<DiscoveryResult>> {
  if (!apiKey) {
    return {
      ok: false,
      error: { code: 'missing-credentials', message: 'No API key on file — cannot probe.' },
    };
  }
  const url = `${baseUrl}/v1/models`;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'anthropic-version': '2023-06-01',
  };
  if (authStyle === 'auth_token') {
    headers.Authorization = `Bearer ${apiKey}`;
  } else {
    headers['x-api-key'] = apiKey;
  }
  return fetchAndParse(url, { headers }, timeoutMs, parseOpenAIModelsBody);
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function parseOpenAIModelsBody(json: unknown): { ids: string[] } {
  const data = (json as { data?: unknown }).data;
  if (!Array.isArray(data)) return { ids: [] };
  const ids = data
    .map((m) => (typeof m === 'object' && m && 'id' in m ? String((m as { id: unknown }).id) : ''))
    .filter(Boolean);
  return { ids };
}

async function fetchAndParse(
  url: string,
  init: RequestInit,
  timeoutMs: number,
  parser: (json: unknown) => { ids: string[] },
): Promise<Partial<DiscoveryResult>> {
  try {
    const res = await fetch(url, {
      ...init,
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) {
      const text = await safeReadText(res);
      return {
        endpoint: url,
        ok: false,
        error: {
          code: `http-${res.status}`,
          message: text ? `${res.status} ${res.statusText}: ${truncate(text, 200)}` : `${res.status} ${res.statusText}`,
        },
      };
    }
    const json = await res.json().catch(() => null);
    if (!json || typeof json !== 'object') {
      return {
        endpoint: url,
        ok: false,
        error: { code: 'bad-response', message: 'Response was not JSON.' },
      };
    }
    const { ids } = parser(json);
    return {
      endpoint: url,
      ok: true,
      modelCount: ids.length,
      // `fullModelIds` is the apply/diff source of truth — never trim it.
      // `sampleModels` is just the UI-visible cap so the JSON response
      // doesn't bloat for aggregators (OpenRouter ≈ 280, future ones may
      // exceed SAMPLE_CAP).
      fullModelIds: ids,
      sampleModels: ids.slice(0, SAMPLE_CAP),
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const code = message.includes('aborted') || message.includes('timeout') ? 'timeout' : 'network';
    return {
      endpoint: url,
      ok: false,
      error: { code, message },
    };
  }
}

async function safeReadText(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch {
    return '';
  }
}

function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max)}…` : s;
}
