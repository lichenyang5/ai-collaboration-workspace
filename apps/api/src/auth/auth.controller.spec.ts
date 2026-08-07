import { INestApplication } from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../app.module';

process.env.JWT_SECRET = 'test-secret';
import { User } from '../database/entities/user.entity';

describe('Auth registration', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(getRepositoryToken(User))
      .useValue({
        findOne: jest.fn().mockResolvedValue(null),
        create: jest.fn((value: object) => ({ id: 'user-1', ...value })),
        save: jest.fn(async (value: object) => value),
      })
      .compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('registers a user without returning the password hash', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/auth/register')
      .send({
        email: 'demo@example.com',
        displayName: 'Demo User',
        password: 'password123',
      });

    expect(response.status).toBe(201);
    expect(response.body.user).toEqual({
      id: 'user-1',
      email: 'demo@example.com',
      displayName: 'Demo User',
    });
    expect(response.body.user).not.toHaveProperty('passwordHash');
  });
});