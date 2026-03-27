# CLI Tools — 系统 CLI 工具管理与 MCP 集成

## 核心思路

AI 工作流中 CLI 工具（ffmpeg、jq、ripgrep 等）是重要基础设施，但用户往往不知道装什么、怎么装。本功能提供：

1. **UI 管理页面** — 浏览、管理、一键安装推荐工具，查看已安装工具详情
2. **MCP 工具集成** — 模型通过 MCP 工具主动帮用户安装、注册、查询 CLI 工具
3. **AI 结构化简介** — 自动生成包含工具简介、适用场景、快速上手、示例提示词的完整描述
4. **对话式添加工具** — "添加工具"按钮跳转聊天，模型全流程协助安装+注册+生成简介

## 目录结构

```
src/lib/
├── cli-tools-catalog.ts       # 静态精选 catalog（7 个核心 + EXTRA_WELL_KNOWN_BINS）
├── cli-tools-detect.ts        # 系统检测逻辑（which/where + --version，2 分钟缓存）
├── cli-tools-context.ts       # 聊天上下文构建（保留但不再用于 system prompt 注入）
├── cli-tools-mcp.ts           # ★ MCP server（4 个工具：list/install/add/remove）

src/app/api/cli-tools/
├── catalog/route.ts           # GET — 返回完整 catalog 列表
├── installed/route.ts         # GET — 检测结果 + custom 工具 + descriptions
├── descriptions/route.ts      # POST — localStorage 迁移到 DB 的批量导入
├── custom/
│   ├── route.ts               # GET/POST — 自定义工具 CRUD
│   └── [id]/route.ts          # DELETE — 删除自定义工具
└── [id]/
    ├── status/route.ts        # GET — 单个工具状态 + 版本
    ├── install/route.ts       # POST — SSE 流式安装日志
    ├── detail/route.ts        # GET — 详情弹窗数据
    └── describe/route.ts      # POST — AI 生成结构化双语工具描述

src/components/cli-tools/
├── CliToolsManager.tsx        # 主管理容器（已安装区 + 推荐区 + 添加/批量生成按钮）
├── CliToolCard.tsx            # 工具卡片（installed / recommended 两种 variant）
├── CliToolDetailDialog.tsx    # Catalog 工具详情弹窗（简介/场景/引导/示例 + 尝试使用按钮）
├── CliToolExtraDetailDialog.tsx  # Extra/Custom 工具详情弹窗（结构化简介 + 尝试使用按钮）
├── CliToolInstallDialog.tsx   # SSE 安装进度弹窗
├── CliToolBatchDescribeDialog.tsx  # 批量 AI 描述生成
├── CliToolAddDialog.tsx       # 手动添加工具弹窗（保留但未在主流程使用，MCP 替代）
└── CliToolsPopover.tsx        # 聊天输入框的工具选择器

src/app/cli-tools/page.tsx     # 页面入口
```

## 数据持久化

### 数据库表

**`cli_tools_custom`** — 用户手动添加或通过 MCP install 注册的自定义工具：

| 列 | 类型 | 说明 |
|----|------|------|
| id | TEXT PK | `custom-<binName>`，冲突追加 `-2` |
| name | TEXT | 显示名称 |
| bin_path | TEXT | 二进制文件绝对路径 |
| bin_name | TEXT | 文件名（basename） |
| version | TEXT | 版本号（可选） |
| enabled | INTEGER | 1=启用 |
| created_at / updated_at | TEXT | 时间戳 |

**`cli_tool_descriptions`** — AI 生成的工具描述（适用于所有工具类型）：

| 列 | 类型 | 说明 |
|----|------|------|
| tool_id | TEXT PK | 关联任何工具 ID |
| description_zh | TEXT | 中文摘要（卡片展示用） |
| description_en | TEXT | 英文摘要 |
| structured_json | TEXT | 结构化描述 JSON（详情弹窗用） |
| updated_at | TEXT | 时间戳 |

### structured_json 格式

```json
{
  "intro": { "zh": "工具简介", "en": "Tool intro" },
  "useCases": { "zh": ["用例1", "用例2"], "en": ["Use case 1", "Use case 2"] },
  "guideSteps": { "zh": ["步骤1", "步骤2"], "en": ["Step 1", "Step 2"] },
  "examplePrompts": [
    { "label": "Label", "promptZh": "中文提示词", "promptEn": "English prompt" }
  ]
}
```

该结构与 catalog 工具的 `CliToolDefinition` 中的 detailIntro / useCases / guideSteps / examplePrompts 对齐，确保 extra/custom 工具的详情弹窗与 catalog 工具展示格式一致。

## MCP 集成（核心架构）

### MCP Server: `codepilot-cli-tools`

定义在 `src/lib/cli-tools-mcp.ts`，提供 4 个工具：

| 工具名 | 功能 | 自动批准 |
|--------|------|---------|
| `codepilot_cli_tools_list` | 列出所有工具（catalog + extra + custom），含状态/版本/简介 | ✓ |
| `codepilot_cli_tools_install` | 执行安装命令 → which 定位 → 注册到 DB | ✗（需用户确认） |
| `codepilot_cli_tools_add` | 按路径注册 + 可选保存双语简介 | ✓ |
| `codepilot_cli_tools_remove` | 删除自定义工具 | ✓ |

### 注入方式

**关键词触发（`claude-client.ts`）：**

```
正则：/CLI\s*工具|cli.tool|安装.*工具|install.*tool|卸载.*工具|添加.*工具|工具库|tool\s*library|codepilot_cli_tools/i
```

匹配当前消息或对话历史 → 注入 `codepilot-cli-tools` MCP server + system prompt hint。

**System Prompt 注入（`context-assembler.ts` Layer 4）：**

常驻注入精简一行能力提示（替代旧的完整工具列表 XML）：

```xml
<cli-tools-capability>
You have CLI tool management capabilities via MCP tools: codepilot_cli_tools_list ...
</cli-tools-capability>
```

旧方案是 `buildCliToolsContext()` 将所有已安装工具列表注入 system prompt，现已移除。模型需要工具列表时主动调用 `codepilot_cli_tools_list`。

### 安装+简介的协作流程

```
用户: "帮我安装 tree 并添加到工具库"
  → 模型调用 codepilot_cli_tools_install(command: "brew install tree")
  → 权限弹窗 → 用户确认 → 执行命令
  → 成功后自动 which 定位 → createCustomCliTool() 注册
  → 工具返回结果提示模型生成简介
  → 模型用自身知识生成双语简介
  → 模型调用 codepilot_cli_tools_add(toolId, descriptionZh, descriptionEn)
  → 简介持久化到 DB
```

好处：不需要额外 API 调用生成简介——模型本身就是 AI，直接在对话中完成。

## 数据流

### 工具检测

```
页面加载 → CliToolsManager 并行请求:
  GET /api/cli-tools/catalog    → CLI_TOOLS_CATALOG（静态数据）
  GET /api/cli-tools/installed  → detectAllCliTools() + getAllCustomCliTools() + getAllCliToolDescriptions()
    → catalog: 遍历 catalog binNames，which + --version
    → extra: 遍历 EXTRA_WELL_KNOWN_BINS，只保留已安装的
    → custom: 从 DB 读取用户添加的工具
    → descriptions: 从 DB 读取所有工具描述
    → 模块级缓存（TTL 2 分钟）
→ 合并渲染：catalog 工具 + extra（"系统检测"标签） + custom（"自定义"标签）
```

### 工具安装（UI 方式）

```
用户点击"安装" → 选择安装方式（brew/npm/pipx）
  → POST /api/cli-tools/[id]/install { method }
  → 服务端 spawn 子进程执行 catalog 中声明的 command
  → SSE 流式返回 stdout/stderr
  → CliToolInstallDialog 实时显示日志
  → 完成后重新检测工具状态
```

安全约束：UI 安装只执行 catalog 中声明的 command。MCP install 可执行用户指定的命令，但需经过权限弹窗确认。

### AI 描述生成

```
用户点击"AI 生成简介" → CliToolBatchDescribeDialog
  → 遍历 extra + custom 工具 ID
  → POST /api/cli-tools/[id]/describe { providerId, model }
    → generateTextViaSdk() 生成结构化中英双语描述
    → 返回 { intro, useCases, guideSteps, examplePrompts }
    → 同时持久化到 DB（description_zh/en + structured_json）
  → 前端刷新描述显示
```

描述持久化在 SQLite DB，跨会话保持。旧版 localStorage 缓存会在首次加载时自动迁移到 DB。

### 聊天侧 CLI 选择器

```
聊天输入框工具栏 → 点击 Terminal 图标 → popoverMode = 'cli'
  → 异步 fetch /api/cli-tools/installed（包含 catalog + extra + custom + descriptions）
  → 搜索框过滤 → 选择工具
  → 若输入框为空：预填 "我想用 {tool} 工具完成：" (zh) / "I want to use {tool} to: " (en)
  → 若输入框有内容：附加 CliBadge { id, name }
  → 发送时 CliBadge → systemPromptAppend 注入到 system prompt（不显示在对话中）
```

### 添加工具（对话式）

```
CLI 工具页面 → 点击"添加工具"
  → 跳转 /chat?prefill=<模板prompt>
  → chat/page.tsx 读取 ?prefill 参数 → 传给 MessageInput.initialValue
  → 用户编辑 prompt 后发送
  → 触发 CLI tools MCP 关键词 → 注入 codepilot-cli-tools MCP server
  → 模型调用 MCP 工具完成安装/注册/简介生成
```

## 类型定义

关键类型在 `src/types/index.ts`：

| 类型 | 用途 |
|------|------|
| `CliToolStatus` | `'not_installed' \| 'installed' \| 'needs_auth' \| 'ready'` |
| `CliToolCategory` | `'media' \| 'data' \| 'search' \| 'download' \| 'document' \| 'productivity'` |
| `CliToolDefinition` | 完整的 catalog 工具定义 |
| `CliToolRuntimeInfo` | 运行时检测结果（状态、版本、路径） |
| `CustomCliTool` | DB 中的自定义工具记录 |
| `CliToolStructuredDesc` | 结构化描述（intro/useCases/guideSteps/examplePrompts） |
| `CliToolExamplePrompt` | 示例提示词（label/promptZh/promptEn） |

## 设计决策

### 为什么用 MCP 而不是纯 UI？

MCP 让模型主动参与工具管理：安装、注册、生成简介在一次对话中完成，不需要用户在 UI 和聊天之间来回切换。UI 页面保留用于浏览管理。

### 为什么 install 不自动批准？

安装命令涉及系统改动（执行 shell 命令），需要用户在权限弹窗中确认。list / add / remove 是安全操作，自动批准。

### 为什么简介由模型自身生成而不调 AI API？

MCP install 完成后，模型已经在对话中，它自己就是 AI——直接用自身知识生成简介，然后通过 add 工具的 description 参数保存。省去额外 API 调用。

### 为什么 system prompt 改为精简一行？

旧方案将完整工具列表注入 system prompt，随工具数量增多占用 context。新方案只注入一行能力提示，模型需要时调用 `codepilot_cli_tools_list` 按需获取。

### 为什么描述存 DB 而不是 localStorage？

旧方案存 localStorage，关闭窗口后丢失。现在存 SQLite DB，跨会话持久化。首次加载时自动从 localStorage 迁移。

### 聊天侧 CLI 选择器的 popover 模式

采用 `PopoverMode = 'file' | 'skill' | 'cli' | null` 枚举，CLI 是 button-triggered（点击工具栏图标触发），与 skill 的 text-triggered（输入 `/` 触发）不同。

### EXTRA_WELL_KNOWN_BINS

除 catalog 中的 7 个精选工具外，`cli-tools-catalog.ts` 还导出 `EXTRA_WELL_KNOWN_BINS` 数组——常见但不需要详情页的工具（如 python、node、go、docker 等 20+），自动检测已安装的显示在 UI 中（带"系统检测"标签）。

## DB helper 函数（`src/lib/db.ts`）

| 函数 | 用途 |
|------|------|
| `getAllCustomCliTools()` | 返回所有启用的自定义工具 |
| `getCustomCliTool(id)` | 按 ID 查询单个自定义工具 |
| `createCustomCliTool(params)` | 创建自定义工具，自动处理 ID 冲突 |
| `deleteCustomCliTool(id)` | 删除自定义工具 |
| `getAllCliToolDescriptions()` | 返回所有描述（含 structured） |
| `upsertCliToolDescription(id, zh, en, structuredJson?)` | 插入或更新描述 |
| `bulkUpsertCliToolDescriptions(entries)` | 事务批量写入描述 |
