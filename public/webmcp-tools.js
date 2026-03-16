/**
 * WebMCP tools for CodePilot — dev/test only.
 *
 * Registers structured tools via navigator.modelContext so AI agents
 * (via chrome-devtools-mcp + WebMCP) can interact with CodePilot
 * without screenshot → a11y tree → click loops (~90% token reduction).
 *
 * Only loaded in development mode (see layout.tsx).
 * Requires Chrome 146+ with WebMCP flag enabled.
 */
(function () {
  if (!('modelContext' in navigator)) return;

  const mc = navigator.modelContext;

  // ── Navigation ──────────────────────────────────────────────

  mc.registerTool({
    name: 'codepilot_navigate',
    description: 'Navigate to a CodePilot page. Returns the page title after navigation.',
    inputSchema: {
      type: 'object',
      properties: {
        page: {
          type: 'string',
          enum: ['chat', 'settings', 'settings-providers', 'settings-cli', 'settings-assistant', 'skills', 'mcp', 'cli-tools', 'gallery', 'bridge'],
          description: 'Page to navigate to',
        },
      },
      required: ['page'],
    },
    handler: async ({ page }) => {
      const routes = {
        chat: '/chat',
        settings: '/settings',
        'settings-providers': '/settings#providers',
        'settings-cli': '/settings#claude-cli',
        'settings-assistant': '/settings#assistant',
        skills: '/skills',
        mcp: '/mcp',
        'cli-tools': '/cli-tools',
        gallery: '/gallery',
        bridge: '/bridge',
      };
      const url = routes[page] || '/chat';
      window.location.href = url;
      await new Promise((r) => setTimeout(r, 1000));
      return { success: true, title: document.title, url: window.location.href };
    },
  });

  // ── Chat ────────────────────────────────────────────────────

  mc.registerTool({
    name: 'codepilot_send_message',
    description: 'Send a chat message in the current session. Returns the AI response text.',
    inputSchema: {
      type: 'object',
      properties: {
        message: { type: 'string', description: 'Message to send' },
        waitSeconds: { type: 'number', description: 'Max seconds to wait for response (default 30)' },
      },
      required: ['message'],
    },
    handler: async ({ message, waitSeconds = 30 }) => {
      const textarea = document.querySelector('textarea[placeholder*="Message"]');
      if (!textarea) return { error: 'Chat textarea not found. Navigate to a chat page first.' };

      // Set value and trigger React onChange
      const nativeSet = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
      nativeSet.call(textarea, message);
      textarea.dispatchEvent(new Event('input', { bubbles: true }));

      await new Promise((r) => setTimeout(r, 100));

      // Click submit
      const submitBtn = document.querySelector('button[type="submit"], button:has(svg)');
      const buttons = Array.from(document.querySelectorAll('button'));
      const send = buttons.find((b) => b.textContent.includes('Submit') || b.getAttribute('aria-label')?.includes('Send'));
      (send || submitBtn)?.click();

      // Wait for response
      const start = Date.now();
      let lastContent = '';
      while (Date.now() - start < waitSeconds * 1000) {
        await new Promise((r) => setTimeout(r, 1000));
        const msgs = document.querySelectorAll('[data-role="assistant"], .prose');
        if (msgs.length > 0) {
          const latest = msgs[msgs.length - 1].textContent || '';
          if (latest === lastContent && latest.length > 0) {
            // Content stopped changing — response complete
            return { response: latest.slice(0, 2000), length: latest.length };
          }
          lastContent = latest;
        }
      }
      return { response: lastContent.slice(0, 2000) || '(no response within timeout)', length: lastContent.length };
    },
  });

  mc.registerTool({
    name: 'codepilot_get_chat_status',
    description: 'Get the current chat page status: selected model, provider, streaming state, message count.',
    inputSchema: { type: 'object', properties: {} },
    handler: async () => {
      const modelBtn = document.querySelector('button[class*="model"], button:has(span)');
      const buttons = Array.from(document.querySelectorAll('button'));
      const modelButton = buttons.find((b) => {
        const text = b.textContent || '';
        return text.match(/Sonnet|Opus|Haiku|K2|GLM|Qwen|MiniMax|claude/i);
      });
      const msgs = document.querySelectorAll('[data-role], .prose');
      const textarea = document.querySelector('textarea');
      const isStreaming = !!document.querySelector('.animate-spin, [data-streaming="true"]');

      return {
        currentModel: modelButton?.textContent?.trim() || 'unknown',
        messageCount: msgs.length,
        isStreaming,
        hasInput: !!textarea,
        pageUrl: window.location.pathname,
      };
    },
  });

  // ── Provider Management ────────────────────────────────────

  mc.registerTool({
    name: 'codepilot_list_providers',
    description: 'List all configured providers with their status. Calls the API directly.',
    inputSchema: { type: 'object', properties: {} },
    handler: async () => {
      const res = await fetch('/api/providers');
      if (!res.ok) return { error: `API error: ${res.status}` };
      const data = await res.json();
      return {
        providers: (data.providers || []).map((p) => ({
          id: p.id,
          name: p.name,
          type: p.provider_type,
          hasKey: !!p.api_key,
          baseUrl: p.base_url,
        })),
        envDetected: data.env_detected || {},
      };
    },
  });

  mc.registerTool({
    name: 'codepilot_switch_provider',
    description: 'Switch the active provider and model for new conversations.',
    inputSchema: {
      type: 'object',
      properties: {
        providerId: { type: 'string', description: 'Provider ID to switch to' },
        model: { type: 'string', description: 'Model name (e.g. sonnet, opus)' },
      },
      required: ['providerId'],
    },
    handler: async ({ providerId, model }) => {
      // Set default provider
      const res = await fetch('/api/providers/set-default', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider_id: providerId }),
      });
      if (!res.ok) return { error: `Failed to set default: ${res.status}` };

      localStorage.setItem('codepilot:last-provider-id', providerId);
      if (model) localStorage.setItem('codepilot:last-model', model);

      window.dispatchEvent(new Event('provider-changed'));
      return { success: true, providerId, model: model || 'unchanged' };
    },
  });

  // ── Doctor ─────────────────────────────────────────────────

  mc.registerTool({
    name: 'codepilot_run_doctor',
    description: 'Run Provider Doctor diagnostics. Returns structured probe results.',
    inputSchema: { type: 'object', properties: {} },
    handler: async () => {
      const res = await fetch('/api/doctor');
      if (!res.ok) return { error: `Doctor API error: ${res.status}` };
      return await res.json();
    },
  });

  mc.registerTool({
    name: 'codepilot_doctor_repair',
    description: 'Execute a Doctor repair action.',
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['set-default-provider', 'apply-provider-to-session', 'clear-stale-resume', 'switch-auth-style', 'reimport-env-config'],
        },
        params: { type: 'object', description: 'Action-specific parameters' },
      },
      required: ['action'],
    },
    handler: async ({ action, params }) => {
      const res = await fetch('/api/doctor/repair', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, params }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        return { error: err.error || `Repair failed: ${res.status}` };
      }
      return await res.json();
    },
  });

  mc.registerTool({
    name: 'codepilot_export_logs',
    description: 'Export sanitized diagnostic logs for troubleshooting.',
    inputSchema: { type: 'object', properties: {} },
    handler: async () => {
      const res = await fetch('/api/doctor/export');
      if (!res.ok) return { error: `Export failed: ${res.status}` };
      return await res.json();
    },
  });

  // ── Provider API Test ──────────────────────────────────────

  mc.registerTool({
    name: 'codepilot_test_provider',
    description: 'Send a test message through a specific provider and return the response. Creates a temporary session.',
    inputSchema: {
      type: 'object',
      properties: {
        providerId: { type: 'string', description: 'Provider ID to test' },
        model: { type: 'string', description: 'Model to use (default: sonnet)' },
        message: { type: 'string', description: 'Test message (default: Say just "OK [model name]")' },
      },
      required: ['providerId'],
    },
    handler: async ({ providerId, model = 'sonnet', message }) => {
      const testMsg = message || 'Say just "OK [model name]" and nothing else.';

      // Create session
      const sessRes = await fetch('/api/chat/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: 'WebMCP test',
          mode: 'code',
          working_directory: '/tmp',
          model,
          provider_id: providerId,
        }),
      });
      if (!sessRes.ok) return { error: 'Session creation failed' };
      const { session } = await sessRes.json();

      // Send message
      const chatRes = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_id: session.id, content: testMsg, model, provider_id: providerId }),
      });
      if (!chatRes.ok) return { error: `Chat API: ${chatRes.status}` };

      // Read SSE
      const reader = chatRes.body.getReader();
      const decoder = new TextDecoder();
      let text = '', errorMsg = '';
      const t0 = Date.now();

      while (Date.now() - t0 < 25000) {
        const { done, value } = await reader.read();
        if (done) break;
        for (const line of decoder.decode(value, { stream: true }).split('\n')) {
          if (!line.startsWith('data: ')) continue;
          try {
            const ev = JSON.parse(line.slice(6));
            if (ev.type === 'text') text += ev.data;
            if (ev.type === 'error') errorMsg = ev.data?.slice(0, 300) || 'error';
          } catch {}
        }
      }
      reader.cancel();

      return errorMsg
        ? { status: 'error', error: errorMsg, ttft_ms: Date.now() - t0 }
        : { status: 'ok', response: text.trim().slice(0, 200), ttft_ms: Date.now() - t0 };
    },
  });

  // ── Settings ───────────────────────────────────────────────

  mc.registerTool({
    name: 'codepilot_get_settings',
    description: 'Get current CodePilot settings (Claude status, provider config, workspace state).',
    inputSchema: { type: 'object', properties: {} },
    handler: async () => {
      const [status, setup, workspace] = await Promise.all([
        fetch('/api/claude-status').then((r) => r.json()).catch(() => null),
        fetch('/api/setup').then((r) => r.json()).catch(() => null),
        fetch('/api/settings/workspace').then((r) => r.json()).catch(() => null),
      ]);
      return { claudeStatus: status, setup, workspace: workspace?.state || null };
    },
  });

  console.log('[WebMCP] CodePilot tools registered (%d tools)', 9);
})();
