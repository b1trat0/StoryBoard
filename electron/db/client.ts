import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import type { Logger } from '../lib/logger.js';
import { getDatabaseConfig } from '../config.js';
import { schema } from './schema.js';

/**
 * The single Postgres connection pool for the main process.
 *
 * There is no HTTP layer, so this pool is the entire data boundary. It is
 * created lazily by initDb so that importing this module never opens a socket,
 * which keeps unit tests that only need the schema free of a running database.
 */
let pool: Pool | null = null;
let db: ReturnType<typeof drizzle<typeof schema>> | null = null;

export function initDb(logger: Logger) {
  if (db !== null) {
    return db;
  }

  pool = new Pool({
    ...getDatabaseConfig(),
    max: 10,
    // A pool error with no listener crashes the process. An idle client can be
    // dropped by Postgres or by a laptop resuming from sleep, which is expected
    // on a local single-user setup and must not be fatal.
    idleTimeoutMillis: 30_000,
  });

  pool.on('error', (err) => {
    logger.error('postgres idle client error', { err: String(err) });
  });

  db = drizzle(pool, { schema, logger: false });
  logger.info('database client initialised');
  return db;
}

/** Throws if called before initDb. Every caller runs after main() initialises. */
export function getDb() {
  if (db === null) {
    throw new Error('Database client not initialised. Call initDb first.');
  }
  return db;
}

/** Used by the migration runner and pg_dump script, which need raw SQL. */
export function getPool(): Pool {
  if (pool === null) {
    throw new Error('Database pool not initialised. Call initDb first.');
  }
  return pool;
}

/**
 * Points this module at an externally created pool instead of opening its own.
 *
 * Integration tests own their disposable database and its lifetime, and need the
 * repositories to run against that database rather than the developer's own. This
 * is the seam that lets a test use the real repositories, the real SQL and the
 * real migrations without a global second connection.
 *
 * @param externalPool - An initialised pool whose lifetime the caller controls
 */
export function useDb(externalPool: Pool): void {
  pool = externalPool;
  db = drizzle(externalPool, { schema, logger: false });
}

/** Restores the uninitialised state so a test cannot leak into the next one. */
export function resetDb(): void {
  pool = null;
  db = null;
}

export async function closeDb(): Promise<void> {
  if (pool !== null) {
    await pool.end();
    pool = null;
    db = null;
  }
}