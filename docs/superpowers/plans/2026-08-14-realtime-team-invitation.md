# Realtime Team Invitation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在线用户被加入团队后立即收到定向通知，并由现有 REST 接口自动同步其团队列表。

**Architecture:** NestJS Socket.IO Gateway 复用当前 HttpOnly JWT Cookie 验证连接，将每个连接加入服务端控制的 `user:{userId}` 私有房间。邀请服务仅在新成员关系成功持久化时通过通知服务发布 `team.membership.created`；React 全局 Provider 接收事件、管理通知队列和刷新版本，工作区继续用 `GET /api/teams` 获取权威数据。

**Tech Stack:** NestJS 11, Socket.IO, TypeScript, Jest, React 19, React Router 7, socket.io-client, Vitest, Testing Library

## Global Constraints

- 第一版只处理团队邀请实时通知，不实现任务实时同步、聊天或在线状态。
- 加入团队即获得该团队全部项目的访问权，不新增项目成员表或数据库迁移。
- 事件名称必须为 `team.membership.created`。
- WebSocket 只发送通知；数据库与 REST API 始终是团队列表和权限的权威数据源。
- WebSocket 连接或发送失败不得阻塞登录、邀请、团队读取或项目访问。
- 已存在成员与 PostgreSQL `23505` 并发恢复不得发送重复通知。
- 继续复用 `VITE_API_BASE_URL`、`CORS_ORIGIN` 和 `JWT_SECRET`，不新增环境变量。
- 生产代码必须由失败测试驱动；每个任务只提交列出的文件。

---

## File Structure

### New backend files

- `apps/api/src/realtime/realtime-events.ts` — 唯一的实时事件名和载荷类型定义。
- `apps/api/src/realtime/realtime-auth.service.ts` — 从 Socket 握手 Cookie 验证当前用户。
- `apps/api/src/realtime/realtime-auth.service.spec.ts` — Cookie/JWT 鉴权单元测试。
- `apps/api/src/realtime/realtime.gateway.ts` — Socket 连接、私有房间和定向发送边界。
- `apps/api/src/realtime/realtime.gateway.spec.ts` — 连接授权和房间隔离测试。
- `apps/api/src/realtime/realtime-notifier.service.ts` — 面向业务层的尽力而为通知接口。
- `apps/api/src/realtime/realtime-notifier.service.spec.ts` — 定向发送与发送失败降级测试。
- `apps/api/src/realtime/realtime.module.ts` — 注册 Gateway、鉴权和通知服务。

### Modified backend files

- `apps/api/package.json`, `package-lock.json` — 声明 NestJS Socket.IO、Socket.IO 和 Cookie 解析依赖。
- `apps/api/src/app.module.ts` — 导入 `RealtimeModule`。
- `apps/api/src/teams/teams.module.ts` — 导入 `RealtimeModule`。
- `apps/api/src/teams/teams.service.ts` — 仅在新成员保存成功时发布事件。
- `apps/api/src/teams/teams.service.spec.ts` — 验证新建、幂等、竞争和失败分支的发送语义。

### New frontend files

- `apps/web/src/realtime/realtime-types.ts` — 客户端事件与通知类型。
- `apps/web/src/realtime/RealtimeProvider.tsx` — 唯一 Socket 生命周期、事件去重、刷新版本和用户隔离。
- `apps/web/src/realtime/RealtimeProvider.test.tsx` — Socket 生命周期、事件和重连测试。
- `apps/web/src/realtime/RealtimeNotificationCenter.tsx` — 顺序通知、跳转和关闭 UI。
- `apps/web/src/realtime/RealtimeNotificationCenter.test.tsx` — 可访问性、定时关闭和导航测试。

### Modified frontend and documentation files

- `apps/web/package.json`, `package-lock.json` — 声明 `socket.io-client`。
- `apps/web/src/services/api.ts` — 导出统一 API 基础地址供 Socket 客户端复用。
- `apps/web/src/App.tsx` — 登录态下挂载 Provider 和通知中心。
- `apps/web/src/pages/WorkspacePage.tsx` — 消费刷新版本并串行重新加载团队。
- `apps/web/src/pages/WorkspacePage.test.tsx` — 实时刷新、请求合并、失败保留和最终追赶测试。
- `apps/web/src/App.css` — 全局通知的桌面与移动端样式。
- `README.md` — 功能、架构、配置、启动验证和故障排查。

---

### Task 1: Backend realtime connection foundation

**Files:**
- Modify: `apps/api/package.json`
- Modify: `package-lock.json`
- Create: `apps/api/src/realtime/realtime-events.ts`
- Create: `apps/api/src/realtime/realtime-auth.service.ts`
- Create: `apps/api/src/realtime/realtime-auth.service.spec.ts`
- Create: `apps/api/src/realtime/realtime.gateway.ts`
- Create: `apps/api/src/realtime/realtime.gateway.spec.ts`
- Create: `apps/api/src/realtime/realtime-notifier.service.ts`
- Create: `apps/api/src/realtime/realtime-notifier.service.spec.ts`
- Create: `apps/api/src/realtime/realtime.module.ts`
- Modify: `apps/api/src/app.module.ts`

**Interfaces:**
- Consumes: JWT Cookie name `access_token`; `JwtService.verifyAsync<{ sub: string; email: string }>(token)`; environment values `CORS_ORIGIN` and `JWT_SECRET`.
- Produces: `TEAM_MEMBERSHIP_CREATED = 'team.membership.created'`; `TeamMembershipCreatedEvent`; `RealtimeAuthService.authenticate(cookieHeader): Promise<CurrentUserPayload>`; `RealtimeGateway.emitToUser(userId, event, payload): void`; `RealtimeNotifier.notifyTeamMembershipCreated(userId, payload): void`; exported `RealtimeModule`.

- [ ] **Step 1: Install the exact runtime dependencies**

Run:

```bash
npm install --workspace @workspace/api @nestjs/websockets@^11 @nestjs/platform-socket.io@^11 socket.io@^4 cookie@^1
```

Expected: `apps/api/package.json` and root `package-lock.json` record the dependencies without changing unrelated package versions.

- [ ] **Step 2: Write failing authentication, Gateway, and notifier tests**

Create focused tests with these contracts:

```ts
it('authenticates the access_token cookie', async () => {
  jwtService.verifyAsync.mockResolvedValue({ sub: 'user-2', email: 'b@example.com' });
  await expect(service.authenticate('theme=dark; access_token=valid.jwt')).resolves.toEqual({
    id: 'user-2',
    email: 'b@example.com',
  });
  expect(jwtService.verifyAsync).toHaveBeenCalledWith('valid.jwt');
});

it.each([undefined, '', 'theme=dark'])('rejects a missing token: %p', async (cookieHeader) => {
  await expect(service.authenticate(cookieHeader)).rejects.toThrow('请先登录');
});

it('joins only the authenticated user room', async () => {
  authService.authenticate.mockResolvedValue({ id: 'user-2', email: 'b@example.com' });
  await gateway.handleConnection(client);
  expect(client.join).toHaveBeenCalledWith('user:user-2');
  expect(client.disconnect).not.toHaveBeenCalled();
});

it('disconnects an unauthorized socket without joining a room', async () => {
  authService.authenticate.mockRejectedValue(new Error('invalid'));
  await gateway.handleConnection(client);
  expect(client.join).not.toHaveBeenCalled();
  expect(client.disconnect).toHaveBeenCalledWith(true);
});

it('targets only the requested user room', () => {
  gateway.emitToUser('user-2', TEAM_MEMBERSHIP_CREATED, event);
  expect(server.to).toHaveBeenCalledWith('user:user-2');
  expect(emit).toHaveBeenCalledWith(TEAM_MEMBERSHIP_CREATED, event);
});

it('does not throw when socket emission fails', () => {
  gateway.emitToUser.mockImplementation(() => { throw new Error('socket unavailable'); });
  expect(() => notifier.notifyTeamMembershipCreated('user-2', event)).not.toThrow();
  expect(logger.error).toHaveBeenCalled();
});
```

Also assert invalid JWT payloads with missing/empty `sub` or `email` are rejected.

- [ ] **Step 3: Run the focused tests to verify RED**

Run:

```bash
npm run test --workspace @workspace/api -- --runInBand realtime
```

Expected: FAIL because the realtime module, event contract, services and Gateway do not exist.

- [ ] **Step 4: Implement the event contract and Cookie/JWT authentication**

Use these exact public shapes:

```ts
export const TEAM_MEMBERSHIP_CREATED = 'team.membership.created' as const;

export interface TeamMembershipCreatedEvent {
  eventId: string;
  teamId: string;
  teamName: string;
  role: 'member';
  occurredAt: string;
}
```

```ts
@Injectable()
export class RealtimeAuthService {
  constructor(private readonly jwtService: JwtService) {}

  async authenticate(cookieHeader: string | undefined): Promise<CurrentUserPayload> {
    const token = parse(cookieHeader ?? '').access_token;
    if (!token) throw new UnauthorizedException('请先登录');

    try {
      const payload = await this.jwtService.verifyAsync<JwtPayload>(token);
      if (!payload.sub || !payload.email) throw new Error('invalid payload');
      return { id: payload.sub, email: payload.email };
    } catch {
      throw new UnauthorizedException('登录状态已失效');
    }
  }
}
```

- [ ] **Step 5: Implement private rooms and the business-facing notifier**

Gateway behavior must remain server-controlled:

```ts
@WebSocketGateway({
  cors: {
    origin: process.env.CORS_ORIGIN ?? 'http://localhost:5173',
    credentials: true,
  },
})
export class RealtimeGateway implements OnGatewayConnection {
  @WebSocketServer() server!: Server;

  async handleConnection(client: Socket): Promise<void> {
    try {
      const user = await this.auth.authenticate(client.handshake.headers.cookie);
      await client.join(`user:${user.id}`);
    } catch {
      client.disconnect(true);
    }
  }

  emitToUser(userId: string, event: string, payload: unknown): void {
    this.server.to(`user:${userId}`).emit(event, payload);
  }
}
```

`RealtimeNotifier.notifyTeamMembershipCreated` must wrap `emitToUser` in `try/catch`, log event name plus target user ID without logging Cookie/JWT data, and return `void`.

Register `RealtimeAuthService`, `RealtimeGateway`, and `RealtimeNotifier` in `RealtimeModule`; import `AuthModule` to reuse `JwtModule`; export only `RealtimeNotifier`; import `RealtimeModule` once from `AppModule`.

- [ ] **Step 6: Run focused and full API verification**

Run:

```bash
npm run test --workspace @workspace/api -- --runInBand realtime
npm run test --workspace @workspace/api -- --runInBand
npm run build --workspace @workspace/api
```

Expected: all realtime tests pass, all existing API tests pass, and Nest build exits 0.

- [ ] **Step 7: Commit the backend realtime foundation**

```bash
git add apps/api/package.json package-lock.json apps/api/src/realtime apps/api/src/app.module.ts
git commit -m "feat: add authenticated realtime gateway"
```

---

### Task 2: Publish one event for a newly persisted membership

**Files:**
- Modify: `apps/api/src/teams/teams.module.ts`
- Modify: `apps/api/src/teams/teams.service.ts`
- Modify: `apps/api/src/teams/teams.service.spec.ts`

**Interfaces:**
- Consumes: `RealtimeNotifier.notifyTeamMembershipCreated(userId: string, event: TeamMembershipCreatedEvent): void` from Task 1.
- Produces: unchanged `TeamsService.addTeamMember(...): Promise<TeamMemberSummary>` REST behavior plus exactly-once best-effort event publication for the successful insert path.

- [ ] **Step 1: Extend the service fixture and write failing publication tests**

Inject a mocked notifier and a `Team` repository that returns `{ id: 'team-1', name: '产品研发组' }`. Make saved membership data deterministic:

```ts
const savedMembership = {
  id: 'membership-2',
  role: TeamMemberRole.Member,
  user: invitedUser,
  createdAt: new Date('2026-08-14T08:00:00.000Z'),
} as TeamMember;
```

Add these assertions:

```ts
expect(notifier.notifyTeamMembershipCreated).toHaveBeenCalledWith('member-user-2', {
  eventId: 'membership-2',
  teamId: 'team-1',
  teamName: '产品研发组',
  role: 'member',
  occurredAt: '2026-08-14T08:00:00.000Z',
});
```

The existing-member, `23505` recovery, and non-unique failure tests must each assert:

```ts
expect(notifier.notifyTeamMembershipCreated).not.toHaveBeenCalled();
```

Add a notifier-failure test proving `addTeamMember` still resolves to `memberSummary`; the notifier implementation from Task 1 is non-throwing, so model this with a real `RealtimeNotifier` test double or a mock that records the call without rejecting.

- [ ] **Step 2: Run the service spec to verify RED**

Run:

```bash
npm run test --workspace @workspace/api -- --runInBand teams.service.spec.ts
```

Expected: FAIL because `TeamsService` does not inject or call `RealtimeNotifier`, and does not load the team name or use the saved membership metadata.

- [ ] **Step 3: Implement the minimal publication path**

Import `RealtimeModule` in `TeamsModule`. Inject `RealtimeNotifier` into `TeamsService`. After owner validation, load the team summary needed for the event:

```ts
const team = await this.dataSource.getRepository(Team).findOne({
  where: { id: teamId },
  select: { id: true, name: true },
});
if (!team) throw new NotFoundException('团队不存在');
```

Keep all current idempotency branches. Only the ordinary successful save path may publish:

```ts
const savedMember = await teamMemberRepository.save(member);
this.realtimeNotifier.notifyTeamMembershipCreated(user.id, {
  eventId: savedMember.id,
  teamId: team.id,
  teamName: team.name,
  role: 'member',
  occurredAt: savedMember.createdAt.toISOString(),
});
return this.toTeamMemberSummary(savedMember);
```

Do not publish in the existing-member return, `23505` recovery return, or any catch branch. Do not change the controller response schema.

- [ ] **Step 4: Run focused and full API verification**

Run:

```bash
npm run test --workspace @workspace/api -- --runInBand teams.service.spec.ts
npm run test --workspace @workspace/api -- --runInBand
npm run build --workspace @workspace/api
```

Expected: focused spec, all API tests, and API build pass.

- [ ] **Step 5: Commit invitation publication**

```bash
git add apps/api/src/teams/teams.module.ts apps/api/src/teams/teams.service.ts apps/api/src/teams/teams.service.spec.ts
git commit -m "feat: publish realtime team invitations"
```

---

### Task 3: Frontend realtime provider and user-session isolation

**Files:**
- Modify: `apps/web/package.json`
- Modify: `package-lock.json`
- Modify: `apps/web/src/services/api.ts`
- Create: `apps/web/src/realtime/realtime-types.ts`
- Create: `apps/web/src/realtime/RealtimeProvider.tsx`
- Create: `apps/web/src/realtime/RealtimeProvider.test.tsx`

**Interfaces:**
- Consumes: Socket.IO endpoint derived from exported `apiBaseUrl`; event `team.membership.created` with the Task 1 payload.
- Produces: `RealtimeProvider({ user, children })`; `useRealtime()` returning `{ notifications, dismissNotification, teamRefreshVersion }`; notification objects with `eventId`, `teamId`, `teamName`, and `occurredAt`.

- [ ] **Step 1: Install the client dependency**

Run:

```bash
npm install --workspace @workspace/web socket.io-client@^4
```

Expected: `apps/web/package.json` and root `package-lock.json` record the dependency.

- [ ] **Step 2: Write failing Provider tests with a mocked Socket.IO client**

Mock `io` and capture registered handlers. Cover these exact behaviors:

```ts
expect(io).toHaveBeenCalledWith(apiBaseUrl, {
  withCredentials: true,
  autoConnect: true,
});
```

```ts
act(() => handlers[TEAM_MEMBERSHIP_CREATED](event));
expect(screen.getByTestId('notification-count')).toHaveTextContent('1');
expect(screen.getByTestId('team-refresh-version')).toHaveTextContent('1');

act(() => handlers[TEAM_MEMBERSHIP_CREATED](event));
expect(screen.getByTestId('notification-count')).toHaveTextContent('1');
expect(screen.getByTestId('team-refresh-version')).toHaveTextContent('1');
```

Assert the first `connect` callback leaves the version at 0, while `disconnect` followed by `connect` increments it once. Rerender from `user-1` to `user-2` and prove the old socket is disconnected, notifications are empty, version returns to 0, and invoking an old captured handler cannot mutate the new user state. Unmount must call `socket.disconnect()`.

- [ ] **Step 3: Run the Provider test to verify RED**

Run:

```bash
npm run test --workspace @workspace/web -- RealtimeProvider.test.tsx
```

Expected: FAIL because the client dependency, Provider, types and exported API base URL do not exist.

- [ ] **Step 4: Implement the typed Provider**

Export the existing API URL constant without changing `apiRequest` behavior:

```ts
export const apiBaseUrl = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3001';
```

Define the client event contract and context value. In the Provider, create one socket per `user.id`, use a monotonically increasing session generation in every callback, and hold handled event IDs in a `Set<string>` scoped to that generation.

Event handling must be equivalent to:

```ts
if (generation !== generationRef.current || seenEventIds.current.has(event.eventId)) return;
seenEventIds.current.add(event.eventId);
setNotifications((current) => [...current, event]);
setTeamRefreshVersion((current) => current + 1);
```

Track whether the socket has connected before. The first `connect` only sets the flag; any later `connect` after a disconnect increments `teamRefreshVersion`. Cleanup invalidates the generation before removing listeners and disconnecting.

- [ ] **Step 5: Run focused and full Web verification**

Run:

```bash
npm run test --workspace @workspace/web -- RealtimeProvider.test.tsx
npm run test --workspace @workspace/web
npm run build --workspace @workspace/web
```

Expected: Provider tests, existing Web tests, and Web build pass.

- [ ] **Step 6: Commit the client connection layer**

```bash
git add apps/web/package.json package-lock.json apps/web/src/services/api.ts apps/web/src/realtime/realtime-types.ts apps/web/src/realtime/RealtimeProvider.tsx apps/web/src/realtime/RealtimeProvider.test.tsx
git commit -m "feat: add realtime client provider"
```

---

### Task 4: Global invitation notification UI

**Files:**
- Create: `apps/web/src/realtime/RealtimeNotificationCenter.tsx`
- Create: `apps/web/src/realtime/RealtimeNotificationCenter.test.tsx`
- Modify: `apps/web/src/App.tsx`
- Modify: `apps/web/src/App.css`

**Interfaces:**
- Consumes: `useRealtime()` notification queue and `dismissNotification(eventId)` from Task 3.
- Produces: global accessible status UI mounted for authenticated routes; team navigation to `/teams/:teamId/projects`.

- [ ] **Step 1: Write failing notification UI tests**

Wrap the component with `MemoryRouter` and a test context value. Use fake timers and assert:

```ts
expect(screen.getByRole('status')).toHaveTextContent('你已加入「产品研发组」');
expect(screen.getByRole('link', { name: '查看团队' })).toHaveAttribute(
  'href',
  '/teams/team-1/projects',
);
```

For two queued notifications, assert only the first is visible; clicking “关闭” calls `dismissNotification('membership-1')`, then the second becomes visible. Advance timers by 5000 ms and assert the current notification is dismissed once. Clicking “查看团队” must dismiss the current event and navigate to the team route.

- [ ] **Step 2: Run the notification test to verify RED**

Run:

```bash
npm run test --workspace @workspace/web -- RealtimeNotificationCenter.test.tsx
```

Expected: FAIL because the notification center does not exist.

- [ ] **Step 3: Implement sequential, accessible notifications**

Render only `notifications[0]`. Reset a five-second timer whenever its `eventId` changes, and clear the timer on cleanup:

```tsx
<aside className="realtime-notification" role="status" aria-live="polite">
  <p>你已加入「{notification.teamName}」</p>
  <Link to={`/teams/${notification.teamId}/projects`} onClick={dismissCurrent}>
    查看团队
  </Link>
  <button type="button" onClick={dismissCurrent} aria-label="关闭团队邀请通知">
    关闭
  </button>
</aside>
```

Add fixed-position desktop styling and a mobile breakpoint that keeps the notification within the viewport. Do not modify existing page layout.

Mount `RealtimeProvider` and `RealtimeNotificationCenter` only after session restoration when `currentUser` is non-null. Preserve all current route guards and pass the same `currentUser` to `WorkspacePage`.

- [ ] **Step 4: Run focused and full Web verification**

Run:

```bash
npm run test --workspace @workspace/web -- RealtimeNotificationCenter.test.tsx RealtimeProvider.test.tsx
npm run test --workspace @workspace/web
npm run build --workspace @workspace/web
```

Expected: focused tests, all Web tests, and build pass.

- [ ] **Step 5: Commit the notification UI**

```bash
git add apps/web/src/realtime/RealtimeNotificationCenter.tsx apps/web/src/realtime/RealtimeNotificationCenter.test.tsx apps/web/src/App.tsx apps/web/src/App.css
git commit -m "feat: show realtime team invitations"
```

---

### Task 5: Refresh the workspace team list without request races

**Files:**
- Modify: `apps/web/src/pages/WorkspacePage.tsx`
- Modify: `apps/web/src/pages/WorkspacePage.test.tsx`

**Interfaces:**
- Consumes: `teamRefreshVersion` from `useRealtime()`.
- Produces: initial and realtime-driven `GET /api/teams` loading with at most one request in flight and one queued follow-up; successful create-team behavior remains unchanged.

- [ ] **Step 1: Write failing refresh and race tests**

Render `WorkspacePage` through a controllable realtime context. Cover:

1. Initial load returns `旧团队`; increasing `teamRefreshVersion` causes a second GET whose response replaces it with `旧团队` plus `新团队`.
2. While the second GET is deferred, increase the version twice; assert no third concurrent GET. After the second resolves, assert exactly one third GET occurs and its result is authoritative.
3. Make a realtime refresh reject; assert the old teams remain visible and the alert says `实时同步失败，可刷新页面重试`.
4. After that failure, increase the version again and return success; assert the error clears and the list catches up.
5. Unmount or switch Provider user while a GET is pending; resolving the obsolete GET must not update the new context.

Use explicit deferred promises rather than timer sleeps:

```ts
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}
```

- [ ] **Step 2: Run the workspace spec to verify RED**

Run:

```bash
npm run test --workspace @workspace/web -- WorkspacePage.test.tsx
```

Expected: new tests fail because `WorkspacePage` only loads once and has no realtime refresh coordinator.

- [ ] **Step 3: Extract one reusable load path and implement single-flight refresh**

Read `teamRefreshVersion` from the context. Keep these refs:

```ts
const loadInFlightRef = useRef(false);
const reloadQueuedRef = useRef(false);
const requestGenerationRef = useRef(0);
```

The load function must follow this state machine:

```ts
if (loadInFlightRef.current) {
  reloadQueuedRef.current = true;
  return;
}
loadInFlightRef.current = true;
do {
  reloadQueuedRef.current = false;
  await loadTeamsFromApiForCurrentGeneration();
} while (reloadQueuedRef.current && generationIsCurrent());
loadInFlightRef.current = false;
```

Use initial-load copy only before the first result. Realtime refresh failures preserve the current team array and use the exact message `实时同步失败，可刷新页面重试`. A later success clears that message. Cleanup increments the request generation so stale success, error, and finally paths are inert.

The existing create-team POST must still append an owner team and must not be overwritten by an older GET; if a GET predates a successful creation, mark one reload queued so the final server response reconciles the list.

- [ ] **Step 4: Run focused and full Web verification**

Run:

```bash
npm run test --workspace @workspace/web -- WorkspacePage.test.tsx RealtimeProvider.test.tsx
npm run test --workspace @workspace/web
npm run build --workspace @workspace/web
```

Expected: workspace race tests, all Web tests, and build pass.

- [ ] **Step 5: Commit workspace synchronization**

```bash
git add apps/web/src/pages/WorkspacePage.tsx apps/web/src/pages/WorkspacePage.test.tsx
git commit -m "feat: sync invited teams in realtime"
```

---

### Task 6: Documentation, full verification, and two-browser acceptance

**Files:**
- Modify: `README.md`

**Interfaces:**
- Consumes: completed API Gateway, invitation publisher, client Provider, notifications, and workspace refresh.
- Produces: reproducible macOS startup and real-time invitation verification instructions; final repository-wide evidence.

- [ ] **Step 1: Update README feature and architecture descriptions**

Add “团队邀请实时通知与自动同步” to 已实现功能. Update the architecture diagram to show:

```text
React UI
  ├─ Cookie 认证的 REST API → PostgreSQL（权威数据）
  └─ Cookie/JWT 鉴权的 Socket.IO → 用户私有房间 → 变更通知 → REST 重新同步
```

State explicitly that no new environment variable is required: Socket.IO reuses `VITE_API_BASE_URL`, `CORS_ORIGIN`, and `JWT_SECRET`.

- [ ] **Step 2: Document exact local verification and troubleshooting**

Add a “实时团队邀请验证” subsection with this sequence:

```text
1. 普通窗口登录 demo.alice@workspace.local。
2. 无痕窗口登录 demo.bob@workspace.local。
3. Alice 在团队页面邀请 Bob。
4. Bob 不刷新页面即可看到通知；返回工作区后团队自动出现。
5. Bob 点击“查看团队”进入项目列表。
6. Alice 重复邀请 Bob，Bob 不应收到第二条通知。
```

Add troubleshooting rows for Socket connection failure, Cookie/CORS mismatch, and offline invitations. Clarify that an offline user may not see a transient toast but will see the team after REST session restoration.

- [ ] **Step 3: Run formatting checks, all tests, and all builds**

Run:

```bash
git diff --check
npm run test
npm run build
```

Expected: no whitespace errors; all API and Web tests pass; both workspace builds exit 0.

- [ ] **Step 4: Perform the two-browser manual acceptance**

Start services in separate terminals:

```bash
npm run dev:api
npm run dev:web
```

Execute every README verification step and additionally confirm:

- WebSocket failure does not prevent HTTP invitation or page refresh.
- The invited user alone receives the event.
- Logout disconnects the old session; a later login does not show the old notification.
- Browser Network shows one successful invitation POST and one invited-user `GET /api/teams` synchronization.

Record any environment limitation honestly; do not claim manual acceptance if two independent browser sessions were not exercised.

- [ ] **Step 5: Commit documentation and final verified state**

```bash
git add README.md
git commit -m "docs: explain realtime team invitations"
```

- [ ] **Step 6: Request final code review before merge or push**

Use `superpowers:requesting-code-review` against the complete feature commit range. The review must check authentication isolation, duplicate-event semantics, stale async callbacks, request serialization, and HTTP fallback before the branch is considered complete.
