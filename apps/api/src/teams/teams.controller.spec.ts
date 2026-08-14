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
      findOne: jest.fn(async () => ({ id: 'team-1', name: '产品研发组' })),
    };
    const memberRepository = {
      create: jest.fn((value: object) => value),
      save: jest.fn(async (value: object) =>
        'role' in value
          ? {
              ...value,
              id: 'membership-2',
              createdAt: new Date('2026-08-14T08:00:00.000Z'),
            }
          : value,
      ),
      find: jest.fn(async () => [
        {
          role: 'owner',
          team: { id: 'team-1', name: '产品研发组' },
          user: {
            id: 'user-1',
            displayName: '团队负责人',
            email: 'owner@example.com',
            passwordHash: 'must-not-be-exposed',
          },
        },
      ]),
      findOne: jest.fn(
        async (options: { where?: { user?: { id?: string } } }) => {
          if (options.where?.user?.id === 'user-1') {
            return { id: 'membership-1', role: 'owner' };
          }

          return null;
        },
      ),
    };
    const userRepository = {
      findOne: jest.fn(async () => ({
        id: 'member-user-2',
        displayName: '成员二',
        email: 'member@example.com',
      })),
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
      .useValue({
        transaction: jest.fn((callback: (value: typeof manager) => unknown) =>
          callback(manager),
        ),
        getRepository: jest.fn((entity: unknown) =>
          entity === TeamMember
            ? memberRepository
            : entity === User
              ? userRepository
              : teamRepository,
        ),
      })
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
    const token = new JwtService({ secret: 'test-secret' }).sign({
      sub: 'user-1',
    });
    const response = await request(app.getHttpServer())
      .post('/api/teams')
      .set('Cookie', `access_token=${token}`)
      .send({ name: '产品研发组' });

    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({ id: 'team-1', name: '产品研发组' });
  });
  it('returns only teams that belong to the authenticated user', async () => {
    const token = new JwtService({ secret: 'test-secret' }).sign({
      sub: 'user-1',
    });
    const response = await request(app.getHttpServer())
      .get('/api/teams')
      .set('Cookie', `access_token=${token}`);

    expect(response.status).toBe(200);
    expect(response.body).toEqual([
      { id: 'team-1', name: '产品研发组', role: 'owner' },
    ]);
  });

  it('allows an owner to invite a registered user and returns only public member fields', async () => {
    const token = new JwtService({ secret: 'test-secret' }).sign({
      sub: 'user-1',
    });
    const response = await request(app.getHttpServer())
      .post('/api/teams/team-1/members')
      .set('Cookie', `access_token=${token}`)
      .send({ email: 'member@example.com' });

    expect(response.status).toBe(201);
    expect(response.body).toEqual({
      id: 'member-user-2',
      displayName: '成员二',
      email: 'member@example.com',
      role: 'member',
    });
    expect(response.body).not.toHaveProperty('passwordHash');
  });

  it("lists a team's members without exposing password hashes", async () => {
    const token = new JwtService({ secret: 'test-secret' }).sign({
      sub: 'user-1',
    });
    const response = await request(app.getHttpServer())
      .get('/api/teams/team-1/members')
      .set('Cookie', `access_token=${token}`);

    expect(response.status).toBe(200);
    expect(response.body).toEqual([
      {
        id: 'user-1',
        displayName: '团队负责人',
        email: 'owner@example.com',
        role: 'owner',
      },
    ]);
    expect(response.body[0]).not.toHaveProperty('passwordHash');
  });
});
