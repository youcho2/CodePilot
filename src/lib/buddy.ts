/**
 * Buddy System — deterministic AI companion generation.
 * Inspired by Claude Code's companion.ts.
 *
 * Each assistant workspace gets a unique buddy based on a hash of the
 * workspace path + creation timestamp. Rarity is probability-controlled
 * (60% common → 1% legendary) to ensure fair global distribution.
 */

// ── Species ────────────────────────────────────────────────────────

export const SPECIES = [
  'cat', 'duck', 'dragon', 'owl', 'penguin', 'turtle', 'octopus', 'ghost',
  'axolotl', 'capybara', 'robot', 'rabbit', 'mushroom', 'fox', 'panda', 'whale',
] as const;

export type Species = typeof SPECIES[number];

export const SPECIES_EMOJI: Record<Species, string> = {
  cat: '🐱', duck: '🦆', dragon: '🐉', owl: '🦉', penguin: '🐧',
  turtle: '🐢', octopus: '🐙', ghost: '👻', axolotl: '🦎', capybara: '🦫',
  robot: '🤖', rabbit: '🐰', mushroom: '🍄', fox: '🦊', panda: '🐼', whale: '🐋',
};

export const SPECIES_LABEL: Record<Species, { en: string; zh: string }> = {
  cat: { en: 'Cat', zh: '猫咪' }, duck: { en: 'Duck', zh: '鸭子' },
  dragon: { en: 'Dragon', zh: '龙' }, owl: { en: 'Owl', zh: '猫头鹰' },
  penguin: { en: 'Penguin', zh: '企鹅' }, turtle: { en: 'Turtle', zh: '海龟' },
  octopus: { en: 'Octopus', zh: '章鱼' }, ghost: { en: 'Ghost', zh: '幽灵' },
  axolotl: { en: 'Axolotl', zh: '六角龙' }, capybara: { en: 'Capybara', zh: '水豚' },
  robot: { en: 'Robot', zh: '机器人' }, rabbit: { en: 'Rabbit', zh: '兔子' },
  mushroom: { en: 'Mushroom', zh: '蘑菇' }, fox: { en: 'Fox', zh: '狐狸' },
  panda: { en: 'Panda', zh: '熊猫' }, whale: { en: 'Whale', zh: '鲸鱼' },
};

// ── Rarity ─────────────────────────────────────────────────────────

export type Rarity = 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary';

const RARITY_WEIGHTS: Record<Rarity, number> = {
  common: 60, uncommon: 25, rare: 10, epic: 4, legendary: 1,
};

const RARITY_FLOORS: Record<Rarity, number> = {
  common: 5, uncommon: 15, rare: 25, epic: 35, legendary: 50,
};

export const RARITY_DISPLAY: Record<Rarity, { stars: string; label: { en: string; zh: string } }> = {
  common: { stars: '★', label: { en: 'Common', zh: '普通' } },
  uncommon: { stars: '★★', label: { en: 'Uncommon', zh: '稀有' } },
  rare: { stars: '★★★', label: { en: 'Rare', zh: '精良' } },
  epic: { stars: '★★★★', label: { en: 'Epic', zh: '史诗' } },
  legendary: { stars: '★★★★★', label: { en: 'Legendary', zh: '传说' } },
};

// ── Stats ──────────────────────────────────────────────────────────

export const STAT_NAMES = ['creativity', 'patience', 'insight', 'humor', 'precision'] as const;
export type StatName = typeof STAT_NAMES[number];

export const STAT_LABEL: Record<string, { en: string; zh: string }> = {
  creativity: { en: 'Creativity', zh: '创意' },
  patience: { en: 'Patience', zh: '耐心' },
  insight: { en: 'Insight', zh: '洞察' },
  humor: { en: 'Humor', zh: '幽默' },
  precision: { en: 'Precision', zh: '精确' },
};

// Mapping from peak stat to soul.md personality hint
export const STAT_PERSONALITY_HINTS: Record<StatName, { en: string; zh: string }> = {
  creativity: { en: 'You excel at creative solutions and unexpected suggestions.', zh: '你擅长给出创意方案和意想不到的建议。' },
  patience: { en: 'You are very patient, explaining things step by step.', zh: '你非常耐心，善于一步步解释清楚。' },
  insight: { en: 'You are great at analyzing the essence of problems.', zh: '你善于分析问题的本质。' },
  humor: { en: 'You add appropriate humor to make interactions enjoyable.', zh: '你会适当加入幽默，让交流更轻松。' },
  precision: { en: 'You focus on details and accuracy.', zh: '你注重细节和准确性。' },
};

// ── Data Types ─────────────────────────────────────────────────────

export interface BuddyData {
  species: Species;
  rarity: Rarity;
  stats: Record<StatName, number>;
  emoji: string;
  peakStat: StatName;
  hatchedAt: string;
}

// ── PRNG (Mulberry32, same as Claude Code) ─────────────────────────

function mulberry32(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (s + 0x6D2B79F5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashString(str: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

// ── Generation ─────────────────────────────────────────────────────

function pickRandom<T>(rng: () => number, arr: readonly T[]): T {
  return arr[Math.floor(rng() * arr.length)]!;
}

function rollRarity(rng: () => number): Rarity {
  const total = Object.values(RARITY_WEIGHTS).reduce((a, b) => a + b, 0);
  let roll = rng() * total;
  for (const [rarity, weight] of Object.entries(RARITY_WEIGHTS) as [Rarity, number][]) {
    roll -= weight;
    if (roll <= 0) return rarity;
  }
  return 'common';
}

function shuffle<T>(arr: T[], rng: () => number): void {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j]!, arr[i]!];
  }
}

function rollStats(rng: () => number, rarity: Rarity): { stats: Record<StatName, number>; peakStat: StatName } {
  const floor = RARITY_FLOORS[rarity];
  const names = [...STAT_NAMES];
  shuffle(names, rng);

  const stats = {} as Record<StatName, number>;
  // Peak stat (first after shuffle)
  stats[names[0]!] = Math.min(100, floor + 50 + Math.floor(rng() * 30));
  // Dump stat (second)
  stats[names[1]!] = Math.max(1, floor - 10 + Math.floor(rng() * 15));
  // Scatter (rest)
  for (let i = 2; i < names.length; i++) {
    stats[names[i]!] = floor + Math.floor(rng() * 40);
  }

  return { stats, peakStat: names[0]! };
}

/**
 * Generate a deterministic buddy from a seed string.
 * Same seed always produces the same buddy.
 *
 * @param seed - Usually `workspacePath + ':' + createdAt`
 */
export function generateBuddy(seed: string): BuddyData {
  const hash = hashString(seed + ':buddy-2026');
  const rng = mulberry32(hash);

  const rarity = rollRarity(rng);
  const species = pickRandom(rng, SPECIES);
  const { stats, peakStat } = rollStats(rng, rarity);
  const emoji = SPECIES_EMOJI[species];

  return {
    species,
    rarity,
    stats,
    emoji,
    peakStat,
    hatchedAt: new Date().toISOString(),
  };
}

/**
 * Get the personality hint for a buddy's peak stat.
 */
export function getPeakStatHint(peakStat: StatName, lang: 'en' | 'zh' = 'zh'): string {
  return STAT_PERSONALITY_HINTS[peakStat][lang];
}

/** Get Tailwind color class for a rarity string. */
export function rarityColor(rarity: string): string {
  const colors: Record<string, string> = {
    common: 'text-muted-foreground',
    uncommon: 'text-green-500',
    rare: 'text-blue-500',
    epic: 'text-purple-500',
    legendary: 'text-amber-500',
  };
  return colors[rarity] ?? 'text-muted-foreground';
}
