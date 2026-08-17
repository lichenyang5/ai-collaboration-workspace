# 从一次团队邀请开始：用 React、NestJS 与 Socket.IO 做可靠的实时通知

> 这不是一个脱离业务的 WebSocket Hello World，而是我在一个真实全栈协作项目里完成团队邀请实时化的完整复盘。文章会从“为什么另一个浏览器不知道自己被邀请了”讲起，一直拆到 Cookie/JWT 握手鉴权、用户私有房间、REST 数据回源、断线重连、竞态处理和自动化测试。

## 发布信息

- **建议分类**：前端、后端
- **建议标签**：React、NestJS、Socket.IO、WebSocket、TypeScript
- **项目源码**：[lichenyang5/ai-collaboration-workspace](https://github.com/lichenyang5/ai-collaboration-workspace)
- **适合读者**：刚接触实时通信的前端或全栈开发者，以及希望把个人项目讲清楚的求职者

## 1. 项目背景：邀请成功了，为什么另一个浏览器毫无反应

团队邀请本身并不复杂：负责人输入邮箱，前端调用接口，后端在 `team_members` 表里增加一条关系。最早的实现已经能完成这件事，但它只解决了“数据库里有没有这个成员”，没有解决“被邀请的人什么时候知道”。

为了看清问题，可以把参与者分成两个浏览器：

- Alice 是团队负责人，登录在普通窗口；
- Bob 是被邀请用户，登录在无痕窗口；
- 两个窗口有各自的 Cookie、React 状态和网络连接。

Alice 点击邀请以后，请求链路是：

```text
Alice 页面 -> POST 邀请接口 -> 数据库写入 -> 响应 Alice 页面
```

响应只会沿着发起请求的连接返回 Alice。Bob 没有发请求，服务端也没有一条可以主动联系 Bob 的通道，所以他的 React 页面当然不会变化。即使 Alice 页面已经把 Bob 加入成员数组，也只是更新了 Alice 浏览器内存中的状态，不可能跨浏览器修改 Bob 的状态。

最粗暴的办法是让 Bob 手动刷新。刷新后 `GET /api/teams` 会从数据库读到新关系，数据是正确的，但体验不像协作应用。我们希望达到的是：

1. Alice 的邀请仍由原来的 REST 接口完成；
2. 数据库确认写入后，在线的 Bob 立即收到“你已加入某团队”；
3. Bob 的团队列表自动重新读取，不依赖手动刷新；
4. Bob 离线或实时连接失败时，数据库结果仍然正确；
5. 重复邀请不能产生重复成员或重复通知。

这里的关键不是给按钮加一个动画，而是建立一条跨会话的数据同步链路。

## 2. 先补基础：HTTP、WebSocket 与 Socket.IO 到底是什么

在选择技术以前，需要先把三个经常被混在一起的概念分开。

### 2.1 HTTP：一次请求对应一次响应

普通 REST 请求的模型很好理解：客户端发起请求，服务端处理，然后返回响应。只要 Bob 不发起请求，服务端就没有一个现成的 HTTP 响应可以“顺便”塞给 Bob。

HTTP 非常适合权限校验、参数验证、数据库增删改查和明确的成功/失败语义。因此，本项目没有因为加入实时功能就放弃 REST。邀请动作依然是：

```http
POST /api/teams/:teamId/members
Content-Type: application/json

{
  "email": "bob@example.com"
}
```

### 2.2 WebSocket：建立以后可以双向通信

WebSocket 会先通过 HTTP Upgrade 建立连接，成功后连接保持打开。此后客户端和服务端都可以主动发送消息，不需要每条消息重新建立一次 HTTP 请求。

这正好补上前面的缺口：Bob 登录后维持连接，服务端在成员关系落库后就能沿着这条连接通知 Bob。

但原生 WebSocket 只提供比较底层的连接和消息能力。实际项目还会遇到事件命名、自动重连、心跳、房间、类型约束和握手鉴权。全部自行封装并不划算。

### 2.3 Socket.IO：不是 WebSocket 的另一个名字

Socket.IO 是建立在实时传输之上的事件通信库。它提供：

- `socket.on('事件名', handler)` 形式的事件订阅；
- 自动重连和连接生命周期事件；
- 服务端房间，可以向某个用户或某组用户定向发送；
- 客户端和 NestJS 服务端较成熟的集成。

需要注意：Socket.IO 有自己的协议，不能拿原生 WebSocket 客户端直接连接 Socket.IO 服务端。本项目在客户端明确配置 `transports: ['websocket']`，意思是 Socket.IO 只采用 WebSocket transport，而不是说我们绕开了 Socket.IO 协议。

这个功能目前只使用“服务端通知客户端”方向，但以后如果加入在线状态、协同编辑或任务事件，仍然可以继续沿用同一个连接体系。

## 3. 方案比较：轮询、SSE 还是 WebSocket

实时更新不是只有 WebSocket 一条路，选择之前应先比较业务需要。

| 方案 | 做法 | 优点 | 代价 | 对当前项目的适配度 |
| --- | --- | --- | --- | --- |
| 定时轮询 | Bob 每隔几秒请求一次团队列表 | 最简单，完全复用 HTTP | 无变化也会请求；实时性取决于间隔 | 能做，但作品展示效果和扩展性一般 |
| SSE | 服务端通过一个 HTTP 长连接持续向客户端推送 | 浏览器原生支持；适合单向事件流 | 主要是服务端到客户端；连接管理方式不同 | 当前通知能用，但后续双向协作扩展受限 |
| WebSocket / Socket.IO | 登录后维持实时连接，通过事件定向通知 | 延迟低；支持双向；房间与重连成熟 | 需要额外处理鉴权、Origin、断线和多实例 | 与协作工作区的后续方向最匹配 |

如果产品永远只有一个低频通知，轮询或 SSE 都可能更省事。这个项目选择 Socket.IO，不是因为“实时功能就必须 WebSocket”，而是因为它本来就是协作工作区，未来天然可能继续出现团队、项目或任务层面的实时事件。

同时我们保持了一个很重要的克制：本次只实现团队邀请，不顺手扩展聊天、在线人数或任务广播。先把一条链路做可靠，比同时铺开很多不完整功能更有价值。

## 4. 总体架构：消息是提醒，REST 才是账本

这个功能最重要的设计决定，不是“用了 Socket.IO”，而是没有把 Socket.IO 变成第二套数据接口。

服务端为每个已登录用户建立 `user:{userId}` 私有房间；实际邀请 Bob 时，房间名会展开为 `user:{bobId}`。

一句话记忆：**消息是提醒，REST 才是账本。**

也就是说，Socket.IO 事件只告诉 Bob：“团队成员关系发生了变化，你应该重新同步。”真正决定 Bob 属于哪些团队的，仍然是 PostgreSQL 和 `GET /api/teams`。

这样设计有几个直接收益：

1. **只有一个权威来源。** 页面刷新、重新登录和实时事件最终都读取同一份数据库数据。
2. **事件负担更小。** 通知只携带 toast 和跳转需要的信息，不必复制完整团队、成员和项目结构。
3. **断线不会破坏业务。** Socket.IO 挂了，Alice 的 REST 邀请仍能成功；Bob 稍后刷新仍能看到团队。
4. **前端更容易恢复。** 不需要计算漏掉了哪些事件，只要重新请求当前快照。

事件的数据结构很小：

```ts
export interface TeamMembershipCreatedEvent {
  eventId: string;
  teamId: string;
  teamName: string;
  role: 'member';
  occurredAt: string;
}
```

其中 `eventId` 使用已经保存的成员关系 ID，前端可据此去重；`teamId` 和 `teamName` 用于通知与跳转；`role` 明确本次新成员只能是 `member`；`occurredAt` 记录关系创建时间。它故意不携带项目列表，因为那些数据应通过 REST 获取。

```mermaid
flowchart LR
    Alice["Alice 浏览器<br/>团队负责人"] -->|"POST /api/teams/:teamId/members"| API["NestJS REST API"]
    API -->|"权限校验与写入"| DB[(PostgreSQL)]
    API -->|"写入成功后发布事件"| RT["Socket.IO Gateway"]
    RT -->|"team.membership.created<br/>user:{bobId}"| Bob["Bob 浏览器<br/>被邀请用户"]
    Bob -->|"GET /api/teams"| API
    API -->|"读取权威团队列表"| DB
    API -->|"最新团队列表"| Bob
```

## 5. 一次邀请的完整时序

下面先从全局看 Alice 邀请 Bob 时发生了什么，后面再逐层展开每一段代码。

```mermaid
sequenceDiagram
    participant Alice as Alice 浏览器
    participant API as NestJS API
    participant DB as PostgreSQL
    participant Socket as Socket.IO
    participant Bob as Bob 浏览器

    Bob->>Socket: 携带 Cookie 建立 WebSocket 连接
    Socket->>Socket: 校验 Origin 与 JWT，加入 user:{bobId}
    Alice->>API: POST /api/teams/:teamId/members
    API->>DB: 校验负责人、用户与现有成员关系
    API->>DB: 保存新的 TeamMember
    DB-->>API: 返回已持久化成员
    API->>Socket: 发布 team.membership.created
    Socket-->>Bob: 仅向 user:{bobId} 推送事件
    Bob->>Bob: 立即显示邀请通知
    API-->>Alice: 返回成员摘要
    Bob->>API: GET /api/teams
    API->>DB: 查询 Bob 的团队关系
    DB-->>API: 返回最新团队列表
    API-->>Bob: 返回包含新团队的数据
    Bob->>Bob: 更新团队卡片
```

按时间顺序理解这张图：

1. Bob 登录后，前端创建 Socket.IO 连接。握手携带登录 Cookie。
2. 服务端验证 Origin、解析 `access_token`、校验 JWT，然后把连接加入 Bob 的私有房间。
3. Alice 提交邀请。REST 服务先验证 Alice 是负责人，再查团队、用户和现有关系。
4. 只有新成员关系真正保存成功，服务端才构造 `team.membership.created`。
5. Gateway 只向 `user:{bobId}` 发送，Alice 和其他在线用户不会收到。
6. Bob 前端一方面把事件放入通知队列，另一方面触发团队列表重新加载。
7. `GET /api/teams` 返回数据库快照，Bob 的工作区出现新团队。

这里有一个容易忽略的先后约束：**必须先保存，再通知。** 如果先发事件再写数据库，Bob 可能立刻请求团队列表，但数据库还没有成员关系，于是页面仍然看不到新团队。当前实现用保存成功后的返回值生成事件，避免了这个顺序错误。

## 6. 后端实现：Gateway、Cookie/JWT 鉴权与用户房间

后端需要解决的不是“把消息广播出去”，而是确认连接是谁，并且只把邀请通知发送给正确的人。

### 6.1 NestJS Gateway 的职责

Gateway 的关键配置如下，省略了 TypeScript 类型声明：

```ts
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
export class RealtimeGateway {
  @WebSocketServer()
  server!: RealtimeServer;
}
```

这里同时出现了 `allowRequest` 和 `cors`。CORS 配置让合法浏览器来源可以携带凭据；`allowRequest` 则在 Engine.IO 接受连接之前，严格比较请求的 `Origin`。不同来源或没有 Origin 的请求会被拒绝。

为什么不能只写 `cors`？因为 CORS 主要是浏览器执行的跨源访问规则，不应该被当成服务端身份鉴权。这里把来源校验放在接入层，再在下一步校验 Cookie/JWT，两道检查解决的是不同问题。

### 6.2 握手阶段复用登录 Cookie

REST 登录已经把 JWT 放在 HttpOnly Cookie `access_token` 中。HttpOnly 的好处是页面 JavaScript 不能直接读取 token，降低 token 被脚本窃取的风险。建立 Socket.IO 连接时，浏览器仍可以自动携带 Cookie。

服务端中间件在连接进入正常生命周期前完成鉴权：

```ts
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
```

`RealtimeAuthService` 的工作分成四步：

```ts
const token = parse(cookieHeader ?? '').access_token;
if (!token) throw new UnauthorizedException('请先登录');

const payload = await jwtService.verifyAsync<JwtPayload>(token);
if (!payload.sub || !payload.email) throw new Error('invalid payload');

return { id: payload.sub, email: payload.email };
```

它解析 Cookie、取出 token、验证签名和有效期，并要求 payload 中存在 `sub` 与 `email`。验证结果放入 `client.data.user`。客户端不能在事件参数中谎报“我是 Bob”，因为房间身份来自服务端验证过的 JWT。

鉴权放在 namespace middleware 里也很关键。如果先触发已连接逻辑、后异步检查身份，未认证连接可能短暂进入房间或触发其他生命周期操作。当前顺序是“先认证，后 connection”。

### 6.3 每个用户一个私有房间

连接通过以后，Gateway 使用服务端认证结果加入房间：

```ts
async handleConnection(client: AuthenticatedSocket): Promise<void> {
  await client.join(`user:${client.data.user.id}`);
}

emitToUser(userId: string, event: string, payload: unknown): void {
  this.server.to(`user:${userId}`).emit(event, payload);
}
```

房间不是数据库表，只是当前 Socket.IO 进程里的连接分组。同一个 Bob 同时打开两个已登录页面时，两个 socket 都可以加入 `user:{bobId}`，两处页面都会实时收到通知。Alice 的连接在 `user:{aliceId}`，不会被误发。

### 6.4 用 Notifier 隔离业务与传输层

`TeamsService` 不直接操作 Socket.IO Server，而是依赖一个很薄的 `RealtimeNotifier`：

```ts
notifyTeamMembershipCreated(userId, payload): void {
  try {
    this.gateway.emitToUser(userId, TEAM_MEMBERSHIP_CREATED, payload);
  } catch {
    this.logger.error(
      `Failed to emit ${TEAM_MEMBERSHIP_CREATED} to user ${userId}`,
    );
  }
}
```

这样团队服务只表达“通知某个用户成员关系已创建”，不用知道房间格式和 Socket.IO API。`try/catch` 能记录 `emitToUser()` 同步抛出的调用异常，但 Socket.IO 向空房间发送、用户离线或消息在网络途中丢失，通常不会让 `emit()` 抛错。当前事件没有 ACK，因此服务端并不能确认 Bob 实际收到。无论如何，成员关系不会因为实时层问题而回滚：成员关系才是业务事实，toast 只是即时体验，最终数据仍靠 REST 恢复。

## 7. 邀请写入与幂等：为什么重复邀请不会重复通知

数据库唯一约束、服务层查询和事件发布时间共同决定了用户是否会收到重复通知。

### 7.1 先做业务检查

`addTeamMember` 按以下顺序执行：

1. `requireOwner` 确认请求者已经属于团队且角色为 `owner`；
2. 查询团队，拿到事件需要的 `id` 和 `name`；
3. 把邮箱 `trim()` 并转成小写，查找已注册用户；
4. 查询该用户是否已经是当前团队成员。

不存在的注册用户会得到“未找到该邮箱对应的已注册用户”，普通成员尝试邀请会得到“只有团队负责人可以邀请成员”。这些仍是 REST 错误，不会经过实时通道。

如果第 4 步已经找到成员，服务直接返回成员摘要：

```ts
if (existingMember) {
  return this.toTeamMemberSummary(existingMember);
}
```

这里没有调用 Notifier，所以 Alice 重复邀请 Bob 时，Alice 可以得到一致的成员结果，Bob 不会再看到一次“你已加入”。

### 7.2 只有保存成功才发布

新成员路径的核心代码可以压缩成：

```ts
const member = teamMemberRepository.create({
  team: { id: teamId } as Team,
  user,
  role: TeamMemberRole.Member,
});

const savedMember = await teamMemberRepository.save(member);

realtimeNotifier.notifyTeamMembershipCreated(user.id, {
  eventId: savedMember.id,
  teamId: team.id,
  teamName: team.name,
  role: 'member',
  occurredAt: savedMember.createdAt.toISOString(),
});
```

事件位于 `await save()` 之后，因此不会为失败的数据库写入发送“成功通知”。Alice 收到的成员摘要和 Bob 收到的事件，都来自同一个已持久化实体。

### 7.3 为什么查过一次仍要处理 `23505`

“先查是否存在”只能处理普通重复点击，挡不住并发：两个请求可能同时查到“不存在”，然后都尝试插入。

实体上还有最后一道数据库约束：

```ts
@Entity({ name: 'team_members' })
@Unique(['team', 'user'])
export class TeamMember { /* ... */ }
```

PostgreSQL 唯一约束冲突的错误码是 `23505`。当前服务捕获这个特定错误，再查询已经由另一个请求写入的成员关系并返回：

```ts
if (
  error instanceof QueryFailedError &&
  (error.driverError as { code?: unknown }).code === '23505'
) {
  const persistedMember = await teamMemberRepository.findOne(/* ... */);
  if (persistedMember) return this.toTeamMemberSummary(persistedMember);
}
throw error;
```

发生竞争时，只有真正插入成功的请求走到通知语句；唯一约束失败的请求只恢复并返回已有关系，不再发布事件。数据库约束保证“最多一条成员关系”，服务分支保证“最多一次创建通知”。

这里体现的是幂等的用户体验：相同邀请执行一次或多次，最终看到的成员关系相同，也不会因为重试制造通知风暴。

## 8. 前端实现：RealtimeProvider、通知队列与 REST 回源

前端把连接生命周期放入 Provider，把展示和数据同步拆成不同职责。

### 8.1 只在登录后创建连接

`App` 启动时先通过 `GET /api/auth/me` 恢复登录状态。没有有效用户时不挂载实时 Provider；整组路由仍然存在，但受保护路由会跳转到登录页。确认 `currentUser` 后，才挂载实时 Provider：

```tsx
if (!currentUser) return routes;

return (
  <RealtimeProvider user={currentUser}>
    <RealtimeNotificationCenter />
    {routes}
  </RealtimeProvider>
);
```

这样匿名访问者不会反复尝试一个必然失败的 WebSocket 鉴权。退出登录以后 Provider 卸载，清理函数会解除事件监听并主动 `disconnect()`。

客户端连接配置如下：

```ts
const socket = io(apiBaseUrl, {
  withCredentials: true,
  autoConnect: true,
  transports: ['websocket'],
});
```

`apiBaseUrl` 来自 `VITE_API_BASE_URL`，开发环境默认是 `http://localhost:3001`。`autoConnect` 在 effect 创建 socket 后立即连接，`transports` 明确只使用 WebSocket。

这里需要精确理解 `withCredentials`：它会影响 Engine.IO 的 polling/XHR/fetch 等凭据化请求，在 Node 客户端也参与 Cookie Jar 行为；但当前浏览器走的是纯 WebSocket transport，底层直接调用浏览器 `WebSocket` 构造器。WebSocket 握手是否携带 Cookie，由浏览器根据 Cookie 的 Domain、Path、SameSite、Secure 等属性决定，不能靠 `withCredentials: true` 绕过这些规则。代码保留该选项并不等于它是当前纯 WebSocket Cookie 的开关。

### 8.2 事件进入 Provider 后发生什么

Provider 维护两个对外状态：

```ts
const [notifications, setNotifications] =
  useState<TeamMembershipCreatedEvent[]>([]);
const [teamRefreshVersion, setTeamRefreshVersion] = useState(0);
const seenEventIds = useRef(new Set<string>());
```

收到事件时：

```ts
const handleMembershipCreated = (event: TeamMembershipCreatedEvent) => {
  if (
    generation !== generationRef.current ||
    seenEventIds.current.has(event.eventId)
  ) return;

  seenEventIds.current.add(event.eventId);
  setNotifications((current) => [...current, event]);
  setTeamRefreshVersion((current) => current + 1);
};
```

它做了三件相互独立的事：

1. 用 `eventId` 去重，避免同一事件重复进入页面；
2. 把通知追加到队列，而不是覆盖正在显示的通知；
3. 增加刷新版本，通知关心团队数据的页面重新请求。

这里没有直接把事件转换成完整 `TeamSummary`。事件里的 `teamName` 足够显示 toast，却不足以代表所有团队字段和服务端最新顺序，所以仍需 REST 回源。

### 8.3 通知中心只负责展示

`RealtimeNotificationCenter` 每次只取队列第一项：

```tsx
const notification = notifications[0];

return (
  <aside className="realtime-notification" role="status" aria-live="polite">
    <p>你已加入「{notification.teamName}」</p>
    <Link to={`/teams/${notification.teamId}/projects`}>查看团队</Link>
    <button type="button">关闭</button>
  </aside>
);
```

通知固定在页面右下角。用户可以点击“查看团队”进入 `/teams/:teamId/projects`，也可以手动关闭；不操作时，`setTimeout` 会在 5 秒后移除当前事件。如果队列里还有下一条，下一条随后成为第一项并开始自己的 5 秒计时。

`role="status"` 与 `aria-live="polite"` 让辅助技术能够在不打断当前操作的情况下播报变化。这是一个很小但值得保留的可访问性细节。

### 8.4 `teamRefreshVersion` 如何驱动列表更新

工作区页面通过 Context 读取版本：

```ts
const { teamRefreshVersion } = useRealtime();

useEffect(() => {
  if (lastRefreshVersionRef.current === teamRefreshVersion) return;
  lastRefreshVersionRef.current = teamRefreshVersion;
  void loadTeams(requestGenerationRef.current);
}, [loadTeams, teamRefreshVersion]);
```

每次新的邀请事件让版本 `+1`，effect 调用 `GET /api/teams`。如果 Bob 此时不在工作区页面，通知仍然能显示；他之后返回工作区时，页面初始加载本身也会请求团队列表，因此照样可以看到新团队。

如果 REST 重新同步失败，页面显示“实时同步失败，可刷新页面重试”，但不会撤回已经展示的通知，也不会伪造一份团队数据。这再次体现了通知状态与业务数据状态的分离。

## 9. 真正困难的部分：异步竞态与会话隔离

能够收到一条事件只是开始；可靠实现还必须处理切换账号、重复点击、旧请求后返回和断线恢复。

### 9.1 邀请按钮为什么不能只依赖 `isInviting`

React 的状态更新不会在当前事件处理函数中同步改变变量。用户极快地连续提交两次时，第二次处理函数可能仍读取到旧的 `isInviting === false`。

因此邀请页面同时使用同步 ref：

```ts
if (invitationPendingRef.current || !teamId || state.teamRole !== 'owner') {
  return;
}

invitationPendingRef.current = true;
dispatch({ type: 'inviteStarted' });
```

ref 在第一次提交中立即变为 `true`，第二次提交会直接返回；React 状态则负责让按钮显示“邀请中...”并禁用。成功后 reducer 用成员 ID 执行 upsert，同时清空邮箱、恢复按钮和错误状态。

这也解释了为什么“接口成功但按钮一直邀请中”不能只看数据库。数据库有成员只证明 POST 成功，按钮是否恢复取决于前端请求上下文的 `success / catch / finally` 是否仍然属于当前页面。

### 9.2 团队路由切换与 ABA 问题

想象这个顺序：

```text
团队 A 发起邀请 -> 切到团队 B -> 又切回团队 A -> 旧请求才返回
```

只比较 `teamId` 不够，因为开始和结束都是 A，这就是常见的 ABA 问题。页面为每次邀请上下文保存单调递增的 generation：

```ts
useLayoutEffect(() => {
  invitationGenerationRef.current += 1;
  invitationTeamIdRef.current = teamId;
  invitationPendingRef.current = false;
  dispatch({ type: 'invitationContextChanged' });
}, [teamId]);
```

请求开始时捕获 generation 和 team ID。旧请求成功时，如果当前 generation 仍相同，才能清空当前输入和结束当前按钮状态；如果 generation 已变化但当前又回到原团队，只允许 `memberReconciled` 更新成员数组，不能清掉用户在新一轮 A 页面里刚输入的邮箱，更不能释放新请求的 busy 状态。

### 9.3 切换登录用户必须创建全新的实时会话

Provider 外层使用：

```tsx
export function RealtimeProvider({ user, children }: RealtimeProviderProps) {
  return <RealtimeSession key={user.id}>{children}</RealtimeSession>;
}
```

当登录用户从 A 变成 B，React 因 `key` 改变而卸载旧 `RealtimeSession`，重新创建所有 state 和 ref。旧用户的通知队列、去重集合和刷新版本不会泄露给新用户。

effect 内还有 generation 检查。即使旧 socket 的回调刚好在清理边界触发，它持有的 generation 也已经失效，不能再写入当前会话。这是“组件实例隔离 + 回调令牌校验”两层保护。

### 9.4 首次失败与断线重连不是同一件事

正常第一次连接成功时，页面已经执行自己的初始 REST 加载，不需要额外请求。可是下面两种情况需要补偿：

- 页面打开时 API 暂不可用，产生 `connect_error`，之后第一次连上；
- 已经连接成功，后来发生 `disconnect`，再重新 `connect`。

Provider 分别记录 `initialConnectionFailed`、`hasConnected` 和 `reconnecting`。首次失败后连上，以及正常连接断开后重连，都会把 `teamRefreshVersion` 增加一次。这样即使断线期间漏掉了邀请事件，也可以通过 REST 快照补齐。

注意它不承诺补发 toast。Socket.IO 事件在当前实现中不是持久消息，离线期间的用户可能错过弹窗；补偿的是团队数据，而不是历史通知队列。

### 9.5 为什么团队列表需要“单飞 + 最终追赶”

如果短时间收到多个刷新信号，直接并行发出多个 `GET /api/teams` 会遇到响应乱序：旧请求最后返回，可能覆盖新快照。

`WorkspacePage` 使用两个 ref：

```ts
if (loadInFlightRef.current) {
  reloadQueuedRef.current = true;
  return;
}

loadInFlightRef.current = true;
do {
  reloadQueuedRef.current = false;
  // await GET /api/teams
} while (reloadQueuedRef.current);
```

同一时间只允许一个团队 GET 在途，这就是 single-flight。期间出现的新刷新需求不再创建并行请求，只把 `reloadQueuedRef` 标为真；当前请求结束后再执行一次最终追赶。无论中间积累多少信号，最终至少有一份在它们之后发出的权威快照。

`requestGenerationRef` 还把请求绑定到当前用户。登出或切换用户会增加 generation，旧用户请求即使后来成功，也会因 generation 不匹配而被丢弃。

### 9.6 本地创建团队与实时刷新也可能竞争

Bob 收到邀请触发 GET 的同时，也可能正在创建自己的团队。假设 GET 先发出，创建 POST 后成功并把新团队加入本地数组，随后旧 GET 才返回；如果直接 `setTeams(result)`，刚创建成功的团队会短暂消失。

页面用 `teamMutationVersionRef` 记录已确认的本地创建。GET 开始时捕获版本，返回时只有版本未变才直接替换列表；如果期间发生创建，旧快照不能覆盖本地成功结果，而是安排下一次 GET。最终的追赶请求再用数据库最新状态统一列表。

这套逻辑看起来比“收到消息就 fetch”复杂，但它解决的都是用户真实可见的问题：按钮卡住、新输入被旧请求清空、切换账号后看到上一个人的通知，以及新数据被旧快照覆盖。

## 10. 安全边界：Origin、Cookie 与 WebSocket transport

WebSocket 是长连接，但它并不会自动继承 REST 端所有安全保证。

### 10.1 当前实现的四层边界

| 层次 | 当前措施 | 解决的问题 |
| --- | --- | --- |
| 浏览器来源 | `Origin === CORS_ORIGIN` | 拒绝非预期网页发起实时连接 |
| Cookie 传递 | 浏览器的 Domain、Path、SameSite、Secure 规则 | 决定 WebSocket 握手是否携带现有登录凭据 |
| 用户身份 | 服务端验证 `access_token` JWT | 确认连接对应哪个用户 |
| 消息目标 | 服务端加入 `user:{userId}` | 只向被邀请用户的连接发送 |

这四层不能互相替代。合法 Origin 不代表已经登录；携带一个 Cookie 不代表 token 有效；JWT 有效也不能让客户端自己决定加入谁的房间。

### 10.2 为什么客户端强制 WebSocket transport

Socket.IO 默认可能先用 HTTP polling，再升级到 WebSocket。当前服务端 `allowRequest` 明确拒绝缺少 Origin 的接入请求，而某些同源 polling 请求路径未必表现出与浏览器 WebSocket 握手完全相同的 Origin 语义。

客户端最终显式配置：

```ts
transports: ['websocket']
```

这样浏览器从开始就发起 WebSocket 握手，服务端可以按预期检查 Origin，也减少“安全规则接受 WebSocket、却意外挡住 polling 起步阶段”的不一致。

### 10.3 Cookie 的部署含义

登录 Cookie 当前使用 `httpOnly: true`、`sameSite: 'lax'`，生产环境使用 `secure: true`。因此部署时要保证：

- 页面来源与 `CORS_ORIGIN` 精确一致，包括协议、域名和端口；
- `VITE_API_BASE_URL` 指向同一套 API；
- API 使用稳定且保密的 `JWT_SECRET` 签发和验证登录 token；
- HTTPS 页面建立的是兼容的 WSS 连接；
- 反向代理允许 WebSocket Upgrade，并正确转发 Cookie 与 Origin。

当前 Cookie 是 `sameSite: 'lax'`，因此 Web 与 API 需要保持 same-site；本地 `localhost` 的不同端口仍属于 same-site。若生产环境把前端和 API 放在不同站点，浏览器可能不会在 WebSocket 握手中发送该 Cookie，`withCredentials` 也不能越过 SameSite 限制，需要重新设计 Cookie 属性与安全策略。

本地默认值是 Web `http://localhost:5173`、API `http://localhost:3001`。如果浏览器实际打开 `http://127.0.0.1:5173`，它与 `http://localhost:5173` 是不同 Origin，也会被拒绝。

### 10.4 当前方案没有解决什么

诚实说明边界比把 Demo 描述成“生产级万能系统”更重要：

- **没有持久化通知中心。** 离线用户不会收到历史 toast，只能靠 REST 数据恢复。
- **没有跨实例房间同步。** 当前房间存在于单个 Node 进程内；多实例部署需要 Redis Adapter 等共享传输层。
- **没有 Outbox。** 数据库保存成功、事件发出前如果进程崩溃，事件可能丢失，但成员关系仍可在下次 REST 请求中看到。
- **没有扩展其他事件。** 项目邀请、任务广播、聊天和在线状态都不在本次范围。

这些限制不影响当前单实例作品 Demo 的目标，却为后续演进给出了清晰方向。

## 11. 如何证明功能可靠：自动化测试与真实握手

测试需要分别证明纯逻辑、真实握手、页面交互和最终人工效果。

### 11.1 为什么一个“能连上”的测试不够

实时功能跨越数据库、REST、Socket.IO、Cookie、React Context 和页面请求。只测其中一层，很容易得到虚假的安全感。例如：

- mock Gateway 通过，不代表真实 Socket.IO 握手会带上正确 Cookie；
- Provider 能收到假事件，不代表服务端只发给 Bob；
- 团队列表最终正确，不代表旧请求不会在特殊时序下覆盖它；
- 自动化测试全绿，也不代表本机两个浏览器的 Origin、Cookie 和端口配置正确。

因此当前项目把测试拆成几层。

### 11.2 后端测试分别证明什么

**鉴权服务测试**覆盖：

- 能从混合 Cookie 字符串中读取 `access_token`；
- Cookie 缺失、空字符串或只有其他 Cookie 时拒绝；
- JWT payload 缺少 `sub` 或 `email` 时拒绝；
- `verifyAsync` 因签名或过期失败时拒绝。

**Gateway 单元测试**覆盖：认证成功后只加入 `user:user-2`、认证失败时不加入任何房间，以及 `emitToUser` 只选择目标用户房间。

更重要的是，项目还有真实 `socket.io-client` 集成测试。测试启动一个临时 Nest HTTP Server，用 WebSocket transport 真正连接，然后检查：

1. 合法 Origin + 有效 Cookie 可以连接并加入用户房间；
2. 不同 Origin 被拒绝；
3. 缺少 Origin 被拒绝；
4. 合法 Origin 但缺少 Cookie 被拒绝；
5. 合法 Origin 但 JWT 无效被拒绝。

这比直接调用 `handleConnection()` 更接近浏览器实际握手。

**通知器和团队服务测试**继续验证业务语义：新成员保存后恰好发布一次、已有成员不再保存也不通知、并发唯一约束冲突恢复后不重复通知、普通数据库错误原样抛出，以及模拟 `emitToUser()` 同步抛错时仍返回成员摘要。由于没有 ACK，这些测试不声称能确认客户端实际送达。

### 11.3 前端测试分别证明什么

`RealtimeProvider.test.tsx` 用可控的 socket mock 验证：

- 连接参数包含 `withCredentials` 和 `transports: ['websocket']`；
- 同一个 `eventId` 只处理一次；
- 正常首次连接不产生多余刷新；
- 首次连接失败后恢复只刷新一次；
- 断线重连只刷新一次；
- 更换登录用户时旧回调、旧通知和旧版本不能污染新会话；
- Provider 卸载时断开 socket。

`RealtimeNotificationCenter.test.tsx` 验证通知文案、队列顺序、手动关闭、5 秒关闭、查看团队跳转，以及匿名状态下不挂载实时功能。

`WorkspacePage.test.tsx` 则集中验证数据一致性：版本变化会重新加载、多个失效信号保持单个 GET 在途并最终追赶、失败保留原团队、下次成功清理错误、切换用户后忽略旧成功与旧失败、本地创建和旧 GET 竞争时不丢团队。

### 11.4 如何运行以及当前证据

在仓库根目录执行：

```bash
npm run test
npm run build
```

本文写作前在隔离工作树重新运行了完整测试，结果为：

```text
API: 17 个 Test Suites 全部通过，90 个 Tests 全部通过
Web: 8 个 Test Files 全部通过，89 个 Tests 全部通过
```

这组数字证明当前提交的自动化基线，但不能冒充浏览器人工验收。下节给出可执行的双浏览器步骤；是否在你的部署环境中真正看到 toast，仍要以浏览器 Network 和页面现象为准。

## 12. 双浏览器验证与常见故障排查

一个普通窗口和一个无痕窗口，能够模拟两个完全独立的 Cookie 会话。

### 12.1 从零验证完整效果

先启动 PostgreSQL、API 和 Web，然后按以下步骤执行：

1. 普通窗口打开 `http://localhost:5173`，登录团队负责人 Alice。
2. 无痕窗口打开相同地址，登录已注册用户 Bob。
3. 两个窗口都保持打开，确认 Console 没有持续的 WebSocket 连接错误。
4. Alice 进入自己负责的团队，在成员区域输入 Bob 邮箱。
5. 点击“邀请成员”。Alice 按钮应短暂显示“邀请中...”。
6. 请求成功后，Alice 的输入框清空、按钮恢复，Bob 出现在成员列表。
7. Bob 不刷新页面，右下角应出现“你已加入「团队名」”。
8. 如果 Bob 正停留在工作区，新团队卡片应自动出现；如果在其他页面，返回工作区后应出现。
9. Bob 点击“查看团队”，应进入 `/teams/:teamId/projects` 并看到团队项目。
10. Alice 再次邀请同一个 Bob，Alice 仍得到已有成员结果，但 Bob 不应收到第二条 toast。

在 DevTools Network 中，正常证据链应是：

```text
Alice: POST /api/teams/:teamId/members -> 2xx
Bob:   WebSocket Frame: team.membership.created
Bob:   GET /api/teams -> 2xx，响应包含新团队
```

如果 Bob 在邀请发生时离线，预期不是上线后补发 toast。正确行为是 Bob 登录后通过初始 `GET /api/teams` 看见团队。这是“瞬时通知 + 权威快照”架构的正常边界。

### 12.2 不要先猜，按证据定位

| 现象 | 先检查什么 | 常见原因与处理 |
| --- | --- | --- |
| Alice 邀请成功，Bob 没有 toast | Bob Network 是否存在 WebSocket；Frames 是否有 `team.membership.created` | Socket 未连接、Bob 邀请时离线或事件未到；先查连接和 API 日志，不要先改 React |
| WebSocket 握手被拒绝 | 请求头 `Origin` 与 API 的 `CORS_ORIGIN` | 协议、域名或端口任一不同都会失败；统一实际 Web 地址并重启 API |
| 显示 `Unauthorized` / 连接持续 `connect_error` | 握手 Request Headers 是否携带 `access_token` Cookie | Bob 未登录、Cookie 过期，或 `VITE_API_BASE_URL` 指错环境；重新登录并核对 API 地址 |
| toast 出现但团队卡片不更新 | Bob 是否随后请求 `GET /api/teams`，状态码和响应是什么 | REST 回源失败；页面应提示“实时同步失败”，根据响应修复认证或 API，而不是把事件硬塞进团队列表 |
| Bob 收到重复 toast | 两条 Frame 的 `eventId` 是否相同；数据库是否存在重复关系 | 相同 ID 应被前端去重；不同 ID 要检查唯一约束和是否在恢复分支错误发布 |
| Alice 一直显示“邀请中...” | Alice 的 POST 是否仍 Pending；是否切换过团队路由；响应后 Console 是否报错 | 先确认真实请求是否结束，再检查当前 invitation generation 的成功/失败/finally 路径 |
| 页面或 API 端口无法启动 | 终端是否出现 `EADDRINUSE`，Network 连接到了哪个进程 | 旧开发服务占用 `3001` 或 `5173`；停止旧进程后用正确目录重新启动 |
| HTTPS 页面实时连接失败 | Network 中连接是否为 WSS，代理是否返回 `101 Switching Protocols` | 反向代理未转发 Upgrade、证书/协议不匹配，或生产 Origin 未配置 |

### 12.3 一个实用的排查顺序

遇到问题时，我建议固定按这条链路走：

```text
POST 是否成功
  -> 数据库是否已有 team_members
  -> API 是否执行 notify
  -> Bob WebSocket 是否在线且在正确用户房间
  -> Frame 是否到达
  -> teamRefreshVersion 是否变化
  -> GET /api/teams 是否成功
  -> React 是否采用了当前响应
```

从左到右查，可以很快判断问题在写入、传输还是展示层。只盯着“页面没变化”修改 CSS 或 `setState`，通常会绕远路。

## 13. 面试时怎么讲：一分钟版与三分钟版

实现完成以后，还需要把技术选择、难点和结果说清楚。

### 13.1 一分钟版本

> 我在一个 React + NestJS 的协作工作区里实现了实时团队邀请。原来的 REST 邀请只能更新发起者页面，被邀请用户必须刷新。我采用 Socket.IO 建立登录用户的私有连接，但没有让 WebSocket 承担业务数据：成员关系仍由 REST 和 PostgreSQL 写入，保存成功后服务端只向 `user:{userId}` 发布 `team.membership.created`，前端收到后显示通知并重新请求 `GET /api/teams`。实现中还处理了 Cookie/JWT 握手鉴权、Origin 校验、重复邀请幂等、断线重连补偿和用户切换时的旧回调污染。最后用真实 Socket.IO 握手测试和 React 页面竞态测试覆盖了关键链路。

这一版要包含四个点：遇到了什么问题、架构怎么分工、最难的可靠性问题、如何证明。

### 13.2 三分钟版本

> 业务场景是 Alice 邀请 Bob 加入团队。单纯 REST 只能把结果返回 Alice，Bob 的浏览器不知道数据库变化。方案上我比较了轮询、SSE 和 WebSocket，最后选择 Socket.IO，因为项目是协作工作区，后续可能继续扩展实时事件。
>
> 后端使用 NestJS Gateway。浏览器握手必须匹配 `CORS_ORIGIN`，并携带 REST 登录时写入的 HttpOnly `access_token` Cookie。namespace middleware 验证 JWT 后，把服务端确认的用户 ID 放进 `socket.data`，连接再加入 `user:{userId}` 私有房间。团队服务先检查负责人权限、目标用户和已有成员关系；新关系保存成功后才发送 `team.membership.created`。已有成员直接返回，两个并发插入由数据库唯一约束和 `23505` 恢复分支兜底，所以不会重复发布创建通知。通知器采用 best-effort，实时发送调用失败不会回滚已经成功的邀请，但当前没有 ACK 来确认送达。
>
> 前端只在恢复登录以后挂载 `RealtimeProvider`。事件按 `eventId` 去重，一份进入 toast 队列，一份通过 `teamRefreshVersion` 触发 `GET /api/teams`。这样事件只做失效通知，REST 仍是权威数据。Provider 以用户 ID 作为 React key，解决账号切换时旧 socket 污染；首次连接失败后恢复和断线重连都会触发一次快照同步。工作区还用 single-flight、queued catch-up、用户 generation 和 mutation version 处理请求乱序。
>
> 测试上除了 Gateway 单测，我还用真实 `socket.io-client` 启动临时服务，覆盖正确/错误/缺失 Origin 和 Cookie；前端覆盖事件去重、重连、用户隔离、通知队列和团队列表竞态。最后还需要按文中的步骤，用普通窗口与无痕窗口人工验证负责人和被邀请人的独立 Cookie 会话；本次写作没有把这一步描述成已经观察到的结果。

### 13.3 面试官可能继续问什么

**问：为什么不直接轮询？**

答：轮询实现简单，如果业务只有一个低频变化，我会优先考虑它。但协作工作区存在继续扩展实时事件的可能，Socket.IO 的房间、连接生命周期和双向能力更合适。同时我没有把全部业务迁入 WebSocket，而是保留 REST 回源，控制了复杂度。

**问：事件已经带了团队名称，为什么还要重新请求？**

答：事件只代表“成员关系已创建”，不是完整团队快照。直接合并事件会让前端承担字段、排序、权限和漏事件恢复。重新请求能让刷新、重连和实时通知统一到同一权威来源，也更容易处理离线。

**问：如果 API 部署多个实例怎么办？**

答：当前房间在单进程内。多实例时 Alice 的 REST 请求和 Bob 的 socket 可能落到不同实例，需要 Socket.IO Redis Adapter 一类共享发布层；如果还要求数据库提交与事件可靠一致，则进一步引入 Outbox 和消息队列。当前 Demo 明确没有假装已经解决这些问题。

## 14. 总结

实时协作的价值不在于页面多了一个弹窗，而在于不同用户看到的数据能够及时、可解释地重新对齐。

回顾整个实现，最值得复用的不是某一段 Socket.IO API，而是几个设计原则：

1. **先确认业务事实，再发送通知。** 没有成功落库，就不应该告诉用户成功。
2. **实时事件负责失效，REST 快照负责真相。** 断线、重连和刷新都能回到同一条数据路径。
3. **连接必须有服务端确认的身份。** Origin、Cookie、JWT 和用户房间缺一不可。
4. **异步结果必须有归属。** generation、同步 pending ref 和 mutation version 都是在回答“这个结果还属于当前页面吗”。
5. **测试要跨边界。** 既测函数，也测真实握手，还要测页面竞态；浏览器人工验收仍然不可省略。

如果你刚开始学习 WebSocket，可以先只记住这条完整链路：

```text
登录建立私有连接
-> REST 邀请并写数据库
-> 保存成功后定向发事件
-> 前端显示轻量通知
-> REST 重新读取权威列表
-> 断线或切换上下文时拒绝旧结果
```

当这条链路真正跑通以后，再扩展任务广播、在线状态或多实例消息系统，会比从一个“大而全”的实时框架开始更稳。

完整代码与 Mac 启动说明在 GitHub：

[https://github.com/lichenyang5/ai-collaboration-workspace](https://github.com/lichenyang5/ai-collaboration-workspace)
