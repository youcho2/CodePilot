"use client";

import { SkillsManager } from "@/components/skills/SkillsManager";

export default function SkillsPage() {
  return (
    <div className="flex h-full flex-col">
      <div className="flex-1 overflow-y-auto p-6 flex flex-col min-h-0">
        <SkillsManager />
      </div>
    </div>
  );
}
