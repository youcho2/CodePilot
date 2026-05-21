/**
 * CodePilot Monolith app icon — the canonical brand mark.
 *
 * Used in three brand-anchor surfaces:
 *   1. Runtime selector / Runtime panel (Settings → Runtime) — the
 *      visual identity of the "CodePilot Runtime" engine entry.
 *   2. Welcome page (empty chat session) — the brand greeting.
 *   3. About page (Settings → About) — the canonical brand surface.
 *
 * Design:
 *   - 5×5 grid of squares→circles that fade from solid (top-left) to
 *     dispersed (bottom-right). Carries the "context dispersing into
 *     answers" metaphor.
 *   - Shape fills route through `currentColor` so the icon picks up
 *     `text-foreground` (or whatever color the parent sets) and works
 *     in both light and dark themes without per-mode SVG variants.
 *   - The original SVG uses `#252525` baked in; we preserve every
 *     opacity stop (1.0 / 0.82 / 0.58 / 0.34 / 0.1 / 0.08) so the
 *     gradient effect is identical to the master file.
 *   - Inner-shadow filter values are baked in (white at 25% alpha)
 *     which gives the rounded squares their glossy lift in both modes.
 *
 * Sizes: pass `size` (px) for a fixed render, OR omit `size` and rely
 * on the parent's `className="w-X h-X"` for responsive sizing.
 */

import type { CSSProperties } from 'react';
import { cn } from '@/lib/utils';

interface MonolithIconProps {
  className?: string;
  /** Optional pixel size — leave undefined to fill parent via CSS. */
  size?: number;
  style?: CSSProperties;
}

export function MonolithIcon({ className, size, style }: MonolithIconProps) {
  const sized: CSSProperties | undefined = size != null
    ? { width: size, height: size, ...style }
    : style;
  return (
    // viewBox cropped from the master SVG's 0-903 to 138-762 (~625 wide).
    // The master file ships with ~150px of padding on every side; at the
    // small sizes we render in RuntimeSelector / Settings (16-20px) that
    // padding made the icon visibly smaller (≈66%) than peer brand icons
    // (Anthropic / OpenAI) which fill their full square. Tight crop here
    // brings content to ~95% of the rendered box so the icon matches
    // peer sizing across all use sites (selector, panels, welcome, About).
    // The blurred halo (opacity 0.08) loses a few pixels at the right /
    // bottom but it's already nearly invisible at every size we render.
    <svg
      viewBox="138 138 625 625"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={cn('text-foreground', className)}
      style={sized}
      role="img"
      aria-label="CodePilot"
    >
      <g filter="url(#monolith_inner_shadow)">
        <g opacity="0.08" filter="url(#monolith_backdrop_blur)">
          <path
            d="M632 150H270.5C203.95 150 150 188.535 150 236.071V666.429C150 713.964 203.95 752.5 270.5 752.5H632C698.55 752.5 752.5 713.964 752.5 666.429V236.071C752.5 188.535 698.55 150 632 150Z"
            fill="currentColor"
          />
        </g>
        <path d="M214.5 150.5H182.5C164.827 150.5 150.5 164.827 150.5 182.5V214.5C150.5 232.173 164.827 246.5 182.5 246.5H214.5C232.173 246.5 246.5 232.173 246.5 214.5V182.5C246.5 164.827 232.173 150.5 214.5 150.5Z" fill="currentColor" />
        <path d="M214.5 278.5H182.5C164.827 278.5 150.5 292.827 150.5 310.5V342.5C150.5 360.173 164.827 374.5 182.5 374.5H214.5C232.173 374.5 246.5 360.173 246.5 342.5V310.5C246.5 292.827 232.173 278.5 214.5 278.5Z" fill="currentColor" />
        <path d="M214.5 406.5H182.5C164.827 406.5 150.5 420.827 150.5 438.5V470.5C150.5 488.173 164.827 502.5 182.5 502.5H214.5C232.173 502.5 246.5 488.173 246.5 470.5V438.5C246.5 420.827 232.173 406.5 214.5 406.5Z" fill="currentColor" />
        <path opacity="0.82" d="M208.58 540.58H188.58C170.907 540.58 156.58 554.907 156.58 572.58V592.58C156.58 610.253 170.907 624.58 188.58 624.58H208.58C226.253 624.58 240.58 610.253 240.58 592.58V572.58C240.58 554.907 226.253 540.58 208.58 540.58Z" fill="currentColor" />
        <path opacity="0.58" d="M200.58 676.58H196.58C178.907 676.58 164.58 690.907 164.58 708.58V712.58C164.58 730.253 178.907 744.58 196.58 744.58H200.58C218.253 744.58 232.58 730.253 232.58 712.58V708.58C232.58 690.907 218.253 676.58 200.58 676.58Z" fill="currentColor" />
        <path d="M342.5 150.5H310.5C292.827 150.5 278.5 164.827 278.5 182.5V214.5C278.5 232.173 292.827 246.5 310.5 246.5H342.5C360.173 246.5 374.5 232.173 374.5 214.5V182.5C374.5 164.827 360.173 150.5 342.5 150.5Z" fill="currentColor" />
        <path d="M342.5 278.5H310.5C292.827 278.5 278.5 292.827 278.5 310.5V342.5C278.5 360.173 292.827 374.5 310.5 374.5H342.5C360.173 374.5 374.5 360.173 374.5 342.5V310.5C374.5 292.827 360.173 278.5 342.5 278.5Z" fill="currentColor" />
        <path opacity="0.82" d="M336.58 412.58H316.58C298.907 412.58 284.58 426.907 284.58 444.58V464.58C284.58 482.253 298.907 496.58 316.58 496.58H336.58C354.253 496.58 368.58 482.253 368.58 464.58V444.58C368.58 426.907 354.253 412.58 336.58 412.58Z" fill="currentColor" />
        <path opacity="0.58" d="M328.58 548.58H324.58C306.907 548.58 292.58 562.907 292.58 580.58V584.58C292.58 602.253 306.907 616.58 324.58 616.58H328.58C346.253 616.58 360.58 602.253 360.58 584.58V580.58C360.58 562.907 346.253 548.58 328.58 548.58Z" fill="currentColor" />
        <path opacity="0.34" d="M352.58 710.58C352.58 696.221 340.939 684.58 326.58 684.58C312.221 684.58 300.58 696.221 300.58 710.58C300.58 724.939 312.221 736.58 326.58 736.58C340.939 736.58 352.58 724.939 352.58 710.58Z" fill="currentColor" />
        <path d="M470.5 150.5H438.5C420.827 150.5 406.5 164.827 406.5 182.5V214.5C406.5 232.173 420.827 246.5 438.5 246.5H470.5C488.173 246.5 502.5 232.173 502.5 214.5V182.5C502.5 164.827 488.173 150.5 470.5 150.5Z" fill="currentColor" />
        <path opacity="0.82" d="M464.58 284.58H444.58C426.907 284.58 412.58 298.907 412.58 316.58V336.58C412.58 354.253 426.907 368.58 444.58 368.58H464.58C482.253 368.58 496.58 354.253 496.58 336.58V316.58C496.58 298.907 482.253 284.58 464.58 284.58Z" fill="currentColor" />
        <path opacity="0.58" d="M456.58 420.58H452.58C434.907 420.58 420.58 434.907 420.58 452.58V456.58C420.58 474.253 434.907 488.58 452.58 488.58H456.58C474.253 488.58 488.58 474.253 488.58 456.58V452.58C488.58 434.907 474.253 420.58 456.58 420.58Z" fill="currentColor" />
        <path opacity="0.34" d="M480.58 582.58C480.58 568.221 468.939 556.58 454.58 556.58C440.221 556.58 428.58 568.221 428.58 582.58C428.58 596.939 440.221 608.58 454.58 608.58C468.939 608.58 480.58 596.939 480.58 582.58Z" fill="currentColor" />
        <path opacity="0.1" d="M456.58 692.58H452.58C443.744 692.58 436.58 699.744 436.58 708.58V712.58C436.58 721.417 443.744 728.58 452.58 728.58H456.58C465.417 728.58 472.58 721.417 472.58 712.58V708.58C472.58 699.744 465.417 692.58 456.58 692.58Z" fill="currentColor" />
        <path opacity="0.82" d="M592.58 156.58H572.58C554.907 156.58 540.58 170.907 540.58 188.58V208.58C540.58 226.253 554.907 240.58 572.58 240.58H592.58C610.253 240.58 624.58 226.253 624.58 208.58V188.58C624.58 170.907 610.253 156.58 592.58 156.58Z" fill="currentColor" />
        <path opacity="0.58" d="M584.58 292.58H580.58C562.907 292.58 548.58 306.907 548.58 324.58V328.58C548.58 346.253 562.907 360.58 580.58 360.58H584.58C602.253 360.58 616.58 346.253 616.58 328.58V324.58C616.58 306.907 602.253 292.58 584.58 292.58Z" fill="currentColor" />
        <path opacity="0.34" d="M608.58 454.58C608.58 440.221 596.939 428.58 582.58 428.58C568.221 428.58 556.58 440.221 556.58 454.58C556.58 468.939 568.221 480.58 582.58 480.58C596.939 480.58 608.58 468.939 608.58 454.58Z" fill="currentColor" />
        <path opacity="0.1" d="M584.58 564.58H580.58C571.744 564.58 564.58 571.743 564.58 580.58V584.58C564.58 593.417 571.744 600.58 580.58 600.58H584.58C593.417 600.58 600.58 593.417 600.58 584.58V580.58C600.58 571.743 593.417 564.58 584.58 564.58Z" fill="currentColor" />
        <path opacity="0.58" d="M712.58 164.58H708.58C690.907 164.58 676.58 178.907 676.58 196.58V200.58C676.58 218.253 690.907 232.58 708.58 232.58H712.58C730.253 232.58 744.58 218.253 744.58 200.58V196.58C744.58 178.907 730.253 164.58 712.58 164.58Z" fill="currentColor" />
        <path opacity="0.34" d="M736.58 326.58C736.58 312.221 724.939 300.58 710.58 300.58C696.221 300.58 684.58 312.221 684.58 326.58C684.58 340.94 696.221 352.58 710.58 352.58C724.939 352.58 736.58 340.94 736.58 326.58Z" fill="currentColor" />
        <path opacity="0.1" d="M712.58 436.58H708.58C699.744 436.58 692.58 443.743 692.58 452.58V456.58C692.58 465.417 699.744 472.58 708.58 472.58H712.58C721.417 472.58 728.58 465.417 728.58 456.58V452.58C728.58 443.743 721.417 436.58 712.58 436.58Z" fill="currentColor" />
      </g>
      <defs>
        <filter id="monolith_inner_shadow" x="150" y="150" width="612.5" height="610" filterUnits="userSpaceOnUse" colorInterpolationFilters="sRGB">
          <feFlood floodOpacity="0" result="BackgroundImageFix" />
          <feBlend mode="normal" in="SourceGraphic" in2="BackgroundImageFix" result="shape" />
          <feColorMatrix in="SourceAlpha" type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 127 0" result="hardAlpha" />
          <feOffset dx="10" dy="7.5" />
          <feGaussianBlur stdDeviation="10" />
          <feComposite in2="hardAlpha" operator="arithmetic" k2="-1" k3="1" />
          <feColorMatrix type="matrix" values="0 0 0 0 1 0 0 0 0 1 0 0 0 0 1 0 0 0 0.25 0" />
          <feBlend mode="normal" in2="shape" result="effect1_innerShadow" />
        </filter>
        <filter id="monolith_backdrop_blur" x="0" y="0" width="902.5" height="902.5" filterUnits="userSpaceOnUse" colorInterpolationFilters="sRGB">
          <feFlood floodOpacity="0" result="BackgroundImageFix" />
          <feBlend mode="normal" in="SourceGraphic" in2="BackgroundImageFix" result="shape" />
          <feGaussianBlur stdDeviation="75" result="effect1_foregroundBlur" />
        </filter>
      </defs>
    </svg>
  );
}
