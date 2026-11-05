import { getDatabaseConfig, getDatabaseContainer } from '../config.js';
import { describeFailure, runInContainer } from './docker-process.js';
import { countSelectStatement, parseTableCounts } from './table-counts.js';
import type { TableCounts } from './table-counts.js';

/**
 * The live side of a backup: everything that talks to Docker.
 *
 * Kept behind an interface because the backup service's real job — verify, write,
 * retain, report — is business logic and must be testable without a container
 * running. Tests stub this, the app uses the implementation below.
 */

export interface BackupSource {
  /** Reads a custom-format archive from the live database. */
  dump(): Promise<Buffer>;
  /** Proves an archive is readable end to end. */
  assertArchiveReadable(archive: Buffer): Promise<void>;
  /** Counts the rows currently in the live database. */
  readCounts(): Promise<TableCounts>;
}

/** PostgreSQL custom-format archives begin with this magic string. */
export const DUMP_MAGIC = 'PGDMP';

/**
 * Runs one counting query against a named database inside the container.
 *
 * @param databaseName - Database to count. Callers pass constants, never user input.
 * @param container - Container holding the database.
 * @returns Counts for the four tables that matter.
 * @throws When psql fails or the output cannot be parsed.
 */
export async function readCountsFromContainer(
  databaseName: string,
  container: string = getDatabaseContainer(),
): Promise<TableCounts> {
  const database = getDatabaseConfig();
  const result = await runInContainer(container, [
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
    countSelectStatement(),
  ]);

  if (result.exitCode !== 0) {
    throw new Error(`Could not read row counts (${describeFailure(result)})`);
  }

  return parseTableCounts(result.stdout.toString('utf8'));
}

/**
 * Builds the Docker-backed backup source.
 *
 * @param container - Container name, defaulting to configuration.
 * @returns A source the backup service can use.
 */
export function createDockerBackupSource(
  container: string = getDatabaseContainer(),
): BackupSource {
  const database = getDatabaseConfig();

  return {
    async dump() {
      const result = await runInContainer(container, [
        'pg_dump',
        '-U',
        database.user,
        '-d',
        database.database,
        '--format=custom',
        '--compress=6',
      ]);

      if (result.exitCode !== 0) {
        throw new Error(
          `pg_dump failed (${describeFailure(result)}). Is the database container running?`,
        );
      }
      if (result.stdout.byteLength === 0) {
        throw new Error('pg_dump produced an empty archive; nothing was written');
      }

      return result.stdout;
    },

    async assertArchiveReadable(archive) {
      const result = await runInContainer(container, ['pg_restore', '-l'], archive);
      if (result.exitCode !== 0) {
        throw new Error(
          `The archive is not readable by pg_restore (${describeFailure(result)}); nothing was written`,
        );
      }
    },

    readCounts() {
      return readCountsFromContainer(database.database, container);
    },
  };
}
