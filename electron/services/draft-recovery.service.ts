import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { CrashDraft } from '../ipc/contract.js';
import { RuleViolationError } from '../lib/errors.js';

/**
 * Crash recovery for the editor buffer.
 *
 * The app saves prose only on an explicit action, on purpose: a half-written thought
 * must never be promoted to canon mid-sentence. The cost of that choice is that a
 * power cut, a killed process or a crash takes the paragraph with it.
 *
 * This service closes that gap without weakening the rule. It writes the buffer to a
 * file in the app's user data directory, never to the database, and reading it back is
 * an offer the author accepts or discards — it is never loaded automatically.
 *
 * Files are keyed by chapter id, written through a temporary name and renamed, so a
 * crash during a crash-recovery write cannot leave a half-file that looks valid.
 */

export interface DraftRecoveryService {
  /** Writes the current buffer for a chapter. */
  save(input: Omit<CrashDraft, 'savedAt'>): Promise<void>;
  /** Returns the stored buffer for a chapter, or null when there is none. */
  read(chapterId: string): Promise<CrashDraft | null>;
  /** Deletes the stored buffer, after a save or an explicit discard. */
  clear(chapterId: string): Promise<void>;
}

/**
 * Builds the service.
 *
 * @param directory - Absolute directory for draft files. Must be writable.
 * @param now - Injectable clock so tests can assert the timestamp.
 */
export function createDraftRecoveryService(
  directory: string,
  now: () => Date = () => new Date(),
): DraftRecoveryService {
  function filePathFor(chapterId: string): string {
    // The id comes from the database as a uuid and is validated by the IPC schema, so
    // it cannot contain a separator. Re-checking keeps that true if the schema changes.
    if (!/^[0-9a-f-]{36}$/i.test(chapterId)) {
      throw new RuleViolationError('That chapter id is not valid, so no draft was written.');
    }
    return path.join(directory, `${chapterId}.json`);
  }

  return {
    async save(input) {
      await mkdir(directory, { recursive: true });
      const target = filePathFor(input.chapterId);
      const partial = `${target}.partial`;
      const draft: CrashDraft = { ...input, savedAt: now().toISOString() };
      await writeFile(partial, JSON.stringify(draft), 'utf8');
      await rename(partial, target);
    },

    async read(chapterId) {
      try {
        const raw = await readFile(filePathFor(chapterId), 'utf8');
        const parsed: unknown = JSON.parse(raw);
        if (typeof parsed !== 'object' || parsed === null) {
          return null;
        }
        const candidate = parsed as Partial<CrashDraft>;
        if (
          typeof candidate.bodyMd !== 'string' ||
          typeof candidate.authorNotePre !== 'string' ||
          typeof candidate.authorNotePost !== 'string' ||
          typeof candidate.savedAt !== 'string'
        ) {
          // A file that does not match the shape is not something to offer the author;
          // treat it as absent rather than showing corrupt text as their prose.
          return null;
        }
        return {
          chapterId,
          savedAt: candidate.savedAt,
          bodyMd: candidate.bodyMd,
          authorNotePre: candidate.authorNotePre,
          authorNotePost: candidate.authorNotePost,
        };
      } catch (err) {
        if (isMissingFile(err)) {
          return null;
        }
        // A file that cannot be parsed is not prose; offering its bytes as the author's
        // writing would be worse than offering nothing.
        if (err instanceof SyntaxError) {
          return null;
        }
        throw err;
      }
    },

    async clear(chapterId) {
      try {
        await unlink(filePathFor(chapterId));
      } catch (err) {
        // Nothing to delete is the normal case after a save.
        if (!isMissingFile(err)) {
          throw err;
        }
      }
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
