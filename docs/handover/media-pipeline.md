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
  → src = /api/files/serve?path=...&baseDir=...
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

- **media/serve**: 仅允许 `.codepilot-media` 路径内的文件（`path.resolve` + `includes` 检查）
- **files/serve**: 验证请求路径在 `baseDir`（工作目录）内（`startsWith` 检查，防止目录遍历）
- **media/import**: 验证文件存在，复制到 `.codepilot-media/` 而非直接引用原路径

## 后续演进

1. **codepilot-media MCP**：将 `import_media_to_library` 做成 in-process MCP tool，按需注入（关键词检测"图像/视频生成任务"时注册），替代 CLI curl 方式
2. **设计模式 MCP 化**：将现有 Gemini 图片生成包装为 MCP Server，走标准 media pipeline 渲染 + 入库
3. **两个 MCP 组合**：生成 MCP（codepilot-image-gen）+ 入库 MCP（codepilot-media），可组合覆盖设计模式、CLI 工具、第三方 MCP 等所有场景
