import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { BrowserWindow, dialog, nativeImage } from 'electron';
import type { FileFilter, OpenDialogOptions } from 'electron';

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
   * @param input - The suggested filename, the bytes, and the file kind that decides
   *   the dialog filter. Defaults to a Word document so the original export path is
   *   unchanged.
   * @returns Where it was written, or `cancelled` if the author closed the dialog.
   * @throws When the write fails. The message must be safe to show the author.
   */
  save(input: {
    suggestedName: string;
    bytes: Buffer;
    kind?: 'docx' | 'html' | 'json';
    /** Folder the dialog opens in. Falls back to the last used folder. */
    defaultDirectory?: string;
  }): Promise<SaveFileOutcome>;
}

export function createDirectoryPicker(
  getWindow: () => BrowserWindow | null,
): DirectoryPicker {
  return {
    async pick() {
      const parent = getWindow();
      const options: OpenDialogOptions = {
        title: 'Choose where this work keeps its files',
        properties: ['openDirectory', 'createDirectory'],
      };
      const result =
        parent === null
          ? await dialog.showOpenDialog(options)
          : await dialog.showOpenDialog(parent, options);

      const directory = result.filePaths[0];
      if (result.canceled || directory === undefined) {
        return { status: 'cancelled' };
      }
      return { status: 'picked', directory };
    },
  };
}

/** Choosing a folder for a work's files. */
export type PickDirectoryOutcome =
  | { status: 'picked'; directory: string }
  | { status: 'cancelled' };

export interface DirectoryPicker {
  /** Asks the author for one folder. */
  pick(): Promise<PickDirectoryOutcome>;
}

export class ExportWriteError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ExportWriteError';
  }
}

/** Word's own filter, so the dialog does not offer the author a wrong file type. */
const DOCX_FILTER: FileFilter = { name: 'Word document', extensions: ['docx'] };
const HTML_FILTER: FileFilter = { name: 'HTML file', extensions: ['html'] };
const JSON_FILTER: FileFilter = { name: 'JSON archive', extensions: ['json'] };

const FILTERS: Record<'docx' | 'html' | 'json', FileFilter> = {
  docx: DOCX_FILTER,
  html: HTML_FILTER,
  json: JSON_FILTER,
};

const IMAGE_FILTERS: FileFilter[] = [
  { name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif'] },
];

/** What the image picker returns; dimensions come from Electron, not the renderer. */
export type PickImageOutcome =
  | {
      status: 'picked';
      filePath: string;
      width: number | null;
      height: number | null;
    }
  | { status: 'cancelled' };

export interface ImagePicker {
  /** Asks the author for one image file and reads its real dimensions. */
  pick(): Promise<PickImageOutcome>;
}

/**
 * The real image picker.
 *
 * Dimensions are read here rather than guessed in the renderer: Royal Road's export
 * needs width and height on the tag, and a wrong guess produces a squashed image in a
 * published chapter. `nativeImage` reads the actual file.
 *
 * @param getWindow - Supplies the parent window, read lazily.
 */
export function createImagePicker(getWindow: () => BrowserWindow | null): ImagePicker {
  return {
    async pick() {
      const parent = getWindow();
      const result =
        parent === null
          ? await dialog.showOpenDialog({ properties: ['openFile'], filters: IMAGE_FILTERS })
          : await dialog.showOpenDialog(parent, {
              properties: ['openFile'],
              filters: IMAGE_FILTERS,
            });

      const filePath = result.filePaths[0];
      if (result.canceled || filePath === undefined) {
        return { status: 'cancelled' };
      }

      const size = nativeImage.createFromPath(filePath).getSize();
      return {
        status: 'picked',
        filePath,
        width: size.width > 0 ? size.width : null,
        height: size.height > 0 ? size.height : null,
      };
    },
  };
}

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
    async save({ suggestedName, bytes, kind = 'docx', defaultDirectory }) {
      const parent = getWindow();
      const filters = [FILTERS[kind]];
      const defaultPath =
        defaultDirectory === undefined || defaultDirectory.trim() === ''
          ? suggestedName
          : path.join(defaultDirectory, suggestedName);

      const result =
        parent === null
          ? await dialog.showSaveDialog({ defaultPath, filters })
          : await dialog.showSaveDialog(parent, {
              defaultPath,
              filters,
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