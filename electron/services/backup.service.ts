import {
  access,
  copyFile,
  mkdir,
  readdir,
  rename,
  stat,
  unlink,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import {
  assertOutsideRepo,
  parseDumpFileName,
  selectDumpsToDelete,
  toDumpFileName,
} from '../lib/backup-policy.js';
import { DUMP_MAGIC } from '../lib/docker-backup.js';
import type { BackupSource } from '../lib/docker-backup.js';
import { RuleViolationError } from '../lib/errors.js';
import type { BackupFileInfo, BackupRunResult, BackupStatus } from '../ipc/contract.js';

/**
 * Backups, triggered by the author rather than by a clock.
 *
 * The order of operations is the point:
 *
 *   1. dump to memory
 *   2. prove the archive is readable
 *   3. write it, under a partial name, then rename
 *   4. mirror it if configured
 *   5. only then delete expired dumps
 *   6. report row counts so the file is not just "a file"
 *
 * A truncated archive that looks like a backup is worse than no backup, because it
 * is the one you would trust. Nothing is deleted until a verified dump is on disk,
 * and every failure is an author-readable sentence, not a stack trace.
 */

export interface BackupServiceOptions {
  /** Directory dumps are written to. Never inside the repository. */
  backupsDir: string;
  /** Application directory, used only by the guard. */
  repoRoot: string;
  /** Optional second location every verified dump is copied to. */
  mirrorDir: string | null;
  /** Injectable clock, so tests can name a dump deterministically. */
  now?: () => Date;
}

export interface BackupService {
  /** Reports where dumps go and when the newest one was written. */
  status(): Promise<BackupStatus>;
  /** Takes, verifies, stores and reports one dump. */
  run(): Promise<BackupRunResult>;
}

/**
 * Builds the backup service.
 *
 * @param source - Live database access, stubbed in tests.
 * @param options - Destination directories and an optional clock.
 * @returns The service the IPC layer calls.
 */
export function createBackupService(
  source: BackupSource,
  options: BackupServiceOptions,
): BackupService {
  const now = options.now ?? (() => new Date());

  async function ensureDirectory(): Promise<void> {
    assertOutsideRepo(options.backupsDir, options.repoRoot);
    await mkdir(options.backupsDir, { recursive: true });
  }

  return {
    async status() {
      const info = await readLatestDump(options.backupsDir);
      return {
        directory: options.backupsDir,
        isMirrorConfigured: options.mirrorDir !== null,
        lastBackup: info,
      };
    },

    async run() {
      await ensureDirectory();

      const archive = await source.dump();
      if (archive.subarray(0, DUMP_MAGIC.length).toString('ascii') !== DUMP_MAGIC) {
        throw new RuleViolationError(
          'The database produced something that is not a backup archive. Nothing was written.',
        );
      }

      // A valid header can still precede a truncated stream, so the whole table of
      // contents has to be readable before the file is allowed on disk.
      try {
        await source.assertArchiveReadable(archive);
      } catch (err) {
        throw new RuleViolationError(
          err instanceof Error
            ? err.message
            : 'The backup could not be verified. Nothing was written.',
        );
      }

      const fileName = toDumpFileName(now());
      const filePath = path.join(options.backupsDir, fileName);
      if (await fileExists(filePath)) {
        throw new RuleViolationError(
          'A backup with this exact timestamp already exists. Try again in a second.',
        );
      }

      const partialPath = `${filePath}.partial`;
      await writeFile(partialPath, archive);
      await rename(partialPath, filePath);

      let mirrorPath: string | null = null;
      if (options.mirrorDir !== null) {
        assertOutsideRepo(options.mirrorDir, options.repoRoot);
        await mkdir(options.mirrorDir, { recursive: true });
        mirrorPath = path.join(options.mirrorDir, fileName);
        await copyFile(filePath, mirrorPath);
      }

      const removed = await applyRetention(options.backupsDir);
      const file = await describeFile(filePath, fileName);
      const counts = await source.readCounts();

      return { file, counts, removed, mirrorPath };
    },
  };
}

/**
 * Deletes dumps the retention policy no longer keeps.
 *
 * @param backupsDir - Directory holding the dumps.
 * @returns File names that were deleted.
 */
async function applyRetention(backupsDir: string): Promise<string[]> {
  const entries = await readdir(backupsDir);
  const expired = selectDumpsToDelete(entries);
  for (const name of expired) {
    // Re-checked because deletion is irreversible and the policy is the only thing
    // allowed to nominate a name.
    if (parseDumpFileName(name) === null) {
      continue;
    }
    await unlink(path.join(backupsDir, name));
  }
  return expired;
}

/**
 * Finds the newest dump in a directory.
 *
 * @param backupsDir - Directory holding dumps.
 * @returns Its description, or null when nothing has been backed up yet.
 */
async function readLatestDump(backupsDir: string): Promise<BackupFileInfo | null> {
  let entries: string[];
  try {
    entries = await readdir(backupsDir);
  } catch {
    // No directory yet is the ordinary first-run state, not an error.
    return null;
  }

  const dumps = entries
    .map((name) => parseDumpFileName(name))
    .filter((entry): entry is NonNullable<typeof entry> => entry !== null)
    .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());

  const newest = dumps[0];
  if (newest === undefined) {
    return null;
  }

  return describeFile(path.join(backupsDir, newest.name), newest.name);
}

/**
 * Reads a dump's size and timestamp from disk.
 *
 * @param filePath - Absolute path to the dump.
 * @param fileName - File name, as stored in the report.
 * @returns Description matching the IPC contract.
 */
async function describeFile(filePath: string, fileName: string): Promise<BackupFileInfo> {
  const stats = await stat(filePath);
  return {
    fileName,
    filePath,
    bytes: stats.size,
    // The filesystem timestamp is what "when was this written" means to the author;
    // the name encodes the same moment to the second.
    createdAt: stats.mtime.toISOString(),
  };
}

/**
 * True when a path already exists.
 *
 * @param target - Absolute path to probe.
 * @returns True when it exists; false for any access error.
 */
async function fileExists(target: string): Promise<boolean> {
  try {
    await access(target);
    return true;
  } catch {
    return false;
  }
}
