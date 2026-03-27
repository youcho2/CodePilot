# CLI Tools — 系统 CLI 工具管理与 MCP 集成

> 产品思考见 [docs/insights/cli-tools.md](../insights/cli-tools.md)

## 核心思路

AI 工作流中 CLI 工具（ffmpeg、jq、ripgrep 等）是重要基础设施，但用户往往不知道装什么、怎么装。本功能提供：

1. **UI 管理页面** — 浏览、管理、一键安装推荐工具，查看已安装工具详情
2. **MCP 工具集成** — 模型通过 MCP 工具主动帮用户安装、注册、查询、更新 CLI 工具
3. **AI 结构化简介** — 自动生成包含工具简介、适用场景、快速上手、示例提示词的完整描述
4. **对话式添加工具** — "添加工具"按钮跳转聊天，模型全流程协助安装+注册+生成简介
5. **版本更新检测** — 检查已安装工具是否有可用更新，支持一键更新

## 目录结构

```
src/lib/
├── cli-tools-catalog.ts       # 静态精选 catalog（10 个核心 + EXTRA_WELL_KNOWN_BINS）
├── cli-tools-detect.ts        # 系统检测逻辑（which/where + --version，2 分钟缓存）
├── cli-tools-context.ts       # 聊天上下文构建（保留但不再用于 system prompt 注入）
├── cli-tools-mcp.ts           # ★ MCP server（6 个工具）

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
├── CliToolAddDialog.tsx       # 手动添加工具弹窗（保留备用，MCP 替代主流程）
└── CliToolsPopover.tsx        # 聊天输入框的工具选择器
```

## 数据持久化

### 数据库表

**`cli_tools_custom`** — 用户手动添加或通过 MCP install 注册的自定义工具：

| 列 | 类型 | 说明 |
|----|------|------|
| id | TEXT PK | `custom-<binName>`，冲突追加 `-2` |
| name | TEXT | 显示名称 |
| bin_path | TEXT | 二进制文件绝对路径（幂等去重键） |
| bin_name | TEXT | 文件名（basename） |
| version | TEXT | 版本号（可选） |
| install_method | TEXT | 安装方式：`brew`/`npm`/`pipx`/`pip`/`cargo`/`apt`/`unknown` |
| install_package | TEXT | 实际包名/formula spec（如 `stripe/stripe-cli/stripe`、`@elevenlabs/cli`） |
| enabled | INTEGER | 1=启用 |
| created_at / updated_at | TEXT | 时间戳 |

`install_method` + `install_package` 组合确保更新命令准确。`install_package` 存储安装命令中提取的完整包规格，而非从 id 或 binName 推导。

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

describe 路由在保存前对所有字段做完整归一化校验（确保数组类型正确、过滤非法条目），返回归一化后的数据（而非原始 AI 输出）。

## MCP 集成（核心架构）

### MCP Server: `codepilot-cli-tools`

定义在 `src/lib/cli-tools-mcp.ts`，提供 6 个工具：

| 工具名 | 功能 | 自动批准 |
|--------|------|---------|
| `codepilot_cli_tools_list` | 列出所有工具，支持 `format="json"` 结构化输出 | 是 |
| `codepilot_cli_tools_install` | 执行安装命令 → 检测 → 注册 → 记录安装方式和包名 → needs_auth 工具自动提示认证步骤 | 否 |
| `codepilot_cli_tools_add` | 按路径注册 + 可选保存双语简介（也支持 toolId-only 更新简介） | 是 |
| `codepilot_cli_tools_remove` | 删除自定义工具 | 是 |
| `codepilot_cli_tools_check_updates` | 检测 brew outdated / npm outdated，对比自定义工具版本 | 是 |
| `codepilot_cli_tools_update` | 根据存储的 install_method + install_package 执行更新命令 | 否 |

### 注入方式

**关键词触发（`claude-client.ts`）：**

```
正则覆盖：CLI工具、cli tool、安装/卸载/添加/更新/升级.*工具、工具库、tool library、
帮我装/安装/更新/升级、install/uninstall/update/upgrade + word、
brew/pip/pipx/npm/cargo/apt install/upgrade、codepilot_cli_tools
```

匹配当前消息或对话历史 → 注入 `codepilot-cli-tools` MCP server + system prompt hint。

**System Prompt 注入：**

仅在 MCP server 同时挂载时才注入能力提示（`claude-client.ts`），不再在 `context-assembler.ts` 常驻注入。确保不会宣称有 MCP 能力但实际未挂载。

### 安装流程（install → add 协作）

```
用户: "帮我安装 stripe CLI"
  → 模型调用 codepilot_cli_tools_install(command: "brew install stripe/stripe-cli/stripe")
  → 权限弹窗 → 用户确认 → 执行命令
  → 提取: installMethod="brew", installPackage="stripe/stripe-cli/stripe"
  → which 定位二进制 → createCustomCliTool() 注册（含 installMethod + installPackage）
  → 检测到 setupType="needs_auth" → 返回认证步骤引导
  → 模型引导用户: "现在请运行 stripe login 完成认证"
  → 模型用自身知识生成双语简介
  → 模型调用 codepilot_cli_tools_add(toolId, descriptionZh, descriptionEn)
  → 简介持久化到 DB
```

### 更新流程（check_updates → update）

```
用户: "检查一下有没有工具可以更新"
  → 模型调用 codepilot_cli_tools_check_updates
  → 运行 brew outdated --json + npm outdated -g --json
  → 比对 custom 工具版本
  → 返回有更新的工具列表

用户: "帮我更新 stripe"
  → 模型调用 codepilot_cli_tools_update(name: "stripe")
  → 查找: custom 工具有 installPackage="stripe/stripe-cli/stripe", installMethod="brew"
  → 构建命令: brew upgrade stripe/stripe-cli/stripe
  → 权限弹窗 → 执行 → 重新检测版本
```

关键：update 命令使用 DB 中存储的 `install_package`（完整包名），而非从 tool id 或 binary name 推导，确保 `brew upgrade stripe/stripe-cli/stripe` 而非错误的 `brew upgrade stripe`。

## 类型定义

关键类型在 `src/types/index.ts`：

| 类型 | 用途 |
|------|------|
| `CliToolStatus` | `'not_installed' \| 'installed' \| 'needs_auth' \| 'ready'` |
| `CliToolCategory` | `'media' \| 'data' \| 'search' \| 'download' \| 'document' \| 'productivity'` |
| `CliToolDefinition` | 完整的 catalog 工具定义 |
| `CliToolRuntimeInfo` | 运行时检测结果（状态、版本、路径） |
| `CustomCliTool` | DB 中的自定义工具记录（含 installMethod + installPackage） |
| `CliToolStructuredDesc` | 结构化描述（intro/useCases/guideSteps/examplePrompts） |
| `CliToolExamplePrompt` | 示例提示词（label/promptZh/promptEn） |

## DB helper 函数（`src/lib/db.ts`）

| 函数 | 用途 |
|------|------|
| `getAllCustomCliTools()` | 返回所有启用的自定义工具 |
| `getCustomCliTool(id)` | 按 ID 查询单个自定义工具 |
| `createCustomCliTool(params)` | 创建自定义工具（按 bin_path 幂等去重），支持 installMethod + installPackage |
| `deleteCustomCliTool(id)` | 删除自定义工具 |
| `getAllCliToolDescriptions()` | 返回所有描述（含 structured） |
| `upsertCliToolDescription(id, zh, en, structuredJson?)` | 插入或更新描述 |
| `bulkUpsertCliToolDescriptions(entries)` | 事务批量写入描述 |

## 设计决策

### 为什么用 MCP 而不是纯 UI？

MCP 让模型主动参与工具管理：安装、注册、生成简介、检查更新在一次对话中完成。UI 页面保留用于浏览管理。

### 为什么 install/update 不自动批准？

安装和更新执行 shell 命令、修改系统状态。list / add / remove / check_updates 是安全操作，自动批准。

### 为什么存储 install_package 而不是从 id 推导？

真实安装命令的包名可能与工具 id 不同：`stripe/stripe-cli/stripe`（brew tap formula）、`@elevenlabs/cli`（scoped npm）、`ripgrep`（crate name != binary name `rg`）。存储完整包名确保 update 命令准确。

### 为什么 system prompt 只在 MCP 挂载时注入？

避免宣称有能力但实际没有 MCP server 可用的不一致情况。关键词触发确保两者同步。

### EXTRA_WELL_KNOWN_BINS

除 catalog 中的 10 个精选工具外，`cli-tools-catalog.ts` 还导出 `EXTRA_WELL_KNOWN_BINS` 数组——常见但不需要详情页的工具（如 python、node、go、docker 等 20+），自动检测已安装的显示在 UI 中（带"系统检测"标签）。
