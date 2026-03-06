import fs from 'fs';
import path from 'path';
import type { AssistantWorkspaceState, AssistantWorkspaceFiles } from '@/types';

const DEFAULT_STATE: AssistantWorkspaceState = {
  onboardingComplete: false,
  lastCheckInDate: null,
  schemaVersion: 1,
};

const STATE_DIR = '.assistant';
const STATE_FILE = 'state.json';

// Canonical filenames — lowercase preferred, uppercase fallback
const FILE_MAP: Record<keyof AssistantWorkspaceFiles, string[]> = {
  claude: ['claude.md', 'Claude.md', 'CLAUDE.md', 'AGENTS.md'],
  soul: ['soul.md', 'Soul.md', 'SOUL.md'],
  user: ['user.md', 'User.md', 'USER.md', 'PROFILE.md'],
  memory: ['memory.md', 'Memory.md', 'MEMORY.md'],
};

// Templates for initialization
const FILE_TEMPLATES: Record<keyof AssistantWorkspaceFiles, string> = {
  claude: '# Rules\n\n<!-- Assistant execution rules go here -->\n',
  soul: '# Soul\n\n<!-- Assistant personality and style go here -->\n',
  user: '# User Profile\n\n<!-- User preferences and information go here -->\n',
  memory: '# Memory\n\n<!-- Long-term facts and notes go here -->\n',
};

const PER_FILE_LIMIT = 8000;
const HEAD_SIZE = 6000;
const TAIL_SIZE = 1800;
const TOTAL_PROMPT_LIMIT = 40000;

function resolveFile(dir: string, key: keyof AssistantWorkspaceFiles): { filePath: string; exists: boolean } {
  for (const variant of FILE_MAP[key]) {
    const filePath = path.join(dir, variant);
    if (fs.existsSync(filePath)) {
      return { filePath, exists: true };
    }
  }
  // Return canonical (first/lowercase) path when none exist
  return { filePath: path.join(dir, FILE_MAP[key][0]), exists: false };
}

export function validateWorkspace(dir: string): {
  exists: boolean;
  files: Record<keyof AssistantWorkspaceFiles, { exists: boolean; path: string | null; size: number }>;
} {
  const dirExists = fs.existsSync(dir);
  const keys = Object.keys(FILE_MAP) as Array<keyof AssistantWorkspaceFiles>;
  const files = {} as Record<keyof AssistantWorkspaceFiles, { exists: boolean; path: string | null; size: number }>;

  for (const key of keys) {
    if (!dirExists) {
      files[key] = { exists: false, path: null, size: 0 };
      continue;
    }
    const resolved = resolveFile(dir, key);
    if (resolved.exists) {
      const stat = fs.statSync(resolved.filePath);
      files[key] = { exists: true, path: resolved.filePath, size: stat.size };
    } else {
      files[key] = { exists: false, path: null, size: 0 };
    }
  }

  return { exists: dirExists, files };
}

export function initializeWorkspace(dir: string): string[] {
  const stateDir = path.join(dir, STATE_DIR);
  if (!fs.existsSync(stateDir)) {
    fs.mkdirSync(stateDir, { recursive: true });
  }

  const created: string[] = [];
  const keys = Object.keys(FILE_MAP) as Array<keyof AssistantWorkspaceFiles>;

  for (const key of keys) {
    const resolved = resolveFile(dir, key);
    if (!resolved.exists) {
      const canonicalPath = path.join(dir, FILE_MAP[key][0]);
      fs.writeFileSync(canonicalPath, FILE_TEMPLATES[key], 'utf-8');
      created.push(canonicalPath);
    }
  }

  const statePath = path.join(stateDir, STATE_FILE);
  if (!fs.existsSync(statePath)) {
    saveState(dir, { ...DEFAULT_STATE });
  }

  return created;
}

export function truncateContent(content: string, limit: number): string {
  if (content.length <= limit) return content;
  return content.slice(0, HEAD_SIZE) + '\n\n[...truncated...]\n\n' + content.slice(-TAIL_SIZE);
}

export function loadWorkspaceFiles(dir: string): AssistantWorkspaceFiles {
  const result: AssistantWorkspaceFiles = {};
  const keys = Object.keys(FILE_MAP) as Array<keyof AssistantWorkspaceFiles>;

  for (const key of keys) {
    const resolved = resolveFile(dir, key);
    if (resolved.exists) {
      const content = fs.readFileSync(resolved.filePath, 'utf-8');
      result[key] = truncateContent(content, PER_FILE_LIMIT);
    }
  }

  return result;
}

export function assembleWorkspacePrompt(files: AssistantWorkspaceFiles): string {
  const order: Array<keyof AssistantWorkspaceFiles> = ['claude', 'soul', 'user', 'memory'];
  const sections: string[] = [];

  for (const key of order) {
    const content = files[key];
    if (content) {
      sections.push(`<${key}>\n${content}\n</${key}>`);
    }
  }

  if (sections.length === 0) return '';

  let prompt = `<assistant-workspace>\n${sections.join('\n\n')}\n</assistant-workspace>`;

  if (prompt.length > TOTAL_PROMPT_LIMIT) {
    prompt = prompt.slice(0, TOTAL_PROMPT_LIMIT);
  }

  return prompt;
}

export function loadState(dir: string): AssistantWorkspaceState {
  try {
    const statePath = path.join(dir, STATE_DIR, STATE_FILE);
    const raw = fs.readFileSync(statePath, 'utf-8');
    return JSON.parse(raw) as AssistantWorkspaceState;
  } catch {
    return { ...DEFAULT_STATE };
  }
}

export function saveState(dir: string, state: AssistantWorkspaceState): void {
  const stateDir = path.join(dir, STATE_DIR);
  if (!fs.existsSync(stateDir)) {
    fs.mkdirSync(stateDir, { recursive: true });
  }
  const statePath = path.join(stateDir, STATE_FILE);
  fs.writeFileSync(statePath, JSON.stringify(state, null, 2), 'utf-8');
}

export function needsDailyCheckIn(state: AssistantWorkspaceState): boolean {
  if (!state.onboardingComplete) return false;
  return state.lastCheckInDate !== new Date().toISOString().slice(0, 10);
}

export function generateDirectoryDocs(dir: string): string[] {
  const generated: string[] = [];

  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return generated;
  }

  const subdirs = entries.filter(e => e.isDirectory() && !e.name.startsWith('.'));

  for (const subdir of subdirs) {
    const subdirPath = path.join(dir, subdir.name);
    let subEntries: fs.Dirent[];
    try {
      subEntries = fs.readdirSync(subdirPath, { withFileTypes: true });
    } catch {
      continue;
    }

    const fileList = subEntries
      .map(e => `- ${e.name}${e.isDirectory() ? '/' : ''}`)
      .sort()
      .join('\n');

    const startMarker = '<!-- AI_GENERATED_START -->';
    const endMarker = '<!-- AI_GENERATED_END -->';
    const generatedBlock = `${startMarker}\n# ${subdir.name}\n\n${fileList}\n${endMarker}`;

    const readmePath = path.join(subdirPath, 'README.ai.md');

    if (fs.existsSync(readmePath)) {
      const existing = fs.readFileSync(readmePath, 'utf-8');
      const startIdx = existing.indexOf(startMarker);
      const endIdx = existing.indexOf(endMarker);

      if (startIdx !== -1 && endIdx !== -1) {
        const updated = existing.slice(0, startIdx) + generatedBlock + existing.slice(endIdx + endMarker.length);
        fs.writeFileSync(readmePath, updated, 'utf-8');
      } else {
        fs.writeFileSync(readmePath, generatedBlock + '\n', 'utf-8');
      }
    } else {
      fs.writeFileSync(readmePath, generatedBlock + '\n', 'utf-8');
    }

    generated.push(readmePath);

    // Generate PATH.ai.md containing full path index
    const pathContent = `${startMarker}\n# ${subdir.name} — Path Index\n\nBase: \`${subdirPath}\`\n\n${subEntries.map(e => `- \`${path.join(subdirPath, e.name)}${e.isDirectory() ? '/' : ''}\``).sort().join('\n')}\n${endMarker}`;
    const pathFilePath = path.join(subdirPath, 'PATH.ai.md');

    if (fs.existsSync(pathFilePath)) {
      const existing = fs.readFileSync(pathFilePath, 'utf-8');
      const startIdx = existing.indexOf(startMarker);
      const endIdx = existing.indexOf(endMarker);
      if (startIdx !== -1 && endIdx !== -1) {
        const updated = existing.slice(0, startIdx) + pathContent + existing.slice(endIdx + endMarker.length);
        fs.writeFileSync(pathFilePath, updated, 'utf-8');
      } else {
        fs.writeFileSync(pathFilePath, pathContent + '\n', 'utf-8');
      }
    } else {
      fs.writeFileSync(pathFilePath, pathContent + '\n', 'utf-8');
    }
    generated.push(pathFilePath);
  }

  return generated;
}
