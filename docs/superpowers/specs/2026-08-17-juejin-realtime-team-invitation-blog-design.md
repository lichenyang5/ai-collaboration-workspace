# 掘金博客《从团队邀请到实时协作》写作设计

## 目标

基于 `ai-collaboration-workspace` 已落地的实时团队邀请功能，产出一篇可以直接发布到掘金的中文 Markdown 实战文章。文章面向不了解该功能实现细节的项目作者，也兼顾希望学习 React、NestJS、Socket.IO 和全栈实时通信的初中级开发者。

读者完成阅读后，应能独立说明：

- REST 邀请为什么不能自动更新另一个浏览器；
- 为什么选择 Socket.IO，以及为什么仍以 REST API 为数据权威来源；
- 邀请请求、数据库写入、定向事件、前端通知和团队列表同步的完整链路；
- Cookie/JWT 握手鉴权、Origin 校验和用户房间如何配合；
- 重复邀请、断线重连、用户切换和异步竞态如何处理；
- 如何通过自动化测试和双浏览器操作验证功能。

## 文章定位

采用“问题驱动 + 完整调用链拆解”的实战复盘，而不是 API 百科或大段源码搬运。

文章从邀请按钮和跨浏览器状态不同步的真实需求切入，逐层解释基础概念、架构选择、后端实现、前端实现、安全设计、竞态修复、测试验证和面试表达。核心叙事是：实时消息只通知变化，REST 仍负责重新获取权威数据。

## 章节结构

1. 项目背景与原始问题
2. HTTP、WebSocket 与 Socket.IO 基础
3. 轮询、SSE、WebSocket 方案比较
4. REST 为准、Socket.IO 通知的总体架构
5. Alice 邀请 Bob 的端到端时序
6. NestJS 实时网关、Cookie/JWT 鉴权与用户房间
7. 团队邀请成功后的事件发布与幂等语义
8. React `RealtimeProvider`、通知队列和团队列表重新同步
9. 用户切换、连接失败、断线重连和请求竞态
10. Origin、Cookie 和 WebSocket transport 安全边界
11. 单元测试、真实握手测试、页面测试与双浏览器验证
12. 常见故障排查
13. 一分钟与三分钟面试表达
14. 总结与 GitHub 项目地址

## 内容深度

- 预计 8,000 至 12,000 字。
- 不假定读者已经理解 WebSocket 或 Socket.IO。
- 每个关键模块先解释“为什么”，再展示经过裁剪的真实代码，最后解释运行结果。
- 代码片段必须与当前 `main` 实现一致，不虚构接口、事件、环境变量或测试结果。
- 关键事件使用 `team.membership.created`，用户房间使用 `user:{userId}`。
- 明确说明通知是瞬时的：离线用户可能没有 toast，但重新登录或 REST 刷新仍能看到团队。
- 明确说明当前功能只覆盖团队邀请，不扩展到项目邀请、任务广播或聊天。

## 插图与表达

文章至少包含两个 Mermaid 图：

- REST 与 Socket.IO 的职责边界图；
- Alice 邀请 Bob 的端到端时序图。

使用小节、表格、编号步骤和短代码块提高可读性。避免营销式表述，保留真实限制和人工验证边界。

## 事实来源

正文以以下当前仓库文件为依据：

- `README.md`
- `apps/api/src/realtime/`
- `apps/api/src/teams/teams.service.ts`
- `apps/web/src/realtime/`
- `apps/web/src/pages/WorkspacePage.tsx`
- `apps/web/src/pages/ProjectListPage.tsx`
- 对应的 Jest、Vitest 与 Socket.IO 集成测试

## 输出与验收

最终文件保存为：

`docs/blogs/realtime-team-invitation-with-socketio.md`

交付前检查：

- 无未完成标记、虚构截图或占位内容；
- 标题、摘要、标签建议和项目链接可直接用于掘金；
- Mermaid 与代码围栏闭合；
- 代码、路径、事件名和验证数据与仓库一致；
- 解释覆盖正常流程、重复邀请、离线、重连、失败和安全边界；
- 文章末尾提供可执行的双浏览器验证步骤和面试表达模板。
