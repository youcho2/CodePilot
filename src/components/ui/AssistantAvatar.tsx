'use client';

import { useMemo } from 'react';
import { cn } from '@/lib/utils';
import { generateIdenticon } from '@/lib/identicon';

interface AssistantAvatarProps {
  /** Name to generate avatar from */
  name: string;
  /** Size in pixels (default 32) */
  size?: number;
  /** Additional CSS classes */
  className?: string;
}

export function AssistantAvatar({ name, size = 32, className }: AssistantAvatarProps) {
  const svg = useMemo(() => generateIdenticon(name, size), [name, size]);

  return (
    <div
      className={cn('shrink-0 overflow-hidden rounded-full', className)}
      style={{ width: size, height: size }}
      dangerouslySetInnerHTML={{ __html: svg }}
      aria-label={`Avatar for ${name}`}
    />
  );
}
