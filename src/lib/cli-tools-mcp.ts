/**
 * codepilot-cli-tools MCP — in-process MCP server for CLI tool management.
 *
 * Provides 4 tools:
 * - codepilot_cli_tools_list: List all CLI tools with status/version/description
 * - codepilot_cli_tools_install: Execute install command + register + detect
 * - codepilot_cli_tools_add: Register an already-installed tool by path
 * - codepilot_cli_tools_remove: Remove a custom tool
 *
 * Keyword-gated: registered when conversation involves CLI tool management.
 */

import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import { execFile, exec } from 'child_process';
import { promisify } from 'util';
import { access, constants } from 'fs/promises';
import path from 'path';
import {
  getAllCustomCliTools,
  createCustomCliTool,
  deleteCustomCliTool,
  getCustomCliTool,
  upsertCliToolDescription,
  getAllCliToolDescriptions,
} from '@/lib/db';
import { detectAllCliTools, invalidateDetectCache } from '@/lib/cli-tools-detect';
import { CLI_TOOLS_CATALOG, EXTRA_WELL_KNOWN_BINS } from '@/lib/cli-tools-catalog';
import { getExpandedPath } from '@/lib/platform';

const execFileAsync = promisify(execFile);
const execAsync = promisify(exec);

// ── System prompt hint (kept minimal — one line) ─────────────────────

export const CLI_TOOLS_MCP_SYSTEM_PROMPT = `<cli-tools-capability>
You have CLI tool management capabilities via MCP tools: codepilot_cli_tools_list (query installed tools), codepilot_cli_tools_install (install new tools via shell command), codepilot_cli_tools_add (register an already-installed tool by path and save its description), codepilot_cli_tools_remove (remove a custom tool). After installing a tool, generate a bilingual description (zh/en) and call codepilot_cli_tools_add to save it.
</cli-tools-capability>`;

// ── MCP server factory ───────────────────────────────────────────────

export function createCliToolsMcpServer() {
  return createSdkMcpServer({
    name: 'codepilot-cli-tools',
    version: '1.0.0',
    tools: [
      // ── LIST ─────────────────────────────────────────────────────
      tool(
        'codepilot_cli_tools_list',
        'List all CLI tools available on this system. Returns catalog tools (curated), extra system-detected tools, and custom user-added tools, each with installation status, version, path, and description.',
        {},
        async () => {
          try {
            const { catalog, extra } = await detectAllCliTools();
            const customTools = getAllCustomCliTools();
            const descriptions = getAllCliToolDescriptions();

            const lines: string[] = [];

            // Catalog tools
            lines.push('## Catalog Tools (Curated)');
            for (const rt of catalog) {
              const def = CLI_TOOLS_CATALOG.find(c => c.id === rt.id);
              if (!def) continue;
              const status = rt.status === 'installed' ? '✓' : '✗';
              const ver = rt.version ? ` v${rt.version}` : '';
              const desc = descriptions[rt.id]
                ? `${descriptions[rt.id].en}`
                : def.summaryEn;
              lines.push(`${status} ${def.name}${ver}: ${desc}`);
            }

            // Extra detected
            if (extra.length > 0) {
              lines.push('');
              lines.push('## System Detected Tools');
              for (const rt of extra) {
                const entry = EXTRA_WELL_KNOWN_BINS.find(([eid]) => eid === rt.id);
                const name = entry?.[1] ?? rt.id;
                const ver = rt.version ? ` v${rt.version}` : '';
                const desc = descriptions[rt.id] ? `: ${descriptions[rt.id].en}` : '';
                lines.push(`✓ ${name}${ver}${desc}`);
              }
            }

            // Custom tools
            if (customTools.length > 0) {
              lines.push('');
              lines.push('## Custom Tools (User Added)');
              for (const ct of customTools) {
                const ver = ct.version ? ` v${ct.version}` : '';
                const desc = descriptions[ct.id]
                  ? `: ${descriptions[ct.id].en}`
                  : ` (${ct.binPath})`;
                lines.push(`✓ ${ct.name}${ver}${desc}`);
              }
            }

            return {
              content: [{ type: 'text' as const, text: lines.join('\n') }],
            };
          } catch (error) {
            return {
              content: [{
                type: 'text' as const,
                text: `Failed to list CLI tools: ${error instanceof Error ? error.message : 'Unknown error'}`,
              }],
              isError: true,
            };
          }
        },
      ),

      // ── INSTALL ──────────────────────────────────────────────────
      tool(
        'codepilot_cli_tools_install',
        'Install a CLI tool by executing a shell command (e.g. "brew install ffmpeg", "pip install yt-dlp"). After the command succeeds, the tool is automatically detected and registered. This tool requires user permission before execution. After calling this tool, generate a bilingual description and call codepilot_cli_tools_add to save it.',
        {
          command: z.string().describe('The install command to execute, e.g. "brew install ffmpeg"'),
          name: z.string().optional().describe('Display name for the tool. If omitted, extracted from the command.'),
        },
        async ({ command, name }) => {
          try {
            // Execute install command with expanded PATH
            const expandedPath = getExpandedPath();
            const { stdout, stderr } = await execAsync(command, {
              timeout: 300_000, // 5 minutes for installation
              env: { ...process.env, PATH: expandedPath },
            });

            const output = (stdout + '\n' + stderr).trim();

            // Try to extract binary name from command
            // Handles: brew install xxx, pip install xxx, npm install -g xxx, cargo install xxx
            const parts = command.trim().split(/\s+/);
            let binName: string | null = null;
            const installIdx = parts.findIndex(p => p === 'install');
            if (installIdx >= 0) {
              // Skip flags (words starting with -)
              for (let i = installIdx + 1; i < parts.length; i++) {
                if (!parts[i].startsWith('-')) {
                  binName = parts[i].replace(/@.*$/, ''); // strip version suffix
                  break;
                }
              }
            }

            if (!binName) {
              return {
                content: [{
                  type: 'text' as const,
                  text: `Command executed successfully but could not determine the binary name.\nOutput:\n${output.slice(0, 1000)}\n\nPlease use codepilot_cli_tools_add with the binary path to register it manually.`,
                }],
              };
            }

            // Invalidate cache and detect the new binary
            invalidateDetectCache();

            // Find the binary using which
            let binPath: string | null = null;
            let version: string | null = null;
            try {
              const { stdout: whichOut } = await execFileAsync('/usr/bin/which', [binName], {
                timeout: 5000,
                env: { ...process.env, PATH: expandedPath },
              });
              binPath = whichOut.trim().split(/\r?\n/)[0]?.trim() || null;
            } catch {
              // Binary not found in PATH — might need a different name
            }

            if (binPath) {
              // Get version
              try {
                const { stdout: vOut, stderr: vErr } = await execFileAsync(binPath, ['--version'], {
                  timeout: 5000,
                  env: { ...process.env, PATH: expandedPath },
                });
                const vText = (vOut || vErr).trim();
                const match = vText.split('\n')[0]?.match(/(\d+\.\d+[\w.-]*)/);
                version = match ? match[1] : null;
              } catch { /* version extraction optional */ }

              // Register in DB
              const toolName = name || binName;
              const tool = createCustomCliTool({
                name: toolName,
                binPath,
                binName: path.basename(binPath),
                version,
              });

              const verStr = version ? ` v${version}` : '';
              return {
                content: [{
                  type: 'text' as const,
                  text: `Successfully installed and registered "${toolName}"${verStr}.\nPath: ${binPath}\nTool ID: ${tool.id}\n\nNow please generate a bilingual description (zh/en) for this tool and call codepilot_cli_tools_add to save it.`,
                }],
              };
            } else {
              return {
                content: [{
                  type: 'text' as const,
                  text: `Command executed but could not locate "${binName}" in PATH after installation.\nOutput:\n${output.slice(0, 1000)}\n\nThe tool may have been installed with a different binary name. Use "which" to find it, then call codepilot_cli_tools_add to register manually.`,
                }],
              };
            }
          } catch (error) {
            const msg = error instanceof Error ? error.message : 'Command execution failed';
            return {
              content: [{ type: 'text' as const, text: `Installation failed: ${msg}` }],
              isError: true,
            };
          }
        },
      ),

      // ── ADD ──────────────────────────────────────────────────────
      tool(
        'codepilot_cli_tools_add',
        'Register an already-installed CLI tool by its binary path, and optionally save its bilingual description. Use this after codepilot_cli_tools_install to save the generated description, or to register a tool the user has already installed.',
        {
          binPath: z.string().optional().describe('Absolute path to the binary, e.g. /usr/local/bin/ffmpeg. Required when registering a new tool.'),
          name: z.string().optional().describe('Display name for the tool'),
          descriptionZh: z.string().optional().describe('Chinese description (2-3 sentences)'),
          descriptionEn: z.string().optional().describe('English description (2-3 sentences)'),
          toolId: z.string().optional().describe('If updating description for an existing tool, pass its tool ID instead of binPath'),
        },
        async ({ binPath, name, descriptionZh, descriptionEn, toolId }) => {
          try {
            // If toolId is provided, treat as a description update for an existing tool.
            // This takes priority over binPath to avoid creating duplicate entries
            // (install returns both toolId and binPath).
            if (toolId && descriptionZh && descriptionEn) {
              upsertCliToolDescription(toolId, descriptionZh, descriptionEn);
              return {
                content: [{
                  type: 'text' as const,
                  text: `Description saved for tool "${toolId}".`,
                }],
              };
            }

            // Registering a new tool — binPath is required
            if (!binPath) {
              return {
                content: [{ type: 'text' as const, text: 'binPath is required when registering a new tool. To update a description only, pass toolId with descriptionZh and descriptionEn.' }],
                isError: true,
              };
            }

            // Validate binPath
            if (!path.isAbsolute(binPath)) {
              return {
                content: [{ type: 'text' as const, text: 'binPath must be an absolute path.' }],
                isError: true,
              };
            }

            try {
              await access(binPath, constants.X_OK);
            } catch {
              return {
                content: [{ type: 'text' as const, text: `File not found or not executable: ${binPath}` }],
                isError: true,
              };
            }

            // Extract version
            let version: string | null = null;
            try {
              const { stdout, stderr } = await execFileAsync(binPath, ['--version'], { timeout: 5000 });
              const vText = (stdout || stderr).trim();
              const match = vText.split('\n')[0]?.match(/(\d+\.\d+[\w.-]*)/);
              version = match ? match[1] : null;
            } catch { /* optional */ }

            const binName = path.basename(binPath);
            const toolName = name || binName;

            const created = createCustomCliTool({
              name: toolName,
              binPath,
              binName,
              version,
            });

            // Save description if provided
            if (descriptionZh && descriptionEn) {
              upsertCliToolDescription(created.id, descriptionZh, descriptionEn);
            }

            const verStr = version ? ` v${version}` : '';
            return {
              content: [{
                type: 'text' as const,
                text: `Registered "${toolName}"${verStr}.\nPath: ${binPath}\nTool ID: ${created.id}${descriptionZh ? '\nDescription saved.' : ''}`,
              }],
            };
          } catch (error) {
            return {
              content: [{
                type: 'text' as const,
                text: `Failed to add tool: ${error instanceof Error ? error.message : 'Unknown error'}`,
              }],
              isError: true,
            };
          }
        },
      ),

      // ── REMOVE ───────────────────────────────────────────────────
      tool(
        'codepilot_cli_tools_remove',
        'Remove a custom (user-added) CLI tool from the library. Only custom tools can be removed — catalog and system-detected tools cannot be removed.',
        {
          toolId: z.string().describe('The tool ID to remove, e.g. "custom-mytool"'),
        },
        async ({ toolId }) => {
          try {
            const existing = getCustomCliTool(toolId);
            if (!existing) {
              return {
                content: [{
                  type: 'text' as const,
                  text: `Tool "${toolId}" not found. Only custom tools (ID starting with "custom-") can be removed.`,
                }],
                isError: true,
              };
            }

            deleteCustomCliTool(toolId);
            return {
              content: [{
                type: 'text' as const,
                text: `Removed "${existing.name}" (${toolId}) from the tool library.`,
              }],
            };
          } catch (error) {
            return {
              content: [{
                type: 'text' as const,
                text: `Failed to remove tool: ${error instanceof Error ? error.message : 'Unknown error'}`,
              }],
              isError: true,
            };
          }
        },
      ),
    ],
  });
}
