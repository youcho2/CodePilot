'use client';

import { useRef, useEffect, useCallback, useState } from 'react';
import morphdom from 'morphdom';
import { useTranslation } from '@/hooks/useTranslation';
import { getWidgetBridgeStyle, ensureTailwindCdn } from '@/lib/widget-css-bridge';
import {
  sanitizeWidgetHtml,
  executeWidgetScripts,
  secureLinks,
} from '@/lib/widget-sanitizer';
import { WidgetErrorBoundary } from './WidgetErrorBoundary';

interface WidgetRendererProps {
  widgetCode: string;
  isStreaming: boolean;
  title?: string;
}

/** Debounce delay for morphdom updates during streaming (ms). */
const MORPH_DEBOUNCE = 150;

function WidgetRendererInner({ widgetCode, isStreaming, title }: WidgetRendererProps) {
  const { t } = useTranslation();
  const containerRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastHtmlRef = useRef<string>('');
  const scriptsExecutedRef = useRef(false);
  const [showCode, setShowCode] = useState(false);

  const bridgeStyle = getWidgetBridgeStyle();

  // Load Tailwind CDN once globally
  useEffect(() => {
    ensureTailwindCdn();
  }, []);

  /** Strip <script> tags for streaming (we don't want to render inert script text) */
  const stripScripts = useCallback((html: string) => {
    return html.replace(/<script[\s\S]*?<\/script>/gi, '');
  }, []);

  const updateDom = useCallback(
    (html: string, keepScripts: boolean) => {
      const el = containerRef.current;
      if (!el) return;

      // During streaming, strip scripts (they'll be executed after streaming completes).
      // In static mode, keep scripts in HTML so clone-and-replace can execute them.
      const processedHtml = keepScripts ? html : stripScripts(html);
      const fullHtml = `<div class="widget-root">${bridgeStyle}${processedHtml}</div>`;

      if (lastHtmlRef.current === fullHtml) return;
      lastHtmlRef.current = fullHtml;

      try {
        if (!el.firstElementChild) {
          el.innerHTML = fullHtml;
        } else {
          const wrapper = document.createElement('div');
          wrapper.innerHTML = fullHtml;
          morphdom(el.firstElementChild, wrapper.firstElementChild!, {
            onBeforeElUpdated: (fromEl, toEl) => {
              if (fromEl.tagName === 'SCRIPT') return false;
              if (fromEl.tagName === 'STYLE' && fromEl.hasAttribute('data-widget-bridge')) return false;
              if (fromEl.isEqualNode(toEl)) return false;
              return true;
            },
            onNodeAdded: (node) => {
              if (isStreaming && node instanceof HTMLElement && node.nodeType === 1) {
                node.style.animation = 'widgetFadeIn 0.3s ease both';
              }
              return node;
            },
          });
        }
        secureLinks(el);
      } catch (err) {
        console.warn('[WidgetRenderer] morphdom error, falling back to innerHTML:', err);
        el.innerHTML = fullHtml;
        secureLinks(el);
      }
    },
    [bridgeStyle, isStreaming, stripScripts],
  );

  // Streaming mode: debounced DOM diff (no scripts)
  useEffect(() => {
    if (!isStreaming) return;

    const sanitized = sanitizeWidgetHtml(widgetCode);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => updateDom(sanitized, false), MORPH_DEBOUNCE);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [widgetCode, isStreaming, updateDom]);

  // Static mode: one-shot render + script execution via clone-and-replace
  useEffect(() => {
    if (isStreaming) {
      scriptsExecutedRef.current = false;
      return;
    }

    const sanitized = sanitizeWidgetHtml(widgetCode);
    updateDom(sanitized, true); // keep scripts in HTML

    if (!scriptsExecutedRef.current && containerRef.current) {
      scriptsExecutedRef.current = true;
      // Clone-and-replace scripts after a frame so DOM is fully rendered
      requestAnimationFrame(() => {
        if (containerRef.current) {
          executeWidgetScripts(containerRef.current);
        }
      });
    }
  }, [widgetCode, isStreaming, updateDom]);

  return (
    <div className="group/widget relative my-1">
      {!showCode && (
        <div
          ref={containerRef}
          className="widget-container overflow-x-auto"
          style={{ minHeight: isStreaming ? 40 : undefined }}
        />
      )}

      {showCode && (
        <pre className="p-3 text-xs rounded-lg bg-muted/30 overflow-x-auto max-h-80 overflow-y-auto border border-border/30">
          <code>{widgetCode}</code>
        </pre>
      )}

      <button
        onClick={() => setShowCode(!showCode)}
        className="absolute top-1 right-1 opacity-0 group-hover/widget:opacity-100 transition-opacity text-[10px] px-1.5 py-0.5 rounded text-muted-foreground/50 hover:text-muted-foreground hover:bg-muted/50"
      >
        {showCode ? t('widget.hideCode') : t('widget.showCode')}
      </button>

      {isStreaming && (
        <div className="text-[11px] text-muted-foreground/60 animate-pulse mt-1">
          {t('widget.loading')}
        </div>
      )}
    </div>
  );
}

export function WidgetRenderer(props: WidgetRendererProps) {
  return (
    <WidgetErrorBoundary>
      <WidgetRendererInner {...props} />
    </WidgetErrorBoundary>
  );
}
