/**
 * Session-list timestamp formatting — `formatRelativeTime` (chat-list-utils).
 *
 * Locks the ≥7-day regression: the old `toLocaleDateString()` produced a full
 * `YYYY/M/D` that overflowed the fixed-width (now 46px) timestamp column and was
 * clipped to just the year (users saw "2026"). It must now render a compact
 * month/day date (with a 2-digit year only across years), never a bare year.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { formatRelativeTime } from '@/components/layout/chat-list-utils';
import type { TranslationKey } from '@/i18n';

// Echo the key + params so the relative branches are assertable without i18n.
const t = (key: TranslationKey, params?: Record<string, string | number>): string =>
  params ? `${key}:${JSON.stringify(params)}` : key;

const iso = (msAgo: number) => new Date(Date.now() - msAgo).toISOString();
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

describe('formatRelativeTime — relative buckets', () => {
  it('< 1 min → just now', () => {
    assert.equal(formatRelativeTime(iso(10_000), t), 'chatList.justNow');
  });
  it('minutes bucket carries the count', () => {
    assert.equal(formatRelativeTime(iso(5 * MIN), t), 'chatList.minutesAgo:{"n":5}');
  });
  it('hours bucket carries the count', () => {
    assert.equal(formatRelativeTime(iso(3 * HOUR), t), 'chatList.hoursAgo:{"n":3}');
  });
  it('days bucket (< 7d) carries the count', () => {
    assert.equal(formatRelativeTime(iso(2 * DAY), t), 'chatList.daysAgo:{"n":2}');
  });
});

describe('formatRelativeTime — ≥7 days shows a compact date, not a bare year', () => {
  it('same-year: month/day, never just the 4-digit year', () => {
    // A date 10 days ago that is still in the current calendar year. Skip the
    // rare window right after Jan 1 where 10 days ago is last year.
    const d = new Date(Date.now() - 10 * DAY);
    if (d.getFullYear() !== new Date().getFullYear()) return;
    const out = formatRelativeTime(d.toISOString(), t);
    assert.doesNotMatch(out, /^\d{4}$/, `must not be a bare year, got ${out}`);
    assert.ok(out.includes(String(d.getMonth() + 1)), `should include month, got ${out}`);
    assert.ok(out.includes(String(d.getDate())), `should include day, got ${out}`);
  });

  it('cross-year: includes a 2-digit year', () => {
    const d = new Date(Date.now() - 400 * DAY); // guaranteed a previous year
    const out = formatRelativeTime(d.toISOString(), t);
    assert.doesNotMatch(out, /^\d{4}$/, `must not be a bare year, got ${out}`);
    const yy = String(d.getFullYear()).slice(-2);
    assert.ok(out.includes(yy), `should include 2-digit year ${yy}, got ${out}`);
  });
});
