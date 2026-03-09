"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { useTheme } from "next-themes";
import { codeToHtml, type BundledTheme } from "shiki";
import { useThemeFamily } from "@/lib/theme/context";
import {
  resolveShikiTheme,
  resolveShikiThemes,
} from "@/lib/theme/code-themes";
import { useTranslation } from "@/hooks/useTranslation";
import { HugeiconsIcon } from "@hugeicons/react";
import { Sun02Icon, Moon02Icon, ComputerDesk01Icon } from "@hugeicons/core-free-icons";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

// ── Theme Mode Pill Selector ────────────────────────────────────────

const MODE_OPTIONS = [
  { value: "light", icon: Sun02Icon, labelKey: "settings.modeLight" as const },
  { value: "dark", icon: Moon02Icon, labelKey: "settings.modeDark" as const },
  { value: "system", icon: ComputerDesk01Icon, labelKey: "settings.modeSystem" as const },
] as const;

function ThemeModePills({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex items-center rounded-lg border border-border/50 p-1 gap-1" role="radiogroup">
      {MODE_OPTIONS.map((opt) => {
        const selected = value === opt.value;
        return (
          <button
            key={opt.value}
            role="radio"
            aria-checked={selected}
            onClick={() => onChange(opt.value)}
            className={cn(
              "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-all",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              selected
                ? "bg-primary text-primary-foreground shadow-sm"
                : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
            )}
          >
            <HugeiconsIcon icon={opt.icon} className="h-3.5 w-3.5" />
            {t(opt.labelKey)}
          </button>
        );
      })}
    </div>
  );
}

// ── Shiki Code Preview ──────────────────────────────────────────────

const PREVIEW_CODE = `function greet(name: string) {
  const time = new Date().getHours();
  if (time < 12) return \`Good morning, \${name}\`;
  return \`Hello, \${name}\`;
}`;

function ShikiCodePreview({ isDark }: { isDark: boolean }) {
  const { family, families } = useThemeFamily();
  const shikiMapping = resolveShikiTheme(families, family);
  const { light, dark } = resolveShikiThemes(shikiMapping);
  const theme: BundledTheme = isDark ? dark : light;
  const [html, setHtml] = useState("");

  useEffect(() => {
    let cancelled = false;
    codeToHtml(PREVIEW_CODE, {
      lang: "typescript",
      theme,
    }).then((result) => {
      if (!cancelled) setHtml(result);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [theme]);

  return (
    <div className="rounded-md border border-border overflow-hidden">
      <div className="flex items-center justify-between px-3 py-1.5 text-xs bg-muted text-muted-foreground">
        <span className="font-medium">preview.ts</span>
        <span className="rounded bg-accent px-1.5 py-0.5 text-accent-foreground">TypeScript</span>
      </div>
      {html ? (
        <div
          className="shiki-preview [&_pre]:!m-0 [&_pre]:!rounded-none [&_pre]:!text-xs [&_pre]:!leading-relaxed [&_pre]:!p-2 [&_code]:!text-xs"
          dangerouslySetInnerHTML={{ __html: html }}
        />
      ) : (
        <div className="h-24 flex items-center justify-center text-xs text-muted-foreground">
          Loading…
        </div>
      )}
    </div>
  );
}

// ── UI Token Preview ────────────────────────────────────────────────

function UIPreview() {
  return (
    <div className="flex flex-wrap gap-2">
      <button className="rounded-md bg-primary px-3 py-1 text-xs font-medium text-primary-foreground">
        Primary
      </button>
      <button className="rounded-md bg-secondary px-3 py-1 text-xs font-medium text-secondary-foreground">
        Secondary
      </button>
      <button className="rounded-md bg-destructive px-3 py-1 text-xs font-medium text-primary-foreground">
        Destructive
      </button>
      <span className="inline-flex items-center rounded-full bg-accent px-2.5 py-0.5 text-[10px] font-medium text-accent-foreground">
        Badge
      </span>
      <span className="inline-flex items-center rounded-full border border-border bg-card px-2.5 py-0.5 text-[10px] text-card-foreground">
        Card
      </span>
      <span className="inline-flex items-center rounded-full bg-muted px-2.5 py-0.5 text-[10px] text-muted-foreground">
        Muted
      </span>
    </div>
  );
}

// ── Main Appearance Section ─────────────────────────────────────────

export function AppearanceSection() {
  const { theme, setTheme, resolvedTheme } = useTheme();
  const { family, setFamily, families } = useThemeFamily();
  const { t } = useTranslation();
  const isDark = resolvedTheme === "dark";

  const mounted = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false
  );

  if (!mounted) return null;

  return (
    <div className="space-y-4">
      {/* Section header — outside card */}
      <div>
        <h2 className="text-sm font-medium">{t("settings.appearance")}</h2>
        <p className="text-xs text-muted-foreground">{t("settings.appearanceDesc")}</p>
      </div>

      <div className="rounded-lg border border-border/50 p-4 space-y-4 transition-shadow hover:shadow-sm">
      {/* Mode */}
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          <h3 className="text-xs font-medium">{t("settings.themeMode")}</h3>
          <p className="text-[11px] text-muted-foreground">{t("settings.themeModeDesc")}</p>
        </div>
        <ThemeModePills value={theme || "system"} onChange={setTheme} />
      </div>

      {theme === "system" && resolvedTheme && (
        <p className="text-[11px] text-muted-foreground pl-1">
          {resolvedTheme === "dark" ? t("settings.modeDark") : t("settings.modeLight")}
        </p>
      )}

      <div className="border-t border-border/30" />

      {/* Family */}
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          <h3 className="text-xs font-medium">{t("settings.themeFamily")}</h3>
          <p className="text-[11px] text-muted-foreground">{t("settings.themeFamilyDesc")}</p>
        </div>
        <Select value={family} onValueChange={setFamily}>
          <SelectTrigger className="w-[200px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {families.map((f) => (
              <SelectItem key={f.id} value={f.id}>
                <span className="flex items-center gap-2">
                  {f.previewColors && (
                    <span className="flex gap-0.5">
                      <span
                        className="inline-block h-3 w-3 rounded-full border border-border/30"
                        style={{ background: f.previewColors.primaryLight }}
                      />
                      <span
                        className="inline-block h-3 w-3 rounded-full border border-border/30"
                        style={{ background: f.previewColors.primaryDark }}
                      />
                    </span>
                  )}
                  <span className="text-xs">{f.label}</span>
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="border-t border-border/30" />

      {/* Preview */}
      <div className="space-y-3">
        <h3 className="text-xs font-medium text-muted-foreground">Preview</h3>
        <UIPreview />
        <ShikiCodePreview isDark={isDark} />
      </div>
      </div>
    </div>
  );
}
