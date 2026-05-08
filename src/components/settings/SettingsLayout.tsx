"use client";

import { useState, useCallback, useSyncExternalStore } from "react";
import { type Icon, Gear, UserCircle, Plug, ChartBar, Brain, Lightning, PaintBrush, Eye, Info, Heart, WifiHigh } from "@/components/ui/icon";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { OverviewSection } from "./OverviewSection";
import { GeneralSection } from "./GeneralSection";
import { AppearanceSection } from "./AppearanceSection";
import { ProviderManager } from "./ProviderManager";
import { ModelsSection } from "./ModelsSection";
import { RuntimePanel } from "./RuntimePanel";
import { HealthSection } from "./HealthSection";
import { UsageStatsSection } from "./UsageStatsSection";
import { AssistantWorkspaceSection } from "./AssistantWorkspaceSection";
import { AboutSection } from "./AboutSection";
import { BridgeLayout } from "@/components/bridge/BridgeLayout";
import { useTranslation } from "@/hooks/useTranslation";
import type { TranslationKey } from "@/i18n";

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

// Order: Overview / General / Appearance / Providers / Models / Runtime /
// Health / Usage / Assistant / About. Phase 2C.5 inserted Health between
// Runtime and Usage so the "build run conditions → check runs → see
// usage" flow reads top-down. Health is the daily-issue locator (read-
// only); deep diagnostics + repair stay with Setup Center.
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
  // Channel-specific config (Telegram / Feishu / Discord / QQ / WeChat)
  // is configuration, not a primary destination, so it belongs here.
  { id: "bridge", label: "Bridge", icon: WifiHigh },
  { id: "about", label: "About", icon: Info },
];

function getSectionFromHash(): Section {
  if (typeof window === "undefined") return "overview";
  const hash = window.location.hash.replace("#", "");
  if (sidebarItems.some((item) => item.id === hash)) {
    return hash as Section;
  }
  // Settings IA Phase 2: Overview is the new default landing — a status
  // dashboard for "what's the state of my setup right now". Direct hash
  // links (#general / #providers / etc.) still resolve as before.
  return "overview";
}

function subscribeToHash(callback: () => void) {
  window.addEventListener("hashchange", callback);
  return () => window.removeEventListener("hashchange", callback);
}

export function SettingsLayout() {
  // useSyncExternalStore subscribes to hash changes without triggering
  // the react-hooks/set-state-in-effect lint rule.
  const hashSection = useSyncExternalStore(subscribeToHash, getSectionFromHash, () => "overview" as Section);

  // Local state allows immediate UI update on click before the hash updates.
  const [overrideSection, setOverrideSection] = useState<Section | null>(null);
  const activeSection = overrideSection ?? hashSection;

  const { t } = useTranslation();

  const settingsLabelKeys: Record<string, TranslationKey> = {
    'Overview': 'settings.overview',
    'General': 'settings.general',
    'Appearance': 'settings.appearance',
    'Providers': 'settings.providers',
    'Models': 'settings.models',
    'Runtime': 'settings.runtime',
    'Health': 'settings.health',
    'Usage': 'settings.usage',
    'Assistant': 'settings.assistant',
    'Bridge': 'settings.bridge',
    'About': 'settings.about',
  };

  const handleSectionChange = useCallback((section: Section) => {
    setOverrideSection(section);
    window.history.replaceState(null, "", `/settings#${section}`);
    // Clear override so subsequent hash changes take effect
    queueMicrotask(() => setOverrideSection(null));
  }, []);

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Narrow viewport fallback: horizontal tab strip.
          On lg+ the section navigation lives in AppShell's <SettingsSidebar/> instead. */}
      <nav
        className={cn(
          "shrink-0 flex flex-row gap-1 overflow-x-auto border-b border-border/50 px-3 py-2",
          "lg:hidden",
        )}
      >
        {sidebarItems.map((item) => (
          <Button
            key={item.id}
            variant="ghost"
            onClick={() => handleSectionChange(item.id)}
            className={cn(
              "shrink-0 gap-2 px-3 py-1.5 text-sm font-medium rounded-full",
              activeSection === item.id
                ? "bg-sidebar-accent text-sidebar-accent-foreground"
                : "text-muted-foreground hover:bg-sidebar-accent hover:text-foreground"
            )}
          >
            <item.icon size={16} className="shrink-0" />
            {t(settingsLabelKeys[item.label])}
          </Button>
        ))}
      </nav>

      {/* Content */}
      <div className="flex min-h-0 flex-1">
        <div className={cn(
          "flex-1 overflow-auto",
          // Bridge owns its own h-full + inner sub-nav, so it needs to
          // flex-fill the section without our default p-4/lg:p-6 padding
          // (its sub-nav already brings border-r + p-3). Other sections
          // keep the standard padding.
          activeSection === "bridge" ? "" : "p-4 lg:p-6",
        )}>
          {activeSection === "overview" && <OverviewSection />}
          {activeSection === "general" && <GeneralSection />}
          {activeSection === "appearance" && <AppearanceSection />}
          {activeSection === "providers" && <ProviderManager />}
          {activeSection === "models" && <ModelsSection />}
          {activeSection === "runtime" && <RuntimePanel />}
          {activeSection === "health" && <HealthSection />}
          {activeSection === "usage" && <UsageStatsSection />}
          {activeSection === "assistant" && <AssistantWorkspaceSection />}
          {activeSection === "bridge" && <BridgeLayout embedded />}
          {activeSection === "about" && <AboutSection />}
        </div>
      </div>
    </div>
  );
}
