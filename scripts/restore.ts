import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getBackupsDir, getDatabaseConfig, getDatabaseContainer } from '../electron/config.js';
import { parseDumpFileName } from '../electron/lib/backup-policy.js';
import type { DumpFile } from '../electron/lib/backup-policy.js';
import { readCountsFromContainer } from '../electron/lib/docker-backup.js';
import { describeFailure, runInContainer } from '../electron/lib/docker-process.js';
import { createLogger } from '../electron/lib/logger.js';
import { describeTableCounts, COUNTED_TABLES } from '../electron/lib/table-counts.js';

/**
 * Proves a dump can actually be restored.
 *
 * A backup that has never been restored is a rumour. This restores the archive into
 * a throwaway database inside the same container, compares row counts against the
 * live database, and reports a mismatch as a failure.
 *
 * It never writes to the live database: the target name is a constant, the live
 * database is only ever queried with `SELECT count(*)`, and the throwaway database is
 * dropped afterwards unless `--keep` is passed.
 */

const logger = createLogger();

/** Throwaway database used for restore drills. Fixed so it can never target live data. */
const RESTORE_CHECK_DATABASE = 'storyboard_restore_check';

/**
 * Parses the script's arguments.
 *
 * With no arguments the newest dump is verified, because the common run is "check
 * that last night's backup is good". A specific file is reached with `--file`.
 *
 * @param argv - Arguments after the script name.
 * @returns The dump to restore and whether to keep the throwaway database.
 */
export function parseRestoreArguments(argv: readonly string[]): {
  filePath: string | null;
  keep: boolean;
} {
  let filePath: string | null = null;

  for (const argument of argv) {
    if (argument === '--latest' || argument === '--keep') {
      continue;
    }
    if (argument.startsWith('--file=')) {
      filePath = argument.slice('--file='.length);
      continue;
    }
    throw new Error(`Unknown argument: ${argument}`);
  }

  return { filePath, keep: argv.includes('--keep') };
}

/**
 * Finds the newest dump in a directory.
 *
 * @param backupsDir - Directory holding dumps.
 * @returns The absolute path of the newest dump.
 * @throws When the directory holds no dump this script wrote.
 */
async function findLatestDump(backupsDir: string): Promise<string> {
  const entries = await readdir(backupsDir);
  const dumps = entries
    .map((name) => parseDumpFileName(name))
    .filter((entry): entry is DumpFile => entry !== null)
    .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());

  const newest = dumps[0];
  if (newest === undefined) {
    throw new Error(`No dump found in ${backupsDir}`);
  }
  return path.join(backupsDir, newest.name);
}

/**
 * Runs one administrative `psql` statement inside the database container.
 *
 * @param statement - SQL to execute. Interpolated database names are constants in
 *   this file, never user input.
 * @param databaseName - Database to connect to.
 * @returns Captured stdout.
 * @throws When psql fails.
 */
async function runSql(statement: string, databaseName: string): Promise<void> {
  const database = getDatabaseConfig();
  const result = await runInContainer(getDatabaseContainer(), [
    'psql',
    '-U',
    database.user,
    '-d',
    databaseName,
    '-v',
    'ON_ERROR_STOP=1',
    '-c',
    statement,
  ]);
  if (result.exitCode !== 0) {
    throw new Error(`psql failed (${describeFailure(result)})`);
  }
}

/**
 * Restores a dump into the throwaway database and compares it with the live one.
 *
 * @param options - Which dump to restore and whether to keep the throwaway database.
 * @throws When the archive cannot be restored or the counts differ.
 */
export async function verifyRestore(options: {
  filePath: string;
  keep: boolean;
}): Promise<void> {
  const bytes = await readFile(options.filePath);
  if (bytes.byteLength === 0) {
    throw new Error(`${options.filePath} is empty`);
  }

  logger.info('restore drill started', {
    file: options.filePath,
    bytes: bytes.byteLength,
  });

  await runSql(`DROP DATABASE IF EXISTS ${RESTORE_CHECK_DATABASE} WITH (FORCE)`, 'postgres');
  await runSql(`CREATE DATABASE ${RESTORE_CHECK_DATABASE}`, 'postgres');

  const database = getDatabaseConfig();
  const restore = await runInContainer(
    getDatabaseContainer(),
    [
      'pg_restore',
      '-U',
      database.user,
      '-d',
      RESTORE_CHECK_DATABASE,
      '--no-owner',
      '--no-privileges',
      '--exit-on-error',
    ],
    bytes,
  );

  if (restore.exitCode !== 0) {
    throw new Error(`pg_restore failed (${describeFailure(restore)})`);
  }

  const liveCounts = await readCountsFromContainer(database.database);
  const restoredCounts = await readCountsFromContainer(RESTORE_CHECK_DATABASE);

  const mismatches = COUNTED_TABLES.filter(
    (table) => liveCounts[table] !== restoredCounts[table],
  );

  if (mismatches.length > 0) {
    const detail = mismatches
      .map(
        (table) =>
          `${table}: live ${liveCounts[table]}, restored ${restoredCounts[table]}`,
      )
      .join('; ');
    throw new Error(`Restore does not match the live database (${detail})`);
  }

  logger.info('restore drill matched', { counts: describeTableCounts(restoredCounts) });

  if (!options.keep) {
    await runSql(`DROP DATABASE IF EXISTS ${RESTORE_CHECK_DATABASE}`, 'postgres');
  } else {
    logger.info('throwaway database kept', { database: RESTORE_CHECK_DATABASE });
  }
}

/** Entry point when run directly by `npm run db:restore`. */
async function main(): Promise<void> {
  try {
    const parsed = parseRestoreArguments(process.argv.slice(2));
    const filePath = parsed.filePath ?? (await findLatestDump(getBackupsDir()));
    await verifyRestore({ filePath, keep: parsed.keep });
    process.stdout.write(`restore verified from ${filePath}\n`);
  } catch (err: unknown) {
    logger.error('restore drill failed', {
      err: err instanceof Error ? err.message : String(err),
    });
    process.exitCode = 1;
  }
}

const invokedDirectly =
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedDirectly) {
  void main();
}
