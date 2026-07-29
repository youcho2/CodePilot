export type AutoDisclosurePhase = 'active' | 'settled';

export interface AutoDisclosureOverride {
  phase: AutoDisclosurePhase;
  expanded: boolean;
}

/**
 * Active work opens automatically; settled work closes automatically.
 * A manual choice applies only to the phase in which it was made so a status
 * transition can still perform the expected open/close behavior.
 */
export function resolveAutoDisclosure(
  phase: AutoDisclosurePhase,
  override: AutoDisclosureOverride | null,
): boolean {
  if (override?.phase === phase) return override.expanded;
  return phase === 'active';
}
