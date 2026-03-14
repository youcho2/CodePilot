/**
 * CSS variable bridge — maps Anthropic's generative-UI guideline variable names
 * to CodePilot's OKLCH design tokens so model-generated widgets inherit the
 * current theme automatically.
 *
 * The model generates HTML using Anthropic's CSS variable names (e.g.
 * `var(--color-text-primary)`). This bridge defines those variables in terms
 * of CodePilot's existing `:root` / `.dark` variables so the widgets look
 * native in both light and dark mode.
 */

export const WIDGET_CSS_BRIDGE = /* css */ `
/* ── Backgrounds ──────────────────────────────────── */
--color-background-primary:   var(--background);
--color-background-secondary: var(--card);
--color-background-tertiary:  var(--muted);
--color-background-info:      var(--status-info-muted);
--color-background-danger:    var(--status-error-muted);
--color-background-success:   var(--status-success-muted);
--color-background-warning:   var(--status-warning-muted);

/* ── Text ─────────────────────────────────────────── */
--color-text-primary:         var(--foreground);
--color-text-secondary:       var(--muted-foreground);
--color-text-tertiary:        color-mix(in oklch, var(--muted-foreground) 60%, transparent);
--color-text-info:            var(--status-info-foreground);
--color-text-danger:          var(--status-error-foreground);
--color-text-success:         var(--status-success-foreground);
--color-text-warning:         var(--status-warning-foreground);

/* ── Borders ──────────────────────────────────────── */
--color-border-tertiary:      var(--border);
--color-border-secondary:     color-mix(in oklch, var(--border) 100%, transparent 0%);
--color-border-primary:       color-mix(in oklch, var(--foreground) 40%, transparent);
--color-border-info:          var(--status-info-border);
--color-border-danger:        var(--status-error-border);
--color-border-success:       var(--status-success-border);
--color-border-warning:       var(--status-warning-border);

/* ── Typography ───────────────────────────────────── */
--font-sans:                  var(--font-geist-sans), ui-sans-serif, system-ui, sans-serif;
--font-mono:                  var(--font-geist-mono), ui-monospace, monospace;
--font-serif:                 Georgia, 'Times New Roman', serif;

/* ── Layout ───────────────────────────────────────── */
--border-radius-md:           8px;
--border-radius-lg:           12px;
--border-radius-xl:           16px;

/* ── Chart palette (mapped from CodePilot chart-1~5) ─ */
--color-chart-1:              var(--chart-1);
--color-chart-2:              var(--chart-2);
--color-chart-3:              var(--chart-3);
--color-chart-4:              var(--chart-4);
--color-chart-5:              var(--chart-5);
`;

// ── Tailwind CDN loader ───────────────────────────────────────────────────

let tailwindLoaded = false;
let tailwindLoading = false;

/**
 * Load the Tailwind CSS CDN play script once globally.
 * It auto-observes DOM mutations and generates utility styles on the fly.
 * Theme is configured to use our CSS variable bridge for seamless integration.
 */
export function ensureTailwindCdn(): void {
  if (tailwindLoaded || tailwindLoading || typeof document === 'undefined') return;
  tailwindLoading = true;

  const script = document.createElement('script');
  script.src = 'https://cdn.tailwindcss.com/3.4.17';
  script.onload = () => {
    tailwindLoaded = true;
    // Configure Tailwind theme to use our design tokens
    const configScript = document.createElement('script');
    configScript.textContent = `
      if (window.tailwind) {
        tailwind.config = {
          corePlugins: { preflight: false },
          important: '.widget-root',
          theme: {
            extend: {
              colors: {
                surface: {
                  primary: 'var(--color-background-primary)',
                  secondary: 'var(--color-background-secondary)',
                  tertiary: 'var(--color-background-tertiary)',
                },
                content: {
                  primary: 'var(--color-text-primary)',
                  secondary: 'var(--color-text-secondary)',
                  tertiary: 'var(--color-text-tertiary)',
                },
                border: {
                  DEFAULT: 'var(--color-border-tertiary)',
                  secondary: 'var(--color-border-secondary)',
                  strong: 'var(--color-border-primary)',
                },
                info: { DEFAULT: 'var(--color-text-info)', bg: 'var(--color-background-info)', border: 'var(--color-border-info)' },
                success: { DEFAULT: 'var(--color-text-success)', bg: 'var(--color-background-success)', border: 'var(--color-border-success)' },
                warning: { DEFAULT: 'var(--color-text-warning)', bg: 'var(--color-background-warning)', border: 'var(--color-border-warning)' },
                danger: { DEFAULT: 'var(--color-text-danger)', bg: 'var(--color-background-danger)', border: 'var(--color-border-danger)' },
                purple: { 50: '#EEEDFE', 100: '#CECBF6', 200: '#AFA9EC', 400: '#7F77DD', 600: '#534AB7', 800: '#3C3489', 900: '#26215C' },
                teal: { 50: '#E1F5EE', 100: '#9FE1CB', 200: '#5DCAA5', 400: '#1D9E75', 600: '#0F6E56', 800: '#085041', 900: '#04342C' },
                coral: { 50: '#FAECE7', 100: '#F5C4B3', 200: '#F0997B', 400: '#D85A30', 600: '#993C1D', 800: '#712B13', 900: '#4A1B0C' },
              },
              borderRadius: {
                DEFAULT: '8px',
                lg: '12px',
                xl: '16px',
              },
              fontFamily: {
                sans: ['var(--font-sans)'],
                mono: ['var(--font-mono)'],
                serif: ['var(--font-serif)'],
              },
            },
          },
        };
      }
    `;
    document.head.appendChild(configScript);
  };
  script.onerror = () => {
    tailwindLoading = false;
    console.warn('[WidgetRenderer] Failed to load Tailwind CDN');
  };
  document.head.appendChild(script);
}

/**
 * Returns a full <style> block injected into every widget container.
 * Sets bridged CSS variables + base typography + fade-in animation.
 */
export function getWidgetBridgeStyle(): string {
  return `<style data-widget-bridge>
.widget-root {
  ${WIDGET_CSS_BRIDGE}
  font-family: var(--font-sans);
  font-size: 16px;
  line-height: 1.7;
  color: var(--color-text-primary);
  background: transparent;
}
.widget-root * {
  box-sizing: border-box;
}
.widget-root a {
  color: var(--color-text-info);
  text-decoration: none;
}
.widget-root a:hover {
  text-decoration: underline;
}
/* Pre-styled form elements matching Anthropic guidelines */
.widget-root input[type="range"] {
  height: 4px;
  -webkit-appearance: none;
  appearance: none;
  background: var(--color-border-tertiary);
  border-radius: 2px;
  outline: none;
}
.widget-root input[type="range"]::-webkit-slider-thumb {
  -webkit-appearance: none;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: var(--color-text-primary);
  cursor: pointer;
}
.widget-root input[type="text"],
.widget-root input[type="number"],
.widget-root select,
.widget-root textarea {
  height: 36px;
  padding: 0 10px;
  border: 0.5px solid var(--color-border-secondary);
  border-radius: var(--border-radius-md);
  background: var(--color-background-primary);
  color: var(--color-text-primary);
  font-size: 14px;
  font-family: var(--font-sans);
  outline: none;
}
.widget-root input:focus,
.widget-root select:focus,
.widget-root textarea:focus {
  border-color: var(--color-border-primary);
  box-shadow: 0 0 0 2px color-mix(in oklch, var(--color-border-primary) 30%, transparent);
}
.widget-root button {
  background: transparent;
  border: 0.5px solid var(--color-border-secondary);
  border-radius: var(--border-radius-md);
  padding: 6px 14px;
  font-size: 14px;
  font-family: var(--font-sans);
  color: var(--color-text-primary);
  cursor: pointer;
  transition: background 0.15s, transform 0.1s;
}
.widget-root button:hover {
  background: var(--color-background-tertiary);
}
.widget-root button:active {
  transform: scale(0.98);
}
/* Fade-in animation for streaming new nodes */
@keyframes widgetFadeIn {
  from { opacity: 0; transform: translateY(4px); }
  to { opacity: 1; transform: translateY(0); }
}
</style>`;
}
