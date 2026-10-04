import { writeFile } from 'node:fs/promises';
import { BrowserWindow, dialog } from 'electron';
import type { FileFilter } from 'electron';

/**
 * Saving an export file.
 *
 * The renderer cannot reach the filesystem, so every export ends with the main process
 * asking the author where the file should go. Doing it through Electron's own dialog
 * rather than writing to a fixed folder is deliberate: the file is the one artefact of
 * this app that leaves it, the author uploads it by hand to Royal Road, and a path
 * chosen by the app is a path the author has to go looking for.
 *
 * It is an interface rather than a direct `dialog` call so the service that uses it can
 * be tested without an Electron window. A test that needs a real dialog is a test that
 * does not get written.
 */

/** The outcome of asking the author where to save. */
export type SaveFileOutcome =
  | { status: 'saved'; filePath: string }
  /** The author closed the dialog. Not an error: declining to save is a decision. */
  | { status: 'cancelled' };

export interface SaveFilePicker {
  /**
   * Asks the author where to write a file, then writes it.
   *
   * @param input - The suggested filename and the bytes to write.
   * @returns Where it was written, or `cancelled` if the author closed the dialog.
   * @throws When the write fails. The message must be safe to show the author.
   */
  save(input: { suggestedName: string; bytes: Buffer }): Promise<SaveFileOutcome>;
}

export class ExportWriteError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ExportWriteError';
  }
}

/** Word's own filter, so the dialog does not offer the author a wrong file type. */
const DOCX_FILTER: FileFilter = { name: 'Word document', extensions: ['docx'] };

/**
 * The real implementation, backed by Electron's save dialog.
 *
 * @param getWindow - Supplies the window to parent the dialog to, so it opens in front
 *   of the app rather than behind it. Read lazily because the window does not exist
 *   when the handlers are wired.
 * @returns A picker that shows the dialog and writes the file.
 */
export function createSaveFilePicker(getWindow: () => BrowserWindow | null): SaveFilePicker {
  return {
    async save({ suggestedName, bytes }) {
      const parent = getWindow();

      const result =
        parent === null
          ? await dialog.showSaveDialog({ defaultPath: suggestedName, filters: [DOCX_FILTER] })
          : await dialog.showSaveDialog(parent, {
              defaultPath: suggestedName,
              filters: [DOCX_FILTER],
            });

      if (result.canceled || result.filePath === undefined) {
        return { status: 'cancelled' };
      }

      try {
        await writeFile(result.filePath, bytes);
      } catch (err) {
        throw new ExportWriteError(
          `Could not write ${suggestedName} (${String(err)}). Nothing else was changed, so ` +
            'you can try a different folder.',
        );
      }

      return { status: 'saved', filePath: result.filePath };
    },
  };
}