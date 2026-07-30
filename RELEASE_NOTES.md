## CodePilot v0.62.0

> 重新设计 Markdown 编辑体验和文件树操作：Markdown 现在可在同一页面边写边看，文件树补齐常用右键操作与文件类型图标，并修复深色模式和 macOS 原生磨砂显示。

### 新增功能

- **Markdown 单页 Live Preview** — `.md` / `.mdx` 不再在编辑与预览页面之间切换。光标所在内容显示原始 Markdown，其他内容直接渲染标题、列表、Checklist、表格、代码块、图片、Mermaid 和数学公式；自动保存、手动保存与磁盘冲突保护继续保留。
- **更完整的文件树操作** — 文件和文件夹支持右键新建、重命名、移入系统废纸篓以及添加到对话；新建操作改为更明显的弹窗，项目和会话也支持与“三个点”菜单一致的右键操作。
- **文件类型图标** — 文件夹只显示展开箭头，文件显示对应类型图标。即使长文件名被截断，也能更容易区分 Markdown、HTML、TypeScript、图片等类型。
- **输入框原生右键菜单** — 普通输入框、文本域和 Markdown 编辑器可使用系统复制、粘贴、剪切、撤销等操作；密码输入仍保持保护。

### 修复问题

- **修复 Markdown 预览样式不一致** — 移除多套预览主题，文件预览与聊天消息共享同一套 Markdown 视觉规则，统一标题、正文、列表、加粗、引用、链接、表格和代码样式。
- **修复 Markdown 下划线、行号和选中背景干扰** — 清理无意义装饰，去掉行号与活动行背景，并修复快速调整面板宽度时自动换行偶发失效。
- **修复 Checklist 渲染** — `- [ ]` / `- [x]` 现在显示为可访问的标准 Checklist，并支持有序任务列表；同时补齐删除线和 Setext 标题。
- **修复文件树选择状态混淆** — “当前已打开文件”和“文件树中临时选中项”使用不同反馈，并移除文件、文件夹后的冗余加号与左侧描边。
- **修复右键菜单焦点与关闭问题** — 文件重命名不会因菜单关闭而自取消，会话重命名/删除后菜单正常收起，重命名输入框仍可使用系统编辑右键。
- **修复深色模式显示** — Markdown 背景与其他卡片保持一致，标题恢复为偏白前景色；左侧栏和卡片的深色层次也已校准。
- **修复 macOS 外围磨砂** — 应用主题会同步到 Electron 原生材质，浅色和深色均保留半透明效果；默认材质调为更清晰的 `under-window`，降低过度模糊感。

### 优化改进

- Markdown 编辑器恢复搜索、多光标、括号补全等 CodeMirror 编辑能力。
- 文件重命名会默认选中文件名主体并保留扩展名，`.env` 和多重扩展名也按预期处理。
- 文件移动、重命名或删除时，已打开标签、预览和自动保存状态会一起迁移或回滚，避免旧路径被重新写回。
- 文件类型图标以固定静态资源随应用打包，不需要运行时联网。

### 已知限制

- 本版按产品决策同步发布 macOS 与 Windows，但发布前未完成 Windows 实机的“移入回收站并恢复”验证；Windows 产物将由用户在发布后验证，如有问题将继续修复。
- Claude Code Runtime 连接首包等待极长的第三方渠道时，6–9 分钟真实慢渠道验证仍未完成；如仍出现自动中断，请在 [#635](https://github.com/op7418/CodePilot/issues/635) 反馈 Runtime、服务商和错误提示。
- Claude Code Runtime 使用 Opus 5 需要 Claude Code CLI 2.1.219 或更新版本。
- 尚未验证的 OpenRouter、Bedrock 和 Vertex Opus 5 模型 ID 不会被自动加入目录；可用性以各服务商实际支持为准。
- Grok 4.5 Sub-agent 是否可运行仍取决于当前 xAI 账号的实际权限；目录可见不代表套餐 entitlement 一定可用。
- 部分 Windows 11 25H2 设备仍可能出现安装程序启动后立即退出的问题，正在 [#633](https://github.com/op7418/CodePilot/issues/633) 跟进。
- Native Runtime 的定时任务工具缺失、复杂项目的新会话上下文膨胀，以及更新提示期间 CPU 持续偏高，分别在 [#634](https://github.com/op7418/CodePilot/issues/634)、[#632](https://github.com/op7418/CodePilot/issues/632)、[#626](https://github.com/op7418/CodePilot/issues/626) 跟进。

## 下载地址

### macOS
- [Apple Silicon (M1/M2/M3/M4)](https://github.com/op7418/CodePilot/releases/download/v0.62.0/CodePilot-0.62.0-arm64.dmg)
- [Intel](https://github.com/op7418/CodePilot/releases/download/v0.62.0/CodePilot-0.62.0-x64.dmg)

### Windows
- [Windows 安装包](https://github.com/op7418/CodePilot/releases/download/v0.62.0/CodePilot.Setup.0.62.0.exe)

## 安装说明

**macOS**：下载 DMG → 拖入 Applications → 首次启动如遇安全提示，在系统设置 > 隐私与安全中点击“仍要打开”
**Windows**：下载 exe 安装包 → 双击安装

## 系统要求

- macOS 12.0+ / Windows 10+ / Linux (glibc 2.31+)
- 需要配置 API 服务商或受支持的套餐凭据
- 推荐安装 Claude Code CLI 以获得完整功能
