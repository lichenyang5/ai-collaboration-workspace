import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { getDataSourceToken, getRepositoryToken } from '@nestjs/typeorm';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { AppModule } from '../app.module';
import { Project } from '../database/entities/project.entity';
import { Task, TaskPriority, TaskStatus } from '../database/entities/task.entity';
import { TeamMember } from '../database/entities/team-member.entity';
import { User } from '../database/entities/user.entity';

process.env.JWT_SECRET = 'test-secret';

describe('Task creation', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const taskRepository = {
      create: jest.fn((value: object) => ({ id: 'task-1', ...value })),
      save: jest.fn(async (value: object) => value),
      find: jest.fn(async () => [
        { id: 'task-todo', title: '待处理任务', status: TaskStatus.Todo },
        { id: 'task-progress', title: '进行中任务', status: TaskStatus.InProgress },
        { id: 'task-done', title: '已完成任务', status: TaskStatus.Done },
      ]),
    };
    const projectRepository = {
      findOne: jest.fn(async () => ({ id: 'project-1', team: { id: 'team-1' } })),
    };
    const membershipRepository = {
      findOne: jest.fn(async () => ({ id: 'membership-1' })),
    };
    const dataSource = {
      getRepository: jest.fn((entity: unknown) => {
        if (entity === Task) {
          return taskRepository;
        }
        if (entity === Project) {
          return projectRepository;
        }
        return membershipRepository;
      }),
    };
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(getRepositoryToken(User))
      .useValue({})
      .overrideProvider(getDataSourceToken())
      .useValue(dataSource)
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
    const token = new JwtService({ secret: 'test-secret' }).sign({ sub: 'user-1' });
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
    const token = new JwtService({ secret: 'test-secret' }).sign({ sub: 'user-1' });
    const response = await request(app.getHttpServer())
      .get('/api/projects/project-1/tasks')
      .set('Cookie', `access_token=${token}`);

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      projectId: 'project-1',
      columns: {
        todo: [{ id: 'task-todo' }],
        in_progress: [{ id: 'task-progress' }],
        done: [{ id: 'task-done' }],
      },
    });
  });
});