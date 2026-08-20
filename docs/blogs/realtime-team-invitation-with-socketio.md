# React + NestJS 实时团队邀请：Socket.IO 实战系列

这是一套从通信原理讲到真实项目落地的中文系列文章。它不是把代码逐行翻译一遍，而是回答三个更重要的问题：为什么需要实时通信、为什么这样设计、遇到并发和断线时怎样保证最终正确。

系列代码来自 [ai-collaboration-workspace](https://github.com/lichenyang5/ai-collaboration-workspace)。项目使用 React、NestJS、PostgreSQL 与 Socket.IO，实现团队邀请的实时通知与团队列表自动同步逻辑。

## 适合谁阅读

- 会写基本的 HTTP 接口，但还没有系统理解 WebSocket；
- 知道 Socket.IO 的名字，却不清楚它和原生 WebSocket 的区别；
- 想学习 NestJS Gateway、Cookie/JWT 握手鉴权和用户房间；
- 想理解 React 实时状态、HTTP 请求响应乱序、路由切换和 ABA 竞态；
- 需要一套可以用于项目复盘、博客发布和面试表达的完整案例。

## 推荐阅读顺序

1. [Socket.IO 原理与技术选型](./01-SocketIO原理与技术选型.md)：HTTP、WebSocket、Socket.IO、transport、事件、房间与选型。
2. [实时团队邀请的架构与数据流](./02-实时团队邀请架构与数据流.md)：Alice 邀请 Bob 的完整链路，以及“消息是提醒，REST 才是账本”。
3. [NestJS + Socket.IO：鉴权、用户房间与幂等邀请](./03-NestJS-SocketIO鉴权与幂等邀请.md)：Gateway、Cookie/JWT、保存后发布和 PostgreSQL 23505。
4. [React 实时通知与异步竞态处理](./04-React实时通知与异步竞态处理.md)：Provider、事件去重、REST 回源、路由与用户 ABA。
5. [测试、双浏览器验证与故障排查](./05-测试双浏览器验证与故障排查.md)：分层测试、真实握手、手工验证、排查与面试表达。

## 一张图看懂全系列

~~~mermaid
flowchart LR
    A[通信原理] --> B[业务架构]
    B --> C[后端实现]
    C --> D[前端实现]
    D --> E[验证与排错]
~~~

如果你完全没有 WebSocket 基础，请从第一篇顺序阅读。如果你已经理解 Socket.IO，可以从第二篇开始，但仍建议先记住两个边界：实时消息不是数据库，连接成功也不等于消息一定送达。

## 按当前实现预期的主链路

1. Alice 和 Bob 分别在两个浏览器登录不同账号；
2. Alice 把 Bob 邀请进团队；
3. API 先把成员关系写入 PostgreSQL；
4. 服务端向 Bob 的私有房间发布 team.membership.created；
5. 在线且连接正常的 Bob 应立即看到通知；
6. Bob 的页面应重新请求团队列表，使用数据库快照更新界面；
7. 即使 Bob 当时离线，重新登录或重连后也能通过 REST 看到真实成员关系。

这套设计追求的不是“消息永不丢”，而是“实时体验足够快，业务事实最终一定正确”。

自动化测试已经覆盖对应的服务端和前端逻辑，但真实 Cookie、端口、浏览器 Network 与双账号可见效果仍需按第五篇步骤手工验证；本系列不把尚未执行的人工验收写成已观察结果。
