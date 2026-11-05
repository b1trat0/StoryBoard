import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

/**
 * Small durable preferences for the main process.
 *
 * Only things the app cannot re-derive live here: which work was last open. Prose,
 * facts and outlines are in Postgres and never duplicated into a settings file.
 *
 * Kept in the main process rather than the renderer because the renderer is sandboxed
 * and owns no durable state: a work chosen yesterday must be remembered even if the
 * window's storage is cleared.
 */

export interface Settings {
  /** Last opened work, or null before anything has been chosen. */
  activeProjectId: string | null;
}

const DEFAULT_SETTINGS: Settings = { activeProjectId: null };

export interface SettingsService {
  /** Reads the current settings, falling back to defaults. */
  read(): Promise<Settings>;
  /** Records which work was last open. */
  setActiveProjectId(projectId: string | null): Promise<void>;
}

/**
 * @param filePath - Absolute path to the JSON file, normally under `userData`.
 */
export function createSettingsService(filePath: string): SettingsService {
  async function read(): Promise<Settings> {
    try {
      const raw = await readFile(filePath, 'utf8');
      const parsed: unknown = JSON.parse(raw);
      if (typeof parsed !== 'object' || parsed === null) {
        return { ...DEFAULT_SETTINGS };
      }
      const activeProjectId = (parsed as Partial<Settings>).activeProjectId;
      return {
        activeProjectId: typeof activeProjectId === 'string' ? activeProjectId : null,
      };
    } catch (err) {
      // A missing file is the first-run state. A corrupt one is not worth failing over:
      // preferences are re-derivable, unlike manuscript data.
      if (isMissingFile(err) || err instanceof SyntaxError) {
        return { ...DEFAULT_SETTINGS };
      }
      throw err;
    }
  }

  return {
    read,

    async setActiveProjectId(projectId) {
      const settings: Settings = { activeProjectId: projectId };
      await mkdir(path.dirname(filePath), { recursive: true });
      const partial = `${filePath}.partial`;
      await writeFile(partial, JSON.stringify(settings, null, 2), 'utf8');
      await rename(partial, filePath);
    },
  };
}

/** True for the error every filesystem raises when a file is simply not there. */
function isMissingFile(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    (err as { code?: string }).code === 'ENOENT'
  );
}
