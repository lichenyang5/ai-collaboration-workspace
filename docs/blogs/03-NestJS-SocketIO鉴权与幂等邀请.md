# 第三篇：NestJS + Socket.IO 鉴权、用户房间与幂等邀请

> 本篇目标：读懂后端完整链路，理解连接如何鉴权、消息如何精确发给用户，以及并发邀请为什么不会重复通知。

[上一篇](./02-实时团队邀请架构与数据流.md) · [返回目录](./realtime-team-invitation-with-socketio.md) · [下一篇](./04-React实时通知与异步竞态处理.md)

## 1. 后端由四个角色组成

1. RealtimeAuthService 从握手 Cookie 中验证 JWT；
2. RealtimeGateway 管理连接、用户房间和 emit；
3. RealtimeNotifier 隔离业务服务与 Socket.IO API；
4. TeamsService 负责权限、成员写入、幂等和发布时机。

把这些职责拆开后，团队服务只需要表达“成员创建成功，请通知该用户”，无需知道房间字符串和 Socket.IO Server 类型。

## 2. Gateway 配置：先控制连接来源

~~~ts
const allowedOrigin = process.env.CORS_ORIGIN ?? 'http://localhost:5173';

@WebSocketGateway({
  allowRequest: (request, callback) => {
    callback(null, request.headers.origin === allowedOrigin);
  },
  cors: {
    origin: allowedOrigin,
    credentials: true,
  },
})
export class RealtimeGateway {}
~~~

allowRequest 在握手入口严格比较 Origin；cors 配置则为 Engine.IO 请求声明允许来源和凭据。两者都不是用户身份认证，只是连接来源边界。攻击者即使伪造 Origin，仍必须通过后面的 JWT 验证。

生产环境的 CORS_ORIGIN 必须与实际前端地址完全匹配，包括协议和端口。开发服务器残留、端口错误是“登录正常但 Socket 连接失败”的常见原因。

## 3. 握手阶段复用 HttpOnly Cookie

REST 登录成功后，API 写入 access_token Cookie。它是 HttpOnly，前端 JavaScript 不能读取，这是为了降低 XSS 直接窃取 Token 的风险。浏览器建立 WebSocket 时会按 Cookie 的 Domain、Path、SameSite、Secure 规则决定是否携带。

Gateway 在 namespace middleware 中认证：

~~~ts
afterInit(server: RealtimeServer): void {
  server.use(async (client, next) => {
    try {
      client.data.user = await this.auth.authenticate(
        client.handshake.headers.cookie,
      );
      next();
    } catch {
      next(new Error('Unauthorized'));
    }
  });
}
~~~

这段代码有三个关键点：

- 信任的是握手 Cookie 里验证成功的 JWT，不是客户端自报的 userId；
- 用户信息写入 client.data，只属于这条服务端连接；
- 认证失败调用 next(error)，连接不能进入业务房间。

## 4. 一个用户一个私有 room

~~~ts
async handleConnection(client: AuthenticatedSocket): Promise<void> {
  await client.join(`user:${client.data.user.id}`);
}

emitToUser(userId: string, event: string, payload: unknown): void {
  this.server.to(`user:${userId}`).emit(event, payload);
}
~~~

房间名来自服务端已认证用户。Alice 不能在客户端提交 bobId 就加入 Bob 的房间。同一用户在电脑和手机同时登录时，两条连接都会加入相同 room，因此两端都能收到通知。

当前是单 API 进程。若部署多个实例，每个实例只有自己的连接和内存 room；需要 Socket.IO Redis Adapter 等组件把广播扩展到其他实例。

## 5. 用类型定义事件契约

~~~ts
export const TEAM_MEMBERSHIP_CREATED = 'team.membership.created' as const;

export interface TeamMembershipCreatedEvent {
  eventId: string;
  teamId: string;
  teamName: string;
  role: 'member';
  occurredAt: string;
}
~~~

服务端与前端保存相同结构。事件名常量避免拼写漂移，接口则让字段变化在编译期暴露。真实大型项目可把契约抽到共享 package，当前仓库规模较小，因此两端各自定义并由测试锁定。

## 6. Notifier 为什么值得单独一层

~~~ts
notifyTeamMembershipCreated(
  userId: string,
  payload: TeamMembershipCreatedEvent,
): void {
  try {
    this.gateway.emitToUser(userId, TEAM_MEMBERSHIP_CREATED, payload);
  } catch {
    this.logger.error(
      `Failed to emit ${TEAM_MEMBERSHIP_CREATED} to user ${userId}`,
    );
  }
}
~~~

团队服务只依赖 RealtimeNotifier，单元测试可直接 mock 它。try/catch 只能捕获 emitToUser 同步抛出的异常；向空房间广播、用户离线或网络途中丢失，通常不会让 emit 抛错。当前没有 ACK，因此代码没有声称“已送达”。

通知失败不会回滚成员关系。邀请是主业务，实时提醒是 best-effort 增强。

## 7. TeamsService：保存后才能发布

邀请流程依次执行：验证操作者属于团队并有权限；按邮箱查询目标用户；查询是否已有成员；创建并保存关系；构造事件；调用 Notifier；返回成员摘要。

核心顺序可以抽象为：

~~~ts
const membership = membershipRepository.create({ team, user, role: 'member' });
const savedMembership = await membershipRepository.save(membership);

realtimeNotifier.notifyTeamMembershipCreated(user.id, {
  eventId: savedMembership.id,
  teamId: team.id,
  teamName: team.name,
  role: 'member',
  occurredAt: savedMembership.createdAt.toISOString(),
});

return toMemberSummary(savedMembership);
~~~

实际字段以仓库代码为准，这里强调的是控制流：save 成功之前绝不能发布 created。

## 8. 为什么“先查询不存在”仍会重复

两次并发请求可能同时完成查询：

~~~mermaid
sequenceDiagram
    participant A as 请求 A
    participant B as 请求 B
    participant DB as PostgreSQL
    A->>DB: 查询成员：不存在
    B->>DB: 查询成员：不存在
    A->>DB: INSERT 成功
    B->>DB: INSERT 冲突 23505
~~~

所以应用层查询只能优化正常路径，数据库唯一约束才是最终防线。PostgreSQL 唯一约束冲突码是 23505。服务捕获这一特定错误后重新查询已存在成员并返回；不能把任意数据库异常都伪装成“已是成员”。

结果是：

- 获胜请求保存新关系并发布一次事件；
- 冲突请求恢复出同一成员摘要，但不再发布 created；
- 网络或数据库其他错误原样抛出，便于正确报警。

## 9. ACK、Outbox 与当前边界

如果加入 Socket.IO ACK，服务端能知道某个客户端是否在超时前回调，但 ACK 仍不等于业务永久处理成功。若要求数据库和通知严格一致，可采用 Transactional Outbox：同一事务写成员与 outbox 记录，后台投递器重试消息，再由消费者去重。

当前项目选择 save 后 best-effort emit，再由 REST 回源。它适合实时邀请 Demo，也诚实保留了未来升级边界。

## 10. 本篇检查清单

- Origin 只允许配置的前端地址；
- 握手身份来自 HttpOnly Cookie + JWT；
- 认证成功后才加入 user room；
- 客户端不能指定自己加入哪个用户房间；
- 新成员保存成功后才发布；
- 已有成员和 23505 恢复不重复发布；
- 普通数据库异常不被吞掉；
- emit 失败不回滚已经提交的成员关系。

## 11. 本篇小结

后端的可靠性来自多层边界：Origin 限制来源，JWT 确认身份，room 精确路由，数据库唯一约束保证成员幂等，Notifier 则把实时层失败与主业务隔离。

[下一篇：React 实时通知与异步竞态处理](./04-React实时通知与异步竞态处理.md)
