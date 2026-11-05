import { mkdir, readdir, copyFile, unlink, rename, writeFile, access } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  getBackupMirrorDir,
  getBackupsDir,
  getDatabaseConfig,
  getDatabaseContainer,
} from '../electron/config.js';
import {
  assertOutsideRepo,
  parseDumpFileName,
  selectDumpsToDelete,
  toDumpFileName,
} from '../electron/lib/backup-policy.js';
import { createLogger } from '../electron/lib/logger.js';
import { describeFailure, runInContainer } from './docker.js';

/**
 * Writes a verified dump of the manuscript database.
 *
 * Order matters and is the whole point of this script:
 *
 *   1. dump to memory
 *   2. verify the archive is readable by `pg_restore -l`
 *   3. only then write it to disk
 *   4. only after a successful write, delete expired dumps
 *
 * A truncated file that looks like a backup is worse than no backup, because it is
 * the one you will trust. Nothing is deleted until a good dump is on disk.
 */

const logger = createLogger();

/** PostgreSQL custom-format archives start with this magic string. */
const DUMP_MAGIC = 'PGDMP';

/**
 * Resolves the repository root from this compilation unit.
 *
 * The script compiles to `dist-electron/scripts/pg-dump.js`, so the repository root
 * is two levels up from the script's directory. Resolving it rather than reading
 * `process.cwd()` makes the guard work when the task scheduler starts the script
 * from a different working directory.
 */
function resolveRepoRoot(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
}

/**
 * True when a path already exists.
 *
 * @param target - Absolute path to probe.
 * @returns True when the file exists; false for any access error.
 */
async function fileExists(target: string): Promise<boolean> {
  try {
    await access(target);
    return true;
  } catch {
    return false;
  }
}

/**
 * Takes, verifies and stores one dump.
 *
 * @param options - Overrides used by tests and manual runs.
 * @returns The absolute path of the written dump.
 * @throws When the dump fails, is unreadable, or the destination is inside the repo.
 */
export async function runBackup(options: {
  backupsDir?: string;
  repoRoot?: string;
  now?: Date;
} = {}): Promise<string> {
  const repoRoot = options.repoRoot ?? resolveRepoRoot();
  const backupsDir = options.backupsDir ?? getBackupsDir();
  const now = options.now ?? new Date();
  const database = getDatabaseConfig();
  const container = getDatabaseContainer();

  assertOutsideRepo(backupsDir, repoRoot);
  await mkdir(backupsDir, { recursive: true });

  logger.info('dump started', {
    container,
    database: database.database,
    destination: backupsDir,
  });

  const dump = await runInContainer(container, [
    'pg_dump',
    '-U',
    database.user,
    '-d',
    database.database,
    '--format=custom',
    '--compress=6',
  ]);

  if (dump.exitCode !== 0) {
    throw new Error(`pg_dump failed (${describeFailure(dump)})`);
  }

  if (dump.stdout.byteLength === 0) {
    throw new Error('pg_dump produced an empty archive; nothing was written');
  }

  const header = dump.stdout.subarray(0, DUMP_MAGIC.length).toString('ascii');
  if (header !== DUMP_MAGIC) {
    throw new Error(
      'pg_dump output is not a PostgreSQL custom-format archive; nothing was written',
    );
  }

  // The archive could still be truncated after a successful header. Reading the
  // table of contents is the cheapest check that the whole stream arrived.
  const listing = await runInContainer(container, ['pg_restore', '-l'], dump.stdout);
  if (listing.exitCode !== 0) {
    throw new Error(
      `the dump archive is not readable by pg_restore (${describeFailure(listing)}); nothing was written`,
    );
  }

  const fileName = toDumpFileName(now);
  const filePath = path.join(backupsDir, fileName);
  const partialPath = `${filePath}.partial`;

  if (await fileExists(filePath)) {
    throw new Error(`a dump named ${fileName} already exists; retry in a second`);
  }

  // Written under a partial name and renamed, so an interrupted write can never
  // leave a file that looks like a complete backup.
  await writeFile(partialPath, dump.stdout);
  await rename(partialPath, filePath);

  logger.info('dump written', {
    file: filePath,
    bytes: dump.stdout.byteLength,
  });

  const mirrorDir = getBackupMirrorDir();
  if (mirrorDir !== null) {
    assertOutsideRepo(mirrorDir, repoRoot);
    await mkdir(mirrorDir, { recursive: true });
    await copyFile(filePath, path.join(mirrorDir, fileName));
    logger.info('dump mirrored', { file: path.join(mirrorDir, fileName) });
  }

  const removed = await applyRetention(backupsDir);
  if (removed.length > 0) {
    logger.info('expired dumps removed', { count: removed.length, files: removed });
  }

  return filePath;
}

/**
 * Deletes dumps the retention policy no longer keeps.
 *
 * @param backupsDir - Directory holding the dumps.
 * @returns File names that were deleted.
 */export async function applyRetention(backupsDir: string): Promise<string[]> {
  const entries = await readdir(backupsDir);
  const expired = selectDumpsToDelete(entries);
  for (const name of expired) {
    // Only names the policy produced are deleted, and the policy only produces names
    // that matched the dump pattern. Re-checking keeps that true if either changes.
    if (parseDumpFileName(name) === null) {
      continue;
    }
    await unlink(path.join(backupsDir, name));
  }
  return expired;
}

/** Entry point when run directly by `npm run db:dump`. */
async function main(): Promise<void> {
  try {
    const filePath = await runBackup();
    process.stdout.write(`${filePath}\n`);
  } catch (err: unknown) {
    logger.error('backup failed', { err: err instanceof Error ? err.message : String(err) });
    process.exitCode = 1;
  }
}

const invokedDirectly =
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedDirectly) {
  void main();
}
