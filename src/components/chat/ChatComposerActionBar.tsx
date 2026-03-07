'use client';

import type { ReactNode } from 'react';

interface ChatComposerActionBarProps {
  left?: ReactNode;
  center?: ReactNode;
  right?: ReactNode;
}

export function ChatComposerActionBar({ left, center, right }: ChatComposerActionBarProps) {
  return (
    <div className="flex items-center justify-between gap-2 px-4 py-1.5">
      <div className="flex items-center gap-2">
        {left}
      </div>
      <div className="flex items-center gap-2">
        {center}
      </div>
      <div className="flex items-center gap-2">
        {right}
      </div>
    </div>
  );
}
