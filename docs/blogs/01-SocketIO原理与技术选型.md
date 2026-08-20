# 第一篇：Socket.IO 原理与技术选型

> 本篇目标：从零理解 HTTP、WebSocket 与 Socket.IO 的关系，并能够说明一个业务为什么选择或不选择 Socket.IO。

[返回系列目录](./realtime-team-invitation-with-socketio.md) · [下一篇：实时团队邀请的架构与数据流](./02-实时团队邀请架构与数据流.md)

## 1. HTTP 为什么不能主动通知另一个浏览器

浏览器调用 REST 接口时，通信通常由浏览器发起：浏览器请求团队列表，服务器返回当前快照，一次交互结束。HTTP 适合查询和修改数据，因为输入、响应与状态码都很清楚。但 Alice 发起邀请后，Bob 没有发请求，服务器无法通过已经结束的 Bob HTTP 响应通知他。

最简单的补救是轮询：Bob 每隔几秒 GET /api/teams。它兼容性好，却会产生空请求；实时性也被间隔限制。1 秒轮询及时但浪费，30 秒轮询节省却迟钝。

## 2. WebSocket 到底改变了什么

WebSocket 建立一条可长期存在、双方都能主动发送消息的连接。开始时仍通过 HTTP Upgrade 握手，服务端接受后返回 101 Switching Protocols，随后双方交换 WebSocket 帧。

~~~mermaid
sequenceDiagram
    participant B as 浏览器
    participant S as 服务器
    B->>S: HTTP Upgrade 握手
    S-->>B: 101 Switching Protocols
    S-->>B: 团队邀请事件
    B->>S: 心跳或业务事件
~~~

“长连接”不等于永不掉线。网络切换、休眠、代理超时和服务器重启都会断开，所以真实系统必须考虑心跳、断线检测与重连。

## 3. Socket.IO 不是 WebSocket 的别名

Socket.IO 是建立在 Engine.IO 之上的实时通信库和协议。它可以使用 WebSocket 传输，还提供事件名、自动重连、心跳、room、namespace、ACK 和广播等能力。

~~~ts
// 原生 WebSocket 客户端
const socket = new WebSocket('ws://localhost:3001');

// Socket.IO 客户端
const socket = io('http://localhost:3001');
~~~

两者不能直接互连，因为 Socket.IO 有自己的握手和数据包协议。

## 4. transport、event 与 room

本项目客户端配置如下：

~~~ts
io(apiBaseUrl, {
  withCredentials: true,
  transports: ['websocket'],
});
~~~

- transport 表示底层怎样运输数据。这里只允许 WebSocket，并不代表绕开 Socket.IO 协议；
- event 表示消息的语义名称。本项目是 team.membership.created；
- room 表示服务端把哪些连接分成一组。本项目每个用户加入 user:{userId}。

同一账号开两个标签页时，它们是两条连接，但可以都加入同一个用户房间。Room 不是数据库表，也不是权限来源；必须先在服务端鉴权，再由服务端决定加入哪个房间。

## 5. 一条 Socket.IO 连接是怎样工作的

理解生命周期后，DevTools 中的现象就不再神秘：

1. 客户端根据 URL 和 transport 发起 Engine.IO 握手；
2. 服务端生成连接会话，并协商心跳间隔等参数；
3. Socket.IO 在 Engine.IO 连接上建立 namespace 会话；
4. NestJS 中间件验证 Cookie/JWT；
5. 认证通过后触发 connection，服务端把连接加入用户 room；
6. 双方按事件名交换 Socket.IO packet；
7. 心跳失败或网络异常触发 disconnect；
8. 客户端按退避策略重连，成功后得到一条新连接。

~~~mermaid
stateDiagram-v2
    [*] --> Handshake: io()
    Handshake --> Authenticated: Origin 与 JWT 通过
    Handshake --> Disconnected: 拒绝或超时
    Authenticated --> JoinedRoom: connection + join
    JoinedRoom --> JoinedRoom: event / heartbeat
    JoinedRoom --> Disconnected: 网络或服务中断
    Disconnected --> Handshake: 自动重连
~~~

重连得到的新 socket.id 与旧连接不同，所以不能把 socket.id 当用户永久身份。用户身份来自 JWT，user:{userId} room 才是业务寻址方式。

### 5.1 emit 是“按事件名写包”

~~~ts
socket.emit('team.membership.created', payload);
~~~

这行代码不会调用同名 TypeScript 函数。Socket.IO 会把事件名和 payload 编码成协议数据包，接收端只有注册相同事件名的监听器才会处理。事件字段仍需两端约定，Socket.IO 不会替你验证业务 Schema。

### 5.2 ACK 能解决什么，不能解决什么

Socket.IO 支持接收方回调 ACK。它可以回答“某个连接是否在超时前回调”，适合需要请求式确认的事件；但浏览器 ACK 后仍可能在业务持久化前崩溃，所以 ACK 不是数据库事务，也不是消息队列的持久消费确认。

本项目的邀请通知没有 ACK，采用 best-effort 发送和 REST 补偿。这个选择不是遗漏，而是与作品 Demo 的可靠性目标匹配。

## 6. 四种方案怎么选

| 方案 | 方向 | 优点 | 代价 | 适用 |
| --- | --- | --- | --- | --- |
| 轮询 | 客户端反复请求 | 简单、沿用 REST | 空请求多，延迟取决于间隔 | 低频、延迟不敏感 |
| SSE | 服务端到客户端 | 浏览器原生支持、文本流简单 | 主要单向 | 日志、生成进度、资讯 |
| 原生 WebSocket | 双向 | 开销低、完全自定义 | 重连、房间、协议自己做 | 专用协议、极致控制 |
| Socket.IO | 双向 | 事件、重连、房间成熟 | 有额外协议、两端需配套 | 协作、通知、聊天、看板 |

邀请通知使用 SSE 也能完成，但项目可能扩展任务协作和在线状态，NestJS 又有成熟的 Socket.IO 集成，因此选择 Socket.IO 能减少连接管理代码。

## 7. Socket.IO 不会自动保证业务正确

它只解决实时通道，不会自动解决权限、写库与发消息的顺序、重复邀请、离线补偿、旧事件覆盖新页面、多实例共享房间等问题。只写一个 socket.emit，演示可能成功，系统却没有闭环。

## 8. 三个常见误区

### 误区一：连接成功等于消息可靠送达

不等于。没有 ACK 时，服务端通常不知道浏览器是否真正收到并处理事件。

### 误区二：withCredentials 能强迫 WebSocket 携带 Cookie

不能。浏览器 WebSocket 握手是否带 Cookie 由 Domain、Path、SameSite、Secure 等规则决定。withCredentials 对 polling/XHR 等凭据请求有明确影响，但不能绕过 Cookie 安全策略。

### 误区三：事件 payload 就是最终数据库状态

Socket.IO 会保持已送达 packet 的顺序，但连接中断时消息仍可能漏失，payload 也不一定是完整页面快照。更稳妥的方式是把事件当“数据已变化”的提醒，再用 REST 获取权威状态。eventId 去重是防御性保护；如果未来加入重试、Outbox 或多个消息来源，它还能避免同一业务事件被重复展示。

## 9. 本篇小结

HTTP 擅长明确的请求响应，WebSocket 提供双向长连接，Socket.IO 则在实时传输上增加事件、重连、房间等工程能力。下一篇先设计业务数据流，再开始写 Gateway。

[下一篇：实时团队邀请的架构与数据流](./02-实时团队邀请架构与数据流.md)
