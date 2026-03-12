# 移动端远程控制整体方案报告

> 创建时间：2026-03-12
> 适用范围：CodePilot 桌面端 + Android Companion + 多设备控制

## 一、结论

CodePilot 的移动端方向应定义为：

- 桌面端继续作为 `Host`，负责真实执行、文件系统访问、Claude CLI 登录态、Provider 凭证、本地数据库和运行中的 session。
- 手机端、平板端、其他桌面端作为 `Controller`，负责查看会话、发送消息、审批权限、切换控制权、查看产物与结果摘要。
- 第一阶段不做“手机独立执行端”，也不做“运行中 session 跨 Host 迁移”。

这不是重写桌面产品，而是在现有桌面产品旁边增加一层安全的远程控制基础设施。

## 二、背景与目标

### 目标

- 让手机端实时查看桌面端所有聊天和流式输出。
- 让手机端远程执行 Chat 相关控制：发消息、补图片/语音、停止任务、审批权限、切换模式、空闲时切换工作目录。
- 让用户在一个移动端中管理多个 CodePilot Host。
- 保持桌面端当前本地体验不受影响。

### 非目标

- 不在第一阶段做完整文件树编辑器。
- 不在第一阶段做完整桌面 UI 的移动端复刻。
- 不在第一阶段做运行中 session 的跨 Host 迁移。
- 不把手机端作为 Claude Agent SDK 的直接执行环境。

## 三、现状与可复用资产

当前仓库已经具备移动端方案所需的大部分底层能力：

- 聊天主链路已经存在：`src/app/api/chat/route.ts`
- 会话读写已经存在：`src/app/api/chat/sessions/[id]/route.ts`
- 权限审批已独立：`src/app/api/chat/permission/route.ts`
- 文件预览与结果查看已有基础：`src/app/api/files/preview/route.ts`、`src/app/api/files/raw/route.ts`
- 前端本来就支持切换会话后继续观察流：`src/lib/stream-session-manager.ts`
- 服务端已经按 session 做互斥发送，避免同一会话并发提交：`src/app/api/chat/route.ts`

当前最大的约束不是 Chat 能力本身，而是：

- 桌面端服务目前只监听本地 `127.0.0.1`
- API 默认是“本地可信 UI”模型
- 还没有“远程设备身份、控制权 lease、Host 注册、跨设备事件分发”这些基础设施

## 四、核心架构

### 4.1 角色模型

定义四个核心对象：

- `Host`
  一台运行 CodePilot 的执行主机。持有本地工作目录、数据库、Claude CLI、Provider 凭证、活跃 session。
- `Controller`
  一个远程控制端，可以是 Android App，也可以是另一台桌面设备。
- `Session`
  属于某个 Host 的对话单元。Session ID 在 Host 作用域内唯一。
- `Lease`
  某个 Controller 对某个 Session 的临时写控制权。

### 4.2 设计原则

- 多端可读：多个 Controller 可同时查看同一 Host 的会话与流。
- 单会话单写：同一 Session 的写操作一次只允许一个 Controller 持有控制权。
- Host 是权威源：消息、状态、权限、文件产物都以 Host 本地状态为准。
- 本地优先：远程控制层故障时，不影响桌面本地使用。

### 4.3 读写边界

允许多端并行的操作：

- 查看会话列表
- 查看消息历史
- 订阅流式输出
- 查看结果产物
- 查看等待审批项

需要 lease 的操作：

- 发送消息
- 中止运行
- 切换 mode / model
- 审批权限
- 修改工作目录
- 执行对会话状态有副作用的动作

## 五、控制模型

### 5.1 多读者、单写者

推荐采用 `multi-reader / single-writer per session` 模型：

- 所有设备都可观察一个 Session
- 持有 lease 的设备可以写
- 未持有 lease 的设备只能读，或发起 `take over`

### 5.2 Take Over

`take over` 必须是显式动作，不允许静默抢占。

典型流程：

1. Controller A 正在控制 Session X
2. Controller B 打开 Session X，默认只读观察
3. Controller B 点击“接管”
4. Host 撤销 A 的 lease，授予 B 新 lease
5. A 收到“已被接管”事件，UI 切换成只读

### 5.3 运行态保护

运行中的 Session 不应允许执行高风险状态变更。

推荐规则：

- 运行中允许：观察、审批、停止任务、追加用户消息（若当前协议允许）
- 运行中禁止：切工作目录、清空消息、重绑 Host
- 若用户想改工作目录，推荐“在新目录创建新会话”

## 六、产品能力范围

### 6.1 Android Companion 范围

移动端聚焦 Chat 控制面，不承担桌面复杂展示。

首要功能：

- Host 列表
- Session 列表
- 流式消息查看
- 发送文本、图片、语音
- 任务停止与重试
- 权限审批
- 结果产物速览
- 工作目录选择与“新会话到此目录”
- 会话控制权接管

### 6.2 产物速览

移动端不建议做通用文件树浏览器，而建议做 `Artifacts / 本轮产出` 视图。

重点展示：

- 本轮生成的图片、视频、音频、Markdown、PDF 等产物
- 本轮变更过的文件
- 结果摘要：这次做了什么、成功了什么、失败了什么、下一步需要用户做什么

### 6.3 多 Host 管理

一个 Controller 应能管理多个 Host，例如：

- 办公室电脑
- 家里电脑
- 云主机上的 CodePilot

移动端首页应优先展示：

- Host 在线状态
- 活跃会话数
- 待审批数
- 最近一次运行状态

## 七、桌面端改动边界

### 7.1 需要新增的部分

建议新增独立的远程层，而不是重写现有本地聊天层。

新增模块建议：

- `src/lib/remote/`
  设备、配对、lease、Host 状态、事件分发
- `src/app/api/remote/`
  远程专用入口
- 设备管理与 Host 管理 UI
- 少量桌面端状态提示 UI，例如“该 Session 正被远程设备控制”

### 7.2 尽量不改的部分

为了降低回归风险，以下主链路应尽量保持原样：

- 现有本地桌面聊天入口
- 现有本地流式消费方式
- 现有权限解析与等待机制
- 现有文件预览能力的本地使用路径

### 7.3 必须坚持的兼容性原则

定义一个强约束：

- `remote disabled = current desktop behavior unchanged`

这条原则必须贯穿整个实现、测试和发布流程。

## 八、工程组织建议

### 8.1 仓库组织

不建议拆成两个仓库。建议继续使用同仓 monorepo，按应用和共享包拆分。

推荐结构：

- 根目录现有桌面端保留
- `apps/mobile`
  Android Companion
- `packages/remote-contract`
  共享类型、协议、事件 schema
- `packages/remote-client`
  Controller 调用 Host 的 SDK

### 8.2 为什么不分仓

对于当前“主要由 AI 协作生成”的开发方式，同仓库更有利：

- 上下文集中，减少 AI 丢上下文
- 协议、类型、事件定义不会在两个 repo 漂移
- 共享测试更容易搭建
- 权限控制可以通过目录和模块边界完成，不必靠仓库硬拆

## 九、安全与权限模型

### 9.1 设备身份

需要引入 Controller 设备身份：

- 设备 ID
- 设备名称
- 配对时间
- 最后活跃时间
- 可撤销状态

### 9.2 配对方式

推荐第一阶段采用：

- 桌面端生成一次性配对码或二维码
- 手机端扫码完成绑定
- 绑定后保存设备级身份

### 9.3 控制权限分级

远程设备应至少支持以下权限等级：

- 只读
- 可聊天
- 可审批
- 完全控制

高风险操作建议启用：

- 生物识别确认
- 二次确认
- 设备审计日志

## 十、数据模型建议

建议新增以下远程控制相关对象：

- `hosts`
- `paired_devices`
- `controller_sessions`
- `session_leases`
- `remote_audit_logs`
- `host_presence`

其中：

- `session_leases` 用于表达某个 Session 当前由谁控制
- `host_presence` 用于表达 Host 在线状态与最后心跳
- `remote_audit_logs` 用于记录设备侧写操作与审批操作

## 十一、接口分层建议

### 11.1 远程专用 API

建议新增远程专用接口，而不是直接暴露现有本地 API。

原因：

- 现有 API 假设调用方是本地可信桌面 UI
- 远程控制需要设备鉴权
- 远程控制需要 lease 检查
- 远程控制需要更严格的作用域校验

### 11.2 远程接口能力

远程接口至少应覆盖：

- Host 列表与详情
- Session 列表与详情
- 消息历史
- 流式事件订阅
- 会话控制权获取 / 释放 / 接管
- 发送消息
- 停止任务
- 审批权限
- 产物与结果摘要

## 十二、阶段化落地方案

### Phase 0：架构准备

- 明确 Host / Controller / Lease 模型
- 抽出共享协议包
- 设计远程专用 API
- 建立 feature flag

### Phase 1：单 Host + 单移动端

- Android App 基础骨架
- Host 配对
- Session 列表
- 流式查看
- 远程发消息
- 权限审批

### Phase 2：结果与目录控制

- 产物速览
- 结果 summary
- 工作目录选择
- 在目标目录新建会话

### Phase 3：单 Host + 多 Controller

- Session lease
- Take over
- 控制权冲突提示
- 桌面端“远程控制中”状态指示

### Phase 4：多 Host

- Host 注册与在线状态
- 一个移动端控制多个 Host
- 全局待审批与全局运行状态看板

## 十三、明确不做的事情

在本方案中，以下内容不进入第一阶段：

- 运行中 Session 跨 Host 迁移
- 移动端完整复刻桌面复杂 UI
- 把手机端做成执行端
- 为远程功能重写桌面本地 Chat 主链路

## 十四、主要风险与控制策略

### 风险一：破坏当前桌面端行为

控制策略：

- 本地桌面入口保持原样
- 远程能力走新模块
- feature flag 默认关闭
- 保持 `remote disabled` 与当前行为一致

### 风险二：同一 Session 多端并发写入

控制策略：

- 按 Session 发放 lease
- 所有写操作必须验证 lease
- Take over 显式化

### 风险三：文件与权限边界失控

控制策略：

- 不直接暴露本地 API
- 引入远程专用鉴权与作用域检查
- 审批与高风险操作增加二次确认

### 风险四：AI 协作导致代码改动发散

控制策略：

- 同仓分应用、分包、分目录
- 定义“尽量不动”的旧主链路边界
- 用 feature flag 分阶段打开

## 十五、推荐决策

建议当前就确认以下决策：

- 采用 Host / Controller 架构
- 采用 `multi-reader / single-writer per session`
- 同仓 monorepo，不分仓库
- 新增远程层，不重写当前本地桌面层
- 第一阶段只做单 Host + 单移动端

## 十六、下一步建议

如果确认推进，下一份文档应进入执行层面，建议输出：

- 信息架构与主要页面草图
- 共享协议与事件清单
- 桌面端改动边界清单
- API 清单
- Phase 0 / Phase 1 执行计划
