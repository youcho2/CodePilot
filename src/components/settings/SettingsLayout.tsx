"use client";

import { useState, useCallback, useSyncExternalStore } from "react";
import { type Icon, Gear, Code, UserCircle, Plug, ChartBar, Brain, Lightning } from "@/components/ui/icon";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { GeneralSection } from "./GeneralSection";
import { ProviderManager } from "./ProviderManager";
import { ModelsSection } from "./ModelsSection";
import { RuntimePanel } from "./RuntimePanel";
import { CliSettingsSection } from "./CliSettingsSection";
import { UsageStatsSection } from "./UsageStatsSection";
import { AssistantWorkspaceSection } from "./AssistantWorkspaceSection";
import { useTranslation } from "@/hooks/useTranslation";
import type { TranslationKey } from "@/i18n";

type Section = "general" | "providers" | "models" | "runtime" | "cli" | "usage" | "assistant";

interface SidebarItem {
  id: Section;
  label: string;
  icon: Icon;
}

// Order: General / Providers / Models / Runtime / Claude CLI / Usage / Assistant.
// Runtime sits between Models and Claude CLI to surface the three-layer
// mental model (assets → exposure → environment) in nav order. Claude CLI
// stays distinct for now — it owns its own settings + sync flow; Phase 2B.7
// will trim it once Runtime owns runtime state explanation.
const sidebarItems: SidebarItem[] = [
  { id: "general", label: "General", icon: Gear },
  { id: "providers", label: "Providers", icon: Plug },
  { id: "models", label: "Models", icon: Brain },
  { id: "runtime", label: "Runtime", icon: Lightning },
  { id: "cli", label: "Claude CLI", icon: Code },
  { id: "usage", label: "Usage", icon: ChartBar },
  { id: "assistant", label: "Assistant", icon: UserCircle },
];

function getSectionFromHash(): Section {
  if (typeof window === "undefined") return "general";
  const hash = window.location.hash.replace("#", "");
  if (sidebarItems.some((item) => item.id === hash)) {
    return hash as Section;
  }
  return "general";
}

function subscribeToHash(callback: () => void) {
  window.addEventListener("hashchange", callback);
  return () => window.removeEventListener("hashchange", callback);
}

export function SettingsLayout() {
  // useSyncExternalStore subscribes to hash changes without triggering
  // the react-hooks/set-state-in-effect lint rule.
  const hashSection = useSyncExternalStore(subscribeToHash, getSectionFromHash, () => "general" as Section);

  // Local state allows immediate UI update on click before the hash updates.
  const [overrideSection, setOverrideSection] = useState<Section | null>(null);
  const activeSection = overrideSection ?? hashSection;

  const { t } = useTranslation();

  const settingsLabelKeys: Record<string, TranslationKey> = {
    'General': 'settings.general',
    'Providers': 'settings.providers',
    'Models': 'settings.models',
    'Runtime': 'settings.runtime',
    'Claude CLI': 'settings.claudeCli',
    'Usage': 'settings.usage',
    'Assistant': 'settings.assistant',
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
        <div className="flex-1 overflow-auto p-4 lg:p-6">
          {activeSection === "general" && <GeneralSection />}
          {activeSection === "providers" && <ProviderManager />}
          {activeSection === "models" && <ModelsSection />}
          {activeSection === "runtime" && <RuntimePanel />}
          {activeSection === "cli" && <CliSettingsSection />}
          {activeSection === "usage" && <UsageStatsSection />}
          {activeSection === "assistant" && <AssistantWorkspaceSection />}
        </div>
      </div>
    </div>
  );
}
