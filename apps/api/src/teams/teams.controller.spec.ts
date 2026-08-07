import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { getDataSourceToken, getRepositoryToken } from '@nestjs/typeorm';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { AppModule } from '../app.module';
import { TeamMember } from '../database/entities/team-member.entity';
import { Team } from '../database/entities/team.entity';
import { User } from '../database/entities/user.entity';

process.env.JWT_SECRET = 'test-secret';

describe('Team creation', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const teamRepository = {
      create: jest.fn((value: object) => ({ id: 'team-1', ...value })),
      save: jest.fn(async (value: object) => value),
    };
    const memberRepository = {
      create: jest.fn((value: object) => value),
      save: jest.fn(async (value: object) => value),
    };
    const manager = {
      getRepository: jest.fn((entity: unknown) =>
        entity === Team ? teamRepository : memberRepository,
      ),
    };

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(getRepositoryToken(User))
      .useValue({})
      .overrideProvider(getDataSourceToken())
      .useValue({ transaction: jest.fn((callback: (value: typeof manager) => unknown) => callback(manager)) })
      .compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    app.use(cookieParser());
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('creates a team and its owner membership for the authenticated user', async () => {
    const token = new JwtService({ secret: 'test-secret' }).sign({ sub: 'user-1' });
    const response = await request(app.getHttpServer())
      .post('/api/teams')
      .set('Cookie', `access_token=${token}`)
      .send({ name: '产品研发组' });

    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({ id: 'team-1', name: '产品研发组' });
  });
});