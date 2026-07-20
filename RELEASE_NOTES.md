## CodePilot v0.58.1

> 基础 AI 体验更新：补齐新模型的推理强度、Claude Code 与 Codex 的「替我审批」、自动聊天命名，并修复模型列表和聊天界面的多处一致性问题。

### 新增功能

- **更多模型支持推理强度** — Codex Account 的 GPT-5.6、Kimi for Coding、GLM-5.2，以及 Claude Sonnet / Opus / Fable 等支持模型，会在模型右侧显示真实可用的推理强度。切换模型时，不支持的档位会自动回到「默认」，不会继续发送无效参数。
- **Claude Code 与 Codex 支持「替我审批」** — 在「需要时询问我」和「完全访问」之间新增受限的模型代审模式；工作区和沙盒边界仍然生效，凭据、付费和对外发布类操作会直接拦截。旧版或无法确认能力的 Runtime 会自动降级，不会显示假支持。
- **自动生成聊天标题** — 新会话首轮回复后可生成更易识别的标题，并同步更新顶部和侧栏；Kimi for Coding 的 always-thinking 调用也已适配。手动改名始终优先，不会被后台生成结果覆盖。
- **模型目录更新** — Claude 目录加入 Sonnet 5、Opus 4.8、Fable 5 等新型号；ClinePass 与 OpenCode Go 增加 Kimi K3。Kimi Coding Plan 继续显示为「Kimi for Coding」，无需跟随底层版本手动改名。

### 修复问题

- **修复 GPT-5.6 与 Kimi 推理选择不显示** — 修复动态模型能力没有进入最终界面、以及存量目录缓存遮蔽新能力的问题；用户自定义模型名称和能力设置仍会保留。
- **修复智谱 CodePlan 添加模型失败** — 上游模型列表暂时不可用时，设置页会回退到内置的当前套餐目录，不再直接报获取失败。
- **修复最新 Claude Agent SDK 被误判为版本过低** — 能力检测改为兼容打包后的应用路径；Codex 使用自身版本和真实响应回显判断，不再受 Claude SDK 状态影响。
- **修复 Kimi 自动命名长期停留在首条消息** — 标题生成使用适合 Kimi Coding 端点的输出预算与超时，同时保持失败不阻塞主回复。
- **修复网络代理绕过规则失效** — DNS 预检现在遵守 `NO_PROXY` / `no_proxy`，避免本应直连的地址被错误拦截。

### 优化改进

- **统一聊天输入区样式** — 模型、推理强度与权限选择使用一致的字号、字重、圆角和间距；窄窗口下菜单会自动避让边缘，不再横向溢出。
- **统一聊天内容字体** — 修正文件树、代码卡片和模型列表中的字体语义：界面名称使用正常 UI 字体，只有真实代码和技术标识使用等宽字体。
- **Claude Code 延迟诊断更准确** — 记录真实首 token、总耗时和重试信息；上游没有返回的数据保持缺失，不再显示虚假的 0。

### 已知问题

- CodePilot Runtime 暂不提供与 Claude Code / Codex 等价的「替我审批」能力；该选项会保持不可用，而不是降级成普通自动放行。
- 少数第三方模型网关是否接受全部推理档位仍取决于服务商实现；CodePilot 只展示已确认的能力，未知档位不会猜测性开放。

## 下载地址

### macOS
- [Apple Silicon (M1/M2/M3/M4)](https://github.com/op7418/CodePilot/releases/download/v0.58.1/CodePilot-0.58.1-arm64.dmg)
- [Intel](https://github.com/op7418/CodePilot/releases/download/v0.58.1/CodePilot-0.58.1-x64.dmg)

### Windows
- [Windows 安装包](https://github.com/op7418/CodePilot/releases/download/v0.58.1/CodePilot.Setup.0.58.1.exe)

## 安装说明

**macOS**: 下载 DMG → 拖入 Applications → 首次启动如遇安全提示，在系统设置 > 隐私与安全中点击"仍要打开"
**Windows**: 下载 exe 安装包 → 双击安装

## 系统要求

- macOS 12.0+ / Windows 10+ / Linux (glibc 2.31+)
- 需要配置 API 服务商（Anthropic / OpenRouter 等）
- 推荐安装 Claude Code CLI 以获得完整功能
