/**
 * User-path regressions reported during the 2026-07-19 foundation refresh
 * acceptance pass.
 *
 * These deliberately exercise the LAST local boundary the composer consumes:
 * the final /api/providers/models response after DB/catalog/cache merging.
 * Helper-only tests stayed green while the actual selector had no effort
 * control, so a helper result is not sufficient evidence for these outcomes.
 */

import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { NextRequest } from 'next/server';
import {
  createProvider,
  deleteProvider,
  getAllModelsForProvider,
  getAllProviders,
  upsertProviderModel,
} from '@/lib/db';
import {
  invalidateCodexModelsCache,
  listCodexModels,
} from '@/lib/codex/models';
import {
  GET as modelsGET,
  normalizeModelCapabilitySurface,
} from '@/app/api/providers/models/route';
import { POST as searchModelsPOST } from '@/app/api/providers/[id]/search-models/route';

const TEST_PROVIDER_PREFIX = '__test_foundation_user_path_';
const SRC = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');

describe('capability API boundary rejects malformed runtime data', () => {
  it('does not turn string "false" into a truthy effort capability', () => {
    const normalized = normalizeModelCapabilitySurface({
      value: 'dirty',
      label: 'Dirty',
      capabilities: { supportsEffort: 'false' },
    });
    assert.equal(normalized.supportsEffort, undefined);
  });

  it('drops a mixed-type effort allowlist instead of trusting an assertion', () => {
    const normalized = normalizeModelCapabilitySurface({
      value: 'dirty',
      label: 'Dirty',
      capabilities: { supportedEffortLevels: ['high', 42] },
    });
    assert.equal(normalized.supportedEffortLevels, undefined);
  });

  it('preserves explicit false and a valid string allowlist', () => {
    const normalized = normalizeModelCapabilitySurface({
      value: 'valid',
      label: 'Valid',
      supportsEffort: false,
      capabilities: { supportsEffort: true, supportedEffortLevels: ['low', 'high'] },
    });
    assert.equal(normalized.supportsEffort, false, 'top-level explicit false stays authoritative');
    assert.deepEqual(normalized.supportedEffortLevels, ['low', 'high']);
  });
});

function cleanupProviders() {
  for (const provider of getAllProviders()) {
    if (provider.name.startsWith(TEST_PROVIDER_PREFIX)) deleteProvider(provider.id);
  }
}

function fakeCodexServer(data: unknown[]) {
  return async () => ({
    client: {
      request: <T>(): Promise<T> => Promise.resolve({ data, nextCursor: null } as T),
    },
  });
}

type RouteModel = {
  value: string;
  label: string;
  supportsEffort?: boolean;
  supportedEffortLevels?: string[];
};

type RouteGroup = {
  provider_id: string;
  models: RouteModel[];
};

async function getGroups(): Promise<RouteGroup[]> {
  const response = await modelsGET(new NextRequest('http://localhost/api/providers/models'));
  assert.equal(response.status, 200);
  const body = await response.json() as { groups: RouteGroup[] };
  return body.groups;
}

beforeEach(() => {
  cleanupProviders();
  invalidateCodexModelsCache();
});

afterEach(() => {
  cleanupProviders();
  invalidateCodexModelsCache();
});

describe('U1 — GPT-5.6 effort survives into the final composer feed', () => {
  it('lifts Codex model/list effort metadata to the top-level fields MessageInput reads', async () => {
    await listCodexModels(
      { force: true },
      fakeCodexServer([
        {
          id: 'gpt-5.6-sol',
          model: 'gpt-5.6-sol',
          displayName: 'GPT-5.6 Sol',
          description: 'Frontier',
          hidden: false,
          isDefault: true,
          supportedReasoningEfforts: [
            { reasoningEffort: 'low' },
            { reasoningEffort: 'high' },
            { reasoningEffort: 'xhigh' },
            { reasoningEffort: 'max' },
          ],
          defaultReasoningEffort: 'high',
          inputModalities: ['text'],
        },
      ]),
    );

    const groups = await getGroups();
    const codex = groups.find(group => group.provider_id === 'codex_account');
    assert.ok(codex, 'a warm Codex model cache must reach the full-catalog route');
    const model = codex.models.find(row => row.value === 'gpt-5.6-sol');
    assert.ok(model, 'GPT-5.6 Sol must be present in the Codex account group');
    assert.equal(
      model.supportsEffort,
      true,
      'MessageInput reads the top-level field; nested capabilities alone render no selector',
    );
    assert.deepEqual(model.supportedEffortLevels, ['low', 'high', 'xhigh', 'max']);
  });
});

describe('U2 — the real Kimi for Coding DB shape is enriched, not shadowed', () => {
  it('keeps the channel name and exposes Auto / Low / High / Max for a manual user-edited row', async () => {
    const provider = createProvider({
      name: `${TEST_PROVIDER_PREFIX}${Date.now()}`,
      provider_type: 'anthropic',
      protocol: 'anthropic',
      base_url: 'https://api.kimi.com/coding/',
      api_key: 'sk-test',
      extra_env: '{}',
    });

    // The user's provider also has the catalog's legacy alias explicitly
    // hidden. The read-only enrichment must still use the catalog as a source
    // of display/capability facts for the exact manual channel row; filtering
    // the hidden alias before enrichment was the production-only failure.
    upsertProviderModel({
      provider_id: provider.id,
      model_id: 'sonnet',
      upstream_model_id: 'kimi-for-coding',
      display_name: 'Kimi for Coding',
      capabilities_json: JSON.stringify({ supportsEffort: true, supportedEffortLevels: ['max'] }),
      variants_json: '{}',
      sort_order: 1,
      enabled: 0,
      source: 'catalog',
      last_refreshed_at: '2026-07-19 00:00:00',
      user_edited: 1,
      enable_source: 'manual_hidden',
    });

    // Matches the row observed in the user's database. The row id is the real
    // channel id rather than the catalog's legacy Claude-compatible alias, and
    // user ownership means catalog realignment must not overwrite the DB row.
    // The read path still has to enrich the composer response by matching the
    // catalog upstream id; otherwise the capability disappears forever.
    upsertProviderModel({
      provider_id: provider.id,
      model_id: 'kimi-for-coding',
      upstream_model_id: 'kimi-for-coding',
      display_name: 'kimi-for-coding',
      capabilities_json: '{}',
      variants_json: '{}',
      sort_order: 0,
      enabled: 1,
      source: 'manual',
      last_refreshed_at: '2026-07-19 00:00:00',
      user_edited: 1,
      enable_source: 'manual_enabled',
    });

    const groups = await getGroups();
    const group = groups.find(row => row.provider_id === provider.id);
    assert.ok(group, 'Kimi provider must be present in the final model feed');
    assert.equal(
      group.models.some(row => row.value === 'sonnet'),
      false,
      'the hidden Claude-compatible sonnet alias must not leak back into the final composer feed',
    );
    const model = group.models.find(row => row.value === 'kimi-for-coding');
    assert.ok(model, 'the real kimi-for-coding row must remain selectable');
    assert.equal(model.label, 'Kimi for Coding', 'the UI exposes the channel name, never K3 or a raw id');
    assert.doesNotMatch(model.label, /\bK3\b/i);
    assert.equal(model.supportsEffort, true);
    assert.deepEqual(
      model.supportedEffortLevels,
      ['low', 'high', 'max'],
      'Auto is the absence of an override; Low/High/Max are vendor tiers',
    );
  });
});

describe('U3 — CodePlan add-model is not held hostage by an optional upstream index', () => {
  it('falls back to the built-in GLM plan catalog when /models is unreachable', async () => {
    const provider = createProvider({
      name: `${TEST_PROVIDER_PREFIX}glm_${Date.now()}`,
      provider_type: 'anthropic',
      protocol: 'anthropic',
      base_url: 'https://open.bigmodel.cn/api/anthropic',
      api_key: 'sk-test',
      extra_env: '{}',
    });
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => {
      throw new Error('simulated DNS failure');
    };

    try {
      const response = await searchModelsPOST(
        new NextRequest(`http://localhost/api/providers/${provider.id}/search-models`, {
          method: 'POST',
        }),
        { params: Promise.resolve({ id: provider.id }) },
      );
      assert.equal(
        response.status,
        200,
        'GLM CodePlan has a curated SKU catalog; upstream index failure must not make Add Model unusable',
      );
      const body = await response.json() as {
        candidates: Array<{ modelId: string; displayName: string; alreadyAdded: boolean }>;
      };
      assert.ok(
        body.candidates.some(candidate => candidate.displayName === 'GLM-5.2'),
        'the fallback must expose the current curated GLM-5.2 entry',
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

describe('U3b — new catalog-only K3 entries reach existing provider rows', () => {
  const cases = [
    {
      name: 'ClinePass',
      baseUrl: 'https://api.cline.bot/api/v1',
      existingId: 'cline-pass/glm-5.2',
      k3Id: 'cline-pass/kimi-k3',
    },
    {
      name: 'OpenCode Go (OpenAI)',
      baseUrl: 'https://opencode.ai/zen/go/v1',
      existingId: 'glm-5.2',
      k3Id: 'kimi-k3',
    },
  ] as const;

  for (const testCase of cases) {
    it(`${testCase.name}: appends Kimi K3 without requiring a DB reseed`, async () => {
      const provider = createProvider({
        name: `${TEST_PROVIDER_PREFIX}${testCase.name}_${Date.now()}`,
        provider_type: 'openai-compatible',
        protocol: 'openai-compatible',
        base_url: testCase.baseUrl,
        api_key: 'sk-test',
        extra_env: '{}',
      });

      // Reproduce an existing installation whose provider_models table was
      // materialized before K3 entered the curated catalog. The final route
      // must append a genuinely new catalog identity; otherwise existing users
      // never see K3 until they manually realign/recreate the provider.
      upsertProviderModel({
        provider_id: provider.id,
        model_id: testCase.existingId,
        upstream_model_id: testCase.existingId,
        display_name: 'Existing catalog row',
        capabilities_json: '{}',
        variants_json: '{}',
        sort_order: 0,
        enabled: 1,
        source: 'catalog',
        last_refreshed_at: '2026-07-01 00:00:00',
        user_edited: 0,
        enable_source: 'recommended',
      });

      const groups = await getGroups();
      const group = groups.find(row => row.provider_id === provider.id);
      assert.ok(group, `${testCase.name} must remain in the final composer feed`);
      const k3 = group.models.find(row => row.value === testCase.k3Id);
      assert.ok(k3, `${testCase.k3Id} must be appended from the current catalog`);
      assert.equal(k3.label, 'Kimi K3');
      assert.equal(k3.supportsEffort, undefined,
        'do not show an effort selector until this gateway wire is verified');
    });
  }
});

describe('U2b — untouched catalog rows follow current Kimi capability', () => {
  it('upgrades a stale max-only catalog cache on the final read path without a DB reseed', async () => {
    const provider = createProvider({
      name: `${TEST_PROVIDER_PREFIX}KimiStaleCatalog_${Date.now()}`,
      provider_type: 'anthropic',
      protocol: 'anthropic',
      base_url: 'https://api.kimi.com/coding/',
      api_key: 'sk-test',
      extra_env: '{}',
    });
    upsertProviderModel({
      provider_id: provider.id,
      model_id: 'sonnet',
      upstream_model_id: 'kimi-for-coding',
      display_name: 'Kimi for Coding',
      capabilities_json: JSON.stringify({
        supportsEffort: true,
        supportedEffortLevels: ['max'],
        effortNoteKey: 'messageInput.effort.note.kimiAuto',
      }),
      variants_json: '{}',
      sort_order: 0,
      enabled: 1,
      source: 'catalog',
      user_edited: 0,
      enable_source: 'catalog',
    });

    const groups = await getGroups();
    const model = groups.find(group => group.provider_id === provider.id)?.models[0];
    assert.ok(model, 'Kimi catalog row must remain visible');
    assert.deepEqual(model.supportedEffortLevels, ['low', 'high', 'max'],
      'an untouched catalog cache is not a user override and must follow the current shipped capability');

    const stored = getAllModelsForProvider(provider.id)[0];
    assert.deepEqual(JSON.parse(stored.capabilities_json).supportedEffortLevels, ['max'],
      'the picker upgrade is read-only; it must not mutate provider_models during GET');
  });

  it('still preserves a user-edited max-only capability', async () => {
    const provider = createProvider({
      name: `${TEST_PROVIDER_PREFIX}KimiUserCaps_${Date.now()}`,
      provider_type: 'anthropic',
      protocol: 'anthropic',
      base_url: 'https://api.kimi.com/coding/',
      api_key: 'sk-test',
      extra_env: '{}',
    });
    upsertProviderModel({
      provider_id: provider.id,
      model_id: 'sonnet',
      upstream_model_id: 'kimi-for-coding',
      display_name: 'My Kimi',
      capabilities_json: JSON.stringify({
        supportsEffort: true,
        supportedEffortLevels: ['max'],
      }),
      variants_json: '{}',
      sort_order: 0,
      enabled: 1,
      source: 'catalog',
      user_edited: 1,
      enable_source: 'manual_enabled',
    });

    const groups = await getGroups();
    const model = groups.find(group => group.provider_id === provider.id)?.models[0];
    assert.equal(model?.label, 'My Kimi');
    assert.deepEqual(model?.supportedEffortLevels, ['max'],
      'an explicit user capability remains authoritative');
  });
});

describe('U4 — effort selector uses the model selector visual contract', () => {
  it('shares optical typography, item spacing, popover radius and motion', () => {
    const effortSource = fs.readFileSync(
      path.join(SRC, 'components/chat/EffortSelectorDropdown.tsx'),
      'utf8',
    );
    const modelSource = fs.readFileSync(
      path.join(SRC, 'components/chat/ModelSelectorDropdown.tsx'),
      'utf8',
    );

    assert.match(
      effortSource,
      /<span className="text-xs font-normal">/,
      'effort trigger must use the shared compact toolbar typography',
    );
    assert.match(
      modelSource,
      /<span className="text-xs font-normal">\{currentModelOption\?\.label\}<\/span>/,
      'selected model must not use an oversized system-monospace fallback',
    );
    assert.match(
      modelSource,
      /<span className="text-xs font-normal truncate">\{option\.label\}<\/span>/,
      'recent model rows must use the same compact sans typography as the trigger',
    );
    assert.match(
      modelSource,
      /<span className="text-xs font-normal truncate">\{opt\.label\}<\/span>/,
      'provider model rows must use the same compact sans typography as the trigger',
    );
    assert.doesNotMatch(
      modelSource,
      /font-mono text-xs truncate">\{(?:option|opt)\.label\}/,
      'human-readable model names must never inherit the offline monospace fallback',
    );
    assert.match(
      effortSource,
      /\bCommandListItems\b/,
      'effort rows must use the same shared p-1 item container as the model menu',
    );
    assert.doesNotMatch(
      effortSource,
      /rounded-lg/,
      'CommandList already owns the model menu rounded-2xl radius; effort must not override it',
    );
    for (const [name, source] of [['effort', effortSource], ['model', modelSource]] as const) {
      assert.match(
        source,
        /w-80 max-w-\[calc\(100vw-2rem\)\]/,
        `${name} popover must shrink inside a narrow window instead of overflowing`,
      );
      assert.match(source, /<PopoverContent[\s\S]{0,220}collisionPadding=\{16\}/,
        `${name} popover must use collision-aware viewport placement, not only a max-width`);
      assert.match(source, /<CommandList positioning="inline"/,
        `${name} command list must let the Radix popover own placement`);
    }
  });

  it('keeps auto-review in the same muted toolbar tier as mode and runtime', () => {
    const permissionSource = fs.readFileSync(
      path.join(SRC, 'components/chat/ChatPermissionSelector.tsx'),
      'utf8',
    );

    assert.match(
      permissionSource,
      /isAutoReview[\s\S]*\? 'text-xs font-normal text-muted-foreground'/,
      '替我审批 must not become darker or heavier than the adjacent toolbar selectors',
    );
  });

  it('keeps right-panel file names in compact UI typography', () => {
    const fileTreeSource = fs.readFileSync(
      path.join(SRC, 'components/ai-elements/file-tree.tsx'),
      'utf8',
    );

    assert.match(
      fileTreeSource,
      /"rounded-lg border bg-background text-xs font-normal"/,
      'file names must match the compact right-panel controls',
    );
    assert.doesNotMatch(
      fileTreeSource,
      /rounded-lg border bg-background font-mono text-sm/,
      'the entire tree must not inherit an oversized system-monospace fallback',
    );
  });

  it('keeps human-readable model labels sans outside the composer too', () => {
    const bridgeSource = fs.readFileSync(
      path.join(SRC, 'components/bridge/BridgeSection.tsx'),
      'utf8',
    );

    assert.match(
      bridgeSource,
      /<Select value=\{model\}[\s\S]*?<SelectTrigger className="w-full text-sm font-normal">/,
      'the bridge default-model selector must render display labels as UI text',
    );
    assert.doesNotMatch(
      bridgeSource,
      /<Select value=\{model\}[\s\S]*?<SelectTrigger className="w-full text-sm font-mono">/,
      'model display labels must not inherit the offline monospace fallback',
    );
  });
});

describe('U5 — product fonts are bundled and keep their semantic roles', () => {
  it('loads Geist Sans and Geist Mono locally instead of depending on Google Fonts', () => {
    const layoutSource = fs.readFileSync(path.join(SRC, 'app/layout.tsx'), 'utf8');
    const globalsSource = fs.readFileSync(path.join(SRC, 'app/globals.css'), 'utf8');
    const packageJson = JSON.parse(
      fs.readFileSync(path.join(SRC, '../package.json'), 'utf8'),
    ) as { dependencies?: Record<string, string> };

    assert.match(layoutSource, /import \{ GeistSans \} from "geist\/font\/sans";/);
    assert.match(layoutSource, /import \{ GeistMono \} from "geist\/font\/mono";/);
    assert.doesNotMatch(
      layoutSource,
      /next\/font\/google/,
      'desktop startup must not need a Google Fonts request',
    );
    assert.match(
      layoutSource,
      /className=\{`\$\{GeistSans\.className\} \$\{GeistSans\.variable\} \$\{GeistMono\.variable\} antialiased`\}/,
      'the bundled sans face and both font variables must be installed at the application root',
    );
    assert.equal(packageJson.dependencies?.geist, '^1.7.2');
    assert.match(globalsSource, /--font-sans: var\(--font-geist-sans\);/);
    assert.match(globalsSource, /--font-mono: var\(--font-geist-mono\);/);
  });

  it('retains monospace only on code-oriented content', () => {
    const codeBlockSource = fs.readFileSync(
      path.join(SRC, 'components/ai-elements/code-block.tsx'),
      'utf8',
    );
    const terminalSource = fs.readFileSync(
      path.join(SRC, 'components/ai-elements/terminal.tsx'),
      'utf8',
    );

    assert.match(codeBlockSource, /font-mono text-sm/);
    assert.match(terminalSource, /font-mono text-sm/);
  });
});
