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
 */

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

/** Absolute path to the forward-only SQL migrations directory. */
export function getMigrationsDir(): string {
  return process.env.STORYBOARD_MIGRATIONS_DIR ?? 'db/migrations';
}

/** Absolute path to the local illustration asset directory. */
export function getIllustrationsDir(): string {
  return process.env.STORYBOARD_ILLUSTRATIONS_DIR ?? 'illustrations';
}

/** Directory that receives pg_dump output. */
export function getBackupsDir(): string {
  return process.env.STORYBOARD_BACKUPS_DIR ?? 'backups';
}

/** Where exported files are written, chosen by the author at export time. */
export function getExportsDir(): string {
  return process.env.STORYBOARD_EXPORTS_DIR ?? 'exports';
}