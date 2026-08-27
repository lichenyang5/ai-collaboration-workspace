# 从「房间」到「实时通知」：用 NestJS + Socket.IO 实现团队邀请的完整工程实践

> 前言：你是否也听过 Socket.IO「房间」这个概念，但始终停留在「好像是用来群发消息」的模糊印象里？本文从一个真实的团队邀请场景出发，带你走完 JWT 鉴权 → 私有房间创建 → 数据库事务 → 定向通知 → 前端事件去重的完整链路。核心代码不到 300 行，却覆盖了鉴权边界、幂等设计、断线重连、异步竞态等工程细节。

## 一、先搞懂「房间」：不是聊天室，是个收件箱 📬

Socket.IO 里的「Room」（房间）是最容易被名字误导的概念。很多人一看到「房间」就想到聊天室里一群人聊天的画面，但实际上，它只是服务端内存里的一个 **「Socket 连接分组标签」**。

我喜欢用「收件箱」来类比：

- 每个用户登录后，服务端给他创建一个专属「收件箱」，名字叫 `user:${userId}`
- 用户每开一个浏览器标签页，就建立一条 Socket 连接，这条连接会被「投递」进这个收件箱
- 当你想给某人发通知时，不需要关心他开了几个标签页、用的是电脑还是手机——你只需要往「收件箱：user:xxx」里塞一封信，所有连接都会同时收到

```text
收件箱 user:bob-uuid-123  ──┬── 连接①（Chrome 普通窗口）
                            ├── 连接②（Chrome 无痕窗口）
                            └── 连接③（手机浏览器）

服务端：to('user:bob-uuid-123').emit('xxx', payload)
        → 三个连接同时收到！
```

**房间的本质：服务端维护的一个 `Map<roomName, Set<SocketId>>`，纯内存结构。** 没有数据库、没有持久化、连接断开就自动移除。

---

## 二、整体架构：Socket.IO 不是数据源，是「门铃」🔔

在正式写代码之前，必须先定一个原则：

> **REST API + 数据库是权威事实来源，Socket.IO 只是低延迟的「门铃提醒」。**

为什么？因为 Socket.IO 连接随时可能断、消息随时可能丢。如果你把实时通道当作数据来源，一旦断线再恢复，用户的数据就「对不上了」。

我们的团队邀请架构是这样的：

```text
Alice（邀请者）                    Bob（被邀请者）
    │                                 │
    │ ① POST /teams/:id/members       │
    │───────────────────────────► API │
    │                                 │
    │                         ┌───────▼───────┐
    │                         │ ② 写入 team_members
    │                         │    数据库成功！
    │                         └───────┬───────┘
    │                                 │ ③ 往 Bob 的私有房间
    │                                 │    发通知（尽力而为）
    │                        ┌────────▼────────┐
    │                        │   Socket.IO     │
    │                        │  Room: user:bob │
    │                        └────────┬────────┘
    │                                 │ ④ 推送 team.membership.created
    │◄──────── 200 成功               │──────────────────► Bob
    │                                 │
    │                                 │ ⑤ 收到通知后，
    │                                 │    再调 GET /api/teams
    │                                 │    拉取权威团队列表 ← ✨ 关键！
```

**亮点：第 ⑤ 步。** 即使 Socket.IO 通知丢了，刷新页面后 Bob 依然能在 `GET /api/teams` 里看到新团队。通知只是「省了一次手动刷新」。

---

## 三、后端第一步：Cookie 里的 JWT 是房间号的唯一来源 🔑

用户登录时，我们签发 JWT 并写入 HttpOnly Cookie。JWT 的 payload 里存了 `sub`（用户 ID）和 `email`：

```typescript
// apps/api/src/auth/auth.service.ts L79-L90
private async createAuthenticationResult(user: User): Promise<AuthenticationResult> {
  const publicUser: PublicUser = {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
  };
  const accessToken = await this.jwtService.signAsync({
    sub: publicUser.id,   // ✅ 这个 sub 就是房间号的来源
    email: publicUser.email,
  });

  return { user: publicUser, accessToken };
}
```

**关键点：Cookie 是 HttpOnly 的。** 前端 JS 根本读不到 Token，WebSocket 握手时浏览器会自动携带 Cookie 发送。这意味着：

- ✅ XSS 攻击无法直接窃取 Token
- ✅ 客户端**无法伪造**自己要加入哪个用户的房间——必须先过 JWT 验证这关

### 3.1 鉴权中间件：连接建立前的「安检门」

Socket.IO 提供了 namespace middleware，我们在这里做鉴权。鉴权失败直接拒绝，连接根本进不来：

```typescript
// apps/api/src/realtime/realtime.gateway.ts L50-L61
afterInit(server: RealtimeServer): void {
  server.use(async (client, next) => {
    try {
      // 从握手请求的 Cookie 头里取出 access_token 并验证 JWT
      client.data.user = await this.auth.authenticate(
        client.handshake.headers.cookie,
      );
      next();  // ✅ 鉴权通过，继续建立连接
    } catch {
      next(new Error('Unauthorized'));  // ❌ 拒绝连接
    }
  });
}
```

`RealtimeAuthService` 的实现很直白——解析 Cookie → 取 Token → JWT 验签 → 返回用户信息：

```typescript
// apps/api/src/realtime/realtime-auth.service.ts L15-L31
async authenticate(cookieHeader: string | undefined): Promise<CurrentUserPayload> {
  const token = parse(cookieHeader ?? '').access_token;
  if (!token) {
    throw new UnauthorizedException('请先登录');
  }

  try {
    const payload = await this.jwtService.verifyAsync<JwtPayload>(token);
    if (!payload.sub || !payload.email) {
      throw new Error('invalid payload');
    }
    // JWT payload 里的 sub 就是用户 ID，也是后面房间号的来源
    return { id: payload.sub, email: payload.email };
  } catch {
    throw new UnauthorizedException('登录状态已失效');
  }
}
```

鉴权成功后，用户信息被写入 `client.data.user`——**这是服务端独享的数据，客户端改不了。**

---

## 四、后端第二步：创建私有房间，一行代码的艺术 🎯

鉴权通过后，`handleConnection` 会被触发。这里就是「创建收件箱」的时刻：

```typescript
// apps/api/src/realtime/realtime.gateway.ts L63-L69
async handleConnection(client: AuthenticatedSocket): Promise<void> {
  // 把这条连接加入「用户 ID 命名的私有房间」
  await client.join(`user:${client.data.user.id}`);
}

emitToUser(userId: string, event: string, payload: unknown): void {
  // 往指定用户的房间广播。房间里有几条连接，
  // 就有几个客户端收到通知
  this.server.to(`user:${userId}`).emit(event, payload);
}
```

就这么简单！两行核心代码完成了房间机制。

### 4.1 为什么房间号一定是服务端生成？

如果房间号是客户端传过来的，比如 `socket.emit('join-room', 'user:bob')`，那 Alice 只要把 `bob` 换成自己的 ID，就能监听 Bob 的通知——安全漏洞。

**必须坚持：房间号 = 服务端从 JWT 解析出来的用户 ID，客户端完全不参与命名。**

### 4.2 多标签页和多设备是怎么工作的？

假设 Bob 开了两个浏览器标签页，每个标签页都会建立一条独立的 Socket 连接。两条连接鉴权后都执行 `client.join('user:bob-uuid')`，于是：

```text
房间 user:bob-uuid 里有 2 个 Socket
  → server.to('user:bob-uuid').emit(...) 会同时发给两条连接
  → 两个标签页同时弹出通知 ✨
```

完美支持多端同步。

---

## 五、后端第三步：Notifier 中间层——隔离业务和 Socket.IO 🧱

我们不直接在业务代码里 `import { Server } from 'socket.io'`，而是包一层 `RealtimeNotifier`：

```typescript
// apps/api/src/realtime/realtime-notifier.service.ts L8-L26
@Injectable()
export class RealtimeNotifier {
  private readonly logger = new Logger(RealtimeNotifier.name);

  constructor(private readonly gateway: RealtimeGateway) {}

  notifyTeamMembershipCreated(
    userId: string,
    payload: TeamMembershipCreatedEvent,
  ): void {
    try {
      this.gateway.emitToUser(userId, TEAM_MEMBERSHIP_CREATED, payload);
    } catch {
      // 即使 emit 同步失败，也不能让业务事务回滚
      this.logger.error(
        `Failed to emit ${TEAM_MEMBERSHIP_CREATED} to user ${userId}`,
      );
    }
  }
}
```

这么做的好处：
1. **业务测试方便**：mock `RealtimeNotifier` 就行，不需要启动 Socket 服务
2. **失败隔离**：实时通知失败 → 打日志，但成员关系已经存进数据库了，不能回滚
3. **未来可替换**：哪天想换成 Redis Pub/Sub 或 WebPush，只改这一层

事件契约也用常量和接口定义好，前后端共享：

```typescript
// apps/api/src/realtime/realtime-events.ts
export const TEAM_MEMBERSHIP_CREATED = 'team.membership.created' as const;

export interface TeamMembershipCreatedEvent {
  eventId: string;   // 用 team_member 记录的 UUID，前端去重用
  teamId: string;
  teamName: string;
  role: 'member';
  occurredAt: string;
}
```

---

## 六、后端第四步：团队邀请——先存库，再通知 📦

核心原则就一句话：**数据库 save 成功之前，绝不发通知。**

让我们看 `TeamsService.addTeamMember` 的控制流：

```typescript
// apps/api/src/teams/teams.service.ts L82-L149（节选）
async addTeamMember(
  teamId: string,
  input: AddTeamMemberDto,
  requesterId: string,
): Promise<TeamMemberSummary> {
  // 步骤 1：权限校验——只有团队 owner 能邀请
  await this.requireOwner(teamId, requesterId);

  // 步骤 2：按邮箱找目标用户
  const user = await userRepository.findOne({
    where: { email: input.email.trim().toLowerCase() },
  });
  if (!user) {
    throw new NotFoundException('未找到该邮箱对应的已注册用户');
  }

  // 步骤 3：先查是否已经是成员（正常路径优化）
  const existingMember = await teamMemberRepository.findOne({
    where: { team: { id: teamId }, user: { id: user.id } },
  });
  if (existingMember) {
    return this.toTeamMemberSummary(existingMember); // 已是成员，直接返回
  }

  // 步骤 4：创建成员关系并保存到数据库
  const member = teamMemberRepository.create({
    team: { id: teamId } as Team,
    user,
    role: TeamMemberRole.Member,
  });

  try {
    const savedMember = await teamMemberRepository.save(member);

    // ✅ 步骤 5：数据库成功了！现在才能发通知
    this.realtimeNotifier.notifyTeamMembershipCreated(user.id, {
      eventId: savedMember.id,       // 用 team_member 的 UUID 作事件 ID
      teamId: team.id,
      teamName: team.name,
      role: 'member',
      occurredAt: savedMember.createdAt.toISOString(),
    });

    return this.toTeamMemberSummary(savedMember);
  } catch (error) {
    // 🔒 步骤 6：处理并发冲突——数据库唯一约束兜底
    if (
      !(error instanceof QueryFailedError) ||
      (error.driverError as { code?: unknown }).code !== '23505'
    ) {
      throw error;  // 不是唯一约束冲突，原样抛出
    }

    // 冲突了：说明另一个请求先插入成功。重新查出来返回，但不重复通知！
    const persistedMember = await teamMemberRepository.findOne({
      where: { team: { id: teamId }, user: { id: user.id } },
      relations: { user: true },
    });
    if (persistedMember) {
      return this.toTeamMemberSummary(persistedMember);
    }
    throw error;
  }
}
```

### 6.1 为什么先查还不够？并发场景的 23505 处理

两个请求同时邀请 Bob：

```text
请求 A：查询成员 → 不存在 → INSERT → 成功 ✅ → 发通知
请求 B：查询成员 → 不存在（A 还没提交）→ INSERT → 冲突 23505 ❌
```

数据库的唯一约束 `UNIQUE(team_id, user_id)` 是最终防线。请求 B 捕获到 `23505` 后，重新查询已存在的记录返回——但**绝对不发通知**，因为获胜的请求 A 已经发过了。

这就是「幂等」：不管邀请多少次，Bob 只会收到一次 created 通知。

---

## 七、前端：Provider 模式 + 事件去重 + 断线重连 ⚛️

前端用 React Context 包一层 `RealtimeProvider`，统一管理 Socket 生命周期和通知状态。

### 7.1 连接建立：带 Cookie 的 WebSocket

```typescript
// apps/web/src/realtime/RealtimeProvider.tsx L40-L44
const socket: Socket<ServerToClientEvents, ClientToServerEvents> = io(apiBaseUrl, {
  withCredentials: true,       // ✅ 携带 HttpOnly Cookie
  autoConnect: true,
  transports: ['websocket'],   // 直接走 WebSocket，不回退 long polling
});
```

`withCredentials: true` 是灵魂。没有它，Socket.IO 握手请求不会带 Cookie，服务端鉴权直接失败。

### 7.2 三个关键防御：generation、seenEventIds、teamRefreshVersion

这是前端最容易被忽视但最体现工程功底的地方：

```typescript
// apps/web/src/realtime/RealtimeProvider.tsx L26-L30
const [notifications, setNotifications] = useState<TeamMembershipCreatedEvent[]>([]);
const [teamRefreshVersion, setTeamRefreshVersion] = useState(0);
const generationRef = useRef(0);           // 🔒 防御 1：用户切换隔离
const seenEventIds = useRef(new Set<string>()); // 🔒 防御 2：事件去重
```

#### 防御 1：generation 防止用户串号

用户 Bob 登出 → Carol 登录。如果旧 Socket 的事件晚到，不能出现在 Carol 的通知里：

```typescript
// apps/web/src/realtime/RealtimeProvider.tsx L49-L54
const handleMembershipCreated = (event: TeamMembershipCreatedEvent) => {
  // generation 对不上 = 这是上一个用户的旧连接发来的，直接丢弃
  if (generation !== generationRef.current || seenEventIds.current.has(event.eventId)) return;
  seenEventIds.current.add(event.eventId);
  setNotifications((current) => [...current, event]);
  setTeamRefreshVersion((current) => current + 1); // ✨ 触发团队列表刷新
};
```

#### 防御 2：eventId 去重，同一事件绝不弹两次

`eventId` 用的是后端 `team_member` 记录的 UUID。网络重传、Socket 重连导致服务端补发时，前端不会重复加通知。

#### 防御 3：teamRefreshVersion 驱动 REST 回源

收到通知后版本号 +1，页面组件监听这个版本号就知道「该调 `GET /api/teams` 了」。通知里只带团队名和 ID，列表数据仍以 REST 返回为准。

### 7.3 断线重连补偿

Socket 断开不代表团队关系丢了。重连成功后手动触发一次版本号增长，确保页面重新拉取数据：

```typescript
// apps/web/src/realtime/RealtimeProvider.tsx L56-L80
const handleConnect = () => {
  if (generation !== generationRef.current) return;
  if (!hasConnected) {
    hasConnected = true;
    if (initialConnectionFailed) {
      // 首次连接失败后恢复 → 补同步
      initialConnectionFailed = false;
      setTeamRefreshVersion((current) => current + 1);
    }
    return;
  }
  if (reconnecting) {
    // 断线重连成功 → 补同步
    reconnecting = false;
    setTeamRefreshVersion((current) => current + 1);
  }
};
```

### 7.4 通知展示：5 秒自动消失，支持跳转

```typescript
// apps/web/src/realtime/RealtimeNotificationCenter.tsx
export function RealtimeNotificationCenter() {
  const { notifications, dismissNotification } = useRealtime();
  const notification = notifications[0];
  const eventId = notification?.eventId;

  useEffect(() => {
    if (!eventId) return;
    const timeoutId = window.setTimeout(() => {
      dismissNotification(eventId);
    }, 5_000); // 5 秒后自动关闭
    return () => window.clearTimeout(timeoutId);
  }, [dismissNotification, eventId]);

  if (!notification) return null;

  return (
    <aside className="realtime-notification" role="status" aria-live="polite">
      <p>你已加入「{notification.teamName}」</p>
      <div className="realtime-notification-actions">
        <Link to={`/teams/${notification.teamId}/projects`}>查看团队</Link>
        <button onClick={dismissCurrent}>关闭</button>
      </div>
    </aside>
  );
}
```

---

## 八、验证：双浏览器实测步骤 ✅

写代码只完成了 50%，验证才能交付。按这个步骤走一遍，所有链路都能覆盖到：

**准备：**
- 开两个终端分别跑 `npm run dev:api` 和 `npm run dev:web`
- 打开 Chrome 普通窗口（登录 Alice）和无痕窗口（登录 Bob）
- 两边都打开 DevTools Network

**验证：**
1. Alice 是团队 owner，Bob 已注册但不是成员
2. 在 Bob 侧 Network 筛选 WS，确认 Socket.IO 连接已建立
3. Alice 在团队页面输入 Bob 邮箱 → 点击邀请
4. 观察 Alice 侧：POST /api/teams/:teamId/members 返回 200
5. 观察 Bob 侧：Network → WS → Frames 里出现 `team.membership.created` 事件
6. 观察 Bob 侧：右上角弹出通知「你已加入 XXX」→ 同时发出 GET /api/teams
7. 观察 Bob 侧：团队列表出现新卡片
8. **Alice 再次邀请 Bob → Bob 不应收到第二条通知**（幂等验证）
9. 拔掉 Bob 的网络 → Alice 邀请 → 恢复网络 → Bob 虽然没收到通知，但刷新页面后团队仍在（离线验证）

如果第 8 步 Bob 收到了第二条通知，回去检查：
- TeamsService 里 existingMember 查询是否生效
- 23505 捕获后是否误调用了 notify
- 前端 seenEventIds 是否正确去重

---

## 九、当前边界与未来升级路径 🛣️

诚实列出边界，比假装什么都支持更重要：

| 能力 | 当前状态 | 升级方案 |
|---|---|---|
| 多实例部署 | ❌ 只有单进程内存 room | 加 Socket.IO Redis Adapter |
| 离线消息持久化 | ❌ 在线才收得到 toast | 数据库 outbox + 未读消息表 |
| 送达确认（ACK） | ❌ emit 是 fire-and-forget | 加 Socket.IO ACK + 超时重试 |
| 数据库+通知事务一致性 | ❌ save 成功后 emit，中间进程崩溃会漏通知 | Transactional Outbox 模式 |
| 多端消息已读同步 | ❌ 每个端独立通知状态 | 通知中心 + 已读标记 |

当前的「save 后 best-effort emit + REST 回源」非常适合 Demo 和中小团队产品。真到了要上生产扛流量的时候，按上表逐项升级即可。

---

## 十、代码量总结：少即是多 📊

整个实时团队邀请功能的核心代码量：

| 模块 | 文件 | 有效代码行数 |
|---|---|---|
| 鉴权服务 | [realtime-auth.service.ts](file:///c:/Users/30829/Desktop/ai-collaboration-workspace/apps/api/src/realtime/realtime-auth.service.ts) | ~20 行 |
| 网关 + 房间 | [realtime.gateway.ts](file:///c:/Users/30829/Desktop/ai-collaboration-workspace/apps/api/src/realtime/realtime.gateway.ts) | ~35 行 |
| 通知器 | [realtime-notifier.service.ts](file:///c:/Users/30829/Desktop/ai-collaboration-workspace/apps/api/src/realtime/realtime-notifier.service.ts) | ~15 行 |
| 事件契约 | [realtime-events.ts](file:///c:/Users/30829/Desktop/ai-collaboration-workspace/apps/api/src/realtime/realtime-events.ts) | ~10 行 |
| 邀请逻辑（含幂等） | [teams.service.ts](file:///c:/Users/30829/Desktop/ai-collaboration-workspace/apps/api/src/teams/teams.service.ts) | ~70 行 |
| 前端 Provider | [RealtimeProvider.tsx](file:///c:/Users/30829/Desktop/ai-collaboration-workspace/apps/web/src/realtime/RealtimeProvider.tsx) | ~80 行 |
| 前端通知 UI | [RealtimeNotificationCenter.tsx](file:///c:/Users/30829/Desktop/ai-collaboration-workspace/apps/web/src/realtime/RealtimeNotificationCenter.tsx) | ~35 行 |
| **合计** | | **~265 行** |

不到 300 行代码，实现了：JWT Cookie 鉴权、私有房间机制、数据库事务通知、幂等邀请（含 23505 冲突恢复）、前端多端连接同步、事件 ID 去重、断线重连补偿、用户切换隔离。

---

## 结语：Socket.IO 房间，没你想的那么复杂

回头看，房间机制的核心只有一行：`client.join('user:' + userId)`。但围绕它建起来的工程体系才是价值所在——鉴权边界、数据来源分离、幂等兜底、失败隔离、前端去重重连。

下次面试再被问到「怎么实现实时通知」，别说「我用了 Socket.IO 加房间」了。试试这么回答：

> 我们把 REST API 和数据库作为权威数据来源。用户登录时 JWT 写入 HttpOnly Cookie，Socket.IO 握手时从 Cookie 验证 JWT，拿到用户 ID 后加入 `user:${userId}` 私有房间。邀请成员时先在数据库事务里插入 team_members，成功后再向被邀请者的房间发送 `team.membership.created` 事件。前端收到事件后先通过 eventId 去重，再调 REST 拉取最新团队列表，所以 Socket 断开也不会丢数据。另外我们还处理了并发邀请的 PostgreSQL 23505 冲突，保证重复邀请不会重复通知。

面试官：过了。✅

---

**参考代码全量开源：** [https://github.com/lichenyang5/ai-collaboration-workspace](https://github.com/lichenyang5/ai-collaboration-workspace)
**演示视频：** [Bilibili](https://www.bilibili.com/video/BV16F8B6QEmt/)
