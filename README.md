# AI Collaboration Workspace

面向小型团队的协同任务系统，用于展示 React 前端交互、NestJS REST API、PostgreSQL 关系型建模与权限控制的全栈开发能力。

## 第一阶段范围

- 用户注册、登录和注销
- 团队与成员关系
- 团队下的项目管理
- 任务创建、分配和状态流转
- React 任务看板

第一阶段不包含 AI、Redis、WebSocket、评论、附件、第三方登录或 Docker。

## 技术栈

- 前端：React、TypeScript、Vite
- 后端：NestJS、TypeScript、TypeORM
- 数据库：本机 PostgreSQL

## 本地启动

1. 在本机 PostgreSQL 创建数据库：`ai_collaboration_workspace`。
2. 复制 `apps/api/.env.example` 为 `apps/api/.env`，填写本机连接串和 JWT 密钥。`DATABASE_URL` 中的密码使用你本机 `aigc` 用户密码。
3. 执行数据库 Schema：psql -U aigc -d ai_collaboration_workspace -f apps/api/sql/schema.sql。
4. 根目录执行 
pm install。
5. 执行 `npm run dev:api` 启动 API，执行 `npm run dev:web` 启动前端。

## 目录

```text
apps/web  # React 前端
apps/api  # NestJS 后端
docs      # 设计、架构与数据库文档
```