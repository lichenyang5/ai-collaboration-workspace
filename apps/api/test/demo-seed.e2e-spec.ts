import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Client } from 'pg';
import {
  resolveDemoSeedAdminDatabaseUrl,
  seedDemoData,
} from '../src/database/demo-seed';

const TEST_DATABASE_NAME = 'ai_collaboration_workspace_seed_test';
const TEST_PASSWORD_HASH = 'test-password-hash';

type DemoCounts = {
  users: number;
  teams: number;
  memberships: number;
  projects: number;
  tasks: number;
  activities: number;
  activeTasks: number;
  archivedTasks: number;
};

type DemoTaskScenario = {
  id: string;
  status: string;
  assigneeId: string | null;
  isActive: boolean;
  hasExpectedDueDate: boolean;
  eventType: string;
  details: Record<string, never>;
};

function getAdminDatabaseUrl(): string {
  return resolveDemoSeedAdminDatabaseUrl(process.env);
}

function getTestDatabaseUrl(adminDatabaseUrl: string): string {
  const testDatabaseUrl = new URL(adminDatabaseUrl);
  testDatabaseUrl.pathname = `/${TEST_DATABASE_NAME}`;
  const connectionString = testDatabaseUrl.toString();
  assertExactTestDatabase(connectionString);
  return connectionString;
}

function assertExactTestDatabase(connectionString: string): void {
  const databaseName = new URL(connectionString).pathname.replace(/^\/+/, '');
  if (databaseName !== TEST_DATABASE_NAME) {
    throw new Error(
      `Demo seed e2e may use only ${TEST_DATABASE_NAME}; received ${databaseName || '(none)'}`,
    );
  }
}

async function terminateTestDatabaseConnections(adminClient: Client): Promise<void> {
  assertExactTestDatabase(getTestDatabaseUrl(getAdminDatabaseUrl()));
  await adminClient.query(
    'SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()',
    [TEST_DATABASE_NAME],
  );
}

async function recreateTestDatabase(adminClient: Client): Promise<void> {
  assertExactTestDatabase(getTestDatabaseUrl(getAdminDatabaseUrl()));
  await terminateTestDatabaseConnections(adminClient);
  await adminClient.query(`DROP DATABASE IF EXISTS "${TEST_DATABASE_NAME}"`);
  await adminClient.query(`CREATE DATABASE "${TEST_DATABASE_NAME}"`);
}

async function dropTestDatabase(adminClient: Client): Promise<void> {
  assertExactTestDatabase(getTestDatabaseUrl(getAdminDatabaseUrl()));
  await terminateTestDatabaseConnections(adminClient);
  await adminClient.query(`DROP DATABASE IF EXISTS "${TEST_DATABASE_NAME}"`);
}

async function applyDatabaseSetup(testClient: Client): Promise<void> {
  const schemaPath = resolve(__dirname, '../sql/schema.sql');
  const migrationsDirectory = resolve(__dirname, '../sql/migrations');

  await testClient.query(await readFile(schemaPath, 'utf8'));

  const migrationNames = (await readdir(migrationsDirectory))
    .filter((name) => name.endsWith('.sql'))
    .sort();
  for (const migrationName of migrationNames) {
    await testClient.query(
      await readFile(resolve(migrationsDirectory, migrationName), 'utf8'),
    );
  }
}

async function readDemoCounts(testClient: Client): Promise<DemoCounts> {
  const result = await testClient.query<DemoCounts>(`
    SELECT
      (SELECT COUNT(*)::int FROM users) AS "users",
      (SELECT COUNT(*)::int FROM teams) AS "teams",
      (SELECT COUNT(*)::int FROM team_members) AS "memberships",
      (SELECT COUNT(*)::int FROM projects) AS "projects",
      (SELECT COUNT(*)::int FROM tasks) AS "tasks",
      (SELECT COUNT(*)::int FROM task_activities) AS "activities",
      (SELECT COUNT(*)::int FROM tasks WHERE archived_at IS NULL) AS "activeTasks",
      (SELECT COUNT(*)::int FROM tasks WHERE archived_at IS NOT NULL) AS "archivedTasks"
  `);
  return result.rows[0];
}

async function readDemoTaskScenarios(
  testClient: Client,
): Promise<DemoTaskScenario[]> {
  const result = await testClient.query<DemoTaskScenario>(
    `SELECT
       task.id AS "id",
       task.status AS "status",
       task.assignee_id AS "assigneeId",
       task.archived_at IS NULL AS "isActive",
       CASE task.id
         WHEN $1 THEN task.due_date::date = CURRENT_DATE - 1
         WHEN $2 THEN task.due_date::date = CURRENT_DATE + 2
         WHEN $3 THEN task.due_date IS NULL
         WHEN $4 THEN task.due_date IS NULL
       END AS "hasExpectedDueDate",
       activity.event_type AS "eventType",
       activity.details AS "details"
     FROM tasks AS task
     INNER JOIN task_activities AS activity ON activity.task_id = task.id
     WHERE task.id = ANY($5::uuid[])
     ORDER BY task.id`,
    [
      '44444444-4444-4444-8444-444444444441',
      '44444444-4444-4444-8444-444444444442',
      '44444444-4444-4444-8444-444444444443',
      '44444444-4444-4444-8444-444444444444',
      [
        '44444444-4444-4444-8444-444444444441',
        '44444444-4444-4444-8444-444444444442',
        '44444444-4444-4444-8444-444444444443',
        '44444444-4444-4444-8444-444444444444',
      ],
    ],
  );
  return result.rows;
}

describe('Demo seed e2e', () => {
  let adminClient: Client | undefined;
  let testClient: Client | undefined;
  let adminConnected = false;
  let testClientConnected = false;

  beforeAll(async () => {
    const adminDatabaseUrl = getAdminDatabaseUrl();
    const testDatabaseUrl = getTestDatabaseUrl(adminDatabaseUrl);
    adminClient = new Client({ connectionString: adminDatabaseUrl });

    try {
      await adminClient.connect();
      adminConnected = true;
    } catch (error) {
      throw new Error(
        `Unable to connect to the Demo seed e2e administrator database: ${(error as Error).message}`,
      );
    }

    await recreateTestDatabase(adminClient);
    testClient = new Client({ connectionString: testDatabaseUrl });
    await testClient.connect();
    testClientConnected = true;
    await testClient.query("SET TIME ZONE 'UTC'");
    await applyDatabaseSetup(testClient);
  });

  it('is idempotent and keeps representative active and archived Demo data', async () => {
    if (!testClient) {
      throw new Error('Demo seed test database was not initialized');
    }

    await seedDemoData(testClient, TEST_PASSWORD_HASH);
    const firstCounts = await readDemoCounts(testClient);

    expect(firstCounts).toEqual({
      users: 2,
      teams: 1,
      memberships: 2,
      projects: 1,
      tasks: 4,
      activities: 4,
      activeTasks: 3,
      archivedTasks: 1,
    });

    await seedDemoData(testClient, TEST_PASSWORD_HASH);
    expect(await readDemoCounts(testClient)).toEqual(firstCounts);
  });

  it('seeds the exact board and archive scenarios with empty activity details', async () => {
    if (!testClient) {
      throw new Error('Demo seed test database was not initialized');
    }

    await seedDemoData(testClient, TEST_PASSWORD_HASH);

    await expect(readDemoTaskScenarios(testClient)).resolves.toEqual([
      {
        id: '44444444-4444-4444-8444-444444444441',
        status: 'todo',
        assigneeId: null,
        isActive: true,
        hasExpectedDueDate: true,
        eventType: 'created',
        details: {},
      },
      {
        id: '44444444-4444-4444-8444-444444444442',
        status: 'in_progress',
        assigneeId: '11111111-1111-4111-8111-111111111111',
        isActive: true,
        hasExpectedDueDate: true,
        eventType: 'created',
        details: {},
      },
      {
        id: '44444444-4444-4444-8444-444444444443',
        status: 'done',
        assigneeId: '11111111-1111-4111-8111-111111111112',
        isActive: true,
        hasExpectedDueDate: true,
        eventType: 'created',
        details: {},
      },
      {
        id: '44444444-4444-4444-8444-444444444444',
        status: 'done',
        assigneeId: '11111111-1111-4111-8111-111111111112',
        isActive: false,
        hasExpectedDueDate: true,
        eventType: 'archived',
        details: {},
      },
    ]);
  });

  it('preserves non-Demo rows and restores changed fixed Demo rows on re-run', async () => {
    if (!testClient) {
      throw new Error('Demo seed test database was not initialized');
    }

    const unrelatedUserId = '77777777-7777-4777-8777-777777777777';
    const activeTaskId = '44444444-4444-4444-8444-444444444441';

    await testClient.query(
      `INSERT INTO users (id, email, display_name, password_hash)
       VALUES ($1, $2, $3, $4)`,
      [
        unrelatedUserId,
        'not-a-demo-user@workspace.local',
        'Not a Demo User',
        'unrelated-password-hash',
      ],
    );
    await testClient.query('UPDATE tasks SET title = $1 WHERE id = $2', [
      'Changed outside the Demo seed',
      activeTaskId,
    ]);

    await seedDemoData(testClient, TEST_PASSWORD_HASH);

    const unrelatedUser = await testClient.query(
      'SELECT id FROM users WHERE id = $1',
      [unrelatedUserId],
    );
    const activeTask = await testClient.query<{ title: string }>(
      'SELECT title FROM tasks WHERE id = $1',
      [activeTaskId],
    );

    expect(unrelatedUser.rowCount).toBe(1);
    expect(activeTask.rows[0].title).toBe('Prepare the launch checklist');
  });

  afterAll(async () => {
    try {
      try {
        if (testClientConnected) {
          await testClient?.end();
        }
      } finally {
        if (adminClient && adminConnected) {
          await dropTestDatabase(adminClient);
        }
      }
    } finally {
      if (adminConnected) {
        await adminClient?.end();
      }
    }
  });
});
