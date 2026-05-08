'use client';

import { useTranslation } from '@/hooks/useTranslation';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from '@/components/ui/dropdown-menu';
import { Code, NotePencil, CaretDown } from '@/components/ui/icon';

interface ModeIndicatorProps {
  mode: 'code' | 'plan' | string;
  onModeChange: (mode: string) => void;
  disabled?: boolean;
}

// Composer select trigger: invisible default + hover-only bg-accent
// per `feedback_composer_invisible_until_hover`. Both Code and Plan
// states render in muted weight — the icon and label do the
// disambiguation, no colour cue.
export function ModeIndicator({ mode, onModeChange, disabled }: ModeIndicatorProps) {
  const { t } = useTranslation();
  const isPlan = mode === 'plan';
  const Icon = isPlan ? NotePencil : Code;
  const label = isPlan ? t('messageInput.modePlan') : t('messageInput.modeCode');

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="xs"
          disabled={disabled}
          className="h-7 rounded-md text-xs font-normal text-muted-foreground"
        >
          <Icon size={12} />
          <span>{label}</span>
          <CaretDown size={10} className="opacity-60" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-[220px]">
        <DropdownMenuItem onClick={() => onModeChange('code')} className="items-start py-2">
          <Code size={14} className="mt-0.5" />
          <div className="flex flex-col items-start gap-0.5">
            <span>{t('messageInput.modeCode')}</span>
            <span className="text-[11px] text-muted-foreground leading-tight">
              {t('messageInput.modeCodeDesc')}
            </span>
          </div>
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => onModeChange('plan')} className="items-start py-2">
          <NotePencil size={14} className="mt-0.5" />
          <div className="flex flex-col items-start gap-0.5">
            <span>{t('messageInput.modePlan')}</span>
            <span className="text-[11px] text-muted-foreground leading-tight">
              {t('messageInput.modePlanDesc')}
            </span>
          </div>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
