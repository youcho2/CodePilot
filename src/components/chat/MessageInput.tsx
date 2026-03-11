'use client';

import { useRef, useState, useCallback, useEffect, type KeyboardEvent, type FormEvent } from 'react';
import {
  At,
  Question,
  ArrowUp,
  Terminal,
  Plus,
  X,
  Trash,
  Coins,
  FileZip,
  Stethoscope,
  NotePencil,
  ListMagnifyingGlass,
  Brain,
  GlobeSimple,
  Stop,
  Lightning,
  CaretDown,
  Gear,
} from "@phosphor-icons/react";
import type { Icon } from "@phosphor-icons/react";
import { cn } from '@/lib/utils';
import { useTranslation } from '@/hooks/useTranslation';
import type { TranslationKey } from '@/i18n';
import {
  PromptInput,
  PromptInputTextarea,
  PromptInputFooter,
  PromptInputTools,
  PromptInputButton,
  PromptInputSubmit,
  usePromptInputAttachments,
} from '@/components/ai-elements/prompt-input';
import type { ChatStatus } from 'ai';
import type { FileAttachment, ProviderModelGroup, SkillKind } from '@/types';
import { nanoid } from 'nanoid';
import { SlashCommandButton } from './SlashCommandButton';
import { SlashCommandPopover } from './SlashCommandPopover';
import type { PopoverItem, PopoverMode } from './SlashCommandPopover';
import { CliToolsPopover } from './CliToolsPopover';
import type { CliToolItem } from './CliToolsPopover';
import { ModelSelectorDropdown } from './ModelSelectorDropdown';
import { EffortSelectorDropdown } from './EffortSelectorDropdown';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { useImageGen } from '@/hooks/useImageGen';
import { PENDING_KEY, setRefImages, deleteRefImages } from '@/lib/image-ref-store';

const IMAGE_AGENT_SYSTEM_PROMPT = `你是一个图像生成助手。当用户请求生成图片时，分析用户意图并以结构化格式输出。

## 单张生成
如果用户只需要生成一张图片，输出：
\`\`\`image-gen-request
{"prompt":"详细的英文描述","aspectRatio":"1:1","resolution":"1K"}
\`\`\`

## 批量生成
如果用户提供了文档/列表/多个需求，需要批量生成多张图片，输出：
\`\`\`batch-plan
{"summary":"计划摘要","items":[{"prompt":"英文描述","aspectRatio":"1:1","resolution":"1K","tags":[]}]}
\`\`\`

## 参考图（垫图）
如果用户上传了图片，这些图片会自动作为参考图传给图片生成模型。你在 prompt 中应该描述如何利用这些参考图，例如：
- 基于参考图的风格/内容进行创作
- 将参考图中的元素融入新图
- 按照参考图的构图生成新图

## 连续编辑（基于上一次生成结果）
如果用户要求修改/编辑/调整之前生成的图片，在 JSON 中加入 "useLastGenerated": true，系统会自动将上次生成的结果图作为参考图传入。
编辑模式下 prompt 要简洁直接，只描述要做的修改，不要重复描述整张图片的内容。例如：
- 用户说"去掉右边的香水" → prompt: "Remove the perfume bottle on the right side of the image"
- 用户说"把背景换成蓝色" → prompt: "Change the background color to blue"
- 用户说"加个太阳" → prompt: "Add a sun in the sky"

\`\`\`image-gen-request
{"prompt":"简洁的英文编辑指令","aspectRatio":"1:1","resolution":"1K","useLastGenerated":true}
\`\`\`

## 规则
- 新图生成时 prompt 必须是详细的英文描述
- 编辑已有图片时 prompt 应该简洁直接，只描述修改内容
- aspectRatio 可选: 1:1, 16:9, 9:16, 3:2, 2:3, 4:3, 3:4
- resolution 可选: 1K, 2K, 4K
- 批量生成时每个 item 都需要独立的详细 prompt
- 如果用户没有特别要求比例和分辨率，使用 1:1 和 1K 作为默认值
- 如果用户上传了参考图，prompt 中要明确说明如何使用这些参考图
- 如果用户要求修改上一张生成的图片，必须加 "useLastGenerated": true
- 在输出结构化块之前，可以先简要说明你的理解和计划`;


interface MessageInputProps {
  onSend: (content: string, files?: FileAttachment[], systemPromptAppend?: string, displayOverride?: string) => void;
  onImageGenerate?: (prompt: string, files?: FileAttachment[]) => void;
  onCommand?: (command: string) => void;
  onStop?: () => void;
  disabled?: boolean;
  isStreaming?: boolean;
  sessionId?: string;
  modelName?: string;
  onModelChange?: (model: string) => void;
  providerId?: string;
  onProviderModelChange?: (providerId: string, model: string) => void;
  workingDirectory?: string;
  mode?: string;
  onModeChange?: (mode: string) => void;
  onAssistantTrigger?: () => void;
  /** Effort selection lifted to parent for inclusion in the stream chain */
  effort?: string;
  onEffortChange?: (effort: string | undefined) => void;
  /** SDK init metadata — when available, used to validate command/skill availability */
  sdkInitMeta?: { tools?: unknown; slash_commands?: unknown; skills?: unknown } | null;
}

interface CommandBadge {
  command: string;
  label: string;
  description: string;
  kind: SkillKind;
  installedSource?: "agents" | "claude";
}

interface CliBadge {
  id: string;
  name: string;
}

// Expansion prompts for CLI-only commands (not natively supported by SDK).
// SDK-native commands (/compact, /init, /review) are sent as-is — the SDK handles them directly.
const COMMAND_PROMPTS: Record<string, string> = {
  '/doctor': 'Run diagnostic checks on this project. Check system health, dependencies, configuration files, and report any issues.',
  '/terminal-setup': 'Help me configure my terminal for optimal use with Claude Code. Check current setup and suggest improvements.',
  '/memory': 'Show the current CLAUDE.md project memory file and help me review or edit it.',
};

const BUILT_IN_COMMANDS: PopoverItem[] = [
  { label: 'help', value: '/help', description: 'Show available commands and tips', descriptionKey: 'messageInput.helpDesc', builtIn: true, immediate: true, icon: Question },
  { label: 'clear', value: '/clear', description: 'Clear conversation history', descriptionKey: 'messageInput.clearDesc', builtIn: true, immediate: true, icon: Trash },
  { label: 'cost', value: '/cost', description: 'Show token usage statistics', descriptionKey: 'messageInput.costDesc', builtIn: true, immediate: true, icon: Coins },
  { label: 'compact', value: '/compact', description: 'Compress conversation context', descriptionKey: 'messageInput.compactDesc', builtIn: true, kind: 'sdk_command', icon: FileZip },
  { label: 'doctor', value: '/doctor', description: 'Diagnose project health', descriptionKey: 'messageInput.doctorDesc', builtIn: true, kind: 'codepilot_command', icon: Stethoscope },
  { label: 'init', value: '/init', description: 'Initialize CLAUDE.md for project', descriptionKey: 'messageInput.initDesc', builtIn: true, kind: 'sdk_command', icon: NotePencil },
  { label: 'review', value: '/review', description: 'Review code quality', descriptionKey: 'messageInput.reviewDesc', builtIn: true, kind: 'sdk_command', icon: ListMagnifyingGlass },
  { label: 'terminal-setup', value: '/terminal-setup', description: 'Configure terminal settings', descriptionKey: 'messageInput.terminalSetupDesc', builtIn: true, kind: 'codepilot_command', icon: Terminal },
  { label: 'memory', value: '/memory', description: 'Edit project memory file', descriptionKey: 'messageInput.memoryDesc', builtIn: true, kind: 'codepilot_command', icon: Brain },
];

interface ModeOption {
  value: string;
  label: string;
}

const MODE_OPTIONS: ModeOption[] = [
  { value: 'code', label: 'Code' },
  { value: 'plan', label: 'Plan' },
];

// Default Claude model options — used as fallback when API is unavailable
const DEFAULT_MODEL_OPTIONS = [
  { value: 'sonnet', label: 'Sonnet 4.6' },
  { value: 'opus', label: 'Opus 4.6' },
  { value: 'haiku', label: 'Haiku 4.5' },
];

/**
 * Convert a data URL to a FileAttachment object.
 */
async function dataUrlToFileAttachment(
  dataUrl: string,
  filename: string,
  mediaType: string,
): Promise<FileAttachment> {
  // data:image/png;base64,<data>  — extract the base64 part
  const base64 = dataUrl.includes(',') ? dataUrl.split(',')[1] : dataUrl;

  // Estimate raw size from base64 length
  const size = Math.ceil((base64.length * 3) / 4);

  return {
    id: nanoid(),
    name: filename,
    type: mediaType || 'application/octet-stream',
    size,
    data: base64,
  };
}

/**
 * Submit button that's aware of file attachments. Must be rendered inside PromptInput.
 */
function FileAwareSubmitButton({
  status,
  onStop,
  disabled,
  inputValue,
  hasBadge,
}: {
  status: ChatStatus;
  onStop?: () => void;
  disabled?: boolean;
  inputValue: string;
  hasBadge: boolean;
}) {
  const attachments = usePromptInputAttachments();
  const hasFiles = attachments.files.length > 0;
  const isStreaming = status === 'streaming' || status === 'submitted';

  return (
    <PromptInputSubmit
      status={status}
      onStop={onStop}
      disabled={disabled || (!isStreaming && !inputValue.trim() && !hasBadge && !hasFiles)}
      className="rounded-full"
    >
      {isStreaming ? (
        <Stop size={16} />
      ) : (
        <ArrowUp size={16} />
      )}
    </PromptInputSubmit>
  );
}

/**
 * Attachment button that opens the file dialog. Must be rendered inside PromptInput.
 */
function AttachFileButton() {
  const attachments = usePromptInputAttachments();
  const { t } = useTranslation();

  return (
    <PromptInputButton
      onClick={() => attachments.openFileDialog()}
      tooltip={t('messageInput.attachFiles')}
    >
      <Plus size={16} />
    </PromptInputButton>
  );
}

/**
 * Bridge component that listens for 'attach-file-to-chat' custom events
 * from the file tree and inserts `@filepath` into the textarea.
 * Works identically on web and Electron (pure text, no fetch/blob).
 */
function FileTreeAttachmentBridge() {
  useEffect(() => {
    const handler = (e: Event) => {
      const customEvent = e as CustomEvent<{ path: string }>;
      const filePath = customEvent.detail?.path;
      if (!filePath) return;

      // Dispatch a second event that the outer MessageInput component listens for
      // to insert the @-mention into the textarea
      window.dispatchEvent(new CustomEvent('insert-file-mention', { detail: { path: filePath } }));
    };

    window.addEventListener('attach-file-to-chat', handler);
    return () => window.removeEventListener('attach-file-to-chat', handler);
  }, []);

  return null;
}

/**
 * Capsule display for attached files, rendered inside PromptInput context.
 */
function FileAttachmentsCapsules() {
  const attachments = usePromptInputAttachments();

  if (attachments.files.length === 0) return null;

  return (
    <div className="flex w-full flex-wrap items-center gap-1.5 px-3 pt-2 pb-0 order-first">
      {attachments.files.map((file) => {
        const isImage = file.mediaType?.startsWith('image/');
        return (
          <span
            key={file.id}
            className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 pl-2 pr-1 py-0.5 text-xs font-medium border border-emerald-500/20"
          >
            {isImage && file.url && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={file.url}
                alt={file.filename || 'image'}
                className="h-5 w-5 rounded object-cover"
              />
            )}
            <span className="max-w-[120px] truncate text-[11px]">
              {file.filename || 'file'}
            </span>
            <button
              type="button"
              onClick={() => attachments.remove(file.id)}
              className="ml-0.5 rounded-full p-0.5 hover:bg-emerald-500/20 transition-colors"
            >
              <X size={12} />
            </button>
          </span>
        );
      })}
    </div>
  );
}

export function MessageInput({
  onSend,
  onImageGenerate,
  onCommand,
  onStop,
  disabled,
  isStreaming,
  sessionId,
  modelName,
  onModelChange,
  providerId,
  onProviderModelChange,
  workingDirectory,
  mode = 'code',
  onModeChange,
  onAssistantTrigger,
  effort: effortProp,
  onEffortChange,
  sdkInitMeta,
}: MessageInputProps) {
  const { t, locale } = useTranslation();
  const imageGen = useImageGen();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [popoverMode, setPopoverMode] = useState<PopoverMode>(null);
  const [popoverItems, setPopoverItems] = useState<PopoverItem[]>([]);
  const [popoverFilter, setPopoverFilter] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [triggerPos, setTriggerPos] = useState<number | null>(null);
  const [inputValue, setInputValue] = useState('');
  const [badge, setBadge] = useState<CommandBadge | null>(null);
  const [cliBadge, setCliBadge] = useState<CliBadge | null>(null);
  const [cliTools, setCliTools] = useState<CliToolItem[]>([]);
  const [cliFilter, setCliFilter] = useState('');
  const cliSearchRef = useRef<HTMLInputElement>(null);
  const [providerGroups, setProviderGroups] = useState<ProviderModelGroup[]>([]);
  const [defaultProviderId, setDefaultProviderId] = useState<string>('');
  const [aiSuggestions, setAiSuggestions] = useState<PopoverItem[]>([]);
  const [aiSearchLoading, setAiSearchLoading] = useState(false);
  const aiSearchAbortRef = useRef<AbortController | null>(null);
  const aiSearchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const modelMenuRef = useRef<HTMLDivElement>(null);
  const [modelMenuOpen, setModelMenuOpen] = useState(false);
  const [modelSearch, setModelSearch] = useState('');
  const effortMenuRef = useRef<HTMLDivElement>(null);
  const [effortMenuOpen, setEffortMenuOpen] = useState(false);

  // Assistant trigger on first focus
  const assistantTriggerFired = useRef(false);

  const handleAssistantFocus = useCallback(() => {
    if (!assistantTriggerFired.current && onAssistantTrigger) {
      assistantTriggerFired.current = true;
      onAssistantTrigger();
    }
  }, [onAssistantTrigger]);

  // Listen for file tree "+" button: insert @filepath into textarea
  useEffect(() => {
    const handler = (e: Event) => {
      const filePath = (e as CustomEvent<{ path: string }>).detail?.path;
      if (!filePath) return;
      const mention = `@${filePath} `;
      setInputValue((prev) => {
        // Insert at end, adding a space separator if needed
        const needsSpace = prev.length > 0 && !prev.endsWith(' ') && !prev.endsWith('\n');
        return prev + (needsSpace ? ' ' : '') + mention;
      });
      setTimeout(() => textareaRef.current?.focus(), 0);
    };
    window.addEventListener('insert-file-mention', handler);
    return () => window.removeEventListener('insert-file-mention', handler);
  }, []);

  // Fetch provider groups from API
  const fetchProviderModels = useCallback(() => {
    fetch('/api/providers/models')
      .then((r) => r.json())
      .then((data) => {
        if (data.groups && data.groups.length > 0) {
          setProviderGroups(data.groups);
        } else {
          setProviderGroups([{
            provider_id: 'env',
            provider_name: 'Anthropic',
            provider_type: 'anthropic',
            models: DEFAULT_MODEL_OPTIONS,
          }]);
        }
        setDefaultProviderId(data.default_provider_id || '');
      })
      .catch(() => {
        setProviderGroups([{
          provider_id: 'env',
          provider_name: 'Anthropic',
          provider_type: 'anthropic',
          models: DEFAULT_MODEL_OPTIONS,
        }]);
        setDefaultProviderId('');
      });
  }, []);

  // Load models on mount and listen for provider changes
  useEffect(() => {
    fetchProviderModels();
    const handler = () => fetchProviderModels();
    window.addEventListener('provider-changed', handler);
    return () => window.removeEventListener('provider-changed', handler);
  }, [fetchProviderModels]);

  // Derive flat model list for current provider (used by currentModelOption lookup)
  const currentProviderIdValue = providerId || defaultProviderId || (providerGroups[0]?.provider_id ?? '');
  const currentGroup = providerGroups.find(g => g.provider_id === currentProviderIdValue) || providerGroups[0];
  const MODEL_OPTIONS = currentGroup?.models || DEFAULT_MODEL_OPTIONS;

  // Fetch files for @ mention
  const fetchFiles = useCallback(async (filter: string) => {
    try {
      const params = new URLSearchParams();
      if (sessionId) params.set('session_id', sessionId);
      if (filter) params.set('q', filter);
      const res = await fetch(`/api/files?${params.toString()}`);
      if (!res.ok) return [];
      const data = await res.json();
      const tree = data.tree || [];
      const items: PopoverItem[] = [];
      function flattenTree(nodes: Array<{ name: string; path: string; type: string; children?: unknown[] }>) {
        for (const node of nodes) {
          items.push({ label: node.name, value: node.path });
          if (node.children) flattenTree(node.children as typeof nodes);
        }
      }
      flattenTree(tree);
      return items.slice(0, 20);
    } catch {
      return [];
    }
  }, [sessionId]);

  // Fetch skills for / command (built-in + API)
  // Returns all items unfiltered — filtering is done by filteredItems
  const fetchSkills = useCallback(async () => {
    let apiSkills: PopoverItem[] = [];
    try {
      const cwdParam = workingDirectory ? `?cwd=${encodeURIComponent(workingDirectory)}` : '';
      const res = await fetch(`/api/skills${cwdParam}`);
      if (res.ok) {
        const data = await res.json();
        const skills = data.skills || [];
        apiSkills = skills
          .map((s: { name: string; description: string; source?: "global" | "project" | "plugin" | "installed" | "sdk"; kind?: SkillKind; installedSource?: "agents" | "claude" }) => ({
            label: s.name,
            value: `/${s.name}`,
            description: s.description || "",
            builtIn: false,
            installedSource: s.installedSource,
            source: s.source,
            kind: s.kind || 'slash_command',
          }));
      }
    } catch {
      // API not available - just use built-in commands
    }

    // When SDK init metadata is available, use it as the truth source:
    // 1. Filter out filesystem-scanned items that the SDK session didn't actually load
    // 2. Add any SDK-reported commands/skills missing from the filesystem scan
    // Note: SDK system:init reports slash_commands and skills as string[] (names only)
    if (sdkInitMeta) {
      const rawCmds = sdkInitMeta.slash_commands;
      const rawSkills = sdkInitMeta.skills;
      const sdkCommandNames = new Set(
        Array.isArray(rawCmds) ? rawCmds.map(c => typeof c === 'string' ? c : (c as { name?: string })?.name).filter(Boolean) as string[] : []
      );
      const sdkSkillNames = new Set(
        Array.isArray(rawSkills) ? rawSkills.map(s => typeof s === 'string' ? s : (s as { name?: string })?.name).filter(Boolean) as string[] : []
      );

      // Only filter if SDK actually reported capabilities (non-empty arrays)
      if (sdkCommandNames.size > 0 || sdkSkillNames.size > 0) {
        apiSkills = apiSkills.filter(item => {
          if (item.kind === 'agent_skill') return sdkSkillNames.has(item.label);
          return sdkCommandNames.has(item.label);
        });
      }

      const existingNames = new Set(apiSkills.map(s => s.label));

      // Add SDK-reported commands not found in filesystem scan
      for (const cmdName of sdkCommandNames) {
        if (!existingNames.has(cmdName)) {
          apiSkills.push({
            label: cmdName,
            value: `/${cmdName}`,
            description: `SDK command: /${cmdName}`,
            builtIn: false,
            source: 'sdk',
            kind: 'sdk_command',
          });
        }
      }

      // Add SDK-reported skills not found in filesystem scan
      for (const skillName of sdkSkillNames) {
        if (!existingNames.has(skillName)) {
          apiSkills.push({
            label: skillName,
            value: `/${skillName}`,
            description: `Skill: /${skillName}`,
            builtIn: false,
            kind: 'agent_skill',
          });
        }
      }
    }

    // Deduplicate: remove API skills that share a name with built-in commands
    const builtInNames = new Set(BUILT_IN_COMMANDS.map(c => c.label));
    const uniqueSkills = apiSkills.filter(s => !builtInNames.has(s.label));

    return [...BUILT_IN_COMMANDS, ...uniqueSkills];
  }, [workingDirectory, sdkInitMeta]);

  // Fetch CLI tools for CLI popover
  const fetchCliTools = useCallback(async () => {
    try {
      const [installedRes, catalogRes] = await Promise.all([
        fetch('/api/cli-tools/installed'),
        fetch('/api/cli-tools/catalog'),
      ]);
      const installedData = await installedRes.json();
      const catalogData = await catalogRes.json();

      const catalogTools = catalogData.tools || [];
      const runtimeInfos = installedData.tools || [];
      const extraDetected = installedData.extra || [];

      // Build lookup for catalog summaries
      const catalogMap = new Map<string, { name: string; summaryZh: string; summaryEn: string }>();
      for (const ct of catalogTools) {
        catalogMap.set(ct.id, { name: ct.name, summaryZh: ct.summaryZh, summaryEn: ct.summaryEn });
      }

      // Extra well-known names lookup
      const extraNames: Record<string, string> = {};
      try {
        const { EXTRA_WELL_KNOWN_BINS } = await import('@/lib/cli-tools-catalog');
        for (const [id, name] of EXTRA_WELL_KNOWN_BINS) {
          extraNames[id] = name;
        }
      } catch { /* ignore */ }

      // Load cached AI descriptions
      let autoDesc: Record<string, { zh: string; en: string }> = {};
      try {
        const cached = localStorage.getItem('cli-tools-auto-desc');
        if (cached) autoDesc = JSON.parse(cached);
      } catch { /* ignore */ }

      const locale = document.documentElement.lang === 'zh' ? 'zh' : 'en';
      const items: CliToolItem[] = [];

      // Installed catalog tools
      for (const ri of runtimeInfos) {
        if (ri.status !== 'installed') continue;
        const cat = catalogMap.get(ri.id);
        const ad = autoDesc[ri.id];
        const summary = ad
          ? (locale === 'zh' ? ad.zh : ad.en)
          : cat
            ? (locale === 'zh' ? cat.summaryZh : cat.summaryEn)
            : '';
        items.push({
          id: ri.id,
          name: cat?.name || ri.id,
          version: ri.version,
          summary,
        });
      }

      // Extra detected tools
      for (const ri of extraDetected) {
        const ad = autoDesc[ri.id];
        const summary = ad ? (locale === 'zh' ? ad.zh : ad.en) : '';
        items.push({
          id: ri.id,
          name: extraNames[ri.id] || ri.id,
          version: ri.version,
          summary,
        });
      }

      setCliTools(items);
    } catch {
      setCliTools([]);
    }
  }, []);

  // Close popover
  const closePopover = useCallback(() => {
    setPopoverMode(null);
    setPopoverItems([]);
    setPopoverFilter('');
    setSelectedIndex(0);
    setTriggerPos(null);
    // Clean up AI search state
    setAiSuggestions([]);
    setAiSearchLoading(false);
    if (aiSearchTimerRef.current) {
      clearTimeout(aiSearchTimerRef.current);
      aiSearchTimerRef.current = null;
    }
    if (aiSearchAbortRef.current) {
      aiSearchAbortRef.current.abort();
      aiSearchAbortRef.current = null;
    }
  }, []);

  // Remove active badge
  const removeBadge = useCallback(() => {
    setBadge(null);
    setTimeout(() => textareaRef.current?.focus(), 0);
  }, []);

  // Remove CLI badge
  const removeCliBadge = useCallback(() => {
    setCliBadge(null);
    setTimeout(() => textareaRef.current?.focus(), 0);
  }, []);

  // Handle CLI tool selection from popover
  const handleCliSelect = useCallback((tool: CliToolItem) => {
    closePopover();
    setCliFilter('');

    if (!inputValue.trim()) {
      // Empty input: prefill with prompt template
      const prefix = locale === 'zh'
        ? `我想用 ${tool.name} 工具完成：`
        : `I want to use ${tool.name} to: `;
      setInputValue(prefix);
      setTimeout(() => {
        const ta = textareaRef.current;
        if (ta) {
          ta.focus();
          ta.selectionStart = ta.selectionEnd = prefix.length;
        }
      }, 0);
    } else {
      // Non-empty input: set CLI badge
      setCliBadge({ id: tool.id, name: tool.name });
      setTimeout(() => textareaRef.current?.focus(), 0);
    }
  }, [inputValue, locale, closePopover]);

  // Open CLI popover
  const handleOpenCliPopover = useCallback(async () => {
    if (popoverMode === 'cli') {
      closePopover();
      return;
    }
    closePopover();
    setPopoverMode('cli');
    setCliFilter('');
    setSelectedIndex(0);
    // Focus search input on next render (before fetch completes)
    setTimeout(() => cliSearchRef.current?.focus(), 0);
    fetchCliTools();
  }, [popoverMode, closePopover, fetchCliTools]);

  // Insert selected item
  const insertItem = useCallback((item: PopoverItem) => {
    if (triggerPos === null) return;

    // Immediate built-in commands: execute right away
    if (item.builtIn && item.immediate && onCommand) {
      setInputValue('');
      closePopover();
      onCommand(item.value);
      return;
    }

    // Non-immediate commands (prompt-based built-ins and skills): show as badge
    if (popoverMode === 'skill') {
      setBadge({
        command: item.value,
        label: item.label,
        description: item.description || '',
        kind: item.kind || 'slash_command',
        installedSource: item.installedSource,
      });
      setInputValue('');
      closePopover();
      setTimeout(() => textareaRef.current?.focus(), 0);
      return;
    }

    // File mention: insert into text
    const currentVal = inputValue;
    const before = currentVal.slice(0, triggerPos);
    const cursorEnd = triggerPos + popoverFilter.length + 1;
    const after = currentVal.slice(cursorEnd);
    const insertText = `@${item.value} `;

    setInputValue(before + insertText + after);
    closePopover();

    // Refocus textarea
    setTimeout(() => textareaRef.current?.focus(), 0);
  }, [triggerPos, popoverMode, closePopover, onCommand, inputValue, popoverFilter]);

  // Handle input changes to detect @ and /
  const handleInputChange = useCallback(async (val: string) => {
    setInputValue(val);

    const textarea = textareaRef.current;
    if (!textarea) return;

    const cursorPos = textarea.selectionStart;
    const beforeCursor = val.slice(0, cursorPos);

    // Check for @ trigger
    const atMatch = beforeCursor.match(/@([^\s@]*)$/);
    if (atMatch) {
      const filter = atMatch[1];
      setPopoverMode('file');
      setPopoverFilter(filter);
      setTriggerPos(cursorPos - atMatch[0].length);
      setSelectedIndex(0);
      const items = await fetchFiles(filter);
      setPopoverItems(items);
      return;
    }

    // Check for / trigger (only at start of line or after space)
    const slashMatch = beforeCursor.match(/(^|\s)\/([^\s]*)$/);
    if (slashMatch) {
      const filter = slashMatch[2];
      setPopoverMode('skill');
      setPopoverFilter(filter);
      setTriggerPos(cursorPos - slashMatch[2].length - 1);
      setSelectedIndex(0);
      const items = await fetchSkills();
      setPopoverItems(items);
      return;
    }

    // Only auto-close text-triggered popovers (file/skill); CLI is button-triggered
    if (popoverMode && popoverMode !== 'cli') {
      closePopover();
    }
  }, [fetchFiles, fetchSkills, popoverMode, closePopover]);

  // Insert `/` into textarea to trigger slash command popover
  const handleInsertSlash = useCallback(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    const cursorPos = textarea.selectionStart;
    const before = inputValue.slice(0, cursorPos);
    const after = inputValue.slice(cursorPos);
    const newValue = before + '/' + after;
    const newCursorPos = cursorPos + 1;
    setInputValue(newValue);
    // Set cursor position first so handleInputChange reads correct selectionStart
    textarea.value = newValue;
    textarea.selectionStart = newCursorPos;
    textarea.selectionEnd = newCursorPos;
    textarea.focus();
    handleInputChange(newValue);
  }, [inputValue, handleInputChange]);

  const handleSubmit = useCallback(async (msg: { text: string; files: Array<{ type: string; url: string; filename?: string; mediaType?: string }> }, e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const content = inputValue.trim();

    closePopover();

    // Convert PromptInput FileUIParts (with data URLs) to FileAttachment[]
    const convertFiles = async (): Promise<FileAttachment[]> => {
      if (!msg.files || msg.files.length === 0) return [];

      const attachments: FileAttachment[] = [];
      for (const file of msg.files) {
        if (!file.url) continue;
        try {
          const attachment = await dataUrlToFileAttachment(
            file.url,
            file.filename || 'file',
            file.mediaType || 'application/octet-stream',
          );
          attachments.push(attachment);
        } catch {
          // Skip files that fail conversion
        }
      }
      return attachments;
    };

    // If Image Agent toggle is on and no badge, send via normal LLM with systemPromptAppend
    if (imageGen.state.enabled && !badge && !isStreaming) {
      const files = await convertFiles();
      if (!content && files.length === 0) return;

      // Store uploaded images as pending reference images for ImageGenConfirmation
      const imageFiles = files.filter(f => f.type.startsWith('image/'));
      if (imageFiles.length > 0) {
        setRefImages(PENDING_KEY, imageFiles.map(f => ({ mimeType: f.type, data: f.data })));
      } else {
        deleteRefImages(PENDING_KEY);
      }

      setInputValue('');
      if (onSend) {
        onSend(content, files.length > 0 ? files : undefined, IMAGE_AGENT_SYSTEM_PROMPT);
      }
      return;
    }

    // If badge is active, dispatch by kind
    if (badge && !isStreaming) {
      const files = await convertFiles();
      const displayLabel = `/${badge.label}`;

      switch (badge.kind) {
        case 'agent_skill': {
          // Agent skills: SDK loads SKILL.md natively from filesystem.
          // Always include skill name so Claude knows which skill was selected.
          // User context is appended after the skill reference.
          const agentPrompt = content
            ? `Use the ${badge.label} skill. User context: ${content}`
            : `Please use the ${badge.label} skill.`;
          setBadge(null);
          setInputValue('');
          onSend(agentPrompt, files.length > 0 ? files : undefined, undefined, displayLabel);
          return;
        }

        case 'slash_command':
        case 'sdk_command': {
          // Slash commands & SDK commands: send "/{command} {context}" as-is for SDK to handle
          const slashPrompt = content
            ? `${badge.command} ${content}`
            : badge.command;
          setBadge(null);
          setInputValue('');
          onSend(slashPrompt, files.length > 0 ? files : undefined, undefined, displayLabel);
          return;
        }

        case 'codepilot_command': {
          // CodePilot-specific commands: expand via COMMAND_PROMPTS, show /command in bubble
          const expandedPrompt = COMMAND_PROMPTS[badge.command] || '';
          const finalPrompt = content
            ? `${expandedPrompt}\n\nUser context: ${content}`
            : expandedPrompt || badge.command;
          setBadge(null);
          setInputValue('');
          onSend(finalPrompt, files.length > 0 ? files : undefined, undefined, displayLabel);
          return;
        }
      }
    }

    const files = await convertFiles();
    const hasFiles = files.length > 0;

    if ((!content && !hasFiles) || disabled || isStreaming) return;

    // Check if it's a direct slash command typed in the input
    if (content.startsWith('/') && !hasFiles) {
      const cmd = BUILT_IN_COMMANDS.find(c => c.value === content);
      if (cmd) {
        if (cmd.immediate && onCommand) {
          setInputValue('');
          onCommand(content);
          return;
        }
        // Non-immediate: show as badge for user to add context
        setBadge({
          command: cmd.value,
          label: cmd.label,
          description: cmd.description || '',
          kind: cmd.kind || 'sdk_command',
        });
        setInputValue('');
        return;
      }

      // Not a built-in command — default to slash_command (SDK will handle)
      const skillName = content.slice(1);
      if (skillName) {
        setBadge({
          command: content,
          label: skillName,
          description: '',
          kind: 'slash_command',
        });
        setInputValue('');
        return;
      }
    }

    // If CLI badge is active, inject systemPromptAppend to guide model
    const cliAppend = cliBadge
      ? `The user wants to use the installed CLI tool "${cliBadge.name}" if appropriate for this task. Prefer using "${cliBadge.name}" when suitable.`
      : undefined;
    if (cliBadge) setCliBadge(null);

    onSend(content || 'Please review the attached file(s).', hasFiles ? files : undefined, cliAppend);
    setInputValue('');
  }, [inputValue, onSend, onImageGenerate, onCommand, disabled, isStreaming, closePopover, badge, cliBadge, imageGen]);

  const filteredItems = popoverItems.filter((item) => {
    const q = popoverFilter.toLowerCase();
    return item.label.toLowerCase().includes(q)
      || (item.description || '').toLowerCase().includes(q);
  });

  // Debounced AI semantic search when substring results are insufficient
  const nonBuiltInFilteredCount = filteredItems.filter(i => !i.builtIn).length;
  useEffect(() => {
    // Only trigger for skill mode with enough input and few substring matches
    if (popoverMode !== 'skill' || popoverFilter.length < 2 || nonBuiltInFilteredCount >= 2) {
      setAiSuggestions([]);
      setAiSearchLoading(false);
      if (aiSearchTimerRef.current) {
        clearTimeout(aiSearchTimerRef.current);
        aiSearchTimerRef.current = null;
      }
      if (aiSearchAbortRef.current) {
        aiSearchAbortRef.current.abort();
        aiSearchAbortRef.current = null;
      }
      return;
    }

    // Cancel previous timer and request
    if (aiSearchTimerRef.current) {
      clearTimeout(aiSearchTimerRef.current);
    }
    if (aiSearchAbortRef.current) {
      aiSearchAbortRef.current.abort();
    }

    setAiSearchLoading(true);

    aiSearchTimerRef.current = setTimeout(async () => {
      const abortController = new AbortController();
      aiSearchAbortRef.current = abortController;

      try {
        // Collect non-built-in skills for AI search
        const skillsPayload = popoverItems
          .filter(i => !i.builtIn)
          .map(i => ({ name: i.label, description: (i.description || '').slice(0, 100) }));

        if (skillsPayload.length === 0) {
          setAiSearchLoading(false);
          return;
        }

        const res = await fetch('/api/skills/search', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: abortController.signal,
          body: JSON.stringify({
            query: popoverFilter,
            skills: skillsPayload,
            model: modelName || 'haiku',
          }),
        });

        if (abortController.signal.aborted) return;

        if (!res.ok) {
          setAiSuggestions([]);
          setAiSearchLoading(false);
          return;
        }

        const data = await res.json();
        const suggestions: string[] = data.suggestions || [];

        // Map suggested names back to PopoverItems, deduplicating against substring results
        const filteredNames = new Set(filteredItems.map(i => i.label));
        const aiItems = suggestions
          .filter(name => !filteredNames.has(name))
          .map(name => popoverItems.find(i => i.label === name))
          .filter((item): item is PopoverItem => !!item);

        setAiSuggestions(aiItems);
      } catch {
        // Silently fail — don't show AI suggestions on error
        if (!abortController.signal.aborted) {
          setAiSuggestions([]);
        }
      } finally {
        if (!abortController.signal.aborted) {
          setAiSearchLoading(false);
        }
      }
    }, 500);

    return () => {
      if (aiSearchTimerRef.current) {
        clearTimeout(aiSearchTimerRef.current);
        aiSearchTimerRef.current = null;
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [popoverFilter, popoverMode, nonBuiltInFilteredCount]);

  // Combined list for keyboard navigation
  const allDisplayedItems = [...filteredItems, ...aiSuggestions];

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      // Popover navigation (skill/file mode)
      if (popoverMode && popoverMode !== 'cli' && popoverItems.length > 0) {
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          setSelectedIndex((prev) => (prev + 1) % allDisplayedItems.length);
          return;
        }
        if (e.key === 'ArrowUp') {
          e.preventDefault();
          setSelectedIndex((prev) => (prev - 1 + allDisplayedItems.length) % allDisplayedItems.length);
          return;
        }
        if (e.key === 'Enter' || e.key === 'Tab') {
          e.preventDefault();
          if (allDisplayedItems[selectedIndex]) {
            insertItem(allDisplayedItems[selectedIndex]);
          }
          return;
        }
        if (e.key === 'Escape') {
          e.preventDefault();
          closePopover();
          return;
        }
      }

      // CLI popover keyboard navigation
      if (popoverMode === 'cli') {
        if (e.key === 'Escape') {
          e.preventDefault();
          closePopover();
          return;
        }
        if (cliTools.length > 0) {
          const q = cliFilter.toLowerCase();
          const filtered = cliTools.filter(t =>
            t.name.toLowerCase().includes(q) || t.summary.toLowerCase().includes(q)
          );
          if (filtered.length > 0) {
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setSelectedIndex((prev) => Math.min(prev + 1, filtered.length - 1));
              return;
            }
            if (e.key === 'ArrowUp') {
              e.preventDefault();
              setSelectedIndex((prev) => Math.max(prev - 1, 0));
              return;
            }
            if (e.key === 'Enter') {
              e.preventDefault();
              if (filtered[selectedIndex]) handleCliSelect(filtered[selectedIndex]);
              return;
            }
          }
        }
      }

      // Backspace removes badge when input is empty
      if (e.key === 'Backspace' && !inputValue) {
        if (badge) { e.preventDefault(); removeBadge(); return; }
        if (cliBadge) { e.preventDefault(); removeCliBadge(); return; }
      }

      // Escape removes badge
      if (e.key === 'Escape') {
        if (badge) { e.preventDefault(); removeBadge(); return; }
        if (cliBadge) { e.preventDefault(); removeCliBadge(); return; }
      }
    },
    [popoverMode, popoverItems, popoverFilter, selectedIndex, insertItem, closePopover, badge, cliBadge, inputValue, removeBadge, removeCliBadge, allDisplayedItems, cliTools, cliFilter, handleCliSelect]
  );

  // Click outside to close popover
  useEffect(() => {
    if (!popoverMode) return;
    const handler = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        closePopover();
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [popoverMode, closePopover]);

  const currentModelValue = modelName || 'sonnet';
  const currentModelOption = MODEL_OPTIONS.find((m) => m.value === currentModelValue) || MODEL_OPTIONS[0];

  // Effort selector state — only shown when the current model supports effort
  const currentModelMeta = currentModelOption as typeof currentModelOption & { supportsEffort?: boolean; supportedEffortLevels?: string[] };
  const showEffortSelector = currentModelMeta.supportsEffort === true;
  // Use prop if provided (lifted state), otherwise local state
  const [localEffort, setLocalEffort] = useState<string>('high');
  const selectedEffort = effortProp ?? localEffort;
  const setSelectedEffort = useCallback((v: string) => {
    setLocalEffort(v);
    onEffortChange?.(v);
  }, [onEffortChange]);
  // Map isStreaming to ChatStatus for PromptInputSubmit
  const chatStatus: ChatStatus = isStreaming ? 'streaming' : 'ready';

  return (
    <div className="bg-background/80 backdrop-blur-lg px-4 pt-2 pb-1">
      <div className="mx-auto">
        <div className="relative">
          {/* Popover */}
          {popoverMode && (allDisplayedItems.length > 0 || aiSearchLoading) && (() => {
            const builtInItems = filteredItems.filter(item => item.builtIn);
            const slashCommandItems = filteredItems.filter(item => !item.builtIn && item.kind !== 'agent_skill');
            const agentSkillItems = filteredItems.filter(item => !item.builtIn && item.kind === 'agent_skill');
            let globalIdx = 0;

            const renderItem = (item: PopoverItem, idx: number) => (
              <button
                key={`${idx}-${item.value}`}
                ref={idx === selectedIndex ? (el) => { el?.scrollIntoView({ block: 'nearest' }); } : undefined}
                className={cn(
                  "flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm transition-colors",
                  idx === selectedIndex ? "bg-accent text-accent-foreground" : "hover:bg-accent/50"
                )}
                onClick={() => insertItem(item)}
                onMouseEnter={() => setSelectedIndex(idx)}
              >
                {popoverMode === 'file' ? (
                  <At size={16} className="shrink-0 text-muted-foreground" />
                ) : item.builtIn && item.icon ? (
                  (() => { const ItemIcon = item.icon; return <ItemIcon size={16} className="shrink-0 text-muted-foreground" />; })()
                ) : item.kind === 'agent_skill' ? (
                  <Brain size={16} className="shrink-0 text-muted-foreground" />
                ) : item.kind === 'slash_command' ? (
                  <NotePencil size={16} className="shrink-0 text-muted-foreground" />
                ) : !item.builtIn ? (
                  <GlobeSimple size={16} className="shrink-0 text-muted-foreground" />
                ) : (
                  <Terminal size={16} className="shrink-0 text-muted-foreground" />
                )}
                <span className="font-mono text-xs truncate">{item.label}</span>
                {(item.descriptionKey || item.description) && (
                  <span className="text-xs text-muted-foreground truncate max-w-[200px]">
                    {item.descriptionKey ? t(item.descriptionKey) : item.description}
                  </span>
                )}
                {!item.builtIn && item.installedSource && (
                  <span className="text-xs text-muted-foreground shrink-0 ml-auto">
                    {item.installedSource === 'claude' ? 'Personal' : 'Agents'}
                  </span>
                )}
              </button>
            );

            return (
              <div
                ref={popoverRef}
                className="absolute bottom-full left-0 mb-2 w-full max-w-2xl rounded-xl border bg-popover shadow-lg overflow-hidden z-50"
              >
                {popoverMode === 'skill' ? (
                  <div className="px-3 py-2 border-b">
                    <input
                      ref={searchInputRef}
                      type="text"
                      placeholder="Search..."
                      value={popoverFilter}
                      onChange={(e) => {
                        const val = e.target.value;
                        setPopoverFilter(val);
                        setSelectedIndex(0);
                        // Sync textarea: replace the filter portion after /
                        if (triggerPos !== null) {
                          const before = inputValue.slice(0, triggerPos + 1);
                          setInputValue(before + val);
                        }
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'ArrowDown') {
                          e.preventDefault();
                          setSelectedIndex((prev) => (prev + 1) % allDisplayedItems.length);
                        } else if (e.key === 'ArrowUp') {
                          e.preventDefault();
                          setSelectedIndex((prev) => (prev - 1 + allDisplayedItems.length) % allDisplayedItems.length);
                        } else if (e.key === 'Enter' || e.key === 'Tab') {
                          e.preventDefault();
                          if (allDisplayedItems[selectedIndex]) {
                            insertItem(allDisplayedItems[selectedIndex]);
                          }
                        } else if (e.key === 'Escape') {
                          e.preventDefault();
                          closePopover();
                          textareaRef.current?.focus();
                        }
                      }}
                      className="w-full bg-transparent text-sm text-foreground placeholder:text-muted-foreground outline-none"
                    />
                  </div>
                ) : (
                  <div className="px-3 py-2 text-xs font-medium text-muted-foreground border-b">
                    Files
                  </div>
                )}
                <div className="max-h-48 overflow-y-auto py-1">
                  {popoverMode === 'file' ? (
                    filteredItems.map((item, i) => renderItem(item, i))
                  ) : (
                    <>
                      {builtInItems.length > 0 && (
                        <>
                          <div className="px-3 py-1.5 text-xs font-medium text-muted-foreground">
                            Commands
                          </div>
                          {builtInItems.map((item) => {
                            const idx = globalIdx++;
                            return renderItem(item, idx);
                          })}
                        </>
                      )}
                      {slashCommandItems.length > 0 && (
                        <>
                          <div className="px-3 py-1.5 text-xs font-medium text-muted-foreground">
                            Slash Commands
                          </div>
                          {slashCommandItems.map((item) => {
                            const idx = globalIdx++;
                            return renderItem(item, idx);
                          })}
                        </>
                      )}
                      {agentSkillItems.length > 0 && (
                        <>
                          <div className="px-3 py-1.5 text-xs font-medium text-muted-foreground">
                            Agent Skills
                          </div>
                          {agentSkillItems.map((item) => {
                            const idx = globalIdx++;
                            return renderItem(item, idx);
                          })}
                        </>
                      )}
                      {/* AI Suggested section */}
                      {(aiSuggestions.length > 0 || aiSearchLoading) && (
                        <>
                          <div className="px-3 py-1.5 text-xs font-medium text-muted-foreground flex items-center gap-1.5">
                            <Brain size={14} />
                            {t('messageInput.aiSuggested')}
                            {aiSearchLoading && (
                              <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent" />
                            )}
                          </div>
                          {aiSuggestions.map((item) => {
                            const idx = globalIdx++;
                            return renderItem(item, idx);
                          })}
                        </>
                      )}
                    </>
                  )}
                </div>
                {/* Footer: manage skills (skill mode only) */}
                {popoverMode === 'skill' && (
                  <div className="border-t px-3 py-1.5">
                    <button
                      className="flex w-full items-center gap-2 text-xs text-muted-foreground hover:text-foreground transition-colors py-1"
                      onClick={() => { closePopover(); window.location.href = '/skills'; }}
                    >
                      <Lightning size={14} />
                      {t('composer.manageSkills' as TranslationKey)}
                    </button>
                  </div>
                )}
              </div>
            );
          })()}

          {/* CLI Tools Popover */}
          {popoverMode === 'cli' && (() => {
            const q = cliFilter.toLowerCase();
            const filtered = cliTools.filter(t =>
              t.name.toLowerCase().includes(q) || t.summary.toLowerCase().includes(q)
            );

            return (
              <div
                ref={popoverRef}
                className="absolute bottom-full left-0 mb-2 w-full max-w-2xl rounded-xl border bg-popover shadow-lg overflow-hidden z-50"
              >
                <div className="px-3 py-2 border-b">
                  <input
                    ref={cliSearchRef}
                    type="text"
                    placeholder={t('cliTools.searchPlaceholder' as TranslationKey)}
                    value={cliFilter}
                    onChange={(e) => { setCliFilter(e.target.value); setSelectedIndex(0); }}
                    onKeyDown={(e) => {
                      if (e.key === 'ArrowDown') {
                        e.preventDefault();
                        setSelectedIndex((prev) => Math.min(prev + 1, filtered.length - 1));
                      } else if (e.key === 'ArrowUp') {
                        e.preventDefault();
                        setSelectedIndex((prev) => Math.max(prev - 1, 0));
                      } else if (e.key === 'Enter') {
                        e.preventDefault();
                        if (filtered[selectedIndex]) handleCliSelect(filtered[selectedIndex]);
                      } else if (e.key === 'Escape') {
                        e.preventDefault();
                        closePopover();
                        textareaRef.current?.focus();
                      }
                    }}
                    className="w-full bg-transparent text-sm text-foreground placeholder:text-muted-foreground outline-none"
                  />
                </div>
                <div className="max-h-48 overflow-y-auto py-1">
                  {filtered.length > 0 ? (
                    filtered.map((tool, idx) => (
                      <button
                        key={tool.id}
                        ref={idx === selectedIndex ? (el) => { el?.scrollIntoView({ block: 'nearest' }); } : undefined}
                        className={cn(
                          "flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm transition-colors",
                          idx === selectedIndex ? "bg-accent text-accent-foreground" : "hover:bg-accent/50"
                        )}
                        onClick={() => handleCliSelect(tool)}
                        onMouseEnter={() => setSelectedIndex(idx)}
                      >
                        <Terminal size={16} className="shrink-0 text-muted-foreground" />
                        <span className="font-medium text-xs truncate">{tool.name}</span>
                        {tool.version && (
                          <span className="text-[10px] text-muted-foreground shrink-0">v{tool.version}</span>
                        )}
                        {tool.summary && (
                          <span className="text-xs text-muted-foreground truncate ml-auto max-w-[200px]">{tool.summary}</span>
                        )}
                      </button>
                    ))
                  ) : (
                    <div className="px-3 py-4 text-center">
                      <p className="text-sm text-muted-foreground">{t('cliTools.noToolsDetected' as TranslationKey)}</p>
                      <button
                        className="mt-2 text-xs text-primary hover:underline"
                        onClick={() => { closePopover(); window.location.href = '/cli-tools'; }}
                      >
                        {t('cliTools.goInstall' as TranslationKey)}
                      </button>
                    </div>
                  )}
                </div>
                {/* Footer: manage CLI tools */}
                <div className="border-t px-3 py-1.5">
                  <button
                    className="flex w-full items-center gap-2 text-xs text-muted-foreground hover:text-foreground transition-colors py-1"
                    onClick={() => { closePopover(); window.location.href = '/cli-tools'; }}
                  >
                    <Terminal size={14} />
                    {t('cliTools.manageCli' as TranslationKey)}
                  </button>
                </div>
              </div>
            );
          })()}

          {/* PromptInput replaces the old input area */}
          <PromptInput
            onSubmit={handleSubmit}
            accept=""
            multiple
          >
            {/* Bridge: listens for file tree "+" button events */}
            <FileTreeAttachmentBridge />
            {/* Command badge */}
            {badge && (
              <div className="flex w-full items-center gap-1.5 px-3 pt-2.5 pb-0 order-first">
                <span className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 text-primary pl-2.5 pr-1.5 py-1 text-xs font-medium border border-primary/20">
                  <span className="font-mono">{badge.command}</span>
                  {badge.description && (
                    <span className="text-primary/60 text-[10px]">{badge.description}</span>
                  )}
                  <button
                    type="button"
                    onClick={removeBadge}
                    className="ml-0.5 rounded-full p-0.5 hover:bg-primary/20 transition-colors"
                  >
                    <svg className="h-3 w-3" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M3 3l6 6M9 3l-6 6" />
                    </svg>
                  </button>
                </span>
              </div>
            )}
            {/* CLI badge */}
            {cliBadge && (
              <div className="flex w-full items-center gap-1.5 px-3 pt-2.5 pb-0 order-first">
                <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 pl-2.5 pr-1.5 py-1 text-xs font-medium border border-emerald-500/20">
                  <Terminal size={12} />
                  <span>CLI: {cliBadge.name}</span>
                  <button
                    type="button"
                    onClick={removeCliBadge}
                    className="ml-0.5 rounded-full p-0.5 hover:bg-emerald-500/20 transition-colors"
                  >
                    <svg className="h-3 w-3" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M3 3l6 6M9 3l-6 6" />
                    </svg>
                  </button>
                </span>
              </div>
            )}
            {/* File attachment capsules */}
            <FileAttachmentsCapsules />
            <PromptInputTextarea
              ref={textareaRef}
              placeholder={badge ? "Add details (optional), then press Enter..." : cliBadge ? "Describe what you want to do..." : "Message Claude..."}
              value={inputValue}
              onChange={(e) => handleInputChange(e.currentTarget.value)}
              onKeyDown={handleKeyDown}
              onFocus={handleAssistantFocus}
              disabled={disabled}
              className="min-h-10"
            />
            <PromptInputFooter>
              <PromptInputTools>
                {/* Attach file button */}
                <AttachFileButton />

                {/* Slash command button */}
                <SlashCommandButton onInsertSlash={handleInsertSlash} />

                {/* CLI tools button */}
                <Tooltip>
                  <TooltipTrigger asChild>
                    <PromptInputButton onClick={handleOpenCliPopover}>
                      <Terminal size={16} />
                    </PromptInputButton>
                  </TooltipTrigger>
                  <TooltipContent>
                    {t('cliTools.selectTool' as TranslationKey)}
                  </TooltipContent>
                </Tooltip>

                {/* Model selector */}
                <div className="relative" ref={modelMenuRef}>
                  <PromptInputButton
                    onClick={() => setModelMenuOpen((prev) => !prev)}
                  >
                    <span className="text-xs font-mono">{currentModelOption.label}</span>
                    <CaretDown size={10} className={cn("transition-transform duration-200", modelMenuOpen && "rotate-180")} />
                  </PromptInputButton>

                  {modelMenuOpen && (() => {
                    const mq = modelSearch.toLowerCase();
                    const filteredGroups = providerGroups.map(group => ({
                      ...group,
                      models: group.models.filter(opt =>
                        !mq || opt.label.toLowerCase().includes(mq) || group.provider_name.toLowerCase().includes(mq)
                      ),
                    })).filter(group => group.models.length > 0);

                    return (
                      <div className="absolute bottom-full left-0 mb-1.5 w-64 rounded-xl border bg-popover shadow-lg overflow-hidden z-50">
                        {/* Search */}
                        <div className="px-3 py-2 border-b">
                          <input
                            type="text"
                            placeholder={t('composer.searchModels' as TranslationKey)}
                            value={modelSearch}
                            onChange={(e) => setModelSearch(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Escape') {
                                e.preventDefault();
                                setModelMenuOpen(false);
                                setModelSearch('');
                              }
                            }}
                            className="w-full bg-transparent text-sm text-foreground placeholder:text-muted-foreground outline-none"
                          />
                        </div>
                        {/* Model list */}
                        <div className="max-h-64 overflow-y-auto py-1">
                          {filteredGroups.map((group, groupIdx) => (
                            <div key={group.provider_id}>
                              <div className={cn(
                                "px-3 py-1.5 text-[10px] font-medium text-muted-foreground",
                                groupIdx > 0 && "border-t"
                              )}>
                                {group.provider_name}
                              </div>
                              <div className="py-0.5">
                                {group.models.map((opt) => {
                                  const isActive = opt.value === currentModelValue && group.provider_id === currentProviderIdValue;
                                  return (
                                    <button
                                      key={`${group.provider_id}-${opt.value}`}
                                      className={cn(
                                        "flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left text-sm transition-colors",
                                        isActive ? "bg-accent text-accent-foreground" : "hover:bg-accent/50"
                                      )}
                                      onClick={() => {
                                        onModelChange?.(opt.value);
                                        onProviderModelChange?.(group.provider_id, opt.value);
                                        localStorage.setItem('codepilot:last-model', opt.value);
                                        localStorage.setItem('codepilot:last-provider-id', group.provider_id);
                                        setModelMenuOpen(false);
                                        setModelSearch('');
                                      }}
                                    >
                                      <span className="font-mono text-xs">{opt.label}</span>
                                      {isActive && <span className="text-xs">✓</span>}
                                    </button>
                                  );
                                })}
                              </div>
                            </div>
                          ))}
                          {filteredGroups.length === 0 && (
                            <div className="px-3 py-3 text-center text-xs text-muted-foreground">
                              No models found
                            </div>
                          )}
                        </div>
                        {/* Footer: manage providers */}
                        <div className="border-t px-3 py-1.5">
                          <button
                            className="flex w-full items-center gap-2 text-xs text-muted-foreground hover:text-foreground transition-colors py-1"
                            onClick={() => { setModelMenuOpen(false); setModelSearch(''); window.location.href = '/settings'; }}
                          >
                            <Gear size={14} />
                            {t('composer.manageProviders' as TranslationKey)}
                          </button>
                        </div>
                      </div>
                    );
                  })()}
                </div>

                {/* Effort selector — only visible when model supports effort */}
                {showEffortSelector && (
                  <div className="relative" ref={effortMenuRef}>
                    <PromptInputButton
                      onClick={() => setEffortMenuOpen((prev) => !prev)}
                    >
                      <span className="text-xs">{t(`messageInput.effort.${selectedEffort}` as TranslationKey)}</span>
                      <CaretDown size={10} className={cn("transition-transform duration-200", effortMenuOpen && "rotate-180")} />
                    </PromptInputButton>

                    {effortMenuOpen && (
                      <div className="absolute bottom-full left-0 mb-1.5 w-36 rounded-lg border bg-popover shadow-lg overflow-hidden z-50">
                        <div className="px-3 py-1.5 text-[10px] font-medium text-muted-foreground">
                          {t('messageInput.effort.label' as TranslationKey)}
                        </div>
                        <div className="py-0.5">
                          {(currentModelMeta.supportedEffortLevels || ['low', 'medium', 'high', 'max']).map((level) => (
                            <button
                              key={level}
                              className={cn(
                                "flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left text-sm transition-colors",
                                selectedEffort === level ? "bg-accent text-accent-foreground" : "hover:bg-accent/50"
                              )}
                              onClick={() => {
                                setSelectedEffort(level);
                                setEffortMenuOpen(false);
                              }}
                            >
                              <span className="text-xs">{t(`messageInput.effort.${level}` as TranslationKey)}</span>
                              {selectedEffort === level && <span className="text-xs">✓</span>}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}

              </PromptInputTools>

              <FileAwareSubmitButton
                status={chatStatus}
                onStop={onStop}
                disabled={disabled}
                inputValue={inputValue}
                hasBadge={!!badge || !!cliBadge}
              />
            </PromptInputFooter>
          </PromptInput>
        </div>
      </div>

    </div>
  );
}
