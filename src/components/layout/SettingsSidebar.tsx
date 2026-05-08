"use client";

import { useCallback, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, type Icon, Gear, UserCircle, Plug, ChartBar, Brain, Lightning, PaintBrush, Eye, Info, Heart, WifiHigh } from "@/components/ui/icon";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useTranslation } from "@/hooks/useTranslation";
import type { TranslationKey } from "@/i18n";

interface SettingsSidebarProps {
  open: boolean;
  width?: number;
}

type Section =
  | "overview"
  | "general"
  | "appearance"
  | "providers"
  | "models"
  | "runtime"
  | "health"
  | "usage"
  | "assistant"
  | "bridge"
  | "about";

interface SidebarItem {
  id: Section;
  label: string;
  icon: Icon;
}

// Mirror SettingsLayout — Overview is the dashboard at top, About is the
// metadata page at bottom. Middle is the three-layer mental model:
// Providers (assets) → Models (exposure) → Runtime (environment).
const sidebarItems: SidebarItem[] = [
  { id: "overview", label: "Overview", icon: Eye },
  { id: "general", label: "General", icon: Gear },
  { id: "appearance", label: "Appearance", icon: PaintBrush },
  { id: "providers", label: "Providers", icon: Plug },
  { id: "models", label: "Models", icon: Brain },
  { id: "runtime", label: "Runtime", icon: Lightning },
  { id: "health", label: "Health", icon: Heart },
  { id: "usage", label: "Usage", icon: ChartBar },
  { id: "assistant", label: "Assistant", icon: UserCircle },
  // Bridge moved from top-level rail entry into Settings (2026-05-02).
  { id: "bridge", label: "Bridge", icon: WifiHigh },
  { id: "about", label: "About", icon: Info },
];

const settingsLabelKeys: Record<string, TranslationKey> = {
  Overview: "settings.overview",
  General: "settings.general",
  Appearance: "settings.appearance",
  Providers: "settings.providers",
  Models: "settings.models",
  Runtime: "settings.runtime",
  Health: "settings.health",
  Usage: "settings.usage",
  Assistant: "settings.assistant",
  Bridge: "settings.bridge",
  About: "settings.about",
};

function getSectionFromHash(): Section {
  if (typeof window === "undefined") return "overview";
  const hash = window.location.hash.replace("#", "");
  if (sidebarItems.some((item) => item.id === hash)) {
    return hash as Section;
  }
  return "overview";
}

function subscribeToHash(callback: () => void) {
  window.addEventListener("hashchange", callback);
  return () => window.removeEventListener("hashchange", callback);
}

/**
 * Settings sidebar — replaces ChatListPanel when on /settings route.
 * Top: Back button → returns to previous view (chat).
 * Below: 5 section navigation items (synced via URL hash).
 */
export function SettingsSidebar({ open, width }: SettingsSidebarProps) {
  const router = useRouter();
  const { t } = useTranslation();

  const activeSection = useSyncExternalStore(
    subscribeToHash,
    getSectionFromHash,
    () => "general" as Section,
  );

  const handleBack = useCallback(() => {
    // Avoid router.back() — for deep-linked /settings#... entries it escapes
    // to about:blank. Prefer the recorded last non-settings path (written by
    // AppShell), with /chat as explicit fallback.
    if (typeof window !== 'undefined') {
      const last = sessionStorage.getItem('codepilot:last-non-settings-path');
      if (last && !last.startsWith('/settings')) {
        router.push(last);
        return;
      }
    }
    router.push('/chat');
  }, [router]);

  const handleSectionChange = useCallback((section: Section) => {
    window.history.replaceState(null, "", `/settings#${section}`);
    // Manually dispatch hashchange so useSyncExternalStore picks up the change
    window.dispatchEvent(new HashChangeEvent("hashchange"));
  }, []);

  if (!open) return null;

  return (
    <aside
      className="hidden h-full shrink-0 flex-col overflow-hidden bg-sidebar/80 backdrop-blur-xl lg:flex"
      style={{ width: width ?? 240 }}
    >
      {/* macOS traffic lights spacing — match ChatListPanel */}
      <div className="h-5 shrink-0 mt-3" />

      {/* Back button */}
      <div className="p-2">
        <Button
          variant="ghost"
          size="sm"
          onClick={handleBack}
          className="group w-full justify-start gap-2 h-9 px-3 rounded-xl text-[13px] font-normal text-sidebar-foreground"
        >
          <ArrowLeft size={16} />
          {t("common.back" as TranslationKey)}
        </Button>
      </div>

      {/* Section navigation */}
      <div className="p-2 flex flex-col gap-0.5">
        {sidebarItems.map((item) => {
          const isActive = activeSection === item.id;
          return (
            <Button
              key={item.id}
              variant="ghost"
              size="sm"
              onClick={() => handleSectionChange(item.id)}
              className={cn(
                "group w-full justify-start gap-2 h-9 px-3 rounded-xl text-[13px]",
                isActive
                  ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium"
                  : "text-sidebar-foreground font-normal",
              )}
            >
              <item.icon size={16} weight={isActive ? "fill" : "regular"} />
              {t(settingsLabelKeys[item.label])}
            </Button>
          );
        })}
      </div>
    </aside>
  );
}
