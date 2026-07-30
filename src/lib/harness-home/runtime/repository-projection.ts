import type { RuntimeId } from '@/lib/runtime/runtime-id';
import {
  buildRuntimeProjection,
} from '../projection';
import type {
  ContextFragment,
  PortableContentRef,
  Provenance,
  RuntimeProjection,
  SecretRef,
} from '../contracts';
import { assertCompleteProvenance } from '../provenance';
import { FileHarnessRepository } from '../repository/file-repository';
import { assertNoSecretMaterial } from '../validation';
import { requireRuntimeDescriptor } from './descriptor';

const MAX_SECTION_BYTES = 256 * 1024;
const MAX_CONTEXT_BYTES = 2 * 1024 * 1024;

export type CanonicalHarnessSectionKind =
  | 'identity'
  | 'rule'
  | 'memory'
  | 'preference'
  | 'feedback'
  | 'creative_method'
  | 'runtime_overlay';

export interface CanonicalHarnessSection {
  readonly kind: CanonicalHarnessSectionKind;
  readonly id: string;
  readonly path: string;
  readonly content: string;
  readonly provenance: Provenance;
}

export interface CanonicalHarnessDefinitionDescriptor {
  readonly kind: 'skill' | 'mcp';
  readonly id: string;
  readonly path: string;
  readonly contentHash: string;
  /**
   * Descriptor discovery is not execution. Runtime-specific mounters may
   * promote this later only after their own conformance proves a real wire.
   */
  readonly execution: 'perceptible_only';
  readonly reason: string;
}

export interface CanonicalRuntimeHarness {
  readonly repositoryRoot: string;
  readonly generation: number;
  readonly runtimeId: RuntimeId;
  readonly projection: RuntimeProjection;
  readonly sections: readonly CanonicalHarnessSection[];
  readonly definitions: readonly CanonicalHarnessDefinitionDescriptor[];
  readonly secretRefs: readonly SecretRef[];
  readonly diagnostics: {
    readonly source: 'canonical_repository';
    readonly contentBytes: number;
    readonly definitionCount: number;
    readonly assetCount: number;
  };
}

interface SectionSource {
  readonly kind: CanonicalHarnessSectionKind;
  readonly ref: PortableContentRef;
  readonly overlay: boolean;
}

function requireProvenance(ref: PortableContentRef): Provenance {
  if (!ref.provenance) {
    throw new Error(
      `Canonical content "${ref.id}" is missing provenance; refusing `
      + 'to inject an untraceable context fragment.',
    );
  }
  assertCompleteProvenance(ref.provenance, `canonical content ${ref.id}`);
  return ref.provenance;
}

function descriptorFor(
  kind: CanonicalHarnessDefinitionDescriptor['kind'],
  ref: PortableContentRef,
): CanonicalHarnessDefinitionDescriptor {
  return {
    kind,
    id: ref.id,
    path: ref.path,
    contentHash: ref.contentHash,
    execution: 'perceptible_only',
    reason:
      `${kind === 'mcp' ? 'MCP' : 'Skill'} definition is present in the `
      + 'canonical repository, but this projection does not claim it is '
      + 'mounted. A Runtime mounter must prove the executable wire first.',
  };
}

/**
 * Read one consistent canonical generation and project it for a Runtime.
 *
 * This function never writes, never resolves Secret values, and never treats
 * a discovered Skill/MCP descriptor as callable. A hash mismatch, missing
 * provenance or unknown Runtime fails closed before any prompt text is built.
 */
export function projectCanonicalRepository(input: {
  readonly repository: FileHarnessRepository;
  readonly runtimeId: RuntimeId;
}): CanonicalRuntimeHarness {
  const descriptor = requireRuntimeDescriptor(input.runtimeId);
  const consistency = input.repository.scanConsistency();
  if (consistency.length > 0) {
    throw new Error(
      `Harness repository is stale (${consistency.length} inconsistent `
      + 'content reference(s)); refresh or resolve conflicts before projection.',
    );
  }

  const manifest = input.repository.manifest;
  const overlay = manifest.runtimeOverlays[input.runtimeId];
  const sources: SectionSource[] = [
    ...manifest.definition.identityRefs.map((ref) => ({
      kind: 'identity' as const,
      ref,
      overlay: false,
    })),
    ...manifest.definition.ruleRefs.map((ref) => ({
      kind: 'rule' as const,
      ref,
      overlay: false,
    })),
    ...manifest.state.memoryRefs.map((ref) => ({
      kind: 'memory' as const,
      ref,
      overlay: false,
    })),
    ...manifest.state.preferenceRefs.map((ref) => ({
      kind: 'preference' as const,
      ref,
      overlay: false,
    })),
    ...manifest.state.feedbackRefs.map((ref) => ({
      kind: 'feedback' as const,
      ref,
      overlay: false,
    })),
    ...manifest.definition.creativeMethodRefs.map((ref) => ({
      kind: 'creative_method' as const,
      ref,
      overlay: false,
    })),
    ...(overlay
      ? [...overlay.definitionRefs, ...overlay.stateRefs].map((ref) => ({
        kind: 'runtime_overlay' as const,
        ref,
        overlay: true,
      }))
      : []),
  ];

  let contentBytes = 0;
  const sections: CanonicalHarnessSection[] = [];
  const contextFragments: ContextFragment[] = [];
  for (const source of sources) {
    const bytes = input.repository.read(source.ref.path);
    if (bytes.byteLength > MAX_SECTION_BYTES) {
      throw new Error(
        `Canonical content "${source.ref.id}" exceeds the `
        + `${MAX_SECTION_BYTES}-byte per-section limit.`,
      );
    }
    contentBytes += bytes.byteLength;
    if (contentBytes > MAX_CONTEXT_BYTES) {
      throw new Error(
        `Canonical context exceeds the ${MAX_CONTEXT_BYTES}-byte turn limit.`,
      );
    }
    const content = bytes.toString('utf8');
    assertNoSecretMaterial(content, `Canonical content ${source.ref.id}`);
    const provenance = requireProvenance(source.ref);
    sections.push({
      kind: source.kind,
      id: source.ref.id,
      path: source.ref.path,
      content,
      provenance,
    });
    contextFragments.push({
      id: source.ref.id,
      contentRef: source.ref,
      scope: source.overlay
        ? {
          kind: 'runtime_overlay',
          runtimeId: input.runtimeId,
          base: { kind: 'user' },
        }
        : { kind: 'user' },
      provenance,
    });
  }

  const capabilities = descriptor.capabilities.map((capability) => ({
    id: capability.id,
    maturity: capability.maturity,
    referenceStatus: capability.referenceStatus,
    ...(capability.reason ? { reason: capability.reason } : {}),
  }));
  const executableCapabilityIds = new Set(
    descriptor.capabilities
      .filter((capability) => capability.execution === 'executable')
      .map((capability) => capability.id),
  );
  const projection = buildRuntimeProjection({
    runtimeId: input.runtimeId,
    contextFragments,
    capabilities,
    executableCapabilityIds,
    unavailableReasons: descriptor.capabilities
      .filter((capability) => capability.execution !== 'executable')
      .map((capability) => ({
        capabilityId: capability.id,
        reason:
          capability.reason
          ?? `Runtime "${input.runtimeId}" does not mount this capability.`,
      })),
    assetRefs: manifest.assetRefs,
    ...(overlay ? { overlay } : {}),
  });
  const definitions = [
    ...manifest.definition.skillRefs.map((ref) => descriptorFor('skill', ref)),
    ...manifest.definition.mcpRefs.map((ref) => descriptorFor('mcp', ref)),
  ];

  return {
    repositoryRoot: input.repository.root,
    generation: manifest.generation,
    runtimeId: input.runtimeId,
    projection,
    sections,
    definitions,
    secretRefs: manifest.secretRefs,
    diagnostics: {
      source: 'canonical_repository',
      contentBytes,
      definitionCount: definitions.length,
      assetCount: manifest.assetRefs.length,
    },
  };
}

function sectionHeading(kind: CanonicalHarnessSectionKind): string {
  switch (kind) {
    case 'identity':
      return 'Identity';
    case 'rule':
      return 'Rules';
    case 'memory':
      return 'Memory';
    case 'preference':
      return 'Preferences';
    case 'feedback':
      return 'Feedback';
    case 'creative_method':
      return 'Creative methods';
    case 'runtime_overlay':
      return 'Runtime overlay';
  }
}

/**
 * Render the canonical projection without turning catalog entries into fake
 * tools. Every context block carries a source breadcrumb.
 */
export function renderCanonicalHarnessFragment(
  harness: CanonicalRuntimeHarness,
): string {
  const lines = [
    '## Your canonical Harness Home',
    '',
    `Source: ${harness.repositoryRoot} (generation ${harness.generation})`,
    'The following user-owned context applies to this turn.',
  ];
  for (const section of harness.sections) {
    lines.push(
      '',
      `### ${sectionHeading(section.kind)} — ${section.id}`,
      `Source file: ${section.path}`,
      section.content,
    );
  }
  if (harness.definitions.length > 0) {
    lines.push(
      '',
      '### Catalogued definitions (perceptible only)',
      'These definitions exist, but are not callable unless the current '
      + 'Runtime exposes a separately mounted tool with the same identity. '
      + 'Do not invent a call.',
    );
    for (const definition of harness.definitions) {
      lines.push(
        `- ${definition.kind}: ${definition.id} (${definition.path}) — `
        + 'catalogued, not mounted by this projection',
      );
    }
  }
  if (harness.projection.assetRefs.length > 0) {
    lines.push(
      '',
      '### Referenced assets',
      ...harness.projection.assetRefs.map((asset) =>
        `- ${asset.assetId}${asset.kind ? ` (${asset.kind})` : ''}`),
    );
  }
  return lines.join('\n').trimEnd();
}
