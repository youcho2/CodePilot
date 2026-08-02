# Harness Home：用户所有的 Harness，不是一张新页面

> 技术交接：[../handover/harness-home.md](../handover/harness-home.md)
> 执行计划：[../exec-plans/active/harness-home-user-owned-core.md](../exec-plans/active/harness-home-user-owned-core.md)

## 用户真正要拥有的是什么

“不依赖 Agent 框架和模型”不是说运行时可以凭空消失，而是说用户长期积累的东西不能被某个运行时绑架：

- 助理身份与 Memory；
- Skill、MCP、Rules 和它们的配置；
- 项目/助理/Runtime 下的 scope 与覆盖；
- 图片、视频、音频、网页等可复用素材；
- 设计方法、选择理由和可撤销的 Taste evidence。

这些内容的生命周期通常比单个模型、CLI 或 Agent 框架更长。Harness Home 因此首先是 ownership 与 portability 的产品承诺，其次才是 UI 信息架构。

## 为什么暂时不做独立 Harness Home 页面

用户当前的任务心智并不是“我要管理一个抽象 Harness”：

- 配默认值、权限和路径时会去 Settings；
- 管 Skill/MCP 时会去 Plugins/Skills；
- 整理记忆时会从 Assistant Workspace 进入；
- 找生成结果时会去素材库；
- 继续创作时会从项目或聊天引用 Asset。

把这些入口强行合到一张 Home 页面，会先增加抽象成本，却不一定增加控制感。当前方案是领域统一、入口分散：同一对象由统一 ID、scope、provenance 和生命周期串起来，未来再根据用户研究决定是否增加总览页。

## “开放”不等于每个框架都做成完整 Runtime

过去接新 Harness 太重，是因为“读取它的资产”和“让它完整接管聊天执行”混成了一件事。

L0/L1 先解决开放和迁移：

- 安全发现外部 Memory/Skill/MCP；
- dry-run；
- 带 provenance 导入；
- 冲突可见；
- 导出不覆盖、不删除源。

L2/L3 才解决执行：

- session、stream、tool、permission、artifact、interrupt；
- 真实能力缺失必须降级，不能靠 prompt 假装支持。

这样，一个新框架即使没有稳定 SDK，也可以先让用户带走资产。只有当执行价值和协议都足够明确时，才值得投入完整 Runtime。

## CodePilot 为什么仍然是 Full Reference

开放架构需要一个能验证“这套 canonical capability 真的可执行”的参照实现。CodePilot Runtime 最适合承担这个角色，因为它能同时控制产品 UI、工具、素材和创作链。

但 Full Reference 不能反过来成为锁定：

- stable capability 必须在 CodePilot 可执行；
- draft capability 可以先记录为 pending；
- 外部 Runtime 独有能力可以留在 overlay；
- canonical 文件必须使用中立 identity；
- CodePilot 私有绑定只留在 integration layer。

这使“最完整”变成可测试的 conformance，而不是营销口号或 canonical 演进的刹车。

## 素材库为什么属于 Harness Home

对创作用户而言，Memory 和 Skill 只是过程资产；图片、视频和网页结果才是最直观的长期资产。它们需要：

- 真实 producer breadcrumb；
- prompt、模型、Runtime、project 与 method；
- parent/derived lineage；
- 可检索标签；
- 可再次引用；
- 删除时知道是否还有消费者。

因此素材库不是独立于 Harness 的 Gallery，而是 Harness Home 中最先可见的一块 UI。网页也不能只是聊天里的临时 iframe；只有完成原子物化、hash、信任边界和静态预览后，才算用户真正拥有。

## Codex 重复图片暴露出的产品问题

同一张图片出现三份，并不只是“去重算法不够好”。它说明系统没有区分：

- 这是用户要长期拥有的生成结果；
- 这只是 Runtime 为了让用户看见而返回的预览；
- 这是同一结果的另一个路径/内容表示。

现在 generation 是 durable Asset，view 是 preview-only，并按路径和内容复用。这个区分也应该推广到未来的视频帧、网页截图和中间渲染：可见不等于值得归档，归档必须是明确的生命周期跃迁。

## 创作优势还差在哪里

工程底座已经能保存 Method、Taste evidence 和 creative project，也能把 Asset lineage 投影到三条 Runtime；但用户独特的审美还没有因此自动进入产品。

剩下的工作不能用更多 schema 或模型自评替代：

1. 选 3–5 个真实 brief；
2. 收集用户接受/拒绝的作品和原因；
3. 确认哪些判断是 CodePilot 产品规范，哪些是用户个人偏好；
4. 形成 Method v0 和反例；
5. 真实跑完 image → video / HTML；
6. 由用户判断方向差异、构图、字体、节奏和完成度。

在这些证据出现前，系统只能说“已经具备承载方法的能力”，不能说“已经拥有用户的美学”。

## 这轮对用户已经产生的变化

- Codex 生成图不再因为 preview event 重复进入素材库；
- 历史失败/外部/未物化行仍能看见和管理，不再成为“只有 ID、无法删除”的死记录；
- 网页卡片只播放静态缩略图，不持续运行网页；
- 搜索、标签、收藏、永久删除和详情滚动能覆盖所有注册 kind；
- 窗口变化时瀑布流增减列并填满余宽；
- 外部网页资源不会在截图时偷偷请求；
- Harness canonical 文件有自动中立边界，后续接新框架更不容易把产品私有概念写回用户数据。

## 成功标准

Harness Home 真正成立，不是因为代码里出现这个名字，而是用户能够：

- 换模型、换 Runtime，Memory/Skill/Asset 仍属于自己；
- 先轻量接入一个框架，不被迫完成整套 Runtime；
- 看见数据来源、冲突、降级与 Secret 状态；
- 从素材库继续创作，而不是在聊天记录里寻找临时结果；
- 把自己的设计选择沉淀为可查看、可修订、可撤销的方法证据。
