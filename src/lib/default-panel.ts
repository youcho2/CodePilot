export const DEFAULT_PANEL = 'none';
export const DEFAULT_PANEL_MIGRATION_KEY = 'migration:default_panel_none_20260729';

/**
 * `file_tree` was written to every legacy database, so it represents the old
 * product default rather than a reliably explicit preference. Reset that value
 * once; the migration marker then protects every later user choice.
 */
export function shouldResetLegacyDefaultPanel(
  currentValue: string | undefined,
  migrationMarker: string | undefined,
): boolean {
  if (migrationMarker) return false;
  return currentValue === undefined || currentValue === 'file_tree';
}
