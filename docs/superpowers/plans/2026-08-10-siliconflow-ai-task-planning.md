# 硅基流动 AI 任务拆解 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 团队成员可基于项目目标生成可编辑的硅基流动任务草稿，并确认后批量创建待办任务。

**Architecture:** `AiModule` 仅负责通过 Node 原生 fetch 调用硅基流动、解析和校验草稿 JSON；Tasks 模块负责项目成员权限与事务化批量创建。前端复用任务看板页面，草稿始终只存在于浏览器状态，确认创建后由后端返回标准 `TaskSummary[]` 并追加到待办列。

**Tech Stack:** NestJS、TypeORM、class-validator、Node fetch、React、TypeScript、Jest、Vitest。

## Global Constraints

- API Key 仅通过 `SILICONFLOW_API_KEY` 在后端读取，禁止发送到前端、日志或测试输出。
- 默认模型为 `Qwen/Qwen2.5-7B-Instruct`，可用 `SILICONFLOW_MODEL` 覆盖。
- 不安装 SDK 或其他依赖；Provider 测试必须 Mock 全局 fetch，禁止真实网络。
- 不创建 AI 对话、模型原始响应或新数据库表。
- AI 草稿必须先在前端确认，才可写入任务表。
- 不新增路由、流式输出、聊天历史、自动负责人分配或全局状态库。

---

### Task 1: 实现硅基流动草稿 Provider 与严格运行时解析

**Files:**
- Create: `apps/api/src/ai/ai.module.ts`
- Create: `apps/api/src/ai/siliconflow-task-planning.service.ts`
- Create: `apps/api/src/ai/types/task-draft.ts`
- Create: `apps/api/src/ai/siliconflow-task-planning.service.spec.ts`
- Modify: `apps/api/src/app.module.ts`
- Modify: `apps/api/.env.example`

**Interfaces:**
- Produces: `AiTaskDraft { title: string; description: string; priority: TaskPriority }`。
- Produces: `SiliconFlowTaskPlanningService.generateTaskDrafts(goal: string): Promise<AiTaskDraft[]>`。
- Consumes: `SILICONFLOW_API_KEY`、`SILICONFLOW_BASE_URL`、`SILICONFLOW_MODEL`。

- [ ] **Step 1: 写入 Provider 的失败测试**

```ts
it('parses valid task drafts returned by SiliconFlow without issuing a real network request', async () => {
  process.env.SILICONFLOW_API_KEY = 'test-key';
  global.fetch = jest.fn().mockResolvedValue(new Response(JSON.stringify({
    choices: [{ message: { content: '{"tasks":[{"title":"梳理接口","description":"输出接口清单","priority":"high"}]}' } }],
  }), { status: 200 })) as typeof fetch;

  await expect(service.generateTaskDrafts('完成项目接口设计')).resolves.toEqual([
    { title: '梳理接口', description: '输出接口清单', priority: TaskPriority.High },
  ]);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm run test --workspace @workspace/api -- siliconflow-task-planning.service.spec.ts --runInBand`

Expected: FAIL，原因是模块或 Provider 尚不存在。

- [ ] **Step 3: 实现最小 Provider**

```ts
const response = await fetch(`${baseUrl}/chat/completions`, {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({ model, temperature: 0.2, messages }),
});
```

缺少 Key 时抛出 `ServiceUnavailableException('AI 服务尚未配置')`；401/403 映射为 `BadGatewayException('AI 服务认证失败')`；429 映射为 `TooManyRequestsException('AI 请求过于频繁，请稍后再试')`；其余上游失败和结构不合规映射为 `BadGatewayException('AI 服务暂时不可用')`。从 `choices[0].message.content` 取字符串，移除 Markdown 围栏后解析 `{ tasks: unknown[] }`，对每项执行标题、说明和优先级校验，限制为 1 至 8 条。

- [ ] **Step 4: 补充错误测试并确认通过**

```ts
it('rejects a missing key without calling fetch', async () => {
  delete process.env.SILICONFLOW_API_KEY;
  await expect(service.generateTaskDrafts('拆解目标')).rejects.toThrow('AI 服务尚未配置');
  expect(global.fetch).not.toHaveBeenCalled();
});

it('maps SiliconFlow 429 to a safe rate-limit error', async () => {
  // mock a fresh 429 Response and assert the Chinese retry message
});
```

Run: `npm run test --workspace @workspace/api -- siliconflow-task-planning.service.spec.ts --runInBand`

Expected: Provider 成功、代码围栏、缺少 Key、429 与无效 JSON 测试全部通过。

### Task 2: 提供生成草稿与批量确认创建接口

**Files:**
- Create: `apps/api/src/ai/dto/generate-task-drafts.dto.ts`
- Create: `apps/api/src/tasks/dto/create-task-batch.dto.ts`
- Modify: `apps/api/src/ai/ai.controller.ts`
- Modify: `apps/api/src/ai/ai.module.ts`
- Modify: `apps/api/src/tasks/tasks.controller.ts`
- Modify: `apps/api/src/tasks/tasks.service.ts`
- Modify: `apps/api/src/tasks/tasks.controller.spec.ts`

**Interfaces:**
- Produces: `POST /api/projects/:projectId/ai/task-drafts` with `{ goal: string }` and `AiTaskDraft[]` response.
- Produces: `POST /api/projects/:projectId/tasks/batch` with `{ tasks: AiTaskDraft[] }` and `TaskSummary[]` response.
- Consumes: Task 1 Provider and existing `getAccessibleProject` authorization path.

- [ ] **Step 1: 写入失败的控制器测试**

```ts
it('creates pending task drafts for a project team member', async () => {
  await request(app.getHttpServer())
    .post('/api/projects/project-1/ai/task-drafts')
    .set('Cookie', `access_token=${token}`)
    .send({ goal: '完成项目接口设计' })
    .expect(201)
    .expect([{ title: expect.any(String), priority: expect.any(String) }]);
});

it('creates confirmed drafts as unassigned todo tasks in one request', async () => {
  const response = await request(app.getHttpServer())
    .post('/api/projects/project-1/tasks/batch')
    .set('Cookie', `access_token=${token}`)
    .send({ tasks: [{ title: '梳理接口', description: '', priority: 'medium' }] })
    .expect(201);
  expect(response.body[0]).toMatchObject({ status: 'todo', assignee: null });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm run test --workspace @workspace/api -- tasks.controller.spec.ts --runInBand`

Expected: FAIL，原因是新路由不存在。

- [ ] **Step 3: 实现 DTO、控制器和批量服务方法**

```ts
export class GenerateTaskDraftsDto {
  @IsString() @Length(10, 2000) goal!: string;
}

export class CreateTaskBatchDto {
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(8)
  @ValidateNested({ each: true }) @Type(() => CreateTaskDraftDto)
  tasks!: CreateTaskDraftDto[];
}
```

批量服务先调用 `getAccessibleProject`，再用 `dataSource.transaction` 创建任务；每项 `{ status: TaskStatus.Todo, assignee: null, project }`，保存后返回 `toTaskSummary` 数组。AI 控制器通过同一个项目访问校验后调用 Provider，且不持久化生成草稿。

- [ ] **Step 4: 运行后端新增接口测试确认通过**

Run: `npm run test --workspace @workspace/api -- tasks.controller.spec.ts --runInBand`

Expected: 新旧任务接口与草稿确认接口测试全部通过。

### Task 3: 实现看板内 AI 草稿确认交互

**Files:**
- Modify: `apps/web/src/types/workspace.ts`
- Modify: `apps/web/src/pages/TaskBoardPage.tsx`
- Modify: `apps/web/src/App.css`
- Modify: `apps/web/src/pages/TaskBoardPage.test.tsx`

**Interfaces:**
- Consumes: `POST /api/projects/:projectId/ai/task-drafts` and `POST /api/projects/:projectId/tasks/batch`.
- Produces: `AiTaskDraft` front-end type and an editable in-memory draft panel.

- [ ] **Step 1: 写入失败的用户可见测试**

```tsx
it('shows editable AI task drafts after a project goal is submitted', async () => {
  renderBoard();
  await user.type(screen.getByLabelText('项目目标'), '完成团队协作工作区的接口设计与联调');
  await user.click(screen.getByRole('button', { name: '生成任务草稿' }));
  expect(await screen.findByDisplayValue('梳理接口边界')).toBeInTheDocument();
});

it('creates confirmed drafts and appends returned tasks to todo', async () => {
  // mock generation and batch endpoints, then confirm the draft
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm run test --workspace @workspace/web -- TaskBoardPage.test.tsx --run`

Expected: FAIL，原因是目标输入、草稿或确认按钮不存在。

- [ ] **Step 3: 实现最小前端状态与请求**

```ts
const [aiGoal, setAiGoal] = useState('');
const [aiDrafts, setAiDrafts] = useState<AiTaskDraft[]>([]);

const drafts = await apiRequest<AiTaskDraft[]>(`api/projects/${projectId}/ai/task-drafts`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ goal: aiGoal.trim() }),
});
```

每张草稿卡片提供标题、说明、优先级受控字段和“移除草稿”。确认时只发送当前非空草稿；成功后将 `TaskSummary[]` 追加到 `columns.todo`，并清空 `aiGoal` 与草稿。生成/确认状态分别禁用对应按钮，失败时保留输入和草稿。

- [ ] **Step 4: 运行看板测试确认通过**

Run: `npm run test --workspace @workspace/web -- TaskBoardPage.test.tsx --run`

Expected: 草稿显示、编辑、移除、确认创建和失败保留输入测试通过。

### Task 4: 执行完整验证并更新本地环境示例

**Files:**
- Modify: `apps/api/.env.example`

**Interfaces:**
- Consumes: Tasks 1 至 3 的全部接口和前端交互。
- Produces: 包含无真实 Key 占位项的可复制开发配置。

- [ ] **Step 1: 补全 `.env.example` 非敏感配置**

```dotenv
SILICONFLOW_API_KEY=
SILICONFLOW_BASE_URL=https://api.siliconflow.cn/v1
SILICONFLOW_MODEL=Qwen/Qwen2.5-7B-Instruct
```

- [ ] **Step 2: 运行完整验证**

Run:
```bash
npm run test --workspace @workspace/api -- --runInBand
npm run build --workspace @workspace/api
npx eslint --no-fix src/ai src/tasks
npm run lint --workspace @workspace/web
npm run test --workspace @workspace/web
npm run build --workspace @workspace/web
```

Expected: 所有测试、构建与静态检查通过；Provider 测试只使用 Mock，不产生真实硅基流动请求。
