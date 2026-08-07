# AI Collaboration Workspace Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在单一仓库内交付可运行的 React + NestJS + PostgreSQL 协同任务系统最小闭环。

**Architecture:** 根目录使用 npm workspaces 管理 `apps/web` 与 `apps/api`。NestJS 用 TypeORM 访问本机 PostgreSQL；React 使用 REST API 与 HttpOnly Cookie 会话完成认证、团队、项目和任务看板交互。

**Tech Stack:** Node.js 20、npm workspaces、React、Vite、TypeScript、NestJS、TypeORM、PostgreSQL、JWT、bcrypt、Vitest。

## Global Constraints

- 一个 Git 仓库内维护前端与后端，目录固定为 `apps/web` 与 `apps/api`。
- 数据库为本机 PostgreSQL，不使用 Docker、Redis、WebSocket、AI、附件或第三方登录。
- 任务状态固定为 todo、in_progress、done；团队角色固定为 owner、member。
- 所有团队、项目和任务读取/写入均需验证用户的团队成员关系。
- 前端以 React/TypeScript 为主，后端使用 NestJS/TypeORM，不引入全局状态管理库或 UI 组件库。

---

### Task 1: 初始化单仓库与基础文档

**Files:**
- Create: `package.json`
- Create: `.gitignore`
- Create: `README.md`
- Create: `apps/web/`
- Create: `apps/api/`
- Modify: `docs/superpowers/specs/2026-08-07-ai-collaboration-workspace-phase-1-design.md`

**Interfaces:**
- Produces: 可用 npm workspaces 的根目录；前后端独立 package；本地启动与数据库配置说明。

- [ ] **Step 1: 创建根级 npm workspace 配置**

```json
{
  "name": "ai-collaboration-workspace",
  "private": true,
  "workspaces": ["apps/*"],
  "scripts": {
    "dev:web": "npm run dev --workspace @workspace/web",
    "dev:api": "npm run start:dev --workspace @workspace/api",
    "build": "npm run build --workspaces",
    "test": "npm run test --workspaces"
  }
}
```

- [ ] **Step 2: 写入环境变量模板与 README**

后端 `.env.example` 只包含 `PORT`、`DATABASE_URL`、`JWT_SECRET`、`CORS_ORIGIN`；README 说明本机 PostgreSQL 初始化、两个应用启动命令与第一阶段边界。

- [ ] **Step 3: 验证 workspace 能识别两个应用**

Run: `npm install`
Expected: 根目录生成一个 `package-lock.json`，并能识别两个 workspace。

### Task 2: 搭建 NestJS 与 PostgreSQL 数据层

**Files:**
- Create: `apps/api/src/main.ts`
- Create: `apps/api/src/app.module.ts`
- Create: `apps/api/src/database/database.module.ts`
- Create: `apps/api/src/database/entities/user.entity.ts`
- Create: `apps/api/src/database/entities/team.entity.ts`
- Create: `apps/api/src/database/entities/team-member.entity.ts`
- Create: `apps/api/src/database/entities/project.entity.ts`
- Create: `apps/api/src/database/entities/task.entity.ts`
- Create: `apps/api/src/health/health.controller.ts`
- Create: `apps/api/src/health/health.controller.spec.ts`

**Interfaces:**
- Produces: `GET /api/health` 返回 `{ success: true }`；TypeORM 实体定义 users、teams、team_members、projects、tasks 的关系。

- [ ] **Step 1: 编写健康检查测试**

```ts
it('returns a healthy API response', async () => {
  const response = await request(app.getHttpServer()).get('/api/health')
  expect(response.status).toBe(200)
  expect(response.body).toEqual({ success: true })
})
```

- [ ] **Step 2: 配置 NestJS 基础应用与 CORS/Cookie 解析**

`main.ts` 固定 API 前缀 `/api`，CORS 只允许 `CORS_ORIGIN`，并开启 credentials；应用不在测试导入时监听端口。

- [ ] **Step 3: 定义五个 TypeORM 实体**

`User` 与 `Team` 通过 `TeamMember` 多对多关联；`Team` 一对多 `Project`；`Project` 一对多 `Task`；`Task.assignee` 关联 `User`。数据库约束包含唯一邮箱、团队成员唯一组合和枚举状态/角色。

- [ ] **Step 4: 运行后端单测与构建**

Run: `npm run test --workspace @workspace/api && npm run build --workspace @workspace/api`
Expected: 健康检查通过，TypeScript 构建成功。

### Task 3: 实现认证、团队、项目与任务 API

**Files:**
- Create: `apps/api/src/auth/`
- Create: `apps/api/src/teams/`
- Create: `apps/api/src/projects/`
- Create: `apps/api/src/tasks/`
- Create: `apps/api/src/common/guards/jwt-auth.guard.ts`
- Create: `apps/api/src/common/decorators/current-user.decorator.ts`
- Test: `apps/api/src/auth/auth.service.spec.ts`
- Test: `apps/api/src/tasks/tasks.service.spec.ts`

**Interfaces:**
- Consumes: TypeORM 实体与 JWT 配置。
- Produces: `/api/auth/register`、`/api/auth/login`、`/api/auth/logout`、`/api/teams`、`/api/teams/:teamId/projects`、`/api/projects/:projectId/tasks` REST API。

- [ ] **Step 1: 编写权限拒绝测试**

```ts
it('rejects task access for users outside the team', async () => {
  await expect(service.findByProject(projectId, outsideUserId)).rejects.toThrow(ForbiddenException)
})
```

- [ ] **Step 2: 实现 JWT Cookie 认证**

注册时 bcrypt 哈希密码并创建用户；登录时验证密码、签发 JWT，写入 HttpOnly Cookie；注销时清除 Cookie。受保护路由统一从 JWT 提取 `userId`。

- [ ] **Step 3: 实现团队与项目服务**

创建团队时在同一事务写入 Team 与 owner TeamMember；所有项目操作先验证 TeamMember。创建项目需要 owner，成员可读取所属团队项目。

- [ ] **Step 4: 实现任务服务**

任务包含 title、description、status、priority、assigneeId、dueDate；创建/更新任务时验证项目和负责人属于同一团队。返回 DTO 不包含密码哈希。

- [ ] **Step 5: 运行 API 测试与构建**

Run: `npm run test --workspace @workspace/api && npm run build --workspace @workspace/api`
Expected: 认证和成员权限测试通过，构建成功。

### Task 4: 实现 React 认证与任务看板

**Files:**
- Create: `apps/web/src/main.tsx`
- Create: `apps/web/src/App.tsx`
- Create: `apps/web/src/pages/LoginPage.tsx`
- Create: `apps/web/src/pages/RegisterPage.tsx`
- Create: `apps/web/src/pages/WorkspacePage.tsx`
- Create: `apps/web/src/pages/ProjectBoardPage.tsx`
- Create: `apps/web/src/components/TaskColumn.tsx`
- Create: `apps/web/src/services/api.ts`
- Create: `apps/web/src/types/api.ts`
- Test: `apps/web/src/pages/LoginPage.test.tsx`
- Test: `apps/web/src/pages/ProjectBoardPage.test.tsx`

**Interfaces:**
- Consumes: 后端 REST API 与 HttpOnly Cookie 会话。
- Produces: 注册/登录、团队/项目选择、按状态展示任务列及更新任务状态的页面。

- [ ] **Step 1: 编写登录页交互测试**

```tsx
it('submits email and password to the login API', async () => {
  render(<LoginPage />)
  await user.type(screen.getByLabelText('邮箱'), 'demo@example.com')
  await user.type(screen.getByLabelText('密码'), 'password123')
  await user.click(screen.getByRole('button', { name: '登录' }))
  expect(fetchMock).toHaveBeenCalledWith(expect.stringMatching(/auth\/login$/), expect.objectContaining({ method: 'POST' }))
})
```

- [ ] **Step 2: 实现统一 API 客户端**

请求固定使用 `credentials: 'include'`；非成功响应解析 `{ message }` 并显示中文错误；不得硬编码 token 或数据库地址。

- [ ] **Step 3: 实现页面与路由**

使用 React Router 提供 `/login`、`/register`、`/workspace`、`/projects/:projectId`。未登录访问受保护路由跳转登录页；工作台包含创建团队、创建项目和进入项目入口。

- [ ] **Step 4: 实现三列任务看板**

`TaskColumn` 分别展示 todo、in_progress、done；支持创建任务与切换状态，成功后刷新当前项目任务列表；请求中禁用相应按钮。

- [ ] **Step 5: 运行前端测试与构建**

Run: `npm run test --workspace @workspace/web && npm run build --workspace @workspace/web`
Expected: React Testing Library 测试通过，Vite 构建成功。

### Task 5: 集成验收、文档与首次提交

**Files:**
- Modify: `README.md`
- Create: `docs/architecture.md`
- Create: `docs/database.md`
- Create: `.github/workflows/ci.yml`

**Interfaces:**
- Produces: 可复现的本机启动说明、架构图、ER 图和前后端 CI。

- [ ] **Step 1: 写入 Mermaid 架构与关系图**

`docs/architecture.md` 描述浏览器、React、NestJS、PostgreSQL 的调用路径；`docs/database.md` 使用 Mermaid ER 图呈现五张表及主外键关系。

- [ ] **Step 2: 写入 GitHub Actions CI**

Node 20 环境分别执行前端/后端安装、测试和构建；测试环境使用无真实数据库的 mock 或 test database 配置；CI 不启动真实 PostgreSQL、不使用真实密钥。

- [ ] **Step 3: 执行全量验证**

Run: `npm run test && npm run build`
Expected: 两个 workspace 的测试和构建全部通过。

- [ ] **Step 4: 初始化 Git 并创建首个提交**

```powershell
git init
git add .
git commit -m "feat: initialize collaboration workspace phase 1"
```

Expected: 本地仓库有包含前后端、文档与 CI 的可回滚首个提交。