import { randomBytes } from 'node:crypto';
import { Pool } from 'pg';
import { getDatabaseConfig } from '../../electron/config.js';
import { runMigrations } from '../../scripts/migrate.js';
import { createLogger } from '../../electron/lib/logger.js';

/**
 * A disposable database with the real migrations applied.
 *
 * Constraint behaviour cannot be tested with pg-mem, because pg-mem does not
 * implement CHECK constraints or partial indexes faithfully. These tests run
 * against real Postgres, which is the only way to prove the invariants the
 * project depends on.
 */

export interface TestDatabase {
  pool: Pool;
  name: string;
  dispose(): Promise<void>;
}

function adminPool(): Pool {
  return new Pool({ ...getDatabaseConfig(), database: 'postgres', max: 1 });
}

/**
 * Creates a uniquely named database, applies every migration, and returns a
 * pool pointed at it.
 *
 * @param label - Readable prefix so a leaked database is identifiable in
 *   `psql -l` output.
 */
export async function createTestDatabase(label: string): Promise<TestDatabase> {
  const suffix = randomBytes(4).toString('hex');
  const name = `storyboard_t_${label}_${suffix}`;
  const admin = adminPool();

  try {
    await admin.query(`CREATE DATABASE ${name}`);
  } finally {
    await admin.end();
  }

  const pool = new Pool({ ...getDatabaseConfig(), database: name, max: 4 });

  try {
    await runMigrations(createLogger(), pool);
  } catch (err) {
    await pool.end();
    throw new Error(`Failed to migrate test database ${name}: ${String(err)}`, {
      cause: err,
    });
  }

  return {
    pool,
    name,
    async dispose() {
      await pool.end();
      const dropper = adminPool();
      try {
        await dropper.query(
          `DROP DATABASE IF EXISTS ${name} WITH (FORCE)`,
        );
      } finally {
        await dropper.end();
      }
    },
  };
}