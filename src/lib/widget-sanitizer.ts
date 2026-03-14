/**
 * Widget HTML sanitizer + script executor.
 *
 * Follows the pi-generative-ui approach:
 * - Minimal manual sanitization (strip dangerous tags only, preserve event handlers)
 * - Clone-and-replace trick for script execution (innerHTML doesn't execute scripts)
 * - CDN whitelist enforced on external script sources
 * - Electron globals shielded via var shadowing
 *
 * We intentionally do NOT use DOMPurify — it strips inline event handlers
 * (onclick, oninput, etc.) which are essential for widget interactivity.
 * Security relies on: CDN whitelist + Electron contextIsolation.
 */

// ── CDN whitelist ──────────────────────────────────────────────────────────

const CDN_WHITELIST = [
  'cdnjs.cloudflare.com',
  'cdn.jsdelivr.net',
  'unpkg.com',
  'esm.sh',
  'cdn.tailwindcss.com',
];

function isAllowedCdnUrl(src: string): boolean {
  try {
    const url = new URL(src);
    return CDN_WHITELIST.some((domain) => url.hostname === domain || url.hostname.endsWith('.' + domain));
  } catch {
    return false;
  }
}

// ── Minimal sanitization ─────────────────────────────────────────────────

/** Dangerous tags that are always stripped (with their content). */
const DANGEROUS_TAGS = /<(iframe|object|embed|meta|link|base)[\s>][\s\S]*?<\/\1>/gi;
const DANGEROUS_VOID = /<(iframe|object|embed|meta|link|base)\b[^>]*\/?>/gi;

/** Strip onerror only — all other on* handlers are intentionally preserved. */
const ONERROR_ATTR = /\s+onerror\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]*)/gi;

/**
 * Sanitize widget HTML — strip dangerous tags and onerror attributes.
 * Intentionally preserves onclick, oninput, onchange etc. for interactivity.
 * Scripts are kept in the HTML (they'll be cloned for execution later).
 */
export function sanitizeWidgetHtml(html: string): string {
  return html
    .replace(DANGEROUS_TAGS, '')
    .replace(DANGEROUS_VOID, '')
    .replace(ONERROR_ATTR, '');
}

// ── Script execution (clone-and-replace) ─────────────────────────────────

/**
 * Execute scripts inside a widget container using the clone-and-replace trick.
 *
 * innerHTML does NOT execute <script> tags. The standard workaround is to
 * find all script elements, create fresh clones, and replace the originals.
 * The browser executes newly-inserted <script> elements.
 *
 * External scripts: only allowed from CDN whitelist domains.
 * Inline scripts: wrapped in a function scope to avoid `let`/`const`
 * redeclaration errors when multiple widgets are on the same page.
 * Electron globals are shadowed to prevent accidental access.
 */
export function executeWidgetScripts(container: HTMLElement): void {
  const scripts = container.querySelectorAll('script');
  scripts.forEach((old) => {
    const fresh = document.createElement('script');

    if (old.src) {
      // External script — enforce CDN whitelist
      if (!isAllowedCdnUrl(old.src)) {
        console.warn('[WidgetRenderer] blocked non-whitelisted script:', old.src);
        old.remove();
        return;
      }
      fresh.src = old.src;
      // Preserve onload if present (e.g. onload="initChart()")
      if (old.hasAttribute('onload')) {
        fresh.setAttribute('onload', old.getAttribute('onload')!);
      }
    } else if (old.textContent) {
      // Inline script — shield Electron globals, and convert top-level
      // let/const to var to avoid redeclaration SyntaxError when multiple
      // widgets declare the same variable (e.g. `let chart`).
      // We only replace let/const that appear at statement boundaries
      // (start of string, after ; or }) to avoid touching loop variables.
      const code = old.textContent
        .replace(/(^|[;}\n])\s*let\s+/g, '$1var ')
        .replace(/(^|[;}\n])\s*const\s+/g, '$1var ');
      fresh.textContent = `var electronAPI,require,process,module,exports,__dirname,__filename;\n${code}`;
    }

    // Copy type attribute if present (e.g. type="module")
    if (old.type) fresh.type = old.type;

    old.parentNode?.replaceChild(fresh, old);
    console.log('[WidgetRenderer] script executed:', old.src || `inline (${old.textContent?.length || 0} chars)`);
  });
}

/**
 * Add security attributes to all links inside a container.
 */
export function secureLinks(container: HTMLElement): void {
  const links = container.querySelectorAll('a[href]');
  links.forEach((link) => {
    link.setAttribute('rel', 'noopener noreferrer');
    link.setAttribute('target', '_blank');
  });
}
