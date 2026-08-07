# 项目任务看板 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为团队项目提供可读取、创建和迁移任务状态的三列任务看板。

**Architecture:** 前端新增独立 `TaskBoardPage`，只调用已有 Nest 任务接口，不改变数据库和后端权限。项目列表卡片提供路由入口；页面本地维护三列任务数组，创建或迁移成功后以不可变方式更新当前视图。

**Tech Stack:** React 19、React Router、TypeScript、Vite、Vitest、React Testing Library、已有 `apiRequest` 封装。

## Global Constraints

- 不新增 npm 依赖，不修改后端任务接口、数据库表和权限模型。
- 路由使用 `/projects/:projectId/board`，请求一律经 `apiRequest` 并携带现有 Cookie。
- 仅实现加载、创建、状态迁移；不实现拖拽、删除、指派、评论或 AI 自动分配。
- 请求失败不丢失已经加载或已输入的数据，且只禁用当前发起请求的操作。
- 所有新行为必须有用户可见的 Vitest 覆盖。

---

### Task 1: 定义任务看板前端类型

**Files:**
- Modify: `apps/web/src/types/workspace.ts`
- Test: `apps/web/src/pages/TaskBoardPage.test.tsx`

**Interfaces:**
- Produces `TaskStatus = 'todo' | 'in_progress' | 'done'`。
- Produces `TaskPriority = 'low' | 'medium' | 'high'`。
- Produces `TaskSummary`，字段为 `id`、`title`、`description`、`status`、`priority`、`createdAt`。
- Produces `TaskBoardResponse`，字段为 `projectId` 和 `columns: Record<TaskStatus, TaskSummary[]>`。

- [ ] **Step 1: 写入会因类型缺失而失败的看板测试骨架**

```tsx
const taskBoard: TaskBoardResponse = {
  projectId: 'project-1',
  columns: { todo: [], in_progress: [], done: [] },
};
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm run test --workspace @workspace/web -- TaskBoardPage.test.tsx --run`

Expected: TypeScript 或模块解析报错，指出 `TaskBoardResponse` 或 `TaskBoardPage` 尚不存在。

- [ ] **Step 3: 在 `workspace.ts` 添加严格任务类型**

```ts
export type TaskStatus = 'todo' | 'in_progress' | 'done';

export interface TaskSummary {
  id: string;
  title: string;
  description: string;
  status: TaskStatus;
  priority: 'low' | 'medium' | 'high';
  createdAt: string;
}

export interface TaskBoardResponse {
  projectId: string;
  columns: Record<TaskStatus, TaskSummary[]>;
}
```

- [ ] **Step 4: 运行测试确认类型解析通过**

Run: `npm run test --workspace @workspace/web -- TaskBoardPage.test.tsx --run`

Expected: 不再因任务类型缺失失败。

### Task 2: 增加项目卡片到看板的入口和路由

**Files:**
- Modify: `apps/web/src/pages/ProjectListPage.tsx`
- Modify: `apps/web/src/pages/ProjectListPage.test.tsx`
- Modify: `apps/web/src/App.tsx`
- Create: `apps/web/src/pages/TaskBoardPage.tsx`

**Interfaces:**
- Consumes `ProjectSummary` 的 `id`、`name`。
- Produces链接 `/projects/${project.id}/board`。
- Produces受登录态保护的路由 `/projects/:projectId/board`。

- [ ] **Step 1: 增加项目卡片入口的失败测试**

```tsx
expect(await screen.findByRole('link', { name: '进入 M 测试开发平台架构设计 看板' }))
  .toHaveAttribute('href', '/projects/project-1/board');
```

- [ ] **Step 2: 运行项目列表测试确认失败**

Run: `npm run test --workspace @workspace/web -- ProjectListPage.test.tsx --run`

Expected: 找不到“进入 … 看板”链接。

- [ ] **Step 3: 添加入口与受保护路由**

```tsx
<Link className="card-link" to={`/projects/${project.id}/board`}>
  进入 {project.name} 看板
</Link>

<Route
  path="/projects/:projectId/board"
  element={currentUser ? <TaskBoardPage /> : <Navigate to="/login" replace />}
/>
```

- [ ] **Step 4: 运行项目列表测试确认通过**

Run: `npm run test --workspace @workspace/web -- ProjectListPage.test.tsx --run`

Expected: 项目入口的文案和 URL 正确。

### Task 3: 实现任务看板加载与三列展示

**Files:**
- Create: `apps/web/src/pages/TaskBoardPage.tsx`
- Create: `apps/web/src/pages/TaskBoardPage.test.tsx`
- Modify: `apps/web/src/App.css`

**Interfaces:**
- Consumes `apiRequest<TaskBoardResponse>('api/projects/${projectId}/tasks')`。
- Consumes `TaskStatus` 与 `TaskSummary`。
- Produces三列标题“待办”“进行中”“已完成”。

- [ ] **Step 1: 写入返回三列任务的失败测试**

```tsx
expect(await screen.findByRole('heading', { name: '项目任务看板' })).toBeInTheDocument();
expect(screen.getByText('梳理项目接口')).toBeInTheDocument();
expect(screen.getByText('实现登录页面')).toBeInTheDocument();
expect(screen.getByText('发布第一版')).toBeInTheDocument();
```

测试 Mock `GET /api/projects/project-1/tasks`，返回一项待办、一项进行中、一项已完成任务。

- [ ] **Step 2: 运行看板测试确认失败**

Run: `npm run test --workspace @workspace/web -- TaskBoardPage.test.tsx --run`

Expected: 无法解析 `TaskBoardPage` 或找不到三列任务文本。

- [ ] **Step 3: 以受控状态实现加载、错误和三列 UI**

```tsx
const [board, setBoard] = useState<TaskBoardResponse | null>(null);
const [isLoading, setIsLoading] = useState(true);
const [errorMessage, setErrorMessage] = useState('');

useEffect(() => {
  let isActive = true;
  async function loadBoard() {
    try {
      const result = await apiRequest<TaskBoardResponse>(`api/projects/${projectId}/tasks`);
      if (isActive) setBoard(result);
    } catch (error: unknown) {
      if (isActive) setErrorMessage(error instanceof Error ? error.message : '任务看板加载失败，请稍后重试');
    } finally {
      if (isActive) setIsLoading(false);
    }
  }
  void loadBoard();
  return () => { isActive = false; };
}, [projectId]);
```

为 `.task-board`、`.task-column` 和 `.task-card` 添加现有卡片视觉体系内的响应式样式。

- [ ] **Step 4: 运行看板测试确认通过**

Run: `npm run test --workspace @workspace/web -- TaskBoardPage.test.tsx --run`

Expected: 三列和接口任务均可见。

### Task 4: 创建任务并在待办列即时显示

**Files:**
- Modify: `apps/web/src/pages/TaskBoardPage.tsx`
- Modify: `apps/web/src/pages/TaskBoardPage.test.tsx`

**Interfaces:**
- Consumes `POST /api/projects/:projectId/tasks`，Body 为 `{ title, description, priority }`。
- Produces创建成功后追加到 `board.columns.todo` 的 `TaskSummary`。

- [ ] **Step 1: 写入创建任务的失败测试**

```tsx
await user.type(screen.getByLabelText('任务标题'), '实现任务创建');
await user.click(screen.getByRole('button', { name: '创建任务' }));
expect(await screen.findByText('实现任务创建')).toBeInTheDocument();
expect(screen.getByRole('button', { name: '创建任务' })).toBeEnabled();
```

测试 Mock `POST /api/projects/project-1/tasks` 返回状态为 `todo` 的完整任务对象。

- [ ] **Step 2: 运行看板测试确认失败**

Run: `npm run test --workspace @workspace/web -- TaskBoardPage.test.tsx --run`

Expected: 找不到任务标题输入框或创建后没有任务卡片。

- [ ] **Step 3: 实现受控创建表单与不可变追加**

```tsx
setBoard((current) => current
  ? { ...current, columns: { ...current.columns, todo: [...current.columns.todo, createdTask] } }
  : current,
);
```

创建中只禁用“创建任务”按钮；失败时保留标题、描述和优先级值并显示 `role="alert"`。

- [ ] **Step 4: 运行看板测试确认通过**

Run: `npm run test --workspace @workspace/web -- TaskBoardPage.test.tsx --run`

Expected: 新任务显示在待办列，创建按钮恢复可用。

### Task 5: 迁移任务状态并完成全量验证

**Files:**
- Modify: `apps/web/src/pages/TaskBoardPage.tsx`
- Modify: `apps/web/src/pages/TaskBoardPage.test.tsx`
- Modify: `apps/web/src/App.css`

**Interfaces:**
- Consumes `PATCH /api/tasks/:taskId/status`，Body 为 `{ status: TaskStatus }`。
- Produces迁移成功后从当前列移除并加入目标列。

- [ ] **Step 1: 写入迁移任务的失败测试**

```tsx
await user.click(screen.getByRole('button', { name: '移动“梳理项目接口”到进行中' }));
await waitFor(() => {
  expect(screen.getByRole('region', { name: '进行中' })).toHaveTextContent('梳理项目接口');
});
```

测试 Mock `PATCH /api/tasks/task-1/status` 返回 `status: 'in_progress'` 的完整任务对象。

- [ ] **Step 2: 运行看板测试确认失败**

Run: `npm run test --workspace @workspace/web -- TaskBoardPage.test.tsx --run`

Expected: 找不到迁移按钮或任务仍停留在待办列。

- [ ] **Step 3: 实现按任务维度禁用的状态迁移**

```tsx
setBoard((current) => current
  ? {
      ...current,
      columns: {
        ...current.columns,
        [fromStatus]: current.columns[fromStatus].filter((item) => item.id !== task.id),
        [toStatus]: [...current.columns[toStatus], updatedTask],
      },
    }
  : current,
);
```

使用 `movingTaskId` 仅禁用该任务卡片的迁移按钮；失败时不改动列数据并显示错误。

- [ ] **Step 4: 运行完整前端验证**

Run: `npm run lint --workspace @workspace/web && npm run test --workspace @workspace/web && npm run build --workspace @workspace/web`

Expected: lint 通过、所有 Vitest 测试通过、Vite 生产构建成功。
