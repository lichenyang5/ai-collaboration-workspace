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
    API-->>Alice: 返回成员摘要
    Bob->>API: GET /api/teams
    API->>DB: 查询 Bob 的团队关系
    DB-->>API: 返回最新团队列表
    API-->>Bob: 返回包含新团队的数据
    Bob->>Bob: 更新团队卡片并显示通知
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

这样团队服务只表达“通知某个用户成员关系已创建”，不用知道房间格式和 Socket.IO API。通知失败会记录错误，但不会把已经成功的数据库写入反向变成邀请失败。因为成员关系才是业务事实，toast 只是即时体验。

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

`App` 启动时先通过 `GET /api/auth/me` 恢复登录状态。没有有效用户时，只渲染登录相关路由；确认 `currentUser` 后，才挂载实时 Provider：

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

`apiBaseUrl` 来自 `VITE_API_BASE_URL`，开发环境默认是 `http://localhost:3001`。`withCredentials` 让浏览器握手携带登录 Cookie；`autoConnect` 在 effect 创建 socket 后立即连接；`transports` 明确只使用 WebSocket。

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
| Cookie 传递 | 客户端 `withCredentials: true` | 让握手携带现有登录凭据 |
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
- HTTPS 页面建立的是兼容的 WSS 连接；
- 反向代理允许 WebSocket Upgrade，并正确转发 Cookie 与 Origin。

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

## 12. 双浏览器验证与常见故障排查

一个普通窗口和一个无痕窗口，能够模拟两个完全独立的 Cookie 会话。

## 13. 面试时怎么讲：一分钟版与三分钟版

实现完成以后，还需要把技术选择、难点和结果说清楚。

## 14. 总结

实时协作的价值不在于页面多了一个弹窗，而在于不同用户看到的数据能够及时、可解释地重新对齐。
