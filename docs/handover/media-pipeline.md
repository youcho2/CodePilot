# 媒体管线（Media Pipeline）

## 核心思路

MCP 协议原生支持在 tool result 中返回 image/audio content blocks，但 CodePilot 之前将其丢弃。此次改造打通了从 SDK 到渲染的完整链路：MCP/Skills 返回的媒体内容可在聊天里内联预览，并自动保存到素材库。同时扩展了文件树预览、Gallery 视频支持、CLI 工具媒体导入。

## 目录结构

```
src/lib/
├── media-saver.ts              # 媒体保存工具：base64→文件→DB（MCP 结果）/ 文件复制→DB（CLI 导入）
├── claude-client.ts             # (修改) 不再丢弃 MCP image/audio blocks，提取为 MediaBlock[]

src/components/chat/
├── MediaPreview.tsx             # 统一媒体渲染组件：img/video/audio，支持 Lightbox
├── ToolCallBlock.tsx            # (修改) 接受 media prop，展示 MediaPreview，有 media 时自动展开
├── MessageItem.tsx              # (修改) parseToolBlocks/pairTools 传递 media
├── StreamingMessage.tsx         # (修改) streaming tool results 传递 media

src/components/ai-elements/
├── tool-actions-group.tsx       # (修改) 有 media 的 tool row 显示图片指示图标

src/components/layout/panels/
├── FileTreePanel.tsx            # (修改) 图片/视频不再被屏蔽，可点击预览
├── PreviewPanel.tsx             # (修改) 新增 MediaView 支持图片/视频/音频直接预览

src/components/gallery/
├── GalleryGrid.tsx              # (修改) 视频缩略图 + 播放图标覆盖层
├── GalleryDetail.tsx            # (修改) 视频用 <video controls> 播放

src/app/api/
├── media/serve/route.ts         # (修改) 扩展视频/音频 MIME + HTTP Range 支持
├── media/import/route.ts        # 新路由：CLI 工具媒体导入
├── media/gallery/route.ts       # (修改) 视频 MIME 检测，返回 type 字段
├── files/serve/route.ts         # 新路由：从工作目录服务文件（用于文件树预览）
├── chat/route.ts                # (修改) collectStreamResponse 中自动保存 media blocks

src/types/index.ts               # (修改) MediaBlock 接口、ToolResultInfo/MessageContentBlock 扩展
src/hooks/useSSEStream.ts        # (修改) 解析 SSE tool_result 中的 media 字段
```

## 数据流

### MCP 媒体结果（自动入库）

```
MCP Server 返回 tool_result
  content: [
    {type: "text", text: "生成完成"},
    {type: "image", data: "base64...", mimeType: "image/png"}
  ]
  ↓
claude-client.ts — 提取 text → resultContent, image/audio → mediaBlocks
  ↓
SSE event: {type: "tool_result", data: {content, media: MediaBlock[], ...}}
  ↓
┌─ 服务端 (chat/route.ts collectStreamResponse):
│    media blocks → saveMediaToLibrary() → 写文件到 .codepilot-media/
│    → 插入 media_generations DB 记录 (provider='mcp')
│    → 替换 base64 为 localPath（防止 SQLite 膨胀）
│    → 存入 contentBlocks
│
└─ 客户端 (useSSEStream → stream-session-manager):
     media 字段传递到 toolResultsArray
       → StreamingMessage → ToolActionsGroup (media indicator icon)
       → ToolCallBlock → MediaPreview 渲染 img/video/audio
```

### CLI 工具导入（手动入库）

```
用户: "帮我把 ./output.png 保存到素材库"
  ↓
Claude: curl -X POST http://localhost:3000/api/media/import
  -d '{"filePath":"./output.png", "source":"jimeng-cli"}'
  ↓
media/import/route.ts → importFileToLibrary()
  → 复制文件到 .codepilot-media/
  → 插入 media_generations (provider='jimeng-cli')
  → 返回 {id, galleryUrl}
```

### 文件树预览

```
用户点击文件树中的 .png/.mp4
  ↓
FileTreePanel — 不再被 NON_PREVIEWABLE 阻止
  → setPreviewFile(path) + setPreviewOpen(true)
  ↓
PreviewPanel — isMediaPreview(filePath) 命中
  → 跳过 /api/files/preview (不需要文本内容)
  → 直接渲染 <img>/<video>/<audio>
  → src = /api/files/serve?path=...&sessionId=... (或 fallback /api/files/raw)
```

## 关键类型

```typescript
// 媒体内容块 — 贯穿整个管线
interface MediaBlock {
  type: 'image' | 'audio' | 'video';
  data?: string;        // base64（传输中，保存后清除）
  mimeType: string;     // e.g. 'image/png', 'video/mp4'
  localPath?: string;   // 保存后的本地路径
  mediaId?: string;     // media_generations.id
}

// tool_result 扩展
type MessageContentBlock =
  | ...
  | { type: 'tool_result'; tool_use_id: string; content: string;
      is_error?: boolean; media?: MediaBlock[] }  // ← 新增 media

// ToolResultInfo 扩展（SSE + streaming state）
interface ToolResultInfo {
  tool_use_id: string;
  content: string;
  media?: MediaBlock[];  // ← 新增
}
```

## 入库机制

| 来源 | 入库方式 | provider 字段 | 触发时机 |
|------|----------|---------------|----------|
| MCP tool result | 自动 | `'mcp'` | collectStreamResponse 处理 media blocks 时 |
| CLI 工具 | 手动 (Claude curl) | `opts.source` e.g. `'jimeng-cli'` | 用户要求或 Claude 询问后 |
| 设计模式 (Gemini) | 自动 | `'gemini'` | 现有 image-generator.ts 逻辑不变 |

## 安全模型

- **media/serve**: 用 `path.resolve` 规范化后，校验路径必须以 `~/.codepilot/.codepilot-media/` 的真实绝对路径开头（`startsWith` 检查，不再用 `.includes` 子串判断）
- **files/serve**: 必须传 `sessionId`，服务端从 DB 获取 `session.working_directory` 作为 baseDir（不信任客户端传入路径）；校验 resolved path 严格在 baseDir 子目录内。`sessionId` 为空时前端 fallback 到 `/api/files/raw`（限制在 home 目录内）
- **media/import**: 验证文件存在，复制到 `.codepilot-media/` 而非直接引用原路径；相对路径基于 session working directory 解析（`cwd` 参数），非进程 cwd

## 后续演进：MCP 媒体工具（代码模式专用）

在代码模式下（非设计 Agent），通过关键词门控按需注入两个 in-process MCP 工具。设计 Agent 模式保持原有 `image-gen-request` 结构化块 + `ImageGenConfirmation` 确认 UI 的链路不变。

### 双路径架构

| 场景 | 路径 | 确认 UI |
|------|------|---------|
| **设计 Agent 模式** | Claude 输出 `image-gen-request` 块 → `ImageGenConfirmation` 确认 → `/api/media/generate` | 有（可编辑 prompt、比例、分辨率） |
| **代码模式** | 关键词门控注入 MCP → Claude 调用 `codepilot_generate_image` / `codepilot_import_media` → 自动执行 → `MEDIA_RESULT_MARKER` → `MediaPreview` 内联渲染 | 无（自动执行） |

### MCP 工具

| 工具 | 文件 | 用途 |
|------|------|------|
| `codepilot_import_media` | `src/lib/media-import-mcp.ts` | 导入本地文件到素材库 + 聊天内联显示。CLI 工具生成媒体后调用 |
| `codepilot_generate_image` | `src/lib/image-gen-mcp.ts` | 调用 Gemini 生成图片，保存到素材库 + 聊天内联显示 |

### `MEDIA_RESULT_MARKER` 机制

SDK 不会将 in-process MCP 的 image content block 透传到 conversation stream。解决方案：MCP tool 在返回文本中嵌入 `__MEDIA_RESULT__[{type,mimeType,localPath,mediaId}]`，`claude-client.ts` 检测后构造 `MediaBlock{localPath}` 注入 SSE event 的 `media` 字段，前端 `MediaPreview` 通过 `/api/media/serve?path=...` 渲染。marker 文本在注入前被 strip。

### 关键词门控

`needsMediaMcp`（`claude-client.ts`）匹配中文关键词（生成图片、画一、图像等）或历史消息中的 MCP tool 名。设计 Agent 模式（`imageAgentMode=true`）**不触发**，避免与旧链路冲突。

### 改动文件

| 文件 | 改动 |
|------|------|
| `src/lib/image-generator.ts` | 新增 `skipSave` 参数 + `rawData` 返回（预留，当前未使用） |
| `src/lib/media-saver.ts` | `SaveMediaOptions` 新增 `model`, `aspectRatio`, `imageSize`, `cwd` 字段 |
| `src/lib/claude-client.ts` | `needsMediaMcp` 门控 + MCP 注册 + `MEDIA_RESULT_MARKER` 检测 + 内部工具自动审批 |
| `src/app/api/chat/route.ts` | `isImageAgentMode` 精确判断（仅设计 Agent prompt，非任意 systemPromptAppend） |
| `src/components/chat/MessageItem.tsx` | 从 tool results 提取 media，在 tool group 外独立渲染 `MediaPreview` |
| `src/components/chat/StreamingMessage.tsx` | 同上，streaming 状态下独立渲染 media |

### 安全修复

| 文件 | 修复 |
|------|------|
| `src/app/api/files/serve/route.ts` | 去掉客户端 `baseDir`，改为 `sessionId` 从 DB 获取真实 cwd；pre-session 状态前端 fallback 到 `/api/files/raw` |
| `src/app/api/media/serve/route.ts` | 用 `path.resolve` + `startsWith` 校验真实 `.codepilot-media` 目录，替代 `.includes` 子串判断 |
