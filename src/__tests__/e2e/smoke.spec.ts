import { test, expect } from '@playwright/test';
import {
  goToChat,
  goToPlugins,
  goToMCP,
  goToSettings,
  collectConsoleErrors,
  filterCriticalErrors,
  waitForPageReady,
} from '../helpers';

test.describe('Smoke @smoke', () => {
  test('Home redirects to /chat @smoke', async ({ page }) => {
    const errors = collectConsoleErrors(page);
    const response = await page.goto('/');
    await waitForPageReady(page);

    expect(response?.status()).toBeLessThan(400);
    expect(page.url()).toContain('/chat');

    const title = await page.title();
    expect(title).not.toContain('404');
    expect(title).not.toContain('500');

    const hasErrorOverlay = await page.locator('#__next-build-error, [data-nextjs-dialog]').count();
    expect(hasErrorOverlay).toBe(0);

    const critical = filterCriticalErrors(errors);
    expect(critical).toHaveLength(0);
  });

  test('Chat page loads @smoke', async ({ page }) => {
    const errors = collectConsoleErrors(page);
    await goToChat(page);

    const title = await page.title();
    expect(title).not.toContain('404');
    expect(title).not.toContain('500');

    const hasErrorOverlay = await page.locator('#__next-build-error, [data-nextjs-dialog]').count();
    expect(hasErrorOverlay).toBe(0);

    const critical = filterCriticalErrors(errors);
    expect(critical).toHaveLength(0);
  });

  test('Plugins page loads @smoke', async ({ page }) => {
    const errors = collectConsoleErrors(page);
    await goToPlugins(page);

    const title = await page.title();
    expect(title).not.toContain('404');
    expect(title).not.toContain('500');

    const hasErrorOverlay = await page.locator('#__next-build-error, [data-nextjs-dialog]').count();
    expect(hasErrorOverlay).toBe(0);

    const critical = filterCriticalErrors(errors);
    expect(critical).toHaveLength(0);
  });

  test('MCP page loads @smoke', async ({ page }) => {
    const errors = collectConsoleErrors(page);
    await goToMCP(page);

    const title = await page.title();
    expect(title).not.toContain('404');
    expect(title).not.toContain('500');

    const hasErrorOverlay = await page.locator('#__next-build-error, [data-nextjs-dialog]').count();
    expect(hasErrorOverlay).toBe(0);

    const critical = filterCriticalErrors(errors);
    expect(critical).toHaveLength(0);
  });

  test('Settings page loads @smoke', async ({ page }) => {
    const errors = collectConsoleErrors(page);
    await goToSettings(page);

    const title = await page.title();
    expect(title).not.toContain('404');
    expect(title).not.toContain('500');

    const hasErrorOverlay = await page.locator('#__next-build-error, [data-nextjs-dialog]').count();
    expect(hasErrorOverlay).toBe(0);

    const critical = filterCriticalErrors(errors);
    expect(critical).toHaveLength(0);
  });

  test('Settings Codex page loads @smoke', async ({ page }) => {
    // Phase 5 Phase 6 (2026-05-14) — Codex visibility收口. Verifies the
    // new /settings/codex route renders the three Codex status cards
    // (app-server / account / models) without exploding even when the
    // Codex binary is missing or the user is logged out (those states
    // are valid for the panel to render — they show install / login
    // hints, not an error overlay).
    const errors = collectConsoleErrors(page);
    await page.goto('/settings/codex');
    await waitForPageReady(page);

    const title = await page.title();
    expect(title).not.toContain('404');
    expect(title).not.toContain('500');

    const hasErrorOverlay = await page.locator('#__next-build-error, [data-nextjs-dialog]').count();
    expect(hasErrorOverlay).toBe(0);

    // The three card titles ride on top-level <h3>s. The exact tone of
    // their status pills depends on the test machine's Codex install
    // state; we only check the structural copy is present so the
    // smoke catches "panel failed to mount" regressions.
    const cardTitles = await page.locator('h3').allTextContents();
    const titleBlob = cardTitles.join(' ');
    expect(titleBlob).toMatch(/Codex 应用服务|Codex app-server/);
    expect(titleBlob).toMatch(/Codex 账户|Codex account/);
    expect(titleBlob).toMatch(/Codex 模型|Codex models/);

    const critical = filterCriticalErrors(errors);
    expect(critical).toHaveLength(0);
  });
});
