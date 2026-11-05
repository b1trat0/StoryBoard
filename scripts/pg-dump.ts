import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getBackupMirrorDir, getBackupsDir } from '../electron/config.js';
import { createDockerBackupSource } from '../electron/lib/docker-backup.js';
import { createLogger } from '../electron/lib/logger.js';
import { describeTableCounts } from '../electron/lib/table-counts.js';
import { createBackupService } from '../electron/services/backup.service.js';

/**
 * Command-line wrapper around the backup service.
 *
 * The app and this script call the same service, so a dump taken from the terminal
 * and a dump taken from the Backup button cannot diverge in verification, retention
 * or naming. This file only supplies configuration and prints the result.
 */

const logger = createLogger();

/**
 * Resolves the repository root from this compilation unit.
 *
 * The script compiles to `dist-electron/scripts/pg-dump.js`, so the repository root
 * is two levels up from the script's directory.
 */
function resolveRepoRoot(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
}

async function main(): Promise<void> {
  try {
    const service = createBackupService(createDockerBackupSource(), {
      backupsDir: getBackupsDir(),
      repoRoot: resolveRepoRoot(),
      mirrorDir: getBackupMirrorDir(),
    });

    const result = await service.run();

    logger.info('backup written', {
      file: result.file.filePath,
      bytes: result.file.bytes,
    });
    logger.info('contents', { counts: describeTableCounts(result.counts) });
    if (result.mirrorPath !== null) {
      logger.info('backup mirrored', { file: result.mirrorPath });
    }
    if (result.removed.length > 0) {
      logger.info('expired backups removed', {
        count: result.removed.length,
        files: result.removed,
      });
    }

    process.stdout.write(`${result.file.filePath}\n`);
  } catch (err: unknown) {
    logger.error('backup failed', {
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
