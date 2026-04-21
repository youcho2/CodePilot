## CodePilot v0.52.0

> Artifact 预览面板升级：AI 生成的 React 组件和表格现在可以在侧栏直接看、Markdown 可以直接改，HTML 一键导出长图。长文档预览从 1000 行放宽到 50000 行。

### 新增功能

- **Artifact 支持 React 组件预览（.jsx / .tsx）** — AI 在聊天里生成或修改 `.jsx`/`.tsx` 时，聊天里会出现 Artifact 卡片；点击 "Open preview" 在侧栏看到实时渲染结果。支持 React hooks、Tailwind utility 和 `react`/`react-dom`/`lucide-react` 等白名单依赖。第一版聚焦"单文件 React 组件"，多文件项目 / `@/` 路径别名 / CSS import 这类复杂场景会明确提示"当前不支持"，不会无声失败
- **Artifact 支持 CSV / TSV 表格预览** — AI 生成或写入的 `.csv`/`.tsv` 文件在聊天里会有卡片，文件树里点击也默认进入表格视图。支持点列头排序、一键导出 CSV / JSON
- **Markdown 文件直接在预览面板里编辑** — 之前只能看不能改；现在 `.md` / `.mdx` / `.txt` 打开后可以在 "Edit" 视图直接用 CodeMirror 6 编辑，1 秒停笔后自动保存到磁盘，不用切到 Obsidian。Tab 缩进、⌘S 主动保存、深色主题跟随系统都已支持
- **HTML Artifact 一键导出长图** — 预览 HTML 时标题栏有"导出长图"按钮，一次把整页渲染成 PNG（超过视口高度也能完整抓到），直接下载到本地。同一张卡片在聊天里也能导出
- **文件树新建文件 / 文件夹** — 文件树任务分割线下方有 VS Code 风格的 "New Markdown" / "New Folder" 按钮；点击某个文件夹会高亮选中，之后新建的文件会落到这个文件夹里
- **聊天里 AI 修改过的文件变成 Artifact 卡片** — 以前 AI 修改多个文件时只是一行小字 "Modified 3 files"，现在每个可预览的文件（Markdown / HTML / JSX / TSX / CSV / TSV）都是一张独立卡片，带 Created / Modified 状态 chip + "Open preview" 按钮，非预览类文件收进底部一行 "Also modified: ..." 不占空间
- **文件写入 / 删除 / 改名 / 新建文件夹四套 API** — `.md` 编辑靠它保存；删除走系统回收站（不是真删），误操作可以在访达/资源管理器的回收站恢复；路径安全检查统一走 symlink 拒绝 + 真实路径比对，不允许跨工作区写入

### 修复问题

- **快速切换多个 `.tsx` 文件时预览错乱** — 之前点 A.tsx 看到 A，切到 B.tsx 还是 A；根源是 Sandpack 运行入口没有按文件重建。现在每个文件有独立 provider 实例 + 内容哈希，切换即时生效
- **文件预览首帧闪旧内容** — 点击新文件时面板会短暂显示上一个文件的内容再切到新的。现在内容会在新路径加载前被清空，不会再闪
- **Markdown 自动保存偶尔把 A 文件的内容写到 B 路径** — 快速切文件时的罕见 race condition，现在保存前先确认"当前预览的文件"和"编辑器里的文件"一致才写入
- **预览文件请求能跟随符号链接到工作区外** — 即使工作区本身是 symlink 也能兼容，但如果目标文件自身是 symlink 则拒绝访问，防止信息泄露

### 优化改进

- **Markdown 预览上限从 1000 行 / ~30KB 放宽到 50000 行 / 10MB** — 真实长文档（论文、长篇博客、大段 changelog）可以完整打开。超过上限时会在顶部显示截断提示，明确告诉你看到的是前 N 行
- **预览列表加截断提示横幅** — 文件太大被截断时有一行黄色提示说明原因（按行数 / 按字节），而不是静默显示不完整的内容
- **二进制文件预览时给占位说明** — 打开 PNG / 字体 / 可执行文件不会再看到一串乱码，会显示"该文件是二进制格式，无法作为文本预览"
- **代码高亮缓存从聊天到预览共享** — 之前聊天和预览各用一套无上限的 Shiki 高亮器缓存，长会话后占内存。现在合并到同一个 10 个 highlighter + 200 个 token 结果的 LRU 上
- **Preview 面板现在支持聊天里提取的内联内容** — 为后续"AI 直接在聊天里出内联表格 / HTML 片段"铺垫好了数据模型（PreviewSource 联合类型）
- **聊天 AI 生成的文件路径自动解析** — 有些工具返回的是相对路径，以前点击卡片会 404；现在会和当前工作目录拼接后再打开
- **新建文件 / 编辑器 / 表格 / Sandpack 都是按需加载** — 不打开预览的场景不会多吃首屏 bundle

## 下载地址

### macOS
- [Apple Silicon (M1/M2/M3/M4)](https://github.com/op7418/CodePilot/releases/download/v0.52.0/CodePilot-0.52.0-arm64.dmg)
- [Intel](https://github.com/op7418/CodePilot/releases/download/v0.52.0/CodePilot-0.52.0-x64.dmg)

### Windows
- [Windows 安装包](https://github.com/op7418/CodePilot/releases/download/v0.52.0/CodePilot.Setup.0.52.0.exe)

## 安装说明

**macOS**: 下载 DMG → 拖入 Applications → 首次启动如遇安全提示，在系统设置 > 隐私与安全中点击"仍要打开"
**Windows**: 下载 exe 安装包 → 双击安装

## 系统要求

- macOS 12.0+ / Windows 10+ / Linux (glibc 2.31+)
- 需要配置 API 服务商（Anthropic / OpenRouter 等）
- 推荐安装 Claude Code CLI 以获得完整功能
