# AI Collaboration Workspace 第一阶段设计

## 目标

在一个仓库中构建面向小型团队的协同任务系统。项目以 React/TypeScript 前端能力为主线，以 NestJS、PostgreSQL、鉴权和关系型业务建模证明全栈交付能力。

## 仓库结构

```text
ai-collaboration-workspace/
├─ apps/
│  ├─ web/                # React + TypeScript + Vite
│  └─ api/                # NestJS + TypeScript + TypeORM
├─ docs/                  # 架构、数据库、接口和演示说明
├─ package.json           # 根级统一脚本
└─ README.md
```

前端和后端共用一个 Git 仓库，但各自保留独立的依赖、构建和启动边界。根目录只承载统一开发命令、文档和 CI 编排，不引入 Nx、Turborepo 或全局状态管理。

## 第一阶段业务闭环

```text
注册 / 登录
  → 创建团队
  → 创建项目
  → 创建、分配和更新任务
  → 任务列表 / 看板展示
```

前端提供注册、登录、团队/项目选择和任务看板。后端以 REST API 提供鉴权、团队、项目和任务能力。用户只能访问自己所属团队的数据。

## 数据模型

- `users`：账户身份与密码哈希。
- `teams`：团队；创建者为 owner。
- `team_members`：用户和团队的多对多关系，角色为 owner 或 member。
- `projects`：归属单个团队的项目。
- `tasks`：归属单个项目的任务，支持标题、描述、状态、优先级、负责人和截止时间。

核心关系为 `users ↔ team_members ↔ teams → projects → tasks`。负责人是团队成员；任务状态限定为 todo、in_progress、done。

## 模块与权限

后端包含 `AuthModule`、`TeamsModule`、`ProjectsModule`、`TasksModule` 和 `DatabaseModule`。所有业务接口要求 JWT 身份认证；写入与读取前均验证团队成员关系。owner 可以管理团队和项目，member 可查看所属团队、创建和更新授权范围内的任务。

## 明确不在第一阶段实现的内容

不接入 AI、Redis、WebSocket、评论、附件、通知、第三方登录、Docker、生产部署和复杂 RBAC。这些能力以后续可独立验证的阶段按需加入。

## 验收标准

- 新用户可以注册并登录，获得受保护 API 的访问凭据。
- owner 可以创建团队和项目。
- 团队成员可以创建、分配和更新任务状态。
- 非团队成员不能读取或修改该团队数据。
- React 页面可完成上述流程并正确显示接口错误。
- 本机 PostgreSQL 中的数据关系可通过文档和 SQL 直观看到。