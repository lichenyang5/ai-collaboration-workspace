import type { Client } from 'pg';

type SeedClient = Pick<Client, 'query'>;

export const DEMO_USERS = [
  {
    id: '11111111-1111-4111-8111-111111111111',
    email: 'demo.alice@workspace.local',
    displayName: 'Demo Alice',
  },
  {
    id: '11111111-1111-4111-8111-111111111112',
    email: 'demo.bob@workspace.local',
    displayName: 'Demo Bob',
  },
] as const;

export const DEMO_TEAM = {
  id: '22222222-2222-4222-8222-222222222222',
  name: 'Demo Collaboration Team',
} as const;

export const DEMO_PROJECT = {
  id: '33333333-3333-4333-8333-333333333333',
  name: 'Demo Product Launch',
  description: 'A fixed project for the task-management demonstration.',
} as const;

type DemoTaskFixture = {
  id: string;
  title: string;
  description: string;
  status: 'todo' | 'in_progress' | 'done';
  priority: 'low' | 'medium' | 'high';
  assigneeId: string | null;
  dueDate: Date | null;
  archivedAt: Date | null;
};

type DemoActivityFixture = {
  id: string;
  taskId: string;
  actorId: string;
  eventType: 'created' | 'archived';
  details: Record<string, never>;
};

function utcCalendarDate(now: Date, dayOffset: number): Date {
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + dayOffset),
  );
}

export function buildDemoTaskFixtures(now: Date): {
  tasks: DemoTaskFixture[];
  activities: DemoActivityFixture[];
} {
  const today = utcCalendarDate(now, 0);
  const tasks: DemoTaskFixture[] = [
    {
      id: '44444444-4444-4444-8444-444444444441',
      title: 'Prepare the launch checklist',
      description: 'The overdue, unassigned task used as the Demo edit target.',
      status: 'todo',
      priority: 'high',
      assigneeId: null,
      dueDate: utcCalendarDate(now, -1),
      archivedAt: null,
    },
    {
      id: '44444444-4444-4444-8444-444444444442',
      title: 'Coordinate the launch review',
      description: 'An assigned task in the due-soon window.',
      status: 'in_progress',
      priority: 'high',
      assigneeId: DEMO_USERS[0].id,
      dueDate: utcCalendarDate(now, 2),
      archivedAt: null,
    },
    {
      id: '44444444-4444-4444-8444-444444444443',
      title: 'Publish the release notes',
      description: 'A completed task that remains on the active board.',
      status: 'done',
      priority: 'medium',
      assigneeId: DEMO_USERS[1].id,
      dueDate: null,
      archivedAt: null,
    },
    {
      id: '44444444-4444-4444-8444-444444444444',
      title: 'Archive the completed research',
      description: 'A completed task retained in the archive for the demo.',
      status: 'done',
      priority: 'medium',
      assigneeId: DEMO_USERS[1].id,
      dueDate: null,
      archivedAt: today,
    },
  ];

  return {
    tasks,
    activities: [
      {
        id: '55555555-5555-4555-8555-555555555551',
        taskId: tasks[0].id,
        actorId: DEMO_USERS[0].id,
        eventType: 'created',
        details: {},
      },
      {
        id: '55555555-5555-4555-8555-555555555552',
        taskId: tasks[1].id,
        actorId: DEMO_USERS[0].id,
        eventType: 'created',
        details: {},
      },
      {
        id: '55555555-5555-4555-8555-555555555553',
        taskId: tasks[2].id,
        actorId: DEMO_USERS[1].id,
        eventType: 'created',
        details: {},
      },
      {
        id: '55555555-5555-4555-8555-555555555554',
        taskId: tasks[3].id,
        actorId: DEMO_USERS[1].id,
        eventType: 'archived',
        details: {},
      },
    ],
  };
}

export function assertDemoSeedEnvironment(env: NodeJS.ProcessEnv): void {
  if (env.NODE_ENV === 'production') {
    throw new Error('生产环境禁止运行 Demo seed');
  }
  if (!env.DATABASE_URL) {
    throw new Error('缺少 DATABASE_URL');
  }
  if (!env.DEMO_USER_PASSWORD) {
    throw new Error('缺少 DEMO_USER_PASSWORD');
  }
}

export function resolveDemoSeedAdminDatabaseUrl(
  env: NodeJS.ProcessEnv,
): string {
  if (!env.TEST_DATABASE_ADMIN_URL) {
    throw new Error('缺少 TEST_DATABASE_ADMIN_URL');
  }
  return env.TEST_DATABASE_ADMIN_URL;
}

export async function seedDemoData(
  client: SeedClient,
  passwordHash: string,
): Promise<void> {
  const { tasks, activities } = buildDemoTaskFixtures(new Date());
  await client.query('BEGIN');

  try {
    for (const user of DEMO_USERS) {
      await client.query(
        `INSERT INTO users (id, email, display_name, password_hash)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (id) DO UPDATE
         SET email = EXCLUDED.email,
             display_name = EXCLUDED.display_name,
             password_hash = EXCLUDED.password_hash,
             updated_at = NOW()`,
        [user.id, user.email, user.displayName, passwordHash],
      );
    }

    await client.query(
      `INSERT INTO teams (id, name, created_by_id)
       VALUES ($1, $2, $3)
       ON CONFLICT (id) DO UPDATE
       SET name = EXCLUDED.name,
           created_by_id = EXCLUDED.created_by_id`,
      [DEMO_TEAM.id, DEMO_TEAM.name, DEMO_USERS[0].id],
    );

    for (const membership of [
      {
        id: '66666666-6666-4666-8666-666666666661',
        userId: DEMO_USERS[0].id,
        role: 'owner',
      },
      {
        id: '66666666-6666-4666-8666-666666666662',
        userId: DEMO_USERS[1].id,
        role: 'member',
      },
    ] as const) {
      await client.query(
        `INSERT INTO team_members (id, team_id, user_id, role)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (id) DO UPDATE
         SET team_id = EXCLUDED.team_id,
             user_id = EXCLUDED.user_id,
             role = EXCLUDED.role`,
        [membership.id, DEMO_TEAM.id, membership.userId, membership.role],
      );
    }

    await client.query(
      `INSERT INTO projects (id, name, description, team_id)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (id) DO UPDATE
       SET name = EXCLUDED.name,
           description = EXCLUDED.description,
           team_id = EXCLUDED.team_id,
           updated_at = NOW()`,
      [
        DEMO_PROJECT.id,
        DEMO_PROJECT.name,
        DEMO_PROJECT.description,
        DEMO_TEAM.id,
      ],
    );

    for (const task of tasks) {
      await client.query(
        `INSERT INTO tasks (
           id, title, description, status, priority, project_id, assignee_id, due_date, archived_at
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8::timestamptz, $9::timestamptz)
         ON CONFLICT (id) DO UPDATE
         SET title = EXCLUDED.title,
             description = EXCLUDED.description,
             status = EXCLUDED.status,
             priority = EXCLUDED.priority,
             project_id = EXCLUDED.project_id,
             assignee_id = EXCLUDED.assignee_id,
             due_date = EXCLUDED.due_date,
             archived_at = EXCLUDED.archived_at,
             updated_at = NOW()`,
        [
          task.id,
          task.title,
          task.description,
          task.status,
          task.priority,
          DEMO_PROJECT.id,
          task.assigneeId,
          task.dueDate,
          task.archivedAt,
        ],
      );
    }

    for (const activity of activities) {
      await client.query(
        `INSERT INTO task_activities (id, task_id, actor_id, event_type, details)
         VALUES ($1, $2, $3, $4, $5::jsonb)
         ON CONFLICT (id) DO UPDATE
         SET task_id = EXCLUDED.task_id,
             actor_id = EXCLUDED.actor_id,
             event_type = EXCLUDED.event_type,
             details = EXCLUDED.details`,
        [
          activity.id,
          activity.taskId,
          activity.actorId,
          activity.eventType,
          JSON.stringify(activity.details),
        ],
      );
    }

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}
