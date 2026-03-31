'use client';

import { useState, useCallback } from 'react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { AssistantAvatar } from '@/components/ui/AssistantAvatar';

// ── Types ──

interface OnboardingWizardProps {
  workspacePath: string;
  onComplete: (session: { id: string }, assistantName: string) => void;
}

interface WizardData {
  userName: string;
  userRole: string;
  assistantName: string;
  style: string;
  boundaries: string;
}

const ROLES = [
  { id: 'developer', label: 'Developer' },
  { id: 'designer', label: 'Designer' },
  { id: 'product', label: 'Product Manager' },
  { id: 'researcher', label: 'Researcher' },
  { id: 'student', label: 'Student' },
  { id: 'general', label: 'General' },
] as const;

const STYLES = [
  { id: 'concise', label: 'Concise', desc: 'Short and direct answers' },
  { id: 'detailed', label: 'Detailed', desc: 'Thorough explanations with examples' },
  { id: 'casual', label: 'Casual', desc: 'Friendly and conversational' },
] as const;

const TOTAL_STEPS = 3;

// ── Chip Component ──

function Chip({
  selected,
  onClick,
  children,
  className,
}: {
  selected: boolean;
  onClick: () => void;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'inline-flex items-center rounded-md border px-3 py-1.5 text-sm font-medium transition-all',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        selected
          ? 'border-primary bg-primary text-primary-foreground'
          : 'border-input bg-background text-foreground hover:bg-accent hover:text-accent-foreground',
        className,
      )}
    >
      {children}
    </button>
  );
}

// ── Step Indicator ──

function StepIndicator({ current, total }: { current: number; total: number }) {
  return (
    <div className="flex items-center justify-center gap-2">
      {Array.from({ length: total }, (_, i) => (
        <div
          key={i}
          className={cn(
            'h-2 rounded-full transition-all duration-300',
            i === current ? 'w-8 bg-primary' : 'w-2 bg-muted-foreground/30',
          )}
        />
      ))}
    </div>
  );
}

// ── Main Component ──

export function OnboardingWizard({ workspacePath, onComplete }: OnboardingWizardProps) {
  const [step, setStep] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<WizardData>({
    userName: '',
    userRole: '',
    assistantName: '',
    style: 'concise',
    boundaries: '',
  });

  const update = useCallback(<K extends keyof WizardData>(key: K, value: WizardData[K]) => {
    setData(prev => ({ ...prev, [key]: value }));
  }, []);

  const canNext = step === 0
    ? data.userName.trim().length > 0
    : step === 1
      ? data.style.length > 0
      : true;

  const handleComplete = useCallback(async () => {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch('/api/workspace/wizard', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...data, workspacePath }),
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || `Request failed (${res.status})`);
      }
      const result = await res.json();
      onComplete(result.session, result.assistantName);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Setup failed');
    } finally {
      setSubmitting(false);
    }
  }, [data, workspacePath, onComplete]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm">
      <Card className="w-full max-w-lg mx-4 shadow-lg">
        <CardHeader>
          <div className="mb-2">
            <StepIndicator current={step} total={TOTAL_STEPS} />
          </div>
          <CardTitle className="text-center text-lg">
            {step === 0 && 'About You'}
            {step === 1 && 'Your Assistant'}
            {step === 2 && 'All Set!'}
          </CardTitle>
          <CardDescription className="text-center">
            {step === 0 && 'Tell us a bit about yourself so your assistant can personalize the experience.'}
            {step === 1 && 'Customize how your assistant communicates.'}
            {step === 2 && 'Review your setup and get started.'}
          </CardDescription>
        </CardHeader>

        <CardContent>
          {/* ── Step 1: User Info ── */}
          {step === 0 && (
            <div className="space-y-5">
              <div className="space-y-2">
                <label htmlFor="wizard-name" className="text-sm font-medium">
                  Your Name
                </label>
                <Input
                  id="wizard-name"
                  placeholder="e.g. Alex"
                  value={data.userName}
                  onChange={e => update('userName', e.target.value)}
                  autoFocus
                />
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium">Your Role</label>
                <div className="flex flex-wrap gap-2">
                  {ROLES.map(role => (
                    <Chip
                      key={role.id}
                      selected={data.userRole === role.id}
                      onClick={() => update('userRole', role.id)}
                    >
                      {role.label}
                    </Chip>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* ── Step 2: Assistant Config ── */}
          {step === 1 && (
            <div className="space-y-5">
              <div className="space-y-2">
                <label htmlFor="wizard-assistant-name" className="text-sm font-medium">
                  Assistant Name <span className="text-muted-foreground">(optional)</span>
                </label>
                <Input
                  id="wizard-assistant-name"
                  placeholder="e.g. Aria"
                  value={data.assistantName}
                  onChange={e => update('assistantName', e.target.value)}
                  autoFocus
                />
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium">Communication Style</label>
                <div className="flex flex-wrap gap-2">
                  {STYLES.map(s => (
                    <Chip
                      key={s.id}
                      selected={data.style === s.id}
                      onClick={() => update('style', s.id)}
                    >
                      <span className="flex flex-col items-start">
                        <span>{s.label}</span>
                        <span className={cn(
                          'text-xs font-normal',
                          data.style === s.id ? 'text-primary-foreground/70' : 'text-muted-foreground',
                        )}>
                          {s.desc}
                        </span>
                      </span>
                    </Chip>
                  ))}
                </div>
              </div>

              <div className="space-y-2">
                <label htmlFor="wizard-boundaries" className="text-sm font-medium">
                  Boundaries <span className="text-muted-foreground">(optional)</span>
                </label>
                <textarea
                  id="wizard-boundaries"
                  className={cn(
                    'placeholder:text-muted-foreground dark:bg-input/30 border-input min-h-[80px] w-full rounded-md border bg-transparent px-3 py-2 text-sm shadow-xs transition-[color,box-shadow] outline-none',
                    'focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]',
                  )}
                  placeholder="e.g. Don't modify files without asking first"
                  value={data.boundaries}
                  onChange={e => update('boundaries', e.target.value)}
                />
              </div>
            </div>
          )}

          {/* ── Step 3: Completion ── */}
          {step === 2 && (
            <div className="flex flex-col items-center gap-5 py-2">
              <AssistantAvatar
                name={data.assistantName || 'Assistant'}
                size={80}
                className="ring-2 ring-primary/20"
              />
              <div className="text-center space-y-1">
                <p className="font-semibold text-base">
                  {data.assistantName || 'Your Assistant'}
                </p>
                <p className="text-sm text-muted-foreground">
                  Ready to help {data.userName || 'you'}
                </p>
              </div>
              <div className="w-full rounded-md bg-muted/50 p-4 text-sm space-y-1">
                <p><span className="text-muted-foreground">Role:</span> {ROLES.find(r => r.id === data.userRole)?.label || 'General'}</p>
                <p><span className="text-muted-foreground">Style:</span> {STYLES.find(s => s.id === data.style)?.label || 'Concise'}</p>
                {data.boundaries && (
                  <p><span className="text-muted-foreground">Boundaries:</span> {data.boundaries}</p>
                )}
              </div>
              {error && (
                <p className="text-sm text-destructive">{error}</p>
              )}
            </div>
          )}
        </CardContent>

        {/* ── Footer Buttons ── */}
        <div className="flex items-center justify-between px-6 pb-6">
          {step > 0 ? (
            <Button
              variant="ghost"
              onClick={() => setStep(s => s - 1)}
              disabled={submitting}
            >
              Back
            </Button>
          ) : (
            <div />
          )}

          {step < TOTAL_STEPS - 1 ? (
            <Button onClick={() => setStep(s => s + 1)} disabled={!canNext}>
              Next
            </Button>
          ) : (
            <Button onClick={handleComplete} disabled={submitting}>
              {submitting ? 'Setting up...' : 'Complete'}
            </Button>
          )}
        </div>
      </Card>
    </div>
  );
}
