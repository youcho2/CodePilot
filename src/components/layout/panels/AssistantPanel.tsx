'use client';

import { useEffect, useState } from 'react';
import { usePanel } from '@/hooks/usePanel';
import { Button } from '@/components/ui/button';
import { AssistantAvatar } from '@/components/ui/AssistantAvatar';
import { X, Gear, Brain, Heart, Clock, File } from '@/components/ui/icon';
import { useRouter } from 'next/navigation';

interface AssistantSummary {
  configured: boolean;
  name: string;
  onboardingComplete: boolean;
  lastHeartbeatDate: string | null;
  heartbeatEnabled: boolean;
  memoryCount: number;
}

export function AssistantPanel() {
  const { setAssistantPanelOpen } = usePanel();
  const router = useRouter();
  const [summary, setSummary] = useState<AssistantSummary | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/workspace/summary')
      .then(r => r.ok ? r.json() : null)
      .then(data => { if (!cancelled) { setSummary(data); setLoading(false); } })
      .catch(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  return (
    <div className="flex h-full flex-col border-l border-border bg-background">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <div className="flex items-center gap-2">
          {summary?.name && <AssistantAvatar name={summary.name} size={20} />}
          <span className="text-sm font-medium">
            {summary?.name || 'Assistant'}
          </span>
        </div>
        <Button
          variant="ghost"
          size="icon-xs"
          onClick={() => setAssistantPanelOpen(false)}
        >
          <X size={14} />
        </Button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-3 space-y-4">
        {loading ? (
          <div className="text-sm text-muted-foreground">Loading...</div>
        ) : !summary?.configured ? (
          <div className="text-sm text-muted-foreground">
            Assistant not configured.
          </div>
        ) : (
          <>
            {/* Status Section */}
            <section>
              <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">
                Status
              </h3>
              <div className="space-y-2">
                <StatusRow
                  icon={<Heart size={14} />}
                  label="Heartbeat"
                  value={summary.heartbeatEnabled
                    ? summary.lastHeartbeatDate || 'Enabled'
                    : 'Disabled'}
                  status={summary.heartbeatEnabled ? 'ok' : 'off'}
                />
                <StatusRow
                  icon={<Brain size={14} />}
                  label="Memories"
                  value={`${summary.memoryCount} files`}
                  status="ok"
                />
                <StatusRow
                  icon={<File size={14} />}
                  label="Onboarding"
                  value={summary.onboardingComplete ? 'Complete' : 'Not done'}
                  status={summary.onboardingComplete ? 'ok' : 'warn'}
                />
              </div>
            </section>

            {/* Quick Links */}
            <section>
              <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">
                Settings
              </h3>
              <div className="space-y-1">
                <Button
                  variant="ghost"
                  size="sm"
                  className="w-full justify-start gap-2 text-xs"
                  onClick={() => router.push('/settings?tab=assistant')}
                >
                  <Gear size={14} />
                  Assistant Settings
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="w-full justify-start gap-2 text-xs"
                  onClick={() => router.push('/settings?tab=assistant&section=heartbeat')}
                >
                  <Clock size={14} />
                  Edit HEARTBEAT.md
                </Button>
              </div>
            </section>
          </>
        )}
      </div>
    </div>
  );
}

function StatusRow({ icon, label, value, status }: {
  icon: React.ReactNode;
  label: string;
  value: string;
  status: 'ok' | 'warn' | 'off';
}) {
  const dotColor = status === 'ok' ? 'bg-status-success' : status === 'warn' ? 'bg-status-warning' : 'bg-muted-foreground/30';
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="text-muted-foreground">{icon}</span>
      <span className="flex-1 text-muted-foreground">{label}</span>
      <span className={`h-1.5 w-1.5 rounded-full ${dotColor}`} />
      <span className="text-foreground">{value}</span>
    </div>
  );
}
