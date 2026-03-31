/**
 * Deterministic avatar generation using jdenticon.
 * Same name always produces the same avatar.
 */
import { toSvg } from 'jdenticon';

/**
 * Generate a deterministic SVG identicon from a name string.
 * @param name - The name to hash (assistant name or fallback)
 * @param size - SVG viewport size in pixels (default 64)
 * @returns SVG string
 */
export function generateIdenticon(name: string, size: number = 64): string {
  return toSvg(name || 'assistant', size, {
    lightness: {
      color: [0.4, 0.8],
      grayscale: [0.3, 0.7],
    },
    saturation: {
      color: 0.5,
      grayscale: 0.0,
    },
    backColor: 'transparent',
  });
}
