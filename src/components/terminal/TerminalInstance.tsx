"use client";

import { useEffect, useRef } from "react";
import type { useTerminal } from "@/hooks/useTerminal";

interface TerminalInstanceProps {
  terminal: ReturnType<typeof useTerminal>;
}

/**
 * TerminalInstance — renders terminal output as a simple text view.
 *
 * Phase 4 v1: Uses a simple <pre> element for output display.
 * xterm.js integration can be added later for full terminal emulation
 * (requires npm install xterm @xterm/addon-fit).
 */
export function TerminalInstance({ terminal }: TerminalInstanceProps) {
  const outputRef = useRef<HTMLPreElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const outputTextRef = useRef("");

  useEffect(() => {
    terminal.setOnData((data: string) => {
      outputTextRef.current += data;
      if (outputRef.current) {
        outputRef.current.textContent = outputTextRef.current;
        outputRef.current.scrollTop = outputRef.current.scrollHeight;
      }
    });
  }, [terminal]);

  // Create terminal on mount
  useEffect(() => {
    if (terminal.isElectron && !terminal.connected && !terminal.exited) {
      terminal.create(120, 30);
    }
  }, [terminal]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      const value = inputRef.current?.value || '';
      terminal.write(value + '\n');
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  return (
    <div className="flex flex-col h-full bg-[#1a1a1a] text-[#d4d4d4] font-mono text-xs">
      <pre
        ref={outputRef}
        className="flex-1 overflow-auto p-2 whitespace-pre-wrap break-all"
      />
      <div className="flex items-center border-t border-[#333] px-2">
        <span className="text-green-400 mr-1">$</span>
        <input
          ref={inputRef}
          type="text"
          className="flex-1 bg-transparent border-none outline-none text-xs py-1.5 text-[#d4d4d4]"
          onKeyDown={handleKeyDown}
          autoFocus
          spellCheck={false}
        />
      </div>
    </div>
  );
}
