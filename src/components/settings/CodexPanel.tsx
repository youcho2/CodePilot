'use client';

/**
 * Settings → Codex (Phase 5 Phase 6, 2026-05-14).
 *
 * Three stacked status cards so the user understands what's working
 * before trying to send a Codex Account model from chat:
 *
 *   1. App-server card — binary detection / version / $CODEX_HOME /
 *      ready state. Surfaces `not_installed` / `too_old` / `spawn_failed`
 *      / `ready` / `unknown` from /api/codex/status.
 *   2. Account card    — logged_in / logged_out / unknown from
 *      /api/codex/account. Login button POSTs /api/codex/login and
 *      surfaces the `authUrl` as an explicit click-to-open link (no
 *      auto-nav — `feedback_no_silent_auto_irreversible.md`). Logout
 *      calls DELETE /api/codex/account.
 *   3. Models card     — model count + list from /api/codex/models,
 *      refresh button forces the server-side cache flush via
 *      `?refresh=1`.
 *
 * Out of scope for Phase 6:
 *   - No Responses proxy translator UI (deferred to Phase 5b).
 *   - No ~/.codex token reading.
 *   - No schema changes — all state read from the existing API surface.
 *
 * Disclosure: featured-plugin / manifest warning slots are NOT rendered
 * because no current API field surfaces them. When that signal is added
 * upstream, the card structure here is the place to wire the row.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  ArrowClockwise,
  ArrowSquareOut,
  CheckCircle,
  Copy,
  SpinnerGap,
  Warning,
  XCircle,
} from '@/components/ui/icon';
import { useTranslation } from '@/hooks/useTranslation';
import { cn } from '@/lib/utils';
import type { CodexAvailability, CodexAccountState } from '@/lib/codex/types';
import type { CodexLoginStart } from '@/lib/codex/account';
import type { ProviderModelGroup } from '@/types';

// ─────────────────────────────────────────────────────────────────────
// Shared status pill — same tone scale as RuntimePanel so the Settings
// nav reads as one visual family.
// ─────────────────────────────────────────────────────────────────────

type StatusTone = 'ok' | 'warning' | 'error' | 'idle';

function StatusPill({ tone, label }: { tone: StatusTone; label: string }) {
  const toneClass: Record<StatusTone, string> = {
    ok: 'bg-status-success-muted text-status-success-foreground',
    warning: 'bg-status-warning-muted text-status-warning-foreground',
    error: 'bg-status-error-muted text-status-error-foreground',
    idle: 'bg-muted text-muted-foreground',
  };
  const dotClass: Record<StatusTone, string> = {
    ok: 'bg-status-success-foreground',
    warning: 'bg-status-warning-foreground',
    error: 'bg-status-error-foreground',
    idle: 'bg-muted-foreground',
  };
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium',
        toneClass[tone],
      )}
    >
      <span className={cn('size-1.5 rounded-full', dotClass[tone])} />
      {label}
    </span>
  );
}

function Card({
  title,
  pill,
  actions,
  children,
}: {
  title: string;
  pill?: React.ReactNode;
  actions?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-lg bg-card border border-border/50 p-5 flex flex-col gap-3.5">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 flex-wrap">
          <h3 className="text-sm font-semibold leading-tight">{title}</h3>
          {pill}
        </div>
        {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
      </div>
      {children}
    </div>
  );
}

function DefinitionRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-3 py-2 text-xs">
      <span className="text-muted-foreground shrink-0">{label}</span>
      <span className="text-foreground/85 text-right break-all font-mono">{value}</span>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Data hooks — one per endpoint. Inline rather than extracted because
// the panel is the only consumer and the hooks are small enough that
// the file-local scope makes the polling/refresh logic easy to audit.
// ─────────────────────────────────────────────────────────────────────

function useCodexAvailability() {
  const [state, setState] = useState<CodexAvailability>({ kind: 'unknown' });
  const [loading, setLoading] = useState(false);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const res = await fetch('/api/codex/status', { cache: 'no-store' });
        const json = await res.json();
        if (!cancelled && json?.availability) {
          setState(json.availability as CodexAvailability);
        }
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        if (!cancelled) setState({ kind: 'spawn_failed', reason });
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tick]);

  return { state, loading, refresh: useCallback(() => setTick((t) => t + 1), []) };
}

function useCodexAccount() {
  const [state, setState] = useState<CodexAccountState>({ kind: 'unknown' });
  const [loading, setLoading] = useState(false);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const res = await fetch('/api/codex/account', { cache: 'no-store' });
        const json = await res.json();
        if (!cancelled && json?.state) {
          setState(json.state as CodexAccountState);
        }
      } catch {
        if (!cancelled) setState({ kind: 'unknown' });
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tick]);

  return { state, loading, refresh: useCallback(() => setTick((t) => t + 1), []) };
}

interface CodexModelsResult {
  group: ProviderModelGroup | null;
  error?: string;
}
function useCodexModels() {
  const [data, setData] = useState<CodexModelsResult>({ group: null });
  const [loading, setLoading] = useState(false);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const url = tick === 0 ? '/api/codex/models' : '/api/codex/models?refresh=1';
        const res = await fetch(url, { cache: 'no-store' });
        const json = await res.json();
        if (!cancelled) {
          setData({
            group: (json?.group ?? null) as ProviderModelGroup | null,
            error: typeof json?.error === 'string' ? json.error : undefined,
          });
        }
      } catch (err) {
        if (!cancelled) {
          setData({ group: null, error: err instanceof Error ? err.message : String(err) });
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tick]);

  return { ...data, loading, refresh: useCallback(() => setTick((t) => t + 1), []) };
}

// ─────────────────────────────────────────────────────────────────────
// App-server card
// ─────────────────────────────────────────────────────────────────────

function AppServerCard({ isZh }: { isZh: boolean }) {
  const { state, loading, refresh } = useCodexAvailability();

  const tone: StatusTone =
    state.kind === 'ready' ? 'ok'
    : state.kind === 'too_old' ? 'warning'
    : state.kind === 'spawn_failed' ? 'error'
    : state.kind === 'not_installed' ? 'error'
    : 'idle';

  const pillLabel =
    state.kind === 'ready'         ? (isZh ? '就绪' : 'Ready')
    : state.kind === 'too_old'     ? (isZh ? '版本过旧' : 'Version too old')
    : state.kind === 'spawn_failed'? (isZh ? '启动失败' : 'Spawn failed')
    : state.kind === 'not_installed'? (isZh ? '未安装' : 'Not installed')
    : (isZh ? '检测中…' : 'Checking…');

  return (
    <Card
      title={isZh ? 'Codex 应用服务' : 'Codex app-server'}
      pill={<StatusPill tone={tone} label={pillLabel} />}
      actions={
        <Button variant="ghost" size="sm" onClick={refresh} disabled={loading} aria-label={isZh ? '刷新' : 'Refresh'}>
          {loading ? <SpinnerGap size={14} className="animate-spin" /> : <ArrowClockwise size={14} />}
        </Button>
      }
    >
      {state.kind === 'not_installed' && (
        <p className="text-xs text-foreground/85 leading-relaxed">
          {isZh
            ? '未在 PATH 上找到 codex 命令。请先按官方指引安装 Codex CLI；安装后点击右上角刷新。也可以通过 CODEX_BIN 环境变量指定自定义路径。'
            : 'codex binary not found on PATH. Install Codex CLI per the official guide, then refresh. You can also set CODEX_BIN to point at a custom binary.'}
        </p>
      )}
      {state.kind === 'too_old' && (
        <div className="flex flex-col gap-2">
          <p className="text-xs text-foreground/85 leading-relaxed">
            {isZh
              ? `检测到的 Codex 版本 ${state.version} 低于最低要求 ${state.minimum}。请升级后再使用。`
              : `Detected Codex ${state.version} is below the required minimum ${state.minimum}. Please upgrade before continuing.`}
          </p>
        </div>
      )}
      {state.kind === 'spawn_failed' && (
        <div className="rounded-md border border-status-error-muted bg-status-error-muted/40 px-3 py-2">
          <p className="text-xs text-foreground/85 leading-relaxed">
            <Warning size={12} weight="fill" className="inline-block mr-1 text-status-error-foreground" />
            <span className="font-medium">{isZh ? '启动失败：' : 'Spawn failed: '}</span>
            <span className="break-all">{state.reason}</span>
          </p>
        </div>
      )}
      {state.kind === 'ready' && (
        <div className="divide-y divide-border/50">
          <DefinitionRow label={isZh ? '版本' : 'Version'} value={state.version} />
          <DefinitionRow label={isZh ? 'Codex 目录' : 'Codex home'} value={state.codexHome} />
        </div>
      )}
      {state.kind === 'unknown' && (
        <p className="text-xs text-muted-foreground italic">
          {isZh ? '正在检测 Codex 安装状态…' : 'Detecting Codex installation…'}
        </p>
      )}
    </Card>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Account card
// ─────────────────────────────────────────────────────────────────────

function AccountCard({ isZh }: { isZh: boolean }) {
  const { state, loading, refresh } = useCodexAccount();
  const [loginStart, setLoginStart] = useState<CodexLoginStart | null>(null);
  const [loginPending, setLoginPending] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);
  const [logoutPending, setLogoutPending] = useState(false);

  const startLogin = useCallback(async () => {
    setLoginError(null);
    setLoginPending(true);
    try {
      const res = await fetch('/api/codex/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind: 'chatgpt' }),
      });
      const json = await res.json();
      if (!res.ok || json?.error) {
        setLoginError(typeof json?.error === 'string' ? json.error : `HTTP ${res.status}`);
        return;
      }
      setLoginStart(json?.login ?? null);
    } catch (err) {
      setLoginError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoginPending(false);
    }
  }, []);

  const cancelLogin = useCallback(async () => {
    if (!loginStart || loginStart.type === 'apiKey') {
      setLoginStart(null);
      return;
    }
    try {
      await fetch(`/api/codex/login?loginId=${encodeURIComponent(loginStart.loginId)}`, { method: 'DELETE' });
    } catch { /* best effort */ }
    setLoginStart(null);
  }, [loginStart]);

  const doLogout = useCallback(async () => {
    setLogoutPending(true);
    try {
      await fetch('/api/codex/account', { method: 'DELETE' });
      refresh();
    } catch { /* surface via account state refresh */ }
    finally {
      setLogoutPending(false);
    }
  }, [refresh]);

  const tone: StatusTone =
    state.kind === 'logged_in' ? 'ok'
    : state.kind === 'logged_out' ? 'warning'
    : 'idle';
  const pillLabel =
    state.kind === 'logged_in' ? (isZh ? '已登录' : 'Logged in')
    : state.kind === 'logged_out' ? (isZh ? '未登录' : 'Logged out')
    : (isZh ? '检测中…' : 'Checking…');

  return (
    <Card
      title={isZh ? 'Codex 账户' : 'Codex account'}
      pill={<StatusPill tone={tone} label={pillLabel} />}
      actions={
        <Button variant="ghost" size="sm" onClick={refresh} disabled={loading}>
          {loading ? <SpinnerGap size={14} className="animate-spin" /> : <ArrowClockwise size={14} />}
        </Button>
      }
    >
      {state.kind === 'logged_in' && (
        <div className="flex flex-col gap-3">
          <div className="divide-y divide-border/50">
            {state.account.email && (
              <DefinitionRow label={isZh ? '账户' : 'Account'} value={state.account.email} />
            )}
            {state.account.planType && (
              <DefinitionRow label={isZh ? '套餐' : 'Plan'} value={state.account.planType} />
            )}
            <DefinitionRow label={isZh ? '类型' : 'Type'} value={state.account.type} />
          </div>
          <div className="flex justify-end">
            <Button variant="outline" size="sm" onClick={doLogout} disabled={logoutPending}>
              {logoutPending && <SpinnerGap size={12} className="animate-spin mr-1.5" />}
              {isZh ? '退出登录' : 'Log out'}
            </Button>
          </div>
        </div>
      )}

      {state.kind === 'logged_out' && !loginStart && (
        <div className="flex flex-col gap-3">
          <p className="text-xs text-foreground/85 leading-relaxed">
            {isZh
              ? '登录 Codex 账户后即可在聊天中使用 ChatGPT 内置模型（如 gpt-5.5 等）。'
              : 'Log in to use Codex Account models (gpt-5.5 etc.) in chat.'}
          </p>
          <div className="flex justify-end">
            <Button size="sm" onClick={startLogin} disabled={loginPending}>
              {loginPending && <SpinnerGap size={12} className="animate-spin mr-1.5" />}
              {isZh ? '登录 Codex' : 'Login to Codex'}
            </Button>
          </div>
        </div>
      )}

      {loginStart && (
        <LoginInstructions login={loginStart} onCancel={cancelLogin} onLikelyDone={refresh} isZh={isZh} />
      )}

      {loginError && (
        <div className="rounded-md border border-status-error-muted bg-status-error-muted/40 px-3 py-2 mt-1">
          <p className="text-xs text-foreground/85">
            <Warning size={12} weight="fill" className="inline-block mr-1 text-status-error-foreground" />
            {isZh ? '登录失败：' : 'Login failed: '}
            <span className="break-all">{loginError}</span>
          </p>
        </div>
      )}

      {state.kind === 'unknown' && !loginStart && (
        <p className="text-xs text-muted-foreground italic">
          {isZh
            ? 'Codex 应用服务尚未就绪，账户状态暂不可用。'
            : 'Codex app-server is not ready yet — account status unavailable.'}
        </p>
      )}
    </Card>
  );
}

function LoginInstructions({
  login,
  onCancel,
  onLikelyDone,
  isZh,
}: {
  login: CodexLoginStart;
  onCancel: () => void;
  onLikelyDone: () => void;
  isZh: boolean;
}) {
  if (login.type === 'apiKey') {
    return (
      <div className="rounded-md border border-status-success-muted bg-status-success-muted/30 px-3 py-2">
        <p className="text-xs text-foreground/85">
          <CheckCircle size={12} weight="fill" className="inline-block mr-1 text-status-success-foreground" />
          {isZh ? 'API key 已保存。可以关闭此面板。' : 'API key saved. You can close this panel.'}
        </p>
        <div className="flex justify-end mt-2">
          <Button variant="ghost" size="sm" onClick={() => { onLikelyDone(); onCancel(); }}>
            {isZh ? '完成' : 'Done'}
          </Button>
        </div>
      </div>
    );
  }
  if (login.type === 'chatgpt') {
    return (
      <div className="rounded-md border border-border/60 bg-muted/30 px-3.5 py-3 flex flex-col gap-2.5">
        <p className="text-xs text-foreground/85 leading-relaxed">
          {isZh
            ? '请在浏览器中打开下面的链接完成登录，登录完成后回到这里点击「我已完成登录」。'
            : 'Open the link below in your browser to complete login. Click "I’ve completed login" when finished.'}
        </p>
        <a
          href={login.authUrl}
          target="_blank"
          rel="noreferrer noopener"
          className="text-xs font-mono break-all text-primary hover:underline inline-flex items-start gap-1"
        >
          <ArrowSquareOut size={12} className="mt-0.5 shrink-0" />
          <span>{login.authUrl}</span>
        </a>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={onCancel}>
            {isZh ? '取消' : 'Cancel'}
          </Button>
          <Button size="sm" onClick={() => { onLikelyDone(); onCancel(); }}>
            {isZh ? '我已完成登录' : 'I’ve completed login'}
          </Button>
        </div>
      </div>
    );
  }
  // device code
  return (
    <div className="rounded-md border border-border/60 bg-muted/30 px-3.5 py-3 flex flex-col gap-2.5">
      <p className="text-xs text-foreground/85 leading-relaxed">
        {isZh
          ? '请在浏览器中打开下面的链接，并输入下方的设备码完成登录。'
          : 'Open the URL below in your browser and enter the device code to complete login.'}
      </p>
      <a
        href={login.verificationUrl}
        target="_blank"
        rel="noreferrer noopener"
        className="text-xs font-mono break-all text-primary hover:underline inline-flex items-start gap-1"
      >
        <ArrowSquareOut size={12} className="mt-0.5 shrink-0" />
        <span>{login.verificationUrl}</span>
      </a>
      <div className="rounded bg-card border border-border/60 px-3 py-2 flex items-center justify-between gap-2">
        <span className="text-xs text-muted-foreground">{isZh ? '设备码' : 'Device code'}</span>
        <span className="font-mono text-sm font-semibold tracking-wider">{login.userCode}</span>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => { void navigator.clipboard.writeText(login.userCode); }}
          aria-label={isZh ? '复制' : 'Copy'}
        >
          <Copy size={12} />
        </Button>
      </div>
      <div className="flex justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={onCancel}>
          {isZh ? '取消' : 'Cancel'}
        </Button>
        <Button size="sm" onClick={() => { onLikelyDone(); onCancel(); }}>
          {isZh ? '我已完成登录' : 'I’ve completed login'}
        </Button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Models card
// ─────────────────────────────────────────────────────────────────────

function ModelsCard({ isZh }: { isZh: boolean }) {
  const { group, error, loading, refresh } = useCodexModels();

  const tone: StatusTone =
    error ? 'error'
    : group?.models?.length ? 'ok'
    : 'warning';
  const count = group?.models?.length ?? 0;
  const pillLabel =
    error ? (isZh ? '获取失败' : 'Fetch failed')
    : count > 0 ? (isZh ? `${count} 个模型` : `${count} model${count === 1 ? '' : 's'}`)
    : (isZh ? '暂无模型' : 'No models');

  // Codex Account exposes a `details` field per model in some builds; if
  // not present we fall back to value/label-only display.
  const items = useMemo(() => group?.models ?? [], [group]);

  return (
    <Card
      title={isZh ? 'Codex 模型' : 'Codex models'}
      pill={<StatusPill tone={tone} label={pillLabel} />}
      actions={
        <Button variant="ghost" size="sm" onClick={refresh} disabled={loading}>
          {loading ? <SpinnerGap size={14} className="animate-spin" /> : <ArrowClockwise size={14} />}
        </Button>
      }
    >
      {error && (
        <div className="rounded-md border border-status-error-muted bg-status-error-muted/40 px-3 py-2">
          <p className="text-xs text-foreground/85">
            <Warning size={12} weight="fill" className="inline-block mr-1 text-status-error-foreground" />
            <span className="font-medium">{isZh ? '加载失败：' : 'Failed to load: '}</span>
            <span className="break-all">{error}</span>
          </p>
        </div>
      )}
      {!error && items.length === 0 && (
        <p className="text-xs text-muted-foreground leading-relaxed">
          {isZh
            ? '暂无可用 Codex 模型。请确认 Codex 应用服务已就绪、账户已登录，然后点击刷新。'
            : 'No Codex models available yet. Verify the app-server is ready, you are logged in, then refresh.'}
        </p>
      )}
      {items.length > 0 && (
        <ul className="flex flex-col divide-y divide-border/50">
          {items.map((m) => (
            <li key={m.value} className="py-2 flex items-center justify-between gap-3 text-xs">
              <span className="font-mono truncate">{m.label}</span>
              <span className="font-mono text-[10px] text-muted-foreground truncate max-w-[40%]">{m.value}</span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Panel root
// ─────────────────────────────────────────────────────────────────────

export function CodexPanel() {
  const { t } = useTranslation();
  const isZh = t('nav.chats') === '对话';

  return (
    <div className="flex flex-col gap-4 p-6 max-w-3xl">
      <header className="flex flex-col gap-1">
        <h1 className="text-base font-semibold">
          {isZh ? 'Codex' : 'Codex'}
        </h1>
        <p className="text-xs text-muted-foreground leading-relaxed">
          {isZh
            ? '查看 Codex CLI 安装状态、ChatGPT 账户登录和可用模型。Codex Runtime 当前仅支持 Codex Account 模型；其他服务商（GLM / 百炼 / OpenRouter 等）请切回 Claude Code 或 CodePilot 执行引擎。'
            : 'Inspect Codex CLI installation, ChatGPT account login, and available models. Codex Runtime currently supports only Codex Account models; pick Claude Code or CodePilot Runtime to use other providers (GLM / Bailian / OpenRouter / etc).'}
        </p>
      </header>
      <AppServerCard isZh={isZh} />
      <AccountCard isZh={isZh} />
      <ModelsCard isZh={isZh} />
    </div>
  );
}
