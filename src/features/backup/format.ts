/**
 * Display formatting for the backup screen.
 *
 * Kept separate from the component so the sizes and dates can be asserted directly
 * rather than scraped out of rendered markup.
 */

/**
 * Renders a byte count the way a file manager does.
 *
 * @param bytes - Non-negative size in bytes.
 * @returns e.g. `38 KB`, `1.4 MB`.
 */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  const kilobytes = bytes / 1024;
  if (kilobytes < 1024) {
    return `${kilobytes.toFixed(kilobytes < 10 ? 1 : 0)} KB`;
  }
  const megabytes = kilobytes / 1024;
  return `${megabytes.toFixed(1)} MB`;
}

/**
 * Renders an ISO timestamp as a readable local date and time.
 *
 * @param iso - ISO-8601 timestamp from the main process.
 * @returns e.g. `6 Nov 2026, 01:23`.
 * @throws When the input is not a valid date, because a backup with an unreadable
 *   timestamp should fail loudly rather than display "Invalid Date".
 */
export function formatBackupTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Not a valid timestamp: ${iso}`);
  }
  return new Intl.DateTimeFormat(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

/**
 * The command that verifies and restores a dump, with the real path in it.
 *
 * @param filePath - Absolute path of the dump.
 * @returns A copyable command line.
 */
export function restoreCommand(filePath: string): string {
  return `npm run db:restore -- --file="${filePath}"`;
}
