import { existsSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { dirname, isAbsolute, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Pool } from 'pg';
import type { Logger } from '../electron/lib/logger.js';
import { createLogger } from '../electron/lib/logger.js';
import { getDatabaseConfig, getMigrationsDir } from '../electron/config.js';

/**
 * Forward-only migration runner.
 *
 * Applied migrations are recorded by filename in schema_migrations. A migration
 * is never edited after being applied; changing one means writing a new file.
 *
 * Each file runs inside its own transaction together with the bookkeeping insert,
 * so a failed migration leaves neither a partial schema nor a false record that
 * it succeeded.
 */

const CREATE_BOOKKEEPING = `
  CREATE TABLE IF NOT EXISTS schema_migrations (
    name       text PRIMARY KEY,
    applied_at timestamptz NOT NULL DEFAULT now()
  )
`;

/**
 * Locates the migrations directory by walking up from this module.
 *
 * The same code runs from three places with different depths: from source
 * (scripts/), from the compiled output (dist-electron/scripts/), and from a
 * packaged app where db/migrations sits beside the executable. Searching upwards
 * handles all three without a hard-coded depth.
 */
export function resolveMigrationsDir(): string {
  const configured = getMigrationsDir();
  if (isAbsolute(configured)) {
    return configured;
  }

  let dir = dirname(fileURLToPath(import.meta.url));
  for (let depth = 0; depth < 8; depth += 1) {
    const candidate = join(dir, configured);
    if (existsSync(candidate)) {
      return candidate;
    }
    const parent = dirname(dir);
    if (parent === dir) {
      break;
    }
    dir = parent;
  }

  throw new Error(
    `Could not locate the migrations directory '${configured}' walking up from this module`,
  );
}

function createPool(): Pool {
  return new Pool({ ...getDatabaseConfig(), max: 1 });
}

/**
 * Applies every migration not yet recorded, in filename order.
 *
 * @param logger - Receives one line per applied migration
 * @param pool - Caller-owned pool; not closed here
 * @param options.reset - Drops the bookkeeping table first, which re-runs every
 *   migration against the existing schema. Intended for `npm run db:reset` on a
 *   throwaway database, never for the author's database.
 * @param options.migrationsDir - Overrides the directory migrations are read from
 */
export async function runMigrations(
  logger: Logger,
  pool: Pool,
  options: { reset?: boolean; migrationsDir?: string } = {},
) {
  const migrationsDir = options.migrationsDir ?? resolveMigrationsDir();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    if (options.reset === true) {
      await client.query('DROP TABLE IF EXISTS schema_migrations');
    }
    await client.query(CREATE_BOOKKEEPING);

    const applied = await client.query<{ name: string }>(
      'SELECT name FROM schema_migrations ORDER BY name',
    );
    const alreadyApplied = new Set(applied.rows.map((row) => row.name));

    const files = (await readdir(migrationsDir))
      .filter((file) => file.endsWith('.sql'))
      .sort();

    if (files.length === 0) {
      throw new Error(`No migration files found in ${migrationsDir}`);
    }

    const pending = files.filter((file) => !alreadyApplied.has(file));
    if (pending.length === 0) {
      await client.query('COMMIT');
      logger.info('migrations up to date', { applied: files.length });
      return [];
    }

    // DDL in Postgres is transactional, so a failure part-way through a file
    // rolls that file back completely. Later files are never attempted.
    await client.query('COMMIT');

    const executed: string[] = [];
    for (const file of pending) {
      const sql = await readFile(join(migrationsDir, file), 'utf8');
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK');
        logger.error('migration failed', { file, err: String(err) });
        throw new Error(`Migration ${file} failed: ${String(err)}`, { cause: err });
      }
      executed.push(file);
      logger.info('migration applied', { file });
    }

    return executed;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

async function main() {
  const logger = createLogger();
  const reset = process.argv.includes('--reset');
  const pool = createPool();

  try {
    const executed = await runMigrations(logger, pool, { reset });
    if (executed.length === 0) {
      logger.info('nothing to do');
    } else {
      logger.info('migrations complete', { count: executed.length });
    }
  } finally {
    await pool.end();
  }
}

// Only run when invoked directly, so tests can import runMigrations safely.
const invokedDirectly =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) {
  main().catch((err: unknown) => {
    createLogger().error('migrate failed', { err: String(err) });
    process.exitCode = 1;
  });
}