/**
 * Context Assembler — unified system prompt assembly for all entry points.
 *
 * Extracts the 5-layer prompt assembly logic from route.ts into a pure async
 * function. Both browser chat (route.ts) and bridge (conversation-engine.ts)
 * call this, ensuring consistent context regardless of entry point.
 *
 * Layer injection is controlled by entry point type:
 *   Desktop: workspace + session + assistant instructions + CLI tools + widget
 *   Bridge:  workspace + session + assistant instructions + CLI tools (no widget)
 */

import type { ChatSession } from '@/types';
import { getSetting } from '@/lib/db';

// ── Types ────────────────────────────────────────────────────────────

export interface ContextAssemblyConfig {
  /** The session from DB */
  session: ChatSession;
  /** Entry point: controls which layers are injected */
  entryPoint: 'desktop' | 'bridge';
  /** Current user prompt (used for workspace retrieval + widget keyword detection) */
  userPrompt: string;
  /** Per-request system prompt append (e.g., skill injection for image generation) */
  systemPromptAppend?: string;
  /** Conversation history (for widget keyword detection in resume context) */
  conversationHistory?: Array<{ role: string; content: string }>;
  /** Whether this is an image agent mode call */
  imageAgentMode?: boolean;
}

export interface AssembledContext {
  /** Final assembled system prompt string, or undefined if no layers produced content */
  systemPrompt: string | undefined;
  /** Whether generative UI is enabled (affects widget MCP server + streamClaude param) */
  generativeUIEnabled: boolean;
  /** Whether widget MCP server should be registered (keyword-gated) */
  needsWidgetMcp: boolean;
  /** Onboarding/checkin instructions (route.ts uses this for server-side completion detection) */
  assistantProjectInstructions: string;
  /** Whether this session is in the assistant workspace */
  isAssistantProject: boolean;
}

// ── Main function ────────────────────────────────────────────────────

export async function assembleContext(config: ContextAssemblyConfig): Promise<AssembledContext> {
  const { session, entryPoint, userPrompt, systemPromptAppend, conversationHistory, imageAgentMode } = config;
  const t0 = Date.now();

  let workspacePrompt = '';
  let assistantProjectInstructions = '';
  let isAssistantProject = false;

  // ── Layer 1: Workspace prompt (if assistant project session) ──────
  try {
    const workspacePath = getSetting('assistant_workspace_path');
    if (workspacePath) {
      const sessionWd = session.working_directory || '';
      isAssistantProject = sessionWd === workspacePath;

      if (isAssistantProject) {
        const { loadWorkspaceFiles, assembleWorkspacePrompt, loadState, shouldRunHeartbeat } =
          await import('@/lib/assistant-workspace');

        // Incremental reindex BEFORE MCP search so tool calls see latest content
        try {
          const { indexWorkspace } = await import('@/lib/workspace-indexer');
          indexWorkspace(workspacePath);
        } catch {
          // indexer not available, skip
        }

        const files = loadWorkspaceFiles(workspacePath);

        // Memory/retrieval is now handled by codepilot_memory_search MCP tool
        // (registered in claude-client.ts for assistant mode).
        // assembleWorkspacePrompt only includes identity files (soul/user/claude).
        workspacePrompt = assembleWorkspacePrompt(files);

        const state = loadState(workspacePath);

        if (!state.onboardingComplete) {
          assistantProjectInstructions = buildOnboardingInstructions();
        } else if (shouldRunHeartbeat(state)) {
          assistantProjectInstructions = buildHeartbeatInstructions();
        } else {
          // Phase 3: Progressive file update guidance for completed onboarding
          assistantProjectInstructions = buildProgressiveUpdateInstructions();
        }
      }
    }
  } catch (e) {
    console.warn('[context-assembler] Failed to load assistant workspace:', e);
  }

  // ── Layer 2: Session prompt + per-request append ──────────────────
  let finalSystemPrompt: string | undefined = session.system_prompt || undefined;
  if (systemPromptAppend) {
    finalSystemPrompt = (finalSystemPrompt || '') + '\n\n' + systemPromptAppend;
  }

  // Workspace prompt goes first (base personality), session prompt after (task override)
  if (workspacePrompt) {
    finalSystemPrompt = workspacePrompt + '\n\n' + (finalSystemPrompt || '');
  }

  // ── Layer 3: Assistant project instructions ───────────────────────
  if (assistantProjectInstructions) {
    finalSystemPrompt = (finalSystemPrompt || '') + '\n\n' + assistantProjectInstructions;
  }

  // Layer 4 removed — CLI tools capability prompt is now injected in
  // claude-client.ts only when the MCP server is also mounted (keyword-gated).

  // ── Layer 5: Widget system prompt (desktop only) ──────────────────
  const generativeUISetting = getSetting('generative_ui_enabled');
  const generativeUIEnabled = entryPoint === 'desktop' && generativeUISetting !== 'false';

  if (generativeUIEnabled) {
    try {
      const { WIDGET_SYSTEM_PROMPT } = await import('@/lib/widget-guidelines');
      finalSystemPrompt = (finalSystemPrompt || '') + '\n\n' + WIDGET_SYSTEM_PROMPT;
    } catch {
      // Widget prompt injection failed — don't block
    }
  }

  // ── Widget MCP keyword detection (desktop only) ───────────────────
  let needsWidgetMcp = false;
  if (generativeUIEnabled) {
    const widgetKeywords = /可视化|图表|流程图|时间线|架构图|对比|visualiz|diagram|chart|flowchart|timeline|infographic|interactive|widget|show-widget|hierarchy|dashboard/i;
    if (widgetKeywords.test(userPrompt)) needsWidgetMcp = true;
    else if (conversationHistory?.some(m => m.content.includes('show-widget'))) needsWidgetMcp = true;
    else if (imageAgentMode) needsWidgetMcp = true;
  }

  // ── Layer 6: Dashboard context (desktop only) ─────────────────────
  // Inject compact summary of pinned widgets so the AI knows what's on the dashboard.
  if (entryPoint === 'desktop' && session.working_directory) {
    try {
      const { readDashboard } = await import('@/lib/dashboard-store');
      const config = readDashboard(session.working_directory);
      if (config.widgets.length > 0) {
        const summary = config.widgets.map((w, i) => `${i + 1}. ${w.title} — ${w.dataContract}`).join('\n');
        const trimmed = summary.length > 500 ? summary.slice(0, 500) + '...' : summary;
        finalSystemPrompt = (finalSystemPrompt || '') + `\n\n<active-dashboard>\nThe user has ${config.widgets.length} widget(s) pinned to their project dashboard:\n${trimmed}\n</active-dashboard>`;
      }
    } catch {
      // Dashboard read failed — don't block
    }
  }

  console.log(`[context-assembler] total: ${Date.now() - t0}ms (entry=${entryPoint}, prompt=${finalSystemPrompt?.length ?? 0} chars)`);

  return {
    systemPrompt: finalSystemPrompt,
    generativeUIEnabled,
    needsWidgetMcp,
    assistantProjectInstructions,
    isAssistantProject,
  };
}

// ── Instruction templates ────────────────────────────────────────────

function buildOnboardingInstructions(): string {
  return `<assistant-project-task type="onboarding">
你正在进行助理工作区的首次设置。通过自然对话了解用户，围绕以下主题展开：

1. 关于你：怎么称呼你？你的角色和主要工作是什么？有什么偏好？
2. 关于我：你希望我是什么风格？有什么边界和禁区？
3. 关于工作区：你的文件和笔记怎么组织？有什么习惯？

规则：
- 用自然对话方式展开，不要一次列出所有问题
- 每轮只问 1-2 个相关的问题，根据用户的回答深入
- 至少 3 轮对话后，如果用户表示 OK/可以了/差不多了/够了，进入完成流程
- 用户随时主动继续聊就继续收集信息，不要打断
- 用户明确说结束就立即进入完成流程
- 完成时输出以下格式，JSON 中的 key 可以自由命名，涵盖你收集到的所有信息：

\\\`\\\`\\\`onboarding-complete
{"name":"用户称呼","assistant_name":"助理名字","style":"沟通风格偏好","boundaries":"边界和禁区","goals":"当前目标","organization":"工作区组织方式","preferences":"其他偏好"}
\\\`\\\`\\\`

- 输出 fence 后，明确告知用户："初始设置完成！我已经根据我们的对话生成了配置文件。从现在开始，我会按照这些设置来帮你。"
- 不要自己写文件，系统会自动从你收集的信息生成 soul.md、user.md、claude.md 和 memory.md
- 整个过程保持友好、自然，像两个人第一次认识在聊天
</assistant-project-task>`;
}

function buildHeartbeatInstructions(): string {
  return `<assistant-project-task type="heartbeat">
这是一次心跳检查。请按照 HEARTBEAT.md 中的检查清单逐项检查。

规则：
- 如果所有检查项都无需关注，回复中包含 HEARTBEAT_OK
- 如果有需要告诉用户的事情，自然地说出来，不要用问卷格式
- 你可以在对话中更新文件：
  - memory/daily/{今天日期}.md：追加今天的记录
  - memory.md：追加新发现的稳定偏好或事实
  - user.md：更新用户画像（更新后必须告知用户）
  - HEARTBEAT.md：更新检查清单（如果用户要求或你发现需要调整）
- 不要问固定的问卷问题
- 不要重复上次已讨论的内容
- 检查完毕后，如果没事就只回复 HEARTBEAT_OK，不要加多余的寒暄
</assistant-project-task>`;
}

function buildProgressiveUpdateInstructions(): string {
  return `<assistant-memory-guidance>
## 记忆与文件更新

你可以在对话中随时更新 workspace 文件来记住重要信息：

### 身份文件（修改后必须告知用户）
- soul.md：你的风格和行为规则变化时更新
- user.md：用户画像变化时更新
- claude.md：执行规则变化时更新

### 记忆文件（可以静默更新）
- memory.md：追加稳定的事实和偏好（只追加，不覆写）
- memory/daily/{日期}.md：记录今天的工作和决策

### 更新判断标准
- 用户明确要求记住/修改某规则 → 立即更新
- 用户连续表达同一偏好 → 写入 user.md 或 soul.md
- 重要决策或经验总结 → 写入 memory.md
- 日常工作记录 → 写入 daily memory
- 不确定是否值得记录 → 先不写，多观察

### 禁止
- 不要在身份文件中存储敏感信息（密码、API key）
- 不要覆写 memory.md 已有内容（只追加）
- 不要在没有告知用户的情况下修改 soul/user/claude.md
</assistant-memory-guidance>`;
}
