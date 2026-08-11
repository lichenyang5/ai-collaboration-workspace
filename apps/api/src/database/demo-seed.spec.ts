import type { Client } from 'pg';
import {
  assertDemoSeedEnvironment,
  buildDemoTaskFixtures,
  resolveDemoSeedAdminDatabaseUrl,
  seedDemoData,
} from './demo-seed';

const PRODUCTION_SEED_ERROR = '生产环境禁止运行 Demo seed';
const MISSING_DATABASE_URL_ERROR = '缺少 DATABASE_URL';
const MISSING_DEMO_PASSWORD_ERROR = '缺少 DEMO_USER_PASSWORD';
const MISSING_TEST_ADMIN_URL_ERROR = '缺少 TEST_DATABASE_ADMIN_URL';

describe('assertDemoSeedEnvironment', () => {
  it('rejects a Demo seed in production even when its required variables exist', () => {
    expect(() =>
      assertDemoSeedEnvironment({
        NODE_ENV: 'production',
        DATABASE_URL: 'postgresql://localhost/demo',
        DEMO_USER_PASSWORD: 'not-a-real-password',
      }),
    ).toThrow(PRODUCTION_SEED_ERROR);
  });

  it('rejects a Demo seed without DATABASE_URL', () => {
    expect(() =>
      assertDemoSeedEnvironment({
        NODE_ENV: 'development',
        DEMO_USER_PASSWORD: 'not-a-real-password',
      }),
    ).toThrow(MISSING_DATABASE_URL_ERROR);
  });

  it('rejects a Demo seed without DEMO_USER_PASSWORD', () => {
    expect(() =>
      assertDemoSeedEnvironment({
        NODE_ENV: 'development',
        DATABASE_URL: 'postgresql://localhost/demo',
      }),
    ).toThrow(MISSING_DEMO_PASSWORD_ERROR);
  });
});

describe('resolveDemoSeedAdminDatabaseUrl', () => {
  it('rejects DATABASE_URL-only configuration instead of using it for destructive e2e setup', () => {
    expect(() =>
      resolveDemoSeedAdminDatabaseUrl({
        DATABASE_URL: 'postgresql://localhost/ordinary_application_database',
      }),
    ).toThrow(MISSING_TEST_ADMIN_URL_ERROR);
  });

  it('uses the explicitly configured test administrator URL', () => {
    expect(
      resolveDemoSeedAdminDatabaseUrl({
        TEST_DATABASE_ADMIN_URL: 'postgresql://localhost/postgres',
        DATABASE_URL: 'postgresql://localhost/ordinary_application_database',
      }),
    ).toBe('postgresql://localhost/postgres');
  });
});

describe('seedDemoData', () => {
  it('rolls back and never commits when a mid-sequence query fails', async () => {
    const queries: string[] = [];
    let userInsertAttempts = 0;
    const injectedFailure = new Error('injected user upsert failure');
    const client = {
      query: async (text: string) => {
        queries.push(text);
        if (text.includes('INSERT INTO users')) {
          userInsertAttempts += 1;
          if (userInsertAttempts === 2) {
            throw injectedFailure;
          }
        }
        return { rowCount: 0 };
      },
    } as unknown as Pick<Client, 'query'>;

    await expect(seedDemoData(client, 'test-password-hash')).rejects.toThrow(
      injectedFailure,
    );

    expect(queries).toContain('BEGIN');
    expect(queries).toContain('ROLLBACK');
    expect(queries).not.toContain('COMMIT');
  });
});

describe('buildDemoTaskFixtures', () => {
  it('builds every active and archived Demo scenario from UTC calendar dates', () => {
    const fixtures = buildDemoTaskFixtures(
      new Date('2042-06-15T15:45:00.000Z'),
    );

    expect(
      fixtures.tasks.map((task) => ({
        id: task.id,
        status: task.status,
        assigneeId: task.assigneeId,
        dueDate: task.dueDate?.toISOString() ?? null,
        archivedAt: task.archivedAt?.toISOString() ?? null,
      })),
    ).toEqual([
      {
        id: '44444444-4444-4444-8444-444444444441',
        status: 'todo',
        assigneeId: null,
        dueDate: '2042-06-14T00:00:00.000Z',
        archivedAt: null,
      },
      {
        id: '44444444-4444-4444-8444-444444444442',
        status: 'in_progress',
        assigneeId: '11111111-1111-4111-8111-111111111111',
        dueDate: '2042-06-17T00:00:00.000Z',
        archivedAt: null,
      },
      {
        id: '44444444-4444-4444-8444-444444444443',
        status: 'done',
        assigneeId: '11111111-1111-4111-8111-111111111112',
        dueDate: null,
        archivedAt: null,
      },
      {
        id: '44444444-4444-4444-8444-444444444444',
        status: 'done',
        assigneeId: '11111111-1111-4111-8111-111111111112',
        dueDate: null,
        archivedAt: '2042-06-15T00:00:00.000Z',
      },
    ]);
  });

  it('attaches empty details to matching created and archived activities', () => {
    const fixtures = buildDemoTaskFixtures(
      new Date('2042-06-15T15:45:00.000Z'),
    );

    expect(
      fixtures.activities.map((activity) => ({
        taskId: activity.taskId,
        actorId: activity.actorId,
        eventType: activity.eventType,
        details: activity.details,
      })),
    ).toEqual([
      {
        taskId: '44444444-4444-4444-8444-444444444441',
        actorId: '11111111-1111-4111-8111-111111111111',
        eventType: 'created',
        details: {},
      },
      {
        taskId: '44444444-4444-4444-8444-444444444442',
        actorId: '11111111-1111-4111-8111-111111111111',
        eventType: 'created',
        details: {},
      },
      {
        taskId: '44444444-4444-4444-8444-444444444443',
        actorId: '11111111-1111-4111-8111-111111111112',
        eventType: 'created',
        details: {},
      },
      {
        taskId: '44444444-4444-4444-8444-444444444444',
        actorId: '11111111-1111-4111-8111-111111111112',
        eventType: 'archived',
        details: {},
      },
    ]);
  });
});
