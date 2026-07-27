/**
 * Unit tests for proxy-config.ts — the single source of truth for the in-app
 * network proxy (Settings → General). Covers reading/validating the setting,
 * NO_PROXY loopback merging, subprocess env overlay, and process.env sync.
 *
 * Contract highlights:
 *   - No setting → every helper is a no-op (null / unchanged env), so users
 *     without a proxy see zero behavior change.
 *   - loopback (localhost / 127.0.0.1 / ::1) is ALWAYS in NO_PROXY so the
 *     global dispatcher can never route the app's own 127.0.0.1 traffic
 *     through the proxy.
 *   - A malformed / non-http(s) URL is treated as "no proxy" rather than
 *     silently breaking every outbound request.
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

const PROXY_KEYS = ['HTTP_PROXY', 'HTTPS_PROXY', 'http_proxy', 'https_proxy', 'NO_PROXY', 'no_proxy'];
const savedEnv: Record<string, string | undefined> = {};

beforeEach(async () => {
  for (const k of PROXY_KEYS) { savedEnv[k] = process.env[k]; delete process.env[k]; }
  const { setSetting } = await import('@/lib/db');
  setSetting('network_proxy_url', '');
  setSetting('network_no_proxy', '');
});

afterEach(() => {
  for (const k of PROXY_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
});

describe('proxy-config', () => {
  it('getConfiguredProxy returns null when unset', async () => {
    const { getConfiguredProxy } = await import('../../lib/proxy-config');
    assert.equal(getConfiguredProxy(), null);
  });

  it('getConfiguredProxy returns url + loopback-merged noProxy when set', async () => {
    const { setSetting } = await import('@/lib/db');
    setSetting('network_proxy_url', 'http://10.0.0.1:3218');
    setSetting('network_no_proxy', 'example.com, .internal.net');
    const { getConfiguredProxy } = await import('../../lib/proxy-config');
    const p = getConfiguredProxy();
    assert.equal(p?.url, 'http://10.0.0.1:3218');
    // loopback always present + user entries preserved
    assert.ok(p?.noProxy.includes('127.0.0.1'));
    assert.ok(p?.noProxy.includes('localhost'));
    assert.ok(p?.noProxy.includes('example.com'));
    assert.ok(p?.noProxy.includes('.internal.net'));
  });

  it('getConfiguredProxy returns null for a non-http(s) / malformed URL', async () => {
    const { setSetting } = await import('@/lib/db');
    const { getConfiguredProxy } = await import('../../lib/proxy-config');
    setSetting('network_proxy_url', 'socks5://1.2.3.4:1080');
    assert.equal(getConfiguredProxy(), null);
    setSetting('network_proxy_url', 'not a url');
    assert.equal(getConfiguredProxy(), null);
  });

  it('mergeNoProxy always includes loopback and dedups', async () => {
    const { mergeNoProxy } = await import('../../lib/proxy-config');
    const merged = mergeNoProxy('127.0.0.1, foo.com, foo.com');
    const parts = merged.split(',');
    assert.ok(parts.includes('localhost'));
    assert.ok(parts.includes('127.0.0.1'));
    assert.ok(parts.includes('::1'));
    assert.ok(parts.includes('foo.com'));
    // 127.0.0.1 and foo.com appear exactly once
    assert.equal(parts.filter((p) => p === '127.0.0.1').length, 1);
    assert.equal(parts.filter((p) => p === 'foo.com').length, 1);
  });

  it('buildProxyEnvVars is null when unset, full (upper+lower) when set', async () => {
    const { buildProxyEnvVars } = await import('../../lib/proxy-config');
    assert.equal(buildProxyEnvVars(), null);

    const { setSetting } = await import('@/lib/db');
    setSetting('network_proxy_url', 'http://p:1');
    const vars = buildProxyEnvVars();
    assert.equal(vars?.HTTP_PROXY, 'http://p:1');
    assert.equal(vars?.HTTPS_PROXY, 'http://p:1');
    assert.equal(vars?.http_proxy, 'http://p:1');
    assert.equal(vars?.https_proxy, 'http://p:1');
    assert.ok(vars?.NO_PROXY.includes('127.0.0.1'));
    assert.equal(vars?.no_proxy, vars?.NO_PROXY);
  });

  it('applyConfiguredProxyEnv leaves env untouched when no proxy is set', async () => {
    const { applyConfiguredProxyEnv } = await import('../../lib/proxy-config');
    const out = applyConfiguredProxyEnv({ FOO: 'bar' });
    assert.deepEqual(out, { FOO: 'bar' });
    assert.equal('HTTPS_PROXY' in out, false);
  });

  it('applyConfiguredProxyEnv overlays proxy vars onto a subprocess env when set', async () => {
    const { setSetting } = await import('@/lib/db');
    setSetting('network_proxy_url', 'http://10.0.0.1:3218');
    const { applyConfiguredProxyEnv } = await import('../../lib/proxy-config');
    const out = applyConfiguredProxyEnv({ FOO: 'bar' }) as Record<string, string>;
    assert.equal(out.FOO, 'bar');
    assert.equal(out.HTTPS_PROXY, 'http://10.0.0.1:3218');
    assert.ok(out.NO_PROXY.includes('127.0.0.1'));
  });

  it('syncConfiguredProxyToProcessEnv writes process.env when set, no-op when unset', async () => {
    const { syncConfiguredProxyToProcessEnv } = await import('../../lib/proxy-config');
    // unset → must not create the vars
    syncConfiguredProxyToProcessEnv();
    assert.equal(process.env.HTTPS_PROXY, undefined);

    const { setSetting } = await import('@/lib/db');
    setSetting('network_proxy_url', 'http://10.0.0.1:3218');
    syncConfiguredProxyToProcessEnv();
    assert.equal(process.env.HTTPS_PROXY, 'http://10.0.0.1:3218');
    assert.ok((process.env.NO_PROXY ?? '').includes('127.0.0.1'));
  });

  it('syncConfiguredProxyToProcessEnv does NOT delete an inherited proxy when unset', async () => {
    process.env.HTTPS_PROXY = 'http://inherited:9';
    const { syncConfiguredProxyToProcessEnv } = await import('../../lib/proxy-config');
    syncConfiguredProxyToProcessEnv(); // no app proxy configured
    assert.equal(process.env.HTTPS_PROXY, 'http://inherited:9');
  });
});
