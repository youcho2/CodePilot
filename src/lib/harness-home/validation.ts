import type {
  CanonicalCapabilityRef,
  CreativeMethodDefinition,
  RuntimeProjection,
  TasteMemoryEvidence,
} from './contracts';
import { assertCompleteProvenance } from './provenance';
import { isSecretRef } from './secret-ref';

const SECRET_KEY_PATTERN =
  /^(api[_-]?key|access[_-]?token|refresh[_-]?token|authorization|password|client[_-]?secret|private[_-]?key)$/i;

const SECRET_VALUE_PATTERNS: readonly RegExp[] = [
  /\bBearer\s+[A-Za-z0-9._~+/-]{8,}=*/i,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /\b(?:sk|ghp|gh_pat|xai)-[A-Za-z0-9_-]{12,}\b/i,
];

export interface SecretLeak {
  readonly path: string;
  readonly reason: string;
}

export function findSecretLeaks(
  value: unknown,
  currentPath = '$',
): readonly SecretLeak[] {
  if (isSecretRef(value)) return [];

  if (typeof value === 'string') {
    return SECRET_VALUE_PATTERNS
      .filter((pattern) => pattern.test(value))
      .map((pattern) => ({
        path: currentPath,
        reason: `value matches forbidden secret pattern ${pattern.source}`,
      }));
  }
  if (!value || typeof value !== 'object') return [];

  if (Array.isArray(value)) {
    return value.flatMap((entry, index) =>
      findSecretLeaks(entry, `${currentPath}[${index}]`));
  }

  const leaks: SecretLeak[] = [];
  for (const [key, entry] of Object.entries(value)) {
    const entryPath = `${currentPath}.${key}`;
    if (
      SECRET_KEY_PATTERN.test(key)
      && typeof entry === 'string'
      && entry.trim()
    ) {
      leaks.push({
        path: entryPath,
        reason: `field "${key}" contains inline secret material`,
      });
      continue;
    }
    leaks.push(...findSecretLeaks(entry, entryPath));
  }
  return leaks;
}

export function assertNoSecretMaterial(value: unknown, label = 'value'): void {
  const leaks = findSecretLeaks(value);
  if (leaks.length > 0) {
    const summary = leaks
      .slice(0, 3)
      .map((leak) => `${leak.path}: ${leak.reason}`)
      .join('; ');
    throw new Error(`${label} contains forbidden secret material: ${summary}`);
  }
}

export function validateCanonicalCapability(
  capability: CanonicalCapabilityRef,
): void {
  if (!capability.id.trim()) {
    throw new Error('Canonical capability id must not be empty.');
  }
  if (
    capability.maturity === 'stable'
    && capability.referenceStatus !== 'executable'
  ) {
    throw new Error(
      `Stable capability "${capability.id}" must be executable in the reference Runtime.`,
    );
  }
  if (
    capability.maturity === 'draft'
    && capability.referenceStatus === 'rejected'
    && !capability.reason
  ) {
    throw new Error(`Rejected capability "${capability.id}" requires a reason.`);
  }
}

export function validateRuntimeProjection(projection: RuntimeProjection): void {
  if (!projection.runtimeId.trim()) {
    throw new Error('Runtime projection requires an opaque runtimeId.');
  }
  projection.executableCapabilities.forEach(validateCanonicalCapability);
  projection.perceptibleOnlyCapabilities.forEach((capability) => {
    validateCanonicalCapability(capability);
    if (
      capability.maturity === 'stable'
      && capability.referenceStatus === 'executable'
    ) {
      throw new Error(
        `Executable stable capability "${capability.id}" cannot be marked perceptible-only.`,
      );
    }
  });
  for (const fragment of projection.contextFragments) {
    assertCompleteProvenance(fragment.provenance, `fragment ${fragment.id}`);
  }
}

export function validateCreativeMethod(method: CreativeMethodDefinition): void {
  if (!method.id || !method.version || method.steps.length === 0) {
    throw new Error('Creative Method requires id, version and at least one step.');
  }
  if (method.critiqueCriteria.length === 0) {
    throw new Error(`Creative Method "${method.id}" requires critique criteria.`);
  }
  assertCompleteProvenance(method.source, `method ${method.id}`);
}

export function validateTasteMemoryEvidence(
  evidence: TasteMemoryEvidence,
): void {
  if (!evidence.statement.trim()) {
    throw new Error('Taste Memory statement must not be empty.');
  }
  if (evidence.confidence < 0 || evidence.confidence > 1) {
    throw new Error('Taste Memory confidence must be between 0 and 1.');
  }
  if (
    evidence.classification === 'durable_user_preference'
    && !evidence.lastConfirmedAt
  ) {
    throw new Error(
      'Durable user preference requires an explicit confirmation timestamp.',
    );
  }
}
