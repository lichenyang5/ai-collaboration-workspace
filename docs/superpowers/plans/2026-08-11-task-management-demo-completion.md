# 任务管理与作品 Demo 闭环 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 补齐任务筛选、截止日期、归档恢复、活动记录和幂等 Demo 数据，使项目形成可在五分钟内完整展示的全栈作品闭环。

**Architecture:** 保持 React 页面通过现有 `apiRequest` 调用 NestJS REST API，所有团队访问继续由后端校验。PostgreSQL 增加任务归档字段和任务活动表，任务变更与活动写入在同一事务中完成；前端把过大的看板页面拆成职责单一的任务组件，并用 URL 查询参数保存筛选状态。

**Tech Stack:** React 19、React Router 7、TypeScript、Vite、Vitest、Testing Library、NestJS 11、TypeORM、PostgreSQL、Jest、Supertest。

## Global Constraints

- 不新增评论、附件、实时通知、成员角色管理、密码找回或更多 AI 能力。
- 不提供 Demo 初始化 HTTP 接口；seed 仅允许本地命令执行，并在 `NODE_ENV=production` 时拒绝运行。
- 不保存密码明文、Token、真实数据库口令、AI Key 或完整请求体。
- 所有任务读取和写入必须验证当前用户属于项目团队；非成员返回 403。
- 活跃看板默认排除归档任务；只有 `done` 任务可以归档，恢复后仍为 `done`。
- 截止日期以 UTC 日历日和 `YYYY-MM-DD` 表示；临期窗口为今天至未来三天的闭区间。
- 归档、恢复或编辑失败时前端保留原状态；活动加载失败不得阻塞看板。
- 保持现有 AI 草稿编辑和批量创建行为不回归。
- 不新增运行时依赖；数据库脚本复用现有 `pg` 与 `bcryptjs`。

---

## File Structure

### API

- `apps/api/sql/schema.sql`：空数据库的最终结构。
- `apps/api/sql/migrations/20260811_task_archive_and_activities.sql`：存量数据库升级脚本。
- `apps/api/src/database/run-migrations.ts`：按文件名顺序执行并登记 SQL migration。
- `apps/api/src/database/seed-demo.ts`：生产环境保护和 Demo seed 入口。
- `apps/api/src/database/demo-seed.ts`：可测试的幂等 Demo 数据写入逻辑。
- `apps/api/src/database/entities/task-activity.entity.ts`：任务活动实体与事件枚举。
- `apps/api/src/tasks/task-date.ts`：UTC 日期规范化和截止状态计算。
- `apps/api/src/tasks/dto/task-board-query.dto.ts`：看板筛选参数校验。
- `apps/api/src/tasks/dto/archive-task.dto.ts`：归档/恢复请求校验。
- `apps/api/src/tasks/tasks.service.ts`：任务查询、事务变更、归档与活动查询。
- `apps/api/src/tasks/tasks.controller.ts`：筛选、归档和活动 REST 路由。

### Web

- `apps/web/src/components/tasks/TaskFilters.tsx`：筛选控件和 URL 状态输入。
- `apps/web/src/components/tasks/TaskCard.tsx`：任务卡片、截止标签和卡片操作。
- `apps/web/src/components/tasks/TaskEditor.tsx`：现有详情编辑表单。
- `apps/web/src/components/tasks/AiTaskPlanner.tsx`：现有 AI 草稿工作流。
- `apps/web/src/components/tasks/TaskArchivePanel.tsx`：归档列表和恢复操作。
- `apps/web/src/components/tasks/ActivityPanel.tsx`：活动时间线和独立错误状态。
- `apps/web/src/pages/TaskBoardPage.tsx`：页面数据编排与组件组合。
- `apps/web/src/types/workspace.ts`：筛选、归档和活动的共享前端类型。

### Documentation

- `README.md`：真实功能、初始化、迁移、seed、测试、构建和演示说明。
- `docs/demo-script.md`：五分钟演示脚本。
- `docs/images/task-board-demo.png`：任务筛选、截止标签和归档入口截图。
- `docs/images/ai-task-planner-demo.png`：AI 草稿确认截图。

---

### Task 1: 数据库 migration、归档字段和活动实体

**Files:**
- Create: `apps/api/sql/migrations/20260811_task_archive_and_activities.sql`
- Create: `apps/api/src/database/run-migrations.ts`
- Create: `apps/api/src/database/run-migrations.spec.ts`
- Create: `apps/api/src/database/entities/task-activity.entity.ts`
- Modify: `apps/api/sql/schema.sql`
- Modify: `apps/api/src/database/entities/task.entity.ts`
- Modify: `apps/api/src/database/entities/user.entity.ts`
- Modify: `apps/api/src/database/database.module.ts`
- Modify: `apps/api/package.json`
- Test: `apps/api/src/database/entities/database-schema-mapping.spec.ts`

**Interfaces:**
- Produces: `Task.archivedAt: Date | null` and `Task.activities: TaskActivity[]`.
- Produces: `TaskActivityEventType` enum with `created | updated | status_changed | assignee_changed | archived | restored` values.
- Produces: `TaskActivity` entity with `task`, `actor`, `eventType`, `details`, and `createdAt`.
- Produces: `runMigrations(client, migrationsDirectory): Promise<string[]>`, returning the migration names applied by this invocation.
- Produces: `npm run db:migrate --workspace @workspace/api`.

- [ ] **Step 1: Write failing schema mapping and migration runner tests**

```ts
expect(columnName(Task, 'archivedAt')).toBe('archived_at');
expect(joinColumnName(TaskActivity, 'task')).toBe('task_id');
expect(joinColumnName(TaskActivity, 'actor')).toBe('actor_id');
expect(columnName(TaskActivity, 'eventType')).toBe('event_type');
```

In `run-migrations.spec.ts`, create a temporary directory with `002_second.sql` and `001_first.sql`. Use a fake PostgreSQL client at the external boundary that returns `rowCount: 1` for `001_first.sql` and `rowCount: 0` for `002_second.sql`. Assert the returned result is `['002_second.sql']`, the second SQL body executes before its bookkeeping insert, and a simulated SQL failure issues `ROLLBACK` without returning the failed name.

- [ ] **Step 2: Run the focused tests and confirm the missing behavior**

Run: `npm run test --workspace @workspace/api -- database-schema-mapping.spec.ts run-migrations.spec.ts --runInBand`

Expected: FAIL because `TaskActivity`, `Task.archivedAt`, and `runMigrations` do not exist.

- [ ] **Step 3: Add the SQL migration and synchronize the base schema**

```sql
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS task_activities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  actor_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  event_type VARCHAR(32) NOT NULL CHECK (event_type IN (
    'created', 'updated', 'status_changed', 'assignee_changed', 'archived', 'restored'
  )),
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS tasks_project_archived_status_index
  ON tasks (project_id, archived_at, status, created_at DESC);
CREATE INDEX IF NOT EXISTS task_activities_task_created_index
  ON task_activities (task_id, created_at DESC);
CREATE INDEX IF NOT EXISTS task_activities_created_index
  ON task_activities (created_at DESC);
```

- [ ] **Step 4: Add the entities and register them**

```ts
export enum TaskActivityEventType {
  Created = 'created',
  Updated = 'updated',
  StatusChanged = 'status_changed',
  AssigneeChanged = 'assignee_changed',
  Archived = 'archived',
  Restored = 'restored',
}

@Entity({ name: 'task_activities' })
export class TaskActivity {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @ManyToOne(() => Task, (task) => task.activities, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'task_id' }) task!: Task;
  @ManyToOne(() => User, (user) => user.taskActivities, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'actor_id' }) actor!: User;
  @Column({ name: 'event_type', type: 'varchar', length: 32 })
  eventType!: TaskActivityEventType;
  @Column({ type: 'jsonb', default: () => "'{}'::jsonb" })
  details!: Record<string, unknown>;
  @CreateDateColumn({ name: 'created_at' }) createdAt!: Date;
}
```

Add `archivedAt` and the inverse activity relations to `Task` and `User`; add `TaskActivity` to the `entities` array in `database.module.ts`.

- [ ] **Step 5: Add an ordered migration runner**

```ts
export async function runMigrations(
  client: Pick<Client, 'query'>,
  migrationsDirectory: string,
): Promise<string[]> {
const files = (await readdir(migrationsDirectory))
  .filter((name) => name.endsWith('.sql'))
  .sort();

await client.query('CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW())');
for (const name of files) {
  const applied = await client.query('SELECT 1 FROM schema_migrations WHERE name = $1', [name]);
  if (applied.rowCount) continue;
  await client.query('BEGIN');
  try {
    await client.query(await readFile(join(migrationsDirectory, name), 'utf8'));
    await client.query('INSERT INTO schema_migrations(name) VALUES ($1)', [name]);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}
return appliedNames;
}
```

Resolve `migrationsDirectory` with `resolve(process.cwd(), 'sql', 'migrations')`; npm workspace scripts run with `apps/api` as the working directory, so the same path works under `ts-node` and does not depend on compiled `__dirname`. Add `"db:migrate": "ts-node src/database/run-migrations.ts"` to the API scripts. Require `DATABASE_URL` and always close the client in `finally`.

- [ ] **Step 6: Run tests and build**

Run: `npm run test --workspace @workspace/api -- database-schema-mapping.spec.ts run-migrations.spec.ts --runInBand`

Expected: PASS.

Run: `npm run build --workspace @workspace/api`

Expected: exit 0.

- [ ] **Step 7: Commit**

```bash
git add apps/api/sql apps/api/src/database apps/api/src/database/entities apps/api/package.json
git commit -m "添加任务归档与活动数据结构"
```

### Task 2: UTC 截止日期规则和看板筛选 API

**Files:**
- Create: `apps/api/src/tasks/task-date.ts`
- Create: `apps/api/src/tasks/task-date.spec.ts`
- Create: `apps/api/src/tasks/dto/task-board-query.dto.ts`
- Modify: `apps/api/src/tasks/dto/create-task.dto.ts`
- Modify: `apps/api/src/tasks/dto/update-task.dto.ts`
- Modify: `apps/api/src/tasks/tasks.controller.ts`
- Modify: `apps/api/src/tasks/tasks.service.ts`
- Test: `apps/api/src/tasks/tasks.controller.spec.ts`

**Interfaces:**
- Produces: `TaskDueFilter = 'unset' | 'normal' | 'due_soon' | 'overdue'`.
- Produces: `normalizeUtcDate(value: string): Date` and `getTaskDueState(task, now): TaskDueFilter`.
- Produces: `TaskBoardQueryDto { q?, assigneeId?, priority?, due?, view? }`.
- Changes: `TasksService.getTaskBoard(projectId, userId, query)`.

- [ ] **Step 1: Write failing date boundary tests**

```ts
const now = new Date('2026-08-11T12:00:00.000Z');
expect(getTaskDueState({ status: TaskStatus.Todo, dueDate: new Date('2026-08-10T00:00:00Z') }, now)).toBe('overdue');
expect(getTaskDueState({ status: TaskStatus.Todo, dueDate: new Date('2026-08-14T00:00:00Z') }, now)).toBe('due_soon');
expect(getTaskDueState({ status: TaskStatus.Done, dueDate: new Date('2026-08-10T00:00:00Z') }, now)).toBe('normal');
expect(normalizeUtcDate('2026-08-20').toISOString()).toBe('2026-08-20T00:00:00.000Z');
```

- [ ] **Step 2: Write failing controller tests for combined filters**

Request `/api/projects/project-1/tasks?q=接口&assigneeId=<memberId>&priority=high&due=overdue&view=active`; assert the service receives this exact validated object. Add a 400 case for an unsupported `due` value and a 400 case for malformed `assigneeId`.

- [ ] **Step 3: Run focused tests and confirm failure**

Run: `npm run test --workspace @workspace/api -- task-date.spec.ts tasks.controller.spec.ts --runInBand`

Expected: FAIL because the date utility, query DTO, and controller query binding do not exist.

- [ ] **Step 4: Implement strict date and query types**

```ts
export type TaskDueFilter = 'unset' | 'normal' | 'due_soon' | 'overdue';
export type TaskBoardView = 'active' | 'archived';

export function normalizeUtcDate(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

export class TaskBoardQueryDto {
  @IsOptional() @IsString() @MaxLength(200) q?: string;
  @IsOptional() @ValidateIf((_, value) => value !== 'unassigned') @IsUUID()
  assigneeId?: string;
  @IsOptional() @IsEnum(TaskPriority) priority?: TaskPriority;
  @IsOptional() @IsIn(['unset', 'normal', 'due_soon', 'overdue']) due?: TaskDueFilter;
  @IsOptional() @IsIn(['active', 'archived']) view: TaskBoardView = 'active';
}
```

Bind it with `@Query(new ValidationPipe({ whitelist: true, transform: true }))` in the controller.

Keep the existing `dueDate` properties in `CreateTaskDto` and `UpdateTaskDto`, but add `@Matches(/^\d{4}-\d{2}-\d{2}$/)` so full timestamps and locale-formatted dates are rejected. Replace both existing `new Date(input.dueDate)` calls with `normalizeUtcDate(input.dueDate)`.

- [ ] **Step 5: Implement server-side filtering**

Trim `q`; validate a concrete `assigneeId` with `getTeamMemberUser`; build TypeORM `where` clauses that combine project, archived view, assignee, priority and UTC due windows. For keyword search, use two OR branches with identical non-text filters and `ILike('%...%')` on title and description. Keep the grouped board response unchanged.

```ts
const archiveCondition = query.view === 'archived' ? Not(IsNull()) : IsNull();
const baseWhere = {
  project: { id: projectId },
  archivedAt: archiveCondition,
  ...(query.priority ? { priority: query.priority } : {}),
};
```

- [ ] **Step 6: Run focused and full API tests**

Run: `npm run test --workspace @workspace/api -- task-date.spec.ts tasks.controller.spec.ts --runInBand`

Expected: PASS.

Run: `npm run test --workspace @workspace/api -- --runInBand`

Expected: all API suites pass.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/tasks
git commit -m "添加任务截止状态与看板筛选"
```

### Task 3: 任务活动事务和活动列表 API

**Files:**
- Modify: `apps/api/src/tasks/tasks.service.ts`
- Modify: `apps/api/src/tasks/tasks.controller.ts`
- Modify: `apps/api/src/tasks/tasks.module.ts`
- Test: `apps/api/src/tasks/tasks.controller.spec.ts`

**Interfaces:**
- Produces: `TaskActivitySummary` with safe task and actor summaries.
- Produces: `GET /api/projects/:projectId/task-activities`.
- Changes: create, batch-create, edit, and status mutations write activities in the same `DataSource.transaction` callback.

- [ ] **Step 1: Add failing transaction and safe-response tests**

Cover these exact cases:

```ts
expect(activityRepository.save).toHaveBeenCalledWith(
  expect.objectContaining({ eventType: TaskActivityEventType.Created }),
);
expect(transaction).toHaveBeenCalledTimes(1);
expect(response.body[0].actor).not.toHaveProperty('passwordHash');
```

Also reject activity access by a non-member with 403, and assert a title plus due-date edit produces `updated` details while an assignee edit produces `assignee_changed` details.

- [ ] **Step 2: Run the focused test and confirm failure**

Run: `npm run test --workspace @workspace/api -- tasks.controller.spec.ts --runInBand`

Expected: FAIL because no activity repository is used and the activity route returns 404.

- [ ] **Step 3: Define the public activity response**

```ts
export interface TaskActivitySummary {
  id: string;
  eventType: TaskActivityEventType;
  details: Record<string, unknown>;
  createdAt: Date;
  task: { id: string; title: string };
  actor: { id: string; displayName: string; email: string };
}
```

Create private helpers `recordActivity(manager, input)` and `toTaskActivitySummary(activity)`; the presenter must enumerate public fields instead of spreading entities.

Use these stable `details` shapes so the frontend can format records without guessing:

```ts
type TaskActivityDetails =
  | { fields: Record<string, { from: string | null; to: string | null }> }
  | { from: TaskStatus; to: TaskStatus }
  | { fromDisplayName: string | null; toDisplayName: string | null }
  | Record<string, never>;
```

`updated` uses `fields`; `status_changed` uses status `from/to`; `assignee_changed` uses display names; created, archived and restored use an empty object.

- [ ] **Step 4: Make mutations transactional**

Move task repository reads and saves for `createTask`, `createTaskBatch`, `updateTask`, and `updateTaskStatus` into a single transaction per public call. Pass `{ id: userId } as User` as the actor relation. Record only changed fields; do not write an `updated` activity for a no-op edit.

```ts
await this.recordActivity(manager, {
  task: savedTask,
  actorId: userId,
  eventType: TaskActivityEventType.StatusChanged,
  details: { from: previousStatus, to: savedTask.status },
});
```

- [ ] **Step 5: Add the project activity query**

Load the accessible project first, then query `TaskActivity` with task and actor relations, constrain `task.project.id`, order by `createdAt: 'DESC'`, and `take: 50`.

```ts
@Get('projects/:projectId/task-activities')
getTaskActivities(@Param('projectId') projectId: string, @CurrentUser() user: CurrentUserPayload) {
  return this.tasksService.getTaskActivities(projectId, user.id);
}
```

- [ ] **Step 6: Run focused and full API tests**

Run: `npm run test --workspace @workspace/api -- tasks.controller.spec.ts --runInBand`

Expected: PASS.

Run: `npm run test --workspace @workspace/api -- --runInBand`

Expected: all API suites pass.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/tasks
git commit -m "记录并查询任务活动"
```

### Task 4: 任务归档和恢复 API

**Files:**
- Create: `apps/api/src/tasks/dto/archive-task.dto.ts`
- Modify: `apps/api/src/tasks/tasks.controller.ts`
- Modify: `apps/api/src/tasks/tasks.service.ts`
- Test: `apps/api/src/tasks/tasks.controller.spec.ts`

**Interfaces:**
- Produces: `PATCH /api/tasks/:taskId/archive` with `{ archived: boolean }`.
- Produces: `TasksService.setTaskArchived(taskId, archived, userId): Promise<TaskSummary>`.

- [ ] **Step 1: Write failing archive behavior tests**

Add tests for completed-task archive, archived-task restore, non-done rejection, duplicate archive 409, duplicate restore 409, and non-member 403. Assert archive and restore activity events are saved in the same transaction.

```ts
expect(archiveResponse.body.archivedAt).toEqual(expect.any(String));
expect(restoreResponse.body.archivedAt).toBeNull();
```

- [ ] **Step 2: Run the focused test and confirm failure**

Run: `npm run test --workspace @workspace/api -- tasks.controller.spec.ts --runInBand`

Expected: FAIL because the archive route and `archivedAt` response field do not exist.

- [ ] **Step 3: Add DTO, route, response field, and service rules**

```ts
export class ArchiveTaskDto {
  @IsBoolean()
  archived!: boolean;
}
```

Inside one transaction, load task, project team, and assignee; verify membership; reject invalid state with `ConflictException`; set `archivedAt` to `new Date()` or `null`; save; record `Archived` or `Restored`; return a `TaskSummary` that includes `archivedAt`.

- [ ] **Step 4: Run focused tests and API build**

Run: `npm run test --workspace @workspace/api -- tasks.controller.spec.ts --runInBand`

Expected: PASS.

Run: `npm run build --workspace @workspace/api`

Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/tasks
git commit -m "支持任务归档与恢复"
```

### Task 5: 前端组件拆分、URL 筛选和截止日期

**Files:**
- Create: `apps/web/src/components/tasks/TaskEditor.tsx`
- Create: `apps/web/src/components/tasks/AiTaskPlanner.tsx`
- Create: `apps/web/src/components/tasks/TaskCard.tsx`
- Create: `apps/web/src/components/tasks/TaskFilters.tsx`
- Create: `apps/web/src/components/tasks/task-due-state.ts`
- Create: `apps/web/src/components/tasks/task-due-state.test.ts`
- Modify: `apps/web/src/components/tasks/TaskCard.tsx`
- Modify: `apps/web/src/pages/TaskBoardPage.tsx`
- Modify: `apps/web/src/pages/TaskBoardPage.test.tsx`
- Modify: `apps/web/src/types/workspace.ts`
- Modify: `apps/web/src/App.css`

**Interfaces:**
- Produces: controlled `TaskEditor`, `AiTaskPlanner`, and `TaskCard` components; they receive values, pending/error flags, and callbacks and do not call APIs directly.
- Produces: `TaskFilterValues { q, assigneeId, priority, due, view }`.
- Produces: `getTaskDueLabel(task, today): string | null`.
- Changes: task creation payload includes `dueDate` when set.

- [ ] **Step 1: Write failing URL, debounce, create-date, and label tests**

Render with `/projects/project-1/board?q=接口&priority=high&due=overdue`; assert controls restore those values and the board request contains the same query. Type a new keyword and use fake timers to assert only the debounced request runs. Assert failed filtering keeps the previous card visible and exposes “重新加载”.

Add creation coverage:

```ts
body: JSON.stringify({
  title: '带截止日期的任务',
  description: '',
  priority: 'medium',
  dueDate: '2026-08-14',
})
```

Add pure utility expectations for “今天到期”, “三天内到期”, “已逾期”, and no warning on completed tasks.

- [ ] **Step 2: Run focused tests and confirm failure**

Run: `npm run test --workspace @workspace/web -- TaskBoardPage.test.tsx task-due-state.test.ts --run`

Expected: FAIL because filters, date input, query synchronization, and labels do not exist.

- [ ] **Step 3: Add types and pure due-label utility**

```ts
export type TaskDueFilter = 'unset' | 'normal' | 'due_soon' | 'overdue';
export type TaskBoardView = 'active' | 'archived';
export interface TaskFilterValues {
  q: string;
  assigneeId: string;
  priority: '' | TaskPriority;
  due: '' | TaskDueFilter;
  view: TaskBoardView;
}
```

Implement `getTaskDueLabel(task: Pick<TaskSummary, 'status' | 'dueDate'>, today: string): string | null`. Compare only `YYYY-MM-DD` UTC date strings; return `null` for `done` or no date.

- [ ] **Step 4: Extract controlled components while implementing the failing behavior**

Use explicit props rather than passing the entire page state:

```ts
export interface TaskCardProps {
  task: TaskSummary;
  isMoving: boolean;
  dueLabel: string | null;
  onEdit(task: TaskSummary): void;
  onMove(task: TaskSummary): void;
}

export interface UpdateTaskInput {
  title: string;
  description: string;
  priority: TaskPriority;
  assigneeId: string | null;
  dueDate: string | null;
}
```

`TaskEditor` receives the task, members, save state, error and submit/cancel callbacks. `AiTaskPlanner` receives `goal: string`, `drafts: AiTaskDraft[]`, the two pending flags, error text, `onGoalChange(value)`, `onDraftChange(index, draft)`, `onDraftRemove(index)`, `onGenerate()` and `onConfirm()` callbacks. Keep API requests and page state in `TaskBoardPage`. Preserve all current labels and accessible names so existing creation, editing, status and AI tests remain green.

- [ ] **Step 5: Implement URL-backed filters and resilient loading**

Use `useSearchParams`. Parse only supported values, omit empty values, debounce `q` by 250 ms, and issue a new board request when normalized filters change. Maintain `lastSuccessfulBoard`; on failure keep it rendered and show a retry button that increments a request generation counter.

`TaskFilters` receives current values, team members, and `onChange(next)`; it renders keyword,负责人,优先级 and截止状态 controls. `view` is controlled later by the archive panel rather than shown as a generic select.

- [ ] **Step 6: Add creation date and card labels**

Add a `type="date"` creation input. Include `dueDate` only when non-empty, reset it after success, and retain it after failure. Pass the due label into `TaskCard` and style normal/soon/overdue badges in `App.css`.

- [ ] **Step 7: Run focused tests and web build**

Run: `npm run test --workspace @workspace/web -- TaskBoardPage.test.tsx task-due-state.test.ts --run`

Expected: PASS.

Run: `npm run build --workspace @workspace/web`

Expected: exit 0.

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/components/tasks apps/web/src/pages/TaskBoardPage.tsx apps/web/src/pages/TaskBoardPage.test.tsx apps/web/src/types/workspace.ts apps/web/src/App.css
git commit -m "添加任务筛选与截止日期展示"
```

### Task 6: 前端归档区和活动时间线

**Files:**
- Create: `apps/web/src/components/tasks/TaskArchivePanel.tsx`
- Create: `apps/web/src/components/tasks/ActivityPanel.tsx`
- Modify: `apps/web/src/components/tasks/TaskCard.tsx`
- Modify: `apps/web/src/pages/TaskBoardPage.tsx`
- Modify: `apps/web/src/pages/TaskBoardPage.test.tsx`
- Modify: `apps/web/src/types/workspace.ts`
- Modify: `apps/web/src/App.css`

**Interfaces:**
- Produces: `TaskActivitySummary` matching the API safe response.
- Produces: archive confirmation, active/archived view switching, restore action, and independent activity retry.

- [ ] **Step 1: Write failing archive and activity tests**

Cover:

- only done cards show “归档任务：<title>”;
- confirmation cancellation sends no request;
- archive success removes the active card;
- archive failure keeps the card and shows the API message;
- archived view requests `view=archived` and restore returns the task to done;
- activity records render readable Chinese text;
- activity 500 response leaves the board usable and enables “重新加载活动”.

- [ ] **Step 2: Run the page suite and confirm failure**

Run: `npm run test --workspace @workspace/web -- TaskBoardPage.test.tsx --run`

Expected: FAIL because archive and activity UI do not exist.

- [ ] **Step 3: Add public activity types and formatter**

```ts
export interface TaskActivitySummary {
  id: string;
  eventType: 'created' | 'updated' | 'status_changed' | 'assignee_changed' | 'archived' | 'restored';
  details: Record<string, unknown>;
  createdAt: string;
  task: { id: string; title: string };
  actor: { id: string; displayName: string; email: string };
}
```

Also add `archivedAt: string | null` to `TaskSummary`, matching the backend response introduced in Task 4.

`ActivityPanel` maps known event types to fixed Chinese templates and falls back to “更新了任务《标题》”; it never renders `JSON.stringify(details)`.

- [ ] **Step 4: Implement archive and restore state transitions**

Use `window.confirm` immediately before archive. Call `PATCH api/tasks/:id/archive`; mutate local board only after success. When switching archive view, set the URL `view` value and reuse the filtered board loader. Restored tasks are removed from the archived response; switching back to active reloads the done column from the server.

- [ ] **Step 5: Load activities independently**

Fetch `api/projects/:projectId/task-activities` after project ID is known. Store activity data, pending, error, and retry generation separately from board state. After successful create/edit/status/archive/restore, refresh activities; activity refresh failure must not revert the successful task action.

- [ ] **Step 6: Run focused tests and web build**

Run: `npm run test --workspace @workspace/web -- TaskBoardPage.test.tsx --run`

Expected: PASS.

Run: `npm run build --workspace @workspace/web`

Expected: exit 0.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/components/tasks apps/web/src/pages/TaskBoardPage.tsx apps/web/src/pages/TaskBoardPage.test.tsx apps/web/src/types/workspace.ts apps/web/src/App.css
git commit -m "添加任务归档与活动时间线"
```

### Task 7: 幂等 Demo seed

**Files:**
- Create: `apps/api/src/database/demo-seed.ts`
- Create: `apps/api/src/database/demo-seed.spec.ts`
- Create: `apps/api/src/database/seed-demo.ts`
- Create: `apps/api/test/demo-seed.e2e-spec.ts`
- Modify: `apps/api/package.json`
- Modify: `apps/api/.env.example`

**Interfaces:**
- Produces: `seedDemoData(client: Pick<Client, 'query'>, passwordHash: string): Promise<void>`.
- Produces: `npm run db:seed-demo --workspace @workspace/api`.
- Produces: `npm run test:seed --workspace @workspace/api`, using only the explicitly named disposable database `ai_collaboration_workspace_seed_test`.
- Consumes: migration-created `archived_at` and `task_activities` schema.

- [ ] **Step 1: Write failing seed safety and real idempotency tests**

Unit-test the entry guard:

```ts
expect(() => assertDemoSeedEnvironment({ NODE_ENV: 'production', DEMO_USER_PASSWORD: 'x' })).toThrow('生产环境禁止运行 Demo seed');
expect(() => assertDemoSeedEnvironment({ NODE_ENV: 'development' })).toThrow('缺少 DEMO_USER_PASSWORD');
```

In `demo-seed.e2e-spec.ts`, derive a maintenance connection from `TEST_DATABASE_ADMIN_URL` or `DATABASE_URL`, assert the database identifier equals the hard-coded safe constant `ai_collaboration_workspace_seed_test`, create that database, apply `schema.sql` and migrations, call `seedDemoData` twice, and assert the fixed user/team/project/task/activity counts are identical after both calls. In `afterAll`, terminate connections only to that exact database and drop only that exact database.

- [ ] **Step 2: Run both tests and confirm the missing behavior**

Run: `npm run test --workspace @workspace/api -- demo-seed.spec.ts --runInBand`

Expected: FAIL because the guard and seed functions do not exist.

Run: `npm run test:seed --workspace @workspace/api`

Expected: FAIL because `demo-seed.ts` and its database behavior do not exist.

- [ ] **Step 3: Implement fixed, non-destructive Demo data**

Use constants for two users, one team, memberships, one project, representative active/archived tasks and matching activities. Use parameterized queries and `ON CONFLICT (id) DO UPDATE`; never delete rows outside the fixed IDs. Wrap the seed in one transaction and roll back on error. Hash `DEMO_USER_PASSWORD` with bcrypt cost 12 before passing it into the transaction.

```ts
export function assertDemoSeedEnvironment(env: NodeJS.ProcessEnv): void {
  if (env.NODE_ENV === 'production') throw new Error('生产环境禁止运行 Demo seed');
  if (!env.DATABASE_URL) throw new Error('缺少 DATABASE_URL');
  if (!env.DEMO_USER_PASSWORD) throw new Error('缺少 DEMO_USER_PASSWORD');
}
```

- [ ] **Step 4: Add commands and example environment variables**

Add `"db:seed-demo": "ts-node src/database/seed-demo.ts"`, `"test:seed": "jest --config ./test/jest-e2e.json --runInBand demo-seed.e2e-spec.ts"`, `DEMO_USER_PASSWORD=`, and optional `TEST_DATABASE_ADMIN_URL=`. The entrypoint connects once, calls `seedDemoData`, prints only Demo emails and project name, and closes in `finally`; it never prints the password or connection URL.

- [ ] **Step 5: Run tests and build**

Run: `npm run test --workspace @workspace/api -- demo-seed.spec.ts --runInBand`

Expected: PASS.

Run: `npm run test:seed --workspace @workspace/api`

Expected: PASS and drop only `ai_collaboration_workspace_seed_test` during cleanup.

Run: `npm run build --workspace @workspace/api`

Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/database/demo-seed.ts apps/api/src/database/demo-seed.spec.ts apps/api/src/database/seed-demo.ts apps/api/test/demo-seed.e2e-spec.ts apps/api/package.json apps/api/.env.example
git commit -m "添加幂等 Demo 数据脚本"
```

### Task 8: README、演示脚本、截图和最终验证

**Files:**
- Create: `docs/demo-script.md`
- Create: `docs/images/task-board-demo.png`
- Create: `docs/images/ai-task-planner-demo.png`
- Modify: `README.md`

**Interfaces:**
- Consumes: Tasks 1-7 的 migration、seed、UI 和测试命令。
- Produces: 一个新开发者可从空数据库复现的运行说明和五分钟演示材料。

- [ ] **Step 1: Rewrite README against the real repository**

Document the implemented feature list including AI task planning, exact environment variables, and these commands:

```powershell
& 'C:\Program Files\nodejs\npm.cmd' install
& 'C:\Program Files\nodejs\npm.cmd' run db:migrate --workspace @workspace/api
& 'C:\Program Files\nodejs\npm.cmd' run db:seed-demo --workspace @workspace/api
& 'C:\Program Files\nodejs\npm.cmd' run dev:api
& 'C:\Program Files\nodejs\npm.cmd' run dev:web
& 'C:\Program Files\nodejs\npm.cmd' run test
& 'C:\Program Files\nodejs\npm.cmd' run build
```

Explain that `schema.sql` initializes a new database while `db:migrate` upgrades an existing one. Remove the stale statement that AI is out of scope.

- [ ] **Step 2: Write the five-minute demo script**

Use the exact sequence from the design: Demo login, open project, combine filters, edit an overdue task, complete/archive/restore it, inspect activity history, then generate and confirm AI drafts. Include expected visible result after each action and a fallback note when the external AI provider is unavailable.

- [ ] **Step 3: Verify database setup on a disposable database**

Run `npm run test:seed --workspace @workspace/api`. It creates the explicitly named disposable PostgreSQL database, applies `schema.sql` and migrations, runs seed twice, and queries fixed IDs to prove counts do not grow; cleanup drops only `ai_collaboration_workspace_seed_test`.

Expected: both seed runs succeed; fixed user/team/project/task/activity counts are unchanged after the second run.

- [ ] **Step 4: Run full automated verification**

Run: `npm run test`

Expected: all API and web tests pass with 0 failures.

Run: `npm run build`

Expected: both workspaces build with exit 0.

- [ ] **Step 5: Run the five-minute browser walkthrough**

Start API and web services, load the seeded project, and execute every step in `docs/demo-script.md`. Confirm URL filters survive reload, failure-isolated panels remain usable, archive/restore updates the board, activities are readable, and AI failure does not block ordinary task work.

- [ ] **Step 6: Capture final screenshots**

Capture the seeded task board with filter controls, overdue/soon badges, archive action and activity panel into `docs/images/task-board-demo.png`. Capture editable AI drafts before confirmation into `docs/images/ai-task-planner-demo.png`. Ensure screenshots contain only fixed Demo identities and no browser chrome, tokens, passwords, private notifications or unrelated tabs.

- [ ] **Step 7: Check documentation and Git scope**

Run: `rg -n "第一阶段不包含 AI|TBD|FIXME" README.md docs/demo-script.md`

Expected: no matches.

Run: `git diff --check`

Expected: no whitespace errors.

- [ ] **Step 8: Commit**

```bash
git add README.md docs/demo-script.md docs/images
git commit -m "完善作品 Demo 文档与截图"
```

---

## Final Acceptance Checklist

- [ ] `npm run test` reports 0 failures across API and web workspaces.
- [ ] `npm run build` exits 0 for both workspaces.
- [ ] A disposable database passes schema initialization, migration, and two consecutive seed runs.
- [ ] Active and archived task queries enforce membership and return the correct records.
- [ ] Search, assignee, priority and due filters combine correctly and survive page reload.
- [ ] Create/edit/status/archive/restore actions produce safe, readable activity records.
- [ ] Archive and activity failures do not corrupt or block the active board.
- [ ] Existing AI task draft generation and confirmation still work or degrade with a clear provider error.
- [ ] README and `docs/demo-script.md` match the actual commands and visible UI.
- [ ] Final screenshots contain only fixed Demo data and no secrets.
