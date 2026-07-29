import { test, expect } from '@playwright/test';
import { goToConversation } from '../helpers';

const FIXTURE_ID = 'default-panel-tool-disclosure';

test.describe('Default panel and CLI disclosure @smoke', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('**/api/setup', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          completed: true,
          claude: 'completed',
          provider: 'completed',
          project: 'skipped',
        }),
      });
    });
    await page.route('**/api/settings/app', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ settings: { default_panel: 'none' } }),
      });
    });
    await page.route('**/api/providers/models**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          groups: [
            {
              provider_id: 'mock',
              provider_name: 'Mock Provider',
              provider_type: 'openai',
              compat: 'openai_compatible',
              models: [
                {
                  value: 'sonnet',
                  label: 'Sonnet',
                  supportedRuntimes: ['codepilot_runtime'],
                  unsupportedReasonByRuntime: {},
                },
              ],
            },
          ],
          default_provider_id: 'mock',
          runtime_applied: 'codepilot_runtime',
        }),
      });
    });
    await page.route(`**/api/chat/sessions/${FIXTURE_ID}`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          session: {
            id: FIXTURE_ID,
            title: 'Disclosure Fixture',
            model: 'sonnet',
            mode: 'code',
            provider_id: 'mock',
            runtime_pin: 'codepilot_runtime',
            working_directory: '/tmp',
            permission_profile: 'default',
            context_summary: null,
          },
        }),
      });
    });
    await page.route(`**/api/chat/sessions/${FIXTURE_ID}/messages**`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          messages: [
            {
              id: 'assistant-with-cli',
              session_id: FIXTURE_ID,
              role: 'assistant',
              content: JSON.stringify([
                {
                  type: 'tool_use',
                  id: 'cli-1',
                  name: 'Bash',
                  input: { command: 'echo disclosure-smoke' },
                },
                {
                  type: 'tool_result',
                  tool_use_id: 'cli-1',
                  content: 'disclosure-smoke',
                },
              ]),
              created_at: '2026-07-29 12:00:00',
              token_usage: null,
            },
          ],
          hasMore: false,
        }),
      });
    });
  });

  test('new chat stays focused and completed CLI details can be reopened @smoke', async ({ page }) => {
    await goToConversation(page, FIXTURE_ID);

    await expect(page.locator('[data-workspace-sidebar]')).toHaveCount(0);
    await expect(page.locator('[data-platform-file-tree]')).toHaveCount(0);

    const groupToggle = page.getByRole('button', { name: /1 completed/ });
    await expect(groupToggle).toHaveAttribute('aria-expanded', 'false');
    await groupToggle.click();
    await expect(groupToggle).toHaveAttribute('aria-expanded', 'true');

    const cliToggle = page.getByRole('button', { name: /echo disclosure-smoke/ });
    await expect(cliToggle).toHaveAttribute('aria-expanded', 'false');
    await cliToggle.click();
    await expect(cliToggle).toHaveAttribute('aria-expanded', 'true');
    await expect(page.getByText('$ echo disclosure-smoke', { exact: true })).toBeVisible();
  });
});
