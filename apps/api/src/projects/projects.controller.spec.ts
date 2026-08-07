import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { getDataSourceToken, getRepositoryToken } from '@nestjs/typeorm';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { AppModule } from '../app.module';
import { Project } from '../database/entities/project.entity';
import { TeamMember, TeamMemberRole } from '../database/entities/team-member.entity';
import { User } from '../database/entities/user.entity';

process.env.JWT_SECRET = 'test-secret';

describe('Project creation', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const projectRepository = {
      create: jest.fn((value: object) => ({ id: 'project-1', ...value })),
      save: jest.fn(async (value: object) => value),
    };
    const membershipRepository = {
      findOne: jest.fn(async () => ({ role: TeamMemberRole.Owner })),
    };
    const dataSource = {
      getRepository: jest.fn((entity: unknown) =>
        entity === Project ? projectRepository : membershipRepository,
      ),
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

  it('allows an owner to create a project in their team', async () => {
    const token = new JwtService({ secret: 'test-secret' }).sign({ sub: 'user-1' });
    const response = await request(app.getHttpServer())
      .post('/api/teams/team-1/projects')
      .set('Cookie', `access_token=${token}`)
      .send({ name: '协同工作台 MVP', description: '第一阶段交付' });

    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({ id: 'project-1', name: '协同工作台 MVP' });
  });
});