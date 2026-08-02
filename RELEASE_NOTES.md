## CodePilot v0.63.0

> 建立用户可长期拥有的 Harness 与素材基础，重做素材库和网页归档体验，并为 DeepSeek V4 Flash 0731 补齐 Codex Runtime 与推理强度支持。

### 新增功能

- **用户所有的 Harness 基础** — Memory、Skill、MCP、Runtime 配置和设计方法现在有一套与具体 Agent 框架解耦的本地文件模型，可从 Claude Code、Codex 和助理工作区导入，并保留来源、作用域、冲突和未授权 Secret 状态。
- **通用素材库** — 图片、视频、音频和成功归档的网页可以在同一个素材库中管理；支持搜索、类型筛选、收藏、标签、右键操作、创作脉络以及带保护的永久删除。
- **网页完整归档** — 聊天中的网页结果可以连同本地依赖一起归档，并生成静态 16:9 缩略图；素材库不再运行网页本身，浏览更稳定、资源占用更低。
- **DeepSeek V4 Flash 0731** — 保持原有 `deepseek-v4-flash` 模型名即可自动使用新版本。DeepSeek 官方直连支持约 100 万上下文和 Low / High / Max 推理强度；Codex Runtime 使用 DeepSeek 原生 Responses API，CodePilot Runtime 使用 Anthropic 兼容接口。
- **可追溯的设计方法基础** — 新增候选/确认/停用状态、证据引用、适用范围和版本化存储，为后续把真实审美判断和图片→视频→网页流程沉淀成可复用方法做好准备。

### 修复问题

- **修复 Codex 图片重复入库** — 同一会话中来自同一源文件且内容一致的图片不再重复保存；仅用于预览的图片也不会写入素材库。
- **修复历史素材无法管理** — 旧版本留下的只有 ID 或元数据不完整的素材仍可查看、添加标签和删除，损坏行不会拖垮整个素材库。
- **修复网页归档失败与预览异常** — 归档会正确处理编码片段、本地依赖和页面标题；网页缩略图会阻止脚本、外部请求、跳转和弹窗，并显示被阻止的外部地址信息。
- **修复素材库布局与交互问题** — 恢复自适应瀑布流，修正按时间从左到右的排序、响应式列宽、详情滚动、收藏按钮、悬浮描边和上下文菜单。
- **修复聊天链接打开错误** — 网络链接可以用系统浏览器打开，本地文件和目录会先经过安全识别；无效路径不会再被误当作网页塞进侧边预览。
- **修复本地命令注入风险** — 搜索工具不再把模型输入拼接进 shell，Skill Marketplace 安装也增加同源、JSON 和仓库地址校验。
- **修复 Harness 文件恢复边界** — 加强原子写入、崩溃恢复、写入租约、符号链接防护和损坏记录隔离，避免单条坏数据或异常 journal 阻塞整个 Harness。

### 优化改进

- Markdown 链接改为清晰的蓝色，并统一聊天网页卡片的打开入口和悬浮说明。
- 素材库搜索加入防抖、请求取消、乱序保护和真实分页，大素材库下仍按最新时间稳定展示。
- 新 Harness 框架可以先接入导入/导出能力，不必同时实现完整聊天 Runtime，降低后续适配成本。
- 第一方模型能力与代理渠道能力分开声明；ClinePass、OpenCode Go 不会误继承尚未验证的 DeepSeek 推理参数。

### 已知限制

- 本版交付的是 Harness Home 的领域模型、文件仓库、适配器和现有产品入口，尚未新增一个独立的 “Harness Home” 管理页面。
- CodePilot Design Method 目前只保存有证据的候选原则；通用方法包、golden set 和真实图片→视频→网页审美验收仍需用户确认，产品不会凭空生成审美规则。
- DeepSeek 两条官方 API 真实请求已经通过，但打包客户端中的完整 UI 流程及 Claude Code 子进程完整回合尚未做发布前人工验收；如渠道返回不支持的推理档位，CodePilot 会停止下发该参数而不是静默伪装成功。

## 下载地址

### macOS
- [Apple Silicon (M1/M2/M3/M4)](https://github.com/op7418/CodePilot/releases/download/v0.63.0/CodePilot-0.63.0-arm64.dmg)
- [Intel](https://github.com/op7418/CodePilot/releases/download/v0.63.0/CodePilot-0.63.0-x64.dmg)

### Windows
- [Windows 安装包](https://github.com/op7418/CodePilot/releases/download/v0.63.0/CodePilot.Setup.0.63.0.exe)

## 安装说明

**macOS**：下载 DMG → 拖入 Applications → 首次启动如遇安全提示，在系统设置 > 隐私与安全中点击“仍要打开”
**Windows**：下载 exe 安装包 → 双击安装

## 系统要求

- macOS 12.0+ / Windows 10+ / Linux (glibc 2.31+)
- 需要配置 API 服务商或受支持的套餐凭据
- 推荐安装 Claude Code CLI 以获得完整功能
