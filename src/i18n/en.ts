/**
 * English translations — source of truth.
 * Every key defined here becomes part of the `TranslationKey` type.
 * Other locale files must implement `Record<TranslationKey, string>`.
 */
const en = {
  // ── Navigation ──────────────────────────────────────────────
  'nav.chats': 'Chats',
  'nav.extensions': 'Extensions',
  'nav.settings': 'Settings',
  'nav.autoApproveOn': 'Auto-approve is ON',
  'nav.lightMode': 'Light mode',
  'nav.darkMode': 'Dark mode',
  'nav.toggleTheme': 'Toggle theme',

  // ── Chat list panel ─────────────────────────────────────────
  'chatList.justNow': 'just now',
  'chatList.minutesAgo': '{n}m',
  'chatList.hoursAgo': '{n}h',
  'chatList.daysAgo': '{n}d',
  'chatList.newConversation': 'New Conversation',
  'chatList.delete': 'Delete',
  'chatList.searchSessions': 'Search sessions...',
  'chatList.noSessions': 'No sessions yet',
  'chatList.importFromCli': 'Import from Claude CLI',
  'chatList.addProjectFolder': 'Add project folder',

  // ── Message list ────────────────────────────────────────────
  'messageList.claudeChat': 'Claude Chat',
  'messageList.emptyDescription': 'Start a conversation with Claude. Ask questions, get help with code, or explore ideas.',
  'messageList.loadEarlier': 'Load earlier messages',
  'messageList.loading': 'Loading...',

  // ── Message input ───────────────────────────────────────────
  'messageInput.attachFiles': 'Attach files',
  'messageInput.helpDesc': 'Show available commands and tips',
  'messageInput.clearDesc': 'Clear conversation history',
  'messageInput.costDesc': 'Show token usage statistics',
  'messageInput.compactDesc': 'Compress conversation context',
  'messageInput.doctorDesc': 'Diagnose project health',
  'messageInput.initDesc': 'Initialize CLAUDE.md for project',
  'messageInput.reviewDesc': 'Review code quality',
  'messageInput.terminalSetupDesc': 'Configure terminal settings',
  'messageInput.memoryDesc': 'Edit project memory file',
  'messageInput.modeCode': 'Code',
  'messageInput.modePlan': 'Plan',
  'messageInput.aiSuggested': 'AI Suggested',

  // ── Streaming message ───────────────────────────────────────
  'streaming.thinking': 'Thinking...',
  'streaming.allowForSession': 'Allow for Session',
  'streaming.allowed': 'Allowed',
  'streaming.denied': 'Denied',

  // ── Chat view / session page ────────────────────────────────
  'chat.newConversation': 'New Conversation',

  // ── Settings: General ───────────────────────────────────────
  'settings.title': 'Settings',
  'settings.description': 'Manage CodePilot and Claude CLI settings',
  'settings.general': 'General',
  'settings.providers': 'Providers',
  'settings.claudeCli': 'Claude CLI',
  'settings.codepilot': 'CodePilot',
  'settings.version': 'Version {version}',
  'settings.checkForUpdates': 'Check for Updates',
  'settings.checking': 'Checking...',
  'settings.updateAvailable': 'Update available: v{version}',
  'settings.viewRelease': 'View Release',
  'settings.latestVersion': "You're on the latest version.",
  'settings.autoApproveTitle': 'Auto-approve All Actions',
  'settings.autoApproveDesc': 'Skip all permission checks and auto-approve every tool action. This is dangerous and should only be used for trusted tasks.',
  'settings.autoApproveWarning': 'All tool actions will be auto-approved without confirmation. Use with caution.',
  'settings.autoApproveDialogTitle': 'Enable Auto-approve All Actions?',
  'settings.autoApproveDialogDesc': 'This will bypass all permission checks. Claude will be able to execute any tool action without asking for your confirmation, including:',
  'settings.autoApproveShellCommands': 'Running arbitrary shell commands',
  'settings.autoApproveFileOps': 'Reading, writing, and deleting files',
  'settings.autoApproveNetwork': 'Making network requests',
  'settings.autoApproveTrustWarning': 'Only enable this if you fully trust the task at hand. This setting applies to all new chat sessions.',
  'settings.cancel': 'Cancel',
  'settings.enableAutoApprove': 'Enable Auto-approve',
  'settings.language': 'Language',
  'settings.languageDesc': 'Choose the display language for the interface',
  'settings.usage': 'Usage',

  // ── Settings: Usage Stats ───────────────────────────────────
  'usage.totalTokens': 'Total Tokens',
  'usage.totalCost': 'Total Cost',
  'usage.sessions': 'Sessions',
  'usage.cacheHitRate': 'Cache Hit Rate',
  'usage.input': 'In',
  'usage.output': 'Out',
  'usage.cached': 'cached',
  'usage.dailyChart': 'Daily Token Usage',
  'usage.loading': 'Loading...',
  'usage.loadError': 'Failed to load usage stats',
  'usage.noData': 'No usage data yet',
  'usage.noDataHint': 'Start a conversation to see statistics here.',

  // ── Settings: CLI ───────────────────────────────────────────
  'cli.permissions': 'Permissions',
  'cli.permissionsDesc': 'Configure permission settings for Claude CLI',
  'cli.envVars': 'Environment Variables',
  'cli.envVarsDesc': 'Environment variables passed to Claude',
  'cli.form': 'Form',
  'cli.json': 'JSON',
  'cli.save': 'Save',
  'cli.format': 'Format',
  'cli.reset': 'Reset',
  'cli.settingsSaved': 'Settings saved successfully',
  'cli.confirmSaveTitle': 'Confirm Save',
  'cli.confirmSaveDesc': 'This will overwrite your current ~/.claude/settings.json file. Are you sure you want to continue?',

  // ── Settings: Providers ─────────────────────────────────────
  'provider.addProvider': 'Add Provider',
  'provider.editProvider': 'Edit Provider',
  'provider.deleteProvider': 'Delete Provider',
  'provider.deleteConfirm': 'Are you sure you want to delete "{name}"? This action cannot be undone.',
  'provider.deleting': 'Deleting...',
  'provider.delete': 'Delete',
  'provider.noProviders': 'No providers configured',
  'provider.addToStart': 'Add a provider to get started',
  'provider.quickPresets': 'Quick Presets',
  'provider.customProviders': 'Custom Providers',
  'provider.active': 'Active',
  'provider.configured': 'Configured',
  'provider.name': 'Name',
  'provider.providerType': 'Provider Type',
  'provider.apiKey': 'API Key',
  'provider.baseUrl': 'Base URL',
  'provider.advancedOptions': 'Advanced Options',
  'provider.extraEnvVars': 'Extra Environment Variables',
  'provider.notes': 'Notes',
  'provider.notesPlaceholder': 'Optional notes about this provider...',
  'provider.saving': 'Saving...',
  'provider.update': 'Update',
  'provider.envDetected': 'Detected from environment',
  'provider.default': 'Default',
  'provider.setDefault': 'Set as Default',
  'provider.environment': 'Environment',

  // ── Right panel / Files ─────────────────────────────────────
  'panel.files': 'Files',
  'panel.openPanel': 'Open panel',
  'panel.closePanel': 'Close panel',

  // ── File tree ───────────────────────────────────────────────
  'fileTree.filterFiles': 'Filter files...',
  'fileTree.refresh': 'Refresh',
  'fileTree.noFiles': 'No files found',
  'fileTree.selectFolder': 'Select a project folder to view files',

  // ── File preview ────────────────────────────────────────────
  'filePreview.backToTree': 'Back to file tree',
  'filePreview.lines': '{count} lines',
  'filePreview.copyPath': 'Copy path',
  'filePreview.failedToLoad': 'Failed to load file',

  // ── Doc preview ─────────────────────────────────────────────
  'docPreview.htmlPreview': 'HTML Preview',

  // ── Extensions page ─────────────────────────────────────────
  'extensions.title': 'Extensions',
  'extensions.skills': 'Skills',
  'extensions.mcpServers': 'MCP Servers',

  // ── Skills ──────────────────────────────────────────────────
  'skills.noSelected': 'No skill selected',
  'skills.selectOrCreate': 'Select a skill from the list or create a new one',
  'skills.newSkill': 'New Skill',
  'skills.loadingSkills': 'Loading skills...',
  'skills.noSkillsFound': 'No skills found',
  'skills.searchSkills': 'Search skills...',
  'skills.createSkill': 'Create Skill',
  'skills.nameRequired': 'Name is required',
  'skills.nameInvalid': 'Name can only contain letters, numbers, hyphens, and underscores',
  'skills.skillName': 'Skill Name',
  'skills.scope': 'Scope',
  'skills.global': 'Global',
  'skills.project': 'Project',
  'skills.template': 'Template',
  'skills.blank': 'Blank',
  'skills.commitHelper': 'Commit Helper',
  'skills.codeReviewer': 'Code Reviewer',
  'skills.saved': 'Saved',
  'skills.save': 'Save',
  'skills.edit': 'Edit',
  'skills.preview': 'Preview',
  'skills.splitView': 'Split view',
  'skills.deleteConfirm': 'Click again to confirm',
  'skills.placeholder': 'Write your skill prompt in Markdown...',

  // ── MCP ─────────────────────────────────────────────────────
  'mcp.addServer': 'Add Server',
  'mcp.loadingServers': 'Loading MCP servers...',
  'mcp.serverConfig': 'MCP Server Configuration',
  'mcp.noServers': 'No MCP servers configured',
  'mcp.noServersDesc': "Add an MCP server to extend Claude's capabilities",
  'mcp.arguments': 'Arguments:',
  'mcp.environment': 'Environment:',
  'mcp.listTab': 'List',
  'mcp.jsonTab': 'JSON Config',
  'mcp.editServer': 'Edit Server',
  'mcp.serverName': 'Server Name',
  'mcp.serverType': 'Server Type',
  'mcp.command': 'Command',
  'mcp.argsLabel': 'Arguments (one per line)',
  'mcp.url': 'URL',
  'mcp.headers': 'Headers (JSON)',
  'mcp.envVars': 'Environment Variables (JSON)',
  'mcp.formTab': 'Form',
  'mcp.jsonEditTab': 'JSON',
  'mcp.saveChanges': 'Save Changes',

  // ── Folder picker ───────────────────────────────────────────
  'folderPicker.title': 'Select a project folder',
  'folderPicker.loading': 'Loading...',
  'folderPicker.noSubdirs': 'No subdirectories',
  'folderPicker.cancel': 'Cancel',
  'folderPicker.select': 'Select This Folder',

  // ── Import session dialog ───────────────────────────────────
  'import.title': 'Import Session from Claude CLI',
  'import.searchSessions': 'Search sessions...',
  'import.noSessions': 'No sessions found',
  'import.import': 'Import',
  'import.importing': 'Importing...',
  'import.justNow': 'just now',
  'import.minutesAgo': '{n}m ago',
  'import.hoursAgo': '{n}h ago',
  'import.daysAgo': '{n}d ago',
  'import.messages': '{n} msg',
  'import.messagesPlural': '{n} msgs',

  // ── Connection status ───────────────────────────────────────
  'connection.notInstalled': 'Claude Code is not installed',
  'connection.installed': 'Claude Code is installed',
  'connection.version': 'Version: {version}',
  'connection.installPrompt': 'To use Claude Code features, you need to install the Claude Code CLI.',
  'connection.runCommand': 'Run the following command in your terminal:',
  'connection.installAuto': 'Install Claude Code Automatically',
  'connection.refresh': 'Refresh',
  'connection.installClaude': 'Install Claude Code',

  // ── Install wizard ──────────────────────────────────────────
  'install.title': 'Install Claude Code',
  'install.checkingPrereqs': 'Checking prerequisites...',
  'install.alreadyInstalled': 'Claude Code is already installed',
  'install.readyToInstall': 'Ready to install',
  'install.installing': 'Installing Claude Code...',
  'install.complete': 'Installation complete',
  'install.failed': 'Installation failed',
  'install.copyLogs': 'Copy Logs',
  'install.copied': 'Copied',
  'install.install': 'Install',
  'install.cancel': 'Cancel',
  'install.retry': 'Retry',
  'install.done': 'Done',

  // ── Task list ───────────────────────────────────────────────
  'tasks.all': 'All',
  'tasks.active': 'Active',
  'tasks.done': 'Done',
  'tasks.addPlaceholder': 'Add a task...',
  'tasks.addTask': 'Add task',
  'tasks.loading': 'Loading tasks...',
  'tasks.noTasks': 'No tasks yet',
  'tasks.noMatching': 'No matching tasks',

  // ── Tool call block ─────────────────────────────────────────
  'tool.running': 'running',
  'tool.success': 'success',
  'tool.error': 'error',

  // ── Common ──────────────────────────────────────────────────
  'common.cancel': 'Cancel',
  'common.save': 'Save',
  'common.delete': 'Delete',
  'common.loading': 'Loading...',
  'common.close': 'Close',
  'common.enabled': 'Enabled',
  'common.disabled': 'Disabled',

  // ── CLI dynamic field labels ──────────────────────────────
  'cli.loadingSettings': 'Loading settings...',
  'cli.field.skipDangerousModePermissionPrompt': 'Skip Dangerous Mode Permission Prompt',
  'cli.field.verbose': 'Verbose',
  'cli.field.theme': 'Theme',
  'cli.formatError': 'Cannot format: invalid JSON',
} as const;

export type TranslationKey = keyof typeof en;
export default en;
