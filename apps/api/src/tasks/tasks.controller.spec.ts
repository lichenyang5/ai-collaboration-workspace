import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { getDataSourceToken, getRepositoryToken } from '@nestjs/typeorm';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { AppModule } from '../app.module';
import { Project } from '../database/entities/project.entity';
import {
  TaskActivity,
  TaskActivityEventType,
} from '../database/entities/task-activity.entity';
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
    const activityRepository = {
      create: jest.fn((value: object) => value),
      save: jest.fn(async (value: object) => value),
      find: jest.fn(async () => []),
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
      if (entity === TaskActivity) {
        return activityRepository;
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

describe('Task activities', () => {
  let app: INestApplication;
  let transaction: jest.Mock;
  let task: Task;
  let globalTaskRepository: {
    create: jest.Mock;
    save: jest.Mock;
    findOne: jest.Mock;
    find: jest.Mock;
  };
  let transactionTaskRepository: typeof globalTaskRepository;
  let activityRepository: {
    create: jest.Mock;
    save: jest.Mock;
    find: jest.Mock;
  };
  let activityListRepository: {
    create: jest.Mock;
    save: jest.Mock;
    find: jest.Mock;
  };
  const ownerId = '11111111-1111-4111-8111-111111111111';
  const outsiderId = '22222222-2222-4222-8222-222222222222';
  const previousAssigneeId = '33333333-3333-4333-8333-333333333333';
  const nextAssigneeId = '44444444-4444-4444-8444-444444444444';

  beforeEach(async () => {
    const project = {
      id: 'project-activity-1',
      name: 'Activity project',
      team: { id: 'team-activity-1' },
    };
    const owner = {
      id: ownerId,
      displayName: 'Project owner',
      email: 'owner@example.com',
      passwordHash: 'owner-password-hash',
    };
    const previousAssignee = {
      id: previousAssigneeId,
      displayName: 'Ada',
      email: 'ada@example.com',
      passwordHash: 'ada-password-hash',
    };
    const nextAssignee = {
      id: nextAssigneeId,
      displayName: 'Grace',
      email: 'grace@example.com',
      passwordHash: 'grace-password-hash',
    };
    task = {
      id: 'task-activity-1',
      title: 'Original activity task',
      description: 'Original description',
      priority: TaskPriority.Medium,
      status: TaskStatus.Todo,
      dueDate: new Date('2026-08-12T00:00:00.000Z'),
      archivedAt: null,
      createdAt: new Date('2026-08-10T00:00:00.000Z'),
      updatedAt: new Date('2026-08-10T00:00:00.000Z'),
      project,
      assignee: previousAssignee,
    } as Task;
    let createdTaskCount = 0;
    const createTaskRepository = () => ({
      create: jest.fn((value: object) => ({
        id: `created-task-${++createdTaskCount}`,
        createdAt: new Date('2026-08-11T00:00:00.000Z'),
        updatedAt: new Date('2026-08-11T00:00:00.000Z'),
        ...value,
      })),
      save: jest.fn(async (value: object | object[]) => value),
      update: jest.fn(
        async (
          _criteria: object,
          changes: { archivedAt?: Date | null },
        ) => {
          if (!Object.prototype.hasOwnProperty.call(changes, 'archivedAt')) {
            return { affected: 0 };
          }
          task.archivedAt = changes.archivedAt ?? null;
          return { affected: 1 };
        },
      ),
      findOne: jest.fn(async () => task),
      find: jest.fn(async () => []),
    });
    globalTaskRepository = createTaskRepository();
    transactionTaskRepository = createTaskRepository();
    const projectRepository = {
      findOne: jest.fn(async () => project),
    };
    const membershipRepository = {
      findOne: jest.fn(
        async (options: {
          where?: { user?: { id?: string } };
          relations?: { user?: boolean };
        }) => {
          const userId = options.where?.user?.id;
          if (userId === outsiderId) {
            return null;
          }

          const user =
            userId === previousAssigneeId
              ? previousAssignee
              : userId === nextAssigneeId
                ? nextAssignee
                : owner;
          return options.relations?.user ? { id: `member-${user.id}`, user } : { id: `member-${user.id}` };
        },
      ),
    };
    const listActivity = {
      id: 'activity-list-1',
      eventType: TaskActivityEventType.Created,
      details: {},
      createdAt: new Date('2026-08-11T08:30:00.000Z'),
      task: { id: task.id, title: task.title },
      actor: owner,
    };
    activityRepository = {
      create: jest.fn((value: object) => ({
        id: 'new-activity-1',
        createdAt: new Date('2026-08-11T09:00:00.000Z'),
        ...value,
      })),
      save: jest.fn(async (value: object) => value),
      find: jest.fn(async () => []),
    };
    activityListRepository = {
      create: jest.fn((value: object) => value),
      save: jest.fn(async (value: object) => value),
      find: jest.fn(async () => [listActivity]),
    };
    const repositoryFor = (
      entity: unknown,
      taskRepository: typeof globalTaskRepository,
      taskActivityRepository: typeof activityRepository,
    ) => {
      if (entity === Task) {
        return taskRepository;
      }
      if (entity === Project) {
        return projectRepository;
      }
      if (entity === TeamMember) {
        return membershipRepository;
      }
      if (entity === TaskActivity) {
        return taskActivityRepository;
      }
      throw new Error('Unexpected repository');
    };
    const getRepository = jest.fn((entity: unknown) =>
      repositoryFor(entity, globalTaskRepository, activityListRepository),
    );
    const transactionGetRepository = jest.fn((entity: unknown) =>
      repositoryFor(entity, transactionTaskRepository, activityRepository),
    );
    transaction = jest.fn(
      async (
        callback: (entityManager: {
          getRepository: typeof transactionGetRepository;
        }) => Promise<unknown>,
      ) => callback({ getRepository: transactionGetRepository }),
    );
    const dataSource = { getRepository, transaction };

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(getRepositoryToken(User))
      .useValue({})
      .overrideProvider(getDataSourceToken())
      .useValue(dataSource)
      .overrideProvider(SiliconFlowTaskPlanningService)
      .useValue({ generateTaskDrafts: jest.fn() })
      .compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    app.use(cookieParser());
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  it('records a created activity in the same transaction as task creation', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/projects/project-activity-1/tasks')
      .set('Cookie', activityToken(ownerId))
      .send({ title: 'Create activity record', priority: TaskPriority.High });

    expect(response.status).toBe(201);
    expect(activityRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: TaskActivityEventType.Created }),
    );
    expect(transaction).toHaveBeenCalledTimes(1);
  });

  it('records a created activity for every task in one batch transaction', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/projects/project-activity-1/tasks/batch')
      .set('Cookie', activityToken(ownerId))
      .send({
        tasks: [
          { title: 'First batch activity', priority: TaskPriority.Low },
          { title: 'Second batch activity', priority: TaskPriority.High },
        ],
      });

    expect(response.status).toBe(201);
    expect(activityRepository.save).toHaveBeenCalledTimes(2);
    expect(activityRepository.save).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ eventType: TaskActivityEventType.Created }),
    );
    expect(activityRepository.save).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ eventType: TaskActivityEventType.Created }),
    );
    expect(transaction).toHaveBeenCalledTimes(1);
  });

  it('records title and due-date edits as stable updated field details', async () => {
    const response = await request(app.getHttpServer())
      .patch('/api/tasks/task-activity-1')
      .set('Cookie', activityToken(ownerId))
      .send({ title: 'Renamed activity task', dueDate: '2026-08-20' });

    expect(response.status).toBe(200);
    expect(activityRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: TaskActivityEventType.Updated,
        details: {
          fields: {
            title: { from: 'Original activity task', to: 'Renamed activity task' },
            dueDate: { from: '2026-08-12', to: '2026-08-20' },
          },
        },
      }),
    );
    expect(transaction).toHaveBeenCalledTimes(1);
  });

  it('records an assignee edit with display-name details', async () => {
    const response = await request(app.getHttpServer())
      .patch('/api/tasks/task-activity-1')
      .set('Cookie', activityToken(ownerId))
      .send({ assigneeId: nextAssigneeId });

    expect(response.status).toBe(200);
    expect(activityRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: TaskActivityEventType.AssigneeChanged,
        details: { fromDisplayName: 'Ada', toDisplayName: 'Grace' },
      }),
    );
    expect(transaction).toHaveBeenCalledTimes(1);
  });

  it('does not write an updated activity for a no-op edit', async () => {
    const response = await request(app.getHttpServer())
      .patch('/api/tasks/task-activity-1')
      .set('Cookie', activityToken(ownerId))
      .send({ title: 'Original activity task' });

    expect(response.status).toBe(200);
    expect(activityRepository.save).not.toHaveBeenCalled();
    expect(transaction).toHaveBeenCalledTimes(1);
  });

  it('records a status transition with stable from and to details', async () => {
    const response = await request(app.getHttpServer())
      .patch('/api/tasks/task-activity-1/status')
      .set('Cookie', activityToken(ownerId))
      .send({ status: TaskStatus.InProgress });

    expect(response.status).toBe(200);
    expect(activityRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: TaskActivityEventType.StatusChanged,
        details: { from: TaskStatus.Todo, to: TaskStatus.InProgress },
      }),
    );
    expect(transaction).toHaveBeenCalledTimes(1);
  });

  it('rejects status changes for an archived task before saving or recording activity', async () => {
    task.status = TaskStatus.Done;
    task.archivedAt = new Date('2026-08-11T10:00:00.000Z');

    const response = await request(app.getHttpServer())
      .patch('/api/tasks/task-activity-1/status')
      .set('Cookie', activityToken(ownerId))
      .send({ status: TaskStatus.InProgress });

    expect(response.status).toBe(409);
    expect(transactionTaskRepository.save).not.toHaveBeenCalled();
    expect(activityRepository.save).not.toHaveBeenCalled();
  });

  it('rejects detail edits for an archived task before saving or recording activity', async () => {
    task.status = TaskStatus.Done;
    task.archivedAt = new Date('2026-08-11T10:00:00.000Z');

    const response = await request(app.getHttpServer())
      .patch('/api/tasks/task-activity-1')
      .set('Cookie', activityToken(ownerId))
      .send({ title: 'Archived task must stay immutable' });

    expect(response.status).toBe(409);
    expect(transactionTaskRepository.save).not.toHaveBeenCalled();
    expect(activityRepository.save).not.toHaveBeenCalled();
  });

  it('returns only safe activity summaries for an accessible project', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/projects/project-activity-1/task-activities')
      .set('Cookie', activityToken(ownerId));

    expect(response.status).toBe(200);
    expect(response.body).toEqual([
      {
        id: 'activity-list-1',
        eventType: TaskActivityEventType.Created,
        details: {},
        createdAt: '2026-08-11T08:30:00.000Z',
        task: { id: 'task-activity-1', title: 'Original activity task' },
        actor: {
          id: ownerId,
          displayName: 'Project owner',
          email: 'owner@example.com',
        },
      },
    ]);
    expect(response.body[0].actor).not.toHaveProperty('passwordHash');
    expect(activityListRepository.find).toHaveBeenCalledWith({
      where: { task: { project: { id: 'project-activity-1' } } },
      relations: { task: true, actor: true },
      order: { createdAt: 'DESC' },
      take: 50,
    });
  });

  it('rejects activity access by a user outside the project team', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/projects/project-activity-1/task-activities')
      .set('Cookie', activityToken(outsiderId));

    expect(response.status).toBe(403);
  });

  it('archives a completed active task and records the archive activity in the transaction', async () => {
    task.status = TaskStatus.Done;

    const response = await request(app.getHttpServer())
      .patch('/api/tasks/task-activity-1/archive')
      .set('Cookie', activityToken(ownerId))
      .send({ archived: true });

    expect(response.status).toBe(200);
    expect(response.body.archivedAt).toEqual(expect.any(String));
    expect(activityRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: TaskActivityEventType.Archived,
        task: expect.objectContaining({ id: 'task-activity-1' }),
      }),
    );
    expect(transactionTaskRepository.findOne).toHaveBeenCalledWith({
      where: { id: 'task-activity-1' },
      relations: { project: { team: true }, assignee: true },
    });
    expect(transactionTaskRepository.update).toHaveBeenCalledWith(
      expect.objectContaining({ id: task.id, status: TaskStatus.Done }),
      { archivedAt: expect.any(Date) },
    );
    expect(transactionTaskRepository.save).not.toHaveBeenCalled();
    expect(globalTaskRepository.findOne).not.toHaveBeenCalled();
    expect(globalTaskRepository.save).not.toHaveBeenCalled();
    expect(transaction).toHaveBeenCalledTimes(1);
  });

  it('restores an archived task and records the restore activity in the transaction', async () => {
    task.status = TaskStatus.Done;
    task.archivedAt = new Date('2026-08-11T10:00:00.000Z');

    const response = await request(app.getHttpServer())
      .patch('/api/tasks/task-activity-1/archive')
      .set('Cookie', activityToken(ownerId))
      .send({ archived: false });

    expect(response.status).toBe(200);
    expect(response.body.archivedAt).toBeNull();
    expect(response.body.status).toBe(TaskStatus.Done);
    expect(activityRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: TaskActivityEventType.Restored,
        task: expect.objectContaining({ id: 'task-activity-1' }),
      }),
    );
    expect(transactionTaskRepository.findOne).toHaveBeenCalledWith({
      where: { id: 'task-activity-1' },
      relations: { project: { team: true }, assignee: true },
    });
    expect(transactionTaskRepository.update).toHaveBeenCalledWith(
      expect.objectContaining({ id: task.id, status: TaskStatus.Done }),
      { archivedAt: null },
    );
    expect(transactionTaskRepository.save).not.toHaveBeenCalled();
    expect(globalTaskRepository.findOne).not.toHaveBeenCalled();
    expect(globalTaskRepository.save).not.toHaveBeenCalled();
    expect(transaction).toHaveBeenCalledTimes(1);
  });

  it('rejects archiving a task that is not completed', async () => {
    const response = await request(app.getHttpServer())
      .patch('/api/tasks/task-activity-1/archive')
      .set('Cookie', activityToken(ownerId))
      .send({ archived: true });

    expect(response.status).toBe(409);
  });

  it('rejects archiving a task that is already archived', async () => {
    task.status = TaskStatus.Done;
    task.archivedAt = new Date('2026-08-11T10:00:00.000Z');

    const response = await request(app.getHttpServer())
      .patch('/api/tasks/task-activity-1/archive')
      .set('Cookie', activityToken(ownerId))
      .send({ archived: true });

    expect(response.status).toBe(409);
  });

  it('rejects restoring a task that is already active', async () => {
    task.status = TaskStatus.Done;

    const response = await request(app.getHttpServer())
      .patch('/api/tasks/task-activity-1/archive')
      .set('Cookie', activityToken(ownerId))
      .send({ archived: false });

    expect(response.status).toBe(409);
  });

  it('rejects archive requests from a user outside the task project team', async () => {
    task.status = TaskStatus.Done;

    const response = await request(app.getHttpServer())
      .patch('/api/tasks/task-activity-1/archive')
      .set('Cookie', activityToken(outsiderId))
      .send({ archived: true });

    expect(response.status).toBe(403);
  });
});

function activityToken(userId: string): string {
  const token = new JwtService({ secret: 'test-secret' }).sign({ sub: userId });
  return `access_token=${token}`;
}
