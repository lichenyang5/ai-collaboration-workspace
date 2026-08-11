import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runMigrations } from './run-migrations';

type Query = { text: string; values?: unknown[] };

describe('runMigrations', () => {
  let migrationsDirectory: string;

  beforeEach(async () => {
    migrationsDirectory = await mkdtemp(join(tmpdir(), 'task-migrations-'));
  });

  afterEach(async () => {
    await rm(migrationsDirectory, { recursive: true, force: true });
  });

  it('runs unapplied SQL migrations in filename order and records each after its SQL body', async () => {
    await writeFile(join(migrationsDirectory, '002_second.sql'), 'SELECT second;');
    await writeFile(join(migrationsDirectory, '001_first.sql'), 'SELECT first;');
    const queries: Query[] = [];
    const client = {
      query: async (text: string, values?: unknown[]) => {
        queries.push({ text, values });
        if (text.startsWith('SELECT 1 FROM schema_migrations')) {
          return { rowCount: values?.[0] === '001_first.sql' ? 1 : 0 };
        }
        return { rowCount: 0 };
      },
    };

    await expect(runMigrations(client, migrationsDirectory)).resolves.toEqual([
      '002_second.sql',
    ]);

    expect(queries.map(({ text }) => text)).toEqual([
      expect.stringContaining('CREATE TABLE IF NOT EXISTS schema_migrations'),
      'SELECT 1 FROM schema_migrations WHERE name = $1',
      'SELECT 1 FROM schema_migrations WHERE name = $1',
      'BEGIN',
      'SELECT second;',
      'INSERT INTO schema_migrations(name) VALUES ($1)',
      'COMMIT',
    ]);
    expect(queries[1].values).toEqual(['001_first.sql']);
    expect(queries[2].values).toEqual(['002_second.sql']);
    expect(queries[5].values).toEqual(['002_second.sql']);
  });

  it('rolls back and rejects when a migration SQL body fails', async () => {
    await writeFile(join(migrationsDirectory, '001_first.sql'), 'SELECT first;');
    await writeFile(join(migrationsDirectory, '002_failed.sql'), 'SELECT fail;');
    const queries: Query[] = [];
    const client = {
      query: async (text: string, values?: unknown[]) => {
        queries.push({ text, values });
        if (text.startsWith('SELECT 1 FROM schema_migrations')) {
          return { rowCount: 0 };
        }
        if (text === 'SELECT fail;') {
          throw new Error('migration SQL failed');
        }
        return { rowCount: 0 };
      },
    };

    await expect(runMigrations(client, migrationsDirectory)).rejects.toThrow(
      'migration SQL failed',
    );

    expect(queries.map(({ text }) => text)).toEqual([
      expect.stringContaining('CREATE TABLE IF NOT EXISTS schema_migrations'),
      'SELECT 1 FROM schema_migrations WHERE name = $1',
      'BEGIN',
      'SELECT first;',
      'INSERT INTO schema_migrations(name) VALUES ($1)',
      'COMMIT',
      'SELECT 1 FROM schema_migrations WHERE name = $1',
      'BEGIN',
      'SELECT fail;',
      'ROLLBACK',
    ]);
    expect(
      queries.some(
        ({ text, values }) =>
          text === 'INSERT INTO schema_migrations(name) VALUES ($1)' &&
          values?.[0] === '002_failed.sql',
      ),
    ).toBe(false);
  });
});
