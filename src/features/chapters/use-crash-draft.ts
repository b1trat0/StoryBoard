import { useCallback, useEffect, useRef, useState } from 'react';
import { getBridge } from '../../lib/bridge';
import type { Chapter, CrashDraft } from '../../lib/bridge';

/**
 * Crash recovery for the open chapter.
 *
 * Prose is saved only on an explicit action, so nothing is promoted to canon by a
 * timer. That rule costs a paragraph if the process dies between keystrokes, and this
 * hook pays it back without breaking it: the buffer is mirrored to a file on disk, and
 * a copy is only ever offered back to the author, never applied automatically.
 *
 * Two timers matter:
 *   - writing waits for typing to stop, so a long paragraph is one file write, not one
 *     per keystroke;
 *   - clearing happens only after an explicit save turned the buffer clean, so looking
 *     at a chapter cannot silently delete the recovery copy the author has not read yet.
 */

/** How long the buffer must be still before it is mirrored to disk. */
const DRAFT_WRITE_DELAY_MS = 20_000;

export interface CrashDraftState {
  /** A stored copy that differs from the chapter in the database. */
  recovered: CrashDraft | null;
  /** Applies the recovered copy to the editor and deletes the file. */
  restore: () => Promise<void>;
  /** Throws the recovered copy away. */
  discard: () => Promise<void>;
}

/**
 * @param chapter - The chapter currently open, or null.
 * @param isDirty - Whether the buffer differs from the database.
 * @param updateDraft - Applies a patch to the editor buffer.
 */
export function useCrashDraft(
  chapter: Chapter | null,
  isDirty: boolean,
  updateDraft: (patch: Partial<Chapter>) => void,
): CrashDraftState {
  const [recovered, setRecovered] = useState<CrashDraft | null>(null);
  const wasDirty = useRef(false);
  const chapterId = chapter?.id ?? null;

  // Offer a stored copy when the chapter changes, but only if it says something the
  // database does not already have.
  useEffect(() => {
    const bridge = getBridge();
    if (bridge === null || chapter === null) {
      // Nothing is open, so there is nothing to offer. Leaving the state alone is
      // deliberate: the banner is not rendered without a chapter, and the read below
      // runs again the moment one opens.
      return;
    }

    let isCurrent = true;
    void (async () => {
      const stored = await bridge.drafts.read({ chapterId: chapter.id });
      if (!isCurrent) {
        return;
      }
      if (stored === null) {
        setRecovered(null);
        return;
      }
      const isIdentical =
        stored.bodyMd === chapter.bodyMd &&
        stored.authorNotePre === chapter.authorNotePre &&
        stored.authorNotePost === chapter.authorNotePost;
      if (isIdentical) {
        // A copy of what is already saved is noise; remove it rather than offering it.
        await bridge.drafts.clear({ chapterId: chapter.id });
        if (isCurrent) {
          setRecovered(null);
        }
        return;
      }
      setRecovered(stored);
    })();

    return () => {
      isCurrent = false;
    };
    // Deliberately keyed on the chapter id: re-reading on every keystroke would fight
    // the author and re-offer a copy they already dismissed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chapterId]);

  // Mirror the buffer while it is dirty, once typing pauses.
  useEffect(() => {
    const bridge = getBridge();
    if (bridge === null || chapter === null || !isDirty) {
      return;
    }

    const timer = setTimeout(() => {
      void bridge.drafts.save({
        chapterId: chapter.id,
        bodyMd: chapter.bodyMd,
        authorNotePre: chapter.authorNotePre,
        authorNotePost: chapter.authorNotePost,
      });
    }, DRAFT_WRITE_DELAY_MS);

    return () => clearTimeout(timer);
  }, [chapter, isDirty]);

  // Clear the recovery file only when a dirty buffer became clean, which means an
  // explicit save succeeded.
  useEffect(() => {
    const bridge = getBridge();
    if (bridge === null || chapter === null) {
      wasDirty.current = isDirty;
      return;
    }
    if (wasDirty.current && !isDirty) {
      void bridge.drafts.clear({ chapterId: chapter.id });
    }
    wasDirty.current = isDirty;
  }, [chapter, isDirty]);

  const restore = useCallback(async () => {
    const bridge = getBridge();
    if (bridge === null || chapter === null || recovered === null) {
      return;
    }
    updateDraft({
      bodyMd: recovered.bodyMd,
      authorNotePre: recovered.authorNotePre,
      authorNotePost: recovered.authorNotePost,
    });
    await bridge.drafts.clear({ chapterId: chapter.id });
    setRecovered(null);
  }, [chapter, recovered, updateDraft]);

  const discard = useCallback(async () => {
    const bridge = getBridge();
    if (bridge === null || chapter === null) {
      return;
    }
    await bridge.drafts.clear({ chapterId: chapter.id });
    setRecovered(null);
  }, [chapter]);

  return { recovered, restore, discard };
}
