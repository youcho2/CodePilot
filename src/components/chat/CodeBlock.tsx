'use client';

import { useState, useMemo, useRef, createElement } from 'react';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { useThemeFamily } from '@/lib/theme/context';
import { resolveCodeTheme, resolvePrismStyle } from '@/lib/theme/code-themes';
import { useTheme } from 'next-themes';
import type { Icon } from "@phosphor-icons/react";
import {
  Copy,
  Check,
  CaretDown,
  CaretUp,
  FileCode,
  Terminal,
  Code,
  File,
  Hash,
} from "@phosphor-icons/react";
import { cn } from '@/lib/utils';

const COLLAPSE_THRESHOLD = 20;
const VISIBLE_LINES = 10;

const TERMINAL_LANGUAGES = new Set(['bash', 'sh', 'shell', 'terminal', 'zsh', 'console']);

function getLanguageIcon(language: string): Icon {
  const lower = language.toLowerCase();
  if (TERMINAL_LANGUAGES.has(lower)) return Terminal;
  if (['typescript', 'tsx', 'javascript', 'jsx'].includes(lower)) return Code;
  if (['json', 'yaml', 'yml', 'toml', 'xml'].includes(lower)) return Code;
  if (['python', 'ruby', 'go', 'rust', 'java', 'c', 'cpp'].includes(lower)) return Hash;
  if (['css', 'scss', 'html'].includes(lower)) return File;
  return FileCode;
}

interface CodeBlockProps {
  code: string;
  language?: string;
  filename?: string;
  showLineNumbers?: boolean;
  maxCollapsedLines?: number;
}

/** Resolve the Prism syntax highlighting style for CodeBlock. */
function useCodeBlockTheme(isTerminal: boolean, isDark: boolean) {
  const { family, families } = useThemeFamily();
  if (isTerminal) return vscDarkPlus;
  const codeTheme = resolveCodeTheme(families, family);
  return resolvePrismStyle(codeTheme, isDark);
}

export function CodeBlock({
  code,
  language = 'text',
  filename,
  showLineNumbers = true,
  maxCollapsedLines = VISIBLE_LINES,
}: CodeBlockProps) {
  const [copied, setCopied] = useState(false);
  const [copiedMarkdown, setCopiedMarkdown] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const codeContainerRef = useRef<HTMLDivElement>(null);
  const [animatingHeight, setAnimatingHeight] = useState<string | undefined>(undefined);
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === 'dark';

  const lines = useMemo(() => code.split('\n'), [code]);
  const totalLines = lines.length;
  const isCollapsible = totalLines > COLLAPSE_THRESHOLD;
  const isTerminal = TERMINAL_LANGUAGES.has(language.toLowerCase());

  const displayCode = useMemo(() => {
    if (!isCollapsible || expanded) return code;
    return lines.slice(0, maxCollapsedLines).join('\n');
  }, [code, lines, isCollapsible, expanded, maxCollapsedLines]);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // clipboard not available
    }
  };

  const handleCopyMarkdown = async () => {
    try {
      const markdown = `\`\`\`${language}\n${code}\n\`\`\``;
      await navigator.clipboard.writeText(markdown);
      setCopiedMarkdown(true);
      setTimeout(() => setCopiedMarkdown(false), 2000);
    } catch {
      // clipboard not available
    }
  };

  const handleToggleExpand = () => {
    const container = codeContainerRef.current;
    if (!container) {
      setExpanded(!expanded);
      return;
    }
    const currentHeight = container.scrollHeight;
    if (!expanded) {
      setAnimatingHeight(`${currentHeight}px`);
      setExpanded(true);
      requestAnimationFrame(() => {
        const fullHeight = container.scrollHeight;
        setAnimatingHeight(`${fullHeight}px`);
        setTimeout(() => setAnimatingHeight(undefined), 300);
      });
    } else {
      setAnimatingHeight(`${currentHeight}px`);
      requestAnimationFrame(() => {
        const collapsedH = maxCollapsedLines * 1.5 + 1.5;
        setAnimatingHeight(`${collapsedH}rem`);
        setTimeout(() => {
          setExpanded(false);
          setAnimatingHeight(undefined);
        }, 300);
      });
    }
  };

  const languageIcon = getLanguageIcon(language);

  const theme = useCodeBlockTheme(isTerminal, isDark);

  return (
    <div className={cn(
      "relative group not-prose my-3 rounded-lg overflow-hidden",
      isTerminal
        ? "border border-zinc-700/50"
        : "border border-border"
    )}>
      {/* Header bar */}
      <div className={cn(
        "flex items-center justify-between px-4 py-1.5 text-xs",
        isTerminal
          ? "bg-zinc-950 text-zinc-400"
          : "bg-muted text-muted-foreground"
      )}>
        <div className="flex items-center gap-2 min-w-0">
          {createElement(languageIcon, { size: 14, className: cn(
            "shrink-0",
            isTerminal ? "text-green-400" : "text-muted-foreground",
          ) })}
          {filename && (
            <span className={cn(
              "truncate font-medium",
              isTerminal ? "text-zinc-300" : "text-foreground"
            )}>{filename}</span>
          )}
          {filename && <span className="text-muted-foreground/50">|</span>}
          <span className={cn(
            "rounded px-1.5 py-0.5",
            isTerminal
              ? "bg-zinc-700/50 text-green-400"
              : "bg-accent text-accent-foreground"
          )}>{language.toUpperCase()}</span>
        </div>
        <div className="flex items-center gap-1 ml-2 shrink-0">
          <button
            onClick={handleCopy}
            className={cn(
              "flex items-center gap-1 rounded px-1.5 py-0.5 transition-colors",
              isTerminal
                ? "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-700/50"
                : "text-muted-foreground hover:text-foreground hover:bg-accent"
            )}
            title="Copy code"
          >
            {copied ? (
              <>
                <Check size={12} />
                <span>Copied</span>
              </>
            ) : (
              <>
                <Copy size={12} />
                <span>Copy</span>
              </>
            )}
          </button>
          <button
            onClick={handleCopyMarkdown}
            className={cn(
              "flex items-center gap-1 rounded px-1.5 py-0.5 transition-colors",
              isTerminal
                ? "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-700/50"
                : "text-muted-foreground hover:text-foreground hover:bg-accent"
            )}
            title="Copy as Markdown"
          >
            {copiedMarkdown ? (
              <>
                <Check size={12} />
                <span>Copied</span>
              </>
            ) : (
              <>
                <FileCode size={12} />
                <span>Markdown</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* Code area */}
      <div
        ref={codeContainerRef}
        className="relative transition-[max-height] duration-300 ease-in-out overflow-hidden"
        style={{
          maxHeight: animatingHeight ?? (!isCollapsible || expanded ? undefined : `${maxCollapsedLines * 1.5 + 1.5}rem`),
        }}
      >
        <SyntaxHighlighter
          style={theme}
          language={language}
          PreTag="div"
          showLineNumbers={showLineNumbers && !isTerminal}
          lineNumberStyle={{
            minWidth: '2.5em',
            paddingRight: '1em',
            color: 'var(--muted-foreground)',
            opacity: 0.4,
            userSelect: 'none',
          }}
          customStyle={{
            margin: 0,
            borderRadius: 0,
            fontSize: '0.8125rem',
            lineHeight: '1.5',
            padding: isTerminal ? '0.75rem 1rem' : '0.75rem 0.5rem',
            background: isTerminal ? '#0a0a0a' : undefined,
            overflow: 'auto',
          }}
          wrapLines
        >
          {expanded ? code : displayCode}
        </SyntaxHighlighter>

        {/* Gradient overlay for collapsed state */}
        {isCollapsible && !expanded && (
          <div className={cn(
            "absolute bottom-0 left-0 right-0 h-16 pointer-events-none",
            isTerminal
              ? "bg-gradient-to-t from-[#0a0a0a] to-transparent"
              : "bg-gradient-to-t from-muted to-transparent"
          )} />
        )}
      </div>

      {/* Expand/Collapse button */}
      {isCollapsible && (
        <button
          onClick={handleToggleExpand}
          className={cn(
            "flex w-full items-center justify-center gap-1.5 py-1.5 text-xs transition-colors",
            isTerminal
              ? "bg-zinc-950 text-zinc-400 hover:text-zinc-200"
              : "bg-muted text-muted-foreground hover:text-foreground"
          )}
        >
          {expanded ? (
            <>
              <CaretUp size={12} />
              <span>Collapse</span>
            </>
          ) : (
            <>
              <CaretDown size={12} />
              <span>Expand all {totalLines} lines</span>
            </>
          )}
        </button>
      )}
    </div>
  );
}

// Inline code component for reuse
export function InlineCode({ children }: { children: React.ReactNode }) {
  return (
    <code className="rounded bg-muted px-1.5 py-0.5 text-sm font-mono">
      {children}
    </code>
  );
}
