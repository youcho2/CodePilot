## CodePilot v0.41.0

> 本版本重点是**侧边栏导航重构**和**全局 UI 一致性优化**。左侧导航从两层图标栏简化为单层侧边栏，所有页面的标题样式统一，多处交互细节改进。

### 新增功能

- **单层侧边栏导航**：移除左侧图标栏（NavRail），Skills、MCP、CLI 工具、素材库、远程桥接等入口整合到侧边栏内，设置固定在底部，所有页面始终可见
- **对话列表搜索弹窗**：搜索改为弹窗形式，支持实时搜索会话并快速跳转
- **项目文件夹动画**：文件夹展开/折叠增加平滑过渡动画
- **对话列表自动截断**：超过 10 条对话的项目自动折叠，底部显示"展开更多"
- **助理项目置顶**：设置了助理工作区的项目自动排在列表最前
- **新增推荐 CLI 工具**：即梦 Dreamina CLI（AI 创作工具包）、飞书 Lark CLI（200+ 命令覆盖飞书全业务域）
- **macOS 磨砂玻璃效果**：Electron 窗口启用 vibrancy，侧边栏支持原生毛玻璃效果

### 修复问题

- 修复斜杠命令（如 /review）发送时用户附加文本在气泡中不显示的问题
- 修复窗口缩小到 1024px 以下时侧边栏消失且无法恢复的问题
- 修复搜索弹窗关闭后隐形过滤条件仍生效的问题
- 修复对话截断可能隐藏当前打开会话的问题
- 修复 JSON 格式版本号（如 Dreamina CLI）显示为乱码的问题
- 修复 OpenAI-compatible 类型 Provider 实际不可用但仍显示在选项中的问题
- 移除 Custom API (OpenAI-compatible) Provider 选项（Claude Code SDK 不支持）

### 优化改进

- 所有非聊天页面标题样式统一：主标题 + 副标题 + 全宽分割线，操作按钮位置一致
- Skills 页面左右分栏改为单线分割，去除嵌套圆角矩形边框
- 非聊天页面顶部空白区域缩小
- "添加项目文件夹"简化为"新建项目"
- 更新指示点颜色跟随主题色
- 导入 CLI 会话功能移至设置 > Claude CLI 区域
- GLM 模型更新为 GLM-5-Turbo / GLM-5.1 / GLM-4.5-Air

## 下载地址

### macOS
- [Apple Silicon (M1/M2/M3/M4)](https://github.com/op7418/CodePilot/releases/download/v0.41.0/CodePilot-0.41.0-arm64.dmg)
- [Intel](https://github.com/op7418/CodePilot/releases/download/v0.41.0/CodePilot-0.41.0-x64.dmg)

### Windows
- [Windows 安装包](https://github.com/op7418/CodePilot/releases/download/v0.41.0/CodePilot-Setup-0.41.0.exe)

## 安装说明

**macOS**: 下载 DMG → 拖入 Applications → 首次启动如遇安全提示，在系统设置 > 隐私与安全中点击"仍要打开"
**Windows**: 下载 exe 安装包 → 双击安装

## 系统要求

- macOS 12.0+ / Windows 10+ / Linux (glibc 2.31+)
- 需要配置 API 服务商（Anthropic / OpenRouter 等）
- 推荐安装 Claude Code CLI 以获得完整功能
