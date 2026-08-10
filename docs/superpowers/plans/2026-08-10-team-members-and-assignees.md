# 团队成员邀请与任务指派 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 支持团队 owner 邀请已注册成员，并在创建和展示任务时安全地使用负责人信息。

**Architecture:** NestJS 在既有 `teams`、`tasks` 模块中新增成员读写与安全 DTO 映射；所有操作复用 `team_members` 关系表与 JWT Guard。React 项目页管理成员，任务看板按返回的 `teamId` 加载成员并在创建任务时传递可选负责人。

**Tech Stack:** NestJS、TypeORM、PostgreSQL、React 19、React Router、TypeScript、Vitest、Supertest。

## Global Constraints

- 不新增依赖、不重建数据库 Schema、不实施邮件邀请、成员移除、角色编辑或任务编辑。
- owner 才能邀请成员；所有读取和写入均验证当前用户所属团队。
- 用户响应仅暴露 `id`、`displayName`、`email`、`role`，绝不返回 `passwordHash`。
- 任务负责人是可选字段；指定负责人时必须属于该任务项目的团队。
- 所有新增逻辑遵循先失败测试、后最小实现、再全量验证。

---

### Task 1: 团队成员 API 与权限校验

**Files:**
- Create: `apps/api/src/teams/dto/add-team-member.dto.ts`
- Modify: `apps/api/src/teams/teams.controller.ts`
- Modify: `apps/api/src/teams/teams.service.ts`
- Modify: `apps/api/src/teams/teams.controller.spec.ts`

**Interfaces:**
- Produces `GET /api/teams/:teamId/members`。
- Produces `POST /api/teams/:teamId/members`，Body 为 `{ email: string }`。
- Produces `TeamMemberSummary = { id, displayName, email, role }`。

- [ ] **Step 1: 写入 owner 邀请与非 owner 拒绝测试**

```ts
expect(response.status).toBe(201);
expect(response.body).toEqual({ id: 'member-user-2', displayName: '成员二', email: 'member@example.com', role: 'member' });

expect(forbiddenResponse.status).toBe(403);
```

同时覆盖重复邀请返回 409、用户不存在返回 404，以及成员列表不含 `passwordHash`。

- [ ] **Step 2: 运行团队测试确认失败**

Run: `npm run test --workspace @workspace/api -- teams.controller.spec.ts --run`

Expected: 路由或服务方法尚不存在。

- [ ] **Step 3: 实现 DTO、成员查找和成员关系写入**

```ts
async addMember(teamId: string, email: string, requesterId: string): Promise<TeamMemberSummary> {
  await this.requireOwner(teamId, requesterId);
  const user = await userRepository.findOne({ where: { email: email.trim().toLowerCase() } });
  if (!user) throw new NotFoundException('用户不存在');
  // 已存在成员返回 ConflictException；否则保存 TeamMemberRole.Member。
}
```

成员列表查询使用 `relations: { user: true }`，再显式映射公开字段。

- [ ] **Step 4: 运行团队测试确认通过**

Run: `npm run test --workspace @workspace/api -- teams.controller.spec.ts --run`

Expected: owner 可添加，重复和越权被拒绝，响应不含敏感字段。

### Task 2: 任务负责人校验与安全任务响应

**Files:**
- Modify: `apps/api/src/tasks/dto/create-task.dto.ts`
- Modify: `apps/api/src/tasks/tasks.service.ts`
- Modify: `apps/api/src/tasks/tasks.controller.spec.ts`

**Interfaces:**
- `CreateTaskDto` 增加可选 UUID `assigneeId`。
- `GET /api/projects/:projectId/tasks` 返回 `{ projectId, teamId, columns }`。
- 每个任务映射为 `TaskSummary`，`assignee` 为 `{ id, displayName, email } | null`。

- [ ] **Step 1: 写入负责人归属校验和安全映射测试**

```ts
expect(response.status).toBe(201);
expect(response.body.assignee).toMatchObject({ id: 'member-1', displayName: '成员一' });

expect(invalidAssigneeResponse.status).toBe(400);
expect(boardResponse.body.columns.todo[0].assignee).not.toHaveProperty('passwordHash');
```

- [ ] **Step 2: 运行任务测试确认失败**

Run: `npm run test --workspace @workspace/api -- tasks.controller.spec.ts --run`

Expected: `assigneeId` 被忽略、`teamId` 缺失或安全任务映射尚未实现。

- [ ] **Step 3: 实现负责人成员校验与任务 DTO 映射**

```ts
const assignee = input.assigneeId
  ? await this.getTeamMemberUser(input.assigneeId, project.team.id)
  : null;

return {
  id: task.id,
  title: task.title,
  description: task.description,
  status: task.status,
  priority: task.priority,
  createdAt: task.createdAt,
  assignee: task.assignee ? pickPublicUser(task.assignee) : null,
};
```

`getTeamMemberUser` 未命中时抛出 `BadRequestException('负责人必须是团队成员')`。

- [ ] **Step 4: 运行任务测试确认通过**

Run: `npm run test --workspace @workspace/api -- tasks.controller.spec.ts --run`

Expected: 负责人可保存，非法负责人被拒绝，任务响应安全。

### Task 3: 前端成员类型、项目页成员区与邀请交互

**Files:**
- Modify: `apps/web/src/types/workspace.ts`
- Modify: `apps/web/src/pages/ProjectListPage.tsx`
- Modify: `apps/web/src/pages/ProjectListPage.test.tsx`
- Modify: `apps/web/src/App.css`

**Interfaces:**
- Produces `TeamMemberSummary = { id, displayName, email, role }`。
- Consumes `GET /api/teams/:teamId/members` 和 `POST /api/teams/:teamId/members`。
- Produces成员列表与“邀请成员”表单。

- [ ] **Step 1: 写入成员加载和邀请成功的失败测试**

```tsx
expect(await screen.findByText('成员二')).toBeInTheDocument();
await user.type(screen.getByLabelText('成员邮箱'), 'member@example.com');
await user.click(screen.getByRole('button', { name: '邀请成员' }));
expect(await screen.findByText('新成员')).toBeInTheDocument();
```

Mock 成员 GET 与成员 POST；断言 POST body 为 `{"email":"member@example.com"}`。

- [ ] **Step 2: 运行项目页测试确认失败**

Run: `npm run test --workspace @workspace/web -- ProjectListPage.test.tsx --run`

Expected: 成员区和邀请输入不存在。

- [ ] **Step 3: 实现成员加载、邀请状态和错误展示**

```tsx
const members = await apiRequest<TeamMemberSummary[]>(`api/teams/${teamId}/members`);
const createdMember = await apiRequest<TeamMemberSummary>(`api/teams/${teamId}/members`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email }),
});
setMembers((current) => [...current, createdMember]);
```

邀请中仅禁用邀请按钮；失败保留邮箱输入并使用 `role="alert"` 展示后端消息。

- [ ] **Step 4: 运行项目页测试确认通过**

Run: `npm run test --workspace @workspace/web -- ProjectListPage.test.tsx --run`

Expected: 成员可见，邀请成功后立即追加到当前列表。

### Task 4: 看板负责人选择、展示和全量验证

**Files:**
- Modify: `apps/web/src/types/workspace.ts`
- Modify: `apps/web/src/pages/TaskBoardPage.tsx`
- Modify: `apps/web/src/pages/TaskBoardPage.test.tsx`
- Modify: `apps/web/src/App.css`

**Interfaces:**
- `TaskSummary` 增加 `assignee: { id, displayName, email } | null`。
- `TaskBoardResponse` 增加 `teamId`。
- 创建任务 Body 增加可选 `assigneeId`。

- [ ] **Step 1: 写入负责人下拉与卡片展示的失败测试**

```tsx
await user.selectOptions(screen.getByLabelText('负责人'), 'member-1');
await user.click(screen.getByRole('button', { name: '创建任务' }));
expect(await screen.findByText('负责人：成员一')).toBeInTheDocument();
expect(postBody).toMatchObject({ assigneeId: 'member-1' });
```

Mock 看板携带 `teamId`，并 Mock `GET /api/teams/team-1/members`。

- [ ] **Step 2: 运行看板测试确认失败**

Run: `npm run test --workspace @workspace/web -- TaskBoardPage.test.tsx --run`

Expected: 找不到负责人选择框或创建请求不含 `assigneeId`。

- [ ] **Step 3: 实现成员加载、负责人选择和任务卡片文案**

```tsx
const [assigneeId, setAssigneeId] = useState('');
// board 加载后，以 board.teamId 请求成员；空字符串时不发送 assigneeId。
const payload = { title: taskTitle, description: description.trim(), priority, ...(assigneeId ? { assigneeId } : {}) };
```

卡片固定显示 `负责人：${task.assignee?.displayName ?? '未指派'}`；成员请求失败时仅禁用负责人选择，不影响既有任务看板读取。

- [ ] **Step 4: 运行前后端全量验证**

Run: `npm run lint --workspace @workspace/api && npm run test --workspace @workspace/api && npm run build --workspace @workspace/api && npm run lint --workspace @workspace/web && npm run test --workspace @workspace/web && npm run build --workspace @workspace/web`

Expected: 两端 lint、测试和构建全部通过。
