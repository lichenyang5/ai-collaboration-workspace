# 任务详情编辑 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 团队成员可在项目看板中编辑已有任务的字段和负责人，并立即看到保存后的卡片数据。

**Architecture:** 后端在既有 Tasks 模块中新增一个受 JWT 保护的 PATCH 端点，复用项目团队成员校验和 `TaskSummary` 映射。前端保持单一任务看板页面，在其中维护当前编辑任务和受控表单；保存后按任务 ID 原位替换卡片，不重新加载整个看板。

**Tech Stack:** NestJS、TypeORM、class-validator、React、TypeScript、Vitest、Jest。

## Global Constraints

- 不增加路由、评论、附件、通知、任务删除或筛选。
- 状态流转继续只使用既有 `PATCH /api/tasks/:taskId/status`。
- 编辑负责人必须属于任务所属团队；`null` 表示取消指派。
- 不安装新依赖，不提交或推送 Git。
- 每项生产行为必须先由失败测试定义。

---

### Task 1: 定义编辑接口与服务端权限校验

**Files:**
- Create: `apps/api/src/tasks/dto/update-task.dto.ts`
- Modify: `apps/api/src/tasks/tasks.controller.ts`
- Modify: `apps/api/src/tasks/tasks.service.ts`
- Test: `apps/api/src/tasks/tasks.controller.spec.ts`

**Interfaces:**
- Consumes: `Task`, `TaskPriority`, `TeamMember`、既有 `TaskSummary` 与 `getTeamMemberUser`。
- Produces: `PATCH /api/tasks/:taskId`，请求体为 `UpdateTaskDto`，响应为 `TaskSummary`。

- [ ] **Step 1: 写入失败的控制器测试**

```ts
it('updates editable task fields and keeps the selected team member as assignee', async () => {
  await request(app.getHttpServer())
    .patch('/api/tasks/task-1')
    .set('Authorization', 'Bearer test-token')
    .send({ title: '更新后的任务', priority: TaskPriority.High, assigneeId: memberId })
    .expect(200)
    .expect(({ body }) => {
      expect(body).toMatchObject({
        title: '更新后的任务',
        priority: TaskPriority.High,
        assignee: { id: memberId },
      });
    });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm run test --workspace @workspace/api -- tasks.controller.spec.ts --runInBand`

Expected: 新增测试因路由不存在或接口未实现而失败。

- [ ] **Step 3: 实现 DTO、控制器和服务方法**

```ts
export class UpdateTaskDto {
  @IsOptional() @IsString() @Length(2, 200) title?: string;
  @IsOptional() @IsString() @MaxLength(5000) description?: string;
  @IsOptional() @IsEnum(TaskPriority) priority?: TaskPriority;
  @IsOptional() @IsDateString() dueDate?: string | null;
  @IsOptional() @IsUUID() assigneeId?: string | null;
}

@Patch('tasks/:taskId')
updateTask(@Param('taskId') taskId: string, @Body(...) input: UpdateTaskDto, @CurrentUser() user: CurrentUserPayload) {
  return this.tasksService.updateTask(taskId, input, user.id);
}
```

服务方法加载 `project.team` 与 `assignee`；校验操作者成员资格；仅更新请求中出现的字段；负责人为空时设为 `null`，不为空时通过 `getTeamMemberUser` 校验；保存并返回 `toTaskSummary(savedTask)`。

- [ ] **Step 4: 运行定向测试确认通过**

Run: `npm run test --workspace @workspace/api -- tasks.controller.spec.ts --runInBand`

Expected: `tasks.controller.spec.ts` 全部通过。

### Task 2: 覆盖取消负责人和拒绝非法负责人的后端行为

**Files:**
- Modify: `apps/api/src/tasks/tasks.controller.spec.ts`

**Interfaces:**
- Consumes: Task 1 的 `PATCH /api/tasks/:taskId`。
- Produces: 对取消指派、非法团队成员与现有权限规则的回归保护。

- [ ] **Step 1: 写入失败测试**

```ts
it('removes the assignee when assigneeId is null', async () => {
  const response = await request(app.getHttpServer())
    .patch('/api/tasks/task-1')
    .set('Authorization', 'Bearer test-token')
    .send({ assigneeId: null })
    .expect(200);

  expect(response.body.assignee).toBeNull();
});
```

同时让 mock 的成员查询在未知负责人 ID 时返回 `null`，断言 `PATCH` 返回 400。

- [ ] **Step 2: 运行测试确认失败**

Run: `npm run test --workspace @workspace/api -- tasks.controller.spec.ts --runInBand`

Expected: 测试因 `null` 语义或负责人校验尚不完整而失败。

- [ ] **Step 3: 仅补齐必要分支**

```ts
if ('assigneeId' in input) {
  task.assignee = input.assigneeId
    ? await this.getTeamMemberUser(input.assigneeId, task.project.team.id)
    : null;
}
```

保留 `getTeamMemberUser` 的现有 `BadRequestException`，不重复增加新的成员查询实现。

- [ ] **Step 4: 运行定向测试确认通过**

Run: `npm run test --workspace @workspace/api -- tasks.controller.spec.ts --runInBand`

Expected: 新旧任务接口测试全部通过。

### Task 3: 实现前端任务详情编辑面板

**Files:**
- Modify: `apps/web/src/pages/TaskBoardPage.tsx`
- Modify: `apps/web/src/types/workspace.ts`
- Modify: `apps/web/src/index.css`
- Test: `apps/web/src/pages/TaskBoardPage.test.tsx`

**Interfaces:**
- Consumes: `TaskSummary`、团队成员列表、`PATCH /api/tasks/:taskId`。
- Produces: 卡片“编辑详情”入口和同页可保存/取消的任务详情表单。

- [ ] **Step 1: 写入失败的用户可见测试**

```tsx
it('updates the task card after editing its details', async () => {
  renderBoard();
  await user.click(await screen.findByRole('button', { name: '编辑详情：梳理项目接口' }));
  await user.clear(screen.getByLabelText('编辑任务标题'));
  await user.type(screen.getByLabelText('编辑任务标题'), '更新接口文档');
  await user.click(screen.getByRole('button', { name: '保存修改' }));
  expect(await screen.findByText('更新接口文档')).toBeInTheDocument();
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm run test --workspace @workspace/web -- TaskBoardPage.test.tsx --run`

Expected: 找不到编辑详情按钮或表单。

- [ ] **Step 3: 实现最小表单和原位替换**

```ts
const [editingTask, setEditingTask] = useState<TaskSummary | null>(null);
const [editTitle, setEditTitle] = useState('');

function replaceTask(updatedTask: TaskSummary) {
  setBoard((current) => current ? {
    ...current,
    columns: Object.fromEntries(Object.entries(current.columns).map(([status, tasks]) => [
      status,
      tasks.map((task) => task.id === updatedTask.id ? updatedTask : task),
    ])) as TaskBoardResponse['columns'],
  } : current);
}
```

打开时从选中任务初始化所有字段；保存时传递已编辑字段；成功后调用 `replaceTask` 并关闭面板；取消只关闭面板。CSS 使用现有工作区卡片、表单和按钮视觉变量，窄屏下将面板保持单列。

- [ ] **Step 4: 运行定向测试确认通过**

Run: `npm run test --workspace @workspace/web -- TaskBoardPage.test.tsx --run`

Expected: 看板测试全部通过，保存后卡片显示更新数据。

### Task 4: 覆盖取消和失败交互并做全量验证

**Files:**
- Modify: `apps/web/src/pages/TaskBoardPage.test.tsx`

**Interfaces:**
- Consumes: Task 3 的详情面板和编辑请求。
- Produces: 取消不请求、保存失败保留输入内容的回归测试。

- [ ] **Step 1: 写入失败交互测试**

```tsx
it('does not request an update when detail editing is cancelled', async () => {
  renderBoard();
  await user.click(await screen.findByRole('button', { name: '编辑详情：梳理项目接口' }));
  await user.click(screen.getByRole('button', { name: '取消编辑' }));
  expect(fetchMock).not.toHaveBeenCalledWith(expect.stringContaining('/api/tasks/task-todo'), expect.objectContaining({ method: 'PATCH' }));
});
```

另写一项 `PATCH` 返回错误时详情面板仍显示用户填写的标题和接口错误消息。

- [ ] **Step 2: 运行测试确认失败**

Run: `npm run test --workspace @workspace/web -- TaskBoardPage.test.tsx --run`

Expected: 新增取消或失败断言失败。

- [ ] **Step 3: 补齐失败状态与禁用逻辑**

```tsx
<button type="submit" disabled={isSavingTask}>
  {isSavingTask ? '保存中…' : '保存修改'}
</button>
<button type="button" disabled={isSavingTask} onClick={closeTaskEditor}>取消编辑</button>
```

失败时仅设置详情面板错误状态，不清空编辑字段；保存中禁止重复提交和关闭面板。

- [ ] **Step 4: 完整验证**

Run:
```bash
npm run test --workspace @workspace/api -- --runInBand
npm run build --workspace @workspace/api
npm run lint --workspace @workspace/web
npm run test --workspace @workspace/web
npm run build --workspace @workspace/web
```

Expected: 前后端测试、构建及前端 lint 均通过。
