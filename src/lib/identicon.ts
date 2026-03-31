/**
 * Deterministic avatar generation inspired by Vercel's identicon prototype.
 * Renders a pixel-grid pattern with colors derived from name hash.
 * Uses OKLCH color space for perceptual uniformity.
 */

/**
 * Simple hash function (Murmur3-like) for deterministic randomness.
 */
function hashString(str: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * Mulberry32 PRNG for deterministic random values from a seed.
 */
function mulberry32(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (s + 0x6D2B79F5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Generate a deterministic SVG identicon from a name string.
 * Renders a 5x5 symmetric pixel grid with a hue derived from the name.
 *
 * @param name - The name to hash
 * @param size - SVG viewport size in pixels (default 64)
 * @returns SVG string
 */
export function generateIdenticon(name: string, size: number = 64): string {
  const input = name || 'assistant';
  const hash = hashString(input);
  const rng = mulberry32(hash);

  // Derive hue from hash (0-360)
  const hue = hash % 360;
  // Two complementary colors for the pattern
  const fg = `oklch(0.65 0.18 ${hue})`;
  const bg = `oklch(0.92 0.04 ${hue})`;

  const grid = 5;
  const cellSize = size / grid;
  const cells: string[] = [];

  // Generate half the grid (left side) and mirror for symmetry
  for (let y = 0; y < grid; y++) {
    for (let x = 0; x < Math.ceil(grid / 2); x++) {
      const filled = rng() > 0.45;
      if (filled) {
        // Left side
        cells.push(
          `<rect x="${x * cellSize}" y="${y * cellSize}" width="${cellSize}" height="${cellSize}" fill="${fg}" rx="${cellSize * 0.15}"/>`
        );
        // Mirror (right side)
        const mirrorX = grid - 1 - x;
        if (mirrorX !== x) {
          cells.push(
            `<rect x="${mirrorX * cellSize}" y="${y * cellSize}" width="${cellSize}" height="${cellSize}" fill="${fg}" rx="${cellSize * 0.15}"/>`
          );
        }
      }
    }
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}">
    <rect width="${size}" height="${size}" fill="${bg}" rx="${size * 0.12}"/>
    ${cells.join('\n    ')}
  </svg>`;
}
