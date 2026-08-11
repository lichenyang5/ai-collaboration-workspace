import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { getDataSourceToken, getRepositoryToken } from '@nestjs/typeorm';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { AppModule } from '../app.module';
import { Project } from '../database/entities/project.entity';
import {
  Task,
  TaskPriority,
  TaskStatus,
} from '../database/entities/task.entity';
import { TeamMember } from '../database/entities/team-member.entity';
import { User } from '../database/entities/user.entity';
import { SiliconFlowTaskPlanningService } from '../ai/siliconflow-task-planning.service';
import { TasksService } from './tasks.service';

process.env.JWT_SECRET = 'test-secret';

describe('Task creation', () => {
  let app: INestApplication;
  const memberId = '11111111-1111-4111-8111-111111111111';

  beforeAll(async () => {
    const taskPlanningService = {
      generateTaskDrafts: jest.fn(async () => [
        {
          title: '梳理接口边界',
          description: '输出接口清单',
          priority: TaskPriority.High,
        },
      ]),
    };
    const taskRepository = {
      create: jest.fn((value: object) => ({ id: 'task-1', ...value })),
      save: jest.fn(async (value: object) => value),
      findOne: jest.fn(
        async (options: { relations?: { assignee?: boolean } }) => ({
          id: 'task-1',
          title: '可移动任务',
          description: '',
          priority: TaskPriority.Medium,
          status: TaskStatus.Todo,
          dueDate: null,
          createdAt: new Date('2026-08-10T00:00:00.000Z'),
          updatedAt: new Date('2026-08-10T00:00:00.000Z'),
          project: { id: 'project-1', team: { id: 'team-1' } },
          assignee: options.relations?.assignee
            ? {
                id: memberId,
                displayName: '成员一',
                email: 'member@example.com',
                passwordHash: 'must-not-be-exposed',
              }
            : null,
        }),
      ),
      find: jest.fn(async () => [
        { id: 'task-todo', title: '待处理任务', status: TaskStatus.Todo },
        {
          id: 'task-progress',
          title: '进行中任务',
          status: TaskStatus.InProgress,
        },
        { id: 'task-done', title: '已完成任务', status: TaskStatus.Done },
      ]),
    };
    const projectRepository = {
      findOne: jest.fn(async () => ({
        id: 'project-1',
        name: '任务协作平台',
        team: { id: 'team-1' },
      })),
    };
    const membershipRepository = {
      findOne: jest.fn(
        async (options: { where?: { user?: { id?: string } } }) => {
          if (options.where?.user?.id === 'user-1') {
            return { id: 'membership-owner-1' };
          }

          if (options.where?.user?.id === memberId) {
            return {
              id: 'membership-member-1',
              user: {
                id: memberId,
                displayName: '成员一',
                email: 'member@example.com',
                passwordHash: 'must-not-be-exposed',
              },
            };
          }

          return null;
        },
      ),
    };
    const getRepository = jest.fn((entity: unknown) => {
      if (entity === Task) {
        return taskRepository;
      }
      if (entity === Project) {
        return projectRepository;
      }
      return membershipRepository;
    });
    const dataSource = {
      getRepository,
      transaction: jest.fn(
        async (
          callback: (entityManager: {
            getRepository: typeof getRepository;
          }) => Promise<unknown>,
        ) => callback({ getRepository }),
      ),
    };
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(getRepositoryToken(User))
      .useValue({})
      .overrideProvider(getDataSourceToken())
      .useValue(dataSource)
      .overrideProvider(SiliconFlowTaskPlanningService)
      .useValue(taskPlanningService)
      .compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    app.use(cookieParser());
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('allows a team member to create a task in a project', async () => {
    const token = new JwtService({ secret: 'test-secret' }).sign({
      sub: 'user-1',
    });
    const response = await request(app.getHttpServer())
      .post('/api/projects/project-1/tasks')
      .set('Cookie', `access_token=${token}`)
      .send({
        title: '完成任务看板接口',
        description: '实现任务创建的最小闭环',
        priority: TaskPriority.High,
      });

    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({
      id: 'task-1',
      title: '完成任务看板接口',
      status: TaskStatus.Todo,
      priority: TaskPriority.High,
    });
  });
  it('returns the project task board grouped by status', async () => {
    const token = new JwtService({ secret: 'test-secret' }).sign({
      sub: 'user-1',
    });
    const response = await request(app.getHttpServer())
      .get('/api/projects/project-1/tasks')
      .set('Cookie', `access_token=${token}`);

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      projectId: 'project-1',
      projectName: '任务协作平台',
      teamId: 'team-1',
      columns: {
        todo: [{ id: 'task-todo' }],
        in_progress: [{ id: 'task-progress' }],
        done: [{ id: 'task-done' }],
      },
    });
  });

  it('validates and forwards all task board filters to the service', async () => {
    const getTaskBoardSpy = jest
      .spyOn(app.get(TasksService), 'getTaskBoard')
      .mockResolvedValue({
        projectId: 'project-1',
        projectName: '浠诲姟鍗忎綔骞冲彴',
        teamId: 'team-1',
        columns: { todo: [], in_progress: [], done: [] },
      });
    const token = new JwtService({ secret: 'test-secret' }).sign({
      sub: 'user-1',
    });

    const response = await request(app.getHttpServer())
      .get('/api/projects/project-1/tasks')
      .query({
        q: '鎺ュ彛',
        assigneeId: memberId,
        priority: TaskPriority.High,
        due: 'overdue',
        view: 'active',
      })
      .set('Cookie', `access_token=${token}`);

    expect(response.status).toBe(200);
    expect(getTaskBoardSpy).toHaveBeenCalledWith('project-1', 'user-1', {
      q: '鎺ュ彛',
      assigneeId: memberId,
      priority: TaskPriority.High,
      due: 'overdue',
      view: 'active',
    });
    getTaskBoardSpy.mockRestore();
  });

  it('rejects an unsupported task board due filter', async () => {
    const token = new JwtService({ secret: 'test-secret' }).sign({
      sub: 'user-1',
    });

    const response = await request(app.getHttpServer())
      .get('/api/projects/project-1/tasks')
      .query({ due: 'tomorrow' })
      .set('Cookie', `access_token=${token}`);

    expect(response.status).toBe(400);
  });

  it('rejects a malformed task board assigneeId filter', async () => {
    const token = new JwtService({ secret: 'test-secret' }).sign({
      sub: 'user-1',
    });

    const response = await request(app.getHttpServer())
      .get('/api/projects/project-1/tasks')
      .query({ assigneeId: 'not-a-uuid' })
      .set('Cookie', `access_token=${token}`);

    expect(response.status).toBe(400);
  });

  it('assigns a task only to a team member and returns a safe assignee summary', async () => {
    const token = new JwtService({ secret: 'test-secret' }).sign({
      sub: 'user-1',
    });
    const response = await request(app.getHttpServer())
      .post('/api/projects/project-1/tasks')
      .set('Cookie', `access_token=${token}`)
      .send({
        title: '分配给团队成员',
        priority: TaskPriority.Medium,
        assigneeId: memberId,
      });

    expect(response.status).toBe(201);
    expect(response.body.assignee).toEqual({
      id: memberId,
      displayName: '成员一',
      email: 'member@example.com',
    });
    expect(response.body.assignee).not.toHaveProperty('passwordHash');
  });
  it('allows a team member to move a task to another board column', async () => {
    const token = new JwtService({ secret: 'test-secret' }).sign({
      sub: 'user-1',
    });
    const response = await request(app.getHttpServer())
      .patch('/api/tasks/task-1/status')
      .set('Cookie', `access_token=${token}`)
      .send({ status: TaskStatus.InProgress });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      id: 'task-1',
      status: TaskStatus.InProgress,
      assignee: {
        id: memberId,
        displayName: '成员一',
        email: 'member@example.com',
      },
    });
  });

  it('updates editable task fields and keeps the selected team member as assignee', async () => {
    const token = new JwtService({ secret: 'test-secret' }).sign({
      sub: 'user-1',
    });
    const response = await request(app.getHttpServer())
      .patch('/api/tasks/task-1')
      .set('Cookie', `access_token=${token}`)
      .send({
        title: '更新后的任务详情',
        description: '补充后的任务说明',
        priority: TaskPriority.High,
        dueDate: '2026-08-20',
        assigneeId: memberId,
      });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      id: 'task-1',
      title: '更新后的任务详情',
      description: '补充后的任务说明',
      priority: TaskPriority.High,
      assignee: {
        id: memberId,
        displayName: '成员一',
        email: 'member@example.com',
      },
    });
  });

  it('removes the assignee when assigneeId is null', async () => {
    const token = new JwtService({ secret: 'test-secret' }).sign({
      sub: 'user-1',
    });
    const response = await request(app.getHttpServer())
      .patch('/api/tasks/task-1')
      .set('Cookie', `access_token=${token}`)
      .send({ assigneeId: null });

    expect(response.status).toBe(200);
    expect(response.body.assignee).toBeNull();
  });

  it('rejects assigning a task to a user outside the team', async () => {
    const token = new JwtService({ secret: 'test-secret' }).sign({
      sub: 'user-1',
    });
    const response = await request(app.getHttpServer())
      .patch('/api/tasks/task-1')
      .set('Cookie', `access_token=${token}`)
      .send({ assigneeId: '22222222-2222-4222-8222-222222222222' });

    expect(response.status).toBe(400);
  });

  it('returns AI task drafts for a project team member without creating tasks', async () => {
    const token = new JwtService({ secret: 'test-secret' }).sign({
      sub: 'user-1',
    });
    const response = await request(app.getHttpServer())
      .post('/api/projects/project-1/ai/task-drafts')
      .set('Cookie', `access_token=${token}`)
      .send({ goal: '完成团队协作工作区的接口设计与联调' });

    expect(response.status).toBe(201);
    expect(response.body).toEqual([
      {
        title: '梳理接口边界',
        description: '输出接口清单',
        priority: TaskPriority.High,
      },
    ]);
  });

  it('creates confirmed AI drafts as unassigned todo tasks', async () => {
    const token = new JwtService({ secret: 'test-secret' }).sign({
      sub: 'user-1',
    });
    const response = await request(app.getHttpServer())
      .post('/api/projects/project-1/tasks/batch')
      .set('Cookie', `access_token=${token}`)
      .send({
        tasks: [
          {
            title: '梳理接口边界',
            description: '输出接口清单',
            priority: 'high',
          },
        ],
      });

    expect(response.status).toBe(201);
    expect(response.body[0]).toMatchObject({
      title: '梳理接口边界',
      status: TaskStatus.Todo,
      assignee: null,
    });
  });
});
