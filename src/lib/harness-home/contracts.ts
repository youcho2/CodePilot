/**
 * Framework-neutral Harness Home domain contracts.
 *
 * This layer describes user-owned data only. Filesystem conventions,
 * Runtime transports and database indexes belong to adapters.
 */

export const HARNESS_HOME_SCHEMA_VERSION = 1 as const;

export type HarnessId = string;
export type RuntimeIdRef = string;
export type AssetKindId = string;
export type ContentHash = string;

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];
export interface JsonObject {
  readonly [key: string]: JsonValue;
}

export type BaseHarnessScope =
  | { readonly kind: 'builtin' }
  | { readonly kind: 'user'; readonly userId?: string }
  | { readonly kind: 'assistant'; readonly assistantId: string }
  | {
      readonly kind: 'project';
      readonly projectId: string;
      readonly rootRef?: string;
    };

export type HarnessScope =
  | BaseHarnessScope
  | {
      readonly kind: 'runtime_overlay';
      readonly runtimeId: RuntimeIdRef;
      readonly base: BaseHarnessScope;
    };

export interface PortableContentRef {
  readonly id: string;
  readonly path: string;
  readonly contentHash: ContentHash;
  readonly mediaType?: string;
  readonly [key: string]: JsonValue | undefined;
}

export interface AssetRef {
  readonly assetId: string;
  readonly kind?: AssetKindId;
  readonly contentHash?: ContentHash;
  readonly [key: string]: JsonValue | undefined;
}

export type ProvenanceSourceKind =
  | 'user_file'
  | 'codepilot'
  | 'external_framework'
  | 'runtime'
  | 'migration'
  | 'generated';

export interface Provenance {
  readonly sourceKind: ProvenanceSourceKind;
  readonly sourceRef: string;
  readonly observedAt: string;
  readonly contentHash?: ContentHash;
  readonly runtimeId?: RuntimeIdRef;
  readonly providerId?: string;
  readonly modelId?: string;
  readonly sessionId?: string;
  readonly jobId?: string;
  readonly methodRef?: string;
  readonly secretMaterial: 'absent' | 'stripped';
  readonly [key: string]: JsonValue | undefined;
}

export interface SecretRef {
  readonly scheme: 'secret';
  readonly namespace:
    | 'codepilot-setting'
    | 'codepilot-provider'
    | 'environment'
    | 'external-owned'
    | (string & {});
  readonly key: string;
  readonly scope: string;
  readonly version: number;
}

export interface HarnessDefinitionIndex {
  readonly identityRefs: readonly PortableContentRef[];
  readonly ruleRefs: readonly PortableContentRef[];
  readonly skillRefs: readonly PortableContentRef[];
  readonly mcpRefs: readonly PortableContentRef[];
  readonly creativeMethodRefs: readonly PortableContentRef[];
  readonly [key: string]: JsonValue | readonly PortableContentRef[] | undefined;
}

export interface HarnessStateIndex {
  readonly memoryRefs: readonly PortableContentRef[];
  readonly preferenceRefs: readonly PortableContentRef[];
  readonly feedbackRefs: readonly PortableContentRef[];
  readonly [key: string]: JsonValue | readonly PortableContentRef[] | undefined;
}

export interface RuntimeOverlayRecord {
  readonly runtimeId: RuntimeIdRef;
  readonly definitionRefs: readonly PortableContentRef[];
  readonly stateRefs: readonly PortableContentRef[];
  readonly data?: JsonObject;
  readonly [key: string]:
    | JsonValue
    | readonly PortableContentRef[]
    | undefined;
}

export interface HarnessHomeManifest {
  readonly schemaVersion: typeof HARNESS_HOME_SCHEMA_VERSION;
  readonly harnessId: HarnessId;
  readonly generation: number;
  readonly writtenAt: string;
  readonly definition: HarnessDefinitionIndex;
  readonly state: HarnessStateIndex;
  readonly assetRefs: readonly AssetRef[];
  /**
   * Runtime IDs are opaque keys. Unknown overlays are preserved by the
   * manifest parser even when no adapter is installed.
   */
  readonly runtimeOverlays: Readonly<Record<string, RuntimeOverlayRecord>>;
  readonly secretRefs: readonly SecretRef[];
  readonly [key: string]:
    | JsonValue
    | HarnessDefinitionIndex
    | HarnessStateIndex
    | readonly AssetRef[]
    | Readonly<Record<string, RuntimeOverlayRecord>>
    | readonly SecretRef[]
    | undefined;
}

export type CapabilityMaturity = 'draft' | 'stable';
export type ReferenceStatus = 'pending' | 'executable' | 'rejected';

export interface CanonicalCapabilityRef {
  readonly id: string;
  readonly maturity: CapabilityMaturity;
  readonly referenceStatus: ReferenceStatus;
  readonly reason?: string;
}

export interface CapabilityGap {
  readonly capabilityId: string;
  readonly reason: string;
  readonly suggestedRuntimeId?: RuntimeIdRef;
}

export interface ContextFragment {
  readonly id: string;
  readonly contentRef: PortableContentRef;
  readonly scope: HarnessScope;
  readonly provenance: Provenance;
}

export interface RuntimeProjection {
  readonly runtimeId: RuntimeIdRef;
  readonly contextFragments: readonly ContextFragment[];
  readonly executableCapabilities: readonly CanonicalCapabilityRef[];
  readonly perceptibleOnlyCapabilities: readonly CanonicalCapabilityRef[];
  readonly unavailableReasons: readonly CapabilityGap[];
  readonly assetRefs: readonly AssetRef[];
  readonly overlay?: RuntimeOverlayRecord;
}

export interface CreativeMethodDefinition {
  readonly id: string;
  readonly version: string;
  readonly source: Provenance;
  readonly scope: HarnessScope;
  readonly triggers: readonly string[];
  readonly nonTriggers: readonly string[];
  readonly inputs: readonly string[];
  readonly outputs: readonly string[];
  readonly steps: readonly string[];
  readonly modalities: readonly string[];
  readonly referenceRefs: readonly AssetRef[];
  readonly counterexampleRefs: readonly AssetRef[];
  readonly critiqueCriteria: readonly string[];
  readonly progressiveDisclosureRef: PortableContentRef;
}

export type TasteMemoryClass =
  | 'one_off'
  | 'project_preference'
  | 'durable_user_preference'
  | 'builtin_principle';

export interface TasteMemoryEvidence {
  readonly id: string;
  readonly classification: TasteMemoryClass;
  readonly statement: string;
  readonly evidenceRef: PortableContentRef | AssetRef;
  readonly scope: HarnessScope;
  readonly confidence: number;
  readonly createdAt: string;
  readonly lastConfirmedAt?: string;
  readonly revokedAt?: string;
  readonly affectedMethodIds: readonly string[];
}
