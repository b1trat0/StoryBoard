import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';

/**
 * Single source of truth for runtime configuration.
 *
 * The app is local and single-user, so there is no config file format and no
 * secrets manager. Defaults are chosen so the app runs with nothing set at all;
 * every value can be overridden by an environment variable.
 *
 * The Postgres port defaults to 5433 because this machine already runs another
 * Postgres container on 5432. The StoryBoard container always listens on 5432
 * internally; only the host-side port is remapped in docker-compose.yml.
 *
 * Durable data (backups, exports, illustration files) defaults to the second local
 * drive, not the system drive. The system drive holds the Postgres volume, the
 * Docker image and node_modules already; filling it is a corrupted database waiting
 * to happen. A backup that lives on the same disk as the database protects against
 * a mistake, not against a dead disk, which is why a mirror directory exists.
 */

/** The drive durable story data defaults to on this machine. */
const SECONDARY_DRIVE_ROOT = 'D:\\';

export interface DatabaseConfig {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
}

export function getDatabaseConfig(): DatabaseConfig {
  return {
    host: process.env.STORYBOARD_DB_HOST ?? '127.0.0.1',
    port: Number(process.env.STORYBOARD_DB_PORT ?? 5433),
    database: process.env.STORYBOARD_DB_NAME ?? 'storyboard',
    user: process.env.STORYBOARD_DB_USER ?? 'storyboard',
    password: process.env.STORYBOARD_DB_PASSWORD ?? 'storyboard',
  };
}

/**
 * Resolves a durable-data directory.
 *
 * The second drive is preferred when it exists, so a fresh clone on a machine
 * without one still works instead of failing on a path it cannot create.
 *
 * @param name - Folder name beneath the storage root.
 * @returns An absolute path outside the repository.
 */
function defaultStorageDir(name: string): string {
  if (process.platform === 'win32' && existsSync(SECONDARY_DRIVE_ROOT)) {
    return path.join(SECONDARY_DRIVE_ROOT, name);
  }
  return path.join(homedir(), 'StoryBoard', name);
}

/** Absolute path to the forward-only SQL migrations directory. */
export function getMigrationsDir(): string {
  return process.env.STORYBOARD_MIGRATIONS_DIR ?? 'db/migrations';
}

/**
 * Absolute path to the local illustration asset directory.
 *
 * The local file is the source of truth for an illustration, so it lives on the
 * durable drive rather than in the repository.
 */
export function getIllustrationsDir(): string {
  return (
    process.env.STORYBOARD_ILLUSTRATIONS_DIR ??
    path.join(defaultStorageDir('storyboard-assets'), 'illustrations')
  );
}

/** Directory that receives pg_dump output. Never inside the repository. */
export function getBackupsDir(): string {
  return process.env.STORYBOARD_BACKUPS_DIR ?? defaultStorageDir('storyboard-backups');
}

/**
 * Optional second location every dump is copied to after it is verified.
 *
 * A copy on the same physical disk is not a backup against disk failure. Pointing
 * this at a cloud-synced folder restores that property without filling the system
 * drive, provided the sync client's own folder lives on the secondary drive too.
 *
 * @returns An absolute directory, or null when no mirror is configured.
 */
export function getBackupMirrorDir(): string | null {
  const configured = process.env.STORYBOARD_BACKUP_MIRROR_DIR;
  return configured === undefined || configured.trim() === '' ? null : configured;
}

/** Where exported files are written, chosen by the author at export time. */
export function getExportsDir(): string {
  return process.env.STORYBOARD_EXPORTS_DIR ?? defaultStorageDir('storyboard-exports');
}

/** The Docker container that holds the database, for dump and restore. */
export function getDatabaseContainer(): string {
  return process.env.STORYBOARD_DB_CONTAINER ?? 'storyboard-db';
}
