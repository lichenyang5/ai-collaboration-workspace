import { readdir, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

type MigrationQueryResult = { rowCount: number | null };

export type MigrationClient = {
  query(text: string, values?: unknown[]): Promise<MigrationQueryResult>;
};

export async function runMigrations(
  client: MigrationClient,
  migrationsDirectory: string,
): Promise<string[]> {
  const files = (await readdir(migrationsDirectory))
    .filter((name) => name.endsWith('.sql'))
    .sort();
  const appliedNames: string[] = [];

  await client.query(
    'CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW())',
  );

  for (const name of files) {
    const applied = await client.query(
      'SELECT 1 FROM schema_migrations WHERE name = $1',
      [name],
    );
    if (applied.rowCount) continue;

    await client.query('BEGIN');
    try {
      await client.query(await readFile(join(migrationsDirectory, name), 'utf8'));
      await client.query('INSERT INTO schema_migrations(name) VALUES ($1)', [name]);
      await client.query('COMMIT');
      appliedNames.push(name);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
  }

  return appliedNames;
}

type PgClient = MigrationClient & {
  connect(): Promise<void>;
  end(): Promise<void>;
};

type PgClientConstructor = new (options: { connectionString: string }) => PgClient;

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is required');
  }

  const { Client } = require('pg') as { Client: PgClientConstructor };
  const client = new Client({ connectionString: databaseUrl });
  try {
    await client.connect();
    const appliedNames = await runMigrations(
      client,
      resolve(process.cwd(), 'sql', 'migrations'),
    );
    console.log(`Applied migrations: ${appliedNames.join(', ') || 'none'}`);
  } finally {
    await client.end();
  }
}

if (require.main === module) {
  void main();
}
