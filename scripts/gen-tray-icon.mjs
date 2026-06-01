/**
 * Generate the macOS menubar Tray TEMPLATE icons from the brand mark.
 *
 * A macOS template image is monochrome: macOS ignores RGB and renders the
 * ALPHA channel in the system menubar color (black in light mode, white in
 * dark mode). So we turn the dark-on-light brand glyph (build/icon-source.png)
 * into black pixels whose alpha = inverted luminance — the dark dot-matrix
 * becomes opaque, the light background becomes transparent. This keeps the
 * brand's fade while satisfying the template-image contract, instead of
 * resizing the full-color app icon (icon.icns) — which renders as an
 * unbranded blob and ignores dark/light menubar adaptation.
 *
 * One-off / regen-on-rebrand. Outputs:
 *   build/trayTemplate.png      (16x16, @1x)
 *   build/trayTemplate@2x.png   (32x32, retina)
 *
 * Run from repo root:  node scripts/gen-tray-icon.mjs
 */
import sharp from 'sharp';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(root, 'build', 'icon-source.png');

async function genTemplate(size, outFile) {
  // Flatten any app-icon transparency onto white so the rounded-corner mask
  // doesn't read as "shape", grayscale, then read raw luminance.
  const { data, info } = await sharp(SRC)
    .flatten({ background: '#ffffff' })
    .resize(size, size, { fit: 'contain', background: '#ffffff' })
    .toColourspace('b-w')
    .raw()
    .toBuffer({ resolveWithObject: true });

  const px = size * size;
  const ch = info.channels; // 1 for b-w
  const rgba = Buffer.alloc(px * 4);
  for (let i = 0; i < px; i++) {
    const lum = data[i * ch];
    rgba[i * 4 + 0] = 0;
    rgba[i * 4 + 1] = 0;
    rgba[i * 4 + 2] = 0;
    rgba[i * 4 + 3] = 255 - lum; // dark glyph → opaque, light bg → transparent
  }
  await sharp(rgba, { raw: { width: size, height: size, channels: 4 } })
    .png()
    .toFile(path.join(root, 'build', outFile));
  console.log('wrote build/' + outFile + ` (${size}x${size})`);
}

await genTemplate(16, 'trayTemplate.png');
await genTemplate(32, 'trayTemplate@2x.png');
console.log('[gen-tray-icon] done');
