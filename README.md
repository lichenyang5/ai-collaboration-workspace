# AI Collaboration Workspace

面向小型团队的全栈协同任务系统，展示 React 前端交互、NestJS REST API、PostgreSQL 关系建模、团队权限控制和 SiliconFlow AI 任务拆解。

# 演示视频

https://www.bilibili.com/video/BV16F8B6QEmt/

## 已实现功能

- 用户注册、登录、Cookie 会话恢复与退出登录
- 团队创建、成员邀请和团队内项目管理
- 团队邀请实时通知与自动同步：受邀成员无需刷新即可收到通知，并在返回工作区时看到新团队
- 可在待办、进行中、已完成状态标签间切换的任务看板
- 任务创建、详情编辑、负责人分配、优先级、截止日期与状态流转
- 按关键词、负责人、优先级和截止状态组合筛选；筛选条件保存在 URL 中
- 截止日期的“今天到期”“三天内到期”“已逾期”提示
- 已完成任务归档、归档区查看与恢复
- 创建、编辑、状态、负责人、归档和恢复的任务活动记录
- 输入项目目标后生成可编辑的 AI 任务草稿，确认后批量加入待办列
- 只写入固定数据、可重复执行且拒绝在生产环境运行的本地 Demo seed

普通任务操作不依赖 AI。未配置 SiliconFlow 或外部服务不可用时，AI 区会显示“AI 服务尚未配置”、超时、限流、认证失败或暂时不可用等错误；现有看板、筛选和手工任务流程仍可继续使用。

## 技术栈与目录

- 前端：React 19、React Router、TypeScript、Vite、Vitest、Testing Library
- 后端：NestJS 11、TypeScript、TypeORM、Jest、Supertest
- 数据库：PostgreSQL，使用 `pgcrypto` 扩展、基础 Schema 和版本化 SQL migration

```text
apps/web                  React 前端
apps/api                  NestJS API
apps/api/sql/schema.sql   空数据库的完整结构
apps/api/sql/migrations   现有数据库的增量升级脚本
docs                      设计、实施计划与 Demo 脚本
```

## 功能架构

```text
React UI
  ├─ Cookie 认证的 REST API → PostgreSQL（权威数据）
  └─ Cookie/JWT 鉴权的 Socket.IO → 用户私有房间 → 变更通知 → REST 重新同步

可选 AI 链路：React → 项目 AI 接口 → SiliconFlow
```

REST API 是团队、成员与项目数据的权威来源；Socket.IO 只把已完成的变更通知发给对应用户，客户端收到通知后仍通过 REST 重新同步。因此 Socket.IO 断开时，邀请接口和刷新后的团队列表仍可用。项目所属团队成员权限校验、任务变更与活动记录的 TypeORM 事务都由 REST API 执行。

AI 返回的任务只作为客户端可编辑草稿；用户点击“确认创建任务”后才通过任务接口写入。AI 请求、解析或提供商失败只在 AI 区显示错误，不阻塞看板、筛选和手工任务操作。

## macOS 从零启动指南

这条路径面向在自己的 Mac 上第一次拉取和运行项目。推荐使用 GitHub Desktop、Node.js 官方安装包和 Postgres.app，不要求预先安装 Homebrew 或 Docker。

### 1. 安装三个工具

1. 安装 [GitHub Desktop for macOS](https://desktop.github.com/download/)，启动后登录保存此仓库的 GitHub 账号。
2. 打开 [Node.js 下载页](https://nodejs.org/en/download)，安装 **Node.js 22 LTS** 的 macOS Installer（`.pkg`）。npm 会随 Node.js 一起安装。
3. 安装 [Postgres.app](https://postgresapp.com/downloads.html)：把应用拖入 `Applications`，打开后点击 **Initialize**，确认状态显示为正在运行。

打开 macOS 的“终端”应用，逐行运行下面三个检查命令：

```bash
node --version
npm --version
psql --version
```

如果前两个命令能显示版本号，但 `psql` 提示 `command not found`，执行 Postgres.app 官方推荐的 PATH 配置，然后关闭并重新打开终端：

```bash
sudo mkdir -p /etc/paths.d
echo /Applications/Postgres.app/Contents/Versions/latest/bin | sudo tee /etc/paths.d/postgresapp
```

### 2. 从 GitHub 拉取代码

1. 打开仓库页面：<https://github.com/lichenyang5/ai-collaboration-workspace>。
2. 点击 **Code → Open with GitHub Desktop**。
3. 在 GitHub Desktop 中选择本地保存位置，点击 **Clone**。
4. 克隆完成后，点击菜单 **Repository → Open in Terminal**。后续命令都在这个终端窗口中执行。

先确认终端位于项目根目录。下面的命令应输出 `package.json`、`apps` 和 `README.md`：

```bash
pwd
ls
```

安装项目依赖：

```bash
npm install
```

### 3. 创建 PostgreSQL 用户和数据库

先生成一个仅用于本机数据库的随机密码：

```bash
openssl rand -hex 12
```

把输出结果暂时保存到安全位置。它只包含数字和小写字母，可以直接放进数据库连接串。然后创建专用数据库用户：

```bash
createuser --pwprompt ai_workspace_user
```

终端出现 `Enter password for new role` 和确认提示时，两次粘贴刚才的数据库密码。输入密码时终端不会显示字符，这是正常现象。

创建由该用户拥有的项目数据库：

```bash
createdb --owner=ai_workspace_user ai_collaboration_workspace
```

如果这是全新安装，以上命令应直接完成且没有报错。不要重复创建同名用户或数据库。

### 4. 创建本地环境变量文件

复制仓库提供的模板：

```bash
cp apps/api/.env.example apps/api/.env
```

分别生成 JWT 密钥和 Demo 登录密码，并保存两条输出：

```bash
openssl rand -hex 32
openssl rand -hex 12
```

打开环境变量文件：

```bash
open -e apps/api/.env
```

按下面模板填写。`数据库密码`、`JWT密钥` 和 `Demo登录密码` 必须替换成真实值，文字和尖括号不能保留。使用 AI 时再把 `SiliconFlow密钥` 替换成真实 Key；暂时不使用 AI 时必须把整行写成 `SILICONFLOW_API_KEY=`，不能保留尖括号占位符。

```dotenv
PORT=3001
DATABASE_URL=postgresql://ai_workspace_user:<数据库密码>@localhost:5432/ai_collaboration_workspace
DEMO_USER_PASSWORD=<Demo登录密码>
TEST_DATABASE_ADMIN_URL=
JWT_SECRET=<JWT密钥>
CORS_ORIGIN=http://localhost:5173
SILICONFLOW_API_KEY=<SiliconFlow密钥>
SILICONFLOW_BASE_URL=https://api.siliconflow.cn/v1
SILICONFLOW_MODEL=Qwen/Qwen2.5-7B-Instruct
```

保存文件。`apps/api/.env` 只用于本机，不能提交到 GitHub，也不要通过聊天或截图公开其中的密码和 Key。正常运行项目时，`TEST_DATABASE_ADMIN_URL` 保持空白即可；它只供会创建和删除一次性测试数据库的 seed E2E 使用。

### 5. 获取 SiliconFlow API Key 和模型 ID

SiliconFlow 的 Key 是账号级 API Key，不需要为每个模型单独创建 Key。模型名称通过 `SILICONFLOW_MODEL` 单独配置。

1. 打开 [SiliconFlow](https://cloud.siliconflow.cn/)，注册或登录自己的账号。
2. 进入 [API 密钥页面](https://cloud.siliconflow.cn/account/ak)，点击 **新建 API 密钥 / Create API Key**。
3. 创建后立即复制 Key，填入 `apps/api/.env` 的 `SILICONFLOW_API_KEY`。不要把 Key 写进 README 或提交到 GitHub。
4. 打开 [模型列表](https://cloud.siliconflow.cn/models)，搜索 `Qwen/Qwen2.5-7B-Instruct`。如果该模型仍可用，保留默认配置；如果平台已下架它，选择一个支持 Chat Completions 的指令模型，并把页面显示的完整模型 ID 原样填入 `SILICONFLOW_MODEL`。
5. 确认账号有可用额度。额度、模型价格和限流规则以 SiliconFlow 控制台当前显示为准。

SiliconFlow 官方完整操作说明见 [Quickstart](https://docs.siliconflow.cn/en/userguide/quickstart)。不配置 Key 也能使用登录、团队、项目、看板、筛选和手工任务功能，只有 AI 任务拆解会提示“AI 服务尚未配置”。

### 6. 初始化表结构、migration 和 Demo 数据

独立的 migration 和 seed 脚本不会自动读取 `.env`。先把 `apps/api/.env` 安全加载到当前终端会话；命令不会打印文件内容：

```bash
set -a
source apps/api/.env
set +a
```

执行完整 Schema，继续登记和执行尚未应用的增量 migration，再写入 Demo 数据：

```bash
psql "$DATABASE_URL" -f ./apps/api/sql/schema.sql
npm run db:migrate --workspace @workspace/api
npm run db:seed-demo --workspace @workspace/api
```

`schema.sql` 用于创建空数据库的完整结构；`db:migrate` 用于登记和应用版本化增量。以后更新代码时只需运行 `db:migrate`，不要再次手工执行 `schema.sql`。

Demo seed 使用固定 UUID 执行 upsert，不会删除非 Demo 数据；重复运行会恢复同一套 Demo 数据，不会累积重复记录。它创建：

- 登录邮箱：`demo.alice@workspace.local`（负责人）和 `demo.bob@workspace.local`（成员）
- 登录密码：`apps/api/.env` 中的 `DEMO_USER_PASSWORD`
- 团队：`Demo Collaboration Team`
- 项目：`Demo Product Launch`
- 覆盖逾期、临期、未指派、已完成和已归档场景的固定任务与活动记录

### 7. 启动前后端

在当前终端启动 API：

```bash
npm run dev:api
```

看到 NestJS 启动成功后，不要关闭该窗口。在 Terminal 中按 `Command + T` 新建标签页，再进入同一个项目目录。也可以回到 GitHub Desktop，再次点击 **Repository → Open in Terminal**。在第二个终端启动 Web：

```bash
npm run dev:web
```

浏览器打开 <http://localhost:5173>。需要单独确认 API 时，打开健康检查地址 <http://localhost:3001/api/health>；正常响应为 `{"success":true}`。`http://localhost:3001` 根路径返回 404 是正常现象，因为所有接口都使用 `/api` 前缀。

### 8. 验证项目与 AI

1. 使用 `demo.alice@workspace.local` 和自己设置的 `DEMO_USER_PASSWORD` 登录。
2. 进入 `Demo Collaboration Team → Demo Product Launch`。
3. 确认看板能看到逾期、临期、已完成和归档相关 Demo 任务。
4. 在 AI 任务拆解区输入一个项目目标并点击生成。
5. 能看到可编辑草稿，说明 SiliconFlow Key、模型和网络均可用；点击确认后，草稿才会写入任务看板。

完整五分钟操作顺序见 [docs/demo-script.md](docs/demo-script.md)。

### 实时团队邀请验证

先按第 7 步在两个终端启动 API 和 Web。然后在 macOS 的同一浏览器中同时打开一个普通窗口和一个无痕窗口，使用不同 Demo 账号完成以下验证：

1. 在普通窗口登录 `demo.alice@workspace.local`。
2. 在无痕窗口登录 `demo.bob@workspace.local`。
3. Alice 在团队页面邀请 Bob。
4. Bob 不刷新页面即可看到通知；返回工作区后团队自动出现。
5. Bob 点击“查看团队”进入项目列表。
6. Alice 重复邀请 Bob，Bob 不应收到第二条通知。

邀请仍以 Cookie 认证的 REST API 为准，Socket.IO 仅用于通知。它复用既有的 `VITE_API_BASE_URL`、`CORS_ORIGIN` 和 `JWT_SECRET`，**无需新增环境变量**。排查网络请求时，浏览器 Network 应显示一次成功的邀请 `POST`，以及仅受邀用户发起的一次 `GET /api/teams` 重新同步。

### 9. 停止、重启和以后更新

- 停止服务：分别切回 API 和 Web 终端，按 `Control + C`。
- 再次启动：确认 Postgres.app 正在运行，在两个终端分别执行 `npm run dev:api` 和 `npm run dev:web`。
- 拉取新代码：在 GitHub Desktop 点击 **Fetch origin**，有更新时再点击 **Pull origin**。
- 拉取后更新依赖和数据库：

```bash
npm install
set -a
source apps/api/.env
set +a
npm run db:migrate --workspace @workspace/api
```

除非需要恢复固定 Demo 数据，否则不必重复执行 `db:seed-demo`。

### 换一台 Mac 时的最短清单

这份清单用于已经理解上述步骤之后快速核对，第一次安装仍应从第 1 步开始：

1. 安装 GitHub Desktop、Node.js 22 LTS 和 Postgres.app。
2. 用 GitHub Desktop 克隆仓库并在仓库目录打开终端。
3. 执行 `npm install`。
4. 创建 `ai_workspace_user` 和 `ai_collaboration_workspace`。
5. 复制 `.env.example`，填写数据库密码、Demo 密码、JWT 密钥和 SiliconFlow Key。
6. 执行 `set -a; source apps/api/.env; set +a`。
7. 新数据库执行 `psql "$DATABASE_URL" -f ./apps/api/sql/schema.sql`。
8. 执行 migration 和 Demo seed。
9. 在两个终端分别启动 API 和 Web，访问 <http://localhost:5173>。

### 10. 常见问题

| 现象 | 处理方式 |
| --- | --- |
| `node: command not found` 或 `npm: command not found` | 重新安装 Node.js 22 LTS 的 macOS `.pkg`，关闭并重新打开终端。 |
| `psql: command not found` | 执行第 1 步的 `/etc/paths.d/postgresapp` 配置，重开终端，并确认 Postgres.app 已启动。 |
| `role "ai_workspace_user" already exists` | 说明用户已创建，不要再次执行 `createuser`，继续检查数据库。 |
| `database "ai_collaboration_workspace" already exists` | 说明数据库已创建，不要再次执行 `createdb`，继续初始化或启动。 |
| `password authentication failed` | 检查 `.env` 中的数据库密码是否与 `createuser --pwprompt` 输入一致；密码两侧不能有空格或引号。 |
| `ECONNREFUSED 127.0.0.1:5432` | 打开 Postgres.app，确认数据库服务处于运行状态。 |
| `EADDRINUSE`，端口 `3001` 或 `5173` 被占用 | 找到之前启动服务的终端并按 `Control + C`，再重新启动。 |
| 页面打不开，但终端没有报错 | 确认 API 和 Web 两个命令分别在两个终端持续运行，并访问 `http://localhost:5173`。 |
| Socket.IO 无法连接或反复断开 | 先确认 API 正在运行且浏览器可访问 API 地址；实时通知会不可用，但邀请 REST 请求与刷新后的团队列表仍应正常。检查浏览器 Network/Console 中的 WebSocket 错误后重启 API 和 Web。 |
| 登录正常但邀请请求或 Socket 连接出现 CORS/Cookie 错误 | 确认 Web 的实际来源与 `CORS_ORIGIN` 一致，并使用 `VITE_API_BASE_URL` 指向同一个 API；跨源 Cookie 需要浏览器允许凭据。修改 `.env` 后重启 API 和 Web。 |
| 受邀人离线时没有看到通知 | 离线用户可能错过瞬时 toast；重新登录或恢复 REST 会话后，团队会由 `GET /api/teams` 返回并显示。 |
| AI 提示“尚未配置” | 检查 `SILICONFLOW_API_KEY` 是否已填写，修改 `.env` 后重启 API。 |
| AI 返回 `401` / 认证失败 | Key 无效、被删除或复制不完整；在 SiliconFlow 控制台新建 Key 后替换并重启 API。 |
| AI 返回 `429` / 请求过于频繁 | 检查账号额度和限流，稍后重试，必要时在控制台更换可用模型。 |
| AI 超时或暂时不可用 | 检查网络能否访问 SiliconFlow，稍后重试；手工任务功能不受影响。 |

### 环境变量参考

| 变量 | 必需性 | 用途 |
| --- | --- | --- |
| `PORT` | 可选 | API 端口；默认 `3001`。 |
| `DATABASE_URL` | 必需 | API、migration 和 Demo seed 使用的 PostgreSQL 连接串。 |
| `DEMO_USER_PASSWORD` | 运行 Demo seed 时必需 | 本地 Demo 用户密码；seed 会以 bcrypt cost 12 哈希后写入。 |
| `TEST_DATABASE_ADMIN_URL` | 仅 seed E2E 必需 | 有权创建和删除测试数据库的管理连接；普通运行保持空白。 |
| `NODE_ENV` | 可选 | `production` 时登录 Cookie 使用 secure 标记，且 Demo seed 会拒绝运行。 |
| `JWT_SECRET` | 必需 | 登录会话 JWT 签名密钥。 |
| `CORS_ORIGIN` | 可选 | 允许携带 Cookie 访问 API 的前端源；默认 `http://localhost:5173`。 |
| `SILICONFLOW_API_KEY` | 使用 AI 时必需 | SiliconFlow 账号级 API Key。 |
| `SILICONFLOW_BASE_URL` | 可选 | 默认 `https://api.siliconflow.cn/v1`。 |
| `SILICONFLOW_MODEL` | 可选 | 默认 `Qwen/Qwen2.5-7B-Instruct`。 |

前端未设置 `VITE_API_BASE_URL` 时会请求 `http://localhost:3001`；如果 API 地址不同，可在前端 Vite 环境中设置该变量。

## Demo 截图

![任务看板 Demo](docs/images/task-board-demo.png)

任务看板截图展示状态标签、两张进行中卡片、三天内到期与已逾期提示、状态操作和活动时间线。页面一次只展示一个状态列（状态面板），因此这张真实界面截图没有同时展示仅在已完成任务上出现的归档按钮；归档、归档视图和恢复流程已在浏览器演示中单独验证。

![AI 任务草稿 Demo](docs/images/ai-task-planner-demo.png)

AI 截图使用确定性的本地测试响应验证两条可编辑草稿及“确认创建任务”按钮，只说明草稿确认前的 UI 状态，不是外部 SiliconFlow 成功响应的证据；外部服务不可用时仍按前述错误降级处理。

## 测试与构建

```bash
npm run test
npm run build
```

根命令会分别运行 API 与 Web workspace 的测试或构建。Demo seed 另有真实 PostgreSQL E2E：

```bash
npm run test:seed --workspace @workspace/api
```

该测试要求 `TEST_DATABASE_ADMIN_URL`，只会创建、重建并清理名称精确为 `ai_collaboration_workspace_seed_test` 的一次性数据库；它应用 `schema.sql` 与 migrations，两次执行 seed，并验证固定数据数量不增长以及非 Demo 数据未被删除。

## 持续集成

GitHub Actions 会在每次推送到 `main`、以及每个 Pull Request 时使用 Node.js 22 运行：

```bash
npm ci
npm run test
npm run build
```

该流程不读取数据库、JWT 或 SiliconFlow Key；它验证锁定依赖可以安装，API 与 Web 的自动化测试通过，且两个 workspace 都能完成生产构建。

## 验收状态

- 已按本文档完成本机数据库、Schema、migration 与可重复执行的 Demo seed 验收。
- 已使用两个独立浏览器会话和不同账号完成真实团队邀请验收：受邀用户无需刷新即可收到通知，团队列表自动同步；重复邀请不会产生第二条创建通知。
- 任务创建、编辑、状态流转、筛选、归档/恢复、活动记录与 AI 草稿确认均可按 [五分钟 Demo 脚本](docs/demo-script.md) 演示。
- 本项目以本地可复现的全栈作品 Demo 交付，当前不提供线上部署地址。AI 任务拆解是可选增强，仍取决于本机配置的 SiliconFlow Key、模型可用性与账号额度。
