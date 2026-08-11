import * as bcrypt from 'bcryptjs';
import { Client } from 'pg';
import {
  assertDemoSeedEnvironment,
  DEMO_PROJECT,
  DEMO_USERS,
  seedDemoData,
} from './demo-seed';

async function main(): Promise<void> {
  assertDemoSeedEnvironment(process.env);

  const client = new Client({ connectionString: process.env.DATABASE_URL });
  try {
    await client.connect();
    const passwordHash = await bcrypt.hash(process.env.DEMO_USER_PASSWORD!, 12);
    await seedDemoData(client, passwordHash);
    console.log(
      `Demo seed complete: ${DEMO_USERS.map((user) => user.email).join(', ')}; project: ${DEMO_PROJECT.name}`,
    );
  } finally {
    await client.end();
  }
}

if (require.main === module) {
  void main().catch(() => {
    console.error('Demo seed failed');
    process.exitCode = 1;
  });
}
