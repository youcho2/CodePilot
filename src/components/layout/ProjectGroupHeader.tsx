"use client";

import {
  Folder,
  CaretDown,
  CaretRight,
  Plus,
  FolderOpen,
  FolderMinus,
  UserCircle,
  DotsThree,
  Copy,
  ArrowSquareOut,
} from "@/components/ui/icon";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { useTranslation } from '@/hooks/useTranslation';
import type { TranslationKey } from "@/i18n";
import { useState } from "react";

interface ProjectGroupHeaderProps {
  workingDirectory: string;
  displayName: string;
  isCollapsed: boolean;
  isFolderHovered: boolean;
  isWorkspace: boolean;
  onToggle: () => void;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
  onCreateSession: (e: React.MouseEvent) => void;
  onRemoveProject?: (workingDirectory: string) => void;
}

export function ProjectGroupHeader({
  workingDirectory,
  displayName,
  isCollapsed,
  isFolderHovered,
  isWorkspace,
  onToggle,
  onMouseEnter,
  onMouseLeave,
  onCreateSession,
  onRemoveProject,
}: ProjectGroupHeaderProps) {
  const { t } = useTranslation();
  const [menuOpen, setMenuOpen] = useState(false);
  const showActions = isFolderHovered || menuOpen;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div
          className={cn(
            "flex items-center gap-1 rounded-md px-2 py-1 cursor-pointer select-none transition-colors",
            "hover:bg-accent/50"
          )}
          onClick={onToggle}
          onMouseEnter={onMouseEnter}
          onMouseLeave={onMouseLeave}
        >
          {isCollapsed ? (
            <CaretRight size={14} className="shrink-0 text-muted-foreground" />
          ) : (
            <CaretDown size={14} className="shrink-0 text-muted-foreground" />
          )}
          {isCollapsed ? (
            <Folder size={16} className="shrink-0 text-muted-foreground" />
          ) : (
            <FolderOpen size={16} className="shrink-0 text-muted-foreground" />
          )}
          <span className="flex-1 truncate text-[13px] font-medium text-sidebar-foreground">
            {displayName}
          </span>
          {isWorkspace && (
            <UserCircle size={14} className="shrink-0 text-muted-foreground" />
          )}
          {/* Action buttons (on hover) */}
          {workingDirectory !== "" && (
            <div className={cn(
              "flex items-center gap-0.5 transition-opacity",
              showActions ? "opacity-100" : "opacity-0"
            )}>
              {/* New chat button */}
              <Button
                variant="ghost"
                size="icon-xs"
                className="h-5 w-5 shrink-0 text-muted-foreground hover:text-foreground"
                tabIndex={showActions ? 0 : -1}
                onClick={onCreateSession}
              >
                <Plus size={14} />
              </Button>
              {/* Three-dot menu */}
              <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    className="h-5 w-5 shrink-0 text-muted-foreground hover:text-foreground"
                    tabIndex={showActions ? 0 : -1}
                    onClick={(e) => {
                      e.stopPropagation();
                    }}
                  >
                    <DotsThree size={14} weight="bold" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="min-w-[160px]" onClick={(e) => e.stopPropagation()}>
                  <DropdownMenuItem onClick={() => {
                    window.open(`file://${workingDirectory}`, '_blank');
                  }}>
                    <ArrowSquareOut size={14} />
                    <span>{t('chatList.openFolder' as TranslationKey)}</span>
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => {
                    navigator.clipboard.writeText(workingDirectory);
                  }}>
                    <Copy size={14} />
                    <span>{t('chatList.copyFolderPath' as TranslationKey)}</span>
                  </DropdownMenuItem>
                  {onRemoveProject && !isWorkspace && (
                    <>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        variant="destructive"
                        onClick={() => onRemoveProject(workingDirectory)}
                      >
                        <FolderMinus size={14} />
                        <span>{t('chatList.removeProject' as TranslationKey)}</span>
                      </DropdownMenuItem>
                    </>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          )}
        </div>
      </TooltipTrigger>
      <TooltipContent side="right" className="max-w-xs">
        <p className="text-xs break-all">{workingDirectory || t('chatList.noSessions')}</p>
      </TooltipContent>
    </Tooltip>
  );
}
