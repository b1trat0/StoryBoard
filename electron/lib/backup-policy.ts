import path from 'node:path';

/**
 * Rules for the automated manuscript backup.
 *
 * Everything here is pure: no filesystem, no Docker, no clock reads. The scripts
 * that actually write files are thin wrappers around these decisions, so the parts
 * that can destroy a backup are the parts that are unit tested.
 *
 * The backup is the only protection against losing the manuscript, which is why the
 * naming, the retention policy and the "never write inside the repository" guard are
 * all decided here rather than inline in a script.
 */

/** How many recent dumps are always kept, regardless of age. */
export const KEEP_LATEST_DUMPS = 14;

/** How many distinct ISO weeks keep one representative dump each. */
export const KEEP_WEEKS = 8;

/** File name emitted by the dump script: storyboard-YYYYMMDD-HHmmss.dump */
export const DUMP_FILE_PATTERN =
  /^storyboard-(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})\.dump$/;

export interface DumpFile {
  /** File name only, never a path. */
  name: string;
  /** Local wall-clock time encoded in the name. */
  timestamp: Date;
}

export interface RetentionPolicy {
  keepLatest: number;
  keepWeeks: number;
}

const DEFAULT_POLICY: RetentionPolicy = {
  keepLatest: KEEP_LATEST_DUMPS,
  keepWeeks: KEEP_WEEKS,
};

/**
 * Builds the file name for a dump taken at a given moment.
 *
 * Local time, not UTC, because the author reads these file names when looking for
 * "last night's backup". A name that silently disagrees with the clock on the wall
 * is worse than no timestamp at all.
 *
 * @param now - The moment the dump is taken.
 * @returns A file name matching {@link DUMP_FILE_PATTERN}.
 */
export function toDumpFileName(now: Date): string {
  const pad = (value: number): string => String(value).padStart(2, '0');
  const date = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`;
  const time = `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  return `storyboard-${date}-${time}.dump`;
}

/**
 * Reads a dump file name back into a timestamp.
 *
 * @param name - File name only; any other file in the backup directory is ignored.
 * @returns The parsed entry, or null when the name is not a dump this script wrote.
 */
export function parseDumpFileName(name: string): DumpFile | null {
  const match = DUMP_FILE_PATTERN.exec(name);
  if (match === null) {
    return null;
  }
  const [, year, month, day, hour, minute, second] = match;
  // Every group is required by the pattern, so the non-null assertion is unreachable.
  const timestamp = new Date(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
    Number(second),
  );
  if (Number.isNaN(timestamp.getTime())) {
    return null;
  }
  return { name, timestamp };
}

/**
 * ISO-8601 week key, so two dumps taken in the same week compare equal.
 *
 * @param date - Any moment in the week.
 * @returns A key such as `2026-W45`.
 */
export function isoWeekKey(date: Date): string {
  const shifted = new Date(
    Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()),
  );
  const weekday = shifted.getUTCDay() === 0 ? 7 : shifted.getUTCDay();
  shifted.setUTCDate(shifted.getUTCDate() + 4 - weekday);
  const isoYear = shifted.getUTCFullYear();
  const yearStart = new Date(Date.UTC(isoYear, 0, 1));
  const week = Math.ceil(
    ((shifted.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7,
  );
  return `${isoYear}-W${String(week).padStart(2, '0')}`;
}

/**
 * Chooses which dump files are safe to delete.
 *
 * Two protections, because they fail differently: the newest {@link KEEP_WEEKS}
 * dumps survive an unlucky week, and one dump per week survives a long gap between
 * writing sessions. A file that does not look like a dump this script wrote is never
 * returned, so a stray `.dump` dropped into the directory by hand cannot be deleted
 * by the scheduler.
 *
 * @param fileNames - Every file name in the backup directory.
 * @param policy - Retention overrides; defaults to the module constants.
 * @returns Names that may be deleted, oldest first. Empty when nothing is expired.
 */
export function selectDumpsToDelete(
  fileNames: readonly string[],
  policy: Partial<RetentionPolicy> = {},
): string[] {
  const { keepLatest, keepWeeks } = { ...DEFAULT_POLICY, ...policy };
  const parsed = fileNames
    .map((name) => parseDumpFileName(name))
    .filter((entry): entry is DumpFile => entry !== null)
    .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());

  const keep = new Set<string>();
  for (const entry of parsed.slice(0, Math.max(keepLatest, 0))) {
    keep.add(entry.name);
  }

  const weeks = new Set<string>();
  for (const entry of parsed) {
    const key = isoWeekKey(entry.timestamp);
    if (!weeks.has(key)) {
      weeks.add(key);
      keep.add(entry.name);
    }
    if (weeks.size >= Math.max(keepWeeks, 0)) {
      break;
    }
  }

  return parsed
    .filter((entry) => !keep.has(entry.name))
    .map((entry) => entry.name)
    .reverse();
}

/**
 * True when a directory is the repository or anything beneath it.
 *
 * Compared case-insensitively on every platform. That can only ever refuse a path it
 * might have allowed on a case-sensitive filesystem, which is the safe direction for
 * a guard whose whole job is to keep backups out of git.
 *
 * @param target - Directory the script is about to write into.
 * @param repoRoot - Absolute path to the repository root.
 * @returns True when writing there would put manuscript data inside the repo.
 */
export function isInsideRepo(target: string, repoRoot: string): boolean {
  const normalizedTarget = path.resolve(target).toLowerCase();
  const normalizedRoot = path.resolve(repoRoot).toLowerCase();
  const prefix = normalizedRoot.endsWith(path.sep)
    ? normalizedRoot
    : `${normalizedRoot}${path.sep}`;
  return normalizedTarget === normalizedRoot || normalizedTarget.startsWith(prefix);
}

/**
 * Refuses a backup destination that lives inside the repository.
 *
 * @param target - Directory the script is about to create or write.
 * @param repoRoot - Absolute path to the repository root.
 * @throws When the directory is inside the repo, because a backup that git can see
 *   is one `git add -A` away from being published.
 */
export function assertOutsideRepo(target: string, repoRoot: string): void {
  if (isInsideRepo(target, repoRoot)) {
    throw new Error(
      `Refusing to write backups inside the repository (${target}). ` +
        'Point STORYBOARD_BACKUPS_DIR at a different drive.',
    );
  }
}
