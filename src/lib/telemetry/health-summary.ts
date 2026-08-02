import fs from 'node:fs';
import path from 'node:path';

interface HealthState {
  version: 1;
  buckets: Record<string, number>;
}

export interface HealthSummaryInput {
  release: string;
  category: string;
  providerClass?: string;
  runtimeId?: string;
}

const TTL_MS = 24 * 60 * 60 * 1000;
const MAX_BUCKETS = 64;

function token(value: string | undefined): string {
  if (!value) return 'unknown';
  return /^[a-z0-9_.@-]{1,64}$/i.test(value) ? value.toLowerCase() : 'other';
}

export function healthSummaryBucket(input: HealthSummaryInput): string {
  return [
    token(input.release),
    token(input.category),
    token(input.providerClass),
    token(input.runtimeId),
  ].join('|');
}

function readState(filePath: string): HealthState {
  try {
    const value = JSON.parse(fs.readFileSync(filePath, 'utf8')) as Partial<HealthState>;
    if (value.version !== 1 || !value.buckets || typeof value.buckets !== 'object') {
      return { version: 1, buckets: {} };
    }
    const buckets: Record<string, number> = {};
    for (const [key, timestamp] of Object.entries(value.buckets)) {
      if (typeof timestamp === 'number' && Number.isFinite(timestamp)) buckets[key] = timestamp;
    }
    return { version: 1, buckets };
  } catch {
    return { version: 1, buckets: {} };
  }
}

/**
 * Persist the release-scoped user-action health budget before capture. This
 * makes the 24-hour cap survive Next server restarts. The file contains only
 * stable enums and timestamps; no user or provider configuration is stored.
 */
export function claimHealthSummary(
  filePath: string,
  input: HealthSummaryInput,
  now = Date.now(),
): boolean {
  const state = readState(filePath);
  for (const [key, timestamp] of Object.entries(state.buckets)) {
    if (now - timestamp >= TTL_MS) delete state.buckets[key];
  }

  const bucket = healthSummaryBucket(input);
  const previous = state.buckets[bucket];
  if (previous !== undefined && now - previous < TTL_MS) return false;
  state.buckets[bucket] = now;

  const ordered = Object.entries(state.buckets).sort((left, right) => right[1] - left[1]);
  state.buckets = Object.fromEntries(ordered.slice(0, MAX_BUCKETS));

  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(state), { mode: 0o600 });
  fs.renameSync(temporary, filePath);
  return true;
}
