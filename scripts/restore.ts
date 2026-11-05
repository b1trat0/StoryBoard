import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getBackupsDir, getDatabaseConfig, getDatabaseContainer } from '../electron/config.js';
import { parseDumpFileName } from '../electron/lib/backup-policy.js';
import type { DumpFile } from '../electron/lib/backup-policy.js';
import { createLogger } from '../electron/lib/logger.js';
import { describeFailure, runInContainer } from './docker.js';

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

/** Tables whose row counts must match for a restore to be considered good. */
const COUNTED_TABLES = ['chapters', 'entities', 'facts', 'relations'] as const;

interface RestoreOptions {
  filePath: string;
  keep: boolean;
}

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
    if (argument === '--latest') {
      continue;
    }
    if (argument === '--keep') {
      continue;
    }
    if (argument.startsWith('--file=')) {
      filePath = argument.slice('--file='.length);
    } else {
      throw new Error(`Unknown argument: ${argument}`);
    }
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
 * Runs a single `psql` statement inside the database container.
 *
 * @param statement - SQL to execute. Interpolated database names are constants in
 *   this file, never user input.
 * @param databaseName - Database to connect to.
 * @returns Captured stdout.
 * @throws When psql fails.
 */
async function runSql(statement: string, databaseName: string): Promise<string> {
  const database = getDatabaseConfig();
  const result = await runInContainer(getDatabaseContainer(), [
    'psql',
    '-U',
    database.user,
    '-d',
    databaseName,
    '-v',
    'ON_ERROR_STOP=1',
    '-t',
    '-A',
    '-c',
    statement,
  ]);
  if (result.exitCode !== 0) {
    throw new Error(`psql failed (${describeFailure(result)})`);
  }
  return result.stdout.toString('utf8').trim();
}

/**
 * Reads the row counts that must agree between live and restored databases.
 *
 * @param databaseName - Database to count in.
 * @returns Counts in {@link COUNTED_TABLES} order.
 */
async function readCounts(databaseName: string): Promise<number[]> {
  const selectList = COUNTED_TABLES.map((table) => `(SELECT count(*) FROM ${table})`).join(
    ', ',
  );
  const output = await runSql(`SELECT ${selectList}`, databaseName);
  return output.split('|').map((value) => Number(value.trim()));
}

/**
 * Restores a dump into the throwaway database and compares it with the live one.
 *
 * @param options - Which dump to restore and whether to keep the throwaway database.
 * @returns The compared counts.
 * @throws When the archive cannot be restored or the counts differ.
 */
export async function verifyRestore(options: RestoreOptions): Promise<{
  counts: number[];
  isKept: boolean;
}> {
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

  const liveCounts = await readCounts(database.database);
  const restoredCounts = await readCounts(RESTORE_CHECK_DATABASE);

  const mismatches = COUNTED_TABLES.map((table, index) => ({
    table,
    live: liveCounts[index],
    restored: restoredCounts[index],
  })).filter((entry) => entry.live !== entry.restored);

  if (mismatches.length > 0) {
    const detail = mismatches
      .map((entry) => `${entry.table}: live ${entry.live}, restored ${entry.restored}`)
      .join('; ');
    throw new Error(`Restore does not match the live database (${detail})`);
  }

  logger.info('restore drill matched', {
    chapters: restoredCounts[0],
    entities: restoredCounts[1],
    facts: restoredCounts[2],
    relations: restoredCounts[3],
  });

  if (!options.keep) {
    await runSql(`DROP DATABASE IF EXISTS ${RESTORE_CHECK_DATABASE}`, 'postgres');
  } else {
    logger.info('throwaway database kept', { database: RESTORE_CHECK_DATABASE });
  }

  return { counts: restoredCounts, isKept: options.keep };
}

/** Entry point when run directly by `npm run db:restore`. */
async function main(): Promise<void> {
  try {
    const parsed = parseRestoreArguments(process.argv.slice(2));
    const filePath =
      parsed.filePath ?? (await findLatestDump(getBackupsDir()));

    const result = await verifyRestore({ filePath, keep: parsed.keep });
    process.stdout.write(
      `restore verified: ${COUNTED_TABLES.map((table, index) => `${table}=${result.counts[index]}`).join(' ')}\n`,
    );
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
