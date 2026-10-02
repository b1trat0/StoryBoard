import { pathToFileURL } from 'node:url';
import { Pool } from 'pg';
import { getDatabaseConfig } from '../electron/config.js';
import { createLogger } from '../electron/lib/logger.js';

/**
 * Creates the one project the app works against.
 *
 * The app is single-project in practice: one serial novel, one manuscript. The
 * projects row exists because chapters, entities and facts all hang off it, not
 * because the app will ever host two.
 *
 * This script is idempotent: running it twice leaves one project, not two, so it
 * is safe to call from setup instructions.
 */

const PROJECT_TITLE = 'My Serial';

/**
 * Returns the project's id, creating the project if it is missing.
 *
 * The id is a fixed constant rather than a generated uuid because the renderer
 * has no server to ask which project is active. A fixed value is therefore the
 * only way the renderer can address the project without a lookup step, and it
 * makes the database disposable: wiping and reseeding changes nothing the UI can
 * see.
 */
export const ACTIVE_PROJECT_ID = '00000000-0000-4000-8000-000000000001';

/**
 * Ensures the active project exists and is addressed by ACTIVE_PROJECT_ID.
 *
 * @param pool - Caller-owned pool; not closed here
 * @returns The active project id
 * @throws When the row cannot be created
 */
export async function ensureProject(pool: Pool): Promise<string> {
  const existing = await pool.query<{ id: string }>(
    `SELECT id FROM projects WHERE id = $1`,
    [ACTIVE_PROJECT_ID],
  );

  if (existing.rows.length > 0) {
    return ACTIVE_PROJECT_ID;
  }

  await pool.query(
    `INSERT INTO projects (id, title) VALUES ($1, $2)
     ON CONFLICT (id) DO NOTHING`,
    [ACTIVE_PROJECT_ID, PROJECT_TITLE],
  );

  return ACTIVE_PROJECT_ID;
}

async function main(): Promise<void> {
  const logger = createLogger();
  const pool = new Pool({ ...getDatabaseConfig(), max: 1 });

  try {
    const id = await ensureProject(pool);
    logger.info('seed complete', { projectId: id, title: PROJECT_TITLE });
  } finally {
    await pool.end();
  }
}

// Only run when invoked directly, so tests can import ensureProject safely.
const invokedDirectly =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) {
  main().catch((err: unknown) => {
    createLogger().error('seed failed', { err: String(err) });
    process.exitCode = 1;
  });
}